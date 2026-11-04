---
layout: post
title:  "155. Go cho người mới (Bài 6: PostgreSQL với pgx & Migration)."
date:   2026-11-04 13:50:00 +0700
author: thach
categories: [ Coding, Golang]
image: assets/images/post_155/go-postgres.png
---
Bài trước kết thúc với một server mất sạch dữ liệu mỗi lần khởi động lại. Bài này đưa monitor vào **PostgreSQL**: chạy database bằng Docker, kết nối từ Go bằng <mark>pgx</mark>, tạo bảng bằng **migration** được nhúng thẳng vào binary, và đọc cấu hình từ biến môi trường. Và nhờ interface <mark>monitor.Store</mark> ở bài 5, toàn bộ package <mark>api</mark> **không sửa một dòng nào**.

#### Thư viện cho database trong Go
Go có ba tầng để chọn:

| | <mark>database/sql</mark> (chuẩn) | <mark>pgx</mark> | ORM (GORM, ent, sqlc...) |
|---|---|---|---|
| Là gì | Interface chung cho mọi database, cần thêm driver | Driver PostgreSQL, dùng trực tiếp hoặc làm driver cho <mark>database/sql</mark> | Sinh query từ struct / từ SQL |
| Viết SQL | Tự viết | Tự viết | GORM: ít; sqlc: viết SQL, sinh code Go |
| Kiểu PostgreSQL (jsonb, array, timestamptz) | Qua driver, hơi vướng | Đầy đủ, nhanh | Tùy |
| Dùng khi | Cần đổi database (SQLite ↔ Postgres) | Chỉ dùng PostgreSQL | Dự án CRUD lớn, đội quen ORM |

Series chọn **pgx dùng trực tiếp**, SQL viết tay. Lý do: bạn thấy chính xác câu lệnh nào chạy, học được SQL thật (series 111-114 về index PostgreSQL áp dụng ngay), và khi sau này dùng GORM hay sqlc, bạn hiểu chúng sinh ra cái gì. Nếu bạn đã học Prisma ở bài 142, thì pgx là tầng thấp hơn: không có schema file, không sinh client, chỉ có SQL và <mark>Scan</mark> vào struct.

Migration dùng **goose**: mỗi thay đổi schema là một file SQL đánh số, goose ghi nhớ file nào đã chạy trong bảng <mark>goose_db_version</mark>. Cấu hình từ <mark>.env</mark> dùng **godotenv**.

#### Bước 1: PostgreSQL bằng Docker
```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pulse
      POSTGRES_PASSWORD: pulse
      POSTGRES_DB: pulse
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```
```sh
docker compose up -d
docker compose ps        # STATUS phải là "running"
```
Volume <mark>pgdata</mark> giữ dữ liệu khi container bị xóa tạo lại. Nếu máy bạn đã có PostgreSQL chạy ở cổng 5432, đổi dòng ports thành <mark>"5433:5432"</mark> và sửa cổng trong <mark>DATABASE_URL</mark> bên dưới.

#### Bước 2: Cài thư viện
```sh
go get github.com/jackc/pgx/v5 github.com/pressly/goose/v3 github.com/joho/godotenv
```
<mark>go get</mark> tải thư viện vào cache chung của máy (<mark>~/go/pkg/mod</mark>, không có <mark>node_modules</mark> trong dự án) và ghi phiên bản vào <mark>go.mod</mark>:
```
require (
	github.com/jackc/pgx/v5 v5.12.0
	github.com/joho/godotenv v1.5.1
	github.com/pressly/goose/v3 v3.29.0
)
```
Kèm theo là <mark>go.sum</mark>: mã băm của từng thư viện, để máy khác tải về đúng từng byte (giống <mark>package-lock.json</mark>). Commit cả hai. Sau khi viết code xong, chạy <mark>go mod tidy</mark>: nó thêm thư viện còn thiếu, bỏ thư viện không còn import, và sắp xếp lại <mark>// indirect</mark> (thư viện mà thư viện của bạn cần). Hai tên <mark>/v5</mark>, <mark>/v3</mark> nằm ngay trong đường dẫn import: Go coi mỗi major version là một package khác nhau, nên code bạn không bao giờ bị nâng cấp ngầm sang bản phá tương thích.

