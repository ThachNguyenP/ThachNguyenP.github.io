---
layout: post
title:  "211. NestJS (Bài 6: Task của ai người nấy thấy: quan hệ User–Task, decorator @GetUser, migration trên bảng đã có dữ liệu)."
date:   2025-10-31 10:00:00 +0700
author: thach
categories: [Coding]
tags: [Node, NestJS]
image: assets/images/post_211/nestjs-ownership.png
---
Bài 210 bắt mọi người đăng nhập, nhưng đăng nhập xong thì ai cũng thấy **toàn bộ** task của mọi người, và xoá được task của người khác. Đây là lỗi bảo mật phổ biến nhất mà người mới (và cả người cũ) mắc: kiểm tra "đã đăng nhập chưa" nhưng quên kiểm tra "có phải của người này không". Bài này gắn mỗi task với một chủ sở hữu, lấy user hiện tại ra một cách sạch sẽ bằng decorator tự viết, và xử lý một tình huống rất thật: thêm cột bắt buộc vào bảng **đã có dữ liệu**.

#### Bước 1: quan hệ trong TypeORM
Một user có nhiều task, một task thuộc đúng một user. TypeORM gọi đó là <mark>OneToMany</mark> ở phía User và <mark>ManyToOne</mark> ở phía Task. Khoá ngoại nằm ở bảng <mark>tasks</mark> (cột <mark>userId</mark>).

```typescript
// src/tasks/task.entity.ts

import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TaskStatus } from './task.model';
import { User } from '../auth/user.entity';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  description: string;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.OPEN,
  })
  status: TaskStatus;

  // Many tasks belong to one user. Deleting the user deletes their tasks.
  @ManyToOne(() => User, (user) => user.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // The foreign key as a plain column, so we can filter by it without
  // loading the whole User object.
  @Column()
  userId: number;
}
```

Hai điểm đáng chú ý:
- Khai báo **cả** <mark>user: User</mark> (quan hệ) **và** <mark>userId: number</mark> (cột thường). Cột thường cho phép lọc <mark>WHERE userId = 1</mark> và gán <mark>userId</mark> khi tạo mà không phải load cả object User. Quan hệ dùng khi thật sự cần join.
- <mark>onDelete: 'CASCADE'</mark>: xoá user thì Postgres tự xoá task của họ, thay vì báo lỗi khoá ngoại.

Phía User chỉ cần khai báo chiều ngược lại:
```typescript
// src/auth/user.entity.ts (thêm)
import { OneToMany } from 'typeorm';
import { Task } from '../tasks/task.entity';

  // One user has many tasks. Not loaded unless asked for (no "eager").
  @OneToMany(() => Task, (task) => task.user)
  tasks: Task[];
```
Hai file import lẫn nhau (User cần Task, Task cần User). TypeORM xử lý được nhờ cú pháp hàm <mark>() => Task</mark>: tham chiếu chỉ được tính khi cần, lúc cả hai module đã nạp xong.

#### Bước 2: migration trên bảng đã có dữ liệu
Sinh migration như thường lệ:
```bash
npm run migration:generate -- src/migrations/AddUserToTasks
```
File sinh ra rất gọn: <mark>ALTER TABLE "tasks" ADD "userId" integer NOT NULL</mark> rồi thêm khoá ngoại. Chạy thử:
```bash
npm run migration:run
# query failed: ALTER TABLE "tasks" ADD "userId" integer NOT NULL
# error: column "userId" of relation "tasks" contains null values
```
Bảng <mark>tasks</mark> đã có một dòng từ bài 209. Thêm cột NOT NULL mà không có giá trị mặc định thì dòng cũ lấy gì điền vào? Postgres từ chối, và nó đúng. Trên production, bảng có hàng triệu dòng, tình huống này gặp **mỗi tuần**. Cách xử lý chuẩn gồm ba bước, viết tay vào migration:

