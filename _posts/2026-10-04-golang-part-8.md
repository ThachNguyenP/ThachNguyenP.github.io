---
layout: post
title:  "157. Go cho người mới (Bài 8: Đăng ký, đăng nhập với bcrypt & JWT)."
date:   2026-10-04 14:10:00 +0700
author: thach
categories: [Coding]
tags: [Golang]
image: assets/images/post_157/go-auth.png
---
Pulse tới giờ là "của chung": ai cũng tạo, xem và xóa được mọi monitor. Bài này thêm tài khoản: đăng ký, đăng nhập, và mỗi người chỉ thấy monitor của mình. Công cụ là **bcrypt** để lưu mật khẩu và **JWT** để chứng minh "tôi đã đăng nhập" ở mỗi request. Qua đó học cách băm mật khẩu đúng, ký và kiểm tra token, viết middleware xác thực, truyền dữ liệu theo request bằng <mark>context</mark>, và quan trọng nhất: **ràng buộc quyền sở hữu ngay trong câu SQL** để không ai đọc được dữ liệu của người khác.

Nếu bạn đã làm bài 145 (better-auth trong Next.js), bạn sẽ thấy ở đây mọi thứ được viết tay. Mục đích không phải để tự viết auth ở mọi dự án, mà để hiểu thư viện làm gì bên dưới.

#### Cách hoạt động
```
Đăng ký:   email + mật khẩu  →  bcrypt(mật khẩu)  →  lưu users(email, password_hash)
Đăng nhập: email + mật khẩu  →  so với hash        →  ký JWT chứa user id, hạn 24h  →  trả token
Mỗi request: Authorization: Bearer <token>  →  kiểm chữ ký + hạn  →  user id vào context  →  handler
```
**JWT** (JSON Web Token) là một chuỗi ba phần cách nhau bằng dấu chấm: <mark>header.payload.signature</mark>. Header nói thuật toán ký, payload là JSON chứa thông tin (ở đây: user id, thời điểm phát hành, hạn), signature là HMAC của hai phần trước với một **khóa bí mật** chỉ server biết. Server nhận token thì tính lại chữ ký: khớp nghĩa là token do chính mình phát ra và chưa bị sửa. Không cần tra database ở mỗi request, đó là điểm hấp dẫn của JWT.

Nhưng cũng là điểm yếu: **payload không mã hóa**, chỉ là base64. Dán token vào jwt.io là đọc được hết. Đừng bao giờ để thứ gì nhạy cảm trong đó. Và vì server không lưu token, bạn **không thu hồi được** một token trước khi nó hết hạn (người dùng đổi mật khẩu, token cũ vẫn dùng được tới hết 24 giờ). Với Pulse, chấp nhận được. Với ngân hàng thì không, họ dùng session lưu trong database hoặc Redis, có thể xóa bất kỳ lúc nào.

| | JWT | Session trong DB/Redis |
|---|---|---|
| Mỗi request | Chỉ tính HMAC | Một lần tra database |
| Thu hồi | Không, chờ hết hạn | Xóa dòng là xong |
| Nhiều server | Chỉ cần chung khóa | Chung database |
| Dữ liệu trong token | Lộ, chỉ base64 | Nằm ở server |

