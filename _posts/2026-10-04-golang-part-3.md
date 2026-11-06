---
layout: post
title:  "152. Go cho người mới (Bài 3: Goroutine, Channel & Context)."
date:   2026-10-04 13:20:00 +0700
author: thach
categories: [Coding]
tags: [Golang]
image: assets/images/post_152/go-concurrency.png
---
Pulse đang kiểm tra lần lượt: site này xong mới tới site kia. 5 site mất 4 giây, 200 site mất hơn một phút, mà phần lớn thời gian chương trình chỉ **ngồi chờ mạng**. Bài này cho Pulse kiểm tra nhiều site **cùng lúc**, và đi qua đúng con đường mà mọi lập trình viên Go đều đi: thử ngây thơ, gặp data race, sửa bằng mutex, giới hạn bằng worker pool, rồi hủy được bằng Ctrl+C với context. Đây là phần Go khác biệt nhất so với Ruby và Node, và là lý do chính người ta chọn Go.

#### Kết quả cuối bài
```sh
go run . -file many.txt -workers 1
# 200 sites: 200 up, 0 down
# Xong trong 1m0.833s với 1 workers

go run . -file many.txt -workers 10
# Xong trong 6.436s với 10 workers

go run . -file many.txt -workers 50
# Xong trong 1.449s với 50 workers
```
Cùng 200 site, cùng máy, từ 61 giây xuống 1.4 giây bằng cách thay một con số.

#### Bước 1: Một web server giả để thử
Không nên bắn 200 request vào Google để học. Go có sẵn HTTP server trong thư viện chuẩn, nên viết một web giả chỉ mất 30 dòng. Tạo thư mục <mark>fakeweb/</mark> với một file:
```go
// fakeweb/main.go
// fakeweb là một web server giả để thử pulse mà không cần Internet.
// Chạy: go run ./fakeweb
package main

import (
	"fmt"
	"math/rand"
	"net/http"
	"time"
)

func main() {
	http.HandleFunc("/fast", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	http.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(3 * time.Second)
		fmt.Fprintln(w, "ok, nhưng chậm")
	})
	http.HandleFunc("/flaky", func(w http.ResponseWriter, r *http.Request) {
		if rand.Intn(2) == 0 {
			http.Error(w, "lúc được lúc không", http.StatusInternalServerError)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	http.HandleFunc("/down", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bảo trì", http.StatusServiceUnavailable)
	})
	// /site/1, /site/2, ... mỗi site trả lời sau 100-500ms, giống web thật.
	http.HandleFunc("/site/", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(time.Duration(100+rand.Intn(400)) * time.Millisecond)
		fmt.Fprintln(w, "ok")
	})

	fmt.Println("fakeweb chạy ở http://localhost:8080")
	http.ListenAndServe(":8080", nil)
}
```
Đây là một chương trình thứ hai, cũng <mark>package main</mark>, nằm trong thư mục con. Một module có thể chứa nhiều chương trình, mỗi chương trình một thư mục. Mở terminal thứ hai, chạy <mark>go run ./fakeweb</mark> và để đó.

Bạn vừa gặp HTTP server của Go sớm hơn dự kiến, bài 154 mới học kỹ. Hôm nay chỉ cần biết: <mark>http.HandleFunc(đường dẫn, hàm)</mark> gắn một hàm cho một URL, hàm nhận <mark>w</mark> để ghi câu trả lời và <mark>r</mark> là request; <mark>http.ListenAndServe(":8080", nil)</mark> mở cổng 8080 và chạy mãi. Các route: <mark>/fast</mark> trả lời ngay, <mark>/slow</mark> mất 3 giây, <mark>/flaky</mark> ngẫu nhiên lỗi 500, <mark>/down</mark> luôn 503, và <mark>/site/bất-kỳ</mark> trả lời sau 100 tới 500 mili giây ngẫu nhiên, giống web thật ngoài kia.

Hàm viết ngay tại chỗ làm tham số (<mark>func(w, r) { ... }</mark>) là **hàm ẩn danh**, giống arrow function trong JavaScript hay block trong Ruby. Go dùng rất nhiều, nhất là với goroutine bên dưới.

