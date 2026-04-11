import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SMTP_PRESETS } from './smtp-presets';

export type MailVerificationKind = 'register' | 'find-id' | 'update-email';

function resolveMailFrom(raw: string | undefined, smtpUser: string): string {
  if (!raw) return smtpUser;
  const v = raw.trim();
  if (v.includes('@') && !v.includes('<')) return v;
  if (v.includes('<') && v.includes('>')) return v;
  return `${v} <${smtpUser}>`;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;
  private readonly resolvedHost: string;
  private readonly resolvedPort: number;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS')?.trim();
    const fromRaw = this.config.get<string>('MAIL_FROM')?.trim();
    const explicitHost = this.config.get<string>('SMTP_HOST')?.trim();
    const provider = this.config
      .get<string>('SMTP_PROVIDER')
      ?.trim()
      .toLowerCase();
    const preset =
      provider && SMTP_PRESETS[provider] ? SMTP_PRESETS[provider] : null;

    const host = explicitHost || preset?.host || '';
    const portExplicit = this.config.get<string>('SMTP_PORT')?.trim();
    const port =
      portExplicit !== undefined && portExplicit !== ''
        ? Number(portExplicit)
        : preset?.port ?? 587;
    const secureEnv = this.config.get<string>('SMTP_SECURE');
    const secure =
      secureEnv === 'true' || secureEnv === '1'
        ? true
        : secureEnv === 'false' || secureEnv === '0'
          ? false
          : (preset?.secure ?? false);

    this.resolvedHost = host;
    this.resolvedPort = Number.isFinite(port) ? port : 587;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.resolvedPort,
        secure,
        auth: { user, pass },
      });
      this.fromAddress = resolveMailFrom(fromRaw, user);
    } else {
      this.transporter = null;
      this.fromAddress = '';
    }
  }

  onModuleInit(): void {
    if (this.transporter) {
      this.logger.log(
        `SMTP 사용 중 — ${this.resolvedHost}:${this.resolvedPort} (인증번호는 메일로 발송됩니다)`,
      );
    } else {
      this.logger.warn(
        'SMTP 미설정 — 인증번호는 터미널에만 출력됩니다. `.env`에 SMTP_PROVIDER(gmail|naver|kakao) 또는 SMTP_HOST, SMTP_USER, SMTP_PASS 를 설정하고 서버를 다시 시작하세요.',
      );
    }
  }

  /** 발송용 SMTP가 구성되어 있으면 true */
  isSmtpConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendVerificationCode(
    to: string,
    code: string,
    kind: MailVerificationKind,
    validityLabel: string,
  ): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP is not configured');
    }
    const subject =
      kind === 'register'
        ? '[My-drive] 회원가입 이메일 인증번호'
        : kind === 'find-id'
          ? '[My-drive] 아이디 찾기 인증번호'
          : '[My-drive] 이메일 변경 인증번호';
    const text = [
      `인증번호: ${code}`,
      `유효 시간: ${validityLabel}`,
      '',
      '본인이 요청하지 않았다면 이 메일을 무시해 주세요.',
    ].join('\n');
    const html = `<p>인증번호: <strong>${code}</strong></p><p>유효 시간: ${validityLabel}</p><p style="color:#666;font-size:12px">본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>`;
    await this.transporter.sendMail({
      from: this.fromAddress,
      to,
      subject,
      text,
      html,
    });
    this.logger.log(`Verification mail sent to ${to} (${kind})`);
  }
}
