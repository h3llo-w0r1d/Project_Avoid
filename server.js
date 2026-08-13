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
import { createTickets } from './lib/tickets.js';
import { openStatsStore } from './lib/stats.js';
import { isBot } from './lib/bots.js';
import { openBoardStore } from './lib/board.js';
import { openPlaysStore } from './lib/plays.js';
import { openPresence } from './lib/presence.js';
import { GUEST_PATTERN, checkMessage } from './public/js/profanity.js';
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

// 혼자 하기 기록이 진짜인지 최소한이라도 확인하는 표. 메모리에만 둔다 —
// 서버를 다시 켜면 진행 중이던 판의 기록은 못 올린다. 대신 표가 새는 일도 없다.
const runTickets = createTickets();

// 날짜별 이용 현황. 누가 왔는지는 안 적고 횟수만 센다.
const stats = openStatsStore(db);

// 자유 게시판.
const board = openBoardStore(db);

// 모든 판 기록(플레이 로그). 최고 기록만 남기는 scores 와 별개다.
const plays = openPlaysStore(db);

// 지금 사이트에 몇 명이 있는지(실시간 접속). 메모리에만 두고 저장 안 한다.
const presence = openPresence();
const matchLog = await openMatchStore(DATA_DIR, db);

const app = express();
// 무엇으로 만들었는지 알려 줄 이유가 없다. 알려 주면 그 버전에 알려진
// 약점을 골라 찔러 보기 쉬워진다.
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use(cookieParser());

// 로그인 라우트를 먼저 붙인다. 여기서 req.user 를 채워 줘야
// 아래 랭킹 API 가 "누가 올린 기록인지" 알 수 있다.
const auth = attachAuth(app, users, {
  port: PORT,
  // 닉네임을 바꾸면 이미 올려 둔 기록의 이름도 따라가야 한다.
  onRename: (userId, name) => scores.renameUser(userId, name)
});

// 관리 대시보드. 관리자 계정으로 로그인했을 때만 페이지 자체를 내준다.
// 아무나 주소를 쳐도 관리자가 아니면 홈으로 튕긴다. 데이터 API 는 이미
// requireAdmin 이 막고 있지만, 페이지까지 막아 두면 남에게 존재조차 안 보인다.
app.get('/admin', (req, res) => {
  if (!isAdminUser(req.user)) return res.redirect('/');
  res.sendFile(join(root, 'public', 'admin-dashboard.html'));
});

// PWA 파일. 서비스워커는 절대 오래 캐시하면 안 된다 — 브라우저가 옛 워커를
// 계속 쓰면 업데이트가 영영 안 먹는다. 매번 확인하게 no-cache 로 준다.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(join(root, 'public', 'sw.js'));
});
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(join(root, 'public', 'manifest.webmanifest'));
});

// 게임 화면을 연 횟수를 센다. 방침·약관 페이지는 세지 않는다.
//
// 정적 파일 미들웨어보다 먼저 놓아야 한다. 뒤에 놓으면 express.static 이
// 파일을 내주고 끝내 버려서 여기까지 오지 않는다.
app.get(['/', '/index.html'], (req, res, next) => {
  // 봇·크롤러·스캐너는 방문으로 세지 않는다(집계를 부풀린다).
  if (!isBot(req.get('user-agent'))) stats.visit();
  next();
});

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

const clientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';

// 혼자 하기를 시작할 때 표를 하나 내준다. 기록을 올릴 때 이 표가 있어야
// 하고, 표를 받은 뒤 실제로 흐른 시간보다 긴 기록은 거절된다.
app.post('/api/run/start', (req, res) => {
  stats.runStarted();
  res.json({ ticket: runTickets.issue(clientIp(req), req.user?.id ?? null) });
});

