---
layout: post
title:  "158. Go cho người mới (Bài 9: Phát hiện sự cố & Gửi thông báo Telegram)."
date:   2026-10-04 14:20:00 +0700
author: thach
categories: [Coding]
tags: [Golang]
image: assets/images/post_158/go-notify.png
---
Pulse đã biết kiểm tra và lưu lịch sử, nhưng một hệ thống giám sát chỉ có giá trị khi nó **gọi bạn dậy lúc 3 giờ sáng** khi web sập. Bài này thêm hai thứ: **phát hiện sự cố** (khi nào thì gọi là sập, khi nào thì hồi phục, không báo loạn vì một lần mạng chập chờn) và **gửi thông báo** qua Telegram hoặc webhook, có thử lại khi gửi lỗi. Qua đó học cách gọi API bên thứ ba cho đúng, mẫu decorator bằng interface, <mark>errors.Join</mark>, backoff theo cấp số nhân, để database đảm bảo bất biến thay vì code Go, và cách viết test cho logic nghiệp vụ mà không cần database.

#### Khi nào thì gọi là "sập"
Một lần kiểm tra lỗi chưa nói lên gì: wifi chập chờn, server đang deploy, DNS trễ. Nếu cứ down một phát là nhắn tin, người nhận sẽ tắt thông báo sau một tuần, và lúc đó sập thật thì không ai biết. Quy tắc của Pulse:
- Đếm số lần **down liên tiếp** (<mark>failures</mark>). Up một lần là về 0.
- Đủ <mark>DOWN_THRESHOLD</mark> lần (mặc định 3) thì **mở một sự cố** (incident) và báo "down".
- Đang có sự cố mà vẫn down: im lặng, đã báo rồi.
- Up trở lại khi đang có sự cố: **đóng sự cố** và báo "up" kèm thời gian sập.

Đây là một máy trạng thái nhỏ, và trạng thái phải nằm trong **database**, không nằm trong bộ nhớ: bài 156 đã cho phép chạy nhiều bản pulsed, bản A kiểm tra lần 1, bản B kiểm tra lần 2, cả hai phải cùng đếm vào một chỗ.

#### Bước 1: Migration
```sql
-- internal/store/migrations/00004_create_incidents.sql
-- +goose Up
ALTER TABLE monitors
    ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;

CREATE TABLE incidents (
    id          BIGSERIAL PRIMARY KEY,
    monitor_id  BIGINT      NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    cause       TEXT        NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

-- Mỗi monitor chỉ có tối đa một sự cố đang mở (resolved_at IS NULL).
CREATE UNIQUE INDEX incidents_open_idx ON incidents (monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_monitor_id_started_at_idx ON incidents (monitor_id, started_at DESC);

-- +goose Down
DROP TABLE incidents;
ALTER TABLE monitors DROP COLUMN failures;
```
Dòng quan trọng nhất là **unique index có điều kiện** (partial index, bài 112): chỉ các dòng <mark>resolved_at IS NULL</mark> mới tham gia, nên mỗi monitor chỉ có thể có **một** sự cố đang mở. Vì sao để database giữ luật này thay vì code Go kiểm tra "đã có sự cố mở chưa" rồi mới chèn? Vì hai bản pulsed (hoặc hai goroutine) có thể cùng thấy "chưa có" rồi cùng chèn, y hệt bài toán email trùng ở bài 157 và race condition ở bài 081. Ràng buộc trong database là nơi duy nhất không bị race.

#### Bước 2: Kiểu Incident
```go
// internal/monitor/incident.go
package monitor

import "time"

// Incident là một khoảng thời gian monitor bị down liên tục.
// ResolvedAt = nil nghĩa là đang còn down.
type Incident struct {
	ID         int64      `json:"id"`
	MonitorID  int64      `json:"monitor_id"`
	Cause      string     `json:"cause"`
	StartedAt  time.Time  `json:"started_at"`
	ResolvedAt *time.Time `json:"resolved_at"`
}

// Duration là thời gian sự cố kéo dài (tới giờ nếu chưa hết).
func (i Incident) Duration() time.Duration {
	end := time.Now()
	if i.ResolvedAt != nil {
		end = *i.ResolvedAt
	}
	return end.Sub(i.StartedAt).Round(time.Second)
}
```
<mark>ResolvedAt *time.Time</mark>: con trỏ nil là "chưa đóng", giống <mark>LastCheckedAt</mark> ở bài 156. <mark>*i.ResolvedAt</mark> là **giải tham chiếu** con trỏ để lấy giá trị. <mark>Duration</mark> có receiver giá trị <mark>(i Incident)</mark> chứ không phải con trỏ, vì nó chỉ đọc, không sửa.

Thêm <mark>ListIncidents(ctx, monitorID, limit) ([]Incident, error)</mark> vào interface <mark>monitor.Store</mark> cho API.

