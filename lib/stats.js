// 날짜별 이용 현황.
//
// 무엇을 쌓나
// -----------
// 날짜 하나에 숫자 몇 개뿐이다. 누가 왔는지는 적지 않는다.
//
//   방문       — 첫 화면을 연 횟수 (새로고침·봇 포함, 그냥 열린 횟수)
//   순 방문자  — 그날 다녀간 서로 다른 브라우저 수 (같은 브라우저의 반복은 1)
//   시작       — 판을 시작한 횟수
//   끝냄       — 끝까지 가서 기록이 남은 횟수
//   논 시간    — 판을 버틴 시간의 합 (초)
//
// 순 방문자는 어떻게 세나 (개인정보)
// ---------------------------------
// 브라우저가 접속 신호(presence)에 실어 보내는 임시 난수 id 로 하루 단위
// 중복만 걸러낸다. 그 id 는 뜻 없는 난수라 사람을 특정할 수 없고, 여기서도
// 메모리에만 잠깐 담아 두었다가(오늘 것만) 버린다. 데이터베이스에는 id 를
// 저장하지 않고 "그날 몇 개였나" 하는 숫자만 남긴다. IP 를 메모리에만
// 잠깐 두는 것과 같은 방식이라, 방침의 "사람을 저장하지 않는다" 와 어긋나지 않는다.
//
// "몇 명이 놀았나" 는 이미 있는 기록에서 구한다. 랭킹에 남은 기록에는
// 날짜와 계정이 들어 있으므로, 그날 기록을 올린 계정 수를 세면 된다.

