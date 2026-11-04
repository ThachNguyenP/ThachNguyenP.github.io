---
layout: post
title:  "153. Go cho người mới (Bài 4: Package, Interface & Test)."
date:   2026-11-04 13:30:00 +0700
author: thach
categories: [ Coding, Golang]
image: assets/images/post_153/go-packages.png
---
Sau 3 bài, <mark>pulse</mark> đã chạy được việc: đọc danh sách URL, kiểm tra song song, in bảng, xuất JSON và CSV. Nhưng toàn bộ code nằm trong 4 file cùng một thư mục, cùng <mark>package main</mark>. Bài sau ta viết thêm một chương trình thứ hai (server <mark>pulsed</mark>) cần dùng lại đúng hàm <mark>check</mark> đó, mà hàm trong <mark>package main</mark> thì không ai import được. Bài này **không thêm tính năng**, mà sắp xếp lại dự án theo cách mọi dự án Go thật đang làm: chia thành **package**, định nghĩa **interface** ở chỗ cần, và viết **test** cho từng phần. Đây là bài "xương sống": mọi bài sau đều xây trên cấu trúc này.

#### Kết quả cuối bài
```
pulse/
├── go.mod
├── cmd/
│   ├── pulse/main.go        chương trình dòng lệnh (bài 1-3)
│   └── fakeweb/main.go      web giả để thử (bài 3)
├── internal/
│   ├── checker/
│   │   ├── checker.go       gọi URL, worker pool
│   │   └── checker_test.go
│   ├── report/
│   │   ├── report.go        in bảng / JSON / CSV
│   │   └── report_test.go
│   └── sites/
│       ├── sites.go         đọc danh sách URL
│       └── sites_test.go
├── sites.txt
└── local.txt
```
Hai quy ước bạn sẽ gặp ở hầu hết dự án Go:
- <mark>cmd/&lt;tên&gt;/main.go</mark>: mỗi thư mục con là **một chương trình chạy được** (một binary). Dự án có bao nhiêu binary thì có bấy nhiêu thư mục trong <mark>cmd/</mark>.
- <mark>internal/</mark>: code dùng chung của dự án. Go có một luật đặc biệt: package nằm trong <mark>internal/</mark> **chỉ import được từ bên trong module chứa nó**. Người khác <mark>go get</mark> module của bạn sẽ không gọi được những package này, nên bạn thoải mái đổi mà không sợ phá code của ai.

#### Package là gì
Trong Go, **package = thư mục**. Mọi file <mark>.go</mark> trong cùng thư mục phải khai báo cùng một tên package ở dòng đầu, và chúng nhìn thấy nhau như thể cùng một file (bài 2 đã tận dụng điều này khi tách <mark>check.go</mark>, <mark>report.go</mark> mà không cần import gì). Một thư mục chỉ chứa một package.

Có hai loại package:
- <mark>package main</mark> có hàm <mark>main()</mark>, là điểm bắt đầu của một chương trình. Không ai import được package main.
- Mọi package tên khác là **thư viện**: không chạy một mình, chỉ để package khác import.

Đường dẫn import = **đường dẫn module** (dòng <mark>module</mark> trong <mark>go.mod</mark>) **+ thư mục**. Module của ta là <mark>github.com/thachnguyenp/pulse</mark>, nên package trong <mark>internal/checker</mark> được import là:
```go
import "github.com/thachnguyenp/pulse/internal/checker"
```
và dùng với tên thư mục cuối: <mark>checker.New(...)</mark>. Tên package nên ngắn, chữ thường, không gạch dưới, và **không trùng với thứ bạn hay đặt tên biến** (package tên <mark>url</mark> thì biến <mark>url</mark> sẽ che mất nó, một lỗi rất hay gặp).

**Public hay private** không có từ khóa. Go nhìn vào **chữ cái đầu**: <mark>Check</mark>, <mark>Result</mark>, <mark>StatusUp</mark> viết hoa là **exported**, package khác dùng được; <mark>check</mark>, <mark>result</mark> viết thường chỉ dùng trong package. Luật này áp dụng cho cả hàm, kiểu, biến, hằng và **trường của struct**: struct <mark>Result</mark> có trường <mark>url</mark> viết thường thì <mark>encoding/json</mark> (một package khác) cũng không đọc được, JSON sẽ trống. Đó là lý do mọi trường trong <mark>Result</mark> đều viết hoa.