```typescript
// src/migrations/1793966794813-AddUserToTasks.ts

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserToTasks1793966794813 implements MigrationInterface {
    name = 'AddUserToTasks1793966794813'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. add the column as NULLABLE first: the table already has rows
        await queryRunner.query(`ALTER TABLE "tasks" ADD "userId" integer`);
        // 2. give the old rows an owner (the first user), drop any that still have none
        await queryRunner.query(`UPDATE "tasks" SET "userId" = (SELECT MIN("id") FROM "users") WHERE "userId" IS NULL`);
        await queryRunner.query(`DELETE FROM "tasks" WHERE "userId" IS NULL`);
        // 3. now every row has a value, so the constraint can be enforced
        await queryRunner.query(`ALTER TABLE "tasks" ALTER COLUMN "userId" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_166bd96559cb38595d392f75a35" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_166bd96559cb38595d392f75a35"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "userId"`);
    }

}
```

Ở đây dữ liệu cũ được gán cho user đầu tiên; trong dự án thật bạn chọn quy tắc phù hợp (gán cho tài khoản hệ thống, hoặc xoá dữ liệu rác). Quan trọng là **quyết định có chủ ý**, không để tool quyết định hộ.
```bash
npm run migration:run
# query: ALTER TABLE "tasks" ADD "userId" integer
# query: UPDATE "tasks" SET "userId" = (SELECT MIN("id") FROM "users") WHERE "userId" IS NULL
# query: DELETE FROM "tasks" WHERE "userId" IS NULL
# query: ALTER TABLE "tasks" ALTER COLUMN "userId" SET NOT NULL
# query: ALTER TABLE "tasks" ADD CONSTRAINT "FK_166bd96559cb38595d392f75a35" FOREIGN KEY ("userId") ...
# Migration AddUserToTasks1793966794813 has been executed successfully.

npm run migration:generate -- src/migrations/Check
# No changes in database schema were found - cannot generate a migration.
```
Dòng cuối xác nhận database và entity đã khớp nhau sau khi sửa tay.

#### Bước 3: decorator @GetUser
Bài 210 nói Nest gắn user vào <mark>request.user</mark>. Lấy ra bằng <mark>@Req() req</mark> rồi <mark>req.user</mark> được, nhưng lặp lại ở mọi handler và lộ cả object request của Express. NestJS cho phép viết **param decorator** riêng:

```typescript
// src/auth/get-user.decorator.ts

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from './user.entity';

// JwtStrategy.validate() put the User on request.user.
// @GetUser() hands it to a handler parameter, like @Body() or @Param() do.
export const GetUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    return request.user;
  },
);
```

<mark>createParamDecorator</mark> nhận một hàm: hàm đó được gọi khi handler chạy, với <mark>ExecutionContext</mark> (cái hộp chứa request/response). Từ đây <mark>@GetUser() user: User</mark> dùng y như <mark>@Body()</mark> hay <mark>@Param()</mark>.

#### Bước 4: service luôn lọc theo user
```typescript
// src/tasks/tasks.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './task.entity';
import { TaskStatus } from './task.model';
import { User } from '../auth/user.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { FilterTaskDto } from './dto/filter-task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>,
  ) {}

  // Every method receives the current user and only ever touches that user's rows.
  async getTasks(filterTaskDto: FilterTaskDto, user: User): Promise<Task[]> {
    const { status, search } = filterTaskDto;
    const query = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.userId = :userId', { userId: user.id });

    if (status) {
      query.andWhere('task.status = :status', { status });
    }
    if (search) {
      query.andWhere('task.title ILIKE :search', { search: `%${search}%` });
    }

    return query.orderBy('task.id', 'DESC').getMany();
  }

  async getTaskById(id: number, user: User): Promise<Task> {
    const task = await this.tasksRepository.findOne({
      where: { id, userId: user.id },
    });
    if (!task) {
      // 404, not 403: don't reveal that someone else's task exists.
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
    return task;
  }

  async createTask(createTaskDto: CreateTaskDto, user: User): Promise<Task> {
    const task = this.tasksRepository.create({
      ...createTaskDto,
      status: TaskStatus.OPEN,
      userId: user.id, // the id only, so the response does not carry the user object
    });
    return this.tasksRepository.save(task);
  }

  async deleteTaskById(id: number, user: User): Promise<void> {
    const result = await this.tasksRepository.delete({ id, userId: user.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
  }

  async updateTaskStatus(
    id: number,
    updateTaskDto: UpdateTaskDto,
    user: User,
  ): Promise<Task> {
    const task = await this.getTaskById(id, user); // 404 if not ours
    task.status = updateTaskDto.status;
    return this.tasksRepository.save(task);
  }
}
```