#### Bước 3: Package notify
Thiết kế xoay quanh một interface duy nhất:
```go
// internal/notify/notify.go
// Package notify gửi thông báo khi monitor sập hoặc hồi phục.
package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

// Event là một việc đáng báo: monitor vừa sập hoặc vừa hồi phục.
type Event struct {
	Kind     string // "down" hoặc "up"
	Monitor  monitor.Monitor
	Incident monitor.Incident
}

// Message là nội dung ngắn gọn cho người đọc.
func (e Event) Message() string {
	switch e.Kind {
	case "down":
		return fmt.Sprintf("🔴 %s đang DOWN\n%s\nLý do: %s", e.Monitor.Name, e.Monitor.URL, e.Incident.Cause)
	case "up":
		return fmt.Sprintf("🟢 %s đã hoạt động lại\n%s\nSập trong: %s", e.Monitor.Name, e.Monitor.URL, e.Incident.Duration())
	}
	return ""
}

// Notifier gửi Event đi đâu đó: Telegram, webhook, log...
type Notifier interface {
	Notify(ctx context.Context, e Event) error
}

// Multi gửi tới nhiều Notifier, gom lỗi của tất cả.
type Multi []Notifier

func (m Multi) Notify(ctx context.Context, e Event) error {
	var errs []error
	for _, n := range m {
		if err := n.Notify(ctx, e); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Log chỉ in ra log. Dùng khi chưa cấu hình kênh nào.
type Log struct{}

func (Log) Notify(ctx context.Context, e Event) error {
	slog.Warn("thông báo", "kind", e.Kind, "monitor", e.Monitor.Name, "url", e.Monitor.URL)
	return nil
}

// Retry bọc một Notifier, gửi lại khi lỗi với thời gian chờ tăng dần: 1s, 2s, 4s...
type Retry struct {
	Notifier Notifier
	Attempts int
	Base     time.Duration
}

func (r Retry) Notify(ctx context.Context, e Event) error {
	var err error
	for i := range r.Attempts {
		if err = r.Notifier.Notify(ctx, e); err == nil {
			return nil
		}
		wait := r.Base * (1 << i) // 1<<i là 2 mũ i
		slog.Warn("gửi thông báo lỗi, thử lại", "attempt", i+1, "wait", wait, "error", err)
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return fmt.Errorf("bỏ cuộc sau %d lần: %w", r.Attempts, err)
}
```
Ba kiểu trong file này đều thỏa <mark>Notifier</mark>, nhưng không kiểu nào thực sự "gửi" đi đâu. Chúng **bọc** các Notifier khác:
- <mark>Multi</mark> là một slice của Notifier có phương thức. Go cho phép định nghĩa phương thức trên bất kỳ kiểu tên nào, kể cả slice. Nó gửi tới từng kênh, và dù một kênh lỗi vẫn gửi tiếp các kênh còn lại. <mark>errors.Join</mark> gộp nhiều lỗi thành một (nil nếu không có lỗi nào); <mark>errors.Is</mark> vẫn tìm được từng lỗi bên trong.
- <mark>Retry</mark> gọi lại khi lỗi. Lần thứ <mark>i</mark> chờ <mark>Base × 2ⁱ</mark>: 1s, 2s, 4s. <mark>1 << i</mark> là dịch bit trái, bằng 2 mũ i, cách viết lũy thừa 2 thông dụng trong Go vì <mark>math.Pow</mark> làm việc với float. Chờ bằng <mark>select</mark> giữa <mark>time.After</mark> và <mark>ctx.Done()</mark> để khi tắt server không phải chờ hết 4 giây.
- <mark>Log</mark> dùng khi chưa cấu hình kênh nào, để code gọi không phải kiểm tra nil.

Mẫu này gọi là **decorator**: <mark>Retry{Multi{Telegram, Webhook}}</mark> là một Notifier gửi tới hai kênh và thử lại ba lần, mà không kiểu nào biết về kiểu nào. Muốn thêm kênh Slack, viết một struct mới có <mark>Notify</mark>, nhét vào <mark>Multi</mark>, xong.

Chờ tăng dần (exponential backoff) là cách lịch sự với dịch vụ bên kia: nếu Telegram đang quá tải mà 1.000 server cùng gửi lại ngay lập tức, nó càng quá tải. Cùng ý tưởng với retry trong message broker ở bài 080.

