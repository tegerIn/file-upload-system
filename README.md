# file-upload-system

파일 업로드 서비스 (NestJS + Prisma)

## 요구 사항

- Node.js
- PostgreSQL (Prisma 마이그레이션 기준)

## 설정

```bash
cp .env.example .env
# .env 에 DB·메일·JWT 등 값을 채웁니다.
npm install
npx prisma migrate deploy
```

## 실행

```bash
# 개발
npm run start:dev

# 프로덕션 빌드 후 실행
npm run build
npm run start:prod
```

## 테스트

```bash
npm run test
npm run test:e2e
```