#### Bước 1: Thư viện và migration
```sh
go get github.com/golang-jwt/jwt/v5 golang.org/x/crypto
```
<mark>golang.org/x/crypto/bcrypt</mark> là bcrypt do nhóm Go duy trì. <mark>golang-jwt/jwt</mark> là thư viện JWT phổ biến nhất của Go.
```sql
-- internal/store/migrations/00003_create_users.sql
-- +goose Up
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monitor từ bài trước chưa có chủ, xóa đi rồi mới bắt buộc user_id.
DELETE FROM monitors;

ALTER TABLE monitors
    ADD COLUMN user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX monitors_user_id_idx ON monitors (user_id);

-- +goose Down
ALTER TABLE monitors DROP COLUMN user_id;
DROP TABLE users;
```
Dòng <mark>DELETE FROM monitors</mark> cần nói thẳng: nó **xóa dữ liệu**. Thêm cột <mark>NOT NULL</mark> vào bảng đang có dòng mà không có <mark>DEFAULT</mark> sẽ lỗi, và không có giá trị mặc định nào hợp lý cho "chủ sở hữu" cả. Ở môi trường học, monitor từ bài trước chỉ là dữ liệu thử nên xóa là đơn giản nhất. Ở production bạn làm nhiều bước: thêm cột cho phép NULL, viết script gán chủ cho từng dòng, rồi mới đặt <mark>NOT NULL</mark> (bài 114 bàn về migration an toàn). Ghi chú ngay trong file migration để người sau hiểu.

#### Bước 2: Package user
```go
// internal/user/user.go
// Package user định nghĩa người dùng của hệ thống.
package user

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"
)

var (
	ErrNotFound   = errors.New("user not found")
	ErrEmailTaken = errors.New("email already registered")
)

// User là một tài khoản. PasswordHash không bao giờ trả ra JSON.
type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

// Credentials là dữ liệu đăng ký / đăng nhập gửi lên.
type Credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Validate kiểm tra email và mật khẩu. Trả về map rỗng nếu hợp lệ.
func (c *Credentials) Validate() map[string]string {
	problems := map[string]string{}

	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if _, err := mail.ParseAddress(c.Email); err != nil || len(c.Email) > 254 {
		problems["email"] = "email không hợp lệ"
	}
	if len(c.Password) < 8 {
		problems["password"] = "ít nhất 8 ký tự"
	} else if len(c.Password) > 72 {
		problems["password"] = "tối đa 72 ký tự"
	}
	return problems
}

// Store là nơi lưu người dùng.
type Store interface {
	Create(ctx context.Context, u *User) error
	GetByEmail(ctx context.Context, email string) (User, error)
	Get(ctx context.Context, id int64) (User, error)
}
```
- Tag <mark>json:"-"</mark> bảo <mark>encoding/json</mark> **bỏ qua** trường này. Dù bạn có lỡ <mark>writeJSON(w, 200, u)</mark> nguyên struct, hash không bao giờ lọt ra ngoài. Đặt rào ở kiểu dữ liệu thay vì nhớ ở từng handler.
- Email được hạ chữ thường trước khi kiểm tra và lưu: <mark>An@Example.com</mark> và <mark>an@example.com</mark> là một người. Nếu không, sau này có hai tài khoản "khác nhau" và người dùng không đăng nhập được vì gõ hoa thường khác lúc đăng ký.
- <mark>net/mail.ParseAddress</mark> có sẵn trong thư viện chuẩn, không cần regex email tự viết (thứ gần như luôn sai).
- Mật khẩu tối đa **72 ký tự** vì bcrypt chỉ đọc 72 byte đầu, phần sau bị bỏ lặng lẽ. Chặn sớm để không ai tưởng mật khẩu 100 ký tự của mình an toàn hơn.

