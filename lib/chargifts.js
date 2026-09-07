// 개발자가 특정 계정에 준 캐릭터.
//
// 왜 지갑(users.owned)에 안 넣는가: 지갑은 클라이언트가 값을 정하는 구조다
// (/api/me/wallet 이 받은 걸 그대로 저장한다 — 그 주석에도 조작 방지 장치가
// 아니라고 적혀 있다). 거기 넣으면 누구나 자기에게 캐릭터를 줄 수 있다.
// 선물은 '그 사람만' 쓸 수 있어야 하므로 서버만 쓰는 자리에 둔다.
//
// 코인 선물(coingrants)과 다른 점: 코인은 받아 가면 대기가 지워지지만,
// 캐릭터는 받은 뒤에도 계속 갖고 있어야 한다. 그래서 줄을 지우지 않고
// claimed_at 만 찍는다 — 줄이 있으면 소유, claimed_at 이 비면 아직
// 선물 창을 안 본 것.

import { prepareAll } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS char_gifts (
  user_id    TEXT    NOT NULL,
  char_id    TEXT    NOT NULL,
  message    TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (user_id, char_id)
);
`;

export function openCharGifts(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    // 다시 주면 멘트만 새로 하고, 선물 창을 한 번 더 띄운다(claimed_at 비움).
    add: `INSERT INTO char_gifts (user_id, char_id, message, created_at, claimed_at)
          VALUES (?, ?, ?, ?, NULL)
          ON CONFLICT(user_id, char_id)
          DO UPDATE SET message = excluded.message, claimed_at = NULL`,
    ownedBy:   'SELECT char_id FROM char_gifts WHERE user_id = ?',
    unclaimed: 'SELECT char_id, message FROM char_gifts WHERE user_id = ? AND claimed_at IS NULL',
    markSeen:  'UPDATE char_gifts SET claimed_at = ? WHERE user_id = ? AND claimed_at IS NULL',
    remove:    'DELETE FROM char_gifts WHERE user_id = ? AND char_id = ?',
    all: `SELECT user_id, char_id, message, created_at, claimed_at
          FROM char_gifts ORDER BY created_at DESC`
  });

  return {
    // 캐릭터 하나를 계정에 준다. 선물 창은 다음 접속 때 뜬다.
    grant(userId, charId, message = '') {
      q.add.run(String(userId), String(charId),
        String(message || '').slice(0, 100), Date.now());
      return this.ownedBy(userId);
    },

    // 이 계정이 선물로 받은 캐릭터 id 들. 해금 판정이 이걸 본다.
    // 선물 창을 봤든 안 봤든 소유는 소유다.
    ownedBy(userId) {
      return q.ownedBy.all(String(userId)).map((r) => r.char_id);
    },

    // 아직 선물 창을 안 띄운 것들을 돌려주고, 봤다고 찍는다.
    // 소유는 그대로 남는다 — 줄을 지우지 않는다.
    claim(userId) {
      const rows = q.unclaimed.all(String(userId));
      if (rows.length) q.markSeen.run(Date.now(), String(userId));
      return rows.map((r) => ({ charId: r.char_id, message: r.message ?? '' }));
    },

    // 잘못 준 걸 거둔다.
    revoke(userId, charId) {
      q.remove.run(String(userId), String(charId));
      return this.ownedBy(userId);
    },

    // 관리용 전체 목록.
    all() {
      return q.all.all().map((r) => ({
        userId: r.user_id, charId: r.char_id, message: r.message ?? '',
        createdAt: r.created_at, claimedAt: r.claimed_at
      }));
    }
  };
}
