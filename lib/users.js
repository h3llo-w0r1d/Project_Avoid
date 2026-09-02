// 계정과 로그인 세션.
//
// 전에는 JSON 파일 하나에 계정과 세션을 모두 담고, 뭘 하나 바꿀 때마다
// 파일 전체를 다시 썼다. 5만 명이면 17MB 를 매번 다시 쓴다(재 봤다: 67ms).
// 지금은 바뀐 줄만 고친다.

import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDatabase, prepareAll } from './db.js';
import { seasonOf } from './season.js';

const SESSION_DAYS = 60;

export async function openUserStore(dir, shared = null) {
  const db = shared ?? await openDatabase(dir);

  const q = prepareAll(db, {
    byProvider: 'SELECT * FROM users WHERE provider = ? AND provider_id = ?',
    byId: 'SELECT * FROM users WHERE id = ?',
    byNickKey: 'SELECT * FROM users WHERE nickname_key = ?',
    nickTaken: 'SELECT 1 FROM users WHERE nickname_key = ? AND id <> ? LIMIT 1',

    insert: `INSERT INTO users
      (id, provider, provider_id, nickname, nickname_key, created_at,
       wins, losses, season, season_wins, season_losses, streak, best_streak)
      VALUES (?, ?, ?, NULL, NULL, ?, 0, 0, ?, 0, 0, 0, 0)`,

    setNick: 'UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?',
    setTitles: 'UPDATE users SET titles = ? WHERE id = ?',
    setAwards: 'UPDATE users SET title_awards = ? WHERE id = ?',
    // 도전모드: 깬 최고 층. 뒤로 가지 않게 MAX 로만 올린다.
    setChallenge: 'UPDATE users SET challenge = MAX(challenge, ?) WHERE id = ?',
    // 룰렛 희귀 보상(0.1~3%)을 뽑은 누적 횟수 +1
    bumpLucky: 'UPDATE users SET lucky_hits = lucky_hits + 1 WHERE id = ?',

    // 시즌이 바뀐 계정의 이번 시즌 칸을 0 으로 내린다.
    // 달이 바뀌는 순간에 전 계정을 훑지 않는다 — 그 시각에 서버가 떠
    // 있으리란 보장이 없고, 몇 달 꺼져 있다 켜질 수도 있다.
    freshOne: `UPDATE users SET season = ?, season_wins = 0, season_losses = 0, streak = 0
               WHERE id = ? AND (season IS NULL OR season <> ?)`,

    win: `UPDATE users SET wins = wins + 1, season_wins = season_wins + 1,
            streak = streak + 1,
            best_streak = MAX(best_streak, streak + 1) WHERE id = ?`,
    lose: `UPDATE users SET losses = losses + 1, season_losses = season_losses + 1,
            streak = 0 WHERE id = ?`,

    resetRecord: `UPDATE users SET wins = 0, losses = 0, season_wins = 0,
                    season_losses = 0, streak = 0, best_streak = 0, season = ?
                  WHERE id = ?`,

    listAccounts: `SELECT * FROM users ORDER BY created_at DESC`,

    // 랭킹. 정렬과 걸러내기를 전부 SQL 이 한다 — 계정이 늘어도
    // 전부 메모리로 끌어와 훑지 않는다.
    winRanking: `SELECT id, nickname AS name, season_wins AS wins, season_losses AS losses
                 FROM users
                 WHERE season = ? AND nickname IS NOT NULL AND season_wins > 0
                 ORDER BY season_wins DESC, season_losses ASC
                 LIMIT ?`,
    // 내 순위 = 나보다 앞선 사람 수 + 1. 목록을 통째로 받아 내 자리를
    // 찾으면 계정이 늘수록 느려진다 — 5만 명이면 4만 8천 개의 객체를
    // 만들어 놓고 100개만 쓰고 버리게 된다.
    winRankOf: `SELECT COUNT(*) n FROM users
                WHERE season = ?1 AND nickname IS NOT NULL AND season_wins > 0
                  AND (season_wins > ?2 OR (season_wins = ?2 AND season_losses < ?3))`,
    rateRanking: `SELECT id, nickname AS name, season_wins AS wins, season_losses AS losses,
                    (season_wins + season_losses) AS games,
                    CAST(season_wins AS REAL) / (season_wins + season_losses) AS rate
                  FROM users
                  WHERE season = ? AND nickname IS NOT NULL
                    AND (season_wins + season_losses) >= ?
                  ORDER BY rate DESC, games DESC
                  LIMIT ?`,
    rateRankOf: `SELECT COUNT(*) n FROM users
                 WHERE season = ?1 AND nickname IS NOT NULL
                   AND (season_wins + season_losses) >= ?2
                   AND (CAST(season_wins AS REAL) / (season_wins + season_losses) > ?3
                     OR (CAST(season_wins AS REAL) / (season_wins + season_losses) = ?3
                         AND (season_wins + season_losses) > ?4))`,
    streakRanking: `SELECT id, nickname AS name, streak
                    FROM users
                    WHERE season = ? AND nickname IS NOT NULL AND streak >= 2
                    ORDER BY streak DESC
                    LIMIT ?`,
    streakRankOf: `SELECT COUNT(*) n FROM users
                   WHERE season = ? AND nickname IS NOT NULL AND streak >= 2
                     AND streak > ?`,

    // 도전모드(탑) 랭킹 — 시즌과 무관한 통산 진행도. 같은 층이면 먼저 깬 사람이 위.
    towerRanking: `SELECT id, nickname AS name, challenge AS floor
                   FROM users
                   WHERE nickname IS NOT NULL AND challenge > 0
                   ORDER BY challenge DESC, created_at ASC
                   LIMIT ?`,
    towerRankOf: `SELECT COUNT(*) n FROM users
                  WHERE nickname IS NOT NULL AND challenge > ?`,

    addSession: 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    sessionUser: `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token = ? AND s.expires_at > ?`,
    dropSession: 'DELETE FROM sessions WHERE token = ?',
    dropExpired: 'DELETE FROM sessions WHERE expires_at <= ?',

    countUsers: 'SELECT COUNT(*) n FROM users',
    countSessions: 'SELECT COUNT(*) n FROM sessions'
  });

  // 만료된 세션은 시작할 때 걷어낸다
  q.dropExpired.run(Date.now());

  // 표의 한 줄을 예전 코드가 쓰던 모양으로 되돌린다.
  // 바깥(server.js, lobby.js)은 이 모양만 알고 있으면 된다.
  //
  // 지난 시즌 값이 남아 있으면 0 으로 보여 준다. **읽으면서 고치지는
  // 않는다** — 랭킹을 열 때마다 전 계정을 UPDATE 하면 계정이 늘수록
  // 느려진다(5만 명에서 46ms 를 찍었다). 파일에 실제로 내려 쓰는 건
  // 그 계정의 전적이 바뀌는 순간(recordMatch)에만 한다.
  const shape = (r) => {
    if (!r) return r;
    const stale = r.season !== seasonOf();
    return {
      id: r.id,
      provider: r.provider,
      providerId: r.provider_id,
      nickname: r.nickname,
      createdAt: r.created_at,
      wins: r.wins,
      losses: r.losses,
      season: stale ? seasonOf() : r.season,
      seasonWins: stale ? 0 : r.season_wins,
      seasonLosses: stale ? 0 : r.season_losses,
      streak: stale ? 0 : r.streak,
      bestStreak: r.best_streak,
      titles: parseTitles(r.titles),        // 장착한 칭호 id 배열
      awards: parseTitles(r.title_awards),  // 이벤트로 얻은 업적 칭호 id 배열
      challenge: r.challenge ?? 0,          // 도전모드에서 깬 최고 층
      luckyHits: r.lucky_hits ?? 0          // 룰렛 희귀 보상 누적 횟수
    };
  };

  // titles/title_awards 칸(JSON 문자열)을 배열로. 비었거나 깨졌으면 빈 배열.
  function parseTitles(raw) {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }

  // 이 계정의 시즌 칸을 지금 시즌으로 맞춘다 (쓰기 경로에서만 부른다)
  function fresh(id) {
    const now = seasonOf();
    q.freshOne.run(now, id, now);
  }

  const publicUser = (u) => {
    if (!u) return u;
    const r = shape(q.byId.get(u.id));
    if (!r) return null;
    return {
      id: r.id,
      nickname: r.nickname,
      provider: r.provider,
      wins: r.wins,                  // 통산
      losses: r.losses,
      seasonWins: r.seasonWins,      // 이번 시즌
      seasonLosses: r.seasonLosses,
      streak: r.streak,              // 지금 몇 연승 중인지
      bestStreak: r.bestStreak,
      season: r.season ?? seasonOf(),
      titles: r.titles,             // 장착한 칭호 id 배열
      awards: r.awards              // 이벤트로 얻은 업적 칭호 id 배열
    };
  };

  return {
    // 로그인할 때마다 부른다. 처음이면 만들고, 있으면 그대로 돌려준다.
    // 계정을 가르는 열쇠는 (제공자, 제공자쪽 사용자 ID) 쌍이다.
    // 이메일로 가르면 사용자가 이메일을 바꿨을 때 남남이 된다.
    async upsert(provider, providerId) {
      const found = q.byProvider.get(provider, providerId);
      if (found) return shape(found);

      const id = randomUUID();
      q.insert.run(id, provider, providerId, Date.now(), seasonOf());
      return shape(q.byId.get(id));
    },

    byId(id) {
      // SQLite 는 undefined 를 바인딩하지 못하고 예외를 던진다.
      // 없는 값으로 물어보는 건 흔한 일이라 여기서 걸러 낸다.
      if (typeof id !== 'string' || !id) return null;
      return shape(q.byId.get(id)) ?? null;
    },

    // 닉네임으로 찾는다. 대소문자는 무시한다 — 저장할 때도 그렇게 막았다.
    byNickname(nickname) {
      const key = String(nickname ?? '').toLowerCase();
      if (!key) return null;
      return shape(q.byNickKey.get(key)) ?? null;
    },

    // 대소문자를 무시하고 겹치는지 본다. 'Alex' 와 'alex' 가 따로 있으면
    // 랭킹에서 누가 누군지 알 수 없다.
    nicknameTaken(nickname, exceptUserId = null) {
      return !!q.nickTaken.get(String(nickname).toLowerCase(), exceptUserId ?? '');
    },

    async setNickname(userId, nickname) {
      const changed = q.setNick.run(nickname, nickname.toLowerCase(), userId).changes;
      return changed ? shape(q.byId.get(userId)) : null;
    },

    // 장착한 칭호 id 배열을 저장한다(JSON). 검증은 호출부(server)에서 한다.
    setTitles(userId, ids) {
      q.setTitles.run(JSON.stringify(Array.isArray(ids) ? ids : []), userId);
      return shape(q.byId.get(userId));
    },

    // 도전모드(탑) 랭킹 상위 목록.
    towerRanking(limit = 100) {
      return q.towerRanking.all(limit);
    },

    // 그 층수면 몇 위인지(나보다 높은 층 수 + 1).
    towerRankOf(floor) {
      if (!(floor > 0)) return null;
      return q.towerRankOf.get(floor).n + 1;
    },

    // 룰렛 희귀 보상을 하나 뽑았다. 늘어난 누적 횟수를 돌려준다.
    bumpLuckyHit(userId) {
      q.bumpLucky.run(userId);
      return shape(q.byId.get(userId))?.luckyHits ?? 0;
    },

    // 도전모드에서 깬 최고 층을 올린다(내려가지 않는다). 새 층수를 돌려준다.
    setChallenge(userId, floor) {
      q.setChallenge.run(Math.max(0, Math.floor(floor)), userId);
      return shape(q.byId.get(userId))?.challenge ?? 0;
    },

    // 업적 칭호 하나를 계정에 새긴다. 이미 있으면 그대로 두고 fresh=false.
    // { user, fresh } 를 돌려준다(fresh 면 이번에 처음 얻은 것 — 축하용).
    awardTitle(userId, id) {
      const cur = shape(q.byId.get(userId));
      if (!cur) return { user: null, fresh: false };
      const have = cur.awards ?? [];
      if (have.includes(id)) return { user: cur, fresh: false };
      const next = [...have, id];
      q.setAwards.run(JSON.stringify(next), userId);
      return { user: shape(q.byId.get(userId)), fresh: true };
    },

    // 관리 화면에서 쓸 계정 목록. 최근에 만든 것부터.
    // providerId(구글이 준 식별자)는 내보내지 않는다 — 관리에 필요 없고,
    // 새어 나가면 그 사람을 다른 서비스에서 특정하는 데 쓰일 수 있다.
    listAccounts() {
      return q.listAccounts.all().map(shape).map((r) => ({
        id: r.id,
        nickname: r.nickname,
        provider: r.provider,
        createdAt: r.createdAt,
        wins: r.wins,
        losses: r.losses,
        seasonWins: r.seasonWins,
        seasonLosses: r.seasonLosses,
        streak: r.streak,
        bestStreak: r.bestStreak
      }));
    },

    // 전적만 0 으로 되돌린다. 계정과 닉네임은 그대로 둔다.
    async resetRecord(userId) {
      const changed = q.resetRecord.run(seasonOf(), userId).changes;
      return changed ? publicUser({ id: userId }) : null;
    },

    // ---------------------------------------------------------------- 대전 랭킹

    // 대전 랭킹은 이번 시즌 전적으로 매긴다. 통산은 계정 화면에만 쓴다.
    // 통산으로 매기면 일찍 시작한 사람이 영원히 위에 있어 랭킹이 굳는다.

    winRanking(limit = 100) {
      return q.winRanking.all(seasonOf(), limit);
    },

    // 판수가 적으면 빼는 이유는 한 판 이기고 100% 로 1위가 되는 걸
    // 막기 위해서다. 같은 승률이면 많이 싸운 쪽이 위다.
    rateRanking(minGames, limit = 100) {
      return q.rateRanking.all(seasonOf(), minGames, limit);
    },

    // 지금 달리고 있는 연승만 센다 — 끊기면 0 으로 떨어진다.
    streakRanking(limit = 100) {
      return q.streakRanking.all(seasonOf(), limit);
    },

    // 이 사람이 각 랭킹에서 몇 위인지. 100위 밖이라 목록에 없어도 알 수 있다.
    rankIn(board, userId, minGames = 0) {
      const u = this.byId(userId);
      if (!u || !u.nickname) return null;
      const now = seasonOf();
      const games = u.seasonWins + u.seasonLosses;

      if (board === 'wins') {
        if (u.seasonWins <= 0) return null;
        return {
          rank: q.winRankOf.get(now, u.seasonWins, u.seasonLosses).n + 1,
          id: u.id, name: u.nickname, wins: u.seasonWins, losses: u.seasonLosses
        };
      }
      if (board === 'rate') {
        if (games < minGames || games === 0) return null;
        const rate = u.seasonWins / games;
        return {
          rank: q.rateRankOf.get(now, minGames, rate, games).n + 1,
          id: u.id, name: u.nickname, wins: u.seasonWins, losses: u.seasonLosses,
          games, rate
        };
      }
      if (board === 'streak') {
        if (u.streak < 2) return null;
        return {
          rank: q.streakRankOf.get(now, u.streak).n + 1,
          id: u.id, name: u.nickname, streak: u.streak
        };
      }
      return null;
    },

    async recordMatch(winnerId, loserId) {
      if (winnerId) {
        fresh(winnerId);
        q.win.run(winnerId);
      }
      if (loserId) {
        fresh(loserId);
        q.lose.run(loserId);
      }
    },

    // ---------------------------------------------------------------- 세션

    async createSession(userId) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_DAYS * 86400_000;
      q.addSession.run(token, userId, expiresAt);
      return { token, userId, expiresAt };
    },

    // 토큰으로 사용자를 찾는다. 만료됐으면 null.
    userForToken(token) {
      if (!token) return null;
      return shape(q.sessionUser.get(token, Date.now())) ?? null;
    },

    async destroySession(token) {
      q.dropSession.run(token);
    },

    publicUser,

    get stats() {
      return { users: q.countUsers.get().n, sessions: q.countSessions.get().n };
    }
  };
}

