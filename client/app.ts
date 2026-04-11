const TOKEN_KEY = 'myDriveToken';
const REFRESH_TOKEN_KEY = 'myDriveRefreshToken';
const VIEW_SECTION_KEY = 'myDriveViewSection';
const DOCS_ROOT_NAME = '__MYDRIVE_DOCS_ROOT__';
const IMAGES_ROOT_NAME = '__MYDRIVE_IMAGES_ROOT__';

/** 이메일 형식 (간단한 RFC 스타일 검사) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

/** 회원가입: 8자 이상 + 영문 대·소문자 + 특수문자(공백 제외) */
const REGISTER_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9\s]).{8,}$/;

const LOGIN_ID_REGEX = /^[a-zA-Z0-9_]{4,20}$/;

let registerEmailVerifyToken: string | null = null;
let registerEmailVerifiedFor: string | null = null;
/** 회원가입: 중복 확인 완료된 아이디(소문자 정규화). 입력 변경 시 무효화 */
let registerLoginIdCheckedNorm: string | null = null;

let mypageEmailVerifyToken: string | null = null;
let mypageEmailVerifiedFor: string | null = null;

function invalidateMyPageEmailVerification(): void {
  mypageEmailVerifyToken = null;
  mypageEmailVerifiedFor = null;
  document.getElementById('mypage-email-verify-step')?.classList.add('hidden');
  const codeEl = document.getElementById('mypage-email-code') as HTMLInputElement | null;
  if (codeEl) {
    codeEl.value = '';
    codeEl.removeAttribute('aria-invalid');
    codeEl.classList.remove('error', 'ok');
  }
  const emailEl = document.getElementById('mypage-email-input') as HTMLInputElement | null;
  if (emailEl) {
    emailEl.removeAttribute('aria-invalid');
    emailEl.classList.remove('error', 'ok');
  }
  const hint = document.getElementById('mypage-email-verify-hint');
  if (hint) {
    hint.textContent = '';
    hint.classList.add('hidden');
    hint.classList.remove('error', 'ok');
  }
  clearEmailCodeTtlHint('mypage-email-code-ttl-hint');
}

/** 마이페이지 폼을 서버 값으로 맞춘 뒤 포커스·검증 UI 잔상 제거 */
function finalizeMyPageFormUi(form: HTMLFormElement): void {
  const ae = document.activeElement;
  if (ae && form.contains(ae)) (ae as HTMLElement).blur();
  form.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
    inp.removeAttribute('aria-invalid');
    inp.classList.remove('error', 'ok', 'invalid');
  });
}

function setMyPageEmailVerifyStepVisible(visible: boolean): void {
  document
    .getElementById('mypage-email-verify-step')
    ?.classList.toggle('hidden', !visible);
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

function isValidLoginId(loginId: string): boolean {
  return LOGIN_ID_REGEX.test(loginId.trim());
}

const emailCodeCountdownTimers = new Map<string, ReturnType<typeof setInterval>>();

const EMAIL_CODE_RESEND_LABEL = '인증번호 다시 받기';

const EMAIL_CODE_COUNTDOWN_SEND: Record<
  string,
  { buttonId: string; defaultLabel: string }
> = {
  'register-email-code-ttl-hint': {
    buttonId: 'btn-register-send-email-code',
    defaultLabel: '인증번호 발송',
  },
  'mypage-email-code-ttl-hint': {
    buttonId: 'btn-mypage-send-email-code',
    defaultLabel: '인증번호 받기',
  },
  'find-id-code-ttl-hint': {
    buttonId: 'btn-send-find-id-code',
    defaultLabel: '인증번호 발송',
  },
};

function setEmailCodeSendButtonForHint(
  hintElementId: string,
  state: 'idle' | 'resend',
): void {
  const spec = EMAIL_CODE_COUNTDOWN_SEND[hintElementId];
  if (!spec) return;
  const btn = document.getElementById(spec.buttonId) as HTMLButtonElement | null;
  if (!btn) return;
  if (state === 'resend') {
    btn.textContent = EMAIL_CODE_RESEND_LABEL;
    btn.disabled = false;
    return;
  }
  btn.textContent = spec.defaultLabel;
  btn.disabled = false;
}

function stopEmailCodeCountdown(elementId: string): void {
  const t = emailCodeCountdownTimers.get(elementId);
  if (t !== undefined) {
    clearInterval(t);
    emailCodeCountdownTimers.delete(elementId);
  }
}

/** 인증번호 유효 시간을 `(MM:SS)` 형식으로 1초마다 갱신. 발송 직후 버튼은 「다시 받기」로 두고 비활성화하지 않음 */
function startEmailCodeCountdown(
  elementId: string,
  expiry: { expiresInMinutes?: unknown; expiresInSeconds?: unknown },
): void {
  stopEmailCodeCountdown(elementId);
  const el = document.getElementById(elementId);
  if (!el) return;
  let totalSec = 0;
  if (
    typeof expiry.expiresInSeconds === 'number' &&
    Number.isFinite(expiry.expiresInSeconds) &&
    expiry.expiresInSeconds > 0
  ) {
    totalSec = Math.floor(expiry.expiresInSeconds);
  }
  if (
    totalSec <= 0 &&
    typeof expiry.expiresInMinutes === 'number' &&
    expiry.expiresInMinutes > 0
  ) {
    totalSec = Math.floor(expiry.expiresInMinutes * 60);
  }
  if (totalSec <= 0) {
    totalSec = 30;
  }
  const endAt = Date.now() + totalSec * 1000;
  el.classList.remove('hidden');
  el.classList.remove('error', 'ok');
  setEmailCodeSendButtonForHint(elementId, 'resend');
  const formatMmSs = (totalSec: number): string => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `(${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')})`;
  };
  const tick = (): void => {
    const node = document.getElementById(elementId);
    if (!node) {
      stopEmailCodeCountdown(elementId);
      return;
    }
    const remainingMs = endAt - Date.now();
    if (remainingMs <= 0) {
      stopEmailCodeCountdown(elementId);
      node.textContent = '인증시간이 만료되었습니다.';
      node.classList.remove('hidden', 'ok');
      node.classList.add('error');
      return;
    }
    const remSec = Math.max(0, Math.ceil(remainingMs / 1000));
    node.textContent = formatMmSs(remSec);
    node.classList.remove('error', 'ok');
  };
  tick();
  emailCodeCountdownTimers.set(elementId, setInterval(tick, 1000));
}

function clearEmailCodeTtlHint(elementId: string): void {
  stopEmailCodeCountdown(elementId);
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
  el.classList.remove('error', 'ok');
  setEmailCodeSendButtonForHint(elementId, 'idle');
}

/** 비밀번호 정책 위반 시 구체 메시지 (대·소문자·특수문자·길이) */
function getPasswordPolicyError(password: string): string | null {
  if (password.length < 8) {
    return '비밀번호는 8자 이상이어야 합니다.';
  }
  if (!/[a-z]/.test(password)) {
    return '영문 소문자를 한 글자 이상 포함해 주세요.';
  }
  if (!/[A-Z]/.test(password)) {
    return '영문 대문자를 한 글자 이상 포함해 주세요.';
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return '특수문자를 한 글자 이상 포함해 주세요. (공백 제외)';
  }
  if (!REGISTER_PASSWORD_REGEX.test(password)) {
    return '비밀번호는 8자 이상이며 영문 대문자·소문자·특수문자를 각각 포함해야 합니다.';
  }
  return null;
}

/** 비밀번호 칸 value와 확인 칸 value 비교 안내 (실시간) */
/** 가입 제출 시 비밀번호 확인란 오류(비어 있음·불일치)를 해당 필드 아래에 표시 */
function showRegisterPasswordConfirmSubmitHint(
  hintEl: HTMLElement,
  primaryValue: string,
  confirmValue: string,
): void {
  if (confirmValue.trim().length === 0) {
    hintEl.classList.remove('hidden');
    hintEl.classList.add('error');
    hintEl.classList.remove('ok');
    hintEl.textContent = '비밀번호 확인을 입력해 주세요.';
    return;
  }
  updatePasswordMatchHint(hintEl, primaryValue, confirmValue);
}

function updatePasswordMatchHint(
  hintEl: HTMLElement,
  primaryValue: string,
  confirmValue: string,
): void {
  if (confirmValue.length === 0) {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    hintEl.classList.remove('error', 'ok');
    return;
  }
  if (primaryValue !== confirmValue) {
    hintEl.classList.remove('hidden');
    hintEl.textContent = '위에 입력한 비밀번호와 일치하지 않습니다.';
    hintEl.classList.add('error');
    hintEl.classList.remove('ok');
  } else {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    hintEl.classList.remove('error', 'ok');
  }
}

function wirePasswordPairMatch(
  form: HTMLFormElement,
  primaryName: string,
  confirmName: string,
  hintId: string,
): void {
  const primary = form.querySelector<HTMLInputElement>(
    `input[name="${primaryName}"]`,
  );
  const confirm = form.querySelector<HTMLInputElement>(
    `input[name="${confirmName}"]`,
  );
  const hint = document.getElementById(hintId);
  if (!primary || !confirm || !hint) return;

  const sync = (): void => {
    updatePasswordMatchHint(hint, primary.value, confirm.value);
  };

  primary.addEventListener('input', sync);
  confirm.addEventListener('input', sync);

  form.addEventListener('reset', () => {
    hint.textContent = '';
    hint.classList.add('hidden');
    hint.classList.remove('error', 'ok');
  });
}

const REGISTER_FIELD_HINT_IDS = [
  'register-loginid-hint',
  'register-password-policy-hint',
  'register-password-match-hint',
  'register-name-hint',
  'register-email-format-hint',
] as const;

function setRegisterEmailVerifyStepVisible(visible: boolean): void {
  document
    .getElementById('register-email-verify-step')
    ?.classList.toggle('hidden', !visible);
}

function setFindIdVerifyStepVisible(visible: boolean): void {
  document.getElementById('find-id-verify-step')?.classList.toggle('hidden', !visible);
}

function invalidateRegisterEmailVerification(): void {
  registerEmailVerifyToken = null;
  registerEmailVerifiedFor = null;
  setRegisterEmailVerifyStepVisible(false);
  const tokenEl = document.getElementById(
    'register-email-verify-token',
  ) as HTMLInputElement | null;
  if (tokenEl) tokenEl.value = '';
  const codeEl = document.getElementById('register-email-code') as HTMLInputElement | null;
  if (codeEl) codeEl.value = '';
  const verifyHint = document.getElementById('register-email-verify-hint');
  if (verifyHint) {
    verifyHint.textContent = '';
    verifyHint.classList.add('hidden');
    verifyHint.classList.remove('error', 'ok');
  }
  clearEmailCodeTtlHint('register-email-code-ttl-hint');
}

