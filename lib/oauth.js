// Google / Apple 로그인 (OAuth 2.0 Authorization Code 흐름).
//
// 라이브러리를 쓰지 않고 직접 구현한다. 흐름 자체가 짧고, 의존성이
// 늘면 배포와 보안 갱신이 같이 늘기 때문이다.
//
// 환경변수가 없는 제공자는 자동으로 꺼진다. Google 만 설정해도 그대로 쓸 수 있다.

import { createSign, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- 설정

export function readProviders(env) {
  const providers = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      label: 'Google',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // *_AUTH_URL / *_TOKEN_URL 은 시험용 구멍이다. 진짜 계정 없이
      // 흐름을 끝까지 돌려 보려고 가짜 제공자를 붙일 때만 쓴다.
      // 평소에는 지정하지 않는다.
      authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      scope: 'openid',
      // Google 은 콜백을 GET 으로 보낸다
      callbackMethod: 'get'
    };
  }

  // Apple 은 클라이언트 비밀이 고정 문자열이 아니라 서명한 JWT 다.
  // 그래서 키 파일(.p8)과 팀/키 식별자가 함께 필요하다.
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) {
    providers.apple = {
      label: 'Apple',
      clientId: env.APPLE_CLIENT_ID,
      teamId: env.APPLE_TEAM_ID,
      keyId: env.APPLE_KEY_ID,
      privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      authUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      scope: 'name email',
      // Apple 은 response_mode=form_post 로 POST 콜백을 보낸다
      callbackMethod: 'post'
    };
  }

  return providers;
}

// ---------------------------------------------------------------- JWT

// id_token 은 Google/Apple 의 토큰 엔드포인트에서 TLS 로 직접 받아 온 것이라
// 서명을 다시 검증하지 않아도 안전하다. 중간에 낄 사람이 없기 때문이다.
// (브라우저에서 건네받은 토큰이라면 반드시 서명을 검증해야 한다.)
export function decodeJwtPayload(token) {
  const part = String(token ?? '').split('.')[1];
  if (!part) throw new Error('id_token 형식이 올바르지 않습니다.');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// Apple 의 클라이언트 비밀 = ES256 으로 서명한 짧은 수명의 JWT.
// 최대 6개월까지 쓸 수 있지만, 요청할 때마다 새로 만드는 편이 관리가 편하다.
function appleClientSecret(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const payload = {
    iss: cfg.teamId,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: cfg.clientId
  };

  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  // Apple 은 JWT 규격대로 r||s 를 이어 붙인 형태를 원한다.
  // 기본값인 DER 로 서명하면 거부당한다.
  const signature = signer.sign({ key: cfg.privateKey, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${signature.toString('base64url')}`;
}

// ---------------------------------------------------------------- 흐름

export function buildAuthUrl(name, cfg, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state
  });
  if (name === 'apple') params.set('response_mode', 'form_post');
  if (name === 'google') params.set('prompt', 'select_account');
  return `${cfg.authUrl}?${params}`;
}

// 인가 코드를 토큰으로 바꾸고, 제공자쪽 사용자 ID 를 꺼낸다.
export async function exchangeCode(name, cfg, code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: name === 'apple' ? appleClientSecret(cfg) : cfg.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `토큰 교환 실패 (HTTP ${res.status})`);
  }
  if (!data.id_token) throw new Error('id_token 이 없습니다.');

  const claims = decodeJwtPayload(data.id_token);
  if (!claims.sub) throw new Error('사용자 식별자가 없습니다.');

  // aud 가 우리 앱이 맞는지 확인한다. 다른 앱용 토큰을 흘려 넣는 걸 막는다.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new Error('다른 앱을 위한 토큰입니다.');

  return { providerId: String(claims.sub) };
}

// ---------------------------------------------------------------- CSRF

// state 는 "이 콜백이 정말 내가 시작한 로그인인가"를 확인하는 값이다.
// 브라우저에 쿠키로 심어 두고 콜백에서 대조한다. 없으면 남이 만든
// 로그인 링크를 눌러 남의 계정으로 로그인되는 일이 생긴다.
export function issueState(res, secure) {
  const state = randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: STATE_TTL_MS,
    path: '/'
  });
  return state;
}

export function consumeState(req, res, given) {
  const saved = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });

  if (!saved || !given) return false;
  const a = Buffer.from(saved);
  const b = Buffer.from(String(given));
  return a.length === b.length && timingSafeEqual(a, b);
}

export { STATE_COOKIE };
