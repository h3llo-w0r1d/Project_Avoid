// 도전모드(층 오르기)·봇전 기록. "누가 언제 무엇을 했고 성공했는지"를 시간순으로.
//
// 판정은 클라이언트가 하므로 이 기록도 참고용이다(코인·룰렛과 같은 신뢰 모델).
// 이름은 로그인한 사람은 서버 닉네임으로 덮어써 사칭을 막는다(server.js).

import { prepareAll } from './db.js';

const CAP = 10000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS challenge_log (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  user_id TEXT,                    -- 로그인 계정이면 id, 게스트면 NULL
  floor   INTEGER NOT NULL,        -- 도전한 층
  goal    TEXT,                    -- 그 층 조건(사람이 읽는 문구)
  ok      INTEGER NOT NULL,        -- 1=성공, 0=실패
  seconds REAL    NOT NULL         -- 그 판에서 버틴 시간
);
CREATE INDEX IF NOT EXISTS challenge_log_at ON challenge_log(at DESC);

CREATE TABLE IF NOT EXISTS bot_log (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  user_id TEXT,
  tier    TEXT    NOT NULL,        -- 봇 난이도(초보~고인물)
  win     INTEGER NOT NULL,        -- 1=내가 이김, 0=짐
  seconds REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_log_at ON bot_log(at DESC);

CREATE TABLE IF NOT EXISTS title_log (
  id       TEXT PRIMARY KEY,
  at       INTEGER NOT NULL,
  name     TEXT    NOT NULL,
  user_id  TEXT,
  title_id TEXT    NOT NULL,       -- 칭호 id(rookie, luckyguy ...)
  title    TEXT    NOT NULL,       -- 칭호 이름(입문자, 럭키가이 ...)
  how      TEXT    NOT NULL        -- 어떻게 얻었나(판수/룰렛 등)
);
CREATE INDEX IF NOT EXISTS title_log_at ON title_log(at DESC);

-- 닉네임을 바꾼 기록. name 칸은 다른 표와 맞추려고 '바꾼 뒤 이름'을 넣는다.
CREATE TABLE IF NOT EXISTS rename_log (
  id        TEXT PRIMARY KEY,
  at        INTEGER NOT NULL,
  name      TEXT    NOT NULL,     -- 바꾼 뒤 이름(= to_name 과 같다)
  user_id   TEXT,
  from_name TEXT,                 -- 바꾸기 전 이름. 처음 정하는 경우 NULL
  to_name   TEXT    NOT NULL      -- 바꾼 뒤 이름
);
CREATE INDEX IF NOT EXISTS rename_log_at ON rename_log(at DESC);
`;

// 두 표가 구조가 거의 같아 같은 틀로 만든다.
function makeStore(db, table, cols, shape) {
  const list = ['id', 'at', 'name', 'user_id', ...cols];
  const marks = list.map(() => '?').join(', ');
  const q = prepareAll(db, {
    insert: `INSERT INTO ${table} (${list.join(', ')}) VALUES (${marks})`,
    trim: `DELETE FROM ${table} WHERE at < (
             SELECT at FROM ${table} ORDER BY at DESC LIMIT 1 OFFSET ?
           )`,
    page: `SELECT ${list.join(', ')} FROM ${table} ORDER BY at DESC LIMIT ? OFFSET ?`,
    count: `SELECT COUNT(*) n FROM ${table}`,
    clear: `DELETE FROM ${table}`
  });
  return {
    add(row) {
      q.insert.run(globalThis.crypto.randomUUID(), Date.now(), row.name,
        row.userId ?? null, ...cols.map((c) => row[c]));
      q.trim.run(CAP);
    },
    page(limit = 20, offset = 0) {
      return { rows: q.page.all(limit, offset).map(shape), total: q.count.get().n };
    },
    clear() { const n = q.count.get().n; q.clear.run(); return n; },
    get size() { return q.count.get().n; }
  };
}

export function openModeLogs(db) {
  db.exec(SCHEMA);
  return {
    challenge: makeStore(db, 'challenge_log', ['floor', 'goal', 'ok', 'seconds'], (r) => ({
      id: r.id, at: r.at, name: r.name, member: r.user_id != null,
      floor: r.floor, goal: r.goal ?? '', ok: r.ok === 1, seconds: r.seconds
    })),
    bot: makeStore(db, 'bot_log', ['tier', 'win', 'seconds'], (r) => ({
      id: r.id, at: r.at, name: r.name, member: r.user_id != null,
      tier: r.tier, win: r.win === 1, seconds: r.seconds
    })),
    title: makeStore(db, 'title_log', ['title_id', 'title', 'how'], (r) => ({
      id: r.id, at: r.at, name: r.name, member: r.user_id != null,
      titleId: r.title_id, title: r.title, how: r.how
    })),
    rename: makeStore(db, 'rename_log', ['from_name', 'to_name'], (r) => ({
      id: r.id, at: r.at, name: r.name, member: r.user_id != null,
      from: r.from_name ?? null, to: r.to_name
    }))
  };
}
