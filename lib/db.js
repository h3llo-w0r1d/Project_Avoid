// 데이터베이스 한 채. 랭킹·계정·대전기록이 전부 여기 들어간다.
//
// 왜 JSON 파일을 그만뒀나
// ----------------------
// 전에는 저장소마다 JSON 파일 하나를 통째로 읽고, 뭘 하나 바꿀 때마다
// 파일 전체를 다시 썼다. 계정 5만 명이면 파일이 17MB 라, 대전 한 판이
// 끝날 때마다 17MB 를 다시 쓴다(재 봤다: 한 번에 67ms). 쓰기가 줄까지
// 서서, 사람이 몰리는 순간에 제일 느려진다.
//
// SQLite 는 바뀐 줄만 고쳐 쓴다. 파일 하나인 건 똑같아서 백업도 그대로
// 복사하면 되고, 서버를 여러 대로 늘릴 게 아니면 이걸로 충분하다.
//
// node:sqlite 는 Node 에 들어 있다. 따로 설치하거나 빌드할 게 없어서
// 어느 호스팅에 올려도 그대로 돈다. 대신 Node 22 이상이어야 한다.

import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scores (
  id      TEXT PRIMARY KEY,
  name    TEXT    NOT NULL,
  time    REAL    NOT NULL,
  at      INTEGER NOT NULL,
  user_id TEXT,
  runs    INTEGER NOT NULL DEFAULT 1,
  mode    TEXT    NOT NULL DEFAULT 'normal'   -- normal | hardcore, 랭킹을 모드별로 나눈다
);
-- 랭킹은 늘 이 순서로 읽는다. 기록이 같으면 먼저 세운 사람이 위.
CREATE INDEX IF NOT EXISTS scores_rank ON scores(time DESC, at ASC);
CREATE INDEX IF NOT EXISTS scores_name ON scores(name);
CREATE INDEX IF NOT EXISTS scores_user ON scores(user_id);

-- 끝난 시즌의 상위권 (명예의 전당)
CREATE TABLE IF NOT EXISTS hall (
  season TEXT    NOT NULL,
  place  INTEGER NOT NULL,
  name   TEXT    NOT NULL,
  time   REAL    NOT NULL,
  PRIMARY KEY (season, place)
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  provider      TEXT    NOT NULL,
  provider_id   TEXT    NOT NULL,
  nickname      TEXT,
  -- 소문자로 낮춘 닉네임. 대소문자만 다른 이름을 막는 건 인덱스가 한다.
  nickname_key  TEXT,
  created_at    INTEGER NOT NULL,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  season        TEXT,
  season_wins   INTEGER NOT NULL DEFAULT 0,
  season_losses INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  best_streak   INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_provider ON users(provider, provider_id);
-- 랭킹은 늘 "이번 시즌 · 닉네임 있는 계정" 안에서 줄을 세운다.
--
-- WHERE 를 인덱스에 같이 새기는 게 중요하다. 이게 없으면 조건에 맞는지
-- 보려고 후보마다 실제 줄을 꺼내 와야 한다. 5만 명에서 내 순위를 세는 데
-- 71ms 가 걸리던 게 이것 때문이었다.
DROP INDEX IF EXISTS users_rank_wins;
DROP INDEX IF EXISTS users_rank_streak;
CREATE INDEX IF NOT EXISTS users_rank_wins2
  ON users(season, season_wins DESC, season_losses ASC)
  WHERE nickname IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_rank_streak2
  ON users(season, streak DESC)
  WHERE nickname IS NOT NULL;
-- 승률은 계산해서 줄을 세우므로 인덱스가 정렬까지 해 주진 못한다.
-- 식 자체를 인덱스로 만들어 봤지만 계획에 쓰이지 않고 쓰기 비용만 늘어서
-- 되돌렸다. 대신 후보를 좁히는 데만 쓴다.
CREATE INDEX IF NOT EXISTS users_rank_games
  ON users(season, season_wins, season_losses)
  WHERE nickname IS NOT NULL;
DROP INDEX IF EXISTS users_rank_rate;
CREATE INDEX IF NOT EXISTS users_created ON users(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS users_nick ON users(nickname_key)
  WHERE nickname_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  at          INTEGER NOT NULL,
  seconds     REAL    NOT NULL,
  mode        TEXT    NOT NULL,
  draw        INTEGER NOT NULL DEFAULT 0,
  winner_id   TEXT,
  winner_name TEXT,
  loser_id    TEXT,
  loser_name  TEXT
);
CREATE INDEX IF NOT EXISTS matches_at ON matches(at DESC);
CREATE INDEX IF NOT EXISTS matches_winner ON matches(winner_id);
CREATE INDEX IF NOT EXISTS matches_loser ON matches(loser_id);
`;

export async function openDatabase(dir) {
  await mkdir(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'avoidarc.db'));

  // WAL 은 읽기와 쓰기가 서로를 막지 않게 한다. 랭킹을 보는 사람과
  // 기록을 올리는 사람이 겹쳐도 서로 기다리지 않는다.
  db.exec('PRAGMA journal_mode = WAL');
  // NORMAL 은 매 쓰기마다 디스크에 강제로 밀어 넣지 않는다. 전원이 갑자기
  // 나가면 마지막 몇 건을 잃을 수 있지만, 게임 기록에는 그 편이 낫다.
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  // 예전 DB 에는 없던 칸을 뒤늦게 채운다(CREATE TABLE IF NOT EXISTS 는
  // 이미 있는 표에 새 칸을 더해 주지 못한다).
  addColumnIfMissing(db, 'users', 'titles', 'TEXT');        // 장착한 칭호 id 들(JSON)
  addColumnIfMissing(db, 'users', 'title_awards', 'TEXT');  // 이벤트로 얻은 업적 칭호 id 들(JSON)
  // 도전모드(탑)에서 깬 최고 층. 0 이면 아직 1층도 못 깼다.
  addColumnIfMissing(db, 'users', 'challenge', 'INTEGER NOT NULL DEFAULT 0');
  // 룰렛 희귀 보상(0.1~3%)을 뽑은 누적 횟수. 럭키가이·행운의 여신 칭호 조건.
  addColumnIfMissing(db, 'users', 'lucky_hits', 'INTEGER NOT NULL DEFAULT 0');
  // 마지막으로 접속(세션 사용)한 시각. 관리 화면 '최근 접속'.
  addColumnIfMissing(db, 'users', 'last_seen', 'INTEGER');

  return db;
}

// 표에 그 칸이 없으면 ALTER 로 더한다. 이미 있으면 조용히 넘어간다.
function addColumnIfMissing(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// 자주 쓰는 구문은 한 번만 준비해 두고 돌려 쓴다.
// 매번 새로 만들면 SQL 을 매번 다시 해석한다.
export function prepareAll(db, sqls) {
  const out = {};
  for (const [name, sql] of Object.entries(sqls)) out[name] = db.prepare(sql);
  return out;
}

// SQLite 는 true/false 를 모른다. 0/1 로 바꿔 준다.
export const bit = (v) => (v ? 1 : 0);