#### Bước 4: Telegram và webhook
Tạo bot: mở Telegram, chat với <mark>@BotFather</mark>, gõ <mark>/newbot</mark>, đặt tên, nhận **token** dạng <mark>123456:ABC-DEF...</mark>. Lấy **chat id**: nhắn một tin bất kỳ cho bot vừa tạo, rồi mở <mark>https://api.telegram.org/bot&lt;token&gt;/getUpdates</mark> trên trình duyệt, tìm <mark>"chat":{"id":...}</mark>. Muốn báo vào nhóm thì thêm bot vào nhóm và làm tương tự, chat id của nhóm là số âm.
```go
// internal/notify/telegram.go
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Telegram gửi tin nhắn qua Bot API. Tạo bot bằng @BotFather để lấy token.
type Telegram struct {
	Token  string
	ChatID string
	Client *http.Client
}

func NewTelegram(token, chatID string) *Telegram {
	return &Telegram{Token: token, ChatID: chatID, Client: &http.Client{Timeout: 10 * time.Second}}
}

func (t *Telegram) Notify(ctx context.Context, e Event) error {
	return t.send(ctx, "https://api.telegram.org/bot"+t.Token+"/sendMessage", e.Message())
}

// send tách riêng để test được bằng server giả (truyền URL khác).
func (t *Telegram) send(ctx context.Context, url, text string) error {
	body, _ := json.Marshal(map[string]string{"chat_id": t.ChatID, "text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.Client.Do(req)
	if err != nil {
		return fmt.Errorf("telegram: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("telegram: HTTP %d: %s", resp.StatusCode, msg)
	}
	return nil
}
```
Đây là khuôn mẫu gọi API bên thứ ba, bạn sẽ dùng lại mãi:
1. **Client có timeout.** <mark>http.Client{}</mark> mặc định chờ vô hạn; một API treo sẽ treo luôn goroutine của bạn (bài 150 đã nhắc).
2. **Request gắn context** để hủy được khi server tắt.
3. **Body là JSON** từ <mark>json.Marshal</mark>, đặt <mark>Content-Type</mark>. <mark>bytes.NewReader</mark> biến <mark>[]byte</mark> thành <mark>io.Reader</mark> mà request cần.
4. **Luôn <mark>defer resp.Body.Close()</mark>** sau khi có <mark>resp</mark>, kể cả khi không đọc body, nếu không kết nối không được trả về pool.
5. **Kiểm tra mã HTTP**: <mark>Do</mark> chỉ trả lỗi khi không gửi được, còn 400 hay 500 vẫn là "thành công" với nó. Đọc body lỗi để đưa vào thông báo, nhưng **giới hạn** bằng <mark>io.LimitReader</mark> 1KB, phòng khi bên kia trả cả trang HTML lỗi dài 5MB.

<mark>send</mark> tách khỏi <mark>Notify</mark> với tham số <mark>url</mark> chỉ vì một lý do: test. Test không thể gọi api.telegram.org thật (cần token, cần mạng, chậm, và spam người nhận), nên nó truyền URL của một <mark>httptest.Server</mark> giả.
```go
// internal/notify/webhook.go
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Webhook POST JSON tới một URL bất kỳ: Slack, Discord, hệ thống nội bộ...
type Webhook struct {
	URL    string
	Client *http.Client
}

func NewWebhook(url string) *Webhook {
	return &Webhook{URL: url, Client: &http.Client{Timeout: 10 * time.Second}}
}

func (w *Webhook) Notify(ctx context.Context, e Event) error {
	payload := map[string]any{
		"kind":     e.Kind,
		"message":  e.Message(),
		"monitor":  e.Monitor,
		"incident": e.Incident,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.Client.Do(req)
	if err != nil {
		return fmt.Errorf("webhook: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook: HTTP %d", resp.StatusCode)
	}
	return nil
}
```
Webhook là "kênh vạn năng": bên nhận tự quyết định làm gì với JSON. <mark>map[string]any</mark> là cách nhanh để dựng JSON có cấu trúc lồng nhau mà không khai báo struct; <mark>e.Monitor</mark> và <mark>e.Incident</mark> được encode theo tag json của chúng (và <mark>UserID</mark> bị ẩn nhờ <mark>json:"-"</mark>). Nếu bạn là **bên nhận** webhook, bài 093 nói về ký HMAC và chống replay; Pulse chưa ký, bài tập cuối bài sẽ làm.

