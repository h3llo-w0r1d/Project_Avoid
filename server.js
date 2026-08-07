import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import cookieParser from 'cookie-parser';
import { openDatabase } from './lib/db.js';
import { importScoresJson, openScoreStore } from './lib/scores.js';
import { importUsersJson, openUserStore } from './lib/users.js';
import { importMatchesJson, openMatchStore } from './lib/matches.js';
import { attachAuth } from './lib/auth-routes.js';
import { attachLobby } from './lib/lobby.js';
import { GUEST_PATTERN } from './public/js/profanity.js';
import { msLeftInSeason, seasonName, seasonOf } from './lib/season.js';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || join(root, 'data');

// DATA_DIR 을 지정하면 그쪽에 저장한다 (영구 디스크 마운트용).
//
// 세 저장소가 데이터베이스 한 채를 나눠 쓴다. 파일을 따로 두면 한 판이
// 끝날 때 세 파일을 각각 열고 닫아야 하고, 백업도 셋을 맞춰 떠야 한다.
const db = await openDatabase(DATA_DIR);

// 예전 JSON 파일이 남아 있으면 한 번만 옮긴다.
// 옮긴 원본은 .imported 로 이름만 바꿔 둔다 — 지우지 않는다.
{
  const moved = {
    기록: await importScoresJson(db, DATA_DIR),
    계정: await importUsersJson(db, DATA_DIR),
    대전: await importMatchesJson(db, DATA_DIR)
  };
  const some = Object.entries(moved).filter(([, n]) => n > 0);
  if (some.length) {
    console.log('예전 JSON 을 데이터베이스로 옮겼습니다: ' +
      some.map(([k, n]) => `${k} ${n}건`).join(' · '));
  }
}

const scores = await openScoreStore(DATA_DIR, db);

// 관리 화면 열쇠.
// 환경변수가 우선. 없으면 만들어서 data/ 에 적어 두고 다음 실행에 다시 쓴다.
// 매번 새로 만들면 서버를 켤 때마다 열쇠가 바뀌어 쓰기 불편하다.
// data/ 는 .gitignore 에 들어 있어서 저장소에 올라가지 않는다.
const { token: ADMIN_TOKEN, source: TOKEN_SOURCE } = await resolveAdminToken();

async function resolveAdminToken() {
  if (process.env.ADMIN_TOKEN) {
    return { token: process.env.ADMIN_TOKEN, source: 'env' };
  }
  const file = join(DATA_DIR, 'admin-token.txt');
  try {
    const saved = (await readFile(file, 'utf8')).trim();
    if (saved) return { token: saved, source: 'file' };
  } catch {
    // 아직 없으면 새로 만든다
  }
  const token = randomBytes(12).toString('hex');
  await writeFile(file, token, 'utf8');
  return { token, source: 'new' };
}

const users = await openUserStore(DATA_DIR, db);
const matchLog = await openMatchStore(DATA_DIR, db);

const app = express();
app.use(express.json({ limit: '4kb' }));
app.use(cookieParser());

// 로그인 라우트를 먼저 붙인다. 여기서 req.user 를 채워 줘야
// 아래 랭킹 API 가 "누가 올린 기록인지" 알 수 있다.
const auth = attachAuth(app, users, { port: PORT });

// 약관 문서들. 구글 로그인 심사에서 이 주소를 요구하고, 거기 적는 주소는
// 확장자 없이 깔끔한 편이 낫다. 파일은 public/ 아래 html 하나씩이다.
for (const page of ['privacy', 'terms']) {
  app.get(`/${page}`, (req, res) => res.sendFile(join(root, 'public', `${page}.html`)));
}

// 벤더링한 three.js 는 거의 안 바뀌므로 길게 캐시한다.
app.use('/js/vendor', express.static(join(root, 'public', 'js', 'vendor'), { maxAge: '7d' }));