Tạo hai file danh sách. <mark>local.txt</mark> với 4 route đầu:
```
# local.txt
http://localhost:8080/fast
http://localhost:8080/slow
http://localhost:8080/flaky
http://localhost:8080/down
```
Và <mark>many.txt</mark> với 200 site, tạo bằng shell:
```sh
for i in {1..200}; do echo http://localhost:8080/site/$i; done > many.txt
```
Chạy code bài trước với <mark>many.txt</mark> (hoặc <mark>-workers 1</mark> với code cuối bài): **1 phút 0.8 giây**. Trung bình mỗi site 300ms, nhân 200. CPU gần như ngủ suốt thời gian đó.

#### Bước 2: Thử ngây thơ với goroutine, và gặp data race
**Goroutine** là một hàm chạy đồng thời với phần còn lại của chương trình. Tạo bằng cách viết <mark>go</mark> trước lời gọi hàm. Thế thôi. Goroutine không phải thread của hệ điều hành: mỗi cái tốn vài KB bộ nhớ (thread tốn khoảng 1MB), tạo trong vài trăm nano giây, và runtime của Go tự xếp hàng nghìn goroutine lên vài thread thật, trên mọi lõi CPU. Mở 10 nghìn goroutine là chuyện bình thường. Nếu bạn đọc bài 101 về GVL của Ruby: Go **không có GVL**, hai goroutine tính toán nặng thực sự chạy trên hai lõi. Nếu bạn quen Node: không có event loop một luồng và không có <mark>async/await</mark> (bài 044), hàm chặn (blocking) cứ viết bình thường, runtime lo việc chuyển qua goroutine khác trong lúc chờ mạng.

Thử phiên bản đầu tiên, đừng dùng thật, chỉ để thấy nó sai ở đâu:
```go
// thử nghiệm, có lỗi
var results []Result
var wg sync.WaitGroup
for _, url := range urls {
	wg.Add(1)
	go func() {
		defer wg.Done()
		results = append(results, check(client, url))
	}()
}
wg.Wait()
```
<mark>sync.WaitGroup</mark> là bộ đếm: <mark>Add(1)</mark> trước khi tạo goroutine, <mark>Done()</mark> khi goroutine xong (đặt trong <mark>defer</mark> để chắc chắn được gọi), <mark>Wait()</mark> chặn tới khi bộ đếm về 0. Không có nó, <mark>main</mark> chạy tới cuối và thoát trước khi goroutine nào kịp làm gì, vì chương trình Go kết thúc khi <mark>main</mark> kết thúc, không chờ goroutine.

Chạy với cờ <mark>-race</mark>, công cụ phát hiện data race có sẵn của Go:
```sh
go run -race . -file many.txt
```
```
==================
WARNING: DATA RACE
Write at 0x00c000120018 by goroutine 8:
  main.main.func1()
      main.go:34 +0x...
Previous write at 0x00c000120018 by goroutine 7:
  main.main.func1()
      main.go:34 +0x...
==================
```
200 goroutine cùng <mark>append</mark> vào một slice. <mark>append</mark> đọc độ dài, ghi phần tử, cập nhật độ dài: ba bước, và hai goroutine chen vào giữa các bước của nhau. Kết quả là mất phần tử, hoặc tệ hơn, hỏng bộ nhớ. Đây chính là race condition của bài 081 (hai request cùng trừ tồn kho) và vấn đề thread safety của bài 102, nhưng ở mức bộ nhớ trong một process. Điểm đáng giá: Go **phát hiện được** nó bằng <mark>-race</mark>. Luôn chạy test với <mark>-race</mark> (bài 153), hầu hết lỗi concurrency lộ ra trước khi lên production.