#### Bước 3: bcrypt và JWT
```go
// internal/auth/password.go
// Package auth lo mật khẩu và token đăng nhập.
package auth

import "golang.org/x/crypto/bcrypt"

// HashPassword băm mật khẩu bằng bcrypt. Mỗi lần băm cho ra chuỗi khác nhau (có salt).
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

// CheckPassword so mật khẩu người dùng gõ với hash đã lưu.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
```
Vì sao không <mark>sha256(mật khẩu)</mark>? SHA-256 được thiết kế để **nhanh**: một card đồ họa tính hàng tỷ hash mỗi giây, nên kẻ có database của bạn dò ra mật khẩu 8 ký tự trong vài giờ. bcrypt được thiết kế để **chậm có chủ đích** (<mark>DefaultCost</mark> = 10, khoảng 50-100ms một lần băm) và có **salt** ngẫu nhiên gắn trong hash, nên hai người cùng mật khẩu "12345678" có hash khác nhau, và bảng tra sẵn (rainbow table) vô dụng. Gọi <mark>HashPassword("abc")</mark> hai lần, bạn nhận hai chuỗi khác nhau; <mark>CheckPassword</mark> đọc salt từ hash ra để so. 100ms cũng là lý do bài 159 sẽ giới hạn số lần đăng nhập: ai đó gửi 1.000 request/giây vào login là CPU của bạn đi hết.
```go
// internal/auth/token.go
package auth

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Tokens ký và đọc JWT.
type Tokens struct {
	secret []byte
	ttl    time.Duration
}

// NewTokens tạo bộ ký token với khóa bí mật và thời hạn.
func NewTokens(secret string, ttl time.Duration) *Tokens {
	return &Tokens{secret: []byte(secret), ttl: ttl}
}

// Issue tạo token cho người dùng có id cho trước.
func (t *Tokens) Issue(userID int64) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(userID, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(t.ttl)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
}

// Parse kiểm tra chữ ký và hạn, trả về id người dùng trong token.
func (t *Tokens) Parse(token string) (int64, error) {
	var claims jwt.RegisteredClaims
	_, err := jwt.ParseWithClaims(token, &claims, func(tok *jwt.Token) (any, error) {
		if tok.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("sai thuật toán ký")
		}
		return t.secret, nil
	})
	if err != nil {
		return 0, fmt.Errorf("token không hợp lệ: %w", err)
	}
	return strconv.ParseInt(claims.Subject, 10, 64)
}
```
<mark>RegisteredClaims</mark> là bộ trường chuẩn của JWT: <mark>sub</mark> (subject, ở đây là user id dưới dạng chuỗi), <mark>iat</mark> (phát hành lúc), <mark>exp</mark> (hết hạn). <mark>HS256</mark> là HMAC-SHA256 với khóa đối xứng: cùng một khóa để ký và kiểm tra, phù hợp khi chỉ có một hệ thống phát và nhận token.

Hàm callback trong <mark>ParseWithClaims</mark> trả về khóa dùng để kiểm chữ ký, và **phải kiểm tra <mark>tok.Method</mark>**. Đây là lỗ hổng kinh điển: kẻ tấn công sửa header thành <mark>"alg":"none"</mark> hoặc đổi sang thuật toán khác; thư viện cũ từng chấp nhận. Luôn khẳng định đúng thuật toán mình dùng. Thư viện tự kiểm tra <mark>exp</mark> và trả lỗi nếu quá hạn.

#### Bước 4: User id trong context
Sau khi middleware đọc token xong, làm sao handler biết user id? Không thể thêm tham số vào mọi handler vì chữ ký <mark>func(w, r)</mark> là cố định. Câu trả lời của Go là <mark>context.WithValue</mark>: gắn giá trị vào context của request, handler lấy ra qua <mark>r.Context()</mark>.
```go
// internal/auth/context.go
package auth

import "context"

// ctxKey là kiểu riêng để không đụng key của package khác trong context.
type ctxKey struct{}

// WithUserID gắn id người dùng vào context.
func WithUserID(ctx context.Context, id int64) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// UserID lấy id người dùng từ context. ok = false nếu chưa đăng nhập.
func UserID(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(ctxKey{}).(int64)
	return id, ok
}
```
Vì sao key là <mark>ctxKey{}</mark> chứ không phải chuỗi <mark>"user_id"</mark>? Context là túi chung của cả request: middleware log, thư viện tracing, mọi thứ đều có thể nhét giá trị vào. Nếu dùng chuỗi, hai package cùng chọn <mark>"user_id"</mark> sẽ ghi đè nhau mà không ai hay. Kiểu <mark>ctxKey</mark> là **không xuất khẩu** (chữ thường) nên chỉ package <mark>auth</mark> tạo được giá trị kiểu này; không package nào khác có thể đụng vào. Đây là thành ngữ chuẩn, <mark>go vet</mark> còn cảnh báo nếu bạn dùng kiểu cơ bản làm key.

