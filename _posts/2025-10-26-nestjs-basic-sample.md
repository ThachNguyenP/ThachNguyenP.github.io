---
layout: post
title: "045. NestJS (sample CRUD)."
author: thach
categories: [Coding]
tags: [Node]
image: assets/images/post_045/nestjs-crud.png
---

Dạo này có cơ hội làm dựa án NestJs, nên là note lại để về sau đỡ quên.

#### Cài đặt cơ bản

Thử làm một app CRUD với NestJs, bài toán là quản lý các tasks với title, description và status.

```bash
npm i -g @nestjs/cli
nest new tasks-management
npm install
npm run start
```

#### Tạo module Tasks

```bash
nest g module tasks
# CREATE src/tasks/tasks.module.ts (82 bytes)
# UPDATE src/app.module.ts (159 bytes)
nest g controller tasks --no-spec
# CREATE src/tasks/tasks.controller.ts (99 bytes)
# UPDATE src/tasks/tasks.module.ts (170 bytes)
nest g service tasks --no-spec
# CREATE src/tasks/tasks.service.ts (89 bytes)
# UPDATE src/tasks/tasks.module.ts (247 bytes)
yarn add typeorm @nestjs/typeorm pg
yarn add class-validator class-transformer
```

Ở đây sẽ có những thành phần như sau:

- `tasks.module.ts`: module chứa các controller, service, và entity.
- `tasks.controller.ts`: controller chứa các endpoint.
- `tasks.service.ts`: service chứa các logic.
- `task.model.ts`: entity chứa các field.
- `dto`: chứa các dto, dùng để xử lý các params của request.

```typescript
// src/tasks/tasks.module.ts

import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
```

```typescript
// src/tasks/task.model.ts

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
}

export enum TaskStatus {
  OPEN = "OPEN",
  IN_PROGRESS = "IN_PROGRESS",
  DONE = "DONE",
}
```

```typescript
// src/tasks/dto/update-task.dto.ts
import { TaskStatus } from "../task.model";

export class UpdateTaskDto {
  status: TaskStatus;
}
// src/tasks/dto/filter-task.dto.ts
import { TaskStatus } from "../task.model";

export class FilterTaskDto {
  status: TaskStatus;
  search: string;
}

// src/tasks/dto/create-task.dto.ts

export class CreateTaskDto {
  title: string;
  description: string;
}
```

```typescript
// src/tasks/tasks.service.ts

import { Injectable, NotFoundException } from "@nestjs/common";
import { Task } from "./task.model";
import { v4 as uuid } from "uuid";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TaskStatus } from "./task.model";
import { FilterTaskDto } from "./dto/filter-task.dto";

@Injectable()
export class TasksService {
  private tasks: Task[] = [];

  getAllTasks(): Task[] {
    return this.tasks;
  }

  getTasksWithFilter(filterTaskDto: FilterTaskDto): Task[] {
    let tasks = this.getAllTasks();

    if (filterTaskDto.status) {
      tasks = tasks.filter((task) => task.status === filterTaskDto.status);
    }

    if (filterTaskDto.search) {
      tasks = tasks.filter((task) => task.title.includes(filterTaskDto.search));
    }

    return tasks;
  }

  getTaskById(id: string): Task | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  createTask(createTaskDto: CreateTaskDto): Task {
    const newTask = { ...createTaskDto, id: uuid(), status: TaskStatus.OPEN };
    this.tasks.push(newTask);
    return newTask;
  }

  deleteTaskById(id: string): void {
    this.tasks = this.tasks.filter((task) => task.id !== id);
  }

  updateTaskStatus(id: string, updateTaskDto: UpdateTaskDto): Task {
    const task = this.getTaskById(id);
    if (!task) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
    task.status = updateTaskDto.status;
    return task;
  }
}
```

```typescript
// src/tasks/tasks.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  NotFoundException,
  Delete,
  Put,
  Query,
} from "@nestjs/common";
import { TasksService } from "./tasks.service";
import type { Task } from "./task.model";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { FilterTaskDto } from "./dto/filter-task.dto";

@Controller("tasks")
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  getAllTasks(@Query() filterTaskDto: FilterTaskDto): Task[] {
    return this.tasksService.getTasksWithFilter(filterTaskDto);
  }

  @Get(":id")
  getTaskById(@Param("id") id: string): Task {
    const task = this.tasksService.getTaskById(id);
    if (!task) {
      throw new NotFoundException(`Task with ID "${id}" not found`);
    }
    return task;
  }

  @Post()
  createTask(@Body() createTaskDto: CreateTaskDto): Task {
    return this.tasksService.createTask(createTaskDto);
  }

  @Delete(":id")
  deleteTaskById(@Param("id") id: string): void {
    this.tasksService.deleteTaskById(id);
  }

  @Put(":id")
  updateTaskStatus(
    @Param("id") id: string,
    @Body() updateTaskDto: UpdateTaskDto
  ): Task {
    return this.tasksService.updateTaskStatus(id, updateTaskDto);
  }
}
```
