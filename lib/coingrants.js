// 관리자가 특정 계정에 준 '코인 지급 대기'.
//
// 코인 잔액 자체는 각자 브라우저(localStorage)에 있어서 서버가 직접 못 바꾼다.
// 그래서 여기 '지급 대기'를 쌓아 두고, 그 사람이 다음에 로그인해 게임을 열 때
// 클라이언트가 받아 가(claim) 자기 지갑에 더한다. 받으면 대기는 0으로 지운다.

import { prepareAll } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coin_grants (
  user_id TEXT PRIMARY KEY,
  amount  INTEGER NOT NULL DEFAULT 0
);
`;

export function openCoinGrants(db) {
  db.exec(SCHEMA);
  // 관리자가 코인과 함께 보내는 한 줄 멘트. 예전 DB 에 없으면 더한다.
  try { db.exec('ALTER TABLE coin_grants ADD COLUMN message TEXT'); } catch { /* 이미 있음 */ }

  const q = prepareAll(db, {
    // 있으면 더하고, 없으면 새로 넣는다. 멘트는 최신 것으로 덮어쓴다.
    add: `INSERT INTO coin_grants (user_id, amount, message) VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET amount = amount + excluded.amount, message = excluded.message`,
    get: 'SELECT amount, message FROM coin_grants WHERE user_id = ?',
    clear: 'DELETE FROM coin_grants WHERE user_id = ?',
    all: 'SELECT user_id, amount FROM coin_grants'
  });

  return {
    // 지급 대기에 코인을 더한다(선택: 한 줄 멘트). 여러 번 주면 멘트는 최신 것.
    grant(userId, amount, message = '') {
      q.add.run(userId, Math.max(0, Math.floor(amount)), String(message || '').slice(0, 100));
      return q.get.get(userId)?.amount ?? 0;
    },

    // 지금 대기 중인 코인(표시용).
    pending(userId) {
      return q.get.get(userId)?.amount ?? 0;
    },

    // userId -> 대기 코인 맵(관리 목록에 함께 보여 주려고).
    pendingMap() {
      const m = new Map();
      for (const r of q.all.all()) m.set(r.user_id, r.amount);
      return m;
    },

    // 받아 간다: 대기 코인과 멘트를 돌려주고 0으로 지운다.
    claim(userId) {
      const r = q.get.get(userId);
      const n = r?.amount ?? 0;
      if (n > 0) q.clear.run(userId);
      return { amount: n, message: n > 0 ? (r?.message ?? '') : '' };
    },

    // 관리자: 실수로 준 대기 코인을 취소한다(아직 안 받아갔을 때만 효과).
    // 이미 받아간 코인은 각자 브라우저에 있어 서버가 되돌릴 수 없다.
    revoke(userId) {
      q.clear.run(userId);
      return 0;
    }
  };
}
