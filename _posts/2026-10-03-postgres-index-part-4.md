---
layout: post
title:  "114. PostgreSQL Index (Migration an toàn & Gem phát hiện query chậm)."
date:   2026-10-03 02:06:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_114/postgres-index-rails-tools.png
---
Ba bài trước nói về index và query. Bài này về hai thứ còn lại để áp dụng chúng trong một dự án Rails thật: viết **migration không làm sập production**, và dùng **gem** để máy tìm query dở thay vì chờ khách phàn nàn.

#### Migration: vấn đề là lock
Nhiều lệnh DDL (<mark>ALTER TABLE</mark>, <mark>CREATE INDEX</mark>) lấy **lock toàn bảng** cho tới khi xong. Trong lúc đó, mọi <mark>SELECT</mark>, <mark>INSERT</mark> vào bảng phải **xếp hàng chờ**. Với bảng 50 triệu dòng, một migration tưởng vô hại có thể treo trang web vài phút.

Tệ hơn: lock có tính xếp hàng. Migration chờ một transaction dài đang chạy để lấy lock, và **tất cả query sau nó cũng phải chờ theo**, kể cả những query chỉ đọc. Vì vậy, luôn đặt giới hạn thời gian chờ lock
```yaml
# config/database.yml

production:
  variables:
    lock_timeout: 5s          # chờ lock tối đa 5 giây rồi bỏ, migration fail chứ không treo app
    statement_timeout: 30s    # chặn query chạy quá lâu (web process)
```
Migration fail thì chạy lại lúc khác, còn hơn app chết.

#### Gem strong_migrations
Gem này **chặn** migration nguy hiểm ngay lúc chạy và in ra cách viết an toàn
```ruby
# Gemfile
gem "strong_migrations"
```
```sh
bundle install
bin/rails g strong_migrations:install
```
Viết một migration thêm index như bình thường
```ruby
class AddUserIdIndexToOrders < ActiveRecord::Migration[8.0]
  def change
    add_index :orders, :user_id
  end
end
```
```
=== Dangerous operation detected #strong_migrations ===

Adding an index non-concurrently blocks writes. Instead, use:

class AddUserIdIndexToOrders < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def change
    add_index :orders, :user_id, algorithm: :concurrently
  end
end
```
Copy đúng gợi ý là xong. Nó cũng tự đặt <mark>lock_timeout</mark> cho migration (<mark>StrongMigrations.lock_timeout = 10.seconds</mark> trong initializer). Những trường hợp hay gặp và cách viết an toàn:

| Việc cần làm | Nguy hiểm | An toàn |
|---|---|---|
| Thêm index | <mark>add_index</mark> | <mark>algorithm: :concurrently</mark> + <mark>disable_ddl_transaction!</mark> |
| Thêm reference | <mark>add_reference :orders, :user</mark> | <mark>add_reference ..., index: { algorithm: :concurrently }</mark> |
| Thêm foreign key | <mark>add_foreign_key</mark> (quét cả bảng để kiểm tra) | <mark>add_foreign_key ..., validate: false</mark>, migration sau <mark>validate_foreign_key</mark> |
| Thêm cột <mark>NOT NULL</mark> | <mark>add_column ..., null: false</mark> | 4 bước, xem bên dưới |
| Đổi tên cột/bảng | <mark>rename_column</mark> (code cũ đang chạy sẽ lỗi ngay) | Thêm cột mới, ghi cả 2, backfill, đổi code, xóa cột cũ |
| Đổi kiểu cột | <mark>change_column :id, :bigint</mark> (ghi lại cả bảng) | Thêm cột mới, backfill, đổi tên |
| Xóa cột | <mark>remove_column</mark> | Deploy <mark>ignored_columns</mark> trước, migration xóa sau |
| Backfill dữ liệu | <mark>update_all</mark> trong migration | <mark>in_batches</mark>, ngoài transaction |

#### Thêm cột NOT NULL
Ví dụ thêm <mark>orders.channel</mark> (web, app, pos) bắt buộc. Làm trong 4 bước, mỗi bước là một migration hoặc deploy riêng:
```ruby
# 1. Thêm cột cho phép null, có default. Từ PostgreSQL 11, default không ghi lại cả bảng nên rất nhanh
class AddChannelToOrders < ActiveRecord::Migration[8.0]
  def change
    add_column :orders, :channel, :string, default: "web"
  end
end
```
```ruby
# 2. Backfill dòng cũ theo lô, không giữ lock lâu
class BackfillOrdersChannel < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def up
    Order.unscoped.in_batches(of: 10_000) do |batch|
      batch.where(channel: nil).update_all(channel: "web")
      sleep(0.05) # cho các query khác thở
    end
  end
end
```
```ruby
# 3. Thêm ràng buộc nhưng chưa kiểm tra dữ liệu cũ (không lock lâu), rồi validate riêng
class AddChannelNotNullToOrders < ActiveRecord::Migration[8.0]
  def change
    add_check_constraint :orders, "channel IS NOT NULL", name: "orders_channel_null", validate: false
  end
end

class ValidateChannelNotNullOnOrders < ActiveRecord::Migration[8.0]
  def change
    validate_check_constraint :orders, name: "orders_channel_null"
    change_column_null :orders, :channel, false   # giờ đã an toàn, PostgreSQL dùng check constraint có sẵn
    remove_check_constraint :orders, name: "orders_channel_null"
  end
end
```
Nhiều bước, nhưng mỗi bước chỉ lock vài mili giây. strong_migrations in sẵn công thức này khi bạn viết sai.