import { prepareAll } from './db.js';
import { dayOf } from './season.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily (
  day      TEXT PRIMARY KEY,
  visits   INTEGER NOT NULL DEFAULT 0,
  uniques  INTEGER NOT NULL DEFAULT 0,
  runs     INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  seconds  REAL    NOT NULL DEFAULT 0
);
`;

export function openStatsStore(db) {
  db.exec(SCHEMA);

  // 예전 DB 에 없던 칸은 채워 준다. (uniques, 그리고 PC/모바일 구분용 _mobile)
  // 방문·순방문자의 '모바일 몫'만 따로 세고, PC = 전체 - 모바일 로 구한다.
  const cols = db.prepare('PRAGMA table_info(daily)').all().map((c) => c.name);
  const addCol = (name) => {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE daily ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
    }
  };
  addCol('uniques');
  addCol('visits_mobile');
  addCol('uniques_mobile');

  // 오늘 다녀간 브라우저 id 를 메모리에만 담아 하루 단위 중복을 거른다.
  // day -> Set(id). 날이 바뀌면 지난 날 것은 버린다. id 는 저장하지 않는다.
  const seenByDay = new Map();
  const MAX_PER_DAY = 100_000;   // 메모리 상한 (여기 넘으면 그 이상은 안 센다)

  const q = prepareAll(db, {
    // 그날 줄이 없으면 만들고, 있으면 해당 칸만 더한다.
    touch: 'INSERT OR IGNORE INTO daily (day) VALUES (?)',
    addVisit: 'UPDATE daily SET visits = visits + ? WHERE day = ?',
    addVisitMobile: 'UPDATE daily SET visits_mobile = visits_mobile + 1 WHERE day = ?',
    addUnique: 'UPDATE daily SET uniques = uniques + 1 WHERE day = ?',
    addUniqueMobile: 'UPDATE daily SET uniques_mobile = uniques_mobile + 1 WHERE day = ?',
    addRun: 'UPDATE daily SET runs = runs + ? WHERE day = ?',
    addFinished: 'UPDATE daily SET finished = finished + 1, seconds = seconds + ? WHERE day = ?',

    recent: `SELECT * FROM daily ORDER BY day DESC LIMIT ?`,

    // 지금까지 쌓인 총합 (누적 판수 등). 이용 현황을 비우면 함께 0 으로 돌아간다.
    totals: `SELECT COALESCE(SUM(visits),0) visits, COALESCE(SUM(uniques),0) uniques,
                    COALESCE(SUM(runs),0) runs, COALESCE(SUM(finished),0) finished,
                    COALESCE(SUM(seconds),0) seconds FROM daily`,

    // 달별로 묶어 합친다. 'YYYY-MM' 앞 7글자로 묶는다.
    byMonth: `SELECT substr(day, 1, 7) AS month,
                     SUM(visits) visits, SUM(uniques) uniques,
                     SUM(visits_mobile) visits_mobile, SUM(uniques_mobile) uniques_mobile,
                     SUM(runs) runs, SUM(finished) finished, SUM(seconds) seconds
              FROM daily GROUP BY month ORDER BY month DESC LIMIT ?`,

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

  // 한 달의 시작·끝. 'YYYY-MM' 을 한국 그 달 1일 자정부터 다음 달 1일 자정까지.
  const monthSpan = (month) => {
    const [y, m] = month.split('-').map(Number);
    const from = Date.UTC(y, m - 1, 1) - KST;
    const to = Date.UTC(y, m, 1) - KST;
    return [from, to];
  };

  return {
    // isMobile 이면 그날의 '모바일 몫'도 같이 센다. PC 는 전체에서 뺀다.
    visit(isMobile = false, at = Date.now()) {
      bump(q.addVisit.run.bind(q.addVisit), 1, at);
      if (isMobile) q.addVisitMobile.run(dayOf(at));
    },
    runStarted(at = Date.now()) { bump(q.addRun.run.bind(q.addRun), 1, at); },

    // 한 브라우저의 오늘 첫 접속만 순 방문자로 센다. 같은 id 가 다시 와도
    // 그날 안에는 더 세지 않는다. id 는 어디에도 저장하지 않는다.
    uniqueVisit(id, isMobile = false, at = Date.now()) {
      if (typeof id !== 'string' || id.length < 8 || id.length > 64) return;
      const day = dayOf(at);
      let set = seenByDay.get(day);
      if (!set) {
        set = new Set();
        seenByDay.set(day, set);
        // 오늘 것만 들고 있으면 된다. 지난 날짜 메모리는 버린다.
        for (const k of seenByDay.keys()) if (k !== day) seenByDay.delete(k);
      }
      if (set.has(id) || set.size >= MAX_PER_DAY) return;
      set.add(id);
      q.touch.run(day);
      q.addUnique.run(day);
      if (isMobile) q.addUniqueMobile.run(day);
    },

    // 판이 끝나 기록이 남았을 때. 버틴 시간을 같이 더한다.
    runFinished(seconds, at = Date.now()) {
      const day = dayOf(at);
      q.touch.run(day);
      q.addFinished.run(seconds, day);
    },

    // 쌓인 이용 현황을 통째로 비운다. 랭킹 기록은 건드리지 않는다 —
    // "몇 명이 놀았나" 는 거기서 세므로, 지우고 나서도 지난 날짜에
    // 사람 수만 남아 보일 수 있다. 그게 맞다.
    clear() {
      const n = db.prepare('SELECT COUNT(*) c FROM daily').get().c;
      db.exec('DELETE FROM daily');
      // 오늘 다녀간 브라우저 기억(중복 거르기용)도 함께 비운다. 안 그러면
      // 이미 다녀간 브라우저가 "이미 왔음"으로 남아, 비우고 나서 다시 와도
      // 순 방문자로 안 세인다.
      seenByDay.clear();
      return n;
    },

    // 지금까지의 누적 합계.
    totals() {
      const r = q.totals.get();
      return {
        visits: r.visits, uniques: r.uniques, runs: r.runs,
        finished: r.finished, seconds: Math.round(r.seconds)
      };
    },

    // 최근 며칠치. 사람 수는 기록에서 세어 붙인다.
    recent(days = 14) {
      return q.recent.all(days).map((row) => {
        const [from, to] = span(row.day);
        return {
          day: row.day,
          visits: row.visits,
          uniques: row.uniques ?? 0,
          visitsMobile: row.visits_mobile ?? 0,
          uniquesMobile: row.uniques_mobile ?? 0,
          runs: row.runs,
          finished: row.finished,
          // 초 그대로 넘긴다. 분으로 반올림해서 넘기면 짧게 논 날이 전부
          // "0분" 이 되어 아무것도 알 수 없다. 보기 좋게 다듬는 건 화면이 한다.
          seconds: Math.round(row.seconds),
          players: q.players.get(from, to).n,
          members: q.members.get(from, to).n
        };
      });
    },

    // 달별 합계. 판·방문은 그냥 더하면 되고, '논 사람'(그 달 다녀간 서로 다른
    // 사람)은 날짜 합이 아니라 그 달 전체 기록에서 한 번에 세야 정확하다.
    // 순 방문자는 날짜별 값을 더한 것이라(같은 사람이 여러 날 오면 각각 셈)
    // 정확한 '한 달 순 방문자'는 아니다 — 그래서 화면에서 그렇게 밝혀 둔다.
    monthly(months = 24) {
      return q.byMonth.all(months).map((row) => {
        const [from, to] = monthSpan(row.month);
        return {
          month: row.month,
          visits: row.visits,
          uniques: row.uniques ?? 0,
          visitsMobile: row.visits_mobile ?? 0,
          uniquesMobile: row.uniques_mobile ?? 0,
          runs: row.runs,
          finished: row.finished,
          seconds: Math.round(row.seconds),
          players: q.players.get(from, to).n,
          members: q.members.get(from, to).n
        };
      });
    }
  };
}
