// 로그인 관련 라우트.
//
//   GET  /api/auth/providers   켜져 있는 로그인 수단
//   GET  /auth/:name           로그인 시작 (제공자로 보낸다)
//   GET|POST /auth/:name/callback  제공자가 돌려보내는 지점
//   GET  /api/me               지금 로그인한 사람
//   POST /api/me/nickname      닉네임 정하기
//   POST /api/logout

import express from 'express';
import { checkNickname } from '../public/js/profanity.js';
import { buildAuthUrl, consumeState, exchangeCode, issueState, readProviders } from './oauth.js';
import { SESSION_DAYS } from './users.js';

const SESSION_COOKIE = 'session';

export function attachAuth(app, users, options = {}) {
  const providers = readProviders(process.env);
  // 배포 주소. Apple 은 https 가 아니면 아예 받아 주지 않는다.
  const baseUrl = (process.env.BASE_URL || `http://localhost:${options.port ?? 3000}`).replace(/\/$/, '');
  const secure = baseUrl.startsWith('https://');

  const redirectUri = (name) => `${baseUrl}/auth/${name}/callback`;

  const setSession = (res, token) => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,           // 자바스크립트가 못 읽는다 → XSS 로 훔쳐가지 못한다
      sameSite: 'lax',
      secure,
      maxAge: SESSION_DAYS * 86400_000,
      path: '/'
    });
  };

  // 모든 요청에 현재 사용자를 붙여 둔다
  app.use((req, res, next) => {
    req.user = users.userForToken(req.cookies?.[SESSION_COOKIE]) ?? null;
    next();
  });

  // 어떤 로그인 수단이 켜져 있는지. 클라이언트는 이걸 보고 버튼을 그린다.
  app.get('/api/auth/providers', (req, res) => {
    res.json(Object.entries(providers).map(([name, cfg]) => ({ name, label: cfg.label })));
  });

  app.get('/auth/:name', (req, res) => {
    const name = req.params.name;
    const cfg = providers[name];
    if (!cfg) return res.status(404).send('그 로그인 수단은 켜져 있지 않습니다.');

    const state = issueState(res, secure);
    res.redirect(buildAuthUrl(name, cfg, redirectUri(name), state));
  });

  // Apple 은 form_post 로 POST 하고 Google 은 GET 으로 온다. 둘 다 받는다.
  const callback = async (req, res) => {
    const name = req.params.name;
    const cfg = providers[name];
    if (!cfg) return res.status(404).send('그 로그인 수단은 켜져 있지 않습니다.');

    const source = req.method === 'POST' ? req.body : req.query;

    if (source.error) return fail(res, '로그인이 취소되었습니다.');
    if (!consumeState(req, res, source.state)) {
      return fail(res, '로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.');
    }
    if (!source.code) return fail(res, '인가 코드가 없습니다.');

    try {
      const { providerId } = await exchangeCode(name, cfg, source.code, redirectUri(name));
      const user = await users.upsert(name, providerId);
      const session = await users.createSession(user.id);
      setSession(res, session.token);
      // 닉네임이 없으면 정하는 화면으로, 있으면 그냥 게임으로
      res.redirect(user.nickname ? '/' : '/?setup=1');
    } catch (err) {
      console.error(`${name} 로그인 실패:`, err);
      fail(res, '로그인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
    }
  };

  app.get('/auth/:name/callback', callback);
  // Apple 의 form_post 를 받으려면 폼 파서가 필요하다
  app.post('/auth/:name/callback', express.urlencoded({ extended: false }), callback);

  app.get('/api/me', (req, res) => {
    res.json(req.user ? users.publicUser(req.user) : null);
  });

  app.post('/api/me/nickname', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const result = checkNickname(req.body?.nickname);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    if (result.name === '익명') {
      return res.status(400).json({ error: '닉네임을 입력해 주세요.' });
    }
    if (users.nicknameTaken(result.name, req.user.id)) {
      return res.status(409).json({ error: '이미 쓰고 있는 닉네임입니다.' });
    }

    const updated = await users.setNickname(req.user.id, result.name);
    // 이미 올려 둔 기록의 이름도 같이 바꾼다. 안 하면 랭킹에는 옛 이름이,
    // 프로필에는 새 이름이 떠서 같은 사람이 둘로 보인다.
    // 옛 이름도 같이 넘긴다 — 바꾸고 나면 어디서도 알 수 없다.
    // req.user 는 요청을 받을 때 읽은 값이라 아직 바뀌기 전 이름이다.
    options.onRename?.(req.user.id, result.name, req.user.nickname ?? null);
    res.json(users.publicUser(updated));
  });

  app.post('/api/logout', async (req, res) => {
    await users.destroySession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return { providers, baseUrl };
}

// 로그인 실패는 API 가 아니라 브라우저 이동이라, 화면으로 돌려보내며 알린다
function fail(res, message) {
  res.redirect(`/?authError=${encodeURIComponent(message)}`);
}

export { SESSION_COOKIE };
