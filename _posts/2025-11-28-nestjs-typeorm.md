---
layout: post
title: "047. NestJS (Typeorm)."
author: thach
categories: [Coding, Node]
image: assets/images/post_047/nestjs-typeorm.png
---

Dạo này có cơ hội làm dựa án NestJs, nên là note lại để về sau đỡ quên.

#### Cài đặt cơ bản

Khởi tạo project từ cli.

#### Setup typeorm

```json
// package.json
"typeorm": "typeorm-ts-node-commonjs",
"migration:generate": "npm run typeorm -- migration:generate -d src/data-source.ts",
"migration:run": "npm run typeorm -- migration:run -d src/data-source.ts",
"migration:revert": "npm run typeorm -- migration:revert -d src/data-source.ts"
```

NestJs và Typeorm cần tới 2 cái config database na ná nhau để chạy.

```typescript
// src/config/typeorm.config.ts

import { TypeOrmModuleOptions } from "@nestjs/typeorm";

export const typeOrmConfig: TypeOrmModuleOptions = {
  type: "postgres" as const,
  host: "localhost",
  port: 5432,
  username: "postgres",
  password: "postgres",
  database: "task-management",
  autoLoadEntities: true,
  synchronize: false, // Disabled for migrations
};
```

```typescript
// src/data-source.ts
import { DataSource } from "typeorm";
import { Task } from "./tasks/task.entity";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: "localhost",
  port: 5432,
  username: "postgres",
  password: "postgres",
  database: "task-management",
  entities: [Task],
  migrations: ["src/migrations/**/*.ts"],
  synchronize: false,
});
```

#### Migrations

Điểm ảo diệu của Typeorm là nó có thể tự động tạo ra các file migration khi có sự khác biệt giữa schema của database và các entity trong code.

À mà entity là gì? Là mấy cái file đại diện cho các bảng trong database mà chúng ta chuẩn bị tạo ra đây.

```typescript
// src/tasks/task.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { TaskStatus } from "../tasks/task.model";

@Entity("tasks")
export class Task {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  description: string;

  @Column({
    type: "enum",
    enum: TaskStatus,
    default: TaskStatus.OPEN,
  })
  status: TaskStatus;
}
```

Giờ thì hãy generate migration từ cái file vừa tạo, tiện thể đẩy

```bash
yarn migration:generate src/migrations/Initial
# Migration /Users/nolan/work/practice/nestjs-task-management/src/migrations/1764580894395-Initial.ts has been generated successfully.
yarn migration:run
# query: SELECT version()
# query: SELECT * FROM current_schema()
# query: SELECT * FROM "information_schema"."tables" WHERE "table_schema" = 'public' AND "table_name" = 'migrations' ...
```

Vậy còn trường hợp chúng ta muốn tạo ra file migration không cần dựa vào entity được không? Lúc này ta có thể tạo ra file migration thủ công, ta sử dụng `migrate:create`

```bash
yarn migrate:create src/migrations/InitialDatabase
```

#### Dùng Typeorm để query database

Dùng reporsitory ở service

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Task } from "./task.entity"; //remove task model, use entity instead
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TaskStatus } from "./task.model";
import { FilterTaskDto } from "./dto/filter-task.dto";

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private tasksRepository: Repository<Task>
  ) {}

  async getAllTasks(): Promise<Task[]> {
    return this.tasksRepository.find();
  }

  async getTasksWithFilter(filterTaskDto: FilterTaskDto): Promise<Task[]> {
    const { status, search } = filterTaskDto;
    const query = this.tasksRepository.createQueryBuilder("task");

    if (status) {
      query.andWhere("task.status = :status", { status });
    }

    if (search) {
      query.andWhere("task.title LIKE :search", { search: `%${search}%` });
    }

    return query.getMany();
  }

  async getTaskById(id: number): Promise<Task> {
    const task = await this.tasksRepository.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
    return task;
  }

  async createTask(createTaskDto: CreateTaskDto): Promise<Task> {
    const task = this.tasksRepository.create({
      ...createTaskDto,
      status: TaskStatus.OPEN,
    });
    await this.tasksRepository.save(task);
    return task;
  }

  async deleteTaskById(id: number): Promise<void> {
    const result = await this.tasksRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
  }

  async updateTaskStatus(
    id: number,
    updateTaskDto: UpdateTaskDto
  ): Promise<Task> {
    const task = await this.getTaskById(id);
    task.status = updateTaskDto.status;
    await this.tasksRepository.save(task);
    return task;
  }
}
```