app.post('/api/scores', async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  if (now - (lastPost.get(ip) || 0) < POST_COOLDOWN_MS) {
    return res.status(429).json({ error: '너무 빠릅니다. 잠시 후 다시 시도하세요.' });
  }
  lastPost.set(ip, now);

  const { name, time, ticket } = req.body ?? {};

  const t = Number(time);
  // 상한 3600초 — 실수로든 조작으로든 말도 안 되는 값이 들어오는 걸 막는다.
  if (!Number.isFinite(t) || t < 1 || t > 3600) {
    return res.status(400).json({ error: '기록 값이 올바르지 않습니다.' });
  }

  // 값을 먼저 보고 표를 본다. 표는 한 번 쓰면 버려지므로, 어차피 거절할
  // 요청 때문에 멀쩡한 표를 태우지 않는다.
  const check = runTickets.redeem(String(ticket ?? ''), t, { ip, userId: req.user?.id ?? null });
  if (check.error) return res.status(400).json({ error: check.error });

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
    const seconds = Math.round(t * 100) / 100;
    const entry = await scores.add(finalName, seconds, req.user?.id ?? null);
    stats.runFinished(t);
    // 최고 기록과 별개로, 이 판 자체를 로그에 남긴다.
    plays.add({ name: finalName, seconds, userId: req.user?.id ?? null });
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

// ---------------------------------------------------------------- 게시판

// 로그인했으면 계정 닉네임을, 게스트면 Guest#### 형식만 허용한다.
// 기록 올리기와 같은 규칙 — 로그인한 채로 남의 이름을 사칭하지 못하게.
function posterName(req, name) {
  if (req.user) {
    if (!req.user.nickname) return { error: '닉네임을 먼저 정해 주세요.' };
    return { name: req.user.nickname };
  }
  if (!GUEST_PATTERN.test(String(name ?? ''))) {
    return { error: '게스트 이름 형식이 아닙니다.' };
  }
  return { name };
}

// 도배 방지 — 한 곳에서 글을 너무 자주 못 올리게. 기록보다 길게 잡는다.
const lastPostBoard = new Map();
const BOARD_COOLDOWN_MS = 15_000;

// 실시간 접속 신호. 페이지를 열어 둔 브라우저가 주기적으로 보낸다.
// 아무것도 저장하지 않고, 그 순간 접속자 수만 세어 돌려준다.
app.post('/api/presence', (req, res) => {
  const body = req.body ?? {};
  // 탭을 닫을 때 오는 작별 신호(sendBeacon). 바로 빼고 끝낸다.
  if (body.bye) {
    presence.leave(body.id);
    return res.json({ ok: true });
  }
  // 봇(HeadlessChrome 등)은 JS 를 돌려 신호를 보내기도 한다. 접속자·순
  // 방문자에서 빼야 진짜 사람 수에 가까워진다.
  if (!isBot(req.get('user-agent'))) {
    presence.beat(body.id);
    // 이 브라우저의 오늘 첫 신호면 순 방문자로 한 번 센다(중복은 stats 가 거른다).
    stats.uniqueVisit(body.id);
  }
  res.json({ online: presence.count() });
});

app.get('/api/board', (req, res) => {
  res.json({ posts: board.latest(50) });
});

app.post('/api/board', (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  const wait = BOARD_COOLDOWN_MS - (now - (lastPostBoard.get(ip) || 0));
  if (wait > 0) {
    return res.status(429).json({ error: `잠시 후 다시 올려 주세요. (${Math.ceil(wait / 1000)}초)` });
  }

  const who = posterName(req, req.body?.name);
  if (who.error) return res.status(400).json({ error: who.error });

  // 내용 검사(욕설·길이·빈 글). 통과하면 다듬어진 text 를 그대로 저장한다.
  const checked = checkMessage(req.body?.body);
  if (!checked.ok) return res.status(400).json({ error: checked.reason });

  lastPostBoard.set(ip, now);
  try {
    board.add({ name: who.name, body: checked.text, userId: req.user?.id ?? null });
    res.json({ posts: board.latest(50) });
  } catch (err) {
    console.error('게시글 저장 실패:', err);
    res.status(500).json({ error: '글을 저장하지 못했습니다.' });
  }
});

// ---------------------------------------------------------------- 관리

// 관리자를 가리는 방법이 둘이다.
//
//   1. 로그인한 계정       — 게임 안 관리 창(🛠)이 쓴다. 평소에 쓰는 길이다.
//   2. 열쇠(ADMIN_TOKEN)  — 헤더 x-admin-token 으로 들어간다. 화면은 없다.
//      계정으로 못 들어가는 상황(구글 계정 분실 등)을 위한 여벌 열쇠다.
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
    // 지금 사이트에 있는 사람 수(실시간). lobby.stats() 는 1v1 대기·대전 수라 따로 둔다.
    present: presence.count(),
    online: lobby.stats(),
    scores: scores.all(),
    accounts: users.listAccounts(),
    usage: stats.recent(30),
    usageMonthly: stats.monthly(24),
    usageTotals: stats.totals()
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

// 홍보용 벤치마크 기록 심기(관리자). 랭킹에 "이 기록을 넘으세요" 목표를
// 하나 올린다. 계정에 묶지 않는 독립 기록이라, 필요 없어지면 /admin 에서
// 그 줄만 지우면 된다.
app.post('/api/admin/scores/seed', requireAdmin, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const time = Number(req.body?.time);
  if (!name || name.length > 20) {
    return res.status(400).json({ error: '이름이 올바르지 않습니다.' });
  }
  if (!Number.isFinite(time) || time <= 0 || time > 100000) {
    return res.status(400).json({ error: '기록이 올바르지 않습니다.' });
  }
  try {
    const entry = await scores.add(name, time, null);
    res.json({ ok: true, entry });
  } catch (err) {
    console.error('기록 심기 실패:', err);
    res.status(500).json({ error: '심기에 실패했습니다.' });
  }
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

// 모든 판 기록(플레이 로그). 시간 역순 한 쪽씩 준다.
app.get('/api/admin/plays', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(plays.page(limit, offset));
});

// 플레이 로그 비우기. 확인 문구를 요구한다.
app.post('/api/admin/plays/clear', requireAdmin, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL') {
    return res.status(400).json({ error: '확인 문구가 필요합니다.' });
  }
  try {
    res.json({ ok: true, removed: plays.clear() });
  } catch (err) {
    console.error('플레이 로그 삭제 실패:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 게시글 삭제(관리자). 부적절한 글을 지운다.
app.delete('/api/admin/board/:id', requireAdmin, (req, res) => {
  try {
    if (!board.remove(req.params.id)) return res.status(404).json({ error: '이미 없는 글입니다.' });
    res.json({ ok: true, posts: board.latest(50) });
  } catch (err) {
    console.error('게시글 삭제 실패:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 이용 현황 비우기. 기록 전체 비우기와 같은 방식으로 확인 문구를 요구한다.
app.post('/api/admin/usage/clear', requireAdmin, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL') {
    return res.status(400).json({ error: '확인 문구가 필요합니다.' });
  }
  try {
    res.json({ ok: true, removed: stats.clear() });
  } catch (err) {
    console.error('이용 현황 삭제 실패:', err);
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
  console.log('관리 화면 → 게임에 관리자 계정으로 로그인하면 상단 🛠 버튼');
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