Với dữ liệu lớn (hàng chục triệu dòng), bước backfill nên là rake task hoặc gem <mark>maintenance_tasks</mark> (của Shopify) thay vì migration, để có thể tạm dừng, chạy tiếp, theo dõi tiến độ.

#### Xóa cột
Rails cache danh sách cột của mỗi model lúc boot. Xóa cột trong lúc code cũ còn chạy thì mọi <mark>SELECT *</mark> của model đó lỗi <mark>PG::UndefinedColumn</mark>. Thứ tự đúng:
```ruby
# Deploy 1: báo Rails bỏ qua cột
class Order < ApplicationRecord
  self.ignored_columns += ["legacy_code"]
end
```
```ruby
# Deploy 2: xóa thật
class RemoveLegacyCodeFromOrders < ActiveRecord::Migration[8.0]
  def change
    safety_assured { remove_column :orders, :legacy_code, :string }
  end
end
```
<mark>safety_assured</mark> là cách nói với strong_migrations "tôi biết tôi đang làm gì". Dùng cẩn thận, và ghi rõ lý do trong commit.

#### Vài thói quen khác với migration
- **Không dùng model trong migration** (hoặc khai báo model tối giản ngay trong file). Migration chạy sau 6 tháng, model lúc đó đã đổi, validation hay callback làm migration fail.
- **Tách migration schema và migration dữ liệu**. Schema thì nhanh và trong transaction; dữ liệu thì theo lô và ngoài transaction.
- **Luôn có <mark>down</mark>** (hoặc dùng <mark>change</mark> với lệnh đảo ngược được), để rollback khi deploy lỗi.
- Đặt tên index rõ ràng khi index có điều kiện hoặc biểu thức: <mark>name: "orders_pending_idx"</mark>, vì tên tự sinh rất dài và khó đọc trong <mark>EXPLAIN</mark>.
- Chạy migration trên bản sao production (hoặc staging có dữ liệu thật) và đo thời gian trước khi chạy thật.
- Kiểm tra <mark>db/schema.rb</mark> sau migration có đúng ý không: partial index, expression index, extension đều được dump vào đây. Chỉ cần đổi sang <mark>structure.sql</mark> khi dùng trigger, function, hay kiểu dữ liệu tự định nghĩa.

#### Gem phát hiện query dở
Giờ sang phần thứ hai. Có 3 lớp công cụ, dùng ở 3 thời điểm khác nhau:

| Lúc nào | Công cụ | Phát hiện |
|---|---|---|
| Đang code | <mark>bullet</mark> hoặc <mark>prosopite</mark>, <mark>rack-mini-profiler</mark> | N+1, eager load thừa, query chậm trên trang đang mở |
| Chạy test / CI | <mark>active_record_doctor</mark>, <mark>database_consistency</mark>, <mark>strict_loading</mark> | Thiếu index, thiếu foreign key, validation lệch với constraint |
| Production | <mark>pghero</mark>, APM | Query tốn nhiều thời gian nhất, index thiếu, index không dùng |

#### bullet: N+1 khi đang code
```ruby
# Gemfile
gem "bullet", group: [:development, :test]
```
```ruby
# config/environments/development.rb

config.after_initialize do
  Bullet.enable = true
  Bullet.rails_logger = true   # ghi vào log
  Bullet.add_footer = true     # hiện ở góc trang web
end
```
```ruby
# config/environments/test.rb

config.after_initialize do
  Bullet.enable = true
  Bullet.raise = true          # test fail nếu có N+1
end
```
Mở trang danh sách đơn hàng
```
USE eager loading detected
  Order => [:user]
  Add to your query: .includes([:user])
Call stack
  app/views/orders/index.html.erb:12
```
Bullet cũng báo chiều ngược lại: <mark>includes</mark> một association mà view không dùng tới (<mark>AVOID eager loading</mark>), và gợi ý <mark>counter_cache</mark> khi thấy <mark>order.items.size</mark> gọi lặp.

<mark>prosopite</mark> là lựa chọn thay thế, cách phát hiện đơn giản hơn (tìm query giống nhau lặp lại) nên ít báo nhầm hơn bullet, nhưng không gợi ý sửa.