// 나머지(게임 코드·HTML·CSS)는 매번 서버에 물어보게 한다.
// max-age 를 걸면 브라우저가 그 시간 동안 재확인조차 안 해서,
// 코드를 고치고 새로고침해도 옛날 파일이 계속 돌아간다.
// ETag 가 있으니 안 바뀌었으면 304 만 오고 본문은 다시 안 받는다.
app.use(express.static(join(root, 'public'), { etag: true, maxAge: 0, cacheControl: true }));

// 화면에서 10개씩 10쪽으로 나눠 보여 준다.
const TOP_N = 100;

// 내 최고 기록이 몇 위인지. 로그인했으면 계정으로, 게스트면 이름으로 찾는다.
// 100위 밖이면 목록에 안 나오므로 이 값으로 따로 알려 준다.
function myBest(req) {
  if (req.user) return scores.bestOf({ userId: req.user.id });
  const name = typeof req.query.name === 'string' ? req.query.name : null;
  return name ? scores.bestOf({ name }) : null;
}

// 지금이 어느 시즌이고 언제 끝나는지. 화면 맨 위에 보여 준다.
function seasonInfo() {
  const key = seasonOf();
  return { key, name: seasonName(key), msLeft: msLeftInSeason() };
}

app.get('/api/scores', async (req, res) => {
  // 달이 바뀌었으면 지난 시즌 기록을 명예의 전당으로 옮긴다.
  // 서버가 그 순간에 떠 있으리란 보장이 없어, 물어볼 때 확인한다.
  await scores.rollSeasons();
  res.json({ top: scores.top(TOP_N), me: myBest(req), season: seasonInfo() });
});

// 지난 시즌들의 상위권
app.get('/api/hall', async (req, res) => {
  await scores.rollSeasons();
  res.json({ seasons: scores.hallOfFame().map((h) => ({ ...h, name: seasonName(h.season) })) });
});

// 대전 랭킹 — 다승과 승률.
//
// 승률은 최소 판수를 넘긴 사람만 올린다. 안 그러면 한 판 이기고
// 100% 로 1위가 된다. 랭킹이 그 순간 의미를 잃는다.
//
// 초반에는 낮게 잡아야 한다. 한 판이 2~3분이라 100판이면 서너 시간이고,
// 사람이 붙기 전에는 아무도 못 채워서 탭이 계속 비어 있게 된다.
// 사람이 늘면 올리면 된다.
const MIN_RATE_GAMES = 15;

// 내 순위는 목록에서 찾지 않고 따로 센다. 목록을 통째로 받아 훑으면
// 계정이 늘수록 느려진다 — 100개만 필요한데 수만 개를 만들게 된다.
const placeOf = (board, userId, minGames = 0) =>
  (userId ? users.rankIn(board, userId, minGames) : null);

app.get('/api/versus-ranks', (req, res) => {
  const me = req.user?.id ?? null;

  res.json({
    minGames: MIN_RATE_GAMES,
    season: seasonInfo(),
    wins: { top: users.winRanking(TOP_N), me: placeOf('wins', me) },
    rate: { top: users.rateRanking(MIN_RATE_GAMES, TOP_N), me: placeOf('rate', me, MIN_RATE_GAMES) },
    streak: { top: users.streakRanking(TOP_N), me: placeOf('streak', me) }
  });
});

// 한 사람의 기록 모음. 랭킹에서 이름을 누르면 이걸 보여 준다.
//
// 계정과 게스트를 같은 통로로 다룬다. 게스트는 계정이 없으니 대전 전적이
// 없고, 버틴 기록만 있다. 이름은 계정끼리 겹칠 수 없고 게스트는 Guest####
// 형식만 쓸 수 있어서, 이름 하나로 사람을 특정할 수 있다.
app.get('/api/profile', (req, res) => {
  const name = String(req.query.name ?? '').trim();
  if (!name) return res.status(400).json({ error: '이름이 필요합니다.' });

  const user = users.byNickname(name);
  const best = scores.bestOf({ name });

  const profile = {
    name: user?.nickname ?? name,
    account: !!user,
    season: seasonInfo(),
    best: best ? { time: best.time, rank: best.rank } : null
  };

  if (user) {
    const pub = users.publicUser(user);
    const games = pub.seasonWins + pub.seasonLosses;
    profile.versus = {
      wins: pub.seasonWins,
      losses: pub.seasonLosses,
      games,
      rate: games > 0 ? pub.seasonWins / games : null,
      streak: pub.streak,
      bestStreak: pub.bestStreak,
      totalWins: pub.wins,
      totalLosses: pub.losses,
      // 각 랭킹에서 몇 위인지
      winRank: placeOf('wins', user.id)?.rank ?? null,
      rateRank: placeOf('rate', user.id, MIN_RATE_GAMES)?.rank ?? null,
      streakRank: placeOf('streak', user.id)?.rank ?? null,
      minGames: MIN_RATE_GAMES
    };
  }

  res.json(profile);
});