#### Bước 3: Cấu hình từ biến môi trường
Chuỗi kết nối database, cổng, mật khẩu không nằm trong code. Trên production chúng là biến môi trường do Docker, systemd hoặc nền tảng cấp; lúc dev thì ghi vào file <mark>.env</mark> cho tiện.
```
# .env.example
ADDR=:3000
DATABASE_URL=postgres://pulse:pulse@localhost:5432/pulse?sslmode=disable
CHECK_TIMEOUT=10s
```
```sh
cp .env.example .env
```
<mark>.env.example</mark> commit lên git để người sau biết cần biến gì; <mark>.env</mark> thật thì **không bao giờ commit** (đã có trong <mark>.gitignore</mark> từ bài 1). Chuỗi kết nối có dạng <mark>postgres://user:password@host:port/database?tham-số</mark>; <mark>sslmode=disable</mark> vì kết nối trong máy không cần mã hóa, lên production dùng <mark>require</mark>.
```go
// internal/config/config.go
// Package config đọc cấu hình từ biến môi trường (và file .env khi chạy local).
package config

import (
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
)

// Config là toàn bộ cấu hình của pulsed.
type Config struct {
	Addr         string
	DatabaseURL  string
	CheckTimeout time.Duration
}

// Load đọc .env (nếu có) rồi đọc biến môi trường.
func Load() (Config, error) {
	// Trên production không có file .env, biến môi trường được set sẵn. Không có file thì bỏ qua.
	_ = godotenv.Load()

	cfg := Config{
		Addr:         getenv("ADDR", ":3000"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		CheckTimeout: 10 * time.Second,
	}
	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("thiếu biến môi trường DATABASE_URL")
	}
	if v := os.Getenv("CHECK_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return cfg, fmt.Errorf("CHECK_TIMEOUT không hợp lệ: %w", err)
		}
		cfg.CheckTimeout = d
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```
<mark>godotenv.Load()</mark> đọc file <mark>.env</mark> và đặt vào biến môi trường của tiến trình, **không ghi đè** biến đã có. Lỗi của nó bị bỏ bằng <mark>_ =</mark> có chủ đích: không có file là bình thường trên production. Sau đó mọi thứ đọc qua <mark>os.Getenv</mark> như nhau.

Thiếu <mark>DATABASE_URL</mark> là lỗi ngay lúc khởi động, không phải lúc request đầu tiên tới: cấu hình sai thì server **không được phép chạy**. Toàn bộ cấu hình gom vào một struct <mark>Config</mark>, các bài sau chỉ việc thêm trường.

#### Bước 4: Migration
Migration là cách quản lý schema bằng code: mỗi thay đổi là một file, đánh số tăng dần, chạy theo thứ tự, chạy rồi thì không chạy lại. Máy dev, máy đồng nghiệp, server production đều đi qua đúng một chuỗi thay đổi, không ai phải "nhớ chạy <mark>ALTER TABLE</mark> hôm qua".
```sql
-- internal/store/migrations/00001_create_monitors.sql
-- +goose Up
CREATE TABLE monitors (
    id               BIGSERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    url              TEXT        NOT NULL,
    interval_seconds INTEGER     NOT NULL DEFAULT 60,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE monitors;
```
Tên file: số thứ tự, gạch dưới, mô tả. Phần <mark>Up</mark> áp dụng thay đổi, <mark>Down</mark> hoàn tác (hữu ích khi lỡ tay lúc dev). <mark>BIGSERIAL</mark> là số nguyên 64-bit tự tăng, khớp với <mark>int64</mark> của Go. <mark>TIMESTAMPTZ</mark> lưu thời điểm kèm múi giờ, luôn chọn nó thay vì <mark>TIMESTAMP</mark> để khỏi đau đầu khi server ở múi giờ khác người dùng.

#### Bước 5: Kết nối và chạy migration
```go
// internal/store/postgres.go
// Package store lưu dữ liệu vào PostgreSQL.
package store

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Postgres giữ pool kết nối. Một pool dùng chung cho cả chương trình.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres kết nối tới database và kiểm tra kết nối.
func NewPostgres(ctx context.Context, url string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("cấu hình kết nối: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("không kết nối được database: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

// Close đóng mọi kết nối. Gọi khi tắt chương trình.
func (s *Postgres) Close() {
	s.pool.Close()
}

// Migrate chạy các file SQL trong thư mục migrations chưa được chạy.
func (s *Postgres) Migrate(ctx context.Context) error {
	goose.SetBaseFS(migrations)
	goose.SetLogger(goose.NopLogger())
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	db := stdlib.OpenDBFromPool(s.pool)
	defer db.Close()
	return goose.UpContext(ctx, db, "migrations")
}
```
**<mark>//go:embed</mark>** là chỉ thị cho trình biên dịch: nhét mọi file khớp <mark>migrations/*.sql</mark> vào trong binary, đọc qua biến <mark>migrations</mark> kiểu <mark>embed.FS</mark> (một hệ thống file chỉ đọc trong bộ nhớ). Kết quả là **một file binary duy nhất** mang theo cả schema của nó: copy lên server, chạy, tự tạo bảng. Không có bước "nhớ copy thư mục migrations". Dòng chỉ thị phải nằm ngay trên khai báo biến, và phải <mark>import "embed"</mark> (dù không gọi gì từ nó).