<mark>ctx.Value(...)</mark> trả về <mark>any</mark>, nên cần **type assertion** <mark>.(int64)</mark> để lấy lại <mark>int64</mark>. Dạng hai giá trị <mark>id, ok :=</mark> không panic khi không có hoặc sai kiểu, chỉ trả <mark>ok = false</mark>. Hai hàm bọc này là toàn bộ API: không ai bên ngoài cần biết bên trong là context value.

#### Bước 5: Tách store theo bảng
Bài trước <mark>store.Postgres</mark> có <mark>Create</mark>, <mark>Get</mark> cho monitor. Giờ user cũng cần <mark>Create</mark>, <mark>Get</mark>, và Go không cho hai phương thức cùng tên trên một kiểu. Hơn nữa, một struct biết mọi bảng sẽ phình to mãi. Tách ra: <mark>store.DB</mark> chỉ giữ pool và lo kết nối, migration; mỗi bảng một struct <mark>Monitors</mark>, <mark>Users</mark> cùng cầm con trỏ tới <mark>DB</mark>.
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

// DB giữ pool kết nối. Một pool dùng chung cho cả chương trình.
// Mỗi bảng có một store riêng (Monitors, Users) cùng dùng DB này.
type DB struct {
	pool *pgxpool.Pool
}

// Connect kết nối tới database và kiểm tra kết nối.
func Connect(ctx context.Context, url string) (*DB, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("cấu hình kết nối: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("không kết nối được database: %w", err)
	}
	return &DB{pool: pool}, nil
}

// Close đóng mọi kết nối. Gọi khi tắt chương trình.
func (s *DB) Close() {
	s.pool.Close()
}

// Migrate chạy các file SQL trong thư mục migrations chưa được chạy.
func (s *DB) Migrate(ctx context.Context) error {
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
Trong <mark>internal/store/monitors.go</mark> và <mark>checks.go</mark>, đổi receiver <mark>(s *Postgres)</mark> thành <mark>(s *Monitors)</mark> và <mark>s.pool</mark> thành <mark>s.db.pool</mark> (tìm-thay toàn file). Thêm vào đầu <mark>monitors.go</mark>:
```go
// internal/store/monitors.go (thêm)
// Monitors lưu monitor vào bảng monitors.
type Monitors struct {
	db *DB
}

func NewMonitors(db *DB) *Monitors {
	return &Monitors{db: db}
}
```
Store cho user, với một kỹ thuật mới là đọc mã lỗi PostgreSQL:
```go
// internal/store/users.go
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/thachnguyenp/pulse/internal/user"
)

// Users lưu người dùng vào bảng users.
type Users struct {
	db *DB
}

func NewUsers(db *DB) *Users {
	return &Users{db: db}
}

func (s *Users) Create(ctx context.Context, u *user.User) error {
	err := s.db.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id, created_at`,
		u.Email, u.PasswordHash,
	).Scan(&u.ID, &u.CreatedAt)

	// 23505 là mã lỗi "unique_violation" của PostgreSQL: email đã có người dùng.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return user.ErrEmailTaken
	}
	return err
}

func (s *Users) GetByEmail(ctx context.Context, email string) (user.User, error) {
	var u user.User
	err := s.db.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, created_at FROM users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user.User{}, user.ErrNotFound
	}
	return u, err
}

