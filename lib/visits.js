// 방문 기록 (관리자 디버깅용). 게임 페이지를 연 요청을 한 건씩 쌓는다.
// 플레이 기록(plays)과 같은 방식이라, 관리 화면에서 시간순으로 훑고
// '전체 비우기'로 지울 수 있다.
//
// 개인정보 주의: 여기에는 IP 가 저장된다. 봇을 눈으로 가려내고 오류를
// 잡으려는 디버깅 용도다. 이 사실은 개인정보처리방침에 밝혀 두었고,
// 관리자만 보며, 최근 CAP 개만 남기고 오래된 것은 자동으로 밀려난다.

import { prepareAll } from './db.js';

const CAP = 10000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS visits (
  id     TEXT PRIMARY KEY,
  at     INTEGER NOT NULL,
  ip     TEXT,
  device TEXT,
  bot    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS visits_at ON visits(at DESC);
`;

export function openVisitsStore(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    insert: 'INSERT INTO visits (id, at, ip, device, bot) VALUES (?, ?, ?, ?, ?)',
    // 최근 CAP 개만 남긴다. 그보다 오래된 것은 지운다.
    trim: `DELETE FROM visits WHERE at < (
             SELECT at FROM visits ORDER BY at DESC LIMIT 1 OFFSET ?
           )`,
    page: 'SELECT id, at, ip, device, bot FROM visits ORDER BY at DESC LIMIT ? OFFSET ?',
    count: 'SELECT COUNT(*) n FROM visits',
    clear: 'DELETE FROM visits'
  });

  const shape = (r) => ({ id: r.id, at: r.at, ip: r.ip, device: r.device, bot: !!r.bot });

  return {
    add({ ip, device, bot }) {
      q.insert.run(globalThis.crypto.randomUUID(), Date.now(), ip ?? null, device ?? null, bot ? 1 : 0);
      q.trim.run(CAP);
    },

    // 관리 화면용 페이지. { rows, total }
    page(limit = 25, offset = 0) {
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