function clearRegisterFieldHints(): void {
  for (const id of REGISTER_FIELD_HINT_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '';
      el.classList.add('hidden');
      el.classList.remove('error', 'ok');
    }
  }
  invalidateRegisterEmailVerification();
  registerLoginIdCheckedNorm = null;
}

function updateRegisterLoginIdHint(
  hintEl: HTMLElement,
  rawValue: string,
  mode: 'input' | 'submit' = 'input',
): void {
  const v = rawValue.trim();
  if (mode === 'input' && v.length === 0) {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    hintEl.classList.remove('error', 'ok');
    return;
  }
  if (!isValidLoginId(rawValue)) {
    hintEl.classList.remove('hidden');
    hintEl.classList.add('error');
    hintEl.classList.remove('ok');
    hintEl.textContent =
      mode === 'submit' && v.length === 0
        ? '아이디를 입력해 주세요.'
        : '아이디는 4~20자의 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.';
    return;
  }
  hintEl.textContent = '';
  hintEl.classList.add('hidden');
  hintEl.classList.remove('error', 'ok');
}

function updateRegisterPasswordPolicyHint(
  hintEl: HTMLElement,
  rawValue: string,
  mode: 'input' | 'submit' = 'input',
): void {
  const v = rawValue.trim();
  if (mode === 'input' && v.length === 0) {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    hintEl.classList.remove('error', 'ok');
    return;
  }
  const err = getPasswordPolicyError(rawValue);
  if (err) {
    hintEl.classList.remove('hidden');
    hintEl.classList.add('error');
    hintEl.classList.remove('ok');
    hintEl.textContent = err;
    return;
  }
  hintEl.textContent = '';
  hintEl.classList.add('hidden');
  hintEl.classList.remove('error', 'ok');
}

function updateRegisterNameHint(
  hintEl: HTMLElement,
  rawValue: string,
  mode: 'input' | 'submit',
): void {
  const v = rawValue.trim();
  if (mode === 'input') {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    hintEl.classList.remove('error', 'ok');
    return;
  }
  if (v.length === 0) {
    hintEl.textContent = '이름을 입력해 주세요.';
    hintEl.classList.remove('hidden');
    hintEl.classList.add('error');
    hintEl.classList.remove('ok');
    return;
  }
  hintEl.textContent = '';
  hintEl.classList.add('hidden');
  hintEl.classList.remove('error', 'ok');
}

/** 회원가입 이메일 형식 안내 (비밀번호 확인 힌트와 동일 위치·스타일) */
function updateRegisterEmailFormatHint(
  hintEl: HTMLElement,
  rawValue: string,
  mode: 'input' | 'submit' = 'input',
): void {
  const v = rawValue.trim();
  if (mode === 'input' && v.length === 0) {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
    hintEl.classList.remove('error', 'ok');
    return;
  }
  if (!isValidEmail(rawValue)) {
    hintEl.classList.remove('hidden');
    hintEl.classList.add('error');
    hintEl.classList.remove('ok');
    hintEl.textContent =
      mode === 'submit' && v.length === 0
        ? '이메일을 입력해 주세요.'
        : '올바른 이메일 형식을 입력해 주세요.';
    return;
  }
  hintEl.textContent = '';
  hintEl.classList.add('hidden');
  hintEl.classList.remove('error', 'ok');
}

function wireRegisterEmailFormatHint(form: HTMLFormElement): void {
  const emailInput = form.querySelector<HTMLInputElement>('input[name="email"]');
  const hint = document.getElementById('register-email-format-hint');
  if (!emailInput || !hint) return;
  const sync = (): void => {
    updateRegisterEmailFormatHint(hint, emailInput.value, 'input');
    const norm = emailInput.value.trim().toLowerCase();
    if (
      registerEmailVerifiedFor !== null &&
      norm !== registerEmailVerifiedFor
    ) {
      invalidateRegisterEmailVerification();
    }
  };
  emailInput.addEventListener('input', sync);
}

function wireRegisterLoginIdHint(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[name="loginId"]');
  const hint = document.getElementById('register-loginid-hint');
  if (!input || !hint) return;
  input.addEventListener('input', () => {
    registerLoginIdCheckedNorm = null;
    updateRegisterLoginIdHint(hint, input.value, 'input');
  });
}

function wireRegisterPasswordPolicyHint(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[name="password"]');
  const hint = document.getElementById('register-password-policy-hint');
  if (!input || !hint) return;
  input.addEventListener('input', () => {
    updateRegisterPasswordPolicyHint(hint, input.value, 'input');
  });
}

function wireRecoveryPasswordPolicyHint(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[name="newPassword"]');
  const hint = document.getElementById('recovery-password-policy-hint');
  if (!input || !hint) return;
  input.addEventListener('input', () => {
    updateRegisterPasswordPolicyHint(hint, input.value, 'input');
  });
  form.addEventListener('reset', () => {
    hint.textContent = '';
    hint.classList.add('hidden');
    hint.classList.remove('error', 'ok');
  });
}

interface UserDto {
  id?: string;
  loginId: string;
  email: string;
  name?: string | null;
}

interface DriveItem {
  id: string;
  name: string;
  type: 'FILE' | 'FOLDER';
  parentId?: string | null;
  sectionKey?: string | null;
  isImage?: boolean;
  mimeType?: string | null;
  size?: number | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

interface ApiErrorBody {
  message?: string | string[];
}

interface AuthSuccessBody {
  accessToken: string;
  refreshToken?: string;
  user: UserDto;
}

let currentParentId: string | null = null;
const pathStack: { id: string | null; name: string }[] = [];
let moveSourceId: string | null = null;
let moveTargetFolderId: string | null = null;
const NOTICE_CONFIRM_DEFAULT = '확인';
let noticeModalAfterClose: (() => void) | null = null;
/** 동시에 여러 요청이 401을 반환해도 안내 모달은 한 번만 띄움(연장 모달이 열려 있으면 true) */
let sessionExpiredFlowActive = false;

const SESSION_RENEW_MESSAGE_401 =
  '로그인 세션이 만료되었습니다. 세션을 연장할까요?';
const SESSION_RENEW_MESSAGE_SOON =
  '곧 로그인 세션이 만료됩니다. 세션을 연장할까요?';
/** 액세스 JWT 만료 전에 연장 안내를 띄우기까지 남은 최소 시간(밀리초) */
const ACCESS_TOKEN_WARN_BEFORE_MS = 25 * 1000;

let accessTokenExpiryWarnTimer: ReturnType<typeof setTimeout> | null = null;
let deleteTargetItem: DriveItem | null = null;
/** true면 휴지통에서의 영구 삭제 확인 모달 */
let deleteIsPermanentPurge = false;
/** true면 삭제 확인 모달이 휴지통 전체 비우기 동작 */
let deleteIsEmptyTrash = false;
let renameTargetItem: DriveItem | null = null;
/** 파일 이름 변경 시 입력란에는 제외하고, 저장 시 다시 붙이는 확장자(예: `.jpeg`) */
let renameFileExtensionSuffix: string | null = null;
const previewUrls = new Set<string>();
let currentUser: UserDto | null = null;
let currentItems: DriveItem[] = [];
let currentSection: 'home' | 'docs' | 'images' | 'trash' | 'mypage' = 'home';
let currentSort: 'created' | 'name' = 'created';
let currentViewMode: 'grid' | 'list' = 'grid';
let sectionRootIds: { docs: string | null; images: string | null } = {
  docs: null,
  images: null,
};

/** 브레드크럼 등에 쓰는 루트 표시 이름(이름 변경 후 갱신) */
let sectionRootLabels: { docs: string; images: string } = {
  docs: '문서',
  images: '이미지',
};

function isSectionRootFolder(item: DriveItem): boolean {
  if (item.type !== 'FOLDER') return false;
  return (
    item.sectionKey === 'DOCS_ROOT' ||
    item.sectionKey === 'IMAGES_ROOT' ||
    item.id === sectionRootIds.docs ||
    item.id === sectionRootIds.images
  );
}

/** 목록·모달: DB 내부 키 이름만 가짜 라벨로 치환 */
function driveItemDisplayName(item: DriveItem): string {
  if (item.name === DOCS_ROOT_NAME) return '문서';
  if (item.name === IMAGES_ROOT_NAME) return '이미지';
  return item.name;
}

/** 카드 제목: 파일은 확장자 제외(아래 메타에 타입·용량 표시), 폴더는 전체 이름 */
function driveItemCardTitleName(item: DriveItem): string {
  const full = driveItemDisplayName(item);
  if (item.type !== 'FILE') return full;
  const lastDot = full.lastIndexOf('.');
  if (lastDot <= 0 || lastDot >= full.length - 1) return full;
  return full.slice(0, lastDot);
}

function updatePathStackName(itemId: string, newName: string): void {
  for (const seg of pathStack) {
    if (seg.id === itemId) seg.name = newName;
  }
  renderBreadcrumb();
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function persistAuthTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  scheduleAccessTokenExpiryWarning();
}

function clearAccessTokenExpiryWarnTimer(): void {
  if (accessTokenExpiryWarnTimer != null) {
    clearTimeout(accessTokenExpiryWarnTimer);
    accessTokenExpiryWarnTimer = null;
  }
}

/** JWT payload의 exp(밀리초) */
function readAccessTokenExpMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleAccessTokenExpiryWarning(): void {
  clearAccessTokenExpiryWarnTimer();
  const token = localStorage.getItem(TOKEN_KEY);
  const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!token || !rt || !currentUser) return;
  const expMs = readAccessTokenExpMs(token);
  if (expMs == null) return;
  const delay = expMs - Date.now() - ACCESS_TOKEN_WARN_BEFORE_MS;
  if (delay <= 0) {
    void promptSessionRenewIfExpiringSoon();
    return;
  }
  accessTokenExpiryWarnTimer = setTimeout(() => {
    accessTokenExpiryWarnTimer = null;
    void promptSessionRenewIfExpiringSoon();
  }, delay);
}

/** 액세스 만료 임박 시(또는 이미 지난 직후) 연장 모달 — 이미 열려 있거나 리프레시 없으면 생략 */
async function promptSessionRenewIfExpiringSoon(): Promise<void> {
  if (!currentUser) return;
  if (!localStorage.getItem(REFRESH_TOKEN_KEY)) return;
  const renewEl = getEl('session-renew-modal');
  if (!renewEl.classList.contains('hidden')) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const expMs = readAccessTokenExpMs(token);
  if (expMs == null) return;
  const msLeft = expMs - Date.now();
  if (msLeft > ACCESS_TOKEN_WARN_BEFORE_MS + 5000) return;
  if (msLeft < -5 * 60 * 1000) return;
  sessionExpiredFlowActive = true;
  openSessionRenewModal(SESSION_RENEW_MESSAGE_SOON);
}

