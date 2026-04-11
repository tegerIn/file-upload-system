-- CreateIndex
CREATE UNIQUE INDEX "User_email_loginId_key" ON "User"("email", "loginId");