Nguyên tắc của cả file: **mọi method nhận <mark>user</mark> và mọi câu query đều có <mark>userId</mark>**. Không có đường nào tới một task mà không đi qua điều kiện đó.

- <mark>getTaskById</mark> trả **404** chứ không phải 403 khi task thuộc người khác. 403 nghĩa là "có tồn tại nhưng bạn không được xem", vô tình tiết lộ id nào có thật. Với người ngoài, task không phải của họ nên "không tồn tại".
- <mark>ILIKE</mark> thay cho <mark>LIKE</mark>: Postgres so sánh không phân biệt hoa thường.
- <mark>createTask</mark> gán <mark>userId: user.id</mark> thay vì <mark>user: user</mark>. Nếu gán object, <mark>save()</mark> trả về task **kèm cả object user, có <mark>passwordHash</mark>**, và nó đi thẳng ra JSON. Bài 212 có lưới an toàn cho chuyện này, nhưng không gán ngay từ đầu vẫn tốt hơn.
- <mark>delete({ id, userId })</mark>: xoá với điều kiện, rồi nhìn <mark>affected</mark>. Một câu SQL thay vì hai (tìm rồi xoá).

#### Bước 5: controller truyền user xuống
```typescript
// src/tasks/tasks.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TasksService } from './tasks.service';
import { Task } from './task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { FilterTaskDto } from './dto/filter-task.dto';
import { GetUser } from '../auth/get-user.decorator';
import { User } from '../auth/user.entity';

@Controller('tasks')
@UseGuards(AuthGuard()) // every route below needs a valid Bearer token
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  getTasks(
    @Query() filterTaskDto: FilterTaskDto,
    @GetUser() user: User,
  ): Promise<Task[]> {
    return this.tasksService.getTasks(filterTaskDto, user);
  }

  @Get(':id')
  getTaskById(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: User,
  ): Promise<Task> {
    return this.tasksService.getTaskById(id, user);
  }

  @Post()
  createTask(
    @Body() createTaskDto: CreateTaskDto,
    @GetUser() user: User,
  ): Promise<Task> {
    return this.tasksService.createTask(createTaskDto, user);
  }

  @Delete(':id')
  deleteTaskById(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: User,
  ): Promise<void> {
    return this.tasksService.deleteTaskById(id, user);
  }

  @Put(':id')
  updateTaskStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTaskDto: UpdateTaskDto,
    @GetUser() user: User,
  ): Promise<Task> {
    return this.tasksService.updateTaskStatus(id, updateTaskDto, user);
  }
}
```

Controller mỏng: nhận tham số, đưa cho service. Không có logic "của ai" ở đây; logic đó nằm trong service để chỗ nào gọi service (sau này: gateway, cron job) cũng được bảo vệ.

