---
layout: post
title:  "156. Go cho người mới (Bài 7: Worker chạy nền & Scheduler)."
date:   2026-11-04 14:00:00 +0700
author: thach
categories: [ Coding, Golang]
image: assets/images/post_156/go-scheduler.png
---
Tới bài 155, pulsed đã lưu được monitor vào PostgreSQL, nhưng nó chỉ kiểm tra khi có người gọi <mark>POST /monitors/{id}/check</mark>. Một hệ thống giám sát mà phải có người ngồi bấm thì vô nghĩa. Bài này làm phần quan trọng nhất của Pulse: một **scheduler chạy nền**, cứ tới giờ là tự kiểm tra từng monitor, lưu kết quả vào bảng <mark>checks</mark>, rồi tính uptime và độ trễ trung bình. Qua đó học <mark>time.Ticker</mark>, giới hạn số goroutine bằng semaphore, <mark>errgroup</mark> để quản lý nhiều việc chạy song song, transaction trong pgx, và mẫu "claim" với <mark>FOR UPDATE SKIP LOCKED</mark> để chạy nhiều bản pulsed mà không kiểm tra trùng.

#### Việc chạy nền trong Go khác Rails ở đâu
Ở Rails (bài 103), muốn có việc chạy nền bạn cần thêm **một process khác** (Sidekiq, Solid Queue) và thường thêm Redis để hai bên nói chuyện. Lý do là Ruby có GVL: một process chỉ chạy được một thread Ruby tại một thời điểm, nên web server và worker phải tách ra.

Go không có giới hạn đó. Goroutine rẻ, chạy song song thật trên nhiều core, nên **scheduler và HTTP server có thể sống chung trong một process**: một goroutine lắng nghe HTTP, một goroutine khác cứ mỗi giây hỏi database "có monitor nào tới giờ chưa". Không cần Redis, không cần process thứ hai, deploy một binary duy nhất. Khi hệ thống lớn, bạn vẫn có thể tách ra sau, nhưng với đa số dịch vụ nhỏ và vừa, cách này là đủ và đơn giản nhất.

| | Rails + Sidekiq | Go |
|---|---|---|
| Process | Web + worker riêng | Một process |
| Hàng đợi | Redis | Bảng <mark>monitors</mark> với cột <mark>next_check_at</mark> |
| Chạy nhiều bản | Sidekiq tự chia việc | <mark>FOR UPDATE SKIP LOCKED</mark> |
| Tắt an toàn | Sidekiq chờ job xong | <mark>WaitGroup</mark> + <mark>context</mark> |

#### Thiết kế
Mỗi monitor có thêm cột <mark>next_check_at</mark>: thời điểm cần kiểm tra lần tới. Scheduler lặp vô hạn:
1. Mỗi giây, lấy những monitor có <mark>next_check_at <= now()</mark> và **dời lịch của chúng ngay trong cùng câu lệnh** (claim).
2. Với mỗi monitor lấy được, mở một goroutine gọi <mark>checker.Check</mark> (bài 153), tối đa <mark>WORKERS</mark> goroutine cùng lúc.
3. Lưu kết quả vào bảng <mark>checks</mark> và cập nhật <mark>last_status</mark> của monitor.

Vì "lấy" và "dời lịch" là một câu <mark>UPDATE</mark> duy nhất, một monitor không bao giờ bị lấy hai lần, kể cả khi bạn chạy 3 bản pulsed trên 3 máy.

#### Bước 1: Migration
```sql
-- internal/store/migrations/00002_create_checks.sql
-- +goose Up
ALTER TABLE monitors
    ADD COLUMN last_status   TEXT        NOT NULL DEFAULT 'pending',
    ADD COLUMN next_check_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE checks (
    id          BIGSERIAL PRIMARY KEY,
    monitor_id  BIGINT      NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status      TEXT        NOT NULL,
    status_code INTEGER     NOT NULL DEFAULT 0,
    latency_ms  INTEGER     NOT NULL DEFAULT 0,
    error       TEXT        NOT NULL DEFAULT '',
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX checks_monitor_id_checked_at_idx ON checks (monitor_id, checked_at DESC);

-- +goose Down
DROP TABLE checks;
ALTER TABLE monitors DROP COLUMN last_status, DROP COLUMN next_check_at;
```
Vài điểm:
- <mark>next_check_at DEFAULT now()</mark>: monitor vừa tạo là tới giờ ngay, người dùng không phải chờ tới 60 giây mới thấy kết quả đầu tiên.
- <mark>ON DELETE CASCADE</mark>: xóa monitor thì lịch sử kiểm tra đi theo, không cần code Go lo.
- Index trên <mark>(monitor_id, checked_at DESC)</mark>: mọi truy vấn sau này đều là "các lần kiểm tra của monitor X, mới nhất trước" hoặc "của monitor X trong 24 giờ qua". Bài 111 đã nói vì sao index nhiều cột phải đúng thứ tự.