#### Bước 1: Package checker
Tạo <mark>internal/checker/checker.go</mark>, chuyển nội dung <mark>check.go</mark> sang, đổi <mark>package main</mark> thành <mark>package checker</mark>, viết hoa những gì cần export:
```go
// internal/checker/checker.go
// Package checker gọi vào URL và cho biết nó sống hay chết.
package checker

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// Status là kết quả của một lần kiểm tra.
type Status string

const (
	StatusUp   Status = "up"
	StatusDown Status = "down"
)

// Result là mọi thứ ta biết sau khi gọi vào một URL.
type Result struct {
	URL        string    `json:"url"`
	Status     Status    `json:"status"`
	StatusCode int       `json:"status_code"`
	LatencyMS  int64     `json:"latency_ms"`
	Error      string    `json:"error,omitempty"`
	CheckedAt  time.Time `json:"checked_at"`
}

// Checker giữ một http.Client dùng chung cho mọi lần kiểm tra.
type Checker struct {
	client *http.Client
}

// New tạo Checker với thời gian chờ tối đa cho mỗi request.
func New(timeout time.Duration) *Checker {
	return &Checker{client: &http.Client{Timeout: timeout}}
}

// Check gọi vào url và trả về Result. Không bao giờ panic, lỗi nằm trong Result.
func (c *Checker) Check(ctx context.Context, url string) Result {
	r := Result{URL: url, CheckedAt: time.Now()}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		r.Status = StatusDown
		r.Error = err.Error()
		return r
	}
	req.Header.Set("User-Agent", "pulse/1.0")

	start := time.Now()
	resp, err := c.client.Do(req)
	r.LatencyMS = time.Since(start).Milliseconds()
	if err != nil {
		r.Status = StatusDown
		r.Error = err.Error()
		return r
	}
	defer resp.Body.Close()

	r.StatusCode = resp.StatusCode
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		r.Status = StatusUp
	} else {
		r.Status = StatusDown
		r.Error = "HTTP " + resp.Status
	}
	return r
}

// CheckAll kiểm tra nhiều URL cùng lúc với tối đa `workers` request song song.
// Kết quả trả về theo đúng thứ tự của urls.
func (c *Checker) CheckAll(ctx context.Context, urls []string, workers int) []Result {
	type job struct {
		index int
		url   string
	}
	jobs := make(chan job)
	results := make([]Result, len(urls))

	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				results[j.index] = c.Check(ctx, j.url)
			}
		}()
	}

send:
	for i, url := range urls {
		select {
		case jobs <- job{i, url}:
		case <-ctx.Done():
			break send // người dùng bấm Ctrl+C: ngừng phát việc mới
		}
	}
	close(jobs)
	wg.Wait()

	// URL chưa kịp kiểm tra (do Ctrl+C) vẫn còn giá trị zero, điền cho đủ.
	for i := range results {
		if results[i].Status == "" {
			results[i] = Result{URL: urls[i], Status: StatusDown, Error: "bị hủy"}
		}
	}
	return results
}
```
Ba thứ mới so với bài 3:

**Comment trên package.** Dòng <mark>// Package checker ...</mark> ngay trên <mark>package checker</mark> là tài liệu của package. Gõ <mark>go doc ./internal/checker</mark> sẽ in ra comment này cùng danh sách hàm exported, và comment trên mỗi hàm exported (<mark>// New tạo Checker...</mark>) cũng hiện ở đó. Quy ước: comment bắt đầu bằng đúng tên của thứ nó mô tả.

**Method và receiver.** <mark>func (c *Checker) Check(...)</mark> là một **method** gắn vào kiểu <mark>Checker</mark>. Phần <mark>(c *Checker)</mark> gọi là **receiver**: bên trong hàm, <mark>c</mark> chính là struct đang được gọi, giống <mark>this</mark>/<mark>self</mark> ở ngôn ngữ khác nhưng phải đặt tên rõ ràng. Gọi bằng <mark>chk.Check(ctx, url)</mark>. Receiver là **con trỏ** <mark>*Checker</mark> để không copy struct mỗi lần gọi và để method có thể sửa struct nếu cần; quy tắc đơn giản: struct có method con trỏ thì mọi method của nó đều dùng con trỏ.

