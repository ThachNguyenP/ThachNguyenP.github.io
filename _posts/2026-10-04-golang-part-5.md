---
layout: post
title:  "154. Go cho người mới (Bài 5: HTTP server & JSON API với net/http)."
date:   2026-10-04 13:40:00 +0700
author: thach
categories: [Coding]
tags: [Golang]
image: assets/images/post_154/go-http.png
---
<mark>pulse</mark> là công cụ chạy một lần rồi thoát. Thứ người ta thật sự cần ở một hệ thống giám sát là một **dịch vụ chạy liên tục**: đăng ký URL qua API, nó tự kiểm tra định kỳ, lưu lịch sử, báo khi sập. Bài này viết chương trình thứ hai của dự án, server <mark>pulsed</mark> (chữ *d* cuối là "daemon", quy ước đặt tên cho tiến trình chạy nền), với một JSON API để thêm, xem, xóa monitor và kiểm tra ngay. Dữ liệu tạm giữ trong bộ nhớ, bài sau mới đưa vào PostgreSQL. Qua đó học <mark>net/http</mark>: router, handler, JSON, middleware, và tắt server đúng cách.

#### net/http là đủ
Người học Go hay hỏi ngay: "dùng Gin hay Echo hay Fiber?". Câu trả lời trong series này: **thư viện chuẩn trước**. Từ Go 1.22, <mark>http.ServeMux</mark> có sẵn router theo method và tham số trên đường dẫn, là thứ trước đây phải cài thêm. Phần còn lại (JSON, middleware, timeout, tắt êm) cũng có sẵn.

| | <mark>net/http</mark> | Gin, Echo, Chi... |
|---|---|---|
| Router theo method, <mark>/monitors/{id}</mark> | Có (Go 1.22+) | Có |
| Middleware | Tự viết, vài dòng mỗi cái | Có sẵn nhiều: CORS, log, recover... |
| Đọc/ghi JSON | <mark>encoding/json</mark>, tự viết helper | Hàm tiện <mark>c.JSON(200, v)</mark> |
| Validation | Tự viết hoặc thêm thư viện | Thường tích hợp sẵn |
| Học xong dùng được ở đâu | Mọi dự án Go, kể cả dự án dùng framework (framework nào cũng bọc <mark>net/http</mark>) | Dự án dùng đúng framework đó |

Framework hữu ích khi dự án lớn với hàng trăm route và cần nhiều middleware sẵn. Nhưng nếu học framework trước, bạn sẽ không hiểu <mark>http.Handler</mark> là gì, và khi phải chạm vào middleware hay test handler sẽ lúng túng. Ngược lại, biết <mark>net/http</mark> thì học Gin mất một buổi chiều.

#### Kết quả cuối bài
| Method | Đường dẫn | Việc |
|---|---|---|
| GET | <mark>/healthz</mark> | Server còn sống không (cho load balancer, Docker) |
| GET | <mark>/monitors</mark> | Danh sách monitor |
| POST | <mark>/monitors</mark> | Tạo monitor, body <mark>{"name","url","interval_seconds"}</mark> |
| GET | <mark>/monitors/{id}</mark> | Một monitor |
| DELETE | <mark>/monitors/{id}</mark> | Xóa |
| POST | <mark>/monitors/{id}/check</mark> | Kiểm tra ngay, trả kết quả |

Code mới nằm ở ba package: <mark>internal/monitor</mark> (kiểu dữ liệu và validation), <mark>internal/store</mark> (lưu trữ), <mark>internal/api</mark> (HTTP), cộng <mark>cmd/pulsed/main.go</mark>.

#### Bước 1: Kiểu Monitor và interface Store
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
)

// ErrNotFound trả về khi không có monitor với id đó.
var ErrNotFound = errors.New("monitor not found")

// Monitor là một URL cần kiểm tra mỗi Interval giây.
type Monitor struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Interval  int       `json:"interval_seconds"`
	CreatedAt time.Time `json:"created_at"`
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

