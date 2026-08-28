// 모든 판의 기록. 최고 기록만 남기는 scores 와 달리, 여기는 한 판 한 판을
// 그대로 쌓는다. 관리자가 "누가 언제 몇 초 버텼는지" 를 시간순으로 훑는 용도다.
//
// 계속 쌓이면 끝없이 커지므로 최근 CAP 개만 남기고 오래된 것부터 지운다.
// 인디 게임 규모에서 이만하면 넉넉하고, 넘으면 자연히 밀려난다.

import { prepareAll } from './db.js';

const CAP = 10000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plays (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  user_id TEXT,
  seconds REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_at ON plays(at DESC);
`;

export function openPlaysStore(db) {
  db.exec(SCHEMA);
  // 예전 표엔 mobile 열이 없다. 있으면 조용히 넘어간다.
  try { db.exec('ALTER TABLE plays ADD COLUMN mobile INTEGER'); } catch { /* 이미 있음 */ }

  const q = prepareAll(db, {
    insert: 'INSERT INTO plays (id, at, name, user_id, seconds, mobile) VALUES (?, ?, ?, ?, ?, ?)',
    // 최근 CAP 개만 남긴다. CAP 번째 뒤(오래된 것)를 지운다.
    trim: `DELETE FROM plays WHERE at < (
             SELECT at FROM plays ORDER BY at DESC LIMIT 1 OFFSET ?
           )`,
    // 시간 역순 한 쪽
    page: 'SELECT id, at, name, user_id, seconds, mobile FROM plays ORDER BY at DESC LIMIT ? OFFSET ?',
    count: 'SELECT COUNT(*) n FROM plays',
    clear: 'DELETE FROM plays'
  });

  const shape = (r) => ({
    id: r.id, at: r.at, name: r.name, seconds: r.seconds, member: r.user_id != null,
    // mobile: 1=폰, 0=PC, null=옛 기록(모름)
    mobile: r.mobile == null ? null : r.mobile === 1
  });

  return {
    add({ name, seconds, userId = null, mobile = null }) {
      const m = mobile == null ? null : (mobile ? 1 : 0);
      q.insert.run(globalThis.crypto.randomUUID(), Date.now(), name, userId, seconds, m);
      q.trim.run(CAP);      // 넘치면 오래된 것부터 밀어낸다
    },

    // 관리 화면용 페이지. { rows, total }
    page(limit = 20, offset = 0) {
      return {
        rows: q.page.all(limit, offset).map(shape),
        total: q.count.get().n
      };
    },

    clear() {
      const n = q.count.get().n;
      q.clear.run();
      return n;
    },

    get size() { return q.count.get().n; }
  };
}
