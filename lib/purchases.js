// 코인으로 산 캐릭터 기록. "누가 언제 무엇을 샀는지" 를 시간순으로 남긴다.
//
// 코인·해금은 클라이언트(브라우저)에서 처리하므로 이 기록은 참고용이다.
// 서버가 강제하는 값이 아니라, 관리자가 구매 흐름을 눈으로 보려는 용도.
// 이름은 로그인한 사람은 서버가 아는 닉네임으로 덮어써 사칭을 막는다(server.js).

import { prepareAll } from './db.js';

const CAP = 10000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS purchases (
  id        TEXT PRIMARY KEY,
  at        INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  user_id   TEXT,                    -- 로그인 계정이면 id, 게스트면 NULL
  character TEXT    NOT NULL,        -- 캐릭터 id
  char_name TEXT    NOT NULL,        -- 캐릭터 이름(표시용)
  cost      INTEGER NOT NULL         -- 코인 가격
);
CREATE INDEX IF NOT EXISTS purchases_at ON purchases(at DESC);
`;

export function openPurchasesStore(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    insert: `INSERT INTO purchases (id, at, name, user_id, character, char_name, cost)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
    trim: `DELETE FROM purchases WHERE at < (
             SELECT at FROM purchases ORDER BY at DESC LIMIT 1 OFFSET ?
           )`,
    page: `SELECT id, at, name, user_id, character, char_name, cost
           FROM purchases ORDER BY at DESC LIMIT ? OFFSET ?`,
    count: 'SELECT COUNT(*) n FROM purchases',
    removeOne: 'DELETE FROM purchases WHERE id = ?'
  });

  const shape = (r) => ({
    id: r.id, at: r.at, name: r.name, member: r.user_id != null,
    character: r.character, charName: r.char_name, cost: r.cost
  });

  return {
    add({ name, userId = null, character, charName, cost }) {
      q.insert.run(globalThis.crypto.randomUUID(), Date.now(), name, userId, character, charName, cost);
      q.trim.run(CAP);
    },

    page(limit = 20, offset = 0) {
      return { rows: q.page.all(limit, offset).map(shape), total: q.count.get().n };
    },

    remove(id) { return q.removeOne.run(id).changes > 0; },

    get size() { return q.count.get().n; }
  };
}
