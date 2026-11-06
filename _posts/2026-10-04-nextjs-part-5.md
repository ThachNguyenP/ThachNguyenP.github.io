---
layout: post
title:  "142. Next.js cho người mới (Bài 5: Database với Prisma & SQLite)."
date:   2026-10-04 09:40:00 +0700
author: thach
categories: [Coding]
tags: [Javascript, Next.js]
image: assets/images/post_142/nextjs-prisma.png
---
Sản phẩm vẫn nằm trong một mảng trong code: thêm sản phẩm phải sửa code và build lại. Bài này đưa dữ liệu vào **database thật** với Prisma. Và vì bài 141 đã gói mọi truy cập dữ liệu vào 3 hàm trong <mark>lib/products.ts</mark>, hôm nay chỉ sửa đúng file đó, **không trang nào phải đổi**.

#### Prisma là gì
Prisma là ORM: bạn mô tả bảng trong một file <mark>schema.prisma</mark>, Prisma tạo bảng trong database (**migration**) và sinh ra một **client TypeScript** biết chính xác bảng nào có cột gì. Gõ <mark>prisma.product.</mark> là VS Code gợi ý <mark>findMany</mark>, <mark>findUnique</mark>, <mark>create</mark>..., gõ sai tên cột là báo đỏ.

Database dùng trong lúc học là **SQLite**: một file <mark>dev.db</mark> trong dự án, không cần cài server gì. Bài 149 chuyển sang PostgreSQL bằng cách đổi 2 dòng.

Phiên bản: Prisma **6**. Prisma 7 (cuối 2025) đổi khá nhiều (client không còn engine Rust, cách cấu hình khác); 6 là bản ổn định với nhiều tài liệu nhất hiện nay.

#### Bước 1: Cài và khởi tạo
```sh
npm install prisma@6 @prisma/client@6
npm install -D tsx dotenv
npx prisma init --datasource-provider sqlite
```
<mark>prisma</mark> là công cụ dòng lệnh (migrate, studio), <mark>@prisma/client</mark> là thư viện dùng trong code. <mark>tsx</mark> để chạy file TypeScript trực tiếp (cho script seed), <mark>dotenv</mark> để Prisma đọc file <mark>.env</mark>.

<mark>prisma init</mark> tạo 3 file:
- <mark>.env</mark> chứa <mark>DATABASE_URL="file:./dev.db"</mark>, đường dẫn tới file SQLite (tương đối so với thư mục <mark>prisma/</mark>). File này đã nằm trong <mark>.gitignore</mark>, không commit.
- <mark>prisma/schema.prisma</mark>: mô tả database, sửa ở bước 2.
- <mark>prisma.config.ts</mark>: cấu hình Prisma CLI (bản 6.19 trở lên mới có; nếu phiên bản của bạn không tạo, tự tạo với nội dung dưới). Thêm dòng <mark>seed</mark> cho bước 3:

```ts
// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

#### Bước 2: Schema và migration
```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Product {
  id          Int      @id @default(autoincrement())
  slug        String   @unique
  name        String
  brand       String
  category    String
  price       Int
  oldPrice    Int?
  emoji       String
  description String
  stock       Int      @default(0)
  createdAt   DateTime @default(now())
}
```
Mỗi <mark>model</mark> là một bảng, mỗi dòng là một cột: tên, kiểu, và thuộc tính. <mark>@id @default(autoincrement())</mark> là khóa chính tự tăng; <mark>@unique</mark> không cho 2 sản phẩm trùng slug (và tạo index để tìm theo slug nhanh); <mark>Int?</mark> là cột được phép rỗng (NULL); <mark>@default(now())</mark> tự điền thời điểm tạo. Các trường giống hệt <mark>type Product</mark> của bài 139, không phải ngẫu nhiên.

Tạo bảng từ schema
```sh
npx prisma migrate dev --name init
```
Prisma tạo file <mark>prisma/dev.db</mark>, viết SQL vào <mark>prisma/migrations/2026..._init/migration.sql</mark> và chạy nó:
```sql
-- CreateTable
CREATE TABLE "Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "oldPrice" INTEGER,
    "emoji" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