// Store là nơi lưu monitor. Bài này lưu trong bộ nhớ, bài sau lưu PostgreSQL.
type Store interface {
	Create(ctx context.Context, m *Monitor) error
	List(ctx context.Context) ([]Monitor, error)
	Get(ctx context.Context, id int64) (Monitor, error)
	Delete(ctx context.Context, id int64) error
}
```
Ba điều đáng chú ý:

**Lỗi dùng chung <mark>ErrNotFound</mark>.** Khai báo một lần bằng <mark>errors.New</mark> ở mức package, mọi nơi trả về đúng biến này, và nơi nhận so sánh bằng <mark>errors.Is(err, monitor.ErrNotFound)</mark>. Nhờ vậy handler phân biệt được "không có" (trả 404) với "database hỏng" (trả 500) mà không phải đọc chuỗi lỗi.

**<mark>Validate</mark> trả về <mark>map[string]string</mark>.** Mỗi trường sai là một cặp tên trường → lý do, để API trả về đủ mọi lỗi một lần thay vì mỗi lần một lỗi (người làm form rất ghét kiểu sửa xong lỗi này mới thấy lỗi kia). Receiver là con trỏ <mark>*Monitor</mark> vì hàm **sửa** dữ liệu: cắt khoảng trắng, điền <mark>Interval</mark> mặc định 60. <mark>url.ParseRequestURI</mark> chặt hơn <mark>url.Parse</mark>: đòi URL tuyệt đối. Vẫn phải tự kiểm tra scheme và host, vì <mark>ftp://a</mark> hay <mark>http:///</mark> đều parse được.

**Interface <mark>Store</mark> khai báo trước khi có cách lưu nào.** Package <mark>api</mark> sẽ chỉ biết <mark>monitor.Store</mark>; bài này nhét vào một map, bài sau thay bằng PostgreSQL, bài 12 thay bằng store giả để test, **mà <mark>api</mark> không đổi dòng nào**. Mọi method nhận <mark>context.Context</mark> làm tham số đầu, là quy ước của Go cho mọi việc có thể chậm hoặc bị hủy: database bài sau sẽ cần nó thật.

#### Bước 2: Store trong bộ nhớ
```go
// internal/store/memory.go
// Package store chứa các cách lưu dữ liệu.
package store

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

// Memory lưu monitor trong một map. Mất hết khi tắt chương trình.
type Memory struct {
	mu     sync.Mutex
	nextID int64
	items  map[int64]monitor.Monitor
}

// NewMemory tạo store rỗng.
func NewMemory() *Memory {
	return &Memory{nextID: 1, items: map[int64]monitor.Monitor{}}
}

func (s *Memory) Create(ctx context.Context, m *monitor.Monitor) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	m.ID = s.nextID
	m.CreatedAt = time.Now()
	s.nextID++
	s.items[m.ID] = *m
	return nil
}

func (s *Memory) List(ctx context.Context) ([]monitor.Monitor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	list := make([]monitor.Monitor, 0, len(s.items))
	for _, m := range s.items {
		list = append(list, m)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	return list, nil
}

func (s *Memory) Get(ctx context.Context, id int64) (monitor.Monitor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	m, ok := s.items[id]
	if !ok {
		return monitor.Monitor{}, monitor.ErrNotFound
	}
	return m, nil
}

func (s *Memory) Delete(ctx context.Context, id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.items[id]; !ok {
		return monitor.ErrNotFound
	}
	delete(s.items, id)
	return nil
}
```
Vì sao có <mark>sync.Mutex</mark>? Vì <mark>net/http</mark> **chạy mỗi request trong một goroutine riêng**. Hai client cùng POST một lúc là hai goroutine cùng ghi vào <mark>items</mark>; map của Go không an toàn khi ghi đồng thời, chương trình sẽ panic với "concurrent map writes" (bài 3 đã thấy race detector bắt lỗi kiểu này). Mẫu <mark>Lock()</mark> rồi <mark>defer Unlock()</mark> ngay dòng sau là cách viết chuẩn: dù hàm return ở đâu cũng mở khóa. Map không có thứ tự, nên <mark>List</mark> phải sắp xếp để API trả về ổn định.

Để ý <mark>Memory</mark> thỏa <mark>monitor.Store</mark> mà không khai báo gì, đúng như bài 4. Nếu thiếu một method, lỗi sẽ hiện ở chỗ truyền <mark>store.NewMemory()</mark> vào <mark>api.New</mark>.

#### Bước 3: JSON helper
Mọi API đều lặp đi lặp lại ba việc: đọc JSON từ body, trả JSON, trả lỗi. Viết một lần ở <mark>internal/api/json.go</mark>:
```go
// internal/api/json.go
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// writeJSON trả về JSON với mã HTTP cho trước.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError trả về lỗi dạng {"error": "..."} để client nào cũng đọc giống nhau.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeValidation trả về 422 kèm lỗi của từng trường.
func writeValidation(w http.ResponseWriter, problems map[string]string) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"error":  "dữ liệu không hợp lệ",
		"fields": problems,
	})
}

