---
layout: post
title:  "151. Go cho người mới (Bài 2: Struct, Slice, Map & Xử lý lỗi)."
date:   2026-11-04 13:10:00 +0700
author: thach
categories: [ Coding, Golang]
image: assets/images/post_151/go-types.png
---
Bài trước Pulse kiểm tra được một URL. Hôm nay nó đọc **cả danh sách** từ file <mark>sites.txt</mark>, kiểm tra từng URL, in bảng kết quả, đếm bao nhiêu site sống chết, và xuất ra JSON hoặc CSV khi cần. Qua tính năng này học gần hết kiểu dữ liệu cơ bản của Go: struct, slice, map, hằng số có kiểu, con trỏ, và cách Go xử lý lỗi bằng giá trị thay vì exception.

#### Kết quả cuối bài
```sh
go run . -json results.json -csv results.csv
```
```
STATUS CODE  LATENCY  URL
up     200    2428ms  https://google.com
up     200     233ms  https://github.com
up     200     182ms  https://example.com
down   500     872ms  https://httpbin.org/status/500  (HTTP 500 Internal Server Error)
down   -         1ms  http://localhost:9  (Get "http://localhost:9": dial tcp [::1]:9: connect: connection refused)

5 sites: 3 up, 2 down
```
Và hai file <mark>results.json</mark>, <mark>results.csv</mark> xuất hiện bên cạnh.

#### Một package, nhiều file
Code hôm nay dài hơn, nên chia thành 4 file trong cùng thư mục: <mark>main.go</mark>, <mark>check.go</mark>, <mark>sites.go</mark>, <mark>report.go</mark>. Tất cả cùng bắt đầu bằng <mark>package main</mark>. Với Go, **thư mục là package**: mọi file <mark>.go</mark> trong một thư mục được ghép lại như một file lớn, hàm ở file này gọi hàm ở file kia không cần import gì. Không có <mark>require_relative</mark> hay <mark>import "./check"</mark>. Vì vậy từ giờ luôn chạy <mark>go run .</mark> chứ không phải <mark>go run main.go</mark>.

Chia file theo "chủ đề": <mark>check.go</mark> lo việc kiểm tra, <mark>sites.go</mark> lo đọc danh sách, <mark>report.go</mark> lo in ra. Bài 153 sẽ nâng mỗi chủ đề thành một package riêng.

#### Bước 1: Kiểu dữ liệu cho kết quả
```go
// check.go
package main

import (
	"net/http"
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
func check(client *http.Client, url string) Result {
	r := Result{URL: url, CheckedAt: time.Now()}

	start := time.Now()
	resp, err := client.Get(url)
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
```
**Kiểu tự đặt tên**: <mark>type Status string</mark> tạo kiểu mới tên <mark>Status</mark>, bên trong là chuỗi. Vì sao không dùng <mark>string</mark> luôn? Vì khi hàm khai báo tham số kiểu <mark>Status</mark>, trình biên dịch chặn bạn truyền nhầm <mark>"UP"</mark> hay <mark>"ok"</mark>; chỉ hai hằng <mark>StatusUp</mark> và <mark>StatusDown</mark> là hợp lệ về mặt ý nghĩa, và gõ <mark>Status</mark> trong VS Code là thấy ngay có những giá trị nào. Hằng số khai báo bằng <mark>const</mark>, gom trong ngoặc giống <mark>import</mark>.

**Struct** là cách Go gom nhiều trường thành một kiểu. Không có class: struct chỉ là dữ liệu, hành vi là các hàm nhận struct đó (bài 153 sẽ gắn hàm vào struct bằng method). Mỗi trường có tên, kiểu, và tùy chọn một **tag** trong dấu backtick. Tag <mark>json:"status_code"</mark> bảo package <mark>encoding/json</mark>: khi xuất JSON, đặt tên trường này là <mark>status_code</mark> thay vì <mark>StatusCode</mark>. <mark>omitempty</mark> nghĩa là bỏ qua trường nếu rỗng, nên site đang sống không có dòng <mark>"error": ""</mark> thừa.

**Zero value**: <mark>r := Result{URL: url, CheckedAt: time.Now()}</mark> chỉ gán 2 trường, các trường còn lại tự có **giá trị zero**: chuỗi là <mark>""</mark>, số là <mark>0</mark>, bool là <mark>false</mark>, con trỏ là <mark>nil</mark>. Go không có biến "chưa khởi tạo", mọi biến luôn có giá trị dùng được. Vì vậy <mark>StatusCode</mark> bằng 0 khi không kết nối được, và <mark>printTable</mark> bên dưới dựa vào đó để in dấu <mark>-</mark>.