#### Bước 3: Sửa bằng mutex, hoặc tốt hơn, không dùng chung
Cách sửa kinh điển: khóa lại khi đụng vào dữ liệu dùng chung.
```go
// thử nghiệm, đã đúng nhưng chưa phải cách hay nhất
var mu sync.Mutex
go func() {
	defer wg.Done()
	r := check(client, url)
	mu.Lock()
	results = append(results, r)
	mu.Unlock()
}()
```
<mark>sync.Mutex</mark> đảm bảo chỉ một goroutine ở giữa <mark>Lock</mark> và <mark>Unlock</mark> tại một thời điểm. Để ý <mark>check</mark> gọi **ngoài** vùng khóa: khóa chỉ bao đúng thao tác dùng chung, nếu khóa cả lúc chờ mạng thì lại thành chạy lần lượt.

Nhưng có cách không cần khóa: **cấp trước chỗ và mỗi goroutine ghi vào ô của riêng nó**.
```go
// thử nghiệm
results := make([]Result, len(urls))
for i, url := range urls {
	wg.Add(1)
	go func() {
		defer wg.Done()
		results[i] = check(client, url)
	}()
}
wg.Wait()
```
<mark>make([]Result, len(urls))</mark> tạo slice có sẵn 200 phần tử zero. Goroutine số <mark>i</mark> chỉ ghi vào <mark>results[i]</mark>, không goroutine nào khác đụng tới ô đó, nên không có race, không cần mutex, và kết quả **giữ đúng thứ tự** của danh sách đầu vào. Câu châm ngôn của Go là "đừng chia sẻ bộ nhớ để giao tiếp, hãy giao tiếp để chia sẻ bộ nhớ"; cách thực dụng hơn: thiết kế sao cho **không có gì để tranh giành**.

Về <mark>i</mark> và <mark>url</mark> trong hàm ẩn danh: hàm ẩn danh nhìn thấy biến của vòng lặp bên ngoài (closure). Từ Go 1.22, mỗi vòng lặp có biến <mark>i</mark>, <mark>url</mark> riêng, nên code trên đúng. Tài liệu cũ hay có dòng <mark>url := url</mark> ngay trong vòng lặp để tránh lỗi mọi goroutine cùng thấy giá trị cuối; với Go 1.22 trở lên không cần nữa.

Chạy lại: 200 site xong trong khoảng **0.5 giây**, bằng site chậm nhất. Vậy xong chưa?

#### Bước 4: Giới hạn bằng worker pool và channel
200 goroutine thì được, nhưng Pulse sau này kiểm tra hàng chục nghìn URL. Mở 50 nghìn kết nối cùng lúc sẽ hết file descriptor của hệ điều hành, bị firewall đối phương chặn vì giống tấn công, và làm nghẽn chính đường mạng của bạn. Cần giới hạn: tối đa N request đang chạy, số còn lại xếp hàng. Đó là **worker pool**, và công cụ để xếp hàng là **channel**.

Channel là một ống dẫn có kiểu: goroutine này đẩy giá trị vào, goroutine kia lấy ra. <mark>jobs := make(chan job)</mark> tạo channel chứa <mark>job</mark>. <mark>jobs &lt;- j</mark> gửi, <mark>j := &lt;-jobs</mark> nhận. Channel không có bộ đệm thì **gửi sẽ đứng chờ** tới khi có ai nhận, và nhận sẽ đứng chờ tới khi có ai gửi; đây là cách Go đồng bộ hai goroutine mà không cần khóa. <mark>close(jobs)</mark> báo "hết việc", và vòng <mark>for j := range jobs</mark> ở phía nhận tự kết thúc khi channel đóng và đã lấy hết.

Đây là phần lõi của <mark>checkAll</mark> trong code cuối bài (phiên bản đầy đủ có thêm context ở bước 5):
```go
// thử nghiệm: worker pool, chưa có context
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
			results[j.index] = check(client, j.url)
		}
	}()
}

for i, url := range urls {
	jobs <- job{i, url}
}
close(jobs)
wg.Wait()
```
Đọc theo thứ tự chạy:
1. Tạo <mark>workers</mark> goroutine (ví dụ 10). <mark>for range workers</mark> là vòng lặp N lần không cần biến đếm, có từ Go 1.22. Mỗi worker đứng chờ ở <mark>range jobs</mark>.
2. Vòng lặp chính đẩy từng việc vào channel. Vì channel không có bộ đệm, mỗi lần gửi phải có một worker rảnh đứng nhận; 10 worker đang bận thì vòng lặp chính **đứng chờ**. Đó chính là cơ chế giới hạn: không bao giờ có hơn 10 request đang chạy.
3. Hết danh sách, <mark>close(jobs)</mark>. Các worker làm nốt việc đang cầm, vòng <mark>range</mark> kết thúc, <mark>Done()</mark>.
4. <mark>wg.Wait()</mark> trả về khi cả 10 worker xong.