#### Bước 5: Test notify bằng server giả
```go
// internal/notify/notify_test.go
package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

var sampleEvent = Event{
	Kind:     "down",
	Monitor:  monitor.Monitor{Name: "Shop", URL: "https://shop.vn"},
	Incident: monitor.Incident{Cause: "HTTP 503"},
}

func TestTelegramSend(t *testing.T) {
	var got map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&got)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	tg := NewTelegram("token", "123")
	if err := tg.send(context.Background(), srv.URL, sampleEvent.Message()); err != nil {
		t.Fatal(err)
	}
	if got["chat_id"] != "123" {
		t.Errorf("chat_id = %q", got["chat_id"])
	}
	if got["text"] == "" {
		t.Error("text trống")
	}
}

func TestWebhookError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	}))
	defer srv.Close()

	err := NewWebhook(srv.URL).Notify(context.Background(), sampleEvent)
	if err == nil {
		t.Fatal("HTTP 502 phải trả lỗi")
	}
}

// flaky lỗi n lần đầu rồi mới thành công.
type flaky struct{ fails, calls int }

func (f *flaky) Notify(ctx context.Context, e Event) error {
	f.calls++
	if f.calls <= f.fails {
		return errors.New("tạm thời lỗi")
	}
	return nil
}

func TestRetry(t *testing.T) {
	f := &flaky{fails: 2}
	r := Retry{Notifier: f, Attempts: 3, Base: time.Millisecond}
	if err := r.Notify(context.Background(), sampleEvent); err != nil {
		t.Fatalf("phải thành công ở lần 3, nhận: %v", err)
	}
	if f.calls != 3 {
		t.Errorf("gọi %d lần, muốn 3", f.calls)
	}

	f = &flaky{fails: 10}
	r = Retry{Notifier: f, Attempts: 2, Base: time.Millisecond}
	if err := r.Notify(context.Background(), sampleEvent); err == nil {
		t.Error("lỗi mãi thì phải bỏ cuộc")
	}
}
```
<mark>httptest.NewServer</mark> (bài 153) đóng vai Telegram: nhận request, giải mã body vào <mark>got</mark> để test kiểm tra. <mark>flaky</mark> là một Notifier giả "lỗi 2 lần đầu rồi mới được", 5 dòng, đủ để chứng minh <mark>Retry</mark> gọi đúng 3 lần và bỏ cuộc khi hết lượt. <mark>Base: time.Millisecond</mark> để test không phải chờ thật 1+2+4 giây. Test cùng package (<mark>package notify</mark>) nên gọi được hàm không xuất khẩu <mark>send</mark>.

#### Bước 6: Detector
```go
// internal/incident/detector.go
// Package incident quyết định khi nào một monitor được coi là "sập" và "hồi phục".
package incident

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/monitor"
	"github.com/thachnguyenp/pulse/internal/notify"
)

// Store là những gì detector cần từ database.
type Store interface {
	// RecordFailure tăng số lần lỗi liên tiếp và trả về số mới.
	RecordFailure(ctx context.Context, monitorID int64) (int, error)
	// ResetFailures đưa số lần lỗi liên tiếp về 0.
	ResetFailures(ctx context.Context, monitorID int64) error
	// OpenIncident mở sự cố mới. Trả về ok=false nếu đã có sự cố đang mở.
	OpenIncident(ctx context.Context, monitorID int64, cause string) (monitor.Incident, bool, error)
	// ResolveIncident đóng sự cố đang mở. Trả về ok=false nếu không có sự cố nào.
	ResolveIncident(ctx context.Context, monitorID int64) (monitor.Incident, bool, error)
}

// Detector xem từng kết quả kiểm tra và quyết định có báo động không.
type Detector struct {
	store     Store
	notifier  notify.Notifier
	threshold int // số lần down liên tiếp mới coi là sự cố
}

func New(store Store, notifier notify.Notifier, threshold int) *Detector {
	return &Detector{store: store, notifier: notifier, threshold: threshold}
}

// Handle được scheduler gọi sau mỗi lần kiểm tra.
func (d *Detector) Handle(ctx context.Context, m monitor.Monitor, c monitor.Check) error {
	if c.Status == checker.StatusUp {
		return d.handleUp(ctx, m)
	}
	return d.handleDown(ctx, m, c)
}

func (d *Detector) handleDown(ctx context.Context, m monitor.Monitor, c monitor.Check) error {
	failures, err := d.store.RecordFailure(ctx, m.ID)
	if err != nil {
		return err
	}
	// Một lần lỗi lẻ có thể do mạng chập chờn. Đủ ngưỡng mới báo.
	if failures < d.threshold {
		return nil
	}
	inc, opened, err := d.store.OpenIncident(ctx, m.ID, c.Error)
	if err != nil || !opened {
		return err // đã có sự cố đang mở thì không báo lại
	}
	slog.Warn("monitor sập", "monitor", m.ID, "name", m.Name, "cause", c.Error)
	return d.notify(ctx, notify.Event{Kind: "down", Monitor: m, Incident: inc})
}

func (d *Detector) handleUp(ctx context.Context, m monitor.Monitor) error {
	if err := d.store.ResetFailures(ctx, m.ID); err != nil {
		return err
	}
	inc, resolved, err := d.store.ResolveIncident(ctx, m.ID)
	if err != nil || !resolved {
		return err // không có sự cố nào đang mở, up là chuyện bình thường
	}
	slog.Info("monitor hồi phục", "monitor", m.ID, "name", m.Name, "downtime", inc.Duration())
	return d.notify(ctx, notify.Event{Kind: "up", Monitor: m, Incident: inc})
}

func (d *Detector) notify(ctx context.Context, e notify.Event) error {
	if err := d.notifier.Notify(ctx, e); err != nil {
		return fmt.Errorf("gửi thông báo: %w", err)
	}
	return nil
}
```
Giống scheduler, detector khai báo interface <mark>Store</mark> của riêng nó với đúng 4 việc cần. Mỗi phương thức trả về <mark>(Incident, bool, error)</mark>: <mark>bool</mark> cho biết "có mở/đóng được không", tách khỏi <mark>error</mark> là "có gì hỏng không". Đã có sự cố mở thì <mark>OpenIncident</mark> trả <mark>false, nil</mark>: không phải lỗi, chỉ là không có gì mới. Dòng <mark>if err != nil || !opened { return err }</mark> xử lý cả hai trường hợp trong một câu (khi <mark>!opened</mark> thì <mark>err</mark> là nil).

