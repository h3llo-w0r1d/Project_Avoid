// 서버가 플레이어에게 보내는 문구(오류·안내)를 두 언어로 낸다.
//
// 사전은 public/js/strings.js 와 모양(ko/en)만 같을 뿐 서로 다른 파일이다
// — 클라 사전은 화면(브라우저)용, 이건 서버(API 응답)용이다. 클라 사전을
// 그대로 가져다 쓰면 서버가 브라우저 전용 문구(예: 상점·설정 창)까지
// 번들에 안고 있게 된다.
//
// 언어를 고르는 순서: 쿠키(lang) → Accept-Language 헤더 → 기본 en.
// 관리자 전용 라우트는 이 함수를 쓰지 않고 한국어 문구를 그대로 둔다
// (관리자는 한 사람이고, 화면 언어 토글과 무관하게 늘 한국어를 본다).
import { STRINGS } from './strings.js';

export function langOf(req) {
  const cookie = req.cookies?.lang;
  if (cookie === 'ko' || cookie === 'en') return cookie;
  const accept = req.headers?.['accept-language'] ?? '';
  return accept.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function t(req, key, vars) {
  const text = STRINGS[key]?.[langOf(req)] ?? STRINGS[key]?.ko ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