<mark>type job struct</mark> khai báo ngay trong hàm: kiểu chỉ dùng trong hàm thì đặt trong hàm. Mỗi việc mang theo <mark>index</mark> để worker biết ghi vào ô nào.

Số worker là một nút vặn: 1 worker là chạy lần lượt (61 giây), 10 worker là 6.4 giây, 50 worker là 1.4 giây. Tăng tiếp không nhanh hơn vì đã chạm tới thời gian của site chậm nhất. Trong thực tế bạn chọn theo cái gì nhỏ hơn: đường mạng của mình, hay mức mà bên kia chấp nhận.

#### Bước 5: Ctrl+C dừng ngay với context
Bấm Ctrl+C giữa chừng, chương trình chết ngay, kết quả đã kiểm tra mất hết, và các request dở dang bị cắt thô bạo. Trong một CLI thì tạm chấp nhận, nhưng Pulse sắp thành server chạy nền (bài 156) và tắt sạch sẽ là bắt buộc. Go giải quyết bằng <mark>context.Context</mark>.

Context là một giá trị mang theo tín hiệu "hủy đi". Tạo một context cha, truyền nó xuống mọi hàm làm việc lâu; khi context bị hủy, mọi hàm đang cầm nó đều biết qua channel <mark>ctx.Done()</mark>. Quy ước toàn Go: **context là tham số đầu tiên**, tên là <mark>ctx</mark>, của mọi hàm có thể chờ (gọi mạng, truy vấn database, ngủ). Thư viện chuẩn và mọi thư viện tử tế đều nhận nó.

Code cuối bài, <mark>check.go</mark>:
```go
// check.go
package main

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

// check gọi vào url và trả về Result. Không bao giờ panic, lỗi nằm trong Result.
// ctx bị hủy (Ctrl+C) thì request đang chạy bị cắt ngay.
func check(ctx context.Context, client *http.Client, url string) Result {
	r := Result{URL: url, CheckedAt: time.Now()}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		r.Status = StatusDown
		r.Error = err.Error()
		return r
	}

	start := time.Now()
	resp, err := client.Do(req)
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

// checkAll kiểm tra nhiều URL cùng lúc với tối đa `workers` request song song.
// Kết quả trả về theo đúng thứ tự của urls.
func checkAll(ctx context.Context, client *http.Client, urls []string, workers int) []Result {
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
				results[j.index] = check(ctx, client, j.url)
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
Ba thay đổi so với bước 4:

**<mark>http.NewRequestWithContext</mark>** thay cho <mark>client.Get</mark>: request mang theo context. Khi context bị hủy, request đang chờ mạng bị cắt ngay và <mark>client.Do</mark> trả lỗi <mark>context canceled</mark>. Không còn goroutine nào kẹt chờ server chậm trả lời.

**<mark>select</mark>** là <mark>switch</mark> cho channel: chờ **nhiều** channel cùng lúc, nhánh nào sẵn sàng trước thì chạy. Ở đây hoặc gửi được việc cho worker, hoặc nhận tín hiệu hủy. Không có <mark>select</mark>, dòng <mark>jobs &lt;- job{i, url}</mark> sẽ đứng chờ worker rảnh và không bao giờ biết người dùng đã bấm Ctrl+C. <mark>ctx.Done()</mark> là channel được đóng khi context bị hủy, nên nhánh <mark>&lt;-ctx.Done()</mark> trở nên sẵn sàng ngay lúc đó.

**Nhãn <mark>send:</mark>** và **<mark>break send</mark>**: <mark>break</mark> thường chỉ thoát khỏi <mark>select</mark>, không thoát khỏi vòng <mark>for</mark> bao ngoài. Đặt nhãn cho vòng <mark>for</mark> và <mark>break</mark> theo nhãn để thoát hẳn. Sau đó vẫn <mark>close(jobs)</mark> và <mark>wg.Wait()</mark> như bình thường: các worker đang cầm request sẽ nhận lỗi hủy, ghi kết quả, thoát. Cuối cùng điền "bị hủy" cho các ô còn giá trị zero (nhận ra nhờ <mark>Status == ""</mark>), để bảng in ra vẫn đủ 200 dòng.

Trong <mark>main.go</mark>, tạo context từ tín hiệu hệ điều hành và thêm flag <mark>-workers</mark>:
```go
// main.go
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"time"
)