Vì sao biến <mark>client</mark> thành struct thay vì truyền <mark>*http.Client</mark> vào từng hàm như bài 3? Vì bài 5 server sẽ giữ một <mark>Checker</mark> suốt vòng đời, gọi <mark>Check</mark> hàng nghìn lần; gói client vào struct thì nơi gọi chỉ cần biết "có một Checker", không cần biết bên trong có gì.

**Hàm tạo <mark>New</mark>.** Go không có constructor. Quy ước là một hàm <mark>New</mark> (hoặc <mark>NewXxx</mark>) trả về <mark>*Checker</mark> đã cấu hình xong. Trường <mark>client</mark> viết thường, nên bên ngoài package **không thể** tự tạo <mark>Checker{client: ...}</mark>, bắt buộc đi qua <mark>New</mark>: đây là cách Go ép người dùng khởi tạo đúng.

#### Bước 2: Package sites
```go
// internal/sites/sites.go
// Package sites đọc danh sách URL cần kiểm tra.
package sites

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"
)

// ReadFile đọc danh sách URL từ file, mỗi dòng một URL.
func ReadFile(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("đọc danh sách: %w", err)
	}
	defer f.Close()
	return Read(f)
}

// Read đọc danh sách URL từ bất kỳ nguồn nào (file, stdin, chuỗi...).
// Bỏ qua dòng trống, dòng bắt đầu bằng # và URL trùng.
func Read(r io.Reader) ([]string, error) {
	var urls []string
	seen := map[string]bool{}

	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !strings.HasPrefix(line, "http://") && !strings.HasPrefix(line, "https://") {
			line = "https://" + line
		}
		if seen[line] {
			continue
		}
		seen[line] = true
		urls = append(urls, line)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("đọc danh sách: %w", err)
	}
	if len(urls) == 0 {
		return nil, fmt.Errorf("danh sách không có URL nào")
	}
	return urls, nil
}
```
Hàm <mark>readSites(path)</mark> cũ bị tách làm hai: <mark>ReadFile</mark> chỉ lo mở file, còn <mark>Read</mark> nhận một <mark>io.Reader</mark> và làm toàn bộ việc phân tích. Lý do là **test**: muốn thử "dòng trống và dòng # bị bỏ qua chưa" mà phải tạo file thật trên đĩa thì phiền; với <mark>Read</mark>, truyền <mark>strings.NewReader("...")</mark> là xong. Đây là mẫu rất Go: hàm nhận **interface** nhỏ nhất đủ dùng, thay vì nhận kiểu cụ thể.

#### Interface
<mark>io.Reader</mark> là interface nổi tiếng nhất của Go. Định nghĩa của nó trong thư viện chuẩn chỉ có một method:
```go
type Reader interface {
	Read(p []byte) (n int, err error)
}
```
Bất kỳ kiểu nào có method <mark>Read</mark> đúng chữ ký này **tự động** là một <mark>io.Reader</mark>. Không có từ khóa <mark>implements</mark>, không phải khai báo gì: <mark>*os.File</mark> có <mark>Read</mark>, <mark>*strings.Reader</mark> có <mark>Read</mark>, body của HTTP response có <mark>Read</mark>, nên cả ba đều truyền được vào <mark>sites.Read</mark>. Go gọi đây là **implicit interface**: hàm chỉ nói "tôi cần thứ gì đọc được", không quan tâm thứ đó là gì.

Người anh em của nó là <mark>io.Writer</mark> với method <mark>Write(p []byte)</mark>. <mark>os.Stdout</mark> là <mark>*os.File</mark>, file bạn tạo bằng <mark>os.Create</mark> cũng là <mark>*os.File</mark>, <mark>bytes.Buffer</mark> cũng có <mark>Write</mark>. Vậy nếu hàm in báo cáo nhận <mark>io.Writer</mark> thay vì tự gọi <mark>fmt.Println</mark>, thì cùng một hàm vừa in ra màn hình, vừa ghi file, vừa ghi vào bộ nhớ để test. Đó chính là package report.

