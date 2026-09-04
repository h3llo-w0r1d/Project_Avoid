// 커뮤니티 게시판. 유저가 짧은 글을 남긴다. 글마다 칸(카테고리)이 있다.
//
// 공개 입력이라 방어가 핵심이다. 저장은 단순하지만, 서버가 받을 때
// 신원(로그인=닉네임, 게스트=Guest####)·욕설·길이·도배를 모두 거른다.
// 화면에 그릴 때는 반드시 escape 한다 — 안 하면 남이 <script> 를 심는다.
//
// 답글(대댓글)은 한 단계만 둔다. 원글에만 답글을 달 수 있고, 답글에 단
// 답글도 같은 원글 밑으로 들어간다(parent_id 는 항상 원글을 가리킨다).
// 깊은 트리는 화면도 복잡하고 지울 때도 성가시다.
//
// 칸(카테고리): 원글은 patch(패치노트)·chat(잡담)·bug(버그 제보)·qna(Q&A)
// 중 하나. patch 는 관리자만 쓸 수 있다(서버에서 막는다). 답글은 칸이 없다.

import { prepareAll } from './db.js';

// 원글이 속할 수 있는 칸. 순서는 화면 탭 순서와 맞춘다.
export const CATEGORIES = ['patch', 'chat', 'idea', 'bug', 'qna'];
// 관리자만 쓸 수 있는 칸(패치노트·공지 성격).
export const ADMIN_CATEGORIES = new Set(['patch']);
// 예전 글(칸 없음)은 잡담으로 본다.
const DEFAULT_CATEGORY = 'chat';

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

  // 예전 표에는 이 열들이 없다. 있으면 조용히 넘어간다.
  try { db.exec('ALTER TABLE posts ADD COLUMN parent_id TEXT'); } catch { /* 이미 있음 */ }
  try { db.exec('ALTER TABLE posts ADD COLUMN category TEXT'); } catch { /* 이미 있음 */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent_id)'); } catch { /* 무시 */ }

  const q = prepareAll(db, {
    // 원글만(답글 제외) 최신순으로. 같은 시각이면 나중에 넣은 행(rowid 큰)이 위.
    roots: 'SELECT id, at, name, user_id, body, category FROM posts WHERE parent_id IS NULL ORDER BY at DESC, rowid DESC LIMIT ?',
    // 답글은 원글별로 오래된 순으로(대화 흐름). 같은 시각이면 먼저 넣은 행이 위.
    replies: 'SELECT id, at, name, user_id, body, parent_id FROM posts WHERE parent_id IS NOT NULL ORDER BY at ASC, rowid ASC',
    insert: 'INSERT INTO posts (id, at, name, user_id, body, parent_id, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
    update: 'UPDATE posts SET body = ? WHERE id = ?',            // 본문만 고친다(작성자·시각은 그대로)
    getOne: 'SELECT category, parent_id FROM posts WHERE id = ?',
    remove: 'DELETE FROM posts WHERE id = ? OR parent_id = ?',   // 원글을 지우면 답글도 함께
    isRoot: 'SELECT 1 FROM posts WHERE id = ? AND parent_id IS NULL',
    count: 'SELECT COUNT(*) n FROM posts',
    countCat: 'SELECT COUNT(*) n FROM posts WHERE category = ?'
  });

  const shape = (r, isRoot) => ({
    id: r.id, at: r.at, name: r.name, body: r.body,
    member: r.user_id != null,     // 로그인 유저가 쓴 글인가 (화면에서 표시만)
    ...(isRoot ? { category: CATEGORIES.includes(r.category) ? r.category : DEFAULT_CATEGORY } : {})
  });

  return {
    latest(limit = 100) {
      const roots = q.roots.all(limit).map((r) => shape(r, true));
      const byParent = new Map();
      for (const r of q.replies.all()) {
        const list = byParent.get(r.parent_id) ?? [];
        list.push(shape(r, false));
        byParent.set(r.parent_id, list);
      }
      for (const root of roots) root.replies = byParent.get(root.id) ?? [];
      return roots;
    },

    // 답글을 달 수 있는 원글인지. 없거나 그 자체가 답글이면 안 된다.
    canReplyTo(id) {
      return Boolean(q.isRoot.get(id));
    },

    add({ name, body, userId = null, parentId = null, category = null, at = null }) {
      const id = globalThis.crypto.randomUUID();
      // 답글은 칸이 없다. 원글은 허용된 칸이 아니면 잡담으로.
      const cat = parentId ? null : (CATEGORIES.includes(category) ? category : DEFAULT_CATEGORY);
      q.insert.run(id, at ?? Date.now(), name, userId, body, parentId, cat);
      return { id };
    },

    // 글 하나의 칸을 돌려준다(수정 때 길이 제한을 정하는 데 쓴다). 없으면 undefined.
    categoryOf(id) {
      const r = q.getOne.get(id);
      if (!r) return undefined;
      return r.parent_id ? null : (CATEGORIES.includes(r.category) ? r.category : DEFAULT_CATEGORY);
    },

    // 본문만 고친다. 대상이 없으면 false.
    edit(id, body) {
      return q.update.run(body, id).changes > 0;
    },

    remove(id) {
      return q.remove.run(id, id).changes > 0;
    },

    // 그 칸에 글이 하나라도 있는지(패치노트 최초 이관 판단에 쓴다).
    hasCategory(cat) { return q.countCat.get(cat).n > 0; },

    get size() { return q.count.get().n; }
  };
}