// readJSON đọc body JSON vào v. Giới hạn 1MB và không cho phép trường lạ.
func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var syntaxErr *json.SyntaxError
		switch {
		case errors.As(err, &syntaxErr):
			return fmt.Errorf("JSON sai cú pháp ở vị trí %d", syntaxErr.Offset)
		case errors.Is(err, io.EOF):
			return errors.New("body trống")
		default:
			return fmt.Errorf("JSON không đúng: %v", err)
		}
	}
	return nil
}
```
- <mark>any</mark> là kiểu "bất kỳ" (tên khác của <mark>interface{}</mark>): <mark>writeJSON</mark> nhận struct, slice, map, gì cũng được, <mark>json.Encoder</mark> tự lo. Thứ tự <mark>Header().Set</mark> → <mark>WriteHeader</mark> → ghi body là bắt buộc; đặt header sau khi đã <mark>WriteHeader</mark> sẽ bị bỏ qua không báo lỗi.
- Mọi lỗi đều có dạng <mark>{"error": "..."}</mark>: client (web, mobile) viết một hàm xử lý lỗi dùng cho mọi endpoint.
- <mark>io.LimitReader(r.Body, 1&lt;&lt;20)</mark> chỉ đọc tối đa 1MB (<mark>1&lt;&lt;20</mark> là 2 mũ 20): ai gửi body 2GB cũng không làm server hết RAM. Bài 085-093 về bot và abuse có nói kỹ hơn vì sao mọi đầu vào đều phải có giới hạn.
- <mark>DisallowUnknownFields</mark>: gửi trường không có trong struct là lỗi, giúp bắt sớm lỗi gõ sai tên (<mark>"interval"</mark> thay vì <mark>"interval_seconds"</mark>) thay vì lặng lẽ bỏ qua.
- <mark>errors.As(err, &amp;syntaxErr)</mark> hỏi "trong chuỗi lỗi này có cái nào là <mark>*json.SyntaxError</mark> không, nếu có thì gán vào <mark>syntaxErr</mark>". Khác với <mark>errors.Is</mark> (so với một giá trị cụ thể), <mark>errors.As</mark> so **kiểu**, dùng khi lỗi có thêm thông tin cần đọc (ở đây là vị trí <mark>Offset</mark>).

#### Bước 4: Server và route
```go
// internal/api/server.go
// Package api là HTTP API của pulsed.
package api

import (
	"net/http"

	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/monitor"
)

// Server gom mọi thứ handler cần: store, checker...
type Server struct {
	monitors monitor.Store
	checker  *checker.Checker
}

// New tạo Server với các phụ thuộc được truyền vào.
func New(monitors monitor.Store, checker *checker.Checker) *Server {
	return &Server{monitors: monitors, checker: checker}
}

// Handler trả về http.Handler với toàn bộ route và middleware.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.healthz)

	mux.HandleFunc("GET /monitors", s.listMonitors)
	mux.HandleFunc("POST /monitors", s.createMonitor)
	mux.HandleFunc("GET /monitors/{id}", s.getMonitor)
	mux.HandleFunc("DELETE /monitors/{id}", s.deleteMonitor)
	mux.HandleFunc("POST /monitors/{id}/check", s.checkMonitor)

	return recoverPanic(logging(mux))
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
```
**Handler là gì.** Trong <mark>net/http</mark>, mọi thứ xử lý request đều là <mark>http.Handler</mark>, một interface với đúng một method <mark>ServeHTTP(w http.ResponseWriter, r *http.Request)</mark>. <mark>w</mark> để ghi phản hồi, <mark>r</mark> là mọi thứ về request (method, URL, header, body, context). Một hàm thường có chữ ký <mark>func(w, r)</mark> cũng dùng được qua <mark>http.HandlerFunc</mark>; <mark>mux.HandleFunc</mark> nhận hàm như vậy. <mark>ServeMux</mark> cũng là một <mark>http.Handler</mark>: nó nhận request rồi chuyển cho handler khớp.

**Mẫu route mới.** <mark>"GET /monitors/{id}"</mark> gồm method và đường dẫn có tham số. Gửi <mark>PUT /monitors</mark> là mux tự trả <mark>405 Method Not Allowed</mark>; đường dẫn không khớp gì thì 404. Tham số đọc bằng <mark>r.PathValue("id")</mark>. Đường dẫn khớp **chính xác** (không có dấu <mark>/</mark> cuối thừa), và mẫu cụ thể hơn thắng mẫu chung hơn.

**Handler là method của <mark>*Server</mark>.** Mọi handler cần store và checker. Thay vì biến toàn cục (khó test, khó có hai server trong cùng test), gói chúng vào struct <mark>Server</mark> và handler là method; <mark>s.listMonitors</mark> là **method value**, tự mang theo <mark>s</mark>, truyền thẳng vào <mark>HandleFunc</mark>. Đây là cách tiêm phụ thuộc (dependency injection) của Go: không cần framework, chỉ là tham số của hàm <mark>New</mark>. Nếu bạn làm Next.js, bài 147 có Route Handler và middleware với ý tưởng tương tự.

**<mark>Handler()</mark> trả về <mark>http.Handler</mark>**, không tự <mark>ListenAndServe</mark>. Nhờ vậy main quyết định cổng và cách chạy, còn test (bài 12) đưa thẳng handler này vào <mark>httptest.NewServer</mark> mà không cần cổng thật.

#### Bước 5: Các handler
```go
// internal/api/monitors.go
package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

