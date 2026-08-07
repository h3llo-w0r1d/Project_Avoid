// 자유 게시판. 유저가 짧은 글을 남긴다.
//
// 공개 입력이라 방어가 핵심이다. 저장은 단순하지만, 서버가 받을 때
// 신원(로그인=닉네임, 게스트=Guest####)·욕설·길이·도배를 모두 거른다.
// 화면에 그릴 때는 반드시 escape 한다 — 안 하면 남이 <script> 를 심는다.

import { prepareAll } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id      TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  user_id TEXT,                    -- 로그인 유저면 계정 id, 게스트면 NULL
  body    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_at ON posts(at DESC);
`;

export function openBoardStore(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    latest: 'SELECT id, at, name, user_id, body FROM posts ORDER BY at DESC LIMIT ?',
    insert: 'INSERT INTO posts (id, at, name, user_id, body) VALUES (?, ?, ?, ?, ?)',
    remove: 'DELETE FROM posts WHERE id = ?',
    count: 'SELECT COUNT(*) n FROM posts'
  });

  const shape = (r) => ({
    id: r.id, at: r.at, name: r.name, body: r.body,
    member: r.user_id != null      // 로그인 유저가 쓴 글인가 (화면에서 표시만)
  });

  return {
    latest(limit = 50) {
      return q.latest.all(limit).map(shape);
    },

    add({ name, body, userId = null }) {
      const id = globalThis.crypto.randomUUID();
      q.insert.run(id, Date.now(), name, userId, body);
      return { id };
    },

    remove(id) {
      return q.remove.run(id).changes > 0;
    },

    get size() { return q.count.get().n; }
  };
}