**Pool kết nối.** Mở một kết nối TCP tới PostgreSQL tốn vài mili giây và tài nguyên ở phía database. <mark>pgxpool</mark> giữ sẵn một nhóm kết nối, mỗi query mượn một cái rồi trả lại. Pool an toàn với goroutine: hàng trăm request đồng thời cùng dùng một <mark>pool</mark>, pgx tự xếp hàng. Vì thế cả chương trình chỉ tạo **một** pool, truyền vào nơi cần, và đóng khi tắt. <mark>pgxpool.New</mark> chỉ đọc chuỗi kết nối, chưa kết nối thật; <mark>Ping</mark> ép nó thử một kết nối ngay, để sai mật khẩu hay database chưa bật là biết lúc khởi động.

**goose** làm việc qua <mark>database/sql</mark>, nên <mark>stdlib.OpenDBFromPool</mark> bọc pool của pgx thành <mark>*sql.DB</mark> cho goose dùng. <mark>goose.UpContext</mark> xem bảng <mark>goose_db_version</mark>, chạy những file chưa chạy, mỗi file trong một transaction. Chạy migration lúc khởi động là cách đơn giản nhất cho dự án nhỏ; dự án lớn thường tách thành lệnh riêng chạy trước khi deploy, bài 14 bàn tiếp.

#### Bước 6: Các câu lệnh SQL
```go
// internal/store/monitors.go
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/thachnguyenp/pulse/internal/monitor"
)

func (s *Postgres) Create(ctx context.Context, m *monitor.Monitor) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO monitors (name, url, interval_seconds)
		VALUES ($1, $2, $3)
		RETURNING id, created_at`,
		m.Name, m.URL, m.Interval,
	).Scan(&m.ID, &m.CreatedAt)
}