func (s *Server) listMonitors(w http.ResponseWriter, r *http.Request) {
	list, err := s.monitors.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "không lấy được danh sách")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) createMonitor(w http.ResponseWriter, r *http.Request) {
	var m monitor.Monitor
	if err := readJSON(r, &m); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if problems := m.Validate(); len(problems) > 0 {
		writeValidation(w, problems)
		return
	}
	if err := s.monitors.Create(r.Context(), &m); err != nil {
		writeError(w, http.StatusInternalServerError, "không lưu được")
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) getMonitor(w http.ResponseWriter, r *http.Request) {
	m, ok := s.findMonitor(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) deleteMonitor(w http.ResponseWriter, r *http.Request) {
	m, ok := s.findMonitor(w, r)
	if !ok {
		return
	}
	if err := s.monitors.Delete(r.Context(), m.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "không xóa được")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// checkMonitor kiểm tra ngay lập tức, không chờ lịch.
func (s *Server) checkMonitor(w http.ResponseWriter, r *http.Request) {
	m, ok := s.findMonitor(w, r)
	if !ok {
		return
	}
	result := s.checker.Check(r.Context(), m.URL)
	writeJSON(w, http.StatusOK, result)
}

// findMonitor đọc {id} trên URL và tìm monitor. Tự trả lỗi 400/404 nếu cần.
func (s *Server) findMonitor(w http.ResponseWriter, r *http.Request) (monitor.Monitor, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "id phải là số")
		return monitor.Monitor{}, false
	}
	m, err := s.monitors.Get(r.Context(), id)
	if errors.Is(err, monitor.ErrNotFound) {
		writeError(w, http.StatusNotFound, "không có monitor này")
		return monitor.Monitor{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lỗi đọc dữ liệu")
		return monitor.Monitor{}, false
	}
	return m, true
}
```
Mỗi handler đọc giống nhau: lấy dữ liệu vào → gọi store → trả JSON, và **mỗi nhánh lỗi kết thúc bằng <mark>return</mark>**. Quên <mark>return</mark> sau <mark>writeError</mark> là lỗi kinh điển: handler ghi lỗi 400 rồi chạy tiếp, ghi thêm 201 và body nữa, client nhận một đống lộn xộn (và Go in cảnh báo "superfluous response.WriteHeader").

Lỗi 500 trả cho client một câu chung chung, **không** trả <mark>err.Error()</mark>: thông báo lỗi database có thể lộ tên bảng, câu SQL, đường dẫn file. Chi tiết chỉ đi vào log (bài 13 sẽ làm log tử tế).

<mark>r.Context()</mark> là context gắn với request, bị hủy khi client ngắt kết nối. Truyền nó xuống store và checker để việc tốn kém dừng theo: ai gọi <mark>/check</mark> rồi tắt tab thì request HTTP ra ngoài cũng bị cắt.

Ba handler cùng cần "đọc id, tìm monitor, báo 400/404 nếu sai" nên gom vào <mark>findMonitor</mark> trả về <mark>(Monitor, bool)</mark>: <mark>false</mark> nghĩa là đã trả lỗi rồi, handler chỉ việc <mark>return</mark>.

#### Bước 6: Middleware
Middleware là hàm nhận một <mark>http.Handler</mark> và trả về một <mark>http.Handler</mark> khác bọc bên ngoài: làm gì đó trước, gọi handler gốc, làm gì đó sau. Vì đầu vào và đầu ra cùng kiểu, chúng xếp chồng được: <mark>recoverPanic(logging(mux))</mark>.
```go
// internal/api/middleware.go
package api

import (
	"log/slog"
	"net/http"
	"time"
)

// statusRecorder nhớ lại mã HTTP mà handler đã ghi, để log được.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// logging ghi một dòng log cho mỗi request.
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rec, r)

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start).Round(time.Microsecond),
		)
	})
}