func (s *Users) Get(ctx context.Context, id int64) (user.User, error) {
	var u user.User
	err := s.db.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, created_at FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return user.User{}, user.ErrNotFound
	}
	return u, err
}
```
Email trùng: cách sai là <mark>SELECT</mark> kiểm tra trước rồi <mark>INSERT</mark>, vì hai request cùng lúc đều thấy "chưa có" rồi cùng chèn (race condition, bài 081). Cách đúng là để ràng buộc <mark>UNIQUE</mark> của database làm trọng tài và **đọc lỗi nó trả về**. pgx bọc lỗi của PostgreSQL trong <mark>*pgconn.PgError</mark> có trường <mark>Code</mark>; <mark>errors.As</mark> (bài 151 đã gặp <mark>errors.Is</mark>) tìm trong chuỗi lỗi xem có lỗi kiểu đó không và gán vào <mark>pgErr</mark>. Mã <mark>23505</mark> là <mark>unique_violation</mark>, tra ở bảng mã lỗi PostgreSQL. Ta đổi nó thành <mark>user.ErrEmailTaken</mark>, để tầng API không phải biết gì về pgx.

#### Bước 6: Ràng buộc chủ sở hữu trong SQL
<mark>Monitor</mark> thêm trường <mark>UserID int64</mark> với tag <mark>json:"-"</mark> (client không cần biết, và không được phép gửi lên để chiếm monitor của người khác). Interface <mark>monitor.Store</mark> đổi chữ ký ba hàm:
```go
// internal/monitor/monitor.go (sửa)
	Create(ctx context.Context, m *Monitor) error
	List(ctx context.Context, userID int64) ([]Monitor, error)
	Get(ctx context.Context, userID, id int64) (Monitor, error)
	Delete(ctx context.Context, userID, id int64) error
```
Và trong store, mọi câu truy vấn theo id đều thêm điều kiện <mark>user_id</mark>:
```go
// internal/store/monitors.go (sửa)
const monitorColumns = `id, user_id, name, url, interval_seconds, last_status, next_check_at, created_at`