func (s *Postgres) List(ctx context.Context) ([]monitor.Monitor, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, url, interval_seconds, created_at
		FROM monitors
		ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []monitor.Monitor{}
	for rows.Next() {
		var m monitor.Monitor
		if err := rows.Scan(&m.ID, &m.Name, &m.URL, &m.Interval, &m.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

func (s *Postgres) Get(ctx context.Context, id int64) (monitor.Monitor, error) {
	var m monitor.Monitor
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, url, interval_seconds, created_at
		FROM monitors
		WHERE id = $1`, id,
	).Scan(&m.ID, &m.Name, &m.URL, &m.Interval, &m.CreatedAt)
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
```
Ba hàm của pgx bạn sẽ dùng mãi:
- <mark>QueryRow</mark>: câu lệnh trả **đúng một dòng**. Nối tiếp <mark>.Scan(&amp;a, &amp;b)</mark> để đổ từng cột vào biến, **theo đúng thứ tự cột trong SELECT**. Thứ tự lệch là lỗi lúc chạy (cột text vào biến int), không phải lúc biên dịch, nên giữ danh sách cột và danh sách <mark>Scan</mark> cạnh nhau.
- <mark>Query</mark>: nhiều dòng. Lặp <mark>rows.Next()</mark>, <mark>Scan</mark> từng dòng, và **luôn** <mark>defer rows.Close()</mark> để trả kết nối về pool; quên là pool cạn dần, server treo sau vài trăm request. <mark>rows.Err()</mark> ở cuối báo lỗi xảy ra giữa chừng (mất kết nối).
- <mark>Exec</mark>: câu lệnh không trả dòng (<mark>DELETE</mark>, <mark>UPDATE</mark>). Trả về <mark>tag</mark> với <mark>RowsAffected()</mark>: xóa mà 0 dòng bị ảnh hưởng nghĩa là id không tồn tại, trả <mark>ErrNotFound</mark> để API vẫn ra 404 như bài trước.

**<mark>$1, $2</mark> là tham số**, giá trị gửi riêng khỏi câu lệnh, PostgreSQL không bao giờ hiểu nhầm chúng là SQL. **Không bao giờ** ghép chuỗi kiểu <mark>"WHERE name = '" + name + "'"</mark>: một cái tên chứa <mark>'; DROP TABLE monitors; --</mark> là mất bảng. Đây là SQL injection, lỗi bảo mật phổ biến nhất mà series bot & abuse (bài 085-093) đã cảnh báo; với tham số thì không thể xảy ra.

**<mark>RETURNING id, created_at</mark>** lấy luôn giá trị database sinh ra trong cùng câu <mark>INSERT</mark>, thay vì insert rồi select lại. Vì <mark>m</mark> là con trỏ, <mark>Scan(&amp;m.ID, ...)</mark> điền thẳng vào struct người gọi đưa, giống <mark>Memory.Create</mark> bài trước.

**<mark>pgx.ErrNoRows</mark>** là cách pgx báo "SELECT không có dòng nào". Ta đổi thành <mark>monitor.ErrNotFound</mark> ngay tại đây, để package <mark>api</mark> không cần biết pgx tồn tại; đổi database sau này cũng chỉ sửa trong <mark>store</mark>.

**<mark>list := []monitor.Monitor{}</mark>** thay vì <mark>var list []monitor.Monitor</mark>: slice nil khi mã hóa JSON ra <mark>null</mark>, slice rỗng ra <mark>[]</mark>. Client mobile gọi <mark>.length</mark> trên <mark>null</mark> là crash. Chi tiết nhỏ nhưng là lỗi thật trong API Go rất hay gặp.

Mọi hàm nhận <mark>ctx</mark> và truyền vào pgx: client ngắt kết nối thì <mark>r.Context()</mark> bị hủy, pgx hủy luôn câu lệnh đang chạy ở PostgreSQL. Database không phải làm việc cho người đã bỏ đi.

#### Bước 7: Ghép vào main
Xóa <mark>internal/store/memory.go</mark>: từ giờ dữ liệu ở database thật, còn store giả sẽ quay lại ở bài 12 với vai trò đúng của nó là phục vụ test. Sửa <mark>cmd/pulsed/main.go</mark>:
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

	"github.com/thachnguyenp/pulse/internal/api"
	"github.com/thachnguyenp/pulse/internal/checker"
	"github.com/thachnguyenp/pulse/internal/config"
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

	server := api.New(db, checker.New(cfg.CheckTimeout))
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Chạy server trong goroutine riêng để main còn chờ tín hiệu tắt.
	errCh := make(chan error, 1)
	go func() {
		slog.Info("pulsed đang chạy", "addr", cfg.Addr)
		errCh <- srv.ListenAndServe()
	}()

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
Thay đổi so với bài 5: cờ <mark>-addr</mark> thay bằng <mark>config.Load()</mark>; tạo pool, migrate, và <mark>api.New(db, ...)</mark> nhận <mark>*store.Postgres</mark> thay cho <mark>*store.Memory</mark>. Dòng đó compile được vì <mark>Postgres</mark> có đủ bốn method của <mark>monitor.Store</mark>. <mark>ctx</mark> từ <mark>signal.NotifyContext</mark> giờ được tạo sớm hơn để truyền vào <mark>NewPostgres</mark>: đang chờ database mà bấm Ctrl+C thì thoát ngay. <mark>defer db.Close()</mark> trả mọi kết nối khi tắt.

Thứ tự khởi động quan trọng: cấu hình → database → migration → **rồi mới** mở cổng HTTP. Server chỉ nhận request khi đã sẵn sàng phục vụ, nên <mark>/healthz</mark> trả 200 là tin được.

#### Chạy thử
```sh
go run ./cmd/pulsed
```
```
2026/11/04 23:23:39 INFO database sẵn sàng
2026/11/04 23:23:39 INFO pulsed đang chạy addr=:3000
```
Xem database bằng <mark>psql</mark> (có trong container: <mark>docker compose exec postgres psql -U pulse</mark>):
```
pulse=# \dt
             List of relations
 Schema |       Name       | Type  | Owner
--------+------------------+-------+-------
 public | goose_db_version | table | pulse
 public | monitors         | table | pulse

pulse=# select * from goose_db_version;
 id | version_id | is_applied |           tstamp
----+------------+------------+----------------------------
  1 |          0 | t          | 2026-11-04 23:23:39.609822
  2 |          1 | t          | 2026-11-04 23:23:39.661933
```
Dòng <mark>version_id = 1</mark> là file <mark>00001</mark> của ta. Khởi động lại server, goose thấy đã có, bỏ qua. API y hệt bài trước:
```sh
curl -s -X POST localhost:3000/monitors -d '{"name":"Google","url":"https://google.com","interval_seconds":60}'
# {"id":1,"name":"Google","url":"https://google.com","interval_seconds":60,"created_at":"2026-11-04T23:23:41.718466+07:00"}

curl -s -X POST localhost:3000/monitors -d '{"name":"Fake fast","url":"http://localhost:8080/fast","interval_seconds":30}'
# {"id":2,...}

curl -s localhost:3000/monitors
# [{"id":1,...},{"id":2,...}]

curl -s -i -X DELETE localhost:3000/monitors/1 | head -1
# HTTP/1.1 204 No Content

curl -s -X DELETE localhost:3000/monitors/1
# {"error":"không có monitor này"}
```
```
pulse=# select id, name, url, interval_seconds from monitors;
 id |   name    |            url             | interval_seconds
----+-----------+----------------------------+------------------
  2 | Fake fast | http://localhost:8080/fast |               30
```
Tắt server bằng Ctrl+C, chạy lại, <mark>GET /monitors</mark> vẫn thấy "Fake fast". Và nhìn lại: <mark>internal/api</mark> không đổi file nào. Đó là phần thưởng của việc khai báo interface <mark>Store</mark> ở bài 4 và 5, trước khi biết sẽ lưu vào đâu.

#### Mẹo và lỗi hay gặp
- **"thiếu biến môi trường DATABASE_URL"**: chưa <mark>cp .env.example .env</mark>, hoặc chạy từ thư mục khác (godotenv tìm <mark>.env</mark> ở thư mục hiện tại). Luôn chạy <mark>go run</mark> từ thư mục gốc dự án.
- **"connection refused" hoặc "password authentication failed"**: container chưa chạy (<mark>docker compose ps</mark>), hoặc cổng/mật khẩu trong URL không khớp compose. Chuỗi kết nối đọc từ trái sang: user, mật khẩu, host, cổng, database.
- **Sửa file migration đã chạy** thì goose **không** chạy lại (nó chỉ nhìn số thứ tự). Muốn đổi schema: tạo file <mark>00002_...</mark> mới. Lúc dev muốn làm lại từ đầu: <mark>docker compose down -v</mark> (xóa volume) rồi chạy server.
- **Quên <mark>rows.Close()</mark>**: pool cạn, request treo không lỗi, rất khó tìm. Mẫu <mark>rows, err := Query; if err ...; defer rows.Close()</mark> viết thành phản xạ.
- **Scan sai số cột**: lỗi "expected 5 destination arguments in Scan, not 4". Đếm lại SELECT và Scan.
- **Thời gian lệch múi giờ**: cột <mark>TIMESTAMPTZ</mark> + kiểu <mark>time.Time</mark> của Go là đủ, pgx tự chuyển. Chỉ sai khi bạn dùng <mark>TIMESTAMP</mark> không có tz.

#### Checklist
- <mark>docker compose ps</mark> thấy postgres <mark>running</mark>; <mark>go.mod</mark> có ba thư viện mới, <mark>go.sum</mark> đã commit.
- Khởi động server thấy "database sẵn sàng"; <mark>\dt</mark> thấy hai bảng.
- Tạo monitor, tắt server, bật lại, danh sách vẫn còn.
- <mark>git status</mark>: thấy <mark>.env.example</mark>, **không** thấy <mark>.env</mark>; <mark>internal/store/memory.go</mark> đã xóa.

Mã nguồn cuối bài: [post_155.zip](/assets/code/post_155.zip). Sau khi giải nén: <mark>docker compose up -d</mark>, <mark>cp .env.example .env</mark>, <mark>go run ./cmd/pulsed</mark>.

#### Bài tập thêm
- Làm <mark>PUT /monitors/{id}</mark> của bài trước với PostgreSQL: <mark>UPDATE monitors SET name=$1, url=$2, interval_seconds=$3 WHERE id=$4</mark>, dùng <mark>RowsAffected</mark> để trả 404.
- Thêm phân trang cho <mark>List</mark>: <mark>?limit=20&amp;offset=40</mark>, truyền thành <mark>$1, $2</mark> trong SQL, giới hạn <mark>limit</mark> tối đa 100 ở handler.
- Thêm migration <mark>00002_unique_url.sql</mark> tạo <mark>UNIQUE (url)</mark>. Tạo hai monitor cùng URL và quan sát lỗi pgx trả về; dùng <mark>errors.As</mark> với <mark>*pgconn.PgError</mark>, kiểm tra <mark>Code == "23505"</mark> để API trả 409 thay vì 500. Bài 8 sẽ dùng đúng kỹ thuật này cho email trùng.
- Đọc <mark>docker compose exec postgres psql -U pulse -c "EXPLAIN SELECT * FROM monitors WHERE id = 2"</mark> và so với series 111-114 để hiểu vì sao <mark>PRIMARY KEY</mark> làm <mark>Get</mark> nhanh.
