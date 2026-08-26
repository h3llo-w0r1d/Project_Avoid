// 끝난 대전의 기록. 부정행위를 살펴보는 근거다.
//
// 승/패 숫자만 세면 "20승 3패"가 정상인지 짜고 친 것인지 알 방법이 없다.
// 누구와 몇 초 동안 했는지가 남아야 판단할 수 있다.
//
// 1v1 판정 자체는 서버가 하므로(lib/arena-match.js) 클라이언트가 결과를
// 조작할 수는 없다. 문제가 되는 건 두 계정이 짜고 한쪽만 계속 이겨 주는
// 쪽이라, 상대가 누구였는지와 판이 얼마나 짧았는지가 핵심 단서다.

import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, prepareAll, bit } from './db.js';

// 최근 것만 남긴다. 살펴보는 데는 최근 기록이 쓸모 있고,
// 무한히 쌓으면 파일이 계속 커진다.
const MAX = 3000;

// 이보다 짧게 끝난 판은 "일부러 져 준" 쪽에 가깝다.
// 전기선이 처음 나오기까지 1.2초 + 경고 0.85초라, 정상적으로는
// 이보다 빨리 죽기가 어렵다.
const SHORT_SECONDS = 6;

export async function openMatchStore(dir, shared = null) {
  const db = shared ?? await openDatabase(dir);

  const q = prepareAll(db, {
    insert: `INSERT INTO matches
      (id, at, seconds, mode, draw, winner_id, winner_name, loser_id, loser_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

    // 상한을 넘으면 오래된 것부터 지운다
    trim: `DELETE FROM matches WHERE id IN (
             SELECT id FROM matches ORDER BY at DESC LIMIT -1 OFFSET ?)`,

    // 이 계정이 낀 판. 인덱스 두 개(winner_id, loser_id)를 탄다.
    ofUser: `SELECT * FROM matches
             WHERE winner_id = ?1 OR loser_id = ?1
             ORDER BY at DESC`,
    // 전체 최근 목록(관리 화면 — 게스트 포함 모두)
    recentPage: 'SELECT * FROM matches ORDER BY at DESC LIMIT ? OFFSET ?',
    removeOne: 'DELETE FROM matches WHERE id = ?',
    countAll: 'SELECT COUNT(*) n FROM matches'
  });

  return {
    // side = { userId, name } — 게스트는 userId 가 null 이다
    async add({ seconds, mode, winner, loser, draw = false }) {
      q.insert.run(
        randomUUID(), Date.now(), Math.round(seconds * 100) / 100, mode, bit(draw),
        winner?.userId ?? null, winner?.name ?? null,
        loser?.userId ?? null, loser?.name ?? null
      );
      q.trim.run(MAX);
    },

    // 관리 화면에서 한 사람을 들여다볼 때 쓴다.
    // 목록과 함께 "무엇이 수상한지"를 계산해 준다.
    historyOf(userId, limit = 30) {
      const mine = q.ofUser.all(userId);

      const rows = mine.slice(0, limit).map((m) => {
        const iWon = m.winner_id === userId;
        return {
          at: m.at,
          seconds: m.seconds,
          mode: m.mode,
          result: m.draw ? 'draw' : (iWon ? 'win' : 'lose'),
          opponent: (iWon ? m.loser_name : m.winner_name) ?? '(게스트)',
          opponentId: (iWon ? m.loser_id : m.winner_id) ?? null
        };
      });

      return { rows, flags: analyze(mine, userId) };
    },

    // 관리 화면의 전체 1v1 기록(로그인·게스트 모두). 시간순, 쪽 단위.
    page(limit = 20, offset = 0) {
      const rows = q.recentPage.all(limit, offset).map((m) => ({
        id: m.id,                           // 관리 화면에서 한 판씩 지울 때 쓴다
        at: m.at,
        seconds: m.seconds,
        mode: m.mode,
        draw: !!m.draw,
        winnerName: m.winner_name ?? '(게스트)',
        loserName: m.loser_name ?? '(게스트)',
        winnerGuest: m.winner_id == null,   // 로그인 계정이 아니면 게스트
        loserGuest: m.loser_id == null
      }));
      return { rows, total: q.countAll.get().n };
    },

    // 한 판 삭제(관리 화면). 지웠으면 true.
    remove(id) {
      return q.removeOne.run(id).changes > 0;
    },

    get size() { return q.countAll.get().n; }
  };
}

// 수상한 신호를 뽑는다. 판단은 사람이 한다 — 여기서는 근거만 모은다.
function analyze(mine, userId) {
  if (mine.length === 0) return null;

  const byOpponent = new Map();
  const nameOf = new Map();
  let shortWins = 0;
  let roomCount = 0;
  let totalSeconds = 0;
  let wins = 0;

  for (const m of mine) {
    const iWon = m.winner_id === userId;
    const otherId = iWon ? m.loser_id : m.winner_id;
    const otherName = (iWon ? m.loser_name : m.winner_name) ?? '(게스트)';
    const key = otherId ?? `guest:${otherName}`;
    byOpponent.set(key, (byOpponent.get(key) ?? 0) + 1);
    nameOf.set(key, otherName);

    if (iWon) {
      wins++;
      if (m.seconds < SHORT_SECONDS) shortWins++;
    }
    if (m.mode === 'room') roomCount++;
    totalSeconds += m.seconds;
  }

  // 제일 자주 붙은 상대
  let topKey = null;
  let topCount = 0;
  for (const [key, count] of byOpponent) {
    if (count > topCount) { topCount = count; topKey = key; }
  }

  return {
    games: mine.length,
    opponents: byOpponent.size,
    topOpponent: nameOf.get(topKey) ?? null,
    topOpponentGames: topCount,
    // 한 사람만 계속 상대했으면 1 에 가깝다. 짜고 치기의 가장 굵은 단서.
    topOpponentShare: topCount / mine.length,
    // 방 코드로만 했으면 1. 무작위 매칭이 섞여 있으면 낮아진다.
    roomShare: roomCount / mine.length,
    avgSeconds: Math.round((totalSeconds / mine.length) * 10) / 10,
    // 이긴 판 중 몇 초 안에 끝난 비율. 상대가 일부러 떨어져 준 흔적.
    shortWinShare: wins > 0 ? shortWins / wins : 0,
    shortWins,
    wins
  };
}

export { SHORT_SECONDS };

// ---------------------------------------------------------------- 이사

export async function importMatchesJson(db, dir) {
  const file = join(dir, 'matches.json');
  let rows;
  try {
    rows = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return 0;
  }
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO matches
     (id, at, seconds, mode, draw, winner_id, winner_name, loser_id, loser_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const m of rows) {
    if (!m?.id) continue;
    insert.run(
      m.id, Number(m.at), Number(m.seconds), m.mode ?? 'queue', bit(m.draw),
      m.winner?.userId ?? null, m.winner?.name ?? null,
      m.loser?.userId ?? null, m.loser?.name ?? null
    );
    n++;
  }
  await rename(file, `${file}.imported`);
  return n;
}