**Vì sao <mark>check</mark> không trả về error?** Một site bị sập **không phải lỗi của chương trình**, đó chính là dữ liệu Pulse cần thu thập. Nên lỗi mạng được chuyển thành chuỗi bằng <mark>err.Error()</mark> và cất vào <mark>Result.Error</mark>, hàm luôn trả về một <mark>Result</mark> đầy đủ. Quy tắc để phân biệt: hàm thất bại khi **không làm được việc của nó** (không đọc được file) thì trả error; còn khi làm được việc và kết quả là xấu (site down) thì đó là giá trị trả về bình thường.

**Con trỏ**: tham số <mark>client *http.Client</mark>, dấu <mark>*</mark> nghĩa là con trỏ tới một <mark>http.Client</mark>. Go truyền tham số bằng cách **copy giá trị**. Truyền thẳng struct thì mỗi lần gọi <mark>check</mark> là copy nguyên cái client (kèm pool kết nối bên trong, copy là sai). Truyền con trỏ thì chỉ copy một địa chỉ 8 byte và mọi lần gọi dùng chung đúng một client. Quy tắc tạm thời: struct nhỏ và chỉ đọc thì truyền giá trị; struct to, có trạng thái, hoặc cần sửa thì truyền con trỏ. Chỗ tạo client sẽ dùng <mark>&amp;</mark> để lấy địa chỉ.

#### Bước 2: Đọc danh sách từ file
```go
// sites.go
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// readSites đọc danh sách URL từ file, mỗi dòng một URL.
// Bỏ qua dòng trống, dòng bắt đầu bằng # và URL trùng.
func readSites(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("đọc danh sách: %w", err)
	}
	defer f.Close()

	var urls []string
	seen := map[string]bool{}

	scanner := bufio.NewScanner(f)
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
		return nil, fmt.Errorf("file %s không có URL nào", path)
	}
	return urls, nil
}
```
Hàm này trả về **hai giá trị** <mark>([]string, error)</mark>: danh sách và lỗi. Đây là dạng chữ ký phổ biến nhất trong Go. Khi lỗi, trả <mark>nil</mark> cho giá trị chính và một error có nội dung; khi thành công, trả giá trị và <mark>nil</mark>.

**Slice**: <mark>[]string</mark> là slice (danh sách) chuỗi. <mark>var urls []string</mark> khai báo slice rỗng (giá trị zero của slice là <mark>nil</mark>, nhưng <mark>append</mark> và <mark>len</mark> vẫn hoạt động bình thường với nó). <mark>append(urls, line)</mark> **trả về slice mới**, phải gán lại vào <mark>urls</mark>; quên gán lại là lỗi kinh điển. <mark>len(urls)</mark> cho số phần tử. Slice giống array của JavaScript hay Ruby, nhưng mọi phần tử phải cùng kiểu.

**Map**: <mark>map[string]bool{}</mark> là map (hash, dictionary) từ chuỗi sang bool. Ở đây dùng như một **set** để bỏ URL trùng: đọc <mark>seen[line]</mark> với key chưa có thì nhận giá trị zero là <mark>false</mark>, không lỗi, không <mark>nil</mark>. Tính chất "key không có thì trả zero value" làm nhiều việc ngắn hơn hẳn, bạn sẽ thấy tiếp ở phần đếm.

**<mark>bufio.Scanner</mark>** đọc file từng dòng. Vòng <mark>for scanner.Scan()</mark> chạy tới khi hết file; Go chỉ có một từ khóa lặp là <mark>for</mark>, dùng cho mọi kiểu vòng lặp (while, for-each, vô hạn). Sau vòng lặp phải hỏi <mark>scanner.Err()</mark> vì <mark>Scan()</mark> trả <mark>false</mark> cả khi hết file lẫn khi đọc lỗi.

**Bọc lỗi với <mark>%w</mark>**: <mark>fmt.Errorf("đọc danh sách: %w", err)</mark> tạo lỗi mới có thông điệp "đọc danh sách: open sites.txt: no such file or directory" **và vẫn giữ lỗi gốc bên trong**. Mỗi tầng thêm ngữ cảnh của mình, người đọc log thấy cả chuỗi nguyên nhân, mà code gọi vẫn kiểm tra được lỗi gốc là gì. <mark>%w</mark> (wrap) khác <mark>%v</mark> ở chỗ giữ lại lỗi gốc để <mark>errors.Is</mark> tìm thấy.