#### Bước 3: Package report
```go
// internal/report/report.go
// Package report in kết quả kiểm tra ra nhiều định dạng.
package report

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/thachnguyenp/pulse/internal/checker"
)

// Reporter ghi danh sách kết quả ra một nơi nào đó (màn hình, file...).
type Reporter interface {
	Write(w io.Writer, results []checker.Result) error
}

// Formats ánh xạ tên định dạng sang Reporter tương ứng.
var Formats = map[string]Reporter{
	"table": Table{},
	"json":  JSON{},
	"csv":   CSV{},
}

// Table in dạng bảng dễ đọc cho người.
type Table struct{}

func (Table) Write(w io.Writer, results []checker.Result) error {
	fmt.Fprintf(w, "%-6s %-5s %7s  %s\n", "STATUS", "CODE", "LATENCY", "URL")
	up := 0
	for _, r := range results {
		code := "-"
		if r.StatusCode != 0 {
			code = strconv.Itoa(r.StatusCode)
		}
		fmt.Fprintf(w, "%-6s %-5s %5dms  %s", r.Status, code, r.LatencyMS, r.URL)
		if r.Error != "" {
			fmt.Fprintf(w, "  (%s)", r.Error)
		}
		fmt.Fprintln(w)
		if r.Status == checker.StatusUp {
			up++
		}
	}
	_, err := fmt.Fprintf(w, "\n%d sites: %d up, %d down\n", len(results), up, len(results)-up)
	return err
}

// JSON in dạng JSON cho máy đọc.
type JSON struct{}

func (JSON) Write(w io.Writer, results []checker.Result) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(results)
}

// CSV in dạng CSV, mở được bằng Excel.
type CSV struct{}

func (CSV) Write(w io.Writer, results []checker.Result) error {
	cw := csv.NewWriter(w)
	cw.Write([]string{"url", "status", "status_code", "latency_ms", "error", "checked_at"})
	for _, r := range results {
		cw.Write([]string{
			r.URL,
			string(r.Status),
			strconv.Itoa(r.StatusCode),
			strconv.FormatInt(r.LatencyMS, 10),
			r.Error,
			r.CheckedAt.Format("2006-01-02 15:04:05"),
		})
	}
	cw.Flush()
	return cw.Error()
}
```
Đây là lần đầu ta **tự định nghĩa interface**. <mark>Reporter</mark> chỉ đòi một method <mark>Write(w, results) error</mark>. Ba kiểu <mark>Table</mark>, <mark>JSON</mark>, <mark>CSV</mark> là struct rỗng (không có dữ liệu, chỉ có hành vi), mỗi kiểu có method <mark>Write</mark> đúng chữ ký, nên cả ba đều là <mark>Reporter</mark>. Map <mark>Formats</mark> khai báo kiểu giá trị là <mark>Reporter</mark>, tức là có thể chứa cả ba; nếu bạn lỡ viết sai chữ ký ở một kiểu, dòng <mark>"json": JSON{}</mark> sẽ **không compile**, báo rõ thiếu method nào. Đó là cách Go kiểm tra interface: ở chỗ dùng, lúc biên dịch.

Để ý receiver <mark>func (Table) Write</mark> không đặt tên: struct rỗng, không có gì để đọc, nên bỏ tên cho gọn. Và vì struct rỗng không cần copy gì, receiver dùng giá trị thay vì con trỏ.

Lợi ích cụ thể: bài 3, main có ba nhánh <mark>if jsonOut != "" ... if csvOut != "" ...</mark> cùng các hàm <mark>printTable</mark>, <mark>writeJSON</mark>, <mark>writeCSV</mark> mỗi hàm tự mở file. Giờ main chỉ cần tra map rồi gọi <mark>Write</mark>; thêm định dạng mới (HTML chẳng hạn) là thêm một struct và một dòng trong map, main không đổi.

Phần <mark>fmt.Fprintf(w, ...)</mark> giống <mark>Printf</mark> nhưng ghi vào <mark>w</mark> thay vì màn hình. Bài 3 từng dùng <mark>Printf</mark>; giờ bạn hiểu <mark>Printf</mark> chỉ là <mark>Fprintf(os.Stdout, ...)</mark>.

