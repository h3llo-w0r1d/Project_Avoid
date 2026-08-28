// 코인 룰렛 기록. "누가 언제 얼마를 걸어 무엇이 나왔는지" 를 시간순으로 남긴다.
//
// 코인·룰렛은 클라이언트(브라우저)에서 처리하므로 이 기록은 참고용이다.
// 서버가 강제하는 값이 아니라, 관리자가 룰렛 흐름을 눈으로 보려는 용도.
// 이름은 로그인한 사람은 서버가 아는 닉네임으로 덮어써 사칭을 막는다(server.js).

import { prepareAll } from './db.js';

const CAP = 10000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spins (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  user_id TEXT,                    -- 로그인 계정이면 id, 게스트면 NULL
  cost    INTEGER NOT NULL,        -- 건 코인(한 번 값)
  reward  INTEGER NOT NULL         -- 받은 코인(0이면 꽝)
);
CREATE INDEX IF NOT EXISTS spins_at ON spins(at DESC);
`;

export function openSpinsStore(db) {
  db.exec(SCHEMA);
  // 예전 표엔 prize 열이 없다. 특별 당첨(예: '노래')을 남기려고 더한다.
  try { db.exec('ALTER TABLE spins ADD COLUMN prize TEXT'); } catch { /* 이미 있음 */ }

  const q = prepareAll(db, {
    insert: 'INSERT INTO spins (id, at, name, user_id, cost, reward, prize) VALUES (?, ?, ?, ?, ?, ?, ?)',
    trim: `DELETE FROM spins WHERE at < (
             SELECT at FROM spins ORDER BY at DESC LIMIT 1 OFFSET ?
           )`,
    page: `SELECT id, at, name, user_id, cost, reward, prize
           FROM spins ORDER BY at DESC LIMIT ? OFFSET ?`,
    count: 'SELECT COUNT(*) n FROM spins',
    sums: 'SELECT COALESCE(SUM(cost),0) cost, COALESCE(SUM(reward),0) reward FROM spins',
    removeOne: 'DELETE FROM spins WHERE id = ?'
  });

  const shape = (r) => ({
    id: r.id, at: r.at, name: r.name, member: r.user_id != null,
    cost: r.cost, reward: r.reward, prize: r.prize ?? null
  });

  return {
    add({ name, userId = null, cost, reward, prize = null }) {
      q.insert.run(globalThis.crypto.randomUUID(), Date.now(), name, userId, cost, reward, prize || null);
      q.trim.run(CAP);
    },

    page(limit = 20, offset = 0) {
      const s = q.sums.get();
      return {
        rows: q.page.all(limit, offset).map(shape),
        total: q.count.get().n,
        totalCost: s.cost, totalReward: s.reward
      };
    },

    remove(id) { return q.removeOne.run(id).changes > 0; },

    get size() { return q.count.get().n; }
  };
}