function clearAuthTokens(): void {
  clearAccessTokenExpiryWarnTimer();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function setAuthMessage(text: string, isError?: boolean): void {
  const el = getEl<HTMLParagraphElement>('auth-message');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

/** 로그아웃·세션 만료 등으로 인증 화면으로 돌아올 때 입력·탭 상태를 비움 */
function resetAuthViewAfterLeavingDrive(): void {
  getEl<HTMLFormElement>('form-login').reset();
  getEl<HTMLFormElement>('form-register').reset();
  clearRegisterFieldHints();
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelector<HTMLElement>('.tab[data-tab="login"]')?.classList.add('active');
  document.querySelector<HTMLElement>('.tab[data-tab="register"]')?.classList.remove('active');
  getEl('tab-login').classList.remove('hidden');
  getEl('tab-register').classList.add('hidden');
  setAuthMessage('');
}

function setDriveError(text: string): void {
  const el = getEl<HTMLParagraphElement>('drive-error');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function closeAccountMenu(): void {
  getEl('account-menu').classList.add('hidden');
  getEl<HTMLButtonElement>('btn-account-menu').setAttribute('aria-expanded', 'false');
}

function closeActionMenus(): void {
  document.querySelectorAll<HTMLElement>('.item-menu').forEach((m) => m.classList.add('hidden'));
}

function closeControlMenus(): void {
  getEl('sort-menu').classList.add('hidden');
  getEl('view-menu').classList.add('hidden');
  getEl<HTMLButtonElement>('btn-sort-menu').setAttribute('aria-expanded', 'false');
  getEl<HTMLButtonElement>('btn-view-menu').setAttribute('aria-expanded', 'false');
}

function setSideMenuVisible(visible: boolean): void {
  getEl('side-menu').classList.toggle('hidden', !visible);
  getEl('side-menu-backdrop').classList.toggle('hidden', !visible);
  document.body.classList.toggle('side-menu-open', visible);
}

function isDocumentItem(item: DriveItem): boolean {
  return item.type === 'FOLDER' || !item.isImage;
}

function isImageItem(item: DriveItem): boolean {
  return item.type === 'FOLDER' || !!item.isImage;
}

function sortItems(items: DriveItem[]): DriveItem[] {
  const copy = [...items];
  const dateKey: 'createdAt' | 'deletedAt' =
    currentSection === 'trash' ? 'deletedAt' : 'createdAt';
  copy.sort((a, b) => {
    if (currentSection !== 'trash' && a.type !== b.type) {
      return a.type === 'FOLDER' ? -1 : 1;
    }
    if (currentSort === 'name') {
      return a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' });
    }
    const ta = a[dateKey] ? new Date(a[dateKey] as string).getTime() : 0;
    const tb = b[dateKey] ? new Date(b[dateKey] as string).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' });
  });
  return copy;
}

function refreshDriveListClass(): void {
  const list = getEl('drive-list');
  list.classList.toggle('list-mode', currentViewMode === 'list');
  list.classList.toggle('trash-mode', currentSection === 'trash');
}

function renderCurrentItems(): void {
  renderItems(sortItems(currentItems));
}

async function ensureSectionRoots(): Promise<boolean> {
  const res = await fetch('/api/drive/items', { headers: authHeaders() });
  if (tryHandleUnauthorized(res)) return false;
  if (!res.ok) return true;
  const top = (await res.json()) as DriveItem[];
  const docsItem =
    top.find((x) => x.type === 'FOLDER' && x.sectionKey === 'DOCS_ROOT') ??
    top.find((x) => x.type === 'FOLDER' && x.name === DOCS_ROOT_NAME);
  const imagesItem =
    top.find((x) => x.type === 'FOLDER' && x.sectionKey === 'IMAGES_ROOT') ??
    top.find((x) => x.type === 'FOLDER' && x.name === IMAGES_ROOT_NAME);

  async function createRoot(name: string): Promise<DriveItem | null | false> {
    const r = await fetch('/api/drive/folders', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (tryHandleUnauthorized(r)) return false;
    if (!r.ok) return null;
    return (await r.json()) as DriveItem;
  }

  let docs = docsItem?.id ?? null;
  let images = imagesItem?.id ?? null;
  if (!docs) {
    const created = await createRoot(DOCS_ROOT_NAME);
    if (created === false) return false;
    docs = created?.id ?? null;
  }
  if (!images) {
    const created = await createRoot(IMAGES_ROOT_NAME);
    if (created === false) return false;
    images = created?.id ?? null;
  }
  sectionRootIds = { docs, images };

  const res2 = await fetch('/api/drive/items', { headers: authHeaders() });
  if (tryHandleUnauthorized(res2)) return false;
  if (res2.ok) {
    const top2 = (await res2.json()) as DriveItem[];
    const d =
      top2.find((x) => x.type === 'FOLDER' && x.sectionKey === 'DOCS_ROOT') ??
      top2.find((x) => x.type === 'FOLDER' && x.id === docs);
    const im =
      top2.find((x) => x.type === 'FOLDER' && x.sectionKey === 'IMAGES_ROOT') ??
      top2.find((x) => x.type === 'FOLDER' && x.id === images);
    sectionRootLabels = {
      docs: d ? driveItemDisplayName(d) : '문서',
      images: im ? driveItemDisplayName(im) : '이미지',
    };
  }
  return true;
}

function setSection(section: 'home' | 'docs' | 'images' | 'trash' | 'mypage'): void {
  currentSection = section;
  if (
    section === 'home' ||
    section === 'docs' ||
    section === 'images' ||
    section === 'trash' ||
    section === 'mypage'
  ) {
    localStorage.setItem(VIEW_SECTION_KEY, section);
  }
  setSideMenuVisible(false);
  closeActionMenus();
  const homeBtn = getEl('btn-menu-home');
  const docsBtn = getEl('btn-menu-docs');
  const imgBtn = getEl('btn-menu-images');
  const trashBtn = getEl('btn-menu-trash');
  const myBtn = getEl('btn-menu-mypage');
  homeBtn.classList.toggle('active', section === 'home');
  docsBtn.classList.toggle('active', section === 'docs');
  imgBtn.classList.toggle('active', section === 'images');
  trashBtn.classList.toggle('active', section === 'trash');
  myBtn.classList.toggle('active', section === 'mypage');

  const isMypage = section === 'mypage';
  getEl('drive-view').classList.toggle('hidden', isMypage);
  getEl('mypage-view').classList.toggle('hidden', !isMypage);

  const uploadInput = getEl<HTMLInputElement>('input-upload');
  uploadInput.accept = section === 'images' ? 'image/*' : '';
  const isTrash = section === 'trash';
  const isHome = section === 'home';
  getEl('btn-new-folder').classList.toggle('hidden', isTrash);
  getEl('input-upload').parentElement?.classList.toggle('hidden', isTrash);
  getEl('btn-empty-trash').classList.toggle('hidden', !isTrash);

  if (!isMypage) {
    pathStack.length = 0;
    pathStack.push({ id: null, name: '내 서랍' });
    if (isTrash) {
      currentParentId = null;
      pathStack.push({ id: null, name: '휴지통' });
      renderBreadcrumb();
    } else if (isHome) {
      currentParentId = null;
      renderBreadcrumb();
    } else {
      const rootId = section === 'images' ? sectionRootIds.images : sectionRootIds.docs;
      if (rootId) {
        currentParentId = rootId;
        pathStack.push({
          id: rootId,
          name: section === 'images' ? sectionRootLabels.images : sectionRootLabels.docs,
        });
        renderBreadcrumb();
      }
    }
    refreshDriveListClass();
    void loadItems();
  } else if (currentUser) {
    setMyPageMessage('');
    fillMyPageForm(currentUser);
  }
}

function syncControlLabels(): void {
  getEl('sort-label').textContent =
    currentSort === 'name' ? '이름순' : '최신순';
  getEl('view-label').textContent = currentViewMode === 'list' ? '리스트형' : '폴더형';
}

function fillMyPageForm(user: UserDto): void {
  const form = getEl<HTMLFormElement>('form-mypage');
  form.reset();
  const loginId = form.querySelector<HTMLInputElement>('input[name="loginId"]');
  const name = form.querySelector<HTMLInputElement>('input[name="name"]');
  const email = form.querySelector<HTMLInputElement>('input[name="email"]');
  const newPw = form.querySelector<HTMLInputElement>('input[name="newPassword"]');
  const confirmPw = form.querySelector<HTMLInputElement>('input[name="confirmNewPassword"]');
  if (loginId) loginId.value = user.loginId ?? '';
  if (name) name.value = user.name ?? '';
  if (email) email.value = user.email ?? '';
  if (newPw) newPw.value = '';
  if (confirmPw) confirmPw.value = '';
  invalidateMyPageEmailVerification();
  finalizeMyPageFormUi(form);
}

async function openDriveForUser(user: UserDto): Promise<void> {
  const rootsOk = await ensureSectionRoots();
  if (!rootsOk) return;
  showDrive(user);
}

/** 로그인·회원가입 직후: 항상 내 서랍(home)부터 시작 */
async function openDriveForUserFreshLogin(user: UserDto): Promise<void> {
  localStorage.setItem(VIEW_SECTION_KEY, 'home');
  await openDriveForUser(user);
}

function revokePreviews(): void {
  previewUrls.forEach((u) => URL.revokeObjectURL(u));
  previewUrls.clear();
}

function showAuth(): void {
  getEl('notice-modal').classList.add('hidden');
  getEl('session-renew-modal').classList.add('hidden');
  noticeModalAfterClose = null;
  getEl<HTMLButtonElement>('btn-notice-confirm').textContent = NOTICE_CONFIRM_DEFAULT;
  sessionExpiredFlowActive = false;
  clearAuthTokens();
  resetAuthViewAfterLeavingDrive();
  getEl('auth-view').classList.remove('hidden');
  getEl('drive-view').classList.add('hidden');
  getEl('mypage-view').classList.add('hidden');
  getEl('user-area').classList.add('hidden');
  getEl('btn-hamburger').classList.add('hidden');
  setSideMenuVisible(false);
  closeAccountMenu();
  closeActionMenus();
  setMyPageMessage('');
  currentUser = null;
  closeDeleteModal();
  closeNewFolderModal();
  closeMoveModal();
  closeRenameModal();
  closeWithdrawModal();
}

function showDrive(user: UserDto): void {
  getEl('auth-view').classList.add('hidden');
  getEl('btn-hamburger').classList.remove('hidden');
  setSideMenuVisible(false);
  getEl('user-area').classList.remove('hidden');
  currentUser = user;
  const u = getEl<HTMLSpanElement>('user-email');
  u.textContent = user.loginId;
  u.title = user.email;
  getEl('btn-account-loginid').textContent = `${user.loginId}`;
  fillMyPageForm(user);
  const preferred = localStorage.getItem(VIEW_SECTION_KEY);
  const nextSection =
    preferred === 'docs' ||
    preferred === 'images' ||
    preferred === 'trash' ||
    preferred === 'mypage'
      ? preferred
      : 'home';
  setSection(nextSection);
}

function renderBreadcrumb(): void {
  const nav = getEl<HTMLElement>('breadcrumb');
  nav.innerHTML = '';
  pathStack.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      nav.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crumb' + (i === pathStack.length - 1 ? ' current' : '');
    btn.textContent = seg.name;
    if (i < pathStack.length - 1) {
      btn.addEventListener('click', () => {
        if (seg.id === null && seg.name === '내 서랍') {
          setSection('home');
          return;
        }
        if (seg.id === null) return;
        pathStack.splice(i + 1);
        currentParentId = seg.id;
        renderBreadcrumb();
        void loadItems();
      });
    }
    nav.appendChild(btn);
  });
}

function formatSize(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mimeToExtLabel(mime: string | null | undefined): string {
  if (!mime) return '파일';
  const ext = mime.split('/')[1]?.trim();
  if (!ext) return '파일';
  return ext.toLowerCase();
}

async function loadImagePreview(imgEl: HTMLImageElement, fileId: string): Promise<void> {
  const res = await fetch(`/api/drive/files/${fileId}/raw`, {
    headers: authHeaders(),
  });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  previewUrls.add(url);
  imgEl.src = url;
  imgEl.alt = '미리보기';
}

function renderItems(items: DriveItem[]): void {
  const list = getEl<HTMLElement>('drive-list');
  refreshDriveListClass();
  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'message drive-empty-hint';
    empty.innerHTML =
      '이 폴더가 비어 있습니다.<br />파일을 업로드하거나 폴더를 만들어 보세요.';
    list.appendChild(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'item-card' + (item.type === 'FOLDER' ? ' folder' : '');

    const thumb = document.createElement('div');
    thumb.className = 'item-thumb-wrap';
    if (item.type === 'FOLDER') {
      const icon = document.createElement('div');
      icon.className = 'folder-icon';
      icon.textContent = '📁';
      thumb.appendChild(icon);
    } else if (item.isImage || (item.mimeType?.startsWith('image/') ?? false)) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      void loadImagePreview(img, item.id);
      thumb.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'folder-icon';
      icon.textContent = '📄';
      thumb.appendChild(icon);
    }
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'item-body';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = driveItemCardTitleName(item);
    if (item.type === 'FILE') {
      name.title = driveItemDisplayName(item);
    }
    body.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    if (currentSection === 'trash') {
      meta.classList.add('item-meta-stack');
      const dateLine = document.createElement('div');
      dateLine.className = 'item-meta-line item-meta-date';
      dateLine.textContent = `삭제일 ${formatDate(item.deletedAt ?? undefined)}`;
      const purgeLine = document.createElement('div');
      purgeLine.className = 'item-meta-line item-meta-extra';
      purgeLine.textContent = `완전삭제 ${formatDate(item.purgeAt ?? undefined)}`;
      const typeLine = document.createElement('div');
      typeLine.className = 'item-meta-line item-meta-extra';
      typeLine.textContent = `${mimeToExtLabel(item.mimeType)} · ${formatSize(item.size)}`;
      meta.append(dateLine, purgeLine, typeLine);
    } else {
      meta.classList.add('item-meta-stack');
      const dateLine = document.createElement('div');
      dateLine.className = 'item-meta-line item-meta-date';
      dateLine.textContent =
        item.type === 'FOLDER'
          ? `${formatDate(item.createdAt)}`
          : `${formatDate(item.updatedAt)}`;
      const extraLine = document.createElement('div');
      extraLine.className = 'item-meta-line item-meta-extra';
      extraLine.textContent =
        item.type === 'FOLDER'
          ? '폴더'
          : `${mimeToExtLabel(item.mimeType)} · ${formatSize(item.size)}`;
      meta.append(dateLine, extraLine);
    }
    body.appendChild(meta);
    card.appendChild(body);

    if (currentViewMode === 'grid') {
      card.classList.add('item-card--with-menu');
    }

    const menuWrap = document.createElement('div');
    menuWrap.className = 'item-menu-wrap';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'item-menu-trigger';
    trigger.textContent = '⋯';
    trigger.setAttribute('aria-label', '항목 메뉴');
    const menu = document.createElement('div');
    menu.className = 'item-menu hidden';
    if (currentSection !== 'trash') {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'item-menu-option';
      renameBtn.textContent = '이름 변경';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActionMenus();
        openRenameModal(item);
      });
      if (isSectionRootFolder(item)) {
        menu.append(renameBtn);
      } else {
        const moveBtn = document.createElement('button');
        moveBtn.type = 'button';
        moveBtn.className = 'item-menu-option';
        moveBtn.textContent = '이동';
        moveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeActionMenus();
          void openMoveModal(item);
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'item-menu-option danger';
        del.textContent = '삭제';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          closeActionMenus();
          void deleteItem(item);
        });
        menu.append(renameBtn, moveBtn, del);
      }
    } else {
      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = 'item-menu-option';
      moveBtn.textContent = '이동';
      moveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActionMenus();
        void openMoveModal(item);
      });
      const purgeBtn = document.createElement('button');
      purgeBtn.type = 'button';
      purgeBtn.className = 'item-menu-option danger';
      purgeBtn.textContent = '완전 삭제';
      purgeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActionMenus();
        openPermanentDeleteModal(item);
      });
      menu.append(moveBtn, purgeBtn);
    }
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      closeActionMenus();
      menu.classList.toggle('hidden', !willOpen);
    });
    menuWrap.append(trigger, menu);
    card.appendChild(menuWrap);

    if (item.type === 'FOLDER' && currentSection !== 'trash') {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.item-menu-wrap')) return;
        if (currentSection === 'home') {
          if (item.id === sectionRootIds.docs) {
            setSection('docs');
            return;
          }
          if (item.id === sectionRootIds.images) {
            setSection('images');
            return;
          }
        }
        pathStack.push({ id: item.id, name: driveItemDisplayName(item) });
        currentParentId = item.id;
        renderBreadcrumb();
        void loadItems();
      });
    }

    list.appendChild(card);
  }
}

