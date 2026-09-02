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
import { isBot, isMobile } from './lib/bots.js';
import { isDatacenterIp, isCloudOrg } from './lib/datacenter.js';
import { openGeo, openAsn, asnOrg, countryCode } from './lib/geo.js';
import { openBoardStore, CATEGORIES, ADMIN_CATEGORIES } from './lib/board.js';
import { openPlaysStore } from './lib/plays.js';
import { openPurchasesStore } from './lib/purchases.js';
import { openSpinsStore } from './lib/spins.js';
import { openModeLogs } from './lib/modelogs.js';
import { openReplaysStore } from './lib/replays.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openCoinGrants } from './lib/coingrants.js';
import { openPresence } from './lib/presence.js';
import { GUEST_PATTERN, checkMessage } from './public/js/profanity.js';
import { msLeftInSeason, seasonName, seasonOf } from './lib/season.js';
import { describe as describeTitles, sanitizeEquipped, earnedIds as earnedTitleIds, titleById, isAwardable } from './lib/titles.js';
import { describe as describeChallenge, floorAt, TOP_FLOOR } from './lib/challenge.js';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || join(root, 'data');

// DATA_DIR 을 지정하면 그쪽에 저장한다 (영구 디스크 마운트용).
//
// 세 저장소가 데이터베이스 한 채를 나눠 쓴다. 파일을 따로 두면 한 판이
// 끝날 때 세 파일을 각각 열고 닫아야 하고, 백업도 셋을 맞춰 떠야 한다.
const db = await openDatabase(DATA_DIR);

// IP→지역 오프라인 조회용 GeoLite2 DB. 없으면 방문 기록의 '지역'만 비고
// 나머지는 그대로 뜬다. 경로는 GEO_DB 로 바꿀 수 있다.
const GEO_DB = process.env.GEO_DB || join(DATA_DIR, 'geo', 'GeoLite2-City.mmdb');
if (await openGeo(GEO_DB)) console.log('지역 DB 로드됨:', GEO_DB);
else console.log('지역 DB 없음(방문 기록의 지역 표시는 비활성):', GEO_DB);

// ASN(네트워크 소유 조직) DB. 있으면 클라우드/호스팅을 조직명으로 자동 판별해
// 봇으로 거른다(CIDR 목록에 없어도). 없으면 예전처럼 CIDR 만으로 판단한다.
const GEO_ASN = process.env.GEO_ASN || join(DATA_DIR, 'geo', 'GeoLite2-ASN.mmdb');
if (await openAsn(GEO_ASN)) console.log('ASN DB 로드됨:', GEO_ASN);
else console.log('ASN DB 없음(클라우드 자동판별은 CIDR 만 사용):', GEO_ASN);

// 이 IP 가 '진짜 사람'이 아닌지(=집계에서 뺄지) 판단한다. 다음이면 봇으로 본다:
//   1) 알려진 데이터센터 CIDR       2) ASN 조직이 클라우드/호스팅
//   3) 국가가 한국이 아님 — 이 게임은 한국 대상이라 해외 접속은 사람으로 세지 않는다
// GeoLite2 DB 가 없으면 2·3 은 자동으로 꺼지고 1(CIDR)만 쓴다(안전한 축소).
function isNonHumanIp(ip) {
  if (isDatacenterIp(ip)) return true;
  if (isCloudOrg(asnOrg(ip))) return true;
  const cc = countryCode(ip);
  if (cc && cc !== 'KR') return true;
  return false;
}

// UA 까지 함께 보는 판정(접속 시점용). 방문 기록의 옛 행 재계산에는 IP 판정만 쓴다.
function isNonHuman(ip, ua) {
  return isBot(ua) || isNonHumanIp(ip);
}

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

// 모든 판 기록(플레이 로그). 최고 기록만 남기는 scores 와 별개다.
// stats 보다 먼저 연다 — stats 가 '일별 최고 기록'을 처음 만들 때 이 표에서 백필한다.
const plays = openPlaysStore(db);

// 날짜별 이용 현황. 누가 왔는지는 안 적고 횟수만 센다.
const stats = openStatsStore(db);

// 자유 게시판.
const board = openBoardStore(db);

const purchases = openPurchasesStore(db);   // 코인으로 캐릭터 산 기록
const spins = openSpinsStore(db);           // 코인 룰렛 돌린 기록
const modeLogs = openModeLogs(db);          // 도전모드·봇전 한 판 기록
const replays = openReplaysStore(db);       // 최고기록 다시보기(입력 기록)
const coinGrants = openCoinGrants(db);       // 관리자가 준 코인 지급 대기

