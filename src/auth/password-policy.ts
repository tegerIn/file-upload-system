/** 회원가입·비밀번호 재설정 공통 규칙 */
export const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}$/;

export const PASSWORD_POLICY_MESSAGE =
  '비밀번호는 8자 이상이며 영문 대문자·소문자·특수문자를 각각 하나 이상 포함해야 합니다.';

/** 대소문자·특수문자 포함 여부 등 정책 통과 여부 */
export function isPasswordPolicyCompliant(password: string): boolean {
  return PASSWORD_POLICY_REGEX.test(password);
}