Toàn bộ logic nghiệp vụ nằm trong 30 dòng không đụng database, không đụng mạng. Đó là lý do nó test được dễ dàng:
```go
// internal/incident/detector_test.go
package incident

import (
	"context"
	"testing"

	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/monitor"
	"github.com/thachnguyenp/pulse/internal/notify"
)

// fakeStore giữ mọi thứ trong bộ nhớ, đủ để test logic của Detector.
type fakeStore struct {
	failures int
	open     *monitor.Incident
}

func (f *fakeStore) RecordFailure(ctx context.Context, id int64) (int, error) {
	f.failures++
	return f.failures, nil
}
func (f *fakeStore) ResetFailures(ctx context.Context, id int64) error { f.failures = 0; return nil }
func (f *fakeStore) OpenIncident(ctx context.Context, id int64, cause string) (monitor.Incident, bool, error) {
	if f.open != nil {
		return *f.open, false, nil
	}
	f.open = &monitor.Incident{ID: 1, MonitorID: id, Cause: cause}
	return *f.open, true, nil
}
func (f *fakeStore) ResolveIncident(ctx context.Context, id int64) (monitor.Incident, bool, error) {
	if f.open == nil {
		return monitor.Incident{}, false, nil
	}
	inc := *f.open
	f.open = nil
	return inc, true, nil
}

// recorder ghi lại các Event đã nhận.
type recorder struct{ events []notify.Event }

func (r *recorder) Notify(ctx context.Context, e notify.Event) error {
	r.events = append(r.events, e)
	return nil
}

func TestDetector(t *testing.T) {
	store := &fakeStore{}
	rec := &recorder{}
	d := New(store, rec, 3)
	m := monitor.Monitor{ID: 1, Name: "Shop"}
	ctx := context.Background()

	down := monitor.Check{Status: checker.StatusDown, Error: "HTTP 503"}
	up := monitor.Check{Status: checker.StatusUp}

	// 2 lần down: chưa đủ ngưỡng, im lặng.
	d.Handle(ctx, m, down)
	d.Handle(ctx, m, down)
	if len(rec.events) != 0 {
		t.Fatalf("chưa đủ 3 lần mà đã báo: %+v", rec.events)
	}

	// Lần 3: mở sự cố, báo "down".
	d.Handle(ctx, m, down)
	if len(rec.events) != 1 || rec.events[0].Kind != "down" {
		t.Fatalf("muốn 1 event down, nhận %+v", rec.events)
	}

	// Vẫn down tiếp: không báo lại.
	d.Handle(ctx, m, down)
	if len(rec.events) != 1 {
		t.Fatalf("down tiếp không được báo lại, nhận %d event", len(rec.events))
	}

	// Up: đóng sự cố, báo "up".
	d.Handle(ctx, m, up)
	if len(rec.events) != 2 || rec.events[1].Kind != "up" {
		t.Fatalf("muốn event up, nhận %+v", rec.events)
	}

	// Up tiếp: không có gì để báo.
	d.Handle(ctx, m, up)
	if len(rec.events) != 2 {
		t.Error("up khi không có sự cố thì không báo")
	}
}
```
<mark>fakeStore</mark> thay PostgreSQL bằng hai biến, <mark>recorder</mark> thay Telegram bằng một slice. Test kể lại đúng kịch bản ở đầu bài: down, down, im lặng; down thứ ba, báo; down tiếp, im; up, báo; up tiếp, im. Chạy trong vài mili giây, không cần Docker, không cần mạng. Đây là phần thưởng của việc kiên trì dùng interface nhỏ: ở bài 161 ta sẽ áp dụng cùng cách cho toàn bộ API.

