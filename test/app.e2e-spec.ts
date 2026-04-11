import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('My Drive (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('GET / serves SPA shell', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/)
      .expect((res) => {
        expect(res.text).toContain('My Drive');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