async function loadItems(): Promise<void> {
  setDriveError('');
  revokePreviews();
  const q = currentParentId ? `?parentId=${encodeURIComponent(currentParentId)}` : '';
  const url = currentSection === 'trash' ? '/api/drive/trash' : `/api/drive/items${q}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    setDriveError(
      typeof err.message === 'string' ? err.message : '목록을 불러오지 못했습니다.',
    );
    return;
  }
  const items = (await res.json()) as DriveItem[];
  currentItems = items;
  renderCurrentItems();
}

async function deleteItem(item: DriveItem): Promise<void> {
  if (isSectionRootFolder(item)) return;
  deleteIsPermanentPurge = false;
  deleteIsEmptyTrash = false;
  deleteTargetItem = item;
  getEl<HTMLButtonElement>('btn-delete-confirm').textContent = '삭제';
  getEl('delete-modal-message').textContent =
    item.type === 'FOLDER'
      ? `"${item.name}" 폴더를 삭제할까요? 하위 파일/폴더도 함께 삭제됩니다.`
      : `"${item.name}" 파일을 삭제할까요?`;
  getEl('delete-modal').classList.remove('hidden');
}

function openPermanentDeleteModal(item: DriveItem): void {
  deleteIsPermanentPurge = true;
  deleteIsEmptyTrash = false;
  deleteTargetItem = item;
  getEl<HTMLButtonElement>('btn-delete-confirm').textContent = '삭제';
  getEl('delete-modal-message').textContent =
    item.type === 'FOLDER'
      ? `"${item.name}" 폴더를 영구 삭제할까요? 하위 항목도 함께 지워지며 복구할 수 없습니다.`
      : `"${item.name}"을(를) 영구 삭제할까요? 복구할 수 없습니다.`;
  getEl('delete-modal').classList.remove('hidden');
}

function closeDeleteModal(): void {
  getEl('delete-modal').classList.add('hidden');
  deleteTargetItem = null;
  deleteIsPermanentPurge = false;
  deleteIsEmptyTrash = false;
  getEl<HTMLButtonElement>('btn-delete-confirm').textContent = '삭제';
}

function openEmptyTrashModal(): void {
  deleteIsEmptyTrash = true;
  deleteIsPermanentPurge = false;
  deleteTargetItem = null;
  getEl('delete-modal-message').textContent =
    '휴지통의 모든 파일을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.';
  getEl<HTMLButtonElement>('btn-delete-confirm').textContent = '비우기';
  getEl('delete-modal').classList.remove('hidden');
}

function openWithdrawModal(): void {
  getEl('withdraw-modal').classList.remove('hidden');
}

function closeWithdrawModal(): void {
  getEl('withdraw-modal').classList.add('hidden');
}

function showNoticeModal(message: string, title = '알림', afterClose?: () => void): void {
  noticeModalAfterClose = afterClose ?? null;
  getEl('notice-modal-title').textContent = title;
  getEl('notice-modal-message').textContent = message;
  getEl('notice-modal').classList.remove('hidden');
}

function closeNoticeModal(): void {
  getEl('notice-modal').classList.add('hidden');
  const next = noticeModalAfterClose;
  noticeModalAfterClose = null;
  if (next) next();
}

function closeSessionRenewModal(): void {
  getEl('session-renew-modal').classList.add('hidden');
}

/** 리프레시 토큰 없이 401 → 로그인 안내 */
function showSessionExpiredNoRefreshNotice(): void {
  revokePreviews();
  getEl<HTMLButtonElement>('btn-notice-confirm').textContent = '로그인';
  showNoticeModal(
    '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    '안내',
    () => {
      sessionExpiredFlowActive = false;
      showAuth();
    },
  );
}

function openSessionRenewModal(
  message: string = SESSION_RENEW_MESSAGE_401,
): void {
  getEl<HTMLParagraphElement>('session-renew-modal-message').textContent = message;
  getEl('session-renew-modal').classList.remove('hidden');
}

function declineSessionRenewal(): void {
  closeSessionRenewModal();
  sessionExpiredFlowActive = false;
  clearAuthTokens();
  revokePreviews();
  showAuth();
}

async function acceptSessionRenewal(): Promise<void> {
  const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!rt) {
    declineSessionRenewal();
    return;
  }
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthSuccessBody> & ApiErrorBody;
  if (
    !res.ok ||
    typeof data.accessToken !== 'string' ||
    typeof data.refreshToken !== 'string'
  ) {
    closeSessionRenewModal();
    sessionExpiredFlowActive = false;
    clearAuthTokens();
    revokePreviews();
    showNoticeModal(
      formatApiMessage(data) || '세션을 연장하지 못했습니다. 다시 로그인해 주세요.',
      '안내',
      () => {
        showAuth();
      },
    );
    return;
  }
  persistAuthTokens(data.accessToken, data.refreshToken);
  if (data.user) {
    currentUser = data.user;
    const u = getEl<HTMLSpanElement>('user-email');
    u.textContent = data.user.loginId;
    u.title = data.user.email;
    getEl('btn-account-loginid').textContent = `아이디: ${data.user.loginId}`;
    fillMyPageForm(data.user);
  }
  closeSessionRenewModal();
  sessionExpiredFlowActive = false;
  if (currentSection === 'mypage') {
    setMyPageMessage('');
  }
  await loadItems();
}

function tryHandleUnauthorized(res: Response): boolean {
  if (res.status !== 401) return false;
  if (!getEl('session-renew-modal').classList.contains('hidden')) return true;
  sessionExpiredFlowActive = true;
  if (!localStorage.getItem(REFRESH_TOKEN_KEY)) {
    sessionExpiredFlowActive = false;
    clearAuthTokens();
    showSessionExpiredNoRefreshNotice();
    return true;
  }
  openSessionRenewModal(SESSION_RENEW_MESSAGE_401);
  return true;
}

async function confirmWithdraw(): Promise<void> {
  const res = await fetch('/api/auth/me', {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    showNoticeModal(formatApiMessage(err) || '회원 탈퇴에 실패했습니다.');
    return;
  }
  closeWithdrawModal();
  clearAuthTokens();
  showNoticeModal('회원 탈퇴가 완료되었습니다.', '안내', () => {
    showAuth();
  });
}

async function confirmDeleteItem(): Promise<void> {
  if (deleteIsEmptyTrash) {
    const res = await fetch('/api/drive/trash', {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (tryHandleUnauthorized(res)) return;
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
      showNoticeModal(formatApiMessage(err) || '휴지통 비우기에 실패했습니다.');
      return;
    }
    closeDeleteModal();
    await loadItems();
    return;
  }
  if (!deleteTargetItem) return;
  const item = deleteTargetItem;
  const url = deleteIsPermanentPurge
    ? `/api/drive/items/${item.id}/permanent`
    : `/api/drive/items/${item.id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    showNoticeModal(
      formatApiMessage(err) ||
        (deleteIsPermanentPurge ? '영구 삭제에 실패했습니다.' : '삭제에 실패했습니다.'),
    );
    return;
  }
  closeDeleteModal();
  await loadItems();
}

