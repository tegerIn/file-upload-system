/** SMTP_PROVIDER 값에 대응하는 기본 호스트·포트 (SMTP_HOST 미지정 시 사용) */
export type SmtpPreset = { host: string; port: number; secure: boolean };

export const SMTP_PRESETS: Record<string, SmtpPreset> = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
  naver: { host: 'smtp.naver.com', port: 587, secure: false },
  /** 카카오메일(다음 SMTP) — 카카오 도움말 기준 SSL */
  kakao: { host: 'smtp.daum.net', port: 465, secure: true },
};
