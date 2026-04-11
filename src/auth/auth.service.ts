import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { DriveService } from '../drive/drive.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  FIND_ID_CODE_TTL_MS,
  PURPOSE_FIND_LOGIN_ID,
  PURPOSE_REGISTER_CODE,
  PURPOSE_REGISTER_TOKEN,
  purposeUpdateEmailCode,
  purposeUpdateEmailToken,
  REGISTER_CODE_TTL_MS,
  REGISTER_TOKEN_TTL_MS,
  REFRESH_TOKEN_RANDOM_BYTES,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants';
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
import {
  isPasswordPolicyCompliant,
  PASSWORD_POLICY_MESSAGE,
} from './password-policy';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private formatCodeValidityForMail(ms: number): string {
    const sec = Math.ceil(ms / 1000);
    if (ms < 60_000) {
      return `${sec}초`;
    }
    return `${Math.floor(ms / 60_000)}분`;
  }

  private codeExpiryResponseFields(ms: number): {
    expiresInSeconds: number;
    expiresInMinutes: number;
  } {
    return {
      expiresInSeconds: Math.ceil(ms / 1000),
      expiresInMinutes: Math.floor(ms / 60_000),
    };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly drive: DriveService,
  ) {}

  /** 회원가입 전 아이디 사용 가능 여부 (공개) */
  async checkRegisterLoginIdAvailability(raw: string): Promise<{ available: boolean }> {
    const loginId = raw.trim().toLowerCase();
    if (!loginId) {
      throw new BadRequestException('아이디를 입력해 주세요.');
    }
    if (loginId.length < 4 || loginId.length > 20) {
      throw new BadRequestException('아이디는 4~20자여야 합니다.');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(loginId)) {
      throw new BadRequestException('아이디 형식이 올바르지 않습니다.');
    }
    const existing = await this.prisma.user.findUnique({
      where: { loginId },
      select: { id: true },
    });
    return { available: existing === null };
  }

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('비밀번호가 일치하지 않습니다.');
    }
    if (!isPasswordPolicyCompliant(dto.password)) {
      throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
    }
    const email = dto.email.trim().toLowerCase();
    const loginId = dto.loginId.trim().toLowerCase();
    const token = dto.emailVerifyToken.trim().toLowerCase();
    const emailSession = await this.prisma.emailVerification.findFirst({
      where: {
        email,
        purpose: PURPOSE_REGISTER_TOKEN,
        code: token,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!emailSession) {
      throw new BadRequestException('이메일 인증을 완료해 주세요.');
    }
    const existingEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingEmail) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }
    const existingId = await this.prisma.user.findUnique({
      where: { loginId },
    });
    if (existingId) {
      throw new ConflictException('이미 사용 중인 아이디입니다.');
    }
    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        loginId,
        email,
        password: hash,
        name: dto.name.trim(),
      },
      select: {
        id: true,
        loginId: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });
    await this.prisma.emailVerification.deleteMany({
      where: {
        email,
        purpose: { in: [PURPOSE_REGISTER_CODE, PURPOSE_REGISTER_TOKEN] },
      },
    });
    const accessToken = this.signToken(user.id, user.email);
    const refreshToken = await this.grantRefreshToken(user.id, true);
    return { user, accessToken, refreshToken };
  }

  async registerSendCode(dto: RegisterSendCodeDto) {
    const email = dto.email.trim().toLowerCase();
    const taken = await this.prisma.user.findUnique({ where: { email } });
    if (taken) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }
    const code = this.random6DigitCode();
    const expiresAt = new Date(Date.now() + REGISTER_CODE_TTL_MS);
    await this.prisma.emailVerification.deleteMany({
      where: {
        email,
        purpose: { in: [PURPOSE_REGISTER_CODE, PURPOSE_REGISTER_TOKEN] },
      },
    });
    await this.prisma.emailVerification.create({
      data: { email, code, purpose: PURPOSE_REGISTER_CODE, expiresAt },
    });
    const ttlLabel = this.formatCodeValidityForMail(REGISTER_CODE_TTL_MS);
    const expiry = this.codeExpiryResponseFields(REGISTER_CODE_TTL_MS);
    if (this.mail.isSmtpConfigured()) {
      try {
        await this.mail.sendVerificationCode(email, code, 'register', ttlLabel);
      } catch (err) {
        this.logger.error(err);
        await this.prisma.emailVerification.deleteMany({
          where: { email, purpose: PURPOSE_REGISTER_CODE },
        });
        throw new InternalServerErrorException(
          '이메일 발송에 실패했습니다. SMTP 설정을 확인하거나 잠시 후 다시 시도해 주세요.',
        );
      }
      return {
        sent: true,
        ...expiry,
        message: '인증번호가 발송되었습니다. 이메일을 확인해 주세요.',
      };
    }
    this.logger.warn(
      `[회원가입 이메일] SMTP 미설정 — ${email} 인증번호: ${code} (유효 ${ttlLabel}, 터미널 확인)`,
    );
    return {
      sent: true,
      ...expiry,
      message:
        '인증번호가 발송되었습니다. 이메일을 확인해 주세요. (SMTP 미설정: 서버 터미널에 인증번호가 출력됩니다.)',
    };
  }

  async registerVerifyCode(dto: RegisterVerifyCodeDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    const rec = await this.prisma.emailVerification.findFirst({
      where: {
        email,
        purpose: PURPOSE_REGISTER_CODE,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!rec) {
      throw new BadRequestException(
        '인증번호가 올바르지 않거나 만료되었습니다.',
      );
    }
    const taken = await this.prisma.user.findUnique({ where: { email } });
    if (taken) {
      throw new ConflictException('이미 사용 중인 이메일입니다.');
    }
    await this.prisma.emailVerification.delete({ where: { id: rec.id } });
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REGISTER_TOKEN_TTL_MS);
    await this.prisma.emailVerification.deleteMany({
      where: { email, purpose: PURPOSE_REGISTER_TOKEN },
    });
    await this.prisma.emailVerification.create({
      data: {
        email,
        code: sessionToken,
        purpose: PURPOSE_REGISTER_TOKEN,
        expiresAt,
      },
    });
    return { emailVerifyToken: sessionToken };
  }

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
    const code = this.random6DigitCode();
    const expiresAt = new Date(Date.now() + REGISTER_CODE_TTL_MS);
    await this.prisma.emailVerification.deleteMany({
      where: {
        OR: [{ purpose: codePurp }, { purpose: tokPurp }],
      },
    });
    await this.prisma.emailVerification.create({
      data: { email, code, purpose: codePurp, expiresAt },
    });
    const ttlLabel = this.formatCodeValidityForMail(REGISTER_CODE_TTL_MS);
    const expiry = this.codeExpiryResponseFields(REGISTER_CODE_TTL_MS);
    if (this.mail.isSmtpConfigured()) {
      try {
        await this.mail.sendVerificationCode(
          email,
          code,
          'update-email',
          ttlLabel,
        );
      } catch (err) {
        this.logger.error(err);
        await this.prisma.emailVerification.deleteMany({
          where: { email, purpose: codePurp },
        });
        throw new InternalServerErrorException(
          '이메일 발송에 실패했습니다. SMTP 설정을 확인하거나 잠시 후 다시 시도해 주세요.',
        );
      }
      return {
        sent: true,
        ...expiry,
        message: '인증번호가 발송되었습니다. 이메일을 확인해 주세요.',
      };
    }
    this.logger.warn(
      `[이메일 변경] SMTP 미설정 — ${email} 인증번호: ${code} (유효 ${ttlLabel}, 터미널 확인)`,
    );
    return {
      sent: true,
      ...expiry,
      message:
        '인증번호가 발송되었습니다. 이메일을 확인해 주세요. (SMTP 미설정: 서버 터미널에 인증번호가 출력됩니다.)',
    };
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
    const codePurp = purposeUpdateEmailCode(userId);
    const rec = await this.prisma.emailVerification.findFirst({
      where: {
        email,
        purpose: codePurp,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!rec) {
      throw new BadRequestException(
        '인증번호가 올바르지 않거나 만료되었습니다.',
      );
    }
    await this.prisma.emailVerification.delete({ where: { id: rec.id } });
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

  private random6DigitCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
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

    const code = this.random6DigitCode();
    const expiresAt = new Date(Date.now() + FIND_ID_CODE_TTL_MS);
    await this.prisma.emailVerification.deleteMany({
      where: { email, purpose: PURPOSE_FIND_LOGIN_ID },
    });
    await this.prisma.emailVerification.create({
      data: { email, code, purpose: PURPOSE_FIND_LOGIN_ID, expiresAt },
    });
    const ttlLabel = this.formatCodeValidityForMail(FIND_ID_CODE_TTL_MS);
    const expiry = this.codeExpiryResponseFields(FIND_ID_CODE_TTL_MS);
    if (this.mail.isSmtpConfigured()) {
      try {
        await this.mail.sendVerificationCode(email, code, 'find-id', ttlLabel);
      } catch (err) {
        this.logger.error(err);
        await this.prisma.emailVerification.deleteMany({
          where: { email, purpose: PURPOSE_FIND_LOGIN_ID },
        });
        return {
          sent: false,
          message:
            '이메일 발송에 실패했습니다. SMTP 설정을 확인하거나 잠시 후 다시 시도해 주세요.',
        };
      }
      return {
        sent: true,
        ...expiry,
        message: '인증번호가 발송되었습니다. 이메일을 확인해 주세요.',
      };
    }
    this.logger.warn(
      `[아이디 찾기] SMTP 미설정 — ${email} 인증번호: ${code} (유효 ${ttlLabel}, 터미널 확인)`,
    );
    return {
      sent: true,
      ...expiry,
      message:
        '인증번호가 발송되었습니다. 이메일을 확인해 주세요. (SMTP 미설정: 서버 터미널에 인증번호가 출력됩니다.)',
    };
  }

  async findIdVerify(dto: FindIdVerifyDto) {
    const email = dto.email.trim().toLowerCase();
    const code = dto.code.trim();
    const rec = await this.prisma.emailVerification.findFirst({
      where: {
        email,
        purpose: PURPOSE_FIND_LOGIN_ID,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!rec) {
      throw new BadRequestException(
        '인증번호가 올바르지 않거나 만료되었습니다.',
      );
    }
    await this.prisma.emailVerification.delete({ where: { id: rec.id } });
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
    const loginId = dto.loginId.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { loginId },
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
    const hash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hash },
    });
    return { ok: true, message: '비밀번호가 변경되었습니다. 로그인해 주세요.' };
  }

  async login(dto: LoginDto) {
    const loginId = dto.loginId.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { loginId },
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
    const token = this.signToken(user.id, user.email);
    const refreshToken = await this.grantRefreshToken(user.id, true);
    return {
      user: {
        id: user.id,
        loginId: user.loginId,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      accessToken: token,
      refreshToken,
    };
  }

  async refreshSession(refreshTokenPlain: string) {
    const trimmed = refreshTokenPlain.trim();
    if (!trimmed) {
      throw new BadRequestException('리프레시 토큰이 필요합니다.');
    }
    const tokenHash = this.hashRefreshToken(trimmed);
    const row = await this.prisma.userRefreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            loginId: true,
            email: true,
            name: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row || row.expiresAt <= new Date()) {
      if (row) {
        await this.prisma.userRefreshToken
          .delete({ where: { id: row.id } })
          .catch(() => undefined);
      }
      throw new UnauthorizedException(
        '세션이 만료되었습니다. 다시 로그인해 주세요.',
      );
    }
    await this.prisma.userRefreshToken.delete({ where: { id: row.id } });
    const refreshToken = await this.grantRefreshToken(row.userId, false);
    const accessToken = this.signToken(row.user.id, row.user.email);
    return {
      accessToken,
      refreshToken,
      user: row.user,
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

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!me) {
        throw new BadRequestException('사용자를 찾을 수 없습니다.');
      }
      if (email !== me.email) {
        const token = dto.emailVerifyToken?.trim().toLowerCase();
        if (
          !token ||
          !/^[a-f0-9]{64}$/u.test(token)
        ) {
          throw new BadRequestException('이메일 변경은 인증을 완료해 주세요.');
        }
        const tokPurp = purposeUpdateEmailToken(userId);
        const emailSession = await this.prisma.emailVerification.findFirst({
          where: {
            email,
            purpose: tokPurp,
            code: token,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!emailSession) {
          throw new BadRequestException('이메일 인증을 완료해 주세요.');
        }
        const taken = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (taken) {
          throw new ConflictException('이미 사용 중인 이메일입니다.');
        }
        patch.email = email;
        await this.prisma.emailVerification.deleteMany({
          where: {
            OR: [
              { purpose: purposeUpdateEmailCode(userId) },
              { purpose: tokPurp },
            ],
          },
        });
      }
    }

    if (dto.newPassword !== undefined || dto.confirmNewPassword !== undefined) {
      if (!dto.newPassword || !dto.confirmNewPassword) {
        throw new BadRequestException(
          '새 비밀번호와 새 비밀번호 확인을 모두 입력해 주세요.',
        );
      }
      if (dto.newPassword !== dto.confirmNewPassword) {
        throw new BadRequestException('새 비밀번호가 일치하지 않습니다.');
      }
      if (!isPasswordPolicyCompliant(dto.newPassword)) {
        throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
      }
      patch.password = await bcrypt.hash(dto.newPassword, 10);
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('변경할 내용을 입력해 주세요.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: { id: true, loginId: true, email: true, name: true, createdAt: true },
    });
    const accessToken = this.signToken(updated.id, updated.email);
    const refreshToken = await this.grantRefreshToken(updated.id, true);
    return {
      user: updated,
      accessToken,
      refreshToken,
      message: '마이페이지 정보가 수정되었습니다.',
    };
  }

  private hashRefreshToken(plain: string): string {
    return createHash('sha256').update(plain, 'utf8').digest('hex');
  }

  /** @param revokeExisting true면 동일 사용자의 기존 리프레시 토큰을 모두 폐기(로그인·회원가입·비번 변경 등) */
  private async grantRefreshToken(
    userId: string,
    revokeExisting: boolean,
  ): Promise<string> {
    if (revokeExisting) {
      await this.prisma.userRefreshToken.deleteMany({ where: { userId } });
    }
    const plain = randomBytes(REFRESH_TOKEN_RANDOM_BYTES).toString('hex');
    const tokenHash = this.hashRefreshToken(plain);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.prisma.userRefreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });
    return plain;
  }

  private signToken(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwt.sign(payload);
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