#### Bước 7: Store cho sự cố
```go
// internal/store/incidents.go
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

func (s *Monitors) RecordFailure(ctx context.Context, monitorID int64) (int, error) {
	var failures int
	err := s.db.pool.QueryRow(ctx, `
		UPDATE monitors SET failures = failures + 1 WHERE id = $1 RETURNING failures`, monitorID,
	).Scan(&failures)
	return failures, err
}

func (s *Monitors) ResetFailures(ctx context.Context, monitorID int64) error {
	_, err := s.db.pool.Exec(ctx, `UPDATE monitors SET failures = 0 WHERE id = $1 AND failures <> 0`, monitorID)
	return err
}

// OpenIncident mở sự cố mới. Nhờ unique index "mỗi monitor một sự cố mở",
// ON CONFLICT DO NOTHING làm câu lệnh không trả dòng nào nếu đã có sự cố.
func (s *Monitors) OpenIncident(ctx context.Context, monitorID int64, cause string) (monitor.Incident, bool, error) {
	var inc monitor.Incident
	err := s.db.pool.QueryRow(ctx, `
		INSERT INTO incidents (monitor_id, cause)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
		RETURNING id, monitor_id, cause, started_at, resolved_at`, monitorID, cause,
	).Scan(&inc.ID, &inc.MonitorID, &inc.Cause, &inc.StartedAt, &inc.ResolvedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return monitor.Incident{}, false, nil
	}
	return inc, err == nil, err
}

func (s *Monitors) ResolveIncident(ctx context.Context, monitorID int64) (monitor.Incident, bool, error) {
	var inc monitor.Incident
	err := s.db.pool.QueryRow(ctx, `
		UPDATE incidents SET resolved_at = now()
		WHERE monitor_id = $1 AND resolved_at IS NULL
		RETURNING id, monitor_id, cause, started_at, resolved_at`, monitorID,
	).Scan(&inc.ID, &inc.MonitorID, &inc.Cause, &inc.StartedAt, &inc.ResolvedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return monitor.Incident{}, false, nil
	}
	return inc, err == nil, err
}

func (s *Monitors) ListIncidents(ctx context.Context, monitorID int64, limit int) ([]monitor.Incident, error) {
	rows, err := s.db.pool.Query(ctx, `
		SELECT id, monitor_id, cause, started_at, resolved_at
		FROM incidents
		WHERE monitor_id = $1
		ORDER BY started_at DESC
		LIMIT $2`, monitorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []monitor.Incident{}
	for rows.Next() {
		var inc monitor.Incident
		if err := rows.Scan(&inc.ID, &inc.MonitorID, &inc.Cause, &inc.StartedAt, &inc.ResolvedAt); err != nil {
			return nil, err
		}
		list = append(list, inc)
	}
	return list, rows.Err()
}
```
Mỗi hàm là **một câu SQL nguyên tử**, không có "đọc rồi ghi":
- <mark>RecordFailure</mark>: <mark>failures = failures + 1 ... RETURNING</mark>. Hai bản pulsed cùng tăng thì database xếp hàng cho chúng, không mất lượt (bài 081 gọi đây là atomic update).
- <mark>OpenIncident</mark>: <mark>INSERT ... ON CONFLICT DO NOTHING RETURNING</mark>. Đụng unique index (đã có sự cố mở) thì không chèn và **không trả dòng nào**, pgx báo <mark>ErrNoRows</mark>, ta đổi thành <mark>false, nil</mark>. Không cần SELECT trước, không có cửa cho race.
- <mark>ResolveIncident</mark>: <mark>UPDATE ... WHERE resolved_at IS NULL RETURNING</mark>, cùng mẫu.
- <mark>ResetFailures</mark> có <mark>AND failures <> 0</mark> để không ghi database mỗi lần up (99% số lần kiểm tra là up, và ghi là tốn hơn đọc nhiều).

<mark>return inc, err == nil, err</mark> là cách viết gọn: thành công thì <mark>(inc, true, nil)</mark>, lỗi khác thì <mark>(inc rỗng, false, err)</mark>.

#### Bước 8: Nối vào scheduler và main
Scheduler cần gọi detector sau mỗi lần lưu kết quả, nhưng scheduler **không nên biết** detector là gì. Thêm interface <mark>Handler</mark> vào <mark>internal/scheduler/scheduler.go</mark>, <mark>New</mark> nhận thêm tham số <mark>handler Handler</mark>, và cuối <mark>runOne</mark>:
```go
// internal/scheduler/scheduler.go (thêm)
// Handler nhận kết quả sau khi đã lưu, ví dụ để phát hiện sự cố.
type Handler interface {
	Handle(ctx context.Context, m monitor.Monitor, c monitor.Check) error
}

// cuối runOne, sau log "đã kiểm tra":
	if err := s.handler.Handle(saveCtx, m, c); err != nil {
		slog.Error("xử lý kết quả lỗi", "monitor", m.ID, "error", err)
	}
```
Lỗi của handler chỉ ghi log: gửi Telegram thất bại không được làm hỏng việc kiểm tra. Dùng <mark>saveCtx</mark> (không bị hủy khi tắt, có timeout) để thông báo cuối cùng vẫn kịp đi.