function closeMoveModal(): void {
  getEl('move-modal').classList.add('hidden');
  moveSourceId = null;
  moveTargetFolderId = null;
}

function openNewFolderModal(): void {
  getEl('new-folder-modal').classList.remove('hidden');
  getEl('new-folder-error').classList.add('hidden');
  getEl('new-folder-error').textContent = '';
  const input = getEl<HTMLInputElement>('new-folder-name');
  input.value = '';
  setTimeout(() => input.focus(), 0);
}

function closeNewFolderModal(): void {
  getEl('new-folder-modal').classList.add('hidden');
}

function openRenameModal(item: DriveItem): void {
  renameTargetItem = item;
  renameFileExtensionSuffix = null;
  getEl('rename-modal').classList.remove('hidden');
  const errEl = getEl<HTMLParagraphElement>('rename-item-error');
  errEl.textContent = '';
  errEl.classList.add('hidden');
  const input = getEl<HTMLInputElement>('rename-item-name');
  const full = driveItemDisplayName(item);
  if (item.type === 'FILE') {
    const lastDot = full.lastIndexOf('.');
    if (lastDot > 0 && lastDot < full.length - 1) {
      renameFileExtensionSuffix = full.slice(lastDot);
      input.value = full.slice(0, lastDot);
    } else {
      input.value = full;
    }
  } else {
    input.value = full;
  }
  setTimeout(() => input.focus(), 0);
}

function closeRenameModal(): void {
  getEl('rename-modal').classList.add('hidden');
  renameTargetItem = null;
  renameFileExtensionSuffix = null;
}

async function listFolders(parentId: string | null): Promise<DriveItem[]> {
  const q = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
  const res = await fetch(`/api/drive/items${q}`, { headers: authHeaders() });
  if (tryHandleUnauthorized(res)) return [];
  if (!res.ok) return [];
  const items = (await res.json()) as DriveItem[];
  return items.filter(
    (x) =>
      x.type === 'FOLDER' &&
      x.sectionKey !== 'DOCS_ROOT' &&
      x.sectionKey !== 'IMAGES_ROOT' &&
      x.name !== DOCS_ROOT_NAME &&
      x.name !== IMAGES_ROOT_NAME,
  );
}

/** 이동 대상 트리: 문서·이미지 시스템 루트 포함 전체 폴더 */
async function listMoveDestFolders(parentId: string | null): Promise<DriveItem[]> {
  const q = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
  const res = await fetch(`/api/drive/items${q}`, { headers: authHeaders() });
  if (tryHandleUnauthorized(res)) return [];
  if (!res.ok) return [];
  const items = (await res.json()) as DriveItem[];
  return items.filter((x) => x.type === 'FOLDER');
}

function moveTreeFolderLabel(folder: DriveItem): string {
  if (folder.id === sectionRootIds.docs) return sectionRootLabels.docs;
  if (folder.id === sectionRootIds.images) return sectionRootLabels.images;
  return driveItemDisplayName(folder);
}

async function renderMoveFolderTree(sourceId: string): Promise<void> {
  const root = getEl('move-folder-tree');
  root.innerHTML = '';
  const selectedId = moveTargetFolderId;

  const clearActive = (): void => {
    root.querySelectorAll('.move-tree-node').forEach((n) => n.classList.remove('active'));
  };

  const walk = async (parentId: string | null, depth: number): Promise<void> => {
    const children = await listMoveDestFolders(parentId);
    for (const folder of children) {
      if (folder.id === sourceId) continue;
      const row = document.createElement('div');
      row.className = 'move-tree-row';
      row.style.paddingLeft = `${depth * 16}px`;
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'move-tree-node';
      node.dataset.folderId = folder.id;
      if (folder.id === selectedId) node.classList.add('active');
      node.textContent = `📁 ${moveTreeFolderLabel(folder)}`;
      node.addEventListener('click', () => {
        moveTargetFolderId = folder.id;
        clearActive();
        node.classList.add('active');
      });
      row.appendChild(node);
      root.appendChild(row);
      await walk(folder.id, depth + 1);
    }
  };

  const title = document.createElement('div');
  title.className = 'move-tree-row';
  title.textContent = '내 서랍';
  root.appendChild(title);

  const topRow = document.createElement('div');
  topRow.className = 'move-tree-row';
  topRow.style.paddingLeft = '16px';
  const topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.className = 'move-tree-node';
  topBtn.dataset.moveToRoot = '1';
  if (selectedId == null) topBtn.classList.add('active');
  topBtn.textContent = '내 서랍 (최상위)';
  topBtn.addEventListener('click', () => {
    moveTargetFolderId = null;
    clearActive();
    topBtn.classList.add('active');
  });
  topRow.appendChild(topBtn);
  root.appendChild(topRow);

  await walk(null, 2);

  if (!root.querySelector('.move-tree-node.active')) {
    const firstFolder = root.querySelector<HTMLButtonElement>('.move-tree-node[data-folder-id]');
    if (firstFolder?.dataset.folderId) {
      firstFolder.classList.add('active');
      moveTargetFolderId = firstFolder.dataset.folderId;
    } else {
      topBtn.classList.add('active');
      moveTargetFolderId = null;
    }
  }
}

async function openMoveModal(item: DriveItem): Promise<void> {
  moveSourceId = item.id;
  moveTargetFolderId = item.parentId ?? null;
  getEl('move-modal').classList.remove('hidden');
  await renderMoveFolderTree(item.id);
}

async function completeMoveToSelectedFolder(): Promise<void> {
  if (!moveSourceId) return;
  const body = moveTargetFolderId ? { parentId: moveTargetFolderId } : {};
  const res = await fetch(`/api/drive/items/${moveSourceId}/move`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    showNoticeModal(formatApiMessage(err) || '이동에 실패했습니다.');
    return;
  }
  closeMoveModal();
  await loadItems();
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const tab = (t as HTMLElement).dataset.tab;
    getEl('tab-login').classList.toggle('hidden', tab !== 'login');
    getEl('tab-register').classList.toggle('hidden', tab !== 'register');
    setAuthMessage('');
  });
});

getEl<HTMLButtonElement>('btn-hamburger').addEventListener('click', () => {
  const nextOpen = getEl('side-menu').classList.contains('hidden');
  setSideMenuVisible(nextOpen);
});

getEl<HTMLButtonElement>('side-menu-backdrop').addEventListener('click', () => {
  setSideMenuVisible(false);
});

getEl<HTMLButtonElement>('btn-account-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = getEl('account-menu');
  const nextOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !nextOpen);
  getEl<HTMLButtonElement>('btn-account-menu').setAttribute(
    'aria-expanded',
    nextOpen ? 'true' : 'false',
  );
});

document.addEventListener('click', (e) => {
  const userArea = getEl('user-area');
  if (!userArea.contains(e.target as Node)) {
    closeAccountMenu();
  }
  if (!(e.target as HTMLElement).closest('.item-menu-wrap')) {
    closeActionMenus();
  }
  if (!(e.target as HTMLElement).closest('.control-dropdown')) {
    closeControlMenus();
  }
});

getEl<HTMLButtonElement>('btn-account-mypage').addEventListener('click', () => {
  closeAccountMenu();
  setSection('mypage');
});

getEl<HTMLButtonElement>('btn-menu-home').addEventListener('click', () => {
  setSection('home');
});

getEl<HTMLElement>('btn-brand-home').addEventListener('click', () => {
  if (!currentUser) return;
  setSection('home');
});
getEl<HTMLElement>('btn-brand-home').addEventListener('keydown', (e) => {
  if (!currentUser) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  setSection('home');
});

getEl<HTMLButtonElement>('btn-menu-docs').addEventListener('click', () => {
  setSection('docs');
});

getEl<HTMLButtonElement>('btn-menu-images').addEventListener('click', () => {
  setSection('images');
});

getEl<HTMLButtonElement>('btn-menu-trash').addEventListener('click', () => {
  setSection('trash');
});

getEl<HTMLButtonElement>('btn-menu-mypage').addEventListener('click', () => {
  setSection('mypage');
});

getEl<HTMLButtonElement>('btn-menu-withdraw').addEventListener('click', () => {
  setSideMenuVisible(false);
  openWithdrawModal();
});

getEl<HTMLButtonElement>('btn-sort-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = getEl('sort-menu').classList.contains('hidden');
  closeControlMenus();
  getEl('sort-menu').classList.toggle('hidden', !willOpen);
  getEl<HTMLButtonElement>('btn-sort-menu').setAttribute(
    'aria-expanded',
    willOpen ? 'true' : 'false',
  );
});

