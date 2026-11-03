---
layout: post
title: "046. NestJS (Validation)."
author: thach
categories: [Coding, Node]
image: assets/images/post_046/nestjs-validation.png
---

Tiếp theo phần 1, trong bài này sẽ tìm hiểu về Validation và Pipe.

#### Install class-validator và class-transformer

```bash
yarn add class-validator class-transformer
```

#### Import class-validator và class-transformer

```typescript
// src/tasks/dto/create-task.dto.ts

import { IsNotEmpty } from "class-validator";

export class CreateTaskDto {
  @IsNotEmpty()
  title: string;

  @IsNotEmpty()
  description: string;
}
```

Bật ValidationPipe ở main.ts

```typescript
// src/main.ts

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

```typescript
// src/tasks/tasks.service.ts

// ...
getTaskById(id: string): Task | undefined {
  let found = this.tasks.find(task => task.id === id);
  if (!found) {
    throw new NotFoundException(`Task ID "${id}" not found`);
  }
  return found;
}

```
