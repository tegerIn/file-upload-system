import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { FindIdSendDto } from './dto/find-id-send.dto';
import { FindIdVerifyDto } from './dto/find-id-verify.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterSendCodeDto } from './dto/register-send-code.dto';
import { RegisterVerifyCodeDto } from './dto/register-verify-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateMeEmailSendDto } from './dto/update-me-email-send.dto';
import { UpdateMeEmailVerifyDto } from './dto/update-me-email-verify.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthedRequest = {
  user: { id: string; loginId: string; email: string; name: string | null };
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 슬래시 없는 경로: Express 5 + 정적 호스팅 환경에서 `/register/...` 미매칭 이슈 회피 */
  @Post(['register-send-code', 'register/send-code'])
  registerSendCode(@Body() dto: RegisterSendCodeDto) {
    return this.auth.registerSendCode(dto);
  }

  @Post(['register-verify-code', 'register/verify-code'])
  registerVerifyCode(@Body() dto: RegisterVerifyCodeDto) {
    return this.auth.registerVerifyCode(dto);
  }

  @Get('register/check-login-id')
  checkRegisterLoginId(@Query('loginId') loginId: string) {
    return this.auth.checkRegisterLoginIdAvailability(loginId ?? '');
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshSessionDto) {
    return this.auth.refreshSession(dto.refreshToken);
  }

  @Post('find-id/send-code')
  findIdSendCode(@Body() dto: FindIdSendDto) {
    return this.auth.findIdSendCode(dto);
  }

  @Post('find-id/verify')
  findIdVerify(@Body() dto: FindIdVerifyDto) {
    return this.auth.findIdVerify(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthedRequest) {
    return req.user;
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@Req() req: AuthedRequest, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(req.user.id, dto);
  }

  @Post(['me-email-send-code', 'me/email/send-code'])
  @UseGuards(JwtAuthGuard)
  updateMeEmailSendCode(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateMeEmailSendDto,
  ) {
    return this.auth.updateMeEmailSendCode(req.user.id, dto);
  }

  @Post(['me-email-verify-code', 'me/email/verify-code'])
  @UseGuards(JwtAuthGuard)
  updateMeEmailVerifyCode(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateMeEmailVerifyDto,
  ) {
    return this.auth.updateMeEmailVerifyCode(req.user.id, dto);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  deleteMe(@Req() req: AuthedRequest) {
    return this.auth.deleteMe(req.user.id);
  }
}