document.querySelectorAll<HTMLElement>('#sort-menu .control-menu-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.sort;
    currentSort = next === 'name' ? 'name' : 'created';
    syncControlLabels();
    closeControlMenus();
    renderCurrentItems();
  });
});

getEl<HTMLButtonElement>('btn-view-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = getEl('view-menu').classList.contains('hidden');
  closeControlMenus();
  getEl('view-menu').classList.toggle('hidden', !willOpen);
  getEl<HTMLButtonElement>('btn-view-menu').setAttribute(
    'aria-expanded',
    willOpen ? 'true' : 'false',
  );
});

document.querySelectorAll<HTMLElement>('#view-menu .control-menu-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.view;
    currentViewMode = next === 'list' ? 'list' : 'grid';
    syncControlLabels();
    closeControlMenus();
    renderCurrentItems();
  });
});

// 초기 라벨 동기화
syncControlLabels();

/* 기존 select 제거 후 커스텀 메뉴로 대체
getEl<HTMLSelectElement>('select-sort').addEventListener('change', (e) => {
  const next = (e.target as HTMLSelectElement).value;
  currentSort = next === 'updated' ? 'updated' : 'created';
  renderCurrentItems();
});

getEl<HTMLSelectElement>('select-view-mode').addEventListener('change', (e) => {
  const next = (e.target as HTMLSelectElement).value;
  currentViewMode = next === 'list' ? 'list' : 'grid';
  renderCurrentItems();
});
*/

function openRecovery(mode: 'id' | 'password'): void {
  const modal = getEl('recovery-modal');
  modal.classList.remove('hidden');
  getEl<HTMLHeadingElement>('recovery-modal-title').textContent =
    mode === 'id' ? '아이디 찾기' : '비밀번호 재설정';
  getEl('recovery-find-id').classList.toggle('hidden', mode !== 'id');
  getEl('recovery-reset-password').classList.toggle('hidden', mode !== 'password');
  const idResult = getEl<HTMLParagraphElement>('recovery-find-id-result');
  const passResult = getEl<HTMLParagraphElement>('recovery-password-result');
  idResult.textContent = '';
  passResult.textContent = '';
  idResult.classList.remove('error');
  passResult.classList.remove('error');
  getEl<HTMLInputElement>('find-id-name').value = '';
  getEl<HTMLInputElement>('find-id-email').value = '';
  getEl<HTMLInputElement>('find-id-code').value = '';
  setFindIdVerifyStepVisible(false);
  clearEmailCodeTtlHint('find-id-code-ttl-hint');
  getEl<HTMLFormElement>('form-recovery-password').reset();
}

function closeRecovery(): void {
  clearEmailCodeTtlHint('find-id-code-ttl-hint');
  getEl('recovery-modal').classList.add('hidden');
}

function openRecoveryResultModal(title: string, message: string): void {
  getEl<HTMLHeadingElement>('recovery-result-title').textContent = title;
  getEl<HTMLParagraphElement>('recovery-result-message').textContent = message;
  getEl('recovery-result-modal').classList.remove('hidden');
}

function closeRecoveryResultModal(): void {
  getEl('recovery-result-modal').classList.add('hidden');
}

getEl<HTMLButtonElement>('btn-find-id').addEventListener('click', () => {
  setAuthMessage('');
  openRecovery('id');
});

getEl<HTMLButtonElement>('btn-find-password').addEventListener('click', () => {
  setAuthMessage('');
  openRecovery('password');
});

getEl<HTMLButtonElement>('recovery-close').addEventListener('click', () => {
  closeRecovery();
});

getEl<HTMLButtonElement>('recovery-backdrop').addEventListener('click', () => {
  closeRecovery();
});

getEl<HTMLButtonElement>('btn-recovery-result-confirm').addEventListener('click', () => {
  closeRecoveryResultModal();
});

getEl<HTMLButtonElement>('btn-send-find-id-code').addEventListener('click', async () => {
  const resultEl = getEl<HTMLParagraphElement>('recovery-find-id-result');
  resultEl.classList.remove('error');
  const name = getEl<HTMLInputElement>('find-id-name').value.trim();
  const email = getEl<HTMLInputElement>('find-id-email').value.trim();
  if (!name) {
    setFindIdVerifyStepVisible(false);
    clearEmailCodeTtlHint('find-id-code-ttl-hint');
    resultEl.textContent = '이름을 입력해 주세요.';
    resultEl.classList.add('error');
    return;
  }
  if (!isValidEmail(email)) {
    setFindIdVerifyStepVisible(false);
    clearEmailCodeTtlHint('find-id-code-ttl-hint');
    resultEl.textContent = '올바른 이메일 형식을 입력해 주세요.';
    resultEl.classList.add('error');
    return;
  }
  const res = await fetch('/api/auth/find-id/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    sent?: boolean;
    message?: string;
    expiresInMinutes?: number;
    expiresInSeconds?: number;
  } & ApiErrorBody;
  if (!res.ok) {
    setFindIdVerifyStepVisible(false);
    clearEmailCodeTtlHint('find-id-code-ttl-hint');
    resultEl.textContent = formatApiMessage(data);
    resultEl.classList.add('error');
    return;
  }
  if (data.sent === false) {
    setFindIdVerifyStepVisible(false);
    clearEmailCodeTtlHint('find-id-code-ttl-hint');
    resultEl.textContent =
      typeof data.message === 'string' ? data.message : '처리되었습니다.';
    resultEl.classList.add('error');
    return;
  }
  resultEl.textContent = '';
  resultEl.classList.remove('error');
  setFindIdVerifyStepVisible(true);
  startEmailCodeCountdown('find-id-code-ttl-hint', {
    expiresInMinutes: data.expiresInMinutes,
    expiresInSeconds: data.expiresInSeconds,
  });
});

getEl<HTMLButtonElement>('btn-verify-find-id-code').addEventListener('click', async () => {
  const resultEl = getEl<HTMLParagraphElement>('recovery-find-id-result');
  resultEl.classList.remove('error');
  const email = getEl<HTMLInputElement>('find-id-email').value.trim();
  const code = getEl<HTMLInputElement>('find-id-code').value.trim();
  if (!isValidEmail(email)) {
    resultEl.textContent = '이메일을 입력해 주세요.';
    resultEl.classList.add('error');
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    resultEl.textContent = '인증번호 6자리를 입력해 주세요.';
    resultEl.classList.add('error');
    return;
  }
  const res = await fetch('/api/auth/find-id/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = (await res.json().catch(() => ({}))) as { loginId?: string } & ApiErrorBody;
  if (!res.ok) {
    resultEl.textContent = formatApiMessage(data);
    resultEl.classList.add('error');
    return;
  }
  resultEl.textContent = '';
  resultEl.classList.remove('error');
  const foundMsg =
    typeof data.loginId === 'string'
      ? `회원님의 아이디는 「${data.loginId}」 입니다.`
      : '아이디를 확인했습니다.';
  closeRecovery();
  openRecoveryResultModal('아이디 찾기 결과', foundMsg);
});

getEl<HTMLFormElement>('form-recovery-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultEl = getEl<HTMLParagraphElement>('recovery-password-result');
  resultEl.classList.remove('error');
  const form = e.target as HTMLFormElement;
  const fd = new FormData(form);
  const loginId = String(fd.get('loginId') ?? '').trim();
  const npInput = form.querySelector<HTMLInputElement>('input[name="newPassword"]');
  const cfInput = form.querySelector<HTMLInputElement>(
    'input[name="confirmPassword"]',
  );
  const newPassword = npInput?.value ?? '';
  const confirmPassword = cfInput?.value ?? '';
  if (!isValidLoginId(loginId)) {
    resultEl.textContent =
      loginId.length === 0
        ? '아이디를 입력해 주세요.'
        : '아이디는 4~20자의 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.';
    resultEl.classList.add('error');
    return;
  }
  if (newPassword !== confirmPassword) {
    resultEl.textContent = '위에 입력한 새 비밀번호와 일치하지 않습니다.';
    resultEl.classList.add('error');
    return;
  }
  const npErr = getPasswordPolicyError(newPassword);
  if (npErr) {
    const policyHint = document.getElementById('recovery-password-policy-hint');
    if (policyHint) updateRegisterPasswordPolicyHint(policyHint, newPassword, 'submit');
    resultEl.textContent = npErr;
    resultEl.classList.add('error');
    return;
  }
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginId,
      newPassword,
      confirmNewPassword: confirmPassword,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string } & ApiErrorBody;
  if (!res.ok) {
    resultEl.textContent = formatApiMessage(data);
    resultEl.classList.add('error');
    return;
  }
  const successMsg =
    typeof data.message === 'string' ? data.message : '비밀번호가 변경되었습니다.';
  form.reset();
  closeRecovery();
  openRecoveryResultModal('비밀번호 변경 완료', successMsg);
});

const registerFormEl = getEl<HTMLFormElement>('form-register');
registerFormEl.addEventListener('reset', clearRegisterFieldHints);
wireRegisterLoginIdHint(registerFormEl);
wireRegisterPasswordPolicyHint(registerFormEl);
wireRegisterEmailFormatHint(registerFormEl);

wirePasswordPairMatch(
  registerFormEl,
  'password',
  'confirmPassword',
  'register-password-match-hint',
);
const recoveryPasswordForm = getEl<HTMLFormElement>('form-recovery-password');
wireRecoveryPasswordPolicyHint(recoveryPasswordForm);
wirePasswordPairMatch(
  recoveryPasswordForm,
  'newPassword',
  'confirmPassword',
  'recovery-password-match-hint',
);

getEl<HTMLButtonElement>('btn-register-check-loginid').addEventListener('click', async () => {
  const input = registerFormEl.querySelector<HTMLInputElement>('input[name="loginId"]');
  const hint = document.getElementById('register-loginid-hint');
  if (!input || !hint) return;
  const loginId = input.value.trim();
  setAuthMessage('');
  if (!isValidLoginId(loginId)) {
    registerLoginIdCheckedNorm = null;
    updateRegisterLoginIdHint(hint, loginId, 'submit');
    return;
  }
  const res = await fetch(
    `/api/auth/register/check-login-id?loginId=${encodeURIComponent(loginId)}`,
  );
  const data = (await res.json().catch(() => ({}))) as { available?: boolean } & ApiErrorBody;
  if (!res.ok) {
    registerLoginIdCheckedNorm = null;
    hint.textContent = formatApiMessage(data);
    hint.classList.remove('hidden');
    hint.classList.add('error');
    hint.classList.remove('ok');
    return;
  }
  if (data.available !== true) {
    registerLoginIdCheckedNorm = null;
    hint.textContent = '이미 사용 중인 아이디입니다.';
    hint.classList.remove('hidden');
    hint.classList.add('error');
    hint.classList.remove('ok');
    return;
  }
  registerLoginIdCheckedNorm = loginId.toLowerCase();
  hint.textContent = '사용 가능한 아이디입니다.';
  hint.classList.remove('hidden');
  hint.classList.remove('error');
  hint.classList.add('ok');
});

