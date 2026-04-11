export const PURPOSE_FIND_LOGIN_ID = 'FIND_LOGIN_ID';

export const PURPOSE_REGISTER_CODE = 'REGISTER_CODE';
export const PURPOSE_REGISTER_TOKEN = 'REGISTER_TOKEN';

export const FIND_ID_CODE_TTL_MS = 30 * 1000;
export const REGISTER_CODE_TTL_MS = 30 * 1000;
export const REGISTER_TOKEN_TTL_MS = 30 * 60 * 1000;

/** 리프레시 토큰 유효 기간(슬라이딩 세션 연장용, 24시간) */
export const REFRESH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_RANDOM_BYTES = 32;

/** 마이페이지 이메일 변경: 사용자별로 purpose에 userId를 붙여 구분 */
export function purposeUpdateEmailCode(userId: string): string {
  return `UPDATE_EMAIL_CODE:${userId}`;
}

export function purposeUpdateEmailToken(userId: string): string {
  return `UPDATE_EMAIL_TOKEN:${userId}`;
}
