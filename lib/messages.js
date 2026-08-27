// 관리자 ↔ 유저 1:1 메시지(쪽지/문의).
//
// 계정(user_id)별로 한 대화방. 관리자가 보내면 유저가 다음에 접속했을 때 우측
// 하단 위젯에서 보고 답장한다(폴링). 실시간 소켓은 안 쓴다 — 자주 오가는 게
// 아니라 폴링이면 충분하고 서버 부담도 적다.

import { prepareAll } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT    NOT NULL,           -- 대화 상대(계정)
  sender     TEXT    NOT NULL,           -- 'admin' | 'user'
  text       TEXT    NOT NULL,
  at         INTEGER NOT NULL,
  seen_admin INTEGER NOT NULL DEFAULT 0, -- 관리자가 읽었나
  seen_user  INTEGER NOT NULL DEFAULT 0  -- 유저가 읽었나
);
CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id, at);
`;

export function openMessages(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    insert: `INSERT INTO messages (id, user_id, sender, text, at, seen_admin, seen_user)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
    forUser: 'SELECT id, sender, text, at FROM messages WHERE user_id = ? ORDER BY at ASC LIMIT 200',
    unreadUser: "SELECT COUNT(*) n FROM messages WHERE user_id = ? AND sender = 'admin' AND seen_user = 0",
    seenUser: "UPDATE messages SET seen_user = 1 WHERE user_id = ? AND sender = 'admin'",
    seenAdmin: "UPDATE messages SET seen_admin = 1 WHERE user_id = ? AND sender = 'user'",
    inbox: `SELECT user_id,
              MAX(at) AS lastAt,
              SUM(CASE WHEN sender='user' AND seen_admin=0 THEN 1 ELSE 0 END) AS unread,
              (SELECT text FROM messages m2 WHERE m2.user_id = m1.user_id ORDER BY at DESC LIMIT 1) AS lastText
            FROM messages m1 GROUP BY user_id ORDER BY lastAt DESC LIMIT 100`
  });

  return {
    add({ userId, sender, text }) {
      const admin = sender === 'admin';
      q.insert.run(globalThis.crypto.randomUUID(), userId, sender, text, Date.now(),
        admin ? 1 : 0, admin ? 0 : 1);
    },
    forUser(userId) { return q.forUser.all(userId); },
    unreadForUser(userId) { return q.unreadUser.get(userId)?.n ?? 0; },
    markUserSeen(userId) { q.seenUser.run(userId); },
    markAdminSeen(userId) { q.seenAdmin.run(userId); },
    inbox() {
      return q.inbox.all().map((r) => ({
        userId: r.user_id, lastAt: r.lastAt, unread: r.unread, lastText: r.lastText
      }));
    }
  };
}