// 지금 사이트에 몇 명이 있는지(실시간 접속). 메모리에만 두고 저장 안 한다.
const presence = openPresence();
const matchLog = await openMatchStore(DATA_DIR, db);

const app = express();
// 무엇으로 만들었는지 알려 줄 이유가 없다. 알려 주면 그 버전에 알려진
// 약점을 골라 찔러 보기 쉬워진다.
app.disable('x-powered-by');
// 본문은 기본 4kb 로 작게 막는다(도배·과대 요청 방지). 다만 다시보기 기록은
// 입력 배열이라 커질 수 있어 그 경로에만 넉넉한 한도를 준다.
const jsonSmall = express.json({ limit: '4kb' });
const jsonBig = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path === '/api/replay' ? jsonBig : jsonSmall)(req, res, next));
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
  const ua = req.get('user-agent');
  const ip = clientIp(req);
  const mobile = isMobile(ua);
  // 봇 판정: UA 가 봇이거나, IP 가 데이터센터/클라우드/호스팅이거나, 해외 접속이면 봇.
  // UA 를 진짜 브라우저로 위장한 봇도 클라우드에서 오면 여기서 걸린다.
  const bot = isNonHuman(ip, ua);
  // 관리자(나) 본인 접속은 집계에서 아예 뺀다. 테스트로 숫자가 튀지 않게.
  if (!isAdminUser(req.user) && !bot) stats.visit(mobile);
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
function myBest(req, mode = 'normal') {
  if (req.user) return scores.bestOf({ userId: req.user.id, mode });
  const name = typeof req.query.name === 'string' ? req.query.name : null;
  return name ? scores.bestOf({ name, mode }) : null;
}

// 지금이 어느 시즌이고 언제 끝나는지. 화면 맨 위에 보여 준다.
function seasonInfo() {
  const key = seasonOf();
  return { key, name: seasonName(key), msLeft: msLeftInSeason() };
}

// 랭킹 모드는 네 가지: 버티기·하드코어·마이크·마이크(하드코어). 각각 따로 쌓인다.
const SCORE_MODES = new Set(['normal', 'hardcore', 'voice', 'voicehard']);
const normScoreMode = (m) => (SCORE_MODES.has(m) ? m : 'normal');

app.get('/api/scores', async (req, res) => {
  // 달이 바뀌었으면 지난 시즌 기록을 명예의 전당으로 옮긴다.
  // 서버가 그 순간에 떠 있으리란 보장이 없어, 물어볼 때 확인한다.
  await scores.rollSeasons();
  const mode = normScoreMode(req.query.mode);
  res.json({ top: scores.top(TOP_N, mode), me: myBest(req, mode), season: seasonInfo() });
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
  const best = scores.bestOf({ name, mode: 'normal' });
  const hard = scores.bestOf({ name, mode: 'hardcore' });
  // 판수는 두 모드의 제출된 판을 더한다(각 모드 한 줄, runs 에 누적).
  const plays = (best?.runs ?? 0) + (hard?.runs ?? 0);

  // 관리자에게만 최고기록의 점수 id 와 다시보기 유무를 함께 준다(다시보기 버튼용).
  const admin = isAdminUser(req.user);
  const bestExtra = (b) => (admin && b) ? { id: b.id, replay: replays.has(b.id) } : {};

  const profile = {
    name: user?.nickname ?? name,
    account: !!user,
    season: seasonInfo(),
    best: best ? { time: best.time, rank: best.rank, ...bestExtra(best) } : null,
    hardcore: hard ? { time: hard.time, rank: hard.rank, ...bestExtra(hard) } : null,
    plays,
    // 칭호: 모든 칭호 + 이 사람의 획득·장착 여부. 관리자는 전부 획득 처리되고
    // 운영자 칭호는 관리자에게만 보인다(프로필 주인의 관리자 여부로 판정).
    titles: describeTitles(
      { plays, isAdmin: isAdminUser(user), awards: user?.awards, luckyHits: user?.luckyHits },
      user?.titles)
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
  if (!isAdminUser(req.user)) stats.runStarted();   // 관리자 판은 판 수에 안 센다
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
  const mode = normScoreMode(req.body?.mode);

  // 관리자(나) 본인 판은 전적·랭킹·판수·논시간 어디에도 안 남긴다.
  // 게임오버 화면은 정상적으로 뜨게, 제외됐다는 표시만 돌려준다.
  if (isAdminUser(req.user)) {
    return res.json({ excluded: true, rank: null, top: scores.top(TOP_N, mode), me: null, season: seasonInfo() });
  }

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
    const entry = await scores.add(finalName, seconds, req.user?.id ?? null, mode);
    stats.runFinished(t);
    // 최고 기록과 별개로, 이 판 자체를 로그에 남긴다.
    plays.add({ name: finalName, seconds, userId: req.user?.id ?? null, mobile: isMobile(req.get('user-agent')) });

    // 이번 판으로 새로 얻은 칭호(판수 문턱을 넘겼는지). 판수는 두 모드 합이고
    // 이번 제출로 정확히 1 늘었으므로, 직전 판수는 (지금-1) 이다. 축하 연출용.
    const isAdmin = isAdminUser(req.user);
    const pN = scores.bestOf({ name: finalName, mode: 'normal' });
    const pH = scores.bestOf({ name: finalName, mode: 'hardcore' });
    const playsNow = (pN?.runs ?? 0) + (pH?.runs ?? 0);
    const gainedIds = earnedTitleIds({ plays: playsNow, isAdmin })
      .filter((id) => !earnedTitleIds({ plays: Math.max(0, playsNow - 1), isAdmin }).includes(id));
    const newTitles = gainedIds.map((id) => { const t = titleById(id); return { id, name: t?.name ?? id }; });
    // 판수로 새로 딴 칭호도 기록에 남긴다.
    for (const t of newTitles) {
      try {
        modeLogs.title.add({
          name: finalName, userId: req.user?.id ?? null,
          title_id: t.id, title: t.name, how: `${playsNow}판 달성`
        });
      } catch (err) { console.error('칭호 기록 실패:', err); }
    }

    res.json({
      id: entry.id,
      rank: scores.rankOf(entry.id),
      top: scores.top(TOP_N, mode),
      me: scores.bestOf(req.user ? { userId: req.user.id, mode } : { name: finalName, mode }),
      season: seasonInfo(),
      newTitles
    });
  } catch (err) {
    console.error('기록 저장 실패:', err);
    res.status(500).json({ error: '서버에 기록을 저장하지 못했습니다.' });
  }
});