#### strict_loading: Rails tự có
Không cần gem. Rails 6.1 trở lên có thể cấm lazy loading
```ruby
# config/environments/test.rb
config.active_record.strict_loading_by_default = true
```
```ruby
order = Order.first
order.user
# => ActiveRecord::StrictLoadingViolationError:
#    `Order` is marked for strict_loading. The User association named `:user` cannot be lazily loaded.
```
Bật ở test, mọi chỗ thiếu <mark>includes</mark> sẽ fail ngay. Với dự án đang chạy, bật toàn bộ sẽ vỡ rất nhiều test, có thể bật từng chỗ: <mark>Order.strict_loading.where(...)</mark>, hoặc <mark>has_many :items, strict_loading: true</mark>.

Hai cấu hình khác nên bật ở development
```ruby
# config/environments/development.rb

config.active_record.verbose_query_logs = true      # mỗi query ghi kèm dòng code sinh ra nó
config.active_record.query_log_tags_enabled = true  # gắn controller/action vào SQL, nhìn thấy trong pg_stat_activity
```

#### rack-mini-profiler: xem query của trang đang mở
```ruby
# Gemfile
gem "rack-mini-profiler", group: :development
```
Góc trên bên trái mỗi trang hiện thời gian tải, bấm vào thấy từng query SQL, mất bao lâu, gọi từ đâu. Thêm <mark>?pp=analyze-memory</mark> hay <mark>?pp=flamegraph</mark> (cần gem <mark>stackprof</mark>) để đào sâu hơn. Rất hợp để trả lời "trang này sao chậm" trong 30 giây.

#### active_record_doctor: kiểm tra schema
Gem này đọc schema và model rồi báo những thứ **thiếu**, dạng mà không có khách nào phàn nàn nhưng sớm muộn cũng thành bug
```ruby
# Gemfile
gem "active_record_doctor", group: :development
```
```sh
bin/rails active_record_doctor
```
```
unindexed_foreign_keys: add an index on orders.user_id - foreign keys are often used in database lookups
missing_foreign_keys: create a foreign key on orders.user_id - looks like an association without a foreign key constraint
missing_unique_indexes: add a unique index on users(email) - validating uniqueness in the model without an index can lead to duplicates
missing_non_null_constraint: add `NOT NULL` to orders.status - models validates its presence but it's not non-NULL in the database
extraneous_indexes: remove index_orders_on_user_id - can be replaced by index_orders_on_user_id_and_created_at
```
Từng dòng tương ứng với một bài học của bài 111 và 112. Chạy nó trong CI để không ai thêm <mark>belongs_to</mark> mà quên index. Có thể bỏ qua các cảnh báo đã biết bằng file <mark>.active_record_doctor.rb</mark>.

Gem <mark>database_consistency</mark> làm việc tương tự nhưng tập trung vào sự lệch giữa validation của Rails và constraint của database.

#### pghero: nhìn vào production
```ruby
# Gemfile
gem "pghero"
gem "pg_query"   # để pghero gợi ý index
```
```ruby
# config/routes.rb
mount PgHero::Engine, at: "pghero"
```
Nhớ bảo vệ route này (chỉ admin). pghero cần <mark>pg_stat_statements</mark> đã bật (bài 113) và cho một giao diện web với:
- **Queries**: query tốn nhiều thời gian nhất, chính là <mark>pg_stat_statements</mark> nhưng dễ đọc, và có nút xem <mark>EXPLAIN</mark>.
- **Index**: index chưa dùng (<mark>idx_scan = 0</mark>), index trùng lặp, và **gợi ý index còn thiếu** dựa trên query thực tế.
- **Space**: bảng và index nào chiếm nhiều đĩa, bloat.
- **Connections**, **Live queries**: ai đang chạy gì, có query nào đang chờ lock.

Chạy job định kỳ để lưu lịch sử, nhờ đó thấy query nào mới chậm lên sau lần deploy nào
```yaml
# config/recurring.yml (Solid Queue)
production:
  pghero_capture:
    command: "PgHero.capture_query_stats"
    schedule: every 5 minutes
```

#### Quy trình tôi hay dùng
1. Setup một lần: <mark>strong_migrations</mark>, <mark>bullet</mark> (raise ở test), <mark>active_record_doctor</mark> trong CI, <mark>pghero</mark> ở production.
2. Khi code: nhìn footer của bullet và rack-mini-profiler trên trang đang làm.
3. Trước khi merge: <mark>bin/rails active_record_doctor</mark>, và đọc migration một lần với câu hỏi "lệnh này lock bảng bao lâu?".
4. Mỗi tuần: mở pghero, lấy 5 query tốn nhiều thời gian nhất, <mark>EXPLAIN (ANALYZE, BUFFERS)</mark>, sửa theo bài 113.

#### Tổng kết series

| Bài | Nội dung |
|---|---|
| 111 | B-tree, đọc EXPLAIN, thứ tự cột, partial, covering |
| 112 | Expression, trigram, GIN, BRIN |
| 113 | Tìm query chậm, 7 lỗi hay gặp |
| 114 | Migration an toàn, gem phát hiện query dở |

Index và query tốt không phải việc làm một lần. Có công cụ chạy sẵn thì mỗi lần thêm tính năng, lỗi sẽ được bắt lúc còn ở development thay vì lúc 2 giờ sáng trên production.
