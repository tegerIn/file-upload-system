import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DriveModule } from '../drive/drive.module';
import { MailModule } from '../mail/mail.module';
import { RegisterModule } from '../register/register.module';
import { TokenModule } from '../token/token.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    DriveModule,
    MailModule,
    TokenModule,
    RegisterModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, TokenModule],
})
export class AuthModule {}
