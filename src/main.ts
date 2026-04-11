import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = Number(process.env.PORT) || 3000;
  try {
    await app.listen(port);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'EADDRINUSE') {
      // 자주 있는 실패: 옛 node 프로세스가 3000을 잡고 있어 새 Nest는 뜨지 못함 → 브라우저는 옛 서버로 POST → Cannot POST
      console.error(
        `\n[My Drive] 포트 ${port} 사용 중입니다. 새 서버가 시작되지 않았을 수 있습니다.\n` +
          `  (이 경우 브라우저 요청은 "예전에 떠 있던" 다른 Node 프로세스로 갑니다 → API 404)\n` +
          `  조치: 점유 프로세스를 종료한 뒤 다시 npm run start:dev\n` +
          `    macOS/Linux: lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
          `               kill -9 <PID>\n`,
      );
    }
    throw err;
  }
  console.log(`My Drive: http://localhost:${port}`);
}
bootstrap();