#### Chạy thật với hai người dùng
```bash
# nolan (id 1) đã có; tạo linh (id 3; id 2 là một lần đăng ký lỗi vì tên "lan" ngắn hơn 4 ký tự)
curl -X POST localhost:3100/auth/signup -H 'content-type: application/json' \
  -d '{"username":"linh","password":"Secret123"}'
# {"id":3,"username":"linh"}

# mỗi người đăng nhập lấy token: T1 của nolan, T2 của linh

# linh tạo task
curl -X POST localhost:3100/tasks -H 'content-type: application/json' -H "Authorization: Bearer $T2" \
  -d '{"title":"Đi chợ","description":"mua rau"}'
# {"id":3,"title":"Đi chợ","description":"mua rau","status":"OPEN","userId":3}   [201]

# nolan chỉ thấy task của nolan
curl localhost:3100/tasks -H "Authorization: Bearer $T1"
# [{"id":2,"title":"Viết bài 211",...,"userId":1},{"id":1,"title":"Học NestJS",...,"userId":1}]

# linh chỉ thấy task của linh
curl localhost:3100/tasks -H "Authorization: Bearer $T2"
# [{"id":3,"title":"Đi chợ","description":"mua rau","status":"OPEN","userId":3}]

# linh đọc task 1 của nolan
curl localhost:3100/tasks/1 -H "Authorization: Bearer $T2"
# {"message":"Task with ID \"1\" not found","error":"Not Found","statusCode":404}

# linh xoá task 1 của nolan
curl -X DELETE localhost:3100/tasks/1 -H "Authorization: Bearer $T2"
# {"message":"Task with ID \"1\" not found","error":"Not Found","statusCode":404}

# nolan xoá task 1 của mình
curl -X DELETE localhost:3100/tasks/1 -H "Authorization: Bearer $T1"
#   [200]
```
Bảng sau cùng:
```
 id |    title     | status | userId
----+--------------+--------+--------
  2 | Viết bài 211 | DONE   |      1
  3 | Đi chợ       | OPEN   |      3
```

#### Mẹo và lỗi hay gặp
- **Quên lọc ở một method**: ví dụ thêm <mark>GET /tasks/stats</mark> mà viết <mark>this.tasksRepository.count()</mark> là đếm của cả hệ thống. Thói quen: mọi method của service nhận <mark>user</mark> là tham số **bắt buộc**, TypeScript sẽ nhắc nếu quên truyền.
- **Migration sinh tự động với cột NOT NULL**: luôn đọc lại. Ba bước "thêm nullable, điền dữ liệu, set NOT NULL" là mẫu bạn sẽ dùng rất nhiều.
- **Lỗi "Cannot access 'User' before initialization"** hay import vòng: dùng <mark>() => User</mark> trong decorator quan hệ, không dùng <mark>User</mark> trực tiếp.
- **<mark>eager: true</mark> trên quan hệ**: tiện (tự load user mỗi khi lấy task) nhưng tốn query và dễ lộ dữ liệu. Mặc định không eager, join khi cần bằng <mark>relations: ['user']</mark> hoặc query builder.
- **<mark>userId</mark> xuất hiện trong JSON trả về**: với app này chấp nhận được; nếu không muốn, bài 212 có <mark>@Exclude()</mark>.

#### Checklist
- Migration chạy được trên bảng có dòng cũ; <mark>migration:generate</mark> sau đó báo không có thay đổi.
- Hai user, mỗi người <mark>GET /tasks</mark> chỉ thấy của mình.
- Đọc, xoá, cập nhật task của người khác: 404.
- Response của <mark>POST /tasks</mark> không chứa object user.

Mã nguồn cuối bài: [post_211.zip](/assets/code/post_211.zip).

#### Bài tập thêm
- Thêm <mark>GET /tasks/stats</mark> trả về <mark>{ open, inProgress, done }</mark> của riêng user hiện tại (gợi ý: query builder với <mark>select('task.status').addSelect('COUNT(*)').groupBy</mark>).
- Cho phép <mark>PATCH /tasks/:id</mark> sửa <mark>title</mark> và <mark>description</mark> (DTO với <mark>@IsOptional()</mark>), vẫn chỉ của mình.
- Thử viết migration thêm cột <mark>dueDate</mark> nullable rồi một migration khác đặt mặc định; so sánh với cột NOT NULL ở bài này.