Dạng <mark>if err := scanner.Err(); err != nil</mark> là khai báo biến ngay trong <mark>if</mark>; <mark>err</mark> chỉ sống trong khối <mark>if</mark> đó, không đụng <mark>err</mark> bên ngoài.

#### Bước 3: In bảng, đếm, xuất file
```go
// report.go
package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

// printTable in kết quả ra màn hình dạng bảng.
func printTable(results []Result) {
	fmt.Printf("%-6s %-5s %7s  %s\n", "STATUS", "CODE", "LATENCY", "URL")
	for _, r := range results {
		code := "-"
		if r.StatusCode != 0 {
			code = strconv.Itoa(r.StatusCode)
		}
		fmt.Printf("%-6s %-5s %5dms  %s", r.Status, code, r.LatencyMS, r.URL)
		if r.Error != "" {
			fmt.Printf("  (%s)", r.Error)
		}
		fmt.Println()
	}
}

// printSummary đếm số lượng theo trạng thái.
func printSummary(results []Result) {
	count := map[Status]int{}
	for _, r := range results {
		count[r.Status]++
	}
	fmt.Printf("\n%d sites: %d up, %d down\n", len(results), count[StatusUp], count[StatusDown])
}

// writeJSON ghi kết quả ra file JSON.
func writeJSON(path string, results []Result) error {
	data, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// writeCSV ghi kết quả ra file CSV, mở được bằng Excel.
func writeCSV(path string, results []Result) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	w.Write([]string{"url", "status", "status_code", "latency_ms", "error", "checked_at"})
	for _, r := range results {
		w.Write([]string{
			r.URL,
			string(r.Status),
			strconv.Itoa(r.StatusCode),
			strconv.FormatInt(r.LatencyMS, 10),
			r.Error,
			r.CheckedAt.Format("2006-01-02 15:04:05"),
		})
	}
	w.Flush()
	return w.Error()
}
```
**<mark>for _, r := range results</mark>** là for-each: <mark>range</mark> trả về chỉ số và phần tử, dấu <mark>_</mark> nghĩa là "bỏ chỉ số, tôi không dùng" (nhớ là biến khai báo mà không dùng là lỗi, nên Go cho bạn <mark>_</mark> để vứt).

**<mark>fmt.Printf</mark>** với định dạng kiểu C: <mark>%-6s</mark> là chuỗi căn trái rộng 6, <mark>%5d</mark> là số căn phải rộng 5. <mark>go vet</mark> sẽ báo nếu bạn truyền sai kiểu cho <mark>%d</mark>.

**Đếm bằng map**: <mark>count[r.Status]++</mark> với key chưa có thì zero value là 0, cộng lên 1. Không cần kiểm tra "key tồn tại chưa" như nhiều ngôn ngữ khác. Map có kiểu key là <mark>Status</mark> chứ không phải <mark>string</mark>, nên <mark>count["UP"]</mark> là lỗi biên dịch.

**Chuyển kiểu phải rõ ràng**: Go không tự đổi số thành chuỗi. <mark>strconv.Itoa(200)</mark> cho <mark>"200"</mark>, <mark>string(r.Status)</mark> đổi kiểu <mark>Status</mark> về <mark>string</mark> (cùng kiểu gốc nên đổi được). Cẩn thận: <mark>string(65)</mark> cho ra <mark>"A"</mark> chứ không phải <mark>"65"</mark>, lỗi kinh điển của người mới, <mark>go vet</mark> cũng báo.

**JSON** một dòng: <mark>json.MarshalIndent</mark> nhận bất kỳ giá trị nào, nhìn vào tag <mark>json:"..."</mark> của struct và sinh ra <mark>[]byte</mark>. Chỉ trường **viết hoa** mới được xuất (trường chữ thường là private, package <mark>json</mark> không thấy). <mark>os.WriteFile</mark> ghi cả mảng byte ra file với quyền <mark>0o644</mark> (chủ đọc ghi, người khác chỉ đọc).

**Định dạng thời gian lạ**: <mark>Format("2006-01-02 15:04:05")</mark>. Go không dùng <mark>YYYY-MM-DD</mark>; bạn viết mẫu bằng một thời điểm cố định: năm 2006, tháng 01, ngày 02, 15 giờ 04 phút 05 giây (các số 1 2 3 4 5 6 theo thứ tự tháng, ngày, giờ, phút, giây, năm). Muốn <mark>02/01/2006</mark> thì viết đúng vậy. Lạ nhưng không bao giờ nhầm chữ hoa thường như <mark>MM</mark> và <mark>mm</mark>.