// 아주 단순한 IP 단위 레이트 리밋 — 같은 IP가 기록을 도배하는 것만 막는다.
const lastPost = new Map();
const POST_COOLDOWN_MS = 1500;

app.post('/api/scores', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';
  const now = Date.now();
  if (now - (lastPost.get(ip) || 0) < POST_COOLDOWN_MS) {
    return res.status(429).json({ error: '너무 빠릅니다. 잠시 후 다시 시도하세요.' });
  }
  lastPost.set(ip, now);

  const { name, time } = req.body ?? {};

  const t = Number(time);
  // 상한 3600초 — 실수로든 조작으로든 말도 안 되는 값이 들어오는 걸 막는다.
  if (!Number.isFinite(t) || t < 1 || t > 3600) {
    return res.status(400).json({ error: '기록 값이 올바르지 않습니다.' });
  }

  // 로그인했으면 계정 닉네임을 쓴다. 브라우저가 보낸 이름은 무시한다.
  // 안 그러면 로그인한 채로 남의 이름을 사칭해 기록을 올릴 수 있다.
  let finalName;
  if (req.user) {
    // 로그인은 했는데 닉네임을 아직 안 정한 경우. 게스트 경로로 흘려보내면
    // 로그인한 채로 아무 이름이나 붙일 수 있게 되므로 여기서 막는다.
    if (!req.user.nickname) {
      return res.status(400).json({ error: '닉네임을 먼저 정해 주세요.' });
    }
    finalName = req.user.nickname;
  } else {
    // 게스트는 Guest0000 형식만 쓸 수 있다. 아무 이름이나 허용하면
    // 로그인한 사람의 닉네임을 그대로 적어 랭킹에서 사칭할 수 있다.
    if (!GUEST_PATTERN.test(String(name ?? ''))) {
      return res.status(400).json({ error: '게스트 이름 형식이 아닙니다.' });
    }
    finalName = name;
  }

  try {
    await scores.rollSeasons();
    const entry = await scores.add(finalName, Math.round(t * 100) / 100, req.user?.id ?? null);
    res.json({
      id: entry.id,
      rank: scores.rankOf(entry.id),
      top: scores.top(TOP_N),
      me: scores.bestOf(req.user ? { userId: req.user.id } : { name: finalName }),
      season: seasonInfo()
    });
  } catch (err) {
    console.error('기록 저장 실패:', err);
    res.status(500).json({ error: '서버에 기록을 저장하지 못했습니다.' });
  }
});

// ---------------------------------------------------------------- 관리

// 관리자를 가리는 방법이 둘이다.
//
//   1. 열쇠(ADMIN_TOKEN)  — /admin.html 이 쓴다. 로그인 없이 들어간다.
//   2. 로그인한 계정       — 게임 안 관리 창이 쓴다.
//
// 누가 관리자인지는 .env 로 정한다. 코드에 계정을 박아 두면 저장소에
// 남고, 관리자를 바꿀 때마다 배포해야 한다.
//
//   ADMIN_USER_IDS=<계정 id>,<계정 id>     (안전. 닉네임을 바꿔도 유지된다)
//   ADMIN_NICKNAMES=admin                  (쉽다. 닉네임을 바꾸면 끊긴다)
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '')
  .split(',').map((v) => v.trim()).filter(Boolean);
const ADMIN_NICKS = (process.env.ADMIN_NICKNAMES ?? '')
  .split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);