// ── 다시보기 ────────────────────────────────────────────────────────
// 최고 기록 한 판의 입력을 담아 둔다. 게임 시뮬이 순수 함수라 seed+입력만
// 있으면 그 판이 그대로 재현된다. 자기 최고 기록에만 매달 수 있고(사칭 방지),
// 보는 건 관리자만.
const REPLAY_MAX_BYTES = 1_000_000;   // 입력 버퍼 원본 상한(정상 최장판의 3배 여유)

app.post('/api/replay', (req, res) => {
  const { scoreId, seed, mode, time, frames, data, name } = req.body ?? {};
  const row = typeof scoreId === 'string' ? scores.rowById(scoreId) : null;
  if (!row) return res.status(400).json({ error: '기록을 찾을 수 없습니다.' });

  // 이 점수 줄이 올리는 사람 것인지 확인한다(남의 기록에 못 매달게).
  if (row.user_id) {
    if (!req.user || req.user.id !== row.user_id) {
      return res.status(403).json({ error: '자기 기록만 올릴 수 있습니다.' });
    }
  } else if (!req.user) {
    if (String(name ?? '') !== row.name) {
      return res.status(403).json({ error: '자기 기록만 올릴 수 있습니다.' });
    }
  } else {
    return res.status(403).json({ error: '자기 기록만 올릴 수 있습니다.' });
  }

  // 지금 그 줄의 기록과 시간이 맞아야 한다(옛 판을 매달지 못하게).
  const t = Number(time);
  if (!Number.isFinite(t) || Math.abs(t - row.time) > 0.02) {
    return res.status(400).json({ error: '기록 시간이 맞지 않습니다.' });
  }
  const seedInt = Number(seed);
  if (!Number.isInteger(seedInt)) return res.status(400).json({ error: 'seed 가 올바르지 않습니다.' });
  const rowMode = row.mode ?? 'normal';
  if (mode !== rowMode) return res.status(400).json({ error: '모드가 맞지 않습니다.' });

  let raw;
  try { raw = Buffer.from(String(data ?? ''), 'base64'); }
  catch { return res.status(400).json({ error: '기록 데이터가 올바르지 않습니다.' }); }
  if (raw.length === 0 || raw.length > REPLAY_MAX_BYTES) {
    return res.status(400).json({ error: '기록 데이터 크기가 올바르지 않습니다.' });
  }

  try {
    const gz = gzipSync(raw);
    replays.put({
      scoreId, name: row.name, userId: row.user_id ?? null, mode: rowMode,
      time: row.time, seed: seedInt, frames: Math.max(0, Math.floor(Number(frames) || 0)), gz
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('다시보기 저장 실패:', err);
    res.status(500).json({ error: '다시보기를 저장하지 못했습니다.' });
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
  // 봇(HeadlessChrome 등)은 JS 를 돌려 신호를 보내기도 한다. UA 위장 봇도
  // 클라우드/호스팅/해외 IP 면 걸러, 접속자·순 방문자를 진짜 사람에 가깝게 한다.
  const ua = req.get('user-agent');
  // 관리자(나) 본인은 접속·순방문자 집계에서 뺀다.
  if (!isNonHuman(clientIp(req), ua) && !isAdminUser(req.user)) {
    presence.beat(body.id);
    // 이 브라우저의 오늘 첫 신호면 순 방문자로 한 번 센다(중복은 stats 가 거른다).
    stats.uniqueVisit(body.id, isMobile(ua));
  }
  res.json({ online: presence.count() });
});

app.get('/api/board', (req, res) => {
  res.json({ posts: board.latest(100) });
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

  // 답글이면 다는 대상(원글)이 실제로 있어야 한다. 답글에 답글은 원글로 붙는다.
  const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
  if (parentId && !board.canReplyTo(parentId)) {
    return res.status(400).json({ error: '답글을 달 글을 찾지 못했습니다.' });
  }

  // 원글의 칸(카테고리). 답글은 칸이 없다. 패치노트 칸은 관리자만.
  const isAdmin = isAdminUser(req.user) || tokenMatches(req.get('x-admin-token'));
  let category = null;
  if (!parentId) {
    category = CATEGORIES.includes(req.body?.category) ? req.body.category : 'chat';
    if (ADMIN_CATEGORIES.has(category) && !isAdmin) {
      return res.status(403).json({ error: '이 칸에는 운영자만 글을 쓸 수 있습니다.' });
    }
  }

  // 내용 검사(욕설·길이·빈 글). 통과하면 다듬어진 text 를 그대로 저장한다.
  // 패치노트(운영자)는 길게 쓸 수 있게 길이 제한을 크게 둔다.
  const maxLen = category === 'patch' ? 6000 : 200;
  const checked = checkMessage(req.body?.body, maxLen);
  if (!checked.ok) return res.status(400).json({ error: checked.reason });

  lastPostBoard.set(ip, now);
  try {
    board.add({ name: who.name, body: checked.text, userId: req.user?.id ?? null, parentId, category });
    res.json({ posts: board.latest(100) });
  } catch (err) {
    console.error('게시글 저장 실패:', err);
    res.status(500).json({ error: '글을 저장하지 못했습니다.' });
  }
});

// 코인으로 캐릭터를 샀을 때 남긴다(참고용 로그 — 코인 처리는 브라우저에서).
// 이름은 로그인한 사람은 서버 닉네임으로 덮어써 사칭을 막는다. 관리자는 코인이
// 무한이라 '구매'가 아니므로 남기지 않는다.
app.post('/api/purchase', (req, res) => {
  if (isAdminUser(req.user)) return res.json({ ok: true });   // 관리자는 기록 안 함
  const who = posterName(req, req.body?.name);
  if (who.error) return res.status(400).json({ error: who.error });

  const character = String(req.body?.character ?? '').slice(0, 40);
  const charName = String(req.body?.charName ?? '').slice(0, 40);
  const cost = Math.max(0, Math.min(100000, Math.floor(Number(req.body?.cost) || 0)));
  if (!character) return res.status(400).json({ error: '캐릭터가 필요합니다.' });

  try {
    purchases.add({ name: who.name, userId: req.user?.id ?? null, character, charName, cost });
    res.json({ ok: true });
  } catch (err) {
    console.error('구매 기록 저장 실패:', err);
    res.status(500).json({ error: '기록에 실패했습니다.' });
  }
});

// 코인 룰렛을 돌렸을 때 남긴다(참고용 로그 — 코인 처리는 브라우저에서).
// 관리자(무한 코인)는 진짜 소비가 아니므로 남기지 않는다. 이름은 로그인한
// 사람은 서버 닉네임으로 덮어써 사칭을 막는다.
// 도전모드 한 판 기록(성공·실패 모두). 관리 화면에서 보려는 용도.
app.post('/api/challenge-log', (req, res) => {
  const who = posterName(req, req.body?.name);
  if (who.error) return res.status(400).json({ error: who.error });
  const floor = Math.max(0, Math.min(999, Math.floor(Number(req.body?.floor) || 0)));
  const goal = typeof req.body?.goal === 'string' ? req.body.goal.slice(0, 60) : '';
  const ok = req.body?.ok ? 1 : 0;
  const seconds = Math.max(0, Math.min(100000, Number(req.body?.seconds) || 0));
  try {
    modeLogs.challenge.add({ name: who.name, userId: req.user?.id ?? null, floor, goal, ok, seconds });
    res.json({ ok: true });
  } catch (err) {
    console.error('도전 기록 저장 실패:', err);
    res.status(500).json({ error: '기록 저장 실패' });
  }
});

// 봇전 한 판 기록.
app.post('/api/bot-log', (req, res) => {
  const who = posterName(req, req.body?.name);
  if (who.error) return res.status(400).json({ error: who.error });
  const tier = typeof req.body?.tier === 'string' ? req.body.tier.slice(0, 20) : '';
  const win = req.body?.win ? 1 : 0;
  const seconds = Math.max(0, Math.min(100000, Number(req.body?.seconds) || 0));
  try {
    modeLogs.bot.add({ name: who.name, userId: req.user?.id ?? null, tier, win, seconds });
    res.json({ ok: true });
  } catch (err) {
    console.error('봇전 기록 저장 실패:', err);
    res.status(500).json({ error: '기록 저장 실패' });
  }
});

app.post('/api/spin', (req, res) => {
  if (isAdminUser(req.user)) return res.json({ ok: true });   // 관리자는 기록 안 함
  const who = posterName(req, req.body?.name);
  if (who.error) return res.status(400).json({ error: who.error });

  const cost = Math.max(0, Math.min(100000, Math.floor(Number(req.body?.cost) || 0)));
  const reward = Math.max(0, Math.min(100000, Math.floor(Number(req.body?.reward) || 0)));
  const prize = typeof req.body?.prize === 'string' ? req.body.prize.slice(0, 40) : null;

  try {
    spins.add({ name: who.name, userId: req.user?.id ?? null, cost, reward, prize });
    res.json({ ok: true });
  } catch (err) {
    console.error('룰렛 기록 저장 실패:', err);
    res.status(500).json({ error: '기록에 실패했습니다.' });
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

// ── 공지 ────────────────────────────────────────────────────────────
// 타이틀 상단에 뜨는 공지. 줄마다 하나씩 여러 개 둘 수 있고, 여러 개면 화면에서
// 번갈아 뜬다. 파일 하나에 줄바꿈으로 담아 두고, 관리자만 고친다.
const NOTICE_FILE = join(DATA_DIR, 'notice.txt');
const NOTICE_MAX = 12;   // 공지 최대 개수
let noticeText = '';
try { noticeText = await readFile(NOTICE_FILE, 'utf8'); } catch { noticeText = ''; }

// 저장된 원문 → 공지 배열(빈 줄 제거, 개수·길이 제한).
const noticeList = () => noticeText.split('\n')
  .map((s) => s.trim()).filter(Boolean).slice(0, NOTICE_MAX);

app.get('/api/notice', (req, res) => res.json({ notices: noticeList(), text: noticeText }));

app.post('/api/admin/notice', requireAdmin, async (req, res) => {
  // 줄마다 하나의 공지로 정리한다(각 줄 200자, 최대 NOTICE_MAX 개).
  const lines = String(req.body?.text ?? '').split('\n')
    .map((s) => s.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    .slice(0, NOTICE_MAX).map((s) => s.slice(0, 200));
  noticeText = lines.join('\n');
  try {
    await writeFile(NOTICE_FILE, noticeText, 'utf8');
  } catch (err) {
    console.error('공지 저장 실패:', err);
    return res.status(500).json({ error: '공지를 저장하지 못했습니다.' });
  }
  res.json({ ok: true, notices: noticeList(), text: noticeText });
});

// ── 패치노트 ────────────────────────────────────────────────────────
// 날짜별 업데이트 기록. 여러 줄 텍스트를 파일 하나에 담고 관리자만 고친다.
// (형식 파싱은 화면에서 한다 — 날짜 줄 + '- 항목' 줄.)
const PATCHNOTES_FILE = join(DATA_DIR, 'patchnotes.txt');
let patchNotesText = '';
try { patchNotesText = await readFile(PATCHNOTES_FILE, 'utf8'); } catch { patchNotesText = ''; }

// 패치노트를 커뮤니티(patch 칸)로 합쳤다. 예전 patchnotes.txt 에 쌓인 기록이
// 있고 아직 옮긴 적 없으면, 날짜별로 한 글씩 만들어 이관한다(한 번만).
// 각 글은 '운영자'가 쓴 것으로 두고, 날짜를 글 시각으로 삼아 순서를 지킨다.
try {
  if (patchNotesText.trim() && !board.hasCategory('patch')) {
    const entries = [];
    let cur = null;
    for (const raw of patchNotesText.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^[-•]/.test(line)) {
        if (!cur) { cur = { date: '', items: [] }; entries.push(cur); }
        cur.items.push(line.replace(/^[-•]\s*/, '').trim());
      } else {
        cur = { date: line, items: [] };
        entries.push(cur);
      }
    }
    for (const e of entries) {
      if (!e.items.length) continue;
      const ts = Date.parse(`${e.date}T12:00:00+09:00`);
      const body = (e.date ? `${e.date}\n` : '') + e.items.map((i) => `• ${i}`).join('\n');
      board.add({ name: '운영자', body, userId: 'system', category: 'patch', at: Number.isNaN(ts) ? Date.now() : ts });
    }
    console.log(`패치노트 ${entries.length}건을 커뮤니티로 이관했습니다.`);
  }
} catch (err) { console.error('패치노트 이관 실패:', err); }

app.get('/api/patchnotes', (req, res) => res.json({ text: patchNotesText }));

app.post('/api/admin/patchnotes', requireAdmin, async (req, res) => {
  // 줄바꿈은 살리고 길이만 제한한다.
  const text = String(req.body?.text ?? '').slice(0, 6000);
  patchNotesText = text;
  try {
    await writeFile(PATCHNOTES_FILE, text, 'utf8');
  } catch (err) {
    console.error('패치노트 저장 실패:', err);
    return res.status(500).json({ error: '패치노트를 저장하지 못했습니다.' });
  }
  res.json({ ok: true, text });
});

// 관리 창을 한 번에 채운다
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  res.json({
    season: seasonInfo(),
    // 지금 사이트에 있는 사람 수(실시간). lobby.stats() 는 1v1 대기·대전 수라 따로 둔다.
    present: presence.count(),
    online: lobby.stats(),
    scores: scores.all(),
    // 계정 목록에 '몇 판 했는지'(제출된 판수 합)를 붙여 준다.
    accounts: (() => {
      const runs = scores.runsByName();
      return users.listAccounts().map((a) => ({ ...a, plays: runs.get(a.nickname) ?? 0 }));
    })(),
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

// 전체 1v1 대전 기록(로그인·게스트 모두). 시간순, 쪽 단위.
app.get('/api/admin/matches/recent', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(matchLog.page(limit, offset));
});

// 대전 기록 한 판 삭제.
app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  if (!matchLog.remove(req.params.id)) return res.status(404).json({ error: '이미 없는 기록입니다.' });
  res.json({ ok: true });
});

// 코인으로 캐릭터 산 기록. 시간순 한 쪽씩.
app.get('/api/admin/purchases', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(purchases.page(limit, offset));
});

app.delete('/api/admin/purchases/:id', requireAdmin, (req, res) => {
  if (!purchases.remove(req.params.id)) return res.status(404).json({ error: '이미 없는 기록입니다.' });
  res.json({ ok: true });
});

// 룰렛 기록(관리자). 누가 얼마 걸어 뭐가 나왔는지 시간순으로.
app.get('/api/admin/spins', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(spins.page(limit, offset));
});

app.delete('/api/admin/spins/:id', requireAdmin, (req, res) => {
  if (!spins.remove(req.params.id)) return res.status(404).json({ error: '이미 없는 기록입니다.' });
  res.json({ ok: true });
});

// 다시보기 한 판을 받아온다(관리자). gzip 을 풀어 base64 로 돌려준다.
app.get('/api/admin/replay/:scoreId', requireAdmin, (req, res) => {
  const row = replays.get(req.params.scoreId);
  if (!row) return res.status(404).json({ error: '다시보기가 없습니다.' });
  try {
    const raw = gunzipSync(row.gz);
    res.json({
      name: row.name, mode: row.mode, time: row.time, seed: row.seed,
      frames: row.frames, data: raw.toString('base64')
    });
  } catch (err) {
    console.error('다시보기 읽기 실패:', err);
    res.status(500).json({ error: '다시보기를 읽지 못했습니다.' });
  }
});

// 코인 지급용 계정 목록(닉네임 있는 계정만). 대기 중인 지급도 함께 보여 준다.
app.get('/api/admin/accounts', requireAdmin, (req, res) => {
  const pend = coinGrants.pendingMap();
  const rows = users.listAccounts()
    .filter((u) => u.nickname)
    .map((u) => ({ id: u.id, nickname: u.nickname, pending: pend.get(u.id) ?? 0 }));
  res.json({ rows });
});

// 특정 계정에 코인 지급(대기에 쌓는다). 그 사람 다음 접속 때 받아 간다.
app.post('/api/admin/coins/grant', requireAdmin, (req, res) => {
  const userId = String(req.body?.userId ?? '');
  const amount = Math.floor(Number(req.body?.amount) || 0);
  const message = String(req.body?.message ?? '').slice(0, 100);
  if (!users.byId(userId)) return res.status(404).json({ error: '없는 계정입니다.' });
  if (amount < 1 || amount > 100000) return res.status(400).json({ error: '1~100000 사이로 정해 주세요.' });
  const pending = coinGrants.grant(userId, amount, message);
  res.json({ ok: true, pending });
});

// 실수로 준 코인 취소: 아직 안 받아간 '지급 대기'를 0으로 지운다.
// (이미 받아간 코인은 브라우저에 있어 서버가 못 되돌린다.)
app.post('/api/admin/coins/revoke', requireAdmin, (req, res) => {
  const userId = String(req.body?.userId ?? '');
  if (!users.byId(userId)) return res.status(404).json({ error: '없는 계정입니다.' });
  const pending = coinGrants.revoke(userId);
  res.json({ ok: true, pending });
});

// (로그인한 사람) 대기 중인 코인을 받아 간다. 받으면 대기는 0이 된다.
app.post('/api/me/coins/claim', (req, res) => {
  if (!req.user) return res.json({ amount: 0, message: '' });
  const g = coinGrants.claim(req.user.id);
  res.json({ amount: g.amount, message: g.message });
});

// 칭호 장착(최대 3개, 얻은 것만). 로그인·닉네임이 있어야 한다.
// 판수는 서버가 아는 제출된 판수(두 모드 합)로 판정한다 — 클라 조작 무시.
app.post('/api/titles', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const name = req.user.nickname;
  if (!name) return res.status(400).json({ error: '닉네임을 먼저 정해 주세요.' });
  const best = scores.bestOf({ name, mode: 'normal' });
  const hard = scores.bestOf({ name, mode: 'hardcore' });
  const plays = (best?.runs ?? 0) + (hard?.runs ?? 0);
  const acct = users.byId(req.user.id);
  const ctx = { plays, isAdmin: isAdminUser(req.user), awards: acct?.awards, luckyHits: acct?.luckyHits };
  const equipped = sanitizeEquipped(req.body?.equipped, ctx);
  const updated = users.setTitles(req.user.id, equipped);
  res.json({ ok: true, titles: describeTitles(ctx, updated?.titles ?? equipped) });
});

// 도전모드(탑) 랭킹 — 누가 몇 층까지 올라갔나(통산).
app.get('/api/tower-ranks', (req, res) => {
  const top = users.towerRanking(TOP_N);
  const me = req.user ? users.byId(req.user.id) : null;
  const myFloor = me?.challenge ?? 0;
  res.json({
    season: seasonInfo(),
    top,
    me: myFloor > 0 ? { name: me.nickname, floor: myFloor, rank: users.towerRankOf(myFloor) } : null
  });
});

// 도전모드(탑) — 내 진행도와 층 목록. 로그인해야 도전할 수 있다.
// 아직 준비 중이라 관리자만 쓸 수 있다(버튼도 관리자에게만 보인다).
app.get('/api/challenge', (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: '도전모드는 준비 중입니다.' });
  }
  const me = users.byId(req.user.id);
  res.json({ signedIn: true, ...describeChallenge(me?.challenge ?? 0) });
});