```
Đây chính là SQL mà bạn sẽ viết tay nếu không có Prisma. File migration được **commit** vào git: đồng nghiệp pull về chạy <mark>migrate dev</mark> là có database giống hệt; production chạy <mark>prisma migrate deploy</mark> (bài 149). Sau này sửa schema (thêm cột, thêm bảng) thì chạy lại <mark>migrate dev --name tên_thay_đổi</mark>, Prisma sinh migration mới chỉ chứa phần khác biệt. Series PostgreSQL bài 114 có nói về migration an toàn, áp dụng y nguyên.

<mark>migrate dev</mark> cũng tự chạy <mark>prisma generate</mark>: sinh client trong <mark>node_modules/@prisma/client</mark> khớp với schema. Mỗi khi đổi schema mà VS Code chưa thấy cột mới, chạy <mark>npx prisma generate</mark>.

#### Bước 3: Seed dữ liệu mẫu
Database trống. Script seed đưa 8 sản phẩm vào, chạy được nhiều lần không trùng nhờ <mark>upsert</mark> (có thì cập nhật, chưa có thì tạo):
```ts
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const products = [
  { slug: "galaxy-s24", name: "Galaxy S24 128GB", brand: "Samsung", category: "dien-thoai", price: 18990000, oldPrice: 23990000, emoji: "📱", description: "Màn hình 6.2 inch, camera 50MP, pin trâu, bảo hành 24 tháng.", stock: 12 },
  { slug: "wh-1000xm6", name: "WH-1000XM6", brand: "Sony", category: "tai-nghe", price: 8490000, emoji: "🎧", description: "Chống ồn chủ động thế hệ mới, pin 30 giờ.", stock: 5 },
  { slug: "watch-series-11", name: "Watch Series 11 GPS 45mm", brand: "Apple", category: "phu-kien", price: 11990000, emoji: "⌚", description: "Theo dõi sức khỏe, màn hình luôn bật.", stock: 8 },
  { slug: "macbook-air-m4", name: "MacBook Air 13 inch M4", brand: "Apple", category: "laptop", price: 27990000, oldPrice: 32990000, emoji: "💻", description: "16GB RAM, 256GB SSD, pin 18 giờ.", stock: 3 },
  { slug: "x-t50", name: "X-T50 kèm lens kit", brand: "Fujifilm", category: "phu-kien", price: 39990000, emoji: "📷", description: "Cảm biến 40MP, giả lập màu film.", stock: 2 },
  { slug: "flip-7", name: "Flip 7", brand: "JBL", category: "tai-nghe", price: 2990000, emoji: "🔊", description: "Loa di động chống nước IP68, pin 14 giờ.", stock: 20 },
  { slug: "mx-master-4", name: "MX Master 4", brand: "Logitech", category: "phu-kien", price: 2090000, oldPrice: 2990000, emoji: "🖱️", description: "Chuột không dây, cuộn MagSpeed, 70 ngày pin.", stock: 0 },
  { slug: "redmi-note-14", name: "Redmi Note 14", brand: "Xiaomi", category: "dien-thoai", price: 4990000, emoji: "📱", description: "Pin 5500mAh, sạc nhanh 45W, giá tốt.", stock: 30 },
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: product,
      create: product,
    });
  }
  console.log(`Đã seed ${products.length} sản phẩm`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```
```sh
npx prisma db seed
# Running seed command `tsx prisma/seed.ts` ...
# Đã seed 8 sản phẩm
```
Thêm script cho tiện: trong <mark>package.json</mark>, mục <mark>scripts</mark>, thêm <mark>"db:seed": "prisma db seed"</mark>.

Xem dữ liệu bằng giao diện có sẵn của Prisma
```sh
npx prisma studio
```
Mở <mark>localhost:5555</mark>, bấm bảng Product: xem, sửa, thêm dòng bằng chuột. Rất tiện khi học và khi debug.

#### Bước 4: Một PrismaClient duy nhất
```ts
// lib/db.ts
import { PrismaClient } from "@prisma/client";

// Ở development, Next.js tải lại module liên tục; nếu mỗi lần tạo PrismaClient mới
// sẽ mở quá nhiều kết nối. Giữ một instance duy nhất trên biến global.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```
Đoạn này có trong tài liệu Prisma và mọi dự án Next.js. Lý do: <mark>npm run dev</mark> nạp lại code mỗi lần bạn lưu file, nếu mỗi lần lại <mark>new PrismaClient()</mark> thì sau vài chục lần lưu sẽ có cảnh báo "too many connections". Cất instance vào <mark>globalThis</mark> (tồn tại qua các lần nạp lại) giải quyết việc đó. Copy nguyên văn là được.

#### Bước 5: Thay hàm lấy dữ liệu
```ts
// lib/products.ts
import { prisma } from "./db";
import type { Product } from "@prisma/client";

export type { Product };

export async function getProducts(query?: string): Promise<Product[]> {
  return prisma.product.findMany({
    where: query ? { OR: [{ name: { contains: query } }, { brand: { contains: query } }] } : undefined,
    orderBy: { createdAt: "asc" },
  });
}

export async function getProduct(slug: string): Promise<Product | null> {
  return prisma.product.findUnique({ where: { slug } });
}

export async function getRelatedProducts(product: Product): Promise<Product[]> {
  return prisma.product.findMany({
    where: { category: product.category, slug: { not: product.slug } },
    take: 3,
  });
}

export const formatPrice = (amount: number) => amount.toLocaleString("vi-VN") + "đ";
```
So với bài 141: mảng và <mark>delay</mark> biến mất, 3 hàm giữ nguyên tên và tham số, thân hàm thành truy vấn Prisma. Đọc truy vấn gần như đọc tiếng Anh: tìm nhiều sản phẩm **có** tên chứa query **hoặc** hãng chứa query, sắp theo ngày tạo; tìm một sản phẩm duy nhất theo slug; tìm 3 sản phẩm cùng danh mục trừ chính nó.

Kiểu <mark>Product</mark> giờ lấy từ <mark>@prisma/client</mark> (sinh từ schema) thay vì tự viết, và <mark>export type { Product }</mark> để các file khác vẫn import từ <mark>@/lib/products</mark> như cũ. Một khác biệt nhỏ: cột rỗng Prisma trả về <mark>null</mark> (<mark>oldPrice: number | null</mark>), không phải <mark>undefined</mark>; code <mark>product.oldPrice &amp;&amp; ...</mark> vẫn đúng với cả hai.

Chạy <mark>npm run dev</mark>, mở trang: **giống hệt trước**, nhưng giờ dữ liệu từ <mark>dev.db</mark>. Vào Prisma Studio đổi giá Galaxy S24, tải lại trang sản phẩm: giá mới (ở dev, mọi trang render mỗi request; ở production thì theo quy tắc cache bài 141).

Thêm <mark>prisma/dev.db*</mark> vào <mark>.gitignore</mark>: database local không commit, ai clone về thì <mark>migrate dev</mark> + <mark>db seed</mark> là có.

#### Mẹo và lỗi hay gặp
- **"PrismaClient is unable to run in this browser environment"**: bạn import <mark>lib/db.ts</mark> hoặc <mark>lib/products.ts</mark> vào một Client Component. Database chỉ chạm từ Server Component, Server Action, Route Handler. Để chặn sớm, cài <mark>server-only</mark> (<mark>npm i server-only</mark>) và thêm <mark>import "server-only"</mark> ở đầu <mark>lib/db.ts</mark>: import nhầm là lỗi build ngay.
- Tìm kiếm <mark>contains</mark> trên SQLite không phân biệt hoa thường với chữ không dấu; với PostgreSQL phải thêm <mark>mode: "insensitive"</mark>. Bài 149 sẽ nhắc.
- Đổi schema rồi quên <mark>migrate dev</mark>: lỗi "column does not exist". Quy trình luôn là: sửa schema → <mark>migrate dev --name ...</mark> → code.
- Xóa <mark>dev.db</mark> làm lại từ đầu: <mark>npx prisma migrate reset</mark> (xóa, chạy lại mọi migration, chạy seed).

#### Checklist
- <mark>npx prisma studio</mark> thấy bảng Product có 8 dòng.
- Trang web hiện đúng 8 sản phẩm, tìm kiếm và trang chi tiết hoạt động như bài 141.
- Sửa tồn kho một sản phẩm trong Studio, trang chi tiết hiện số mới.
- <mark>git status</mark>: thấy <mark>prisma/schema.prisma</mark>, <mark>prisma/migrations/</mark>, <mark>prisma/seed.ts</mark>, <mark>prisma.config.ts</mark>; **không** thấy <mark>.env</mark> và <mark>dev.db</mark>.

Mã nguồn cuối bài: [post_142.zip](/assets/code/post_142.zip). Sau khi giải nén: <mark>npm install</mark>, tạo <mark>.env</mark> với <mark>DATABASE_URL="file:./dev.db"</mark>, rồi <mark>npx prisma migrate dev</mark> và <mark>npx prisma db seed</mark>.

#### Bài tập thêm
- Thêm cột <mark>rating Float @default(0)</mark>, chạy migration, hiển thị sao ở card sản phẩm.
- Tách danh mục thành bảng riêng: <mark>model Category { id, slug @unique, name, products Product[] }</mark> và <mark>Product</mark> có <mark>category Category @relation(...)</mark>. Đọc mục "Relations" trong tài liệu Prisma, rồi dùng <mark>include: { category: true }</mark> khi query.
- Viết trang <mark>/brands/[brand]</mark> lọc theo hãng bằng <mark>findMany({ where: { brand } })</mark>.
