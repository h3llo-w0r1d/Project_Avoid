// 다시보기 기록. 최고 기록 한 판을 (seed + 프레임별 입력)으로 담아 둔다.
//
// 게임 시뮬(shared/beams·player-physics)이 순수 함수라, 같은 seed 에 같은
// 입력을 다시 먹이면 그 판이 그대로 재현된다. 그래서 화면 영상을 통째로
// 저장하지 않고 입력만 담는다 — 몇십 KB 면 충분하다(gzip 으로 더 줄인다).
//
// 점수 한 줄(scores.id)에 하나씩 매단다. 최고 기록이 갱신되면 그 줄의
// 다시보기도 새 판으로 교체된다. 점수 줄이 지워지면 같이 지운다.
// 관리자만 본다(조회는 requireAdmin, 저장은 자기 기록만).

import { prepareAll } from './db.js';

const CAP = 2000;   // 저장해 둘 다시보기 최대 개수(넘으면 오래된 것부터 버린다)

const SCHEMA = `
CREATE TABLE IF NOT EXISTS replays (
  score_id TEXT PRIMARY KEY,
  at       INTEGER NOT NULL,
  name     TEXT    NOT NULL,
  user_id  TEXT,
  mode     TEXT    NOT NULL,
  time     REAL    NOT NULL,
  seed     INTEGER NOT NULL,
  frames   INTEGER NOT NULL,
  gz       BLOB    NOT NULL      -- gzip 압축한 입력 버퍼
);
CREATE INDEX IF NOT EXISTS replays_at ON replays(at DESC);
`;

export function openReplaysStore(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    put: `INSERT OR REPLACE INTO replays
            (score_id, at, name, user_id, mode, time, seed, frames, gz)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    get: 'SELECT score_id, name, user_id, mode, time, seed, frames, gz FROM replays WHERE score_id = ?',
    has: 'SELECT 1 FROM replays WHERE score_id = ?',
    remove: 'DELETE FROM replays WHERE score_id = ?',
    count: 'SELECT COUNT(*) n FROM replays',
    trim: `DELETE FROM replays WHERE at < (
             SELECT at FROM replays ORDER BY at DESC LIMIT 1 OFFSET ?
           )`
  });

  return {
    put({ scoreId, name, userId = null, mode, time, seed, frames, gz }) {
      q.put.run(scoreId, Date.now(), name, userId ?? null, mode, time, seed, frames, gz);
      q.trim.run(CAP);
    },

    get(scoreId) { return q.get.get(scoreId) ?? null; },
    has(scoreId) { return Boolean(q.has.get(scoreId)); },
    remove(scoreId) { return q.remove.run(scoreId).changes > 0; },

    get size() { return q.count.get().n; }
  };
}