Config thêm <mark>DownThreshold</mark> (mặc định 3, đọc <mark>DOWN_THRESHOLD</mark>), <mark>TelegramToken</mark>, <mark>TelegramChat</mark>, <mark>WebhookURL</mark>, tất cả đọc thẳng bằng <mark>os.Getenv</mark>, để trống nếu không dùng. Trong <mark>cmd/pulsed/main.go</mark>:
```go
// cmd/pulsed/main.go (thêm)
	detector := incident.New(monitors, buildNotifier(cfg), cfg.DownThreshold)
	sched := scheduler.New(monitors, chk, detector, cfg.Workers)
```
```go
// cmd/pulsed/main.go (thêm)
// buildNotifier ghép các kênh đã cấu hình. Không có kênh nào thì chỉ ghi log.
func buildNotifier(cfg config.Config) notify.Notifier {
	var channels notify.Multi
	if cfg.TelegramToken != "" && cfg.TelegramChat != "" {
		channels = append(channels, notify.NewTelegram(cfg.TelegramToken, cfg.TelegramChat))
	}
	if cfg.WebhookURL != "" {
		channels = append(channels, notify.NewWebhook(cfg.WebhookURL))
	}
	if len(channels) == 0 {
		slog.Warn("chưa cấu hình TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID hay WEBHOOK_URL, thông báo chỉ ghi log")
		return notify.Log{}
	}
	return notify.Retry{Notifier: channels, Attempts: 3, Base: time.Second}
}
```
Thêm handler <mark>listIncidents</mark> (giống <mark>listChecks</mark>, limit cố định 50) và route <mark>protected("GET /monitors/{id}/incidents", s.listIncidents)</mark>. Cuối cùng thêm vào <mark>.env.example</mark>:
```sh
DOWN_THRESHOLD=3
# Thông báo: để trống kênh nào không dùng
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
WEBHOOK_URL=
```

#### Bước 9: Một công tắc trong fakeweb
Để thử kịch bản sập rồi hồi phục, fakeweb cần một trang bật tắt được. Thêm vào <mark>cmd/fakeweb/main.go</mark>, import thêm <mark>sync/atomic</mark>:
```go
// cmd/fakeweb/main.go (thêm)
	// /maybe sống hay chết tùy bạn bật tắt: curl -X POST localhost:8080/maybe/off
	var alive atomic.Bool
	alive.Store(true)
	http.HandleFunc("/maybe", func(w http.ResponseWriter, r *http.Request) {
		if !alive.Load() {
			http.Error(w, "đang sập", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	http.HandleFunc("POST /maybe/on", func(w http.ResponseWriter, r *http.Request) {
		alive.Store(true)
		fmt.Fprintln(w, "/maybe đã bật")
	})
	http.HandleFunc("POST /maybe/off", func(w http.ResponseWriter, r *http.Request) {
		alive.Store(false)
		fmt.Fprintln(w, "/maybe đã tắt")
	})
```
Biến <mark>alive</mark> được nhiều goroutine (mỗi request một goroutine) đọc và ghi cùng lúc. Một <mark>bool</mark> thường sẽ bị race detector bắt (bài 152). <mark>atomic.Bool</mark> là kiểu có <mark>Load</mark>/<mark>Store</mark> an toàn mà không cần mutex, phù hợp cho một giá trị đơn lẻ như cờ bật tắt hay bộ đếm. Mutex vẫn cần khi phải bảo vệ **nhiều** giá trị cùng lúc hoặc một thao tác gồm nhiều bước.