func main() {
	file := flag.String("file", "sites.txt", "file chứa danh sách URL")
	timeout := flag.Duration("timeout", 5*time.Second, "thời gian chờ tối đa mỗi request")
	workers := flag.Int("workers", 10, "số request chạy song song")
	jsonOut := flag.String("json", "", "ghi kết quả ra file JSON")
	csvOut := flag.String("csv", "", "ghi kết quả ra file CSV")
	flag.Parse()

	urls, err := readSites(*file)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			fmt.Printf("Không thấy file %s. Tạo file với mỗi dòng một URL rồi chạy lại.\n", *file)
		} else {
			fmt.Println("Lỗi:", err)
		}
		os.Exit(1)
	}

	// ctx bị hủy khi người dùng bấm Ctrl+C.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	client := &http.Client{Timeout: *timeout}

	start := time.Now()
	results := checkAll(ctx, client, urls, *workers)
	elapsed := time.Since(start)

	printTable(results)
	printSummary(results)
	fmt.Printf("Xong trong %s với %d workers\n", elapsed.Round(time.Millisecond), *workers)

	if *jsonOut != "" {
		if err := writeJSON(*jsonOut, results); err != nil {
			fmt.Println("Lỗi ghi JSON:", err)
			os.Exit(1)
		}
	}
	if *csvOut != "" {
		if err := writeCSV(*csvOut, results); err != nil {
			fmt.Println("Lỗi ghi CSV:", err)
			os.Exit(1)
		}
	}
}
```
<mark>context.Background()</mark> là context gốc, không bao giờ bị hủy. <mark>signal.NotifyContext</mark> bọc nó thành context con sẽ bị hủy khi nhận tín hiệu <mark>os.Interrupt</mark> (Ctrl+C). Hàm trả thêm <mark>stop</mark> để dọn dẹp, <mark>defer stop()</mark> theo đúng thói quen "mở gì, defer đóng cái đó".

Chạy với 5 worker rồi bấm Ctrl+C sau một giây:
```
down   -         0ms  http://localhost:8080/site/199  (bị hủy)
down   -         0ms  http://localhost:8080/site/200  (bị hủy)

