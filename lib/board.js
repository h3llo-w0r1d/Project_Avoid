// 자유 게시판. 유저가 짧은 글을 남긴다.
//
// 공개 입력이라 방어가 핵심이다. 저장은 단순하지만, 서버가 받을 때
// 신원(로그인=닉네임, 게스트=Guest####)·욕설·길이·도배를 모두 거른다.
// 화면에 그릴 때는 반드시 escape 한다 — 안 하면 남이 <script> 를 심는다.
//
// 답글(대댓글)은 한 단계만 둔다. 원글에만 답글을 달 수 있고, 답글에 단
// 답글도 같은 원글 밑으로 들어간다(parent_id 는 항상 원글을 가리킨다).
// 깊은 트리는 화면도 복잡하고 지울 때도 성가시다.

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

  // 예전 표에는 parent_id 가 없다. 있으면 조용히 넘어간다.
  try { db.exec('ALTER TABLE posts ADD COLUMN parent_id TEXT'); } catch { /* 이미 있음 */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id)'); } catch { /* 무시 */ }

  const q = prepareAll(db, {
    // 원글만(답글 제외) 최신순으로. 같은 시각이면 나중에 넣은 행(rowid 큰)이 위.
    roots: 'SELECT id, at, name, user_id, body FROM posts WHERE parent_id IS NULL ORDER BY at DESC, rowid DESC LIMIT ?',
    // 답글은 원글별로 오래된 순으로(대화 흐름). 같은 시각이면 먼저 넣은 행이 위.
    replies: 'SELECT id, at, name, user_id, body, parent_id FROM posts WHERE parent_id IS NOT NULL ORDER BY at ASC, rowid ASC',
    insert: 'INSERT INTO posts (id, at, name, user_id, body, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
    remove: 'DELETE FROM posts WHERE id = ? OR parent_id = ?',   // 원글을 지우면 답글도 함께
    isRoot: 'SELECT 1 FROM posts WHERE id = ? AND parent_id IS NULL',
    count: 'SELECT COUNT(*) n FROM posts'
  });

  const shape = (r) => ({
    id: r.id, at: r.at, name: r.name, body: r.body,
    member: r.user_id != null      // 로그인 유저가 쓴 글인가 (화면에서 표시만)
  });

  return {
    latest(limit = 50) {
      const roots = q.roots.all(limit).map(shape);
      const byParent = new Map();
      for (const r of q.replies.all()) {
        const list = byParent.get(r.parent_id) ?? [];
        list.push(shape(r));
        byParent.set(r.parent_id, list);
      }
      for (const root of roots) root.replies = byParent.get(root.id) ?? [];
      return roots;
    },

    // 답글을 달 수 있는 원글인지. 없거나 그 자체가 답글이면 안 된다.
    canReplyTo(id) {
      return Boolean(q.isRoot.get(id));
    },

    add({ name, body, userId = null, parentId = null }) {
      const id = globalThis.crypto.randomUUID();
      q.insert.run(id, Date.now(), name, userId, body, parentId);
      return { id };
    },

    remove(id) {
      return q.remove.run(id, id).changes > 0;
    },

    get size() { return q.count.get().n; }
  };
}