#### Chạy thử
Để xem webhook đến thật, dựng một server nhận tạm, ví dụ 5 dòng Python ghi body ra file, hoặc dùng webhook.site. Chạy pulsed với ngưỡng thấp để đỡ chờ:
```sh
WEBHOOK_URL=http://127.0.0.1:9999/hook DOWN_THRESHOLD=2 go run ./cmd/pulsed
```
Tạo monitor trỏ vào <mark>/maybe</mark> chu kỳ 10 giây (nhớ token của bài 157), rồi tắt nó:
```sh
curl -H "Authorization: Bearer $TOKEN" -X POST localhost:3000/monitors -d '{"name":"Maybe","url":"http://localhost:8080/maybe","interval_seconds":10}'
curl -X POST localhost:8080/maybe/off
```
Sau hai lần kiểm tra down (khoảng 20 giây), pulsed log <mark>WARN monitor sập monitor=6 name=Maybe cause="HTTP 503 Service Unavailable"</mark> và API có sự cố đang mở:
```sh
curl -H "Authorization: Bearer $TOKEN" localhost:3000/monitors/6/incidents
```
```json
[{"id":2,"monitor_id":6,"cause":"HTTP 503 Service Unavailable","started_at":"2026-11-04T23:30:32.109727+07:00","resolved_at":null}]
```
Bật lại và chờ một chu kỳ:
```sh
curl -X POST localhost:8080/maybe/on
```
```
INFO monitor hồi phục monitor=6 name=Maybe downtime=10s
```
```json
[{"id":2,"monitor_id":6,"cause":"HTTP 503 Service Unavailable","started_at":"2026-11-04T23:30:32.109727+07:00","resolved_at":"2026-11-04T23:30:42.110536+07:00"}]
```
Và server nhận webhook ghi được hai gói JSON, một "down" một "up":
```json
{"incident":{"id":2,"monitor_id":6,"cause":"HTTP 503 Service Unavailable","started_at":"2026-11-04T23:30:32.109727+07:00","resolved_at":null},"kind":"down","message":"🔴 Maybe đang DOWN\nhttp://localhost:8080/maybe\nLý do: HTTP 503 Service Unavailable","monitor":{"id":6,"name":"Maybe",...}}
```
Nếu cấu hình Telegram, tin nhắn tới điện thoại có nội dung đúng như <mark>Message()</mark>. Và test:
```sh
go test ./internal/notify/ ./internal/incident/
ok  	github.com/thachnguyenp/pulse/internal/notify	1.094s
ok  	github.com/thachnguyenp/pulse/internal/incident	0.583s
```

#### Mẹo và lỗi hay gặp
- **Token Telegram trong log.** URL gọi API chứa token; nếu bạn log cả URL lúc lỗi, token nằm trong log. <mark>send</mark> chỉ đưa mã HTTP và body vào lỗi, không đưa URL. Thói quen: coi mọi thứ trong log là công khai.
- **Ngưỡng và chu kỳ đi cùng nhau.** Chu kỳ 60 giây, ngưỡng 3 nghĩa là sớm nhất 2 phút sau khi sập bạn mới biết. Muốn biết nhanh hơn thì giảm chu kỳ, đừng hạ ngưỡng xuống 1.
- **Hai bản pulsed, một thông báo.** Nhờ unique index, chỉ bản nào chèn được sự cố mới gửi thông báo. Thử chạy hai bản và tắt <mark>/maybe</mark>: chỉ một tin nhắn.
- **<mark>errors.Join</mark> với một lỗi** trả về lỗi bọc, không phải lỗi gốc; dùng <mark>errors.Is</mark>/<mark>As</mark> để kiểm tra, đừng so sánh <mark>==</mark>.
- **Thông báo bị mất khi cả 3 lần đều lỗi.** Pulse chấp nhận điều này và ghi log. Hệ thống cần "không bao giờ mất" thì lưu thông báo vào bảng <mark>outbox</mark> rồi có worker gửi, giống mẫu ở bài 078.

#### Checklist
- Tắt <mark>/maybe</mark>: không có gì xảy ra sau lần down đầu; đủ ngưỡng mới có log "monitor sập" và một sự cố với <mark>resolved_at: null</mark>.
- Vẫn tắt tiếp: không có sự cố thứ hai, không thông báo thêm.
- Bật lại: sự cố có <mark>resolved_at</mark>, log "hồi phục" kèm <mark>downtime</mark>.
- Trỏ <mark>WEBHOOK_URL</mark> vào cổng không ai nghe: log "gửi thông báo lỗi, thử lại" với wait 1s, 2s, 4s rồi "bỏ cuộc sau 3 lần", nhưng kiểm tra vẫn chạy bình thường.
- Không cấu hình kênh nào: log WARN lúc khởi động và thông báo chỉ là một dòng log.
- <mark>go test ./...</mark> xanh.

Mã nguồn cuối bài: [post_158.zip](/assets/code/post_158.zip).

#### Bài tập thêm
- Thêm kênh Discord hoặc Slack (cả hai đều là webhook với JSON dạng <mark>{"content": ...}</mark> hoặc <mark>{"text": ...}</mark>): một struct mới, một phương thức <mark>Notify</mark>.
- Ký webhook: tính HMAC-SHA256 của body với một khóa bí mật, gửi trong header <mark>X-Pulse-Signature</mark>, theo đúng cách bài 093 mô tả cho bên nhận.
- Mỗi user có <mark>telegram_chat_id</mark> riêng trong bảng <mark>users</mark>, để thông báo tới đúng chủ monitor thay vì một chat chung. Gợi ý: <mark>Event</mark> đã có <mark>Monitor.UserID</mark>.