#### Bước 4: Hai chương trình trong cmd/
Chuyển <mark>fakeweb/main.go</mark> thành <mark>cmd/fakeweb/main.go</mark> (nội dung giữ nguyên), và viết lại main của pulse:
```go
// cmd/pulse/main.go
// pulse: kiểm tra một danh sách URL, in kết quả.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"time"

	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/report"
	"github.com/thachnguyenp/pulse/internal/sites"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Lỗi:", err)
		os.Exit(1)
	}
}

func run() error {
	file := flag.String("file", "sites.txt", "file chứa danh sách URL")
	timeout := flag.Duration("timeout", 5*time.Second, "thời gian chờ tối đa mỗi request")
	workers := flag.Int("workers", 10, "số request chạy song song")
	format := flag.String("format", "table", "định dạng kết quả: table, json, csv")
	out := flag.String("out", "", "ghi kết quả ra file này thay vì màn hình")
	flag.Parse()

	reporter, ok := report.Formats[*format]
	if !ok {
		return fmt.Errorf("không có định dạng %q", *format)
	}

	urls, err := sites.ReadFile(*file)
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("không thấy file %s, tạo file với mỗi dòng một URL rồi chạy lại", *file)
	}
	if err != nil {
		return err
	}

	// ctx bị hủy khi người dùng bấm Ctrl+C.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	c := checker.New(*timeout)
	results := c.CheckAll(ctx, urls, *workers)

	var w io.Writer = os.Stdout
	if *out != "" {
		f, err := os.Create(*out)
		if err != nil {
			return err
		}
		defer f.Close()
		w = f
	}
	return reporter.Write(w, results)
}
```
Xóa <mark>main.go</mark>, <mark>check.go</mark>, <mark>sites.go</mark>, <mark>report.go</mark> ở thư mục gốc. Những điểm mới:

- **Mẫu <mark>run() error</mark>.** Bài 1-3, mỗi chỗ lỗi là một cặp <mark>fmt.Println</mark> + <mark>os.Exit(1)</mark>, rải khắp main. Giờ mọi logic nằm trong <mark>run</mark>, chỉ <mark>return err</mark>; <mark>main</mark> là nơi **duy nhất** in lỗi và thoát. Thêm một lợi ích: <mark>os.Exit</mark> thoát ngay lập tức, **không chạy <mark>defer</mark>**; gom về một chỗ thì các <mark>defer f.Close()</mark>, <mark>defer stop()</mark> trong <mark>run</mark> luôn được chạy. Lỗi in ra <mark>os.Stderr</mark> thay vì stdout, để <mark>pulse -format json &gt; out.json</mark> không bị lẫn dòng lỗi vào file JSON.
- **<mark>var w io.Writer = os.Stdout</mark>.** Khai báo biến với kiểu là interface, gán mặc định là màn hình, nếu có <mark>-out</mark> thì gán file. Hàm <mark>reporter.Write(w, ...)</mark> không cần biết <mark>w</mark> là gì. Đây là ví dụ sống của interface: một dòng <mark>if</mark> để chọn đích, **không có <mark>if</mark> nào** ở chỗ ghi.
- Hai cờ <mark>-json</mark>, <mark>-csv</mark> gộp thành <mark>-format</mark> + <mark>-out</mark>: gọn hơn và mở rộng được.

Chạy thử, lưu ý đường dẫn <mark>./cmd/pulse</mark> thay vì <mark>.</mark>:
```sh
go build ./...                       # biên dịch mọi package, báo lỗi nếu có
go run ./cmd/fakeweb                 # cửa sổ 1
go run ./cmd/pulse -file local.txt   # cửa sổ 2
```
```
STATUS CODE  LATENCY  URL
up     200      21ms  http://localhost:8080/fast
up     200    3022ms  http://localhost:8080/slow
up     200      21ms  http://localhost:8080/flaky
down   503      21ms  http://localhost:8080/down  (HTTP 503 Service Unavailable)

4 sites: 3 up, 1 down
```
```sh
go run ./cmd/pulse -file local.txt -format json -out ket-qua.json
go run ./cmd/pulse -format xml
```
```
Lỗi: không có định dạng "xml"
exit status 1
```
<mark>./...</mark> nghĩa là "thư mục này và mọi thư mục con", dùng được với <mark>go build</mark>, <mark>go test</mark>, <mark>go vet</mark>. <mark>go build ./...</mark> không tạo file binary nào cho package trong <mark>internal/</mark> (chúng là thư viện), chỉ kiểm tra biên dịch. Muốn binary thật: <mark>go build -o pulse ./cmd/pulse</mark>.

#### Bước 5: Test
Go có sẵn công cụ test, không cần cài gì. Quy ước: file test tên <mark>xxx_test.go</mark>, đặt **cùng thư mục** với code (nên cùng package, nhìn thấy cả hàm viết thường), mỗi hàm test tên <mark>TestXxx(t *testing.T)</mark>. Chạy <mark>go test ./...</mark>.

Bắt đầu với package đơn giản nhất:
```go
// internal/sites/sites_test.go
package sites

import (
	"slices"
	"strings"
	"testing"
)

func TestRead(t *testing.T) {
	input := `