// 한 층을 깼다고 알린다. 순서대로만(지금 층 +1) 인정한다.
// 조건 달성 자체는 클라가 판정한다(코인·판정이 원래 클라 신뢰 모델이라 동일).
app.post('/api/challenge/clear', (req, res) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: '도전모드는 준비 중입니다.' });
  }
  const floor = Math.floor(Number(req.body?.floor) || 0);
  const me = users.byId(req.user.id);
  const cleared = me?.challenge ?? 0;
  if (!floorAt(floor)) return res.status(400).json({ error: '없는 층입니다.' });
  if (floor !== cleared + 1) {
    // 이미 깬 층을 다시 깨는 건 조용히 무시(진행도 그대로).
    return res.json({ ok: true, ...describeChallenge(cleared) });
  }
  const now = users.setChallenge(req.user.id, Math.min(floor, TOP_FLOOR));
  res.json({ ok: true, cleared: now, ...describeChallenge(now) });
});

// 룰렛에서 희귀 보상(0.1~3%)을 뽑았다고 알린다. 누적 횟수를 올리고, 그것으로
// 새로 얻은 칭호(럭키가이 3회·행운의 여신 10회)가 있으면 알려 준다.
app.post('/api/titles/lucky-hit', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const before = users.byId(req.user.id)?.luckyHits ?? 0;
  const after = users.bumpLuckyHit(req.user.id);
  const isAdmin = isAdminUser(req.user);
  const gained = earnedTitleIds({ luckyHits: after, isAdmin })
    .filter((id) => !earnedTitleIds({ luckyHits: before, isAdmin }).includes(id));
  const newTitles = gained.map((id) => { const t = titleById(id); return { id, name: t?.name ?? id }; });
  for (const t of newTitles) {
    try {
      modeLogs.title.add({
        name: req.user.nickname ?? '(닉네임 없음)', userId: req.user.id,
        title_id: t.id, title: t.name, how: `룰렛 희귀 보상 ${after}회`
      });
    } catch (err) { console.error('칭호 기록 실패:', err); }
  }
  res.json({ ok: true, hits: after, newTitles });
});