Goose thấy file <mark>00002</mark> chưa chạy sẽ tự chạy khi pulsed khởi động, như bài 155.

#### Bước 2: Kiểu dữ liệu mới
Thêm vào <mark>internal/monitor/monitor.go</mark>: hai cột mới của <mark>Monitor</mark>, kiểu <mark>Check</mark> (một dòng trong bảng checks), <mark>Stats</mark> (số liệu tổng hợp), và mở rộng interface <mark>Store</mark>.
```go
// internal/monitor/monitor.go
// Package monitor định nghĩa "monitor": một URL cần theo dõi định kỳ.
package monitor

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/thachnguyenp/pulse/internal/checker"
)

// ErrNotFound trả về khi không có monitor với id đó.
var ErrNotFound = errors.New("monitor not found")

// Monitor là một URL cần kiểm tra mỗi Interval giây.
type Monitor struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	URL         string    `json:"url"`
	Interval    int       `json:"interval_seconds"`
	LastStatus  string    `json:"last_status"`
	NextCheckAt time.Time `json:"next_check_at"`
	CreatedAt   time.Time `json:"created_at"`
}

// Check là kết quả một lần kiểm tra, đã lưu vào database.
type Check struct {
	ID         int64          `json:"id"`
	MonitorID  int64          `json:"monitor_id"`
	Status     checker.Status `json:"status"`
	StatusCode int            `json:"status_code"`
	LatencyMS  int64          `json:"latency_ms"`
	Error      string         `json:"error,omitempty"`
	CheckedAt  time.Time      `json:"checked_at"`
}

// CheckFromResult chuyển kết quả của checker thành Check để lưu.
func CheckFromResult(monitorID int64, r checker.Result) Check {
	return Check{
		MonitorID:  monitorID,
		Status:     r.Status,
		StatusCode: r.StatusCode,
		LatencyMS:  r.LatencyMS,
		Error:      r.Error,
		CheckedAt:  r.CheckedAt,
	}
}

// Stats là số liệu tổng hợp của một monitor trong một khoảng thời gian.
type Stats struct {
	TotalChecks   int        `json:"total_checks"`
	UptimePercent float64    `json:"uptime_percent"`
	AvgLatencyMS  float64    `json:"avg_latency_ms"`
	LastCheckedAt *time.Time `json:"last_checked_at"`
}

// Validate kiểm tra dữ liệu người dùng gửi lên. Trả về map rỗng nếu hợp lệ.
func (m *Monitor) Validate() map[string]string {
	problems := map[string]string{}

	m.Name = strings.TrimSpace(m.Name)
	if m.Name == "" {
		problems["name"] = "không được để trống"
	} else if len(m.Name) > 100 {
		problems["name"] = "tối đa 100 ký tự"
	}

	m.URL = strings.TrimSpace(m.URL)
	u, err := url.ParseRequestURI(m.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		problems["url"] = "phải là URL đầy đủ, bắt đầu bằng http:// hoặc https://"
	}

	if m.Interval == 0 {
		m.Interval = 60
	}
	if m.Interval < 10 || m.Interval > 3600 {
		problems["interval_seconds"] = "từ 10 đến 3600 giây"
	}
	return problems
}

// Store là nơi lưu monitor và kết quả kiểm tra.
type Store interface {
	Create(ctx context.Context, m *Monitor) error
	List(ctx context.Context) ([]Monitor, error)
	Get(ctx context.Context, id int64) (Monitor, error)
	Delete(ctx context.Context, id int64) error

	SaveCheck(ctx context.Context, c *Check) error
	ListChecks(ctx context.Context, monitorID int64, limit int) ([]Check, error)
	Stats(ctx context.Context, monitorID int64, since time.Time) (Stats, error)
}
```
Hai chi tiết đáng chú ý:
- <mark>Check.Status</mark> dùng lại kiểu <mark>checker.Status</mark> của bài 153 thay vì khai báo <mark>string</mark> mới. Package <mark>monitor</mark> import <mark>checker</mark>, chứ không ngược lại: checker là lớp dưới, không biết gì về database.
- <mark>LastCheckedAt *time.Time</mark> là **con trỏ**, vì monitor chưa kiểm tra lần nào thì <mark>max(checked_at)</mark> trong SQL trả về NULL. Go không có null cho <mark>time.Time</mark>; con trỏ nil là cách biểu diễn "không có". Khi encode JSON, nil thành <mark>null</mark>.