#### Bước 4: Ghép lại với flag
```go
// main.go
package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"time"
)

func main() {
	file := flag.String("file", "sites.txt", "file chứa danh sách URL")
	timeout := flag.Duration("timeout", 5*time.Second, "thời gian chờ tối đa mỗi request")
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

	client := &http.Client{Timeout: *timeout}

	var results []Result
	for _, url := range urls {
		results = append(results, check(client, url))
	}

	printTable(results)
	printSummary(results)

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
**Package <mark>flag</mark>** xử lý tham số dạng <mark>-file x -timeout 3s</mark>. Mỗi <mark>flag.String</mark>, <mark>flag.Duration</mark> trả về **con trỏ** tới giá trị (vì giá trị chỉ được điền sau khi <mark>flag.Parse()</mark> đọc dòng lệnh), nên khi dùng phải viết <mark>*file</mark> để lấy giá trị mà con trỏ trỏ tới. <mark>flag.Duration</mark> hiểu cả <mark>3s</mark>, <mark>500ms</mark>, <mark>1m30s</mark>. Và bạn được miễn phí <mark>-h</mark>:
```sh
go run . -h
#   -csv string
#     	ghi kết quả ra file CSV
#   -file string
#     	file chứa danh sách URL (default "sites.txt")
#   -json string
#     	ghi kết quả ra file JSON
#   -timeout duration
#     	thời gian chờ tối đa mỗi request (default 5s)
```
**<mark>&amp;http.Client{...}</mark>**: dấu <mark>&amp;</mark> lấy địa chỉ, tạo ra <mark>*http.Client</mark> đúng kiểu mà <mark>check</mark> cần. Một client, dùng chung cho mọi URL.

**<mark>errors.Is(err, fs.ErrNotExist)</mark>** hỏi: trong chuỗi lỗi này (kể cả các lớp bọc bằng <mark>%w</mark>) có lỗi "file không tồn tại" không? Nhờ vậy <mark>main</mark> in được câu hướng dẫn thân thiện thay vì chuỗi kỹ thuật, mà <mark>readSites</mark> không cần biết gì về giao diện. Đây là cách Go thay thế <mark>rescue Errno::ENOENT</mark>: lỗi là giá trị, so sánh được.

Tạo <mark>sites.txt</mark>:
```
# sites.txt
# Mỗi dòng một URL. Dòng bắt đầu bằng # là ghi chú.
https://google.com
https://github.com
example.com
https://httpbin.org/status/500
http://localhost:9
https://google.com
```
Có dòng ghi chú, dòng thiếu <mark>https://</mark>, dòng trùng, một site trả 500, một cổng không ai nghe: đủ để thấy mọi nhánh của <mark>readSites</mark> và <mark>check</mark> hoạt động. Chạy
```sh
go run . -json results.json -csv results.csv
```
Bảng như đầu bài, 5 site (dòng trùng bị bỏ), và
```
$ cat results.csv
url,status,status_code,latency_ms,error,checked_at
https://google.com,up,200,2428,,2026-11-04 23:16:52
https://github.com,up,200,233,,2026-11-04 23:16:55
https://example.com,up,200,182,,2026-11-04 23:16:55
https://httpbin.org/status/500,down,500,872,HTTP 500 Internal Server Error,2026-11-04 23:16:55
http://localhost:9,down,0,1,"Get ""http://localhost:9"": dial tcp [::1]:9: connect: connection refused",2026-11-04 23:16:56
```
Để ý package <mark>csv</mark> tự bọc dấu ngoặc kép cho ô có dấu phẩy hay dấu nháy. Tự nối chuỗi bằng dấu phẩy sẽ hỏng ngay ở dòng cuối. Còn JSON:
```json
[
  {
    "url": "https://google.com",
    "status": "up",
    "status_code": 200,
    "latency_ms": 2428,
    "checked_at": "2026-11-04T23:16:52.710004+07:00"
  },
```
Không có trường <mark>error</mark> nhờ <mark>omitempty</mark>, tên trường theo tag, thời gian theo chuẩn RFC 3339 mà mọi ngôn ngữ đọc được.

Thử xóa file: <mark>go run . -file nope.txt</mark> in <mark>Không thấy file nope.txt. Tạo file với mỗi dòng một URL rồi chạy lại.</mark> Thêm <mark>results.json</mark> và <mark>results.csv</mark> vào <mark>.gitignore</mark>.

#### Nhìn lại: Go xử lý lỗi thế nào
Ba thói quen bạn vừa dùng, và sẽ dùng trong mọi file Go từ đây về sau:
1. Hàm có thể thất bại thì trả <mark>(giá trị, error)</mark>, người gọi kiểm tra <mark>if err != nil</mark> ngay dòng dưới.
2. Khi chuyển lỗi lên tầng trên, bọc thêm ngữ cảnh bằng <mark>fmt.Errorf("việc đang làm: %w", err)</mark>. Đừng bọc ở tầng chỉ trả lỗi đi tiếp mà không thêm gì.
3. Tầng ngoài cùng (ở đây là <mark>main</mark>) mới quyết định làm gì: in cho người dùng, thoát, hay thử lại. Dùng <mark>errors.Is</mark> để nhận diện lỗi cụ thể.

Không có exception nghĩa là không có lỗi nào "bay" qua một hàm mà hàm đó không biết. Nhìn chữ ký <mark>readSites(path string) ([]string, error)</mark> là biết nó có thể thất bại; nhìn <mark>printTable(results []Result)</mark> là biết nó không bao giờ.

#### Mẹo và lỗi hay gặp
- **Quên gán lại <mark>append</mark>**: viết <mark>append(urls, line)</mark> mà không <mark>urls = </mark>, slice không đổi. <mark>go vet</mark> báo lỗi này.
- **So sánh struct chứa <mark>time.Time</mark> bằng <mark>==</mark>**: được về cú pháp nhưng thường không như ý vì múi giờ và độ chính xác. Dùng <mark>t1.Equal(t2)</mark>.
- **Tên trường chữ thường không ra JSON**: <mark>url string</mark> sẽ biến mất khỏi file JSON mà không báo gì. Trường cần xuất phải viết hoa, tên JSON đặt trong tag.
- **<mark>flag.Parse()</mark> phải gọi trước khi đọc giá trị**, và flag phải đứng **trước** tham số tự do: <mark>go run . -file a.txt</mark> đúng, <mark>go run . a.txt -file</mark> sai.
- **<mark>nil</mark> slice vs slice rỗng**: <mark>var s []string</mark> là nil, <mark>s := []string{}</mark> là rỗng nhưng không nil. Với <mark>len</mark>, <mark>append</mark>, <mark>range</mark> thì như nhau; khác nhau khi xuất JSON (<mark>null</mark> vs <mark>[]</mark>). API trả danh sách thì dùng <mark>[]string{}</mark> để client nhận <mark>[]</mark>.

#### Checklist
- <mark>go run .</mark> in bảng 5 site với cột căn thẳng, dòng trùng <mark>google.com</mark> chỉ xuất hiện một lần.
- <mark>example.com</mark> (không có <mark>https://</mark>) vẫn được kiểm tra.
- <mark>-json results.json</mark> tạo file JSON hợp lệ, site sống không có trường <mark>error</mark>.
- <mark>-csv results.csv</mark> mở bằng Excel hoặc Numbers đúng 6 cột.
- <mark>-file nope.txt</mark> in câu hướng dẫn thân thiện, không in stack trace.

Mã nguồn cuối bài: [post_151.zip](/assets/code/post_151.zip).

#### Bài tập thêm
- Thêm trạng thái <mark>StatusSlow</mark>: site trả 200 nhưng <mark>LatencyMS</mark> trên 1000 thì là <mark>slow</mark>. Sửa <mark>printSummary</mark> để đếm cả ba.
- Thêm flag <mark>-only down</mark> để bảng chỉ in site có vấn đề. Gợi ý: lọc slice bằng một vòng <mark>for</mark> và <mark>append</mark> vào slice mới.
- Cho <mark>readSites</mark> đọc từ <mark>os.Stdin</mark> khi <mark>-file -</mark>, để chạy được <mark>cat sites.txt | go run . -file -</mark>. Gợi ý: <mark>os.Stdin</mark> và file mở bằng <mark>os.Open</mark> đều đưa vào <mark>bufio.NewScanner</mark> được.

Bài tiếp theo: 5 site mất 4 giây vì kiểm tra lần lượt; 200 site sẽ mất hơn một phút. Bài 152 dùng goroutine để kiểm tra song song và xong trong 1.5 giây.