# ghi chú
https://a.com
b.com

https://a.com
`
	got, err := Read(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"https://a.com", "https://b.com"}
	if !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestReadEmpty(t *testing.T) {
	_, err := Read(strings.NewReader("# chỉ có ghi chú\n"))
	if err == nil {
		t.Error("danh sách rỗng phải báo lỗi")
	}
}
```
Không có <mark>assert</mark>, không có <mark>expect(...).toBe(...)</mark>: test Go là code Go bình thường, so sánh bằng <mark>if</mark>, sai thì gọi <mark>t.Errorf</mark>. Hai hàm báo lỗi:
- <mark>t.Error / t.Errorf</mark>: đánh dấu test **fail nhưng chạy tiếp**, để một lần chạy thấy hết mọi lỗi.
- <mark>t.Fatal / t.Fatalf</mark>: fail và **dừng ngay** hàm test này. Dùng khi bước sau vô nghĩa nếu bước này hỏng (đọc lỗi thì không còn gì để so sánh).

Chuỗi trong cặp dấu huyền <mark>`...`</mark> là **raw string**: viết nhiều dòng, không cần <mark>\n</mark>, rất hợp để nhúng dữ liệu mẫu. <mark>slices.Equal</mark> so sánh hai slice từng phần tử (slice không so được bằng <mark>==</mark>).

Giờ tới package checker. Vấn đề: muốn test <mark>Check</mark> thì cần một web server để gọi vào, mà gọi ra Internet thật thì chậm, không ổn định, và không thể ép nó trả 500 khi mình muốn. Thư viện chuẩn có <mark>net/http/httptest</mark>: dựng một server thật trong bộ nhớ, trên một cổng ngẫu nhiên, sống đúng trong lúc test.
```go
// internal/checker/checker_test.go
package checker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// newFakeServer dựng một web server trong bộ nhớ, chỉ sống trong lúc test.
func newFakeServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/ok", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/error", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestCheck(t *testing.T) {
	srv := newFakeServer(t)
	c := New(100 * time.Millisecond)

	tests := []struct {
		name       string
		url        string
		wantStatus Status
		wantCode   int
	}{
		{"trang ok", srv.URL + "/ok", StatusUp, 200},
		{"server lỗi 500", srv.URL + "/error", StatusDown, 500},
		{"quá chậm", srv.URL + "/slow", StatusDown, 0},
		{"không kết nối được", "http://127.0.0.1:1", StatusDown, 0},
		{"url sai", "::không phải url", StatusDown, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := c.Check(context.Background(), tt.url)
			if got.Status != tt.wantStatus {
				t.Errorf("Status = %q, muốn %q (error: %s)", got.Status, tt.wantStatus, got.Error)
			}
			if got.StatusCode != tt.wantCode {
				t.Errorf("StatusCode = %d, muốn %d", got.StatusCode, tt.wantCode)
			}
			if got.Status == StatusDown && got.Error == "" {
				t.Error("down thì phải có Error")
			}
		})
	}
}

func TestCheckAll(t *testing.T) {
	srv := newFakeServer(t)
	c := New(time.Second)

	urls := []string{srv.URL + "/ok", srv.URL + "/error", srv.URL + "/ok"}
	results := c.CheckAll(context.Background(), urls, 2)

	if len(results) != 3 {
		t.Fatalf("có %d kết quả, muốn 3", len(results))
	}
	for i, r := range results {
		if r.URL != urls[i] {
			t.Errorf("kết quả %d là %s, muốn %s (sai thứ tự)", i, r.URL, urls[i])
		}
	}
	if results[1].Status != StatusDown {
		t.Errorf("/error phải down")
	}
}

func TestCheckAllCancel(t *testing.T) {
	srv := newFakeServer(t)
	c := New(time.Second)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // hủy ngay từ đầu, giống bấm Ctrl+C trước khi chạy

	results := c.CheckAll(ctx, []string{srv.URL + "/ok", srv.URL + "/ok"}, 1)
	for _, r := range results {
		if r.Status != StatusDown {
			t.Errorf("%s phải down vì đã hủy, nhận %s", r.URL, r.Status)
		}
	}
}
```
Bốn kỹ thuật ở đây bạn sẽ dùng lại suốt đời làm Go:

