import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { AuthService } from './auth.service';
import { FindIdSendDto } from './dto/find-id-send.dto';
import { FindIdVerifyDto } from './dto/find-id-verify.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateMeEmailSendDto } from './dto/update-me-email-send.dto';
import { UpdateMeEmailVerifyDto } from './dto/update-me-email-verify.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthedRequest } from './types/authed-request.type';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly token: TokenService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshSessionDto) {
    return this.token.refreshSession(dto.refreshToken);
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