200 sites: 7 up, 193 down
Xong trong 609ms với 5 workers
```
7 site đã kiểm tra giữ nguyên kết quả, 193 site còn lại ghi "bị hủy", chương trình thoát sạch sẽ. Thêm <mark>many.txt</mark> vào <mark>.gitignore</mark> (file sinh ra bằng shell, không cần commit).

Chạy <mark>local.txt</mark> với <mark>-workers 1</mark> để thấy từng route của fakeweb: <mark>/fast</mark> 3ms, <mark>/slow</mark> 3001ms, <mark>/flaky</mark> lúc up lúc 500, <mark>/down</mark> 503.

#### Bốn công cụ, dùng khi nào
| Công cụ | Dùng khi |
|---|---|
| <mark>go f()</mark> + <mark>sync.WaitGroup</mark> | Chạy nhiều việc song song và chờ tất cả xong |
| <mark>sync.Mutex</mark> | Nhiều goroutine phải sửa cùng một biến (bộ đếm, map, cache). Khóa ngắn nhất có thể |
| Channel | Chuyển việc hoặc kết quả giữa các goroutine, giới hạn số việc chạy cùng lúc |
| <mark>context.Context</mark> | Mọi hàm chờ mạng hay database: để hủy được, và để đặt deadline |

Thói quen quan trọng nhất: mỗi khi viết <mark>go</mark>, tự hỏi ba câu. Ai chờ goroutine này xong (<mark>WaitGroup</mark>)? Nó đụng vào dữ liệu nào chung với goroutine khác (mutex, hoặc tách ô riêng)? Nó dừng thế nào khi chương trình tắt (context)? Goroutine không có câu trả lời cho câu ba là **goroutine leak**: chạy mãi, ăn bộ nhớ, và bài 162 sẽ dạy cách tìm chúng bằng pprof.

#### Mẹo và lỗi hay gặp
- **<mark>fatal error: all goroutines are asleep - deadlock!</mark>**: gửi vào channel mà không ai nhận, hoặc nhận mà không ai gửi, và không còn goroutine nào chạy. Thường do quên <mark>close(jobs)</mark> (worker chờ mãi ở <mark>range</mark>) hoặc gửi trước khi tạo worker.
- **Quên <mark>wg.Add(1)</mark> trước <mark>go</mark>**, hoặc gọi <mark>Add</mark> bên trong goroutine: <mark>Wait()</mark> có thể trả về trước khi goroutine chạy. <mark>Add</mark> luôn ở goroutine cha, ngay trước chữ <mark>go</mark>.
- **Map không an toàn cho goroutine**: hai goroutine cùng ghi vào một map làm chương trình **crash** (<mark>fatal error: concurrent map writes</mark>), không chỉ sai dữ liệu. Bọc bằng mutex hoặc dùng <mark>sync.Map</mark>.
- **Chạy test và chạy thử với <mark>-race</mark>** mọi lúc có thể. Chậm hơn khoảng 10 lần, nhưng bắt được lỗi mà đọc code 10 lần không thấy.
- **Timeout của client và context là hai lớp khác nhau**: <mark>Timeout: 5s</mark> giới hạn mỗi request, context hủy cả đợt. Cả hai cùng tồn tại, cái nào tới trước thì cắt.

#### Checklist
- <mark>go run ./fakeweb</mark> in <mark>fakeweb chạy ở http://localhost:8080</mark>, mở <mark>localhost:8080/flaky</mark> trên trình duyệt vài lần thấy lúc được lúc lỗi.
- <mark>go run -race . -file many.txt -workers 10</mark> không in <mark>DATA RACE</mark> nào và xong trong khoảng 6 giây.
- <mark>-workers 50</mark> xong dưới 2 giây, 200 dòng kết quả đúng thứ tự <mark>site/1</mark> tới <mark>site/200</mark>.
- Bấm Ctrl+C giữa chừng: bảng vẫn in đủ 200 dòng, các dòng chưa kịp kiểm tra ghi <mark>bị hủy</mark>, chương trình thoát ngay chứ không chờ hết 5 giây timeout.

Mã nguồn cuối bài: [post_152.zip](/assets/code/post_152.zip) (chạy <mark>go run ./fakeweb</mark> ở một terminal, <mark>go run . -file local.txt</mark> ở terminal khác).

#### Bài tập thêm
- In tiến độ: một goroutine riêng cứ mỗi giây in <mark>đã xong x/200</mark>. Gợi ý: <mark>time.NewTicker</mark>, một bộ đếm bảo vệ bằng <mark>sync.Mutex</mark> hoặc <mark>atomic.Int64</mark>, và <mark>select</mark> giữa <mark>ticker.C</mark> và <mark>ctx.Done()</mark>.
- Thêm deadline cho cả đợt: flag <mark>-deadline 30s</mark>, dùng <mark>context.WithTimeout(ctx, d)</mark> bọc thêm một lớp lên context từ Ctrl+C. Quan sát các site chưa kịp chạy ghi gì khi hết giờ.
- Đổi <mark>jobs</mark> thành channel có bộ đệm <mark>make(chan job, 100)</mark> và giải thích vì sao thời gian chạy không đổi nhưng vòng lặp gửi việc xong sớm hơn.

Bài tiếp theo: code đang nằm chung một thư mục và chưa có test. Bài 153 tách thành package <mark>cmd/</mark> và <mark>internal/</mark>, học interface, và viết test với một web server giả trong bộ nhớ.