**Table-driven test.** <mark>TestCheck</mark> không viết 5 hàm test cho 5 tình huống, mà khai báo một slice các trường hợp (bảng), rồi lặp. Thêm trường hợp = thêm một dòng. Mỗi dòng là một struct ẩn danh (<mark>[]struct{...}{...}</mark>: khai báo kiểu và dữ liệu cùng lúc).

**Subtest <mark>t.Run</mark>.** Mỗi dòng trong bảng chạy như một test con có tên riêng. Khi fail, output ghi rõ <mark>TestCheck/quá_chậm</mark>, và bạn chạy riêng một ca bằng <mark>go test -run 'TestCheck/quá' ./internal/checker</mark>.

**<mark>t.Helper</mark> và <mark>t.Cleanup</mark>.** <mark>newFakeServer</mark> là hàm phụ trợ; gọi <mark>t.Helper()</mark> để khi có lỗi, Go báo số dòng ở **test gọi nó**, không phải dòng trong hàm phụ. <mark>t.Cleanup(srv.Close)</mark> đăng ký việc dọn dẹp chạy khi test xong, dù test pass hay fail, giống <mark>defer</mark> nhưng gắn vào vòng đời test, nên hàm phụ trợ có thể trả server về mà không bắt người gọi phải nhớ đóng.

**Ép tình huống xấu.** <mark>/slow</mark> ngủ 200ms trong khi <mark>Checker</mark> chỉ chờ 100ms: test timeout mà không cần web nào chậm thật. <mark>127.0.0.1:1</mark> là cổng không ai mở: test "connection refused" chắc chắn. Nhớ bài 3: những thứ khó tái hiện ngoài đời (mạng chập chờn, server sập) là thứ **dễ nhất** để dựng trong test.

Cuối cùng là report, dùng <mark>bytes.Buffer</mark> làm <mark>io.Writer</mark> trong bộ nhớ:
```go
// internal/report/report_test.go
package report

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/thachnguyenp/pulse/internal/checker"
)

var sample = []checker.Result{
	{URL: "https://a.com", Status: checker.StatusUp, StatusCode: 200, LatencyMS: 120},
	{URL: "https://b.com", Status: checker.StatusDown, Error: "connection refused"},
}

func TestTable(t *testing.T) {
	var buf bytes.Buffer
	if err := (Table{}).Write(&buf, sample); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, want := range []string{"https://a.com", "connection refused", "1 up, 1 down"} {
		if !strings.Contains(out, want) {
			t.Errorf("thiếu %q trong:\n%s", want, out)
		}
	}
}

func TestJSON(t *testing.T) {
	var buf bytes.Buffer
	if err := (JSON{}).Write(&buf, sample); err != nil {
		t.Fatal(err)
	}
	var back []checker.Result
	if err := json.Unmarshal(buf.Bytes(), &back); err != nil {
		t.Fatalf("JSON không hợp lệ: %v", err)
	}
	if len(back) != 2 || back[1].Error != "connection refused" {
		t.Errorf("đọc lại được %+v", back)
	}
}

func TestCSV(t *testing.T) {
	var buf bytes.Buffer
	if err := (CSV{}).Write(&buf, sample); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 3 {
		t.Errorf("CSV có %d dòng, muốn 3 (1 header + 2 dữ liệu)", len(lines))
	}
}
```
Đây là lý do thứ hai <mark>Write</mark> nhận <mark>io.Writer</mark>: test không phải tạo file tạm, không phải bắt stdout. Ghi vào <mark>&amp;buf</mark> (con trỏ, vì <mark>Write</mark> của <mark>Buffer</mark> có receiver con trỏ) rồi đọc lại bằng <mark>buf.String()</mark>.

Chạy toàn bộ:
```sh
go test -race -cover ./...
```
```
	github.com/thachnguyenp/pulse/cmd/fakeweb		coverage: 0.0% of statements
	github.com/thachnguyenp/pulse/cmd/pulse		coverage: 0.0% of statements
ok  	github.com/thachnguyenp/pulse/internal/checker	2.527s	coverage: 100.0% of statements
ok  	github.com/thachnguyenp/pulse/internal/report	1.863s	coverage: 100.0% of statements
ok  	github.com/thachnguyenp/pulse/internal/sites	1.417s	coverage: 73.9% of statements
```
<mark>-race</mark> bật bộ phát hiện race (bài 3), rất nên bật luôn vì checker có goroutine. <mark>-cover</mark> in tỉ lệ dòng code được test chạm tới; <mark>sites</mark> chỉ 73.9% vì <mark>ReadFile</mark> (nhánh mở file lỗi) chưa có test, là bài tập cuối bài. Hai package <mark>cmd/</mark> không có test, bình thường: main chỉ ghép các mảnh lại, logic đã nằm trong <mark>internal/</mark>.

