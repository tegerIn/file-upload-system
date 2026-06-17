import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DriveService } from '../drive/drive.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../token/token.service';
import {
  FIND_ID_CODE_TTL_MS,
  PURPOSE_FIND_LOGIN_ID,
  purposeUpdateEmailCode,
  purposeUpdateEmailToken,
  REGISTER_CODE_TTL_MS,
  REGISTER_TOKEN_TTL_MS,
} from './auth.constants';
import {
  consumeVerificationCode,
  emailUpdateValidate,
  issueAndSendVerificationCode,
  PASSWORD_HASH,
  passwordUpdateValidate,
  randomDigitCode,
} from './auth.utils';
import { FindIdSendDto } from './dto/find-id-send.dto';
import { FindIdVerifyDto } from './dto/find-id-verify.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateMeEmailSendDto } from './dto/update-me-email-send.dto';
import { UpdateMeEmailVerifyDto } from './dto/update-me-email-verify.dto';
import {
  isPasswordPolicyCompliant,
  PASSWORD_POLICY_MESSAGE,
} from './password-policy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly drive: DriveService,
    private readonly token: TokenService,
  ) {}

  async updateMeEmailSendCode(userId: string, dto: UpdateMeEmailSendDto) {
    const email = dto.email.trim().toLowerCase();
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!me) {
      throw new BadRequestException('사용자를 찾을 수 없습니다.');
    }
    if (email === me.email) {
      throw new BadRequestException('현재와 동일한 이메일입니다.');
    }
    const taken = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }
    const codePurp = purposeUpdateEmailCode(userId);
    const tokPurp = purposeUpdateEmailToken(userId);
    return issueAndSendVerificationCode(this.prisma, this.mail, this.logger, {
      email,
      code: randomDigitCode(6),
      purpose: codePurp,
      purgePurposes: [codePurp, tokPurp],
      ttlMs: REGISTER_CODE_TTL_MS,
      mailType: 'update-email',
      logPrefix: '이메일 변경',
      throwOnMailError: true,
    });
  }

  async updateMeEmailVerifyCode(userId: string, dto: UpdateMeEmailVerifyDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!me) {
      throw new BadRequestException('사용자를 찾을 수 없습니다.');
    }
    if (email === me.email) {
      throw new BadRequestException('현재와 동일한 이메일입니다.');
    }
    const taken = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }
    await consumeVerificationCode(
      this.prisma,
      email,
      code,
      purposeUpdateEmailCode(userId),
    );
    const sessionToken = randomBytes(32).toString('hex');
    const tokPurp = purposeUpdateEmailToken(userId);
    const expiresAt = new Date(Date.now() + REGISTER_TOKEN_TTL_MS);
    await this.prisma.emailVerification.deleteMany({
      where: { purpose: tokPurp },
    });
    await this.prisma.emailVerification.create({
      data: {
        email,
        code: sessionToken,
        purpose: tokPurp,
        expiresAt,
      },
    });
    return { emailVerifyToken: sessionToken };
  }

  async findIdSendCode(dto: FindIdSendDto) {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok =
      user != null &&
      user.name != null &&
      user.name.trim().toLowerCase() === name.toLowerCase();

    if (!ok) {
      return {
        sent: false,
        message:
          '입력하신 이름·이메일과 일치하는 계정을 찾을 수 없습니다. 정보를 확인해 주세요.',
      };
    }

    return issueAndSendVerificationCode(this.prisma, this.mail, this.logger, {
      email,
      code: randomDigitCode(6),
      purpose: PURPOSE_FIND_LOGIN_ID,
      purgePurposes: [PURPOSE_FIND_LOGIN_ID],
      ttlMs: FIND_ID_CODE_TTL_MS,
      mailType: 'find-id',
      logPrefix: '아이디 찾기',
      throwOnMailError: false,
    });
  }

  async findIdVerify(dto: FindIdVerifyDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    await consumeVerificationCode(
      this.prisma,
      email,
      code,
      PURPOSE_FIND_LOGIN_ID,
    );
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { loginId: true },
    });
    if (!user) {
      throw new BadRequestException('계정을 찾을 수 없습니다.');
    }
    return { loginId: user.loginId };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('비밀번호가 일치하지 않습니다.');
    }
    if (!isPasswordPolicyCompliant(dto.newPassword)) {
      throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
    }
    const user = await this.prisma.user.findUnique({
      where: { loginId: dto.loginId },
    });
    if (!user) {
      throw new BadRequestException('등록되지 않은 아이디입니다.');
    }
    const sameAsCurrent = await bcrypt.compare(dto.newPassword, user.password);
    if (sameAsCurrent) {
      throw new BadRequestException(
        '이전에 사용하던 비밀번호와 동일합니다. 다른 비밀번호를 입력해 주세요.',
      );
    }
    const hash = await bcrypt.hash(dto.newPassword, PASSWORD_HASH);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hash },
    });
    return { ok: true, message: '비밀번호가 변경되었습니다. 로그인해 주세요.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { loginId: dto.loginId },
    });
    if (!user) {
      throw new UnauthorizedException(
        '아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) {
      throw new UnauthorizedException(
        '아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    const tokens = this.token.signToken(user.id, user.email);
    const refreshToken = await this.token.grantRefreshToken(user.id, true);
    return {
      user: {
        id: user.id,
        loginId: user.loginId,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      accessToken: tokens,
      refreshToken,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const patch: {
      name?: string;
      email?: string;
      password?: string;
    } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('이름을 입력해 주세요.');
      }
      patch.name = name;
    }

    await emailUpdateValidate(
      this.prisma,
      userId,
      dto,
      patch as { email?: string },
    );

    await passwordUpdateValidate(
      this.prisma,
      userId,
      dto,
      patch as { password?: string },
    );

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('변경할 내용을 입력해 주세요.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: {
        id: true,
        loginId: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });
    const accessToken = this.token.signToken(updated.id, updated.email);
    const refreshToken = await this.token.grantRefreshToken(updated.id, true);
    return {
      user: updated,
      accessToken,
      refreshToken,
      message: '마이페이지 정보가 수정되었습니다.',
    };
  }

  async deleteMe(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!me) {
      throw new BadRequestException('사용자를 찾을 수 없습니다.');
    }
    await this.drive.hardDeleteAllByUser(userId);
    await this.prisma.emailVerification.deleteMany({
      where: {
        OR: [
          { email: me.email },
          { purpose: purposeUpdateEmailCode(userId) },
          { purpose: purposeUpdateEmailToken(userId) },
        ],
      },
    });
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true, message: '회원 탈퇴가 완료되었습니다.' };
  }
}