<mark>CheckFromResult</mark> là hàm chuyển đổi nhỏ. Có thể bạn thấy thừa, nhưng nó là chỗ duy nhất biết <mark>Result</mark> và <mark>Check</mark> giống nhau ở đâu. Sau này thêm trường vào một bên, chỉ sửa một hàm.

#### Bước 3: Store với scanMonitor và ClaimDue
File <mark>internal/store/monitors.go</mark> được viết lại. Bây giờ <mark>Monitor</mark> có 7 cột, lặp lại danh sách cột và 7 lần <mark>Scan</mark> trong 4 hàm là mời gọi lỗi, nên gom vào một hằng và một hàm.
```go
// internal/store/monitors.go
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

const monitorColumns = `id, name, url, interval_seconds, last_status, next_check_at, created_at`

func scanMonitor(row pgx.Row) (monitor.Monitor, error) {
	var m monitor.Monitor
	err := row.Scan(&m.ID, &m.Name, &m.URL, &m.Interval, &m.LastStatus, &m.NextCheckAt, &m.CreatedAt)
	return m, err
}

func (s *Postgres) Create(ctx context.Context, m *monitor.Monitor) error {
	created, err := scanMonitor(s.pool.QueryRow(ctx, `
		INSERT INTO monitors (name, url, interval_seconds)
		VALUES ($1, $2, $3)
		RETURNING `+monitorColumns,
		m.Name, m.URL, m.Interval,
	))
	if err != nil {
		return err
	}
	*m = created
	return nil
}

func (s *Postgres) List(ctx context.Context) ([]monitor.Monitor, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+monitorColumns+` FROM monitors ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []monitor.Monitor{}
	for rows.Next() {
		m, err := scanMonitor(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

func (s *Postgres) Get(ctx context.Context, id int64) (monitor.Monitor, error) {
	m, err := scanMonitor(s.pool.QueryRow(ctx, `SELECT `+monitorColumns+` FROM monitors WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return monitor.Monitor{}, monitor.ErrNotFound
	}
	return m, err
}

func (s *Postgres) Delete(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM monitors WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return monitor.ErrNotFound
	}
	return nil
}

// ClaimDue lấy tối đa `limit` monitor đã tới giờ kiểm tra và dời lịch của chúng
// sang lần sau ngay trong cùng một câu lệnh. Nhờ FOR UPDATE SKIP LOCKED, nhiều
// pulsed chạy cùng lúc cũng không lấy trùng monitor.
func (s *Postgres) ClaimDue(ctx context.Context, limit int) ([]monitor.Monitor, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE monitors
		SET next_check_at = now() + interval_seconds * interval '1 second'
		WHERE id IN (
			SELECT id FROM monitors
			WHERE next_check_at <= now()
			ORDER BY next_check_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING `+monitorColumns, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []monitor.Monitor
	for rows.Next() {
		m, err := scanMonitor(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}
```
**<mark>scanMonitor</mark> nhận <mark>pgx.Row</mark>**, một interface chỉ có một phương thức <mark>Scan(dest ...any) error</mark>. Kết quả của <mark>QueryRow</mark> là <mark>pgx.Row</mark>, và <mark>pgx.Rows</mark> (kết quả của <mark>Query</mark>) cũng có <mark>Scan</mark> với đúng chữ ký đó, nên cũng thỏa interface. Vì thế một hàm dùng được cho cả "một dòng" lẫn "từng dòng trong vòng lặp". Đây chính là sức mạnh của interface ngầm định trong Go (bài 153): <mark>pgx.Rows</mark> không hề khai báo "tôi là pgx.Row", chỉ cần có đủ phương thức.

Trong <mark>Create</mark>, <mark>*m = created</mark> ghi đè toàn bộ struct mà con trỏ <mark>m</mark> trỏ tới: người gọi nhận được đầy đủ <mark>ID</mark>, <mark>LastStatus</mark>, <mark>NextCheckAt</mark>, <mark>CreatedAt</mark> do database sinh ra.

**<mark>ClaimDue</mark>** là trái tim của bài. Đọc từ trong ra ngoài:
1. Truy vấn con chọn tối đa <mark>limit</mark> monitor đã tới giờ, cũ nhất trước.
2. <mark>FOR UPDATE</mark> khóa các dòng đó trong transaction (bài 082 đã nói về pessimistic locking). <mark>SKIP LOCKED</mark> bảo PostgreSQL: dòng nào đang bị bản pulsed khác khóa thì **bỏ qua, lấy dòng khác**, đừng đứng chờ.
3. <mark>UPDATE</mark> dời <mark>next_check_at</mark> sang lần sau. <mark>interval_seconds * interval '1 second'</mark> là cách nhân một số nguyên với đơn vị thời gian trong PostgreSQL: 60 × 1 giây = 60 giây.
4. <mark>RETURNING</mark> trả về chính các dòng vừa cập nhật, nên lấy và dời lịch là **một câu lệnh, một transaction**.

Nếu chạy 2 bản pulsed, cả hai cùng hỏi mỗi giây. Bản A khóa 100 dòng đầu, bản B thấy khóa thì nhảy qua lấy 100 dòng tiếp. Không ai kiểm tra trùng, không cần Redis hay bất kỳ cơ chế điều phối nào ngoài PostgreSQL. Đây là mẫu "hàng đợi trong database" rất hay dùng, Solid Queue của Rails 8 cũng làm y hệt.

<mark>var list []monitor.Monitor</mark> (nil) thay vì <mark>[]monitor.Monitor{}</mark>: hàm này không bao giờ ra JSON, nên slice nil là đủ, và <mark>for range</mark> trên nil slice chạy bình thường, 0 vòng.

#### Bước 4: Lưu và đọc kết quả
```go
// internal/store/checks.go
package store

import (
	"context"
	"time"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

// SaveCheck lưu kết quả và cập nhật last_status của monitor trong cùng một transaction.
func (s *Postgres) SaveCheck(ctx context.Context, c *monitor.Check) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // không có tác dụng nếu đã Commit

	err = tx.QueryRow(ctx, `
		INSERT INTO checks (monitor_id, status, status_code, latency_ms, error, checked_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id`,
		c.MonitorID, c.Status, c.StatusCode, c.LatencyMS, c.Error, c.CheckedAt,
	).Scan(&c.ID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `UPDATE monitors SET last_status = $1 WHERE id = $2`, c.Status, c.MonitorID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Postgres) ListChecks(ctx context.Context, monitorID int64, limit int) ([]monitor.Check, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, monitor_id, status, status_code, latency_ms, error, checked_at
		FROM checks
		WHERE monitor_id = $1
		ORDER BY checked_at DESC
		LIMIT $2`, monitorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []monitor.Check{}
	for rows.Next() {
		var c monitor.Check
		if err := rows.Scan(&c.ID, &c.MonitorID, &c.Status, &c.StatusCode, &c.LatencyMS, &c.Error, &c.CheckedAt); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

// Stats tính uptime và độ trễ trung bình từ thời điểm `since` tới giờ.
// Tính ngay trong SQL, không kéo hàng nghìn dòng về Go để cộng.
func (s *Postgres) Stats(ctx context.Context, monitorID int64, since time.Time) (monitor.Stats, error) {
	var st monitor.Stats
	err := s.pool.QueryRow(ctx, `
		SELECT count(*),
		       coalesce(avg(CASE WHEN status = 'up' THEN 100.0 ELSE 0 END), 0),
		       coalesce(avg(latency_ms), 0),
		       max(checked_at)
		FROM checks
		WHERE monitor_id = $1 AND checked_at >= $2`, monitorID, since,
	).Scan(&st.TotalChecks, &st.UptimePercent, &st.AvgLatencyMS, &st.LastCheckedAt)
	return st, err
}
```
**Transaction trong pgx.** <mark>SaveCheck</mark> làm hai việc: thêm một dòng vào <mark>checks</mark> và cập nhật <mark>last_status</mark>. Nếu việc thứ hai lỗi mà việc thứ nhất đã xong, dữ liệu lệch nhau. Nên gói cả hai vào <mark>tx</mark>: <mark>Begin</mark>, chạy lệnh qua <mark>tx</mark> thay vì <mark>pool</mark>, rồi <mark>Commit</mark>. Dòng <mark>defer tx.Rollback(ctx)</mark> là thành ngữ quan trọng: nếu hàm thoát giữa chừng vì lỗi, transaction được hủy; nếu đã <mark>Commit</mark>, <mark>Rollback</mark> gọi sau đó không làm gì (trả về lỗi "đã đóng" và ta lờ đi). Nhờ <mark>defer</mark>, bạn không phải nhớ gọi <mark>Rollback</mark> ở từng nhánh <mark>return err</mark>. Bài 081 đã bàn kỹ vì sao transaction quan trọng khi nhiều người ghi cùng lúc.

**Tính toán trong SQL.** Uptime của 24 giờ với monitor 10 giây một lần là 8.640 dòng. Kéo hết về Go rồi đếm thì vừa chậm vừa tốn bộ nhớ, trong khi PostgreSQL làm việc này cực nhanh nhờ index ở bước 1. Mẹo <mark>avg(CASE WHEN status = 'up' THEN 100.0 ELSE 0 END)</mark>: mỗi dòng up tính 100, down tính 0, trung bình ra ngay phần trăm. <mark>coalesce(..., 0)</mark> đổi NULL (khi không có dòng nào) thành 0 để <mark>Scan</mark> vào <mark>float64</mark> không lỗi. Riêng <mark>max(checked_at)</mark> giữ nguyên NULL và <mark>Scan</mark> vào <mark>*time.Time</mark>: pgx thấy NULL thì để con trỏ nil.

#### Bước 5: Scheduler
```go
// internal/scheduler/scheduler.go
// Package scheduler chạy nền, tới giờ thì kiểm tra monitor và lưu kết quả.
package scheduler

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/monitor"
)

// Store chỉ gồm hai việc scheduler cần. Interface nhỏ, đặt ở nơi dùng.
type Store interface {
	ClaimDue(ctx context.Context, limit int) ([]monitor.Monitor, error)
	SaveCheck(ctx context.Context, c *monitor.Check) error
}

// Scheduler cứ mỗi giây hỏi database "có monitor nào tới giờ chưa" rồi kiểm tra.
type Scheduler struct {
	store   Store
	checker *checker.Checker
	workers int
}

// New tạo Scheduler chạy tối đa `workers` kiểm tra song song.
func New(store Store, c *checker.Checker, workers int) *Scheduler {
	return &Scheduler{store: store, checker: c, workers: workers}
}

// Run chạy cho tới khi ctx bị hủy. Trước khi trả về, chờ các kiểm tra dở dang lưu xong.
func (s *Scheduler) Run(ctx context.Context) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	sem := make(chan struct{}, s.workers) // giới hạn số goroutine chạy cùng lúc
	var wg sync.WaitGroup

	slog.Info("scheduler đang chạy", "workers", s.workers)
	for {
		select {
		case <-ctx.Done():
			wg.Wait()
			slog.Info("scheduler đã dừng")
			return nil
		case <-ticker.C:
		}

		due, err := s.store.ClaimDue(ctx, 100)
		if err != nil {
			if ctx.Err() != nil {
				continue // đang tắt, lỗi do ctx hủy là bình thường
			}
			slog.Error("không lấy được monitor tới giờ", "error", err)
			continue
		}

		for _, m := range due {
			sem <- struct{}{} // đầy thì đứng chờ ở đây
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer func() { <-sem }()
				s.runOne(ctx, m)
			}()
		}
	}
}

func (s *Scheduler) runOne(ctx context.Context, m monitor.Monitor) {
	result := s.checker.Check(ctx, m.URL)
	c := monitor.CheckFromResult(m.ID, result)

	// Dù đang tắt (ctx bị hủy) vẫn cố lưu kết quả vừa có, tối đa 5 giây.
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.store.SaveCheck(saveCtx, &c); err != nil {
		slog.Error("không lưu được kết quả", "monitor", m.ID, "error", err)
		return
	}
	slog.Info("đã kiểm tra", "monitor", m.ID, "name", m.Name, "status", c.Status, "latency_ms", c.LatencyMS)
}
```
Có bốn ý tưởng mới trong 70 dòng này.

**Interface nhỏ, đặt ở nơi dùng.** Scheduler chỉ cần <mark>ClaimDue</mark> và <mark>SaveCheck</mark>, nên nó khai báo một interface <mark>Store</mark> riêng chỉ có hai phương thức đó, thay vì dùng <mark>monitor.Store</mark> to với 7 phương thức. <mark>*store.Postgres</mark> thỏa cả hai interface mà không cần khai báo gì. Lợi ích thấy ngay ở bài 161: muốn test scheduler, bạn viết một struct giả chỉ với hai hàm, không phải giả cả bảy. Đây là thói quen rất Go: *"accept interfaces, return structs"* và interface càng nhỏ càng tốt.

**Ticker thay vì vòng lặp sleep.** <mark>time.NewTicker(time.Second)</mark> tạo một channel <mark>ticker.C</mark> nhận một giá trị mỗi giây. So với <mark>for { ...; time.Sleep(time.Second) }</mark>, ticker có hai điểm hơn: nó là channel nên dùng được trong <mark>select</mark> cùng với <mark>ctx.Done()</mark>, và nhịp không bị trôi (sleep cộng dồn thời gian xử lý, ticker thì không). Nhớ <mark>defer ticker.Stop()</mark> để giải phóng.

**Semaphore bằng channel có đệm.** Bài 152 giới hạn song song bằng worker pool: N goroutine sống lâu, nhận việc từ channel. Ở đây dùng cách thứ hai, gọn hơn khi việc đến lắt nhắt: <mark>sem</mark> là channel đệm <mark>workers</mark> phần tử. Trước khi mở goroutine, gửi một giá trị rỗng vào; nếu đã đầy (đủ <mark>workers</mark> goroutine đang chạy), lệnh gửi **đứng chờ** cho tới khi một goroutine xong và nhận ra khỏi channel (<mark><-sem</mark>). <mark>struct{}{}</mark> là giá trị kiểu struct rỗng, chiếm 0 byte, dùng khi ta chỉ cần "một tín hiệu" chứ không cần dữ liệu.

**<mark>context.WithoutCancel</mark>.** Khi bấm Ctrl+C, <mark>ctx</mark> bị hủy và <mark>checker.Check</mark> đang chạy sẽ trả về lỗi ngay (bài 152). Nhưng nếu kết quả vừa có xong mà <mark>SaveCheck</mark> cũng nhận <mark>ctx</mark> đã hủy, pgx sẽ từ chối chạy và ta mất kết quả đó. <mark>context.WithoutCancel(ctx)</mark> tạo context con **giữ mọi giá trị nhưng bỏ việc hủy**, rồi bọc thêm timeout 5 giây để không chờ mãi nếu database treo. Kết hợp với <mark>wg.Wait()</mark> trong nhánh <mark>ctx.Done()</mark>, scheduler tắt khi và chỉ khi mọi kết quả dở dang đã lưu.

Một chi tiết nhỏ: biến <mark>m</mark> trong <mark>for _, m := range due</mark> được goroutine dùng trực tiếp. Từ Go 1.22, mỗi vòng lặp có một biến <mark>m</mark> riêng nên an toàn. Code Go cũ phải viết <mark>m := m</mark> trước <mark>go func</mark>, bạn sẽ gặp dòng đó ở nhiều dự án.

#### Bước 6: API đọc kết quả
Sửa <mark>internal/api/monitors.go</mark>: <mark>checkMonitor</mark> giờ lưu kết quả thay vì chỉ trả về, thêm hai handler mới, và import thêm <mark>time</mark>.
```go
// internal/api/monitors.go (sửa)
// checkMonitor kiểm tra ngay lập tức, không chờ lịch, và lưu kết quả như bình thường.
func (s *Server) checkMonitor(w http.ResponseWriter, r *http.Request) {
	m, ok := s.findMonitor(w, r)
	if !ok {
		return
	}
	result := s.checker.Check(r.Context(), m.URL)
	c := monitor.CheckFromResult(m.ID, result)
	if err := s.monitors.SaveCheck(r.Context(), &c); err != nil {
		writeError(w, http.StatusInternalServerError, "không lưu được kết quả")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// listChecks trả về các lần kiểm tra gần nhất, mới nhất trước. ?limit=20 (tối đa 500).
func (s *Server) listChecks(w http.ResponseWriter, r *http.Request) {
	m, ok := s.findMonitor(w, r)
	if !ok {
		return
	}
	limit := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	checks, err := s.monitors.ListChecks(r.Context(), m.ID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lỗi đọc dữ liệu")
		return
	}
	writeJSON(w, http.StatusOK, checks)
}

// monitorStats trả về uptime và độ trễ trung bình 24 giờ qua.
func (s *Server) monitorStats(w http.ResponseWriter, r *http.Request) {
	m, ok := s.findMonitor(w, r)
	if !ok {
		return
	}
	stats, err := s.monitors.Stats(r.Context(), m.ID, time.Now().Add(-24*time.Hour))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lỗi đọc dữ liệu")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
```
<mark>r.URL.Query().Get("limit")</mark> đọc tham số <mark>?limit=</mark>. Không có hoặc không hợp lệ thì dùng 20, và trần 500 để không ai kéo cả triệu dòng. Luôn có trần cho mọi tham số kiểu "bao nhiêu", đó là phản xạ cần có khi viết API.

Đăng ký route trong <mark>Handler()</mark> của <mark>internal/api/server.go</mark>:
```go
// internal/api/server.go (thêm)
	mux.HandleFunc("GET /monitors/{id}/checks", s.listChecks)
	mux.HandleFunc("GET /monitors/{id}/stats", s.monitorStats)
```

#### Bước 7: Ghép vào main với errgroup
Thêm <mark>WORKERS</mark> vào config (mặc định 10, đọc từ biến môi trường bằng <mark>strconv.Atoi</mark>, giống <mark>CHECK_TIMEOUT</mark> ở bài 155) và thêm dòng <mark>WORKERS=10</mark> vào <mark>.env.example</mark>. Rồi viết lại <mark>run()</mark> trong <mark>cmd/pulsed/main.go</mark>:
```go
// cmd/pulsed/main.go
// pulsed: server của Pulse, cung cấp HTTP API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/thachnguyenp/pulse/internal/api"
	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/config"
	"github.com/thachnguyenp/pulse/internal/scheduler"
	"github.com/thachnguyenp/pulse/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server dừng vì lỗi", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.NewPostgres(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := db.Migrate(ctx); err != nil {
		return err
	}
	slog.Info("database sẵn sàng")

	chk := checker.New(cfg.CheckTimeout)
	server := api.New(db, chk)
	sched := scheduler.New(db, chk, cfg.Workers)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// errgroup chạy nhiều việc song song; một việc lỗi thì ctx của cả nhóm bị hủy.
	g, ctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		return sched.Run(ctx)
	})

	g.Go(func() error {
		slog.Info("pulsed đang chạy", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})

	g.Go(func() error {
		<-ctx.Done() // chờ Ctrl+C hoặc một việc khác lỗi
		slog.Info("đang tắt, chờ request dở dang...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	})

	err = g.Wait()
	slog.Info("đã tắt")
	return err
}
```
<mark>golang.org/x/sync/errgroup</mark> là thư viện "gần như chuẩn" do nhóm Go duy trì. Chạy <mark>go get golang.org/x/sync</mark> để nó thành phụ thuộc trực tiếp trong <mark>go.mod</mark>. Nó giải quyết đúng bài toán ta gặp: ba việc chạy song song, bất kỳ việc nào lỗi thì cả nhóm phải dừng.
- <mark>errgroup.WithContext(ctx)</mark> trả về nhóm <mark>g</mark> và một <mark>ctx</mark> mới. Ctx này bị hủy khi **bất kỳ** hàm nào trong nhóm trả về lỗi khác nil, hoặc khi ctx cha (Ctrl+C) bị hủy.
- <mark>g.Go(f)</mark> chạy <mark>f</mark> trong goroutine riêng.
- <mark>g.Wait()</mark> chờ tất cả xong và trả về **lỗi đầu tiên**.

Ba goroutine: scheduler chạy tới khi ctx hủy; HTTP server chạy tới khi bị <mark>Shutdown</mark>; goroutine thứ ba chỉ ngồi chờ <mark>ctx.Done()</mark> rồi gọi <mark>Shutdown</mark>. Kịch bản Ctrl+C: ctx hủy → scheduler chờ kiểm tra dở dang rồi thoát, đồng thời goroutine ba gọi <mark>Shutdown</mark> → <mark>ListenAndServe</mark> trả về <mark>http.ErrServerClosed</mark>, ta coi là bình thường và trả nil. Kịch bản lỗi: cổng 3000 bị chiếm → <mark>ListenAndServe</mark> trả lỗi → ctx nhóm hủy → scheduler dừng, <mark>Wait</mark> trả về lỗi cổng, <mark>main</mark> in ra và thoát mã 1. Không có goroutine nào bị bỏ rơi, không có kịch bản "server chết mà scheduler vẫn chạy âm thầm".

So với bài 154 dùng <mark>select</mark> trên <mark>errCh</mark> và <mark>ctx.Done()</mark>, errgroup gọn hơn hẳn khi số việc tăng lên 3, 4, 5 (bài 162 thêm cổng pprof chỉ mất 4 dòng).

#### Chạy thử
Mở ba terminal: <mark>go run ./cmd/fakeweb</mark>, <mark>go run ./cmd/pulsed</mark>, và terminal gõ curl. Tạo hai monitor với chu kỳ 10 giây:
```sh
curl -X POST localhost:3000/monitors -d '{"name":"Fake flaky","url":"http://localhost:8080/flaky","interval_seconds":10}'
curl -X POST localhost:3000/monitors -d '{"name":"Down","url":"http://localhost:8080/down","interval_seconds":10}'
```
```json
{"id":3,"name":"Fake flaky","url":"http://localhost:8080/flaky","interval_seconds":10,"last_status":"pending","next_check_at":"2026-11-04T23:25:33.648575+07:00","created_at":"2026-11-04T23:25:33.648575+07:00"}
{"id":4,"name":"Down","url":"http://localhost:8080/down","interval_seconds":10,"last_status":"pending","next_check_at":"2026-11-04T23:25:33.660341+07:00","created_at":"2026-11-04T23:25:33.660341+07:00"}
```
<mark>last_status</mark> là <mark>pending</mark> và <mark>next_check_at</mark> bằng <mark>created_at</mark>: tới giờ ngay. Trong vòng một giây, terminal pulsed hiện:
```
INFO đã kiểm tra monitor=3 name="Fake flaky" status=down latency_ms=0
INFO đã kiểm tra monitor=4 name=Down status=down latency_ms=0
```
Chờ 12 giây rồi xem lịch sử của monitor 3 và số liệu:
```sh
curl "localhost:3000/monitors/3/checks?limit=3"
curl localhost:3000/monitors/3/stats
```
```json
[{"id":5,"monitor_id":3,"status":"up","status_code":200,"latency_ms":0,"checked_at":"2026-11-04T23:25:43.729657+07:00"},{"id":3,"monitor_id":3,"status":"down","status_code":500,"latency_ms":0,"error":"HTTP 500 Internal Server Error","checked_at":"2026-11-04T23:25:33.728806+07:00"}]
{"total_checks":2,"uptime_percent":50,"avg_latency_ms":0,"last_checked_at":"2026-11-04T23:25:43.729657+07:00"}
```
<mark>/flaky</mark> lúc được lúc không: hai lần kiểm tra, một up một down, uptime 50%. Dòng down có trường <mark>error</mark>, dòng up không có nhờ <mark>omitempty</mark>. <mark>GET /monitors</mark> giờ cho thấy <mark>last_status</mark> đã đổi thành <mark>up</mark>/<mark>down</mark> và <mark>next_check_at</mark> luôn ở tương lai. Bấm Ctrl+C ở terminal pulsed:
```
INFO đang tắt, chờ request dở dang...
INFO scheduler đã dừng
INFO đã tắt
```
Và trong psql, dữ liệu nằm đúng chỗ:
```
pulse=# select monitor_id, status, status_code, latency_ms from checks order by id desc limit 5;
 monitor_id | status | status_code | latency_ms
------------+--------+-------------+------------
          2 | up     |         200 |          0
          3 | up     |         200 |          0
          4 | down   |         503 |          0
          3 | down   |         500 |          0
          4 | down   |         503 |          0
```
Muốn thấy <mark>SKIP LOCKED</mark> hoạt động, mở thêm một pulsed với <mark>ADDR=:3001 go run ./cmd/pulsed</mark>: hai bản cùng chạy, mỗi monitor vẫn chỉ được kiểm tra đúng một lần mỗi chu kỳ, log "đã kiểm tra" chia đều về hai terminal.

#### Mẹo và lỗi hay gặp
- **Quên <mark>wg.Wait()</mark> khi tắt**: scheduler thoát ngay, goroutine đang kiểm tra bị <mark>main</mark> kết thúc giữa chừng, mất kết quả. Luôn hỏi: khi process tắt, goroutine này sẽ ra sao?
- **Dùng <mark>ctx</mark> đã hủy để ghi database**: lỗi <mark>context canceled</mark> xuất hiện đúng lúc tắt. Triệu chứng này dễ bị bỏ qua vì "chỉ xảy ra khi tắt". <mark>context.WithoutCancel</mark> là câu trả lời, nhưng phải kèm timeout.
- **<mark>ClaimDue</mark> không có <mark>LIMIT</mark>**: 10.000 monitor cùng tới giờ sau khi server ngủ một đêm sẽ mở 10.000 goroutine chờ semaphore. Có hạn, rồi tick sau lấy tiếp.
- **Ticker 1 giây và chu kỳ tối thiểu 10 giây**: <mark>Validate</mark> ở bài 154 chặn <mark>interval_seconds < 10</mark> không phải ngẫu nhiên. Scheduler chỉ nhìn mỗi giây một lần, chu kỳ 1 giây sẽ không chính xác.
- **Kiểm tra bằng <mark>-race</mark>**: <mark>go run -race ./cmd/pulsed</mark> vài phút trong lúc phát triển. Scheduler, HTTP handler và pool pgx chạy song song; race detector (bài 152) là người bạn tốt nhất ở đây.

#### Checklist
- Tạo monitor mới, trong 1 giây thấy log "đã kiểm tra" mà không cần gọi API nào.
- <mark>GET /monitors/{id}/checks</mark> trả về mới nhất trước; <mark>?limit=1</mark> cho đúng 1 dòng.
- <mark>GET /monitors/{id}/stats</mark> của monitor chưa kiểm tra: <mark>total_checks</mark> 0, <mark>last_checked_at</mark> là <mark>null</mark>.
- Xóa monitor: bảng <mark>checks</mark> cũng không còn dòng của nó (CASCADE).
- Ctrl+C in đủ ba dòng "đang tắt", "scheduler đã dừng", "đã tắt".
- Chạy hai pulsed cùng lúc với <mark>ADDR</mark> khác nhau: không monitor nào bị kiểm tra hai lần trong một chu kỳ.

Mã nguồn cuối bài: [post_156.zip](/assets/code/post_156.zip).

#### Bài tập thêm
- Thêm <mark>?since=7d</mark> cho <mark>/stats</mark> (gợi ý: <mark>time.ParseDuration</mark> không hiểu "d", bạn tự quy đổi).
- Thêm endpoint <mark>POST /monitors/{id}/pause</mark> đặt <mark>next_check_at</mark> rất xa, và <mark>/resume</mark> đặt về <mark>now()</mark>.
- Mỗi giờ xóa các dòng <mark>checks</mark> cũ hơn 90 ngày: thêm goroutine thứ tư vào errgroup với ticker một giờ.