export { SESSION_DAYS };

// ---------------------------------------------------------------- 이사

export async function importUsersJson(db, dir) {
  const file = join(dir, 'users.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return 0;
  }
  const users = Array.isArray(parsed?.users) ? parsed.users : [];
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  if (users.length === 0 && sessions.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO users
     (id, provider, provider_id, nickname, nickname_key, created_at,
      wins, losses, season, season_wins, season_losses, streak, best_streak)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const addSession = db.prepare(
    'INSERT OR IGNORE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  );

  let n = 0;
  for (const u of users) {
    if (!u?.id) continue;
    insert.run(
      u.id, u.provider ?? 'google', u.providerId ?? u.id,
      u.nickname ?? null, u.nickname ? String(u.nickname).toLowerCase() : null,
      Number(u.createdAt ?? Date.now()),
      Number(u.wins ?? 0), Number(u.losses ?? 0),
      u.season ?? null, Number(u.seasonWins ?? 0), Number(u.seasonLosses ?? 0),
      Number(u.streak ?? 0), Number(u.bestStreak ?? 0)
    );
    n++;
  }
  for (const s of sessions) {
    if (!s?.token || !s?.userId) continue;
    addSession.run(s.token, s.userId, Number(s.expiresAt ?? 0));
  }

  await rename(file, `${file}.imported`);
  return n;
}
