// 간단한 투표.
//
// 한 사람이 한 번만. '한 사람' 을 무엇으로 볼지가 이 파일의 전부다.
//   · 로그인했으면 계정 id
//   · 아니면 브라우저 id(avoidarc.cid — 접속 신호에 이미 쓰는 것)
//
// 브라우저를 지우거나 다른 기기로 오면 다시 찍을 수 있다. 막을 방법이 없고,
// 재미로 하는 투표라 그 정도는 감수한다. 대신 로그인한 사람은 계정으로 묶여
// 기기를 옮겨도 한 표다.
//
// 표를 바꾸는 건 허용한다(마음이 바뀔 수 있고, 못 바꾸게 하면 잘못 눌렀을 때
// 되돌릴 방법이 없다). 바꾸면 그 자리에서 덮어쓴다.

import { prepareAll } from './db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id  TEXT    NOT NULL,
  voter    TEXT    NOT NULL,        -- 계정 id 또는 브라우저 id
  choice   TEXT    NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (poll_id, voter)
);
CREATE INDEX IF NOT EXISTS poll_votes_poll ON poll_votes(poll_id);
`;

export function openPolls(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    put: `INSERT INTO poll_votes (poll_id, voter, choice, at) VALUES (?, ?, ?, ?)
          ON CONFLICT(poll_id, voter) DO UPDATE SET choice = excluded.choice, at = excluded.at`,
    mine: 'SELECT choice FROM poll_votes WHERE poll_id = ? AND voter = ?',
    tally: `SELECT choice, COUNT(*) n FROM poll_votes WHERE poll_id = ?
            GROUP BY choice ORDER BY n DESC`,
    total: 'SELECT COUNT(*) n FROM poll_votes WHERE poll_id = ?',
    recent: `SELECT voter, choice, at FROM poll_votes WHERE poll_id = ?
             ORDER BY at DESC LIMIT ?`,
    clear: 'DELETE FROM poll_votes WHERE poll_id = ?'
  });

  return {
    // 한 표를 넣는다(이미 찍었으면 바꾼다).
    vote(pollId, voter, choice) {
      q.put.run(String(pollId), String(voter), String(choice), Date.now());
      return this.result(pollId, voter);
    },

    // { counts: { 선택지: 수 }, total, mine }
    result(pollId, voter = null) {
      const counts = {};
      for (const r of q.tally.all(String(pollId))) counts[r.choice] = r.n;
      return {
        counts,
        total: q.total.get(String(pollId))?.n ?? 0,
        mine: voter ? (q.mine.get(String(pollId), String(voter))?.choice ?? null) : null
      };
    },

    // 관리 화면용 — 최근 찍은 순서.
    recent(pollId, limit = 50) {
      return q.recent.all(String(pollId), Math.max(1, Math.min(500, limit)))
        .map((r) => ({ voter: r.voter, choice: r.choice, at: r.at }));
    },

    // 다시 받고 싶을 때 통째로 비운다.
    clear(pollId) {
      q.clear.run(String(pollId));
      return true;
    }
  };
}