getEl<HTMLButtonElement>('btn-register-send-email-code').addEventListener('click', async () => {
  const emailInput = registerFormEl.querySelector<HTMLInputElement>('input[name="email"]');
  const formatHint = document.getElementById('register-email-format-hint');
  const verifyHint = document.getElementById('register-email-verify-hint');
  if (!emailInput || !verifyHint) return;
  const email = emailInput.value.trim();
  if (!isValidEmail(email)) {
    setRegisterEmailVerifyStepVisible(false);
    if (formatHint) updateRegisterEmailFormatHint(formatHint, email, 'submit');
    return;
  }
  invalidateRegisterEmailVerification();
  setAuthMessage('');
  const res = await fetch('/api/auth/register-send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    expiresInMinutes?: number;
    expiresInSeconds?: number;
  } & ApiErrorBody;
  if (!res.ok) {
    verifyHint.textContent = formatApiMessage(data);
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  verifyHint.textContent = '';
  verifyHint.classList.add('hidden');
  verifyHint.classList.remove('error', 'ok');
  setRegisterEmailVerifyStepVisible(true);
  startEmailCodeCountdown('register-email-code-ttl-hint', {
    expiresInMinutes: data.expiresInMinutes,
    expiresInSeconds: data.expiresInSeconds,
  });
});

getEl<HTMLButtonElement>('btn-register-verify-email-code').addEventListener('click', async () => {
  const emailInput = registerFormEl.querySelector<HTMLInputElement>('input[name="email"]');
  const codeInput = document.getElementById('register-email-code') as HTMLInputElement | null;
  const formatHint = document.getElementById('register-email-format-hint');
  const verifyHint = document.getElementById('register-email-verify-hint');
  const tokenInput = document.getElementById(
    'register-email-verify-token',
  ) as HTMLInputElement | null;
  if (!emailInput || !codeInput || !tokenInput || !verifyHint) return;
  const email = emailInput.value.trim();
  if (!isValidEmail(email)) {
    if (formatHint) updateRegisterEmailFormatHint(formatHint, email, 'submit');
    return;
  }
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    verifyHint.textContent = '인증번호 6자리를 입력해 주세요.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  setAuthMessage('');
  const res = await fetch('/api/auth/register-verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    emailVerifyToken?: string;
  } & ApiErrorBody;
  if (!res.ok) {
    verifyHint.textContent = formatApiMessage(data);
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  const tok = data.emailVerifyToken;
  if (typeof tok !== 'string' || !/^[a-f0-9]{64}$/u.test(tok)) {
    verifyHint.textContent = '인증에 실패했습니다.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  registerEmailVerifyToken = tok;
  registerEmailVerifiedFor = email.toLowerCase();
  tokenInput.value = tok;
  verifyHint.textContent = '';
  verifyHint.classList.add('hidden');
  verifyHint.classList.remove('error', 'ok');
  clearEmailCodeTtlHint('register-email-code-ttl-hint');
});

getEl<HTMLFormElement>('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const fd = new FormData(form);
  const body = {
    loginId: String(fd.get('loginId') ?? ''),
    password: String(fd.get('password') ?? ''),
  };
  if (!isValidLoginId(body.loginId)) {
    setAuthMessage('아이디는 4~20자의 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.', true);
    return;
  }
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as AuthSuccessBody & ApiErrorBody;
  if (!res.ok) {
    setAuthMessage(formatApiMessage(data), true);
    return;
  }
  if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    setAuthMessage('로그인 응답이 올바르지 않습니다. 서버를 확인해 주세요.', true);
    return;
  }
  persistAuthTokens(data.accessToken, data.refreshToken);
  setAuthMessage('');
  await openDriveForUserFreshLogin(data.user);
});

registerFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const fd = new FormData(form);
  const pwInput = form.querySelector<HTMLInputElement>('input[name="password"]');
  const cfInput = form.querySelector<HTMLInputElement>(
    'input[name="confirmPassword"]',
  );
  const password = pwInput?.value ?? '';
  const confirmPassword = cfInput?.value ?? '';
  const body = {
    loginId: String(fd.get('loginId') ?? '').trim(),
    email: String(fd.get('email') ?? ''),
    password,
    name: String(fd.get('name') ?? '').trim(),
  };
  setAuthMessage('');

  const loginIdHint = document.getElementById('register-loginid-hint');
  const pwPolicyHint = document.getElementById('register-password-policy-hint');
  const matchHint = document.getElementById('register-password-match-hint');
  const nameHint = document.getElementById('register-name-hint');
  const emailHint = document.getElementById('register-email-format-hint');
  const emailVerifyHint = document.getElementById('register-email-verify-hint');

  if (!isValidLoginId(body.loginId)) {
    if (loginIdHint) updateRegisterLoginIdHint(loginIdHint, body.loginId, 'submit');
    return;
  }
  const loginIdNorm = body.loginId.trim().toLowerCase();
  if (registerLoginIdCheckedNorm !== loginIdNorm) {
    if (loginIdHint) {
      loginIdHint.textContent = '아이디 중복 확인을 해 주세요.';
      loginIdHint.classList.remove('hidden');
      loginIdHint.classList.add('error');
      loginIdHint.classList.remove('ok');
    }
    return;
  }
  const pwErr = getPasswordPolicyError(body.password);
  if (pwErr) {
    if (pwPolicyHint) updateRegisterPasswordPolicyHint(pwPolicyHint, body.password, 'submit');
    return;
  }
  if (password !== confirmPassword || confirmPassword.trim() === '') {
    if (matchHint) showRegisterPasswordConfirmSubmitHint(matchHint, password, confirmPassword);
    return;
  }
  if (!body.name) {
    if (nameHint) updateRegisterNameHint(nameHint, body.name, 'submit');
    return;
  }
  if (!isValidEmail(body.email)) {
    if (emailHint) updateRegisterEmailFormatHint(emailHint, body.email, 'submit');
    return;
  }
  const emailVerifyToken = String(fd.get('emailVerifyToken') ?? '').trim();
  const emailNorm = body.email.trim().toLowerCase();
  if (
    !emailVerifyToken ||
    !registerEmailVerifyToken ||
    emailVerifyToken !== registerEmailVerifyToken ||
    emailNorm !== registerEmailVerifiedFor
  ) {
    if (emailVerifyHint) {
      emailVerifyHint.textContent = '이메일 인증을 완료해 주세요.';
      emailVerifyHint.classList.remove('hidden');
      emailVerifyHint.classList.add('error');
      emailVerifyHint.classList.remove('ok');
    }
    return;
  }
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      confirmPassword,
      emailVerifyToken,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as AuthSuccessBody & ApiErrorBody;
  if (!res.ok) {
    setAuthMessage(formatApiMessage(data), true);
    return;
  }
  if (typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    setAuthMessage('가입 응답이 올바르지 않습니다. 서버를 확인해 주세요.', true);
    return;
  }
  persistAuthTokens(data.accessToken, data.refreshToken);
  setAuthMessage('');
  await openDriveForUserFreshLogin(data.user);
});

function setMyPageMessage(text: string, isError = false): void {
  const el = getEl<HTMLParagraphElement>('mypage-message');
  el.textContent = text;
  el.classList.toggle('error', isError);
  if (!text) {
    el.classList.remove('ok');
  }
}

getEl<HTMLInputElement>('mypage-email-input').addEventListener('input', () => {
  if (!currentUser) return;
  const norm = getEl<HTMLInputElement>('mypage-email-input').value.trim().toLowerCase();
  if (norm === currentUser.email.toLowerCase()) {
    invalidateMyPageEmailVerification();
    return;
  }
  if (norm !== mypageEmailVerifiedFor) {
    invalidateMyPageEmailVerification();
  }
});