// 업적 칭호 수여(예: 불운·저주받은 자 — 룰렛 꽝 연속). 클라가 조건을 채우면 부른다.
// 룰렛/코인은 원래 클라 신뢰 모델이라(코인이 localStorage), 여기서도
// 클라 요청을 믿되, 수여 가능한 업적 id 만 받는다. fresh 면 이번에 처음 얻음.
app.post('/api/titles/award', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const id = String(req.body?.id ?? '');
  if (!isAwardable(id)) return res.status(400).json({ error: '수여할 수 없는 칭호입니다.' });
  const { user, fresh } = users.awardTitle(req.user.id, id);
  const t = titleById(id);
  // 처음 얻은 순간만 기록에 남긴다(관리 화면 '칭호 획득 기록').
  if (fresh) {
    try {
      modeLogs.title.add({
        name: req.user.nickname ?? '(닉네임 없음)', userId: req.user.id,
        title_id: id, title: t?.name ?? id, how: '룰렛'
      });
    } catch (err) { console.error('칭호 기록 실패:', err); }
  }
  res.json({ ok: true, fresh, title: fresh ? { id, name: t?.name ?? id } : null });
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
    replays.remove(req.params.id);   // 기록을 지우면 그 다시보기도 함께 지운다
    res.json({ ok: true, left: scores.size });
  } catch (err) {
    console.error('기록 삭제 실패:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 모든 판 기록(플레이 로그). 시간 역순 한 쪽씩 준다.
// 도전모드 기록(관리자). 성공·실패 모두.
app.get('/api/admin/challenge-log', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(modeLogs.challenge.page(limit, offset));
});
app.post('/api/admin/challenge-log/clear', requireAdmin, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL') return res.status(400).json({ error: '확인 문구가 필요합니다.' });
  res.json({ ok: true, removed: modeLogs.challenge.clear() });
});