// Get tìm theo id VÀ user_id: người này không bao giờ đọc được monitor của người khác.
func (s *Monitors) Get(ctx context.Context, userID, id int64) (monitor.Monitor, error) {
	m, err := scanMonitor(s.db.pool.QueryRow(ctx,
		`SELECT `+monitorColumns+` FROM monitors WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return monitor.Monitor{}, monitor.ErrNotFound
	}
	return m, err
}

func (s *Monitors) Delete(ctx context.Context, userID, id int64) error {
	tag, err := s.db.pool.Exec(ctx, `DELETE FROM monitors WHERE id = $1 AND user_id = $2`, id, userID)
```
Tương tự <mark>List</mark> thêm <mark>WHERE user_id = $1</mark>, <mark>Create</mark> chèn thêm <mark>user_id</mark>, <mark>scanMonitor</mark> đọc thêm <mark>&m.UserID</mark>. Đây là cách phòng **IDOR** (bài 092): kẻ xấu đăng nhập bằng tài khoản của mình rồi gọi <mark>/monitors/1</mark>, <mark>/monitors/2</mark>... để dò dữ liệu người khác. Nếu kiểm tra quyền bằng <mark>if m.UserID != userID</mark> trong handler, một ngày nào đó sẽ có handler quên. Đặt điều kiện trong SQL thì **không có đường nào** lấy được dòng của người khác. Monitor của người khác trả về <mark>ErrNotFound</mark>, tức 404 chứ không phải 403, để không tiết lộ "id đó có tồn tại".

Trong <mark>internal/api/monitors.go</mark>, các chỗ gọi store lấy user id từ context:
```go
// internal/api/monitors.go (sửa)
func (s *Server) listMonitors(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r.Context())
	list, err := s.monitors.List(r.Context(), userID)
	// ...

// trong createMonitor, sau Validate:
	m.UserID, _ = auth.UserID(r.Context())

// trong findMonitor:
	userID, _ := auth.UserID(r.Context())
	m, err := s.monitors.Get(r.Context(), userID, id)

// trong deleteMonitor:
	if err := s.monitors.Delete(r.Context(), m.UserID, m.ID); err != nil {
```
Bỏ qua <mark>ok</mark> bằng <mark>_</mark> là an toàn ở đây vì các handler này chỉ chạy sau middleware <mark>requireAuth</mark>.

#### Bước 7: Handler và middleware
```go
// internal/api/auth.go
package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/thachnguyenp/pulse/internal/auth"
	"github.com/thachnguyenp/pulse/internal/user"
)

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var creds user.Credentials
	if err := readJSON(r, &creds); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if problems := creds.Validate(); len(problems) > 0 {
		writeValidation(w, problems)
		return
	}

	hash, err := auth.HashPassword(creds.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "không tạo được tài khoản")
		return
	}
	u := user.User{Email: creds.Email, PasswordHash: hash}
	err = s.users.Create(r.Context(), &u)
	if errors.Is(err, user.ErrEmailTaken) {
		writeError(w, http.StatusConflict, "email đã được đăng ký")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "không tạo được tài khoản")
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var creds user.Credentials
	if err := readJSON(r, &creds); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	creds.Email = strings.ToLower(strings.TrimSpace(creds.Email))

	u, err := s.users.GetByEmail(r.Context(), creds.Email)
	// Sai email hay sai mật khẩu đều báo giống nhau, để không lộ email nào đã đăng ký.
	if err != nil || !auth.CheckPassword(u.PasswordHash, creds.Password) {
		writeError(w, http.StatusUnauthorized, "email hoặc mật khẩu không đúng")
		return
	}

	token, err := s.tokens.Issue(u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "không tạo được token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.UserID(r.Context())
	u, err := s.users.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "tài khoản không còn tồn tại")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// requireAuth đọc header "Authorization: Bearer <token>", đặt user id vào context.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			writeError(w, http.StatusUnauthorized, "cần đăng nhập")
			return
		}
		id, err := s.tokens.Parse(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "token không hợp lệ hoặc đã hết hạn")
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithUserID(r.Context(), id)))
	})
}
```
Mã HTTP cho đăng ký: 201 tạo xong, 422 dữ liệu sai (kèm từng trường), **409 Conflict** email đã có. Đăng nhập sai trả **401** với cùng một câu dù email không tồn tại hay mật khẩu sai. Nếu báo riêng "email chưa đăng ký", kẻ xấu dò được danh sách email có tài khoản để đi lừa đảo hoặc thử mật khẩu rò rỉ từ nơi khác (bài 088 về account takeover). Một chi tiết nhỏ: khi email không tồn tại, <mark>u.PasswordHash</mark> rỗng nên <mark>CheckPassword</mark> trả về nhanh hơn hẳn 100ms của bcrypt; kẻ tinh ý đo thời gian cũng đoán được. Bài tập cuối bài bàn tiếp.

<mark>requireAuth</mark> là middleware giống <mark>logging</mark> ở bài 154: nhận một handler, trả về handler mới. <mark>strings.CutPrefix</mark> vừa kiểm tra tiền tố <mark>"Bearer "</mark> vừa cắt nó đi. <mark>r.WithContext(...)</mark> tạo bản sao request với context mới có user id, rồi gọi handler thật.

Đăng ký route với một closure nhỏ:
```go
// internal/api/server.go (sửa)
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("POST /auth/register", s.register)
	mux.HandleFunc("POST /auth/login", s.login)

	// Các route dưới đây bắt buộc đăng nhập.
	protected := func(pattern string, h http.HandlerFunc) {
		mux.Handle(pattern, s.requireAuth(h))
	}
	protected("GET /me", s.me)
	protected("GET /monitors", s.listMonitors)
	protected("POST /monitors", s.createMonitor)
	protected("GET /monitors/{id}", s.getMonitor)
	protected("DELETE /monitors/{id}", s.deleteMonitor)
	protected("POST /monitors/{id}/check", s.checkMonitor)
	protected("GET /monitors/{id}/checks", s.listChecks)
	protected("GET /monitors/{id}/stats", s.monitorStats)
```
<mark>Server</mark> có thêm hai trường <mark>users user.Store</mark> và <mark>tokens *auth.Tokens</mark>, <mark>New</mark> nhận thêm hai tham số tương ứng. Lưu ý <mark>http.HandlerFunc</mark> (kiểu hàm) tự thỏa interface <mark>http.Handler</mark>, nên truyền thẳng <mark>s.me</mark> vào <mark>requireAuth</mark> được.

#### Bước 8: Cấu hình và main
<mark>Config</mark> thêm <mark>JWTSecret</mark> (đọc <mark>JWT_SECRET</mark>, từ chối nếu ngắn hơn 32 ký tự) và <mark>TokenTTL</mark> 24 giờ. Khóa ngắn là khóa dễ dò: với HS256, kẻ có một token hợp lệ có thể dò khóa offline. Tạo khóa thật bằng <mark>openssl rand -base64 48</mark>. Thêm vào <mark>.env.example</mark>:
```sh
JWT_SECRET=doi-chuoi-nay-thanh-chuoi-ngau-nhien-dai-it-nhat-32-ky-tu
```
Trong <mark>cmd/pulsed/main.go</mark>, đổi theo cấu trúc store mới:
```go
// cmd/pulsed/main.go (sửa)
	db, err := store.Connect(ctx, cfg.DatabaseURL)
	// ...
	chk := checker.New(cfg.CheckTimeout)
	monitors := store.NewMonitors(db)
	tokens := auth.NewTokens(cfg.JWTSecret, cfg.TokenTTL)
	server := api.New(monitors, store.NewUsers(db), chk, tokens)
	sched := scheduler.New(monitors, chk, cfg.Workers)
```
Scheduler vẫn nhận <mark>monitors</mark>: nó chỉ cần <mark>ClaimDue</mark> và <mark>SaveCheck</mark> vốn không dính tới user.

#### Chạy thử
```sh
curl -X POST localhost:3000/auth/register -d '{"email":"An@Example.com","password":"matkhau123"}'
curl -X POST localhost:3000/auth/register -d '{"email":"an@example.com","password":"matkhau123"}'
curl -X POST localhost:3000/auth/register -d '{"email":"khong-phai-email","password":"123"}'
```
```json
{"id":1,"email":"an@example.com","created_at":"2026-11-04T23:27:55.967607+07:00"}
{"error":"email đã được đăng ký"}
{"error":"dữ liệu không hợp lệ","fields":{"email":"email không hợp lệ","password":"ít nhất 8 ký tự"}}
```
Email đã về chữ thường, không có <mark>password_hash</mark> trong JSON, đăng ký lại bị 409. Đăng nhập:
```sh
curl -X POST localhost:3000/auth/login -d '{"email":"an@example.com","password":"sai"}'
curl -X POST localhost:3000/auth/login -d '{"email":"an@example.com","password":"matkhau123"}'
```
```json
{"error":"email hoặc mật khẩu không đúng"}
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzYyMzU5Mjc2LCJpYXQiOjE3NjIyNzI4NzZ9.H3sQ..."}
```
Dán token vào jwt.io: phần payload hiện <mark>{"sub":"1","exp":...,"iat":...}</mark> rõ ràng, phần chữ ký báo "invalid" vì trang đó không có khóa của bạn. Thử sửa <mark>sub</mark> thành 2 rồi dùng token sửa: server từ chối, vì chữ ký không còn khớp.

Lưu token vào biến rồi gọi các route cần đăng nhập:
```sh
TOKEN=eyJhbGciOi...
curl localhost:3000/monitors
curl -H "Authorization: Bearer xxx" localhost:3000/monitors
curl -H "Authorization: Bearer $TOKEN" localhost:3000/me
curl -H "Authorization: Bearer $TOKEN" -X POST localhost:3000/monitors -d '{"name":"Fake flaky","url":"http://localhost:8080/flaky","interval_seconds":10}'
```
```json
{"error":"cần đăng nhập"}
{"error":"token không hợp lệ hoặc đã hết hạn"}
{"id":1,"email":"an@example.com","created_at":"2026-11-04T23:27:55.967607+07:00"}
{"id":5,"name":"Fake flaky","url":"http://localhost:8080/flaky","interval_seconds":10,"last_status":"pending","next_check_at":"2026-11-04T23:27:56.215498+07:00","created_at":"2026-11-04T23:27:56.215498+07:00"}
```
Giờ đăng ký thêm <mark>binh@example.com</mark>, đăng nhập lấy token thứ hai, và thử đọc monitor của An:
```sh
curl -H "Authorization: Bearer $T2" localhost:3000/monitors/5
curl -H "Authorization: Bearer $T2" localhost:3000/monitors
```
```json
{"error":"không có monitor này"}
[]
```
Bình nhận 404 và danh sách rỗng, dù monitor 5 có thật. Đó là điều kiện <mark>AND user_id = $2</mark> làm việc.

#### Mẹo và lỗi hay gặp
- **Token để đâu ở client?** Mobile app: secure storage. Web SPA: trong bộ nhớ (biến JS) hoặc cookie <mark>HttpOnly</mark> do server đặt; <mark>localStorage</mark> đọc được bởi bất kỳ script nào chạy trên trang, kể cả script bị chèn (XSS). Bài 145 đã chọn cookie vì lý do này.
- **Đổi <mark>JWT_SECRET</mark>** là mọi token đang có đều mất hiệu lực, mọi người phải đăng nhập lại. Đó cũng là "nút khẩn cấp" khi nghi khóa bị lộ.
- **Hạn token ngắn + refresh token** là cách thông dụng để giảm rủi ro không thu hồi được: access token 15 phút, refresh token lưu database để đổi lấy access token mới. Pulse dùng 24 giờ cho đơn giản.
- **bcrypt trong test chậm**: mỗi lần đăng ký mất ~100ms, test có 10 lần đăng ký mất 1 giây. Bài 161 sẽ thấy; cách thường làm là cho phép cấu hình cost thấp khi test.
- **<mark>ctx.Value</mark> không phải chỗ để truyền tham số nghiệp vụ.** Chỉ dùng cho dữ liệu "theo request" mà mọi tầng đều có thể cần: user id, request id, trace id. Tham số của hàm thì truyền tường minh.

#### Checklist
- Đăng ký với email viết hoa: lưu chữ thường; đăng ký lại: 409.
- Mật khẩu 7 ký tự hoặc email thiếu @: 422 với đúng trường sai.
- Đăng nhập sai mật khẩu và đăng nhập email không tồn tại: cùng một thông báo, cùng 401.
- Không có header, header rác, token bị sửa một ký tự: đều 401.
- Hai tài khoản không thấy monitor của nhau; <mark>DELETE</mark> monitor của người khác cũng 404.
- Trong psql: <mark>select email, password_hash from users</mark> thấy hash bắt đầu bằng <mark>$2a$10$</mark>, mỗi người một chuỗi khác nhau dù cùng mật khẩu.

Mã nguồn cuối bài: [post_157.zip](/assets/code/post_157.zip).

#### Bài tập thêm
- Khi email không tồn tại, vẫn gọi <mark>CheckPassword</mark> với một hash giả cố định, để thời gian phản hồi của hai trường hợp bằng nhau.
- Thêm <mark>POST /auth/change-password</mark>: cần mật khẩu cũ, băm mật khẩu mới, lưu lại.
- Thêm cột <mark>token_version</mark> vào <mark>users</mark>, đưa vào claims khi ký, và so sánh trong <mark>requireAuth</mark>: tăng cột này lên là thu hồi mọi token của người đó. Bạn vừa đánh đổi "không tra database" để lấy khả năng thu hồi, hãy cân nhắc đổi lúc nào.
