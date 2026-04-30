import "reflect-metadata";

import multipart from "@fastify/multipart";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import { createCorsOptions } from "./cors";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const port = Number(process.env.PORT ?? 4000);

  app.enableCors(createCorsOptions());
  await app.register(multipart, {
    limits: {
      fileSize: Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024)
    }
  });

  await app.listen(port, "0.0.0.0");
}

void bootstrap();