Vài lệnh hữu ích:
```sh
go test -run TestCheck -v ./internal/checker   # chỉ chạy TestCheck, in từng subtest
go test -count=1 ./...                         # bỏ cache kết quả, chạy lại thật
go vet ./...                                   # bắt lỗi logic phổ biến (Printf sai đối số, copy mutex...)
gofmt -l .                                     # liệt kê file chưa đúng định dạng chuẩn
go doc ./internal/report Reporter              # xem tài liệu của một kiểu
```
Go cache kết quả test: chạy lại mà code không đổi thì in <mark>(cached)</mark> ngay lập tức. Và <mark>gofmt</mark> là chuẩn định dạng **duy nhất** của cộng đồng Go: không tranh cãi tab hay space, mọi dự án nhìn giống nhau. Cài extension Go cho VS Code thì file tự format khi lưu.

#### Mẹo và lỗi hay gặp
- **"use of internal package ... not allowed"**: bạn đang import <mark>internal/</mark> từ một module khác. Chỉ code trong cùng module (cùng <mark>go.mod</mark>) mới được dùng.
- **"undefined: checker.check"**: hàm viết thường không export. Nếu package khác cần, viết hoa; nếu chỉ dùng nội bộ, giữ thường. Mặc định giữ thường, chỉ export cái gì thật sự cần.
- **Import cycle**: package A import B và B import A, Go từ chối biên dịch. Cách chữa thường là tách phần dùng chung ra package thứ ba, hoặc chuyển sang interface. Cấu trúc hiện tại không có vòng: <mark>report</mark> dùng <mark>checker</mark>, <mark>cmd/pulse</mark> dùng cả ba, không ai dùng ngược lại.
- **Test chạy ngoài thư mục gốc**: <mark>go test ./...</mark> phải chạy ở thư mục có <mark>go.mod</mark>. Đứng trong <mark>internal/checker</mark> thì <mark>go test .</mark> hoặc <mark>go test ./...</mark> đều chỉ chạy package đó.
- **Đặt tên test**: tên subtest có dấu cách được, Go tự đổi thành gạch dưới khi in. Tiếng Việt có dấu cũng được.

#### Checklist
- Cây thư mục giống "Kết quả cuối bài", thư mục gốc không còn file <mark>.go</mark> nào.
- <mark>go build ./...</mark> không lỗi; <mark>go vet ./...</mark> im lặng.
- <mark>go test -race -cover ./...</mark>: ba package <mark>internal/</mark> đều <mark>ok</mark>.
- <mark>go run ./cmd/pulse -file local.txt -format csv -out a.csv</mark> tạo file, <mark>-format xml</mark> báo lỗi và thoát mã 1.

Mã nguồn cuối bài: [post_153.zip](/assets/code/post_153.zip).

#### Bài tập thêm
- Viết <mark>TestReadFile</mark> trong <mark>sites_test.go</mark>: dùng <mark>t.TempDir()</mark> tạo thư mục tạm, ghi một file bằng <mark>os.WriteFile</mark>, gọi <mark>ReadFile</mark>; và một ca file không tồn tại phải trả lỗi mà <mark>errors.Is(err, fs.ErrNotExist)</mark> đúng. Chạy lại <mark>-cover</mark> xem <mark>sites</mark> lên bao nhiêu.
- Thêm định dạng <mark>"markdown"</mark> vào <mark>report</mark>: một struct <mark>Markdown</mark> in bảng dạng <mark>| URL | Status |</mark> để dán vào GitHub issue. Chỉ được sửa file trong <mark>internal/report</mark>, không đụng <mark>cmd/pulse</mark>.
- Viết benchmark <mark>func BenchmarkTable(b *testing.B)</mark> với 1000 kết quả mẫu, vòng lặp <mark>for b.Loop()</mark>, chạy <mark>go test -bench . ./internal/report</mark>. Đọc output xem mỗi lần in tốn bao nhiêu nano giây và cấp phát bao nhiêu lần (<mark>-benchmem</mark>).
