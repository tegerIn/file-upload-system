-- CreateTable
CREATE TABLE "UserRefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UserRefreshToken_tokenHash_key" ON "UserRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserRefreshToken_userId_idx" ON "UserRefreshToken"("userId");