// recoverPanic bắt panic trong handler, trả 500 thay vì làm sập cả server.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				slog.Error("panic", "error", err, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "lỗi hệ thống")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
```
**Struct embedding.** <mark>statusRecorder</mark> khai báo trường <mark>http.ResponseWriter</mark> **không có tên**. Go gọi đó là embedding: mọi method của <mark>ResponseWriter</mark> (<mark>Header</mark>, <mark>Write</mark>, <mark>WriteHeader</mark>) tự động "nổi" lên <mark>statusRecorder</mark>, nên nó cũng là một <mark>http.ResponseWriter</mark>. Ta chỉ viết đè <mark>WriteHeader</mark> để ghi nhớ mã rồi gọi tiếp bản gốc. Đây là cách Go tái sử dụng mà không có kế thừa: không phải "là một" mà là "có một và chuyển tiếp". Mặc định <mark>status</mark> là 200 vì handler không gọi <mark>WriteHeader</mark> thì Go ngầm trả 200.

**<mark>log/slog</mark>** là package log có cấu trúc của thư viện chuẩn: thay vì ghép chuỗi, bạn truyền cặp khóa-giá trị. Lúc dev in dạng <mark>key=value</mark> dễ đọc, lên production chuyển sang JSON (bài 13) để công cụ log tìm kiếm được theo <mark>status=500</mark>.

**<mark>defer</mark> + <mark>recover</mark>.** Một handler panic (chia cho 0, truy cập nil, index ngoài slice) mà không ai bắt thì **cả tiến trình** chết, kéo theo mọi request khác. <mark>recover()</mark> chỉ có tác dụng bên trong hàm được <mark>defer</mark>; nó trả về giá trị panic và chương trình tiếp tục từ đó. <mark>net/http</mark> thực ra đã tự recover cho mỗi goroutine request, nhưng tự làm thì ta trả được JSON lỗi tử tế và log theo ý mình.

#### Bước 7: main và tắt server êm
```go
// cmd/pulsed/main.go
// pulsed: server của Pulse, cung cấp HTTP API.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/thachnguyenp/pulse/internal/api"
	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/store"
)

func main() {
	addr := flag.String("addr", ":3000", "địa chỉ lắng nghe")
	flag.Parse()

	if err := run(*addr); err != nil {
		slog.Error("server dừng vì lỗi", "error", err)
		os.Exit(1)
	}
}

