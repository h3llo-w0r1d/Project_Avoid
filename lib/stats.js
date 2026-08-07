// 날짜별 이용 현황.
//
// 무엇을 쌓나
// -----------
// 날짜 하나에 숫자 몇 개뿐이다. 누가 왔는지는 적지 않는다.
//
//   방문     — 첫 화면을 연 횟수
//   시작     — 판을 시작한 횟수
//   끝냄     — 끝까지 가서 기록이 남은 횟수
//   논 시간  — 판을 버틴 시간의 합 (초)
//
// 왜 이렇게만 하나
// ----------------
// 개인정보처리방침에 "광고나 분석 도구를 넣지 않았고 IP 를 저장하지 않는다"
// 고 적어 두었다. 방문자를 한 사람씩 세려면 무언가로 사람을 구별해 두어야
// 하는데, 그러면 그 약속이 깨진다. 그래서 사람은 세지 않고 횟수만 센다.
//
// "몇 명이 놀았나" 는 이미 있는 기록에서 구한다. 랭킹에 남은 기록에는
// 날짜와 계정이 들어 있으므로, 그날 기록을 올린 계정 수를 세면 된다.
// 새로 쌓는 게 없다.

import { prepareAll } from './db.js';
import { dayOf } from './season.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily (
  day      TEXT PRIMARY KEY,
  visits   INTEGER NOT NULL DEFAULT 0,
  runs     INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  seconds  REAL    NOT NULL DEFAULT 0
);
`;

export function openStatsStore(db) {
  db.exec(SCHEMA);

  const q = prepareAll(db, {
    // 그날 줄이 없으면 만들고, 있으면 해당 칸만 더한다.
    touch: 'INSERT OR IGNORE INTO daily (day) VALUES (?)',
    addVisit: 'UPDATE daily SET visits = visits + ? WHERE day = ?',
    addRun: 'UPDATE daily SET runs = runs + ? WHERE day = ?',
    addFinished: 'UPDATE daily SET finished = finished + 1, seconds = seconds + ? WHERE day = ?',

    recent: `SELECT * FROM daily ORDER BY day DESC LIMIT ?`,

    // 그날 기록을 올린 사람 수. 로그인한 사람은 계정으로, 게스트는 이름으로 센다.
    // 같은 게스트가 여러 번 올렸어도 한 사람으로 친다.
    players: `SELECT COUNT(DISTINCT COALESCE(user_id, name)) n
              FROM scores WHERE at >= ? AND at < ?`,
    members: `SELECT COUNT(DISTINCT user_id) n
              FROM scores WHERE at >= ? AND at < ? AND user_id IS NOT NULL`
  });

  const bump = (run, amount, at) => {
    const day = dayOf(at);
    q.touch.run(day);
    run(amount, day);
  };

  // 한국 날짜 하루의 시작·끝을 실제 시각으로 바꾼다.
  // 'YYYY-MM-DD' 를 한국 자정으로 보고 UTC 로 되돌린다.
  const KST = 9 * 3600_000;
  const span = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    const from = Date.UTC(y, m - 1, d) - KST;
    return [from, from + 86400_000];
  };

  return {
    visit(at = Date.now()) { bump(q.addVisit.run.bind(q.addVisit), 1, at); },
    runStarted(at = Date.now()) { bump(q.addRun.run.bind(q.addRun), 1, at); },

    // 판이 끝나 기록이 남았을 때. 버틴 시간을 같이 더한다.
    runFinished(seconds, at = Date.now()) {
      const day = dayOf(at);
      q.touch.run(day);
      q.addFinished.run(seconds, day);
    },

    // 최근 며칠치. 사람 수는 기록에서 세어 붙인다.
    recent(days = 14) {
      return q.recent.all(days).map((row) => {
        const [from, to] = span(row.day);
        return {
          day: row.day,
          visits: row.visits,
          runs: row.runs,
          finished: row.finished,
          // 초 그대로 넘긴다. 분으로 반올림해서 넘기면 짧게 논 날이 전부
          // "0분" 이 되어 아무것도 알 수 없다. 보기 좋게 다듬는 건 화면이 한다.
          seconds: Math.round(row.seconds),
          players: q.players.get(from, to).n,
          members: q.members.get(from, to).n
        };
      });
    }
  };
}