// 칭호 획득 기록(관리자).
app.get('/api/admin/title-log', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(modeLogs.title.page(limit, offset));
});
app.post('/api/admin/title-log/clear', requireAdmin, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL') return res.status(400).json({ error: '확인 문구가 필요합니다.' });
  res.json({ ok: true, removed: modeLogs.title.clear() });
});

// 봇전 기록(관리자).
app.get('/api/admin/bot-log', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(modeLogs.bot.page(limit, offset));
});
app.post('/api/admin/bot-log/clear', requireAdmin, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL') return res.status(400).json({ error: '확인 문구가 필요합니다.' });
  res.json({ ok: true, removed: modeLogs.bot.clear() });
});

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
    res.json({ ok: true, posts: board.latest(100) });
  } catch (err) {
    console.error('게시글 삭제 실패:', err);
    res.status(500).json({ error: '삭제에 실패했습니다.' });
  }
});

// 게시글 수정(관리자). 본문만 고친다(패치노트를 다듬는 데 쓴다). 작성자·시각·칸은
// 그대로 둔다. 칸에 맞는 길이 제한으로 내용 검사를 한 번 더 한다.
app.patch('/api/admin/board/:id', requireAdmin, (req, res) => {
  const category = board.categoryOf(req.params.id);
  if (category === undefined) return res.status(404).json({ error: '이미 없는 글입니다.' });

  const maxLen = category === 'patch' ? 6000 : 200;
  const checked = checkMessage(req.body?.body, maxLen);
  if (!checked.ok) return res.status(400).json({ error: checked.reason });

  try {
    if (!board.edit(req.params.id, checked.text)) return res.status(404).json({ error: '이미 없는 글입니다.' });
    res.json({ ok: true, posts: board.latest(100) });
  } catch (err) {
    console.error('게시글 수정 실패:', err);
    res.status(500).json({ error: '수정에 실패했습니다.' });
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