func run(addr string) error {
	monitors := store.NewMemory()
	server := api.New(monitors, checker.New(10*time.Second))

	srv := &http.Server{
		Addr:              addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Chạy server trong goroutine riêng để main còn chờ tín hiệu tắt.
	errCh := make(chan error, 1)
	go func() {
		slog.Info("pulsed đang chạy", "addr", addr)
		errCh <- srv.ListenAndServe()
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("đang tắt, chờ request dở dang...")
	}

	// Cho request đang chạy tối đa 10 giây để xong, rồi mới tắt hẳn.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	slog.Info("đã tắt")
	return nil
}
```
Nhiều tutorial kết thúc bằng một dòng <mark>http.ListenAndServe(":3000", mux)</mark>. Chạy được, nhưng thiếu hai thứ mà production bắt buộc:

**Timeout.** <mark>http.Server</mark> mặc định chờ vô hạn. Một client mở kết nối rồi gửi header nhỏ giọt sẽ giữ goroutine mãi (tấn công Slowloris). <mark>ReadHeaderTimeout</mark> 5 giây cắt những kết nối như vậy. Thời gian xử lý cả request thì để context của từng handler lo.

**Tắt êm (graceful shutdown).** Khi bạn deploy bản mới, Docker hay Kubernetes gửi <mark>SIGTERM</mark> cho tiến trình cũ. Nếu tiến trình chết ngay, mọi request đang xử lý dở nhận lỗi kết nối: người dùng đang bấm "Tạo monitor" thấy lỗi dù không làm gì sai. <mark>srv.Shutdown(ctx)</mark> làm đúng việc: ngừng nhận kết nối mới, chờ request đang chạy xong, hết 10 giây thì cắt. Bài 149 deploy Next.js cũng dựa vào cơ chế này của nền tảng; với Go bạn tự viết và hiểu nó.

Cách ghép: <mark>ListenAndServe</mark> **chặn** cho tới khi server dừng, nên phải chạy trong goroutine và báo kết quả qua channel <mark>errCh</mark> (buffer 1 để goroutine gửi xong là thoát, không chờ ai nhận). <mark>signal.NotifyContext</mark> (bài 3) cho một context bị hủy khi nhận Ctrl+C hoặc <mark>SIGTERM</mark>. <mark>select</mark> chờ cái nào tới trước: server lỗi (cổng bận chẳng hạn) thì trả lỗi; tín hiệu tắt thì đi vào <mark>Shutdown</mark>.

#### Chạy thử
```sh
go run ./cmd/fakeweb    # cửa sổ 1
go run ./cmd/pulsed     # cửa sổ 2
```
Cửa sổ 3, dùng <mark>curl</mark> (có sẵn trên macOS và Linux; Windows dùng Git Bash hoặc Postman):
```sh
curl -s localhost:3000/healthz
# {"status":"ok"}

curl -s -X POST localhost:3000/monitors -d '{"name":"Google","url":"https://google.com","interval_seconds":60}'
# {"id":1,"name":"Google","url":"https://google.com","interval_seconds":60,"created_at":"2026-11-04T23:22:19.439907+07:00"}

curl -s -X POST localhost:3000/monitors -d '{"name":"Fake fast","url":"http://localhost:8080/fast"}'
# {"id":2,"name":"Fake fast","url":"http://localhost:8080/fast","interval_seconds":60,"created_at":"..."}
```
Monitor thứ hai không gửi <mark>interval_seconds</mark>, <mark>Validate</mark> điền 60. Giờ gửi dữ liệu sai:
```sh
curl -s -X POST localhost:3000/monitors -d '{"name":"","url":"google.com","interval_seconds":5}'
# {"error":"dữ liệu không hợp lệ","fields":{"interval_seconds":"từ 10 đến 3600 giây","name":"không được để trống","url":"phải là URL đầy đủ, bắt đầu bằng http:// hoặc https://"}}

curl -s -X POST localhost:3000/monitors -d '{"name":"x","url":"https://a.com","foo":1}'
# {"error":"JSON không đúng: json: unknown field \"foo\""}

curl -s -X POST localhost:3000/monitors -d '{bad'
# {"error":"JSON sai cú pháp ở vị trí 2"}
```
Cả ba lỗi của ba trường về cùng một lần. Phần còn lại:
```sh
curl -s localhost:3000/monitors
# [{"id":1,...},{"id":2,...}]

curl -s -X POST localhost:3000/monitors/2/check
# {"url":"http://localhost:8080/fast","status":"up","status_code":200,"latency_ms":2,"checked_at":"2026-11-04T23:22:19.493798+07:00"}

curl -s -i -X DELETE localhost:3000/monitors/2 | head -1
# HTTP/1.1 204 No Content

curl -s localhost:3000/monitors/2
# {"error":"không có monitor này"}

curl -s localhost:3000/monitors/abc
# {"error":"id phải là số"}

curl -s -X PUT localhost:3000/monitors
# Method Not Allowed
```
Dòng cuối là mux tự trả, dạng text chứ không phải JSON của ta; bài tập cuối bài sẽ sửa. Trong cửa sổ 2, mỗi request một dòng log:
```
2026/11/04 23:22:19 INFO request method=DELETE path=/monitors/2 status=204 duration=3µs
2026/11/04 23:22:19 INFO request method=GET path=/monitors/2 status=404 duration=19µs
2026/11/04 23:22:19 INFO request method=GET path=/monitors/abc status=400 duration=11µs
2026/11/04 23:22:19 INFO request method=PUT path=/monitors status=405 duration=13µs
```
Bấm Ctrl+C:
```
2026/11/04 23:22:19 INFO đang tắt, chờ request dở dang...
2026/11/04 23:22:19 INFO đã tắt
```
Chạy lại <mark>go run ./cmd/pulsed</mark> và <mark>GET /monitors</mark>: **mảng rỗng**. Store trong bộ nhớ mất hết khi tắt, và hai bản <mark>pulsed</mark> chạy song song sẽ có hai danh sách khác nhau. Bài sau thay bằng PostgreSQL, và nhờ interface <mark>monitor.Store</mark>, package <mark>api</mark> sẽ không phải sửa.

#### Mẹo và lỗi hay gặp
- **"superfluous response.WriteHeader call"**: thiếu <mark>return</mark> sau khi trả lỗi. Mỗi <mark>writeError</mark> trong handler đi kèm một <mark>return</mark>.
- **"bind: address already in use"**: cổng 3000 còn bị bản cũ giữ. Tìm bằng <mark>lsof -i :3000</mark> rồi tắt, hoặc chạy <mark>-addr :3001</mark>.
- **Route <mark>"GET /monitors/"</mark> (có dấu / cuối)** khớp mọi thứ bắt đầu bằng <mark>/monitors/</mark>, kể cả <mark>/monitors/1/check</mark>. Mẫu không có <mark>/</mark> cuối khớp chính xác. Hay nhầm.
- **Mẫu trùng nhau** như <mark>"GET /monitors/{id}"</mark> và <mark>"GET /monitors/new"</mark>: mẫu cụ thể hơn thắng. Nhưng hai mẫu cùng mức (<mark>/{a}/x</mark> và <mark>/y/{b}</mark>) làm server **panic lúc khởi động**: tốt, lỗi lộ ngay chứ không âm thầm.
- <mark>curl -d</mark> mặc định gửi <mark>Content-Type: application/x-www-form-urlencoded</mark>; server của ta không kiểm tra header này nên vẫn chạy. Client thật nên gửi <mark>application/json</mark>, và bài tập có phần kiểm tra.
- Đọc body xong Go tự đóng <mark>r.Body</mark> khi handler trả về, không cần <mark>defer r.Body.Close()</mark> như phía client ở bài 1.

#### Checklist
- <mark>go build ./...</mark> và <mark>go vet ./...</mark> sạch. Cây thư mục có thêm <mark>cmd/pulsed</mark>, <mark>internal/api</mark>, <mark>internal/monitor</mark>, <mark>internal/store</mark>.
- Tạo monitor thiếu tên nhận 422 với đủ các trường sai; JSON hỏng nhận 400.
- <mark>POST /monitors/1/check</mark> trả về kết quả có <mark>latency_ms</mark>; <mark>DELETE</mark> trả 204 rồi <mark>GET</mark> trả 404.
- Ctrl+C thấy hai dòng "đang tắt" và "đã tắt".

Mã nguồn cuối bài: [post_154.zip](/assets/code/post_154.zip).

#### Bài tập thêm
- Thêm <mark>PUT /monitors/{id}</mark> để sửa tên, URL, interval. Dùng lại <mark>findMonitor</mark>, <mark>readJSON</mark> và <mark>Validate</mark>; thêm method <mark>Update</mark> vào interface <mark>Store</mark> và <mark>Memory</mark>.
- Viết middleware <mark>requireJSON</mark>: với POST/PUT, nếu header <mark>Content-Type</mark> không bắt đầu bằng <mark>application/json</mark> thì trả 415 bằng <mark>writeError</mark>. Chèn vào chuỗi middleware trong <mark>Handler()</mark>.
- Làm cho 404 và 405 của mux cũng trả JSON: viết một handler bọc ngoài <mark>mux</mark> dùng <mark>statusRecorder</mark> để biết mux trả mã gì, hoặc đọc tài liệu <mark>http.ServeMux.Handler(r)</mark> để biết route có khớp không trước khi gọi. So sánh hai cách, chọn cách bạn thấy rõ ràng hơn.
- Thử panic cố ý: trong <mark>healthz</mark> thêm <mark>var m map[string]int; m["x"] = 1</mark>, gọi <mark>/healthz</mark> và xem <mark>recoverPanic</mark> làm việc; sau đó bỏ <mark>recoverPanic</mark> khỏi chuỗi middleware để thấy <mark>net/http</mark> tự xử lý thế nào (và client nhận gì).