function isAdminUser(user) {
  if (!user) return false;
  if (ADMIN_IDS.includes(user.id)) return true;
  return !!user.nickname && ADMIN_NICKS.includes(user.nickname.toLowerCase());
}

// 열쇠는 길이가 달라도 같은 시간이 걸리게 비교한다.
// 그냥 === 로 비교하면 앞에서 몇 글자가 맞았는지가 응답 시간에 새어 나온다.
function tokenMatches(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (tokenMatches(req.get('x-admin-token')) || isAdminUser(req.user)) return next();
  res.status(401).json({ error: '관리자만 쓸 수 있습니다.' });
}

// 게임 화면이 관리 버튼을 그릴지 정하는 데 쓴다. 관리자가 아니면 그냥 false.
app.get('/api/admin/me', (req, res) => {
  res.json({ admin: isAdminUser(req.user) });
});

// 관리 창을 한 번에 채운다
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  res.json({
    season: seasonInfo(),
    online: lobby.stats(),
    scores: scores.all(),
    accounts: users.listAccounts()
  });
});

// 한 계정의 대전 기록. 부정행위가 의심될 때 근거를 본다.
//
// 승패 숫자만으로는 판단할 수 없다. 누구와 몇 초 동안 했는지가 남아야
// "한 사람과만 계속 붙어 3초 만에 이겼다" 같은 게 눈에 보인다.
app.get('/api/admin/matches', requireAdmin, (req, res) => {
  const id = String(req.query.user ?? '').trim();
  if (!id) return res.status(400).json({ error: '계정을 지정해 주세요.' });
  const user = users.byId(id);
  if (!user) return res.status(404).json({ error: '없는 계정입니다.' });
  res.json({ name: user.nickname, ...matchLog.historyOf(id) });
});

// 계정 전적 초기화. 계정과 닉네임은 남긴다.
app.post('/api/admin/users/:id/reset', requireAdmin, async (req, res) => {
  try {
    const updated = await users.resetRecord(req.params.id);
    if (!updated) return res.status(404).json({ error: '없는 계정입니다.' });
    res.json({ ok: true, user: updated });
  } catch (err) {
    console.error('전적 초기화 실패:', err);
    res.status(500).json({ error: '초기화에 실패했습니다.' });
  }
});

// 전체 기록 (등록 시각 포함)
app.get('/api/admin/scores', requireAdmin, (req, res) => {
  res.json(scores.all());
});

// 기록 하나 삭제
app.delete('/api/admin/scores/:id', requireAdmin, async (req, res) => {
  try {
    const removed = await scores.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: '이미 없는 기록입니다.' });
    res.json({ ok: true, left: scores.size });
  } catch (err) {
    console.error('기록 삭제 실패:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 전체 비우기. 실수로 눌리지 않게 DELETE 가 아니라 POST 로 받고,
// 본문에 확인 문구까지 있어야 실행한다.
app.post('/api/admin/scores/clear', requireAdmin, async (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL') {
    return res.status(400).json({ error: '확인 문구가 필요합니다.' });
  }
  try {
    const removed = await scores.clear();
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('전체 삭제 실패:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

app.get('/api/online', (req, res) => {
  res.json(lobby.stats());
});

const httpServer = app.listen(PORT, () => {
  console.log(`AvoidArc 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`1v1 대전 → ws://localhost:${PORT}/ws`);
  console.log(`관리 화면 → http://localhost:${PORT}/admin.html`);
  if (TOKEN_SOURCE === 'env') {
    console.log('관리자 열쇠: 환경변수 ADMIN_TOKEN 사용 중');
  } else {
    console.log(`관리자 열쇠: ${ADMIN_TOKEN}`);
    if (TOKEN_SOURCE === 'new') console.log('  (새로 만들어 data/admin-token.txt 에 저장했습니다)');
  }
});

// 1v1 은 같은 HTTP 서버에 WebSocket 으로 얹는다.
// 포트를 따로 쓰면 배포할 때 프록시 설정이 하나 더 늘어난다.
const lobby = attachLobby(httpServer, users, matchLog);