getEl<HTMLButtonElement>('btn-mypage-send-email-code').addEventListener('click', async () => {
  if (!currentUser) return;
  const emailInput = getEl<HTMLInputElement>('mypage-email-input');
  const verifyHint = getEl<HTMLParagraphElement>('mypage-email-verify-hint');
  const email = emailInput.value.trim();
  if (!isValidEmail(email)) {
    setMyPageEmailVerifyStepVisible(false);
    clearEmailCodeTtlHint('mypage-email-code-ttl-hint');
    verifyHint.textContent = '올바른 이메일 형식을 입력해 주세요.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  if (email.toLowerCase() === currentUser.email.toLowerCase()) {
    clearEmailCodeTtlHint('mypage-email-code-ttl-hint');
    verifyHint.textContent = '현재와 동일한 이메일입니다.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  invalidateMyPageEmailVerification();
  setMyPageMessage('');
  const res = await fetch('/api/auth/me-email-send-code', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (tryHandleUnauthorized(res)) return;
  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    expiresInMinutes?: number;
    expiresInSeconds?: number;
  } & ApiErrorBody;
  if (!res.ok) {
    verifyHint.textContent = formatApiMessage(data);
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  verifyHint.textContent = '';
  verifyHint.classList.add('hidden');
  verifyHint.classList.remove('error', 'ok');
  setMyPageEmailVerifyStepVisible(true);
  startEmailCodeCountdown('mypage-email-code-ttl-hint', {
    expiresInMinutes: data.expiresInMinutes,
    expiresInSeconds: data.expiresInSeconds,
  });
});

getEl<HTMLButtonElement>('btn-mypage-verify-email-code').addEventListener('click', async () => {
  if (!currentUser) return;
  const emailInput = getEl<HTMLInputElement>('mypage-email-input');
  const codeInput = getEl<HTMLInputElement>('mypage-email-code');
  const verifyHint = getEl<HTMLParagraphElement>('mypage-email-verify-hint');
  const email = emailInput.value.trim();
  if (!isValidEmail(email)) {
    verifyHint.textContent = '올바른 이메일 형식을 입력해 주세요.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    verifyHint.textContent = '인증번호 6자리를 입력해 주세요.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  setMyPageMessage('');
  const res = await fetch('/api/auth/me-email-verify-code', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (tryHandleUnauthorized(res)) return;
  const data = (await res.json().catch(() => ({}))) as {
    emailVerifyToken?: string;
  } & ApiErrorBody;
  if (!res.ok) {
    verifyHint.textContent = formatApiMessage(data);
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  const tok = data.emailVerifyToken;
  if (typeof tok !== 'string' || !/^[a-f0-9]{64}$/u.test(tok)) {
    verifyHint.textContent = '인증에 실패했습니다.';
    verifyHint.classList.remove('hidden');
    verifyHint.classList.add('error');
    verifyHint.classList.remove('ok');
    return;
  }
  mypageEmailVerifyToken = tok;
  mypageEmailVerifiedFor = email.toLowerCase();
  verifyHint.textContent = '이메일 인증이 완료되었습니다.';
  verifyHint.classList.remove('hidden');
  verifyHint.classList.remove('error');
  verifyHint.classList.add('ok');
  clearEmailCodeTtlHint('mypage-email-code-ttl-hint');
});

getEl<HTMLFormElement>('form-mypage').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const form = e.target as HTMLFormElement;
  const fd = new FormData(form);
  const name = String(fd.get('name') ?? '').trim();
  const email = String(fd.get('email') ?? '').trim();
  const newPassword = String(fd.get('newPassword') ?? '');
  const confirmNewPassword = String(fd.get('confirmNewPassword') ?? '');
  const body: Record<string, string> = {};

  const emailNorm = email.trim().toLowerCase();
  if (emailNorm !== currentUser.email.toLowerCase()) {
    if (!isValidEmail(email)) {
      setMyPageMessage('올바른 이메일 형식을 입력해 주세요.', true);
      return;
    }
    if (
      !mypageEmailVerifyToken ||
      emailNorm !== mypageEmailVerifiedFor
    ) {
      setMyPageMessage('이메일 변경은 인증을 완료해 주세요.', true);
      return;
    }
    body.email = email.trim();
    body.emailVerifyToken = mypageEmailVerifyToken;
  }

  if (newPassword.length > 0 || confirmNewPassword.length > 0) {
    const pwErr = getPasswordPolicyError(newPassword);
    if (pwErr) {
      setMyPageMessage(pwErr, true);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setMyPageMessage('새 비밀번호와 새 비밀번호 확인이 일치하지 않습니다.', true);
      return;
    }
    body.newPassword = newPassword;
    body.confirmNewPassword = confirmNewPassword;
  }

  if (Object.keys(body).length === 0) {
    setMyPageMessage('변경된 내용이 없습니다.', true);
    return;
  }

  const res = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (tryHandleUnauthorized(res)) return;
  const data = (await res.json().catch(() => ({}))) as
    | (AuthSuccessBody & { message?: string })
    | ApiErrorBody;
  if (!res.ok) {
    setMyPageMessage(formatApiMessage(data), true);
    return;
  }
  if ('accessToken' in data && typeof data.accessToken === 'string') {
    const rt = (data as { refreshToken?: string }).refreshToken;
    if (typeof rt === 'string') persistAuthTokens(data.accessToken, rt);
    else {
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      scheduleAccessTokenExpiryWarning();
    }
  }
  if ('user' in data && data.user) {
    currentUser = data.user;
    fillMyPageForm(data.user);
    const u = getEl<HTMLSpanElement>('user-email');
    u.textContent = data.user.loginId;
    u.title = data.user.email;
    getEl('btn-account-loginid').textContent = `아이디: ${data.user.loginId}`;
  }
  setMyPageMessage(
    'message' in data && typeof data.message === 'string'
      ? data.message
      : '마이페이지 정보가 수정되었습니다.',
  );
});

function formatApiMessage(data: ApiErrorBody): string {
  if (typeof data.message === 'string') return data.message;
  if (Array.isArray(data.message)) return data.message.join(', ');
  return '요청을 처리하지 못했습니다.';
}

getEl<HTMLButtonElement>('btn-logout').addEventListener('click', () => {
  closeAccountMenu();
  clearAuthTokens();
  revokePreviews();
  setMyPageMessage('');
  showAuth();
});

getEl<HTMLButtonElement>('btn-new-folder').addEventListener('click', () => {
  openNewFolderModal();
});

getEl<HTMLButtonElement>('btn-new-folder-modal-close').addEventListener('click', () => {
  closeNewFolderModal();
});
getEl<HTMLButtonElement>('btn-new-folder-cancel').addEventListener('click', () => {
  closeNewFolderModal();
});
getEl<HTMLButtonElement>('new-folder-modal-backdrop').addEventListener('click', () => {
  closeNewFolderModal();
});

getEl<HTMLFormElement>('form-new-folder').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = getEl<HTMLInputElement>('new-folder-name').value.trim();
  const errEl = getEl<HTMLParagraphElement>('new-folder-error');
  if (!name) {
    errEl.textContent = '폴더 이름을 입력해 주세요.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.textContent = '';
  errEl.classList.add('hidden');
  let folderParentId = currentParentId;
  if ((currentSection === 'docs' || currentSection === 'images') && !folderParentId) {
    folderParentId =
      currentSection === 'images' ? sectionRootIds.images : sectionRootIds.docs;
  }
  if ((currentSection === 'docs' || currentSection === 'images') && !folderParentId) {
    errEl.textContent = '문서·이미지 영역을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.';
    errEl.classList.remove('hidden');
    return;
  }
  const body: { name: string; parentId?: string } = {
    name,
  };
  if (folderParentId) body.parentId = folderParentId;
  const res = await fetch('/api/drive/folders', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    errEl.textContent = formatApiMessage(err);
    errEl.classList.remove('hidden');
    return;
  }
  closeNewFolderModal();
  await loadItems();
});

getEl<HTMLButtonElement>('btn-rename-modal-close').addEventListener('click', () => {
  closeRenameModal();
});
getEl<HTMLButtonElement>('btn-rename-cancel').addEventListener('click', () => {
  closeRenameModal();
});
getEl<HTMLButtonElement>('rename-modal-backdrop').addEventListener('click', () => {
  closeRenameModal();
});

getEl<HTMLFormElement>('form-rename-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!renameTargetItem) return;
  let name = getEl<HTMLInputElement>('rename-item-name').value.trim();
  const errEl = getEl<HTMLParagraphElement>('rename-item-error');
  if (!name) {
    errEl.textContent = '이름을 입력해 주세요.';
    errEl.classList.remove('hidden');
    return;
  }
  if (renameTargetItem.type === 'FILE' && renameFileExtensionSuffix) {
    name = name.replace(/\.+$/, '') + renameFileExtensionSuffix;
  }
  errEl.textContent = '';
  errEl.classList.add('hidden');
  const res = await fetch(`/api/drive/items/${renameTargetItem.id}/rename`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    errEl.textContent = formatApiMessage(err);
    errEl.classList.remove('hidden');
    return;
  }
  const renamedId = renameTargetItem.id;
  if (renamedId === sectionRootIds.docs) {
    sectionRootLabels = { ...sectionRootLabels, docs: name };
  } else if (renamedId === sectionRootIds.images) {
    sectionRootLabels = { ...sectionRootLabels, images: name };
  }
  closeRenameModal();
  updatePathStackName(renamedId, name);
  await loadItems();
});

getEl<HTMLInputElement>('input-upload').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const isImage = file.type.startsWith('image/');
  if (currentSection === 'images' && !isImage) {
    showNoticeModal('이미지 페이지에서는 이미지 파일만 업로드할 수 있습니다.');
    input.value = '';
    return;
  }
  const uploadSection: 'docs' | 'images' =
    currentSection === 'images'
      ? 'images'
      : currentSection === 'docs'
        ? 'docs'
        : currentSection === 'home'
          ? isImage
            ? 'images'
            : 'docs'
          : 'docs';
  let uploadParentId = currentParentId;
  if (!uploadParentId && currentSection !== 'home') {
    if (uploadSection === 'images' && sectionRootIds.images) {
      uploadParentId = sectionRootIds.images;
    } else if (uploadSection === 'docs' && sectionRootIds.docs) {
      uploadParentId = sectionRootIds.docs;
    }
  }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('section', uploadSection);
  if (uploadParentId) fd.append('parentId', uploadParentId);
  const res = await fetch('/api/drive/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: fd,
  });
  input.value = '';
  if (tryHandleUnauthorized(res)) return;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiErrorBody;
    showNoticeModal(formatApiMessage(err) || '업로드에 실패했습니다.');
    return;
  }
  await loadItems();
});

getEl<HTMLButtonElement>('btn-move-modal-close').addEventListener('click', () => {
  closeMoveModal();
});
getEl<HTMLButtonElement>('btn-move-modal-cancel').addEventListener('click', () => {
  closeMoveModal();
});
getEl<HTMLButtonElement>('move-modal-backdrop').addEventListener('click', () => {
  closeMoveModal();
});
getEl<HTMLButtonElement>('btn-move-modal-confirm').addEventListener('click', () => {
  void completeMoveToSelectedFolder();
});

getEl<HTMLButtonElement>('btn-delete-modal-close').addEventListener('click', () => {
  closeDeleteModal();
});
getEl<HTMLButtonElement>('btn-delete-cancel').addEventListener('click', () => {
  closeDeleteModal();
});
getEl<HTMLButtonElement>('delete-modal-backdrop').addEventListener('click', () => {
  closeDeleteModal();
});
getEl<HTMLButtonElement>('btn-delete-confirm').addEventListener('click', () => {
  void confirmDeleteItem();
});

getEl<HTMLButtonElement>('btn-empty-trash').addEventListener('click', () => {
  openEmptyTrashModal();
});

getEl<HTMLButtonElement>('btn-withdraw-modal-close').addEventListener('click', () => {
  closeWithdrawModal();
});
getEl<HTMLButtonElement>('btn-withdraw-cancel').addEventListener('click', () => {
  closeWithdrawModal();
});
getEl<HTMLButtonElement>('withdraw-modal-backdrop').addEventListener('click', () => {
  closeWithdrawModal();
});
getEl<HTMLButtonElement>('btn-withdraw-confirm').addEventListener('click', () => {
  void confirmWithdraw();
});

getEl<HTMLButtonElement>('btn-notice-modal-close').addEventListener('click', () => {
  closeNoticeModal();
});
getEl<HTMLButtonElement>('notice-modal-backdrop').addEventListener('click', () => {
  closeNoticeModal();
});
getEl<HTMLButtonElement>('btn-notice-confirm').addEventListener('click', () => {
  closeNoticeModal();
});

getEl<HTMLButtonElement>('btn-session-renew-accept').addEventListener('click', () => {
  void acceptSessionRenewal();
});
getEl<HTMLButtonElement>('btn-session-renew-decline').addEventListener('click', () => {
  declineSessionRenewal();
});
getEl<HTMLButtonElement>('btn-session-renew-close').addEventListener('click', () => {
  declineSessionRenewal();
});
getEl<HTMLButtonElement>('session-renew-modal-backdrop').addEventListener('click', () => {
  declineSessionRenewal();
});

void (async function init(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showAuth();
    return;
  }
  const res = await fetch('/api/auth/me', { headers: authHeaders() });
  if (tryHandleUnauthorized(res)) return;
  const user = (await res.json()) as UserDto;
  await openDriveForUser(user);
  scheduleAccessTokenExpiryWarning();
})();
