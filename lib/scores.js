import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, prepareAll } from './db.js';
import { seasonOf } from './season.js';

// 버틴 초 랭킹.
//
// 랭킹은 시즌(한 달) 단위다. 달이 바뀌면 지난 시즌의 상위권을
// 명예의 전당으로 옮기고 새로 시작한다.
//
// **한 사람은 한 줄만 차지한다.** 잘하는 사람이 열 번 뛰면 열 자리를
// 채워서 랭킹이 그 사람 이름으로 도배된다. 그래서 새 기록이 들어오면
// 그 사람의 기존 줄을 갱신한다(더 좋을 때만). 몇 번 뛰었는지는 runs 에 센다.

const HALL_KEEP = 10;      // 명예의 전당에 남길 시즌별 인원

export async function openScoreStore(dir, shared = null) {
  const db = shared ?? await openDatabase(dir);

  // 예전 DB 에는 mode 칸이 없다. 하드코어 랭킹을 위해 한 번 더해 준다.
  // (fresh DB 는 db.js 의 CREATE 에 이미 있다.) 기존 기록은 전부 'normal'.
  const cols = db.prepare('PRAGMA table_info(scores)').all().map((c) => c.name);
  if (!cols.includes('mode')) {
    db.exec("ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal'");
  }

  const q = prepareAll(db, {
    // 랭킹 순서: 기록이 같으면 먼저 세운 사람이 위. 모드별로 따로 센다.
    top: 'SELECT id, name, time FROM scores WHERE mode = ? ORDER BY time DESC, at ASC LIMIT ?',
    all: 'SELECT id, name, time, at, runs, mode FROM scores ORDER BY time DESC, at ASC',
    countAll: 'SELECT COUNT(*) n FROM scores',

    // 같은 사람 찾기 — 계정은 id 로, 게스트는 이름으로. 모드마다 한 줄씩 가진다.
    findByUser: 'SELECT * FROM scores WHERE user_id = ? AND mode = ? LIMIT 1',
    findByName: 'SELECT * FROM scores WHERE name = ? AND mode = ? LIMIT 1',

    insert: `INSERT INTO scores (id, name, time, at, user_id, runs, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
    bumpRuns: 'UPDATE scores SET runs = runs + 1 WHERE id = ?',
    improve: `UPDATE scores SET time = ?, at = ?, name = ?,
                user_id = COALESCE(?, user_id), runs = runs + 1 WHERE id = ?`,
    remove: 'DELETE FROM scores WHERE id = ?',
    clear: 'DELETE FROM scores',

    // 순위 = 같은 모드에서 나보다 앞선 줄의 수 + 1.
    rankOfRow: `SELECT COUNT(*) n FROM scores
                WHERE mode = ? AND (time > ? OR (time = ? AND at < ?))`,
    byId: 'SELECT * FROM scores WHERE id = ?',

    // 지난 시즌 정리
    oldSeasons: 'SELECT * FROM scores ORDER BY time DESC, at ASC',
    deleteOld: 'DELETE FROM scores WHERE id = ?',
    hallPut: 'INSERT OR REPLACE INTO hall (season, place, name, time) VALUES (?, ?, ?, ?)',
    hallWipeSeason: 'DELETE FROM hall WHERE season = ?',
    hallSeasons: 'SELECT DISTINCT season FROM hall ORDER BY season DESC LIMIT ?',
    hallOf: 'SELECT name, time FROM hall WHERE season = ? ORDER BY place ASC'
  });

  // 같은 사람의 기존 줄. 계정은 id 로 먼저 찾고, 없으면 이름으로 본다.
  //
  // 이름으로도 보는 이유는 두 가지다. 계정 닉네임은 서로 겹칠 수 없고
  // 게스트는 Guest#### 형식만 쓸 수 있어 이름이 사람을 특정한다. 그리고
  // id 를 붙이기 전에 쌓인 옛 기록도 같은 사람으로 이어 줘야 한다.
  function findMine(name, userId, mode) {
    if (userId) {
      const byUser = q.findByUser.get(userId, mode);
      if (byUser) return byUser;
    }
    return q.findByName.get(name, mode) ?? null;
  }

  function rankOfRow(row) {
    return q.rankOfRow.get(row.mode ?? 'normal', row.time, row.time, row.at).n + 1;
  }

  // 지난 시즌 기록을 명예의 전당으로 옮기고 목록에서 뺀다.
  //
  // 서버가 한 달 내내 떠 있지 않을 수도 있고, 반대로 몇 달 꺼져 있다가
  // 켜질 수도 있다. "달이 바뀌는 순간"을 노리지 않고, 기록을 만질 때마다
  // 지금 시즌이 아닌 게 섞여 있는지 확인하는 편이 안전하다.
  function rollSeasons() {
    const now = seasonOf();
    const old = q.oldSeasons.all().filter((r) => seasonOf(r.at) !== now);
    if (old.length === 0) return false;

    // 명예의 전당은 일반 모드만 남긴다(하드코어 역대 기록은 아직 보관하지 않음).
    const bySeason = new Map();
    for (const r of old) {
      if ((r.mode ?? 'normal') !== 'normal') continue;
      const key = seasonOf(r.at);
      if (!bySeason.has(key)) bySeason.set(key, []);
      bySeason.get(key).push(r);
    }

    for (const [key, list] of bySeason) {
      q.hallWipeSeason.run(key);
      list.slice(0, HALL_KEEP).forEach((r, i) => {
        q.hallPut.run(key, i + 1, r.name, r.time);
      });
    }
    // 지난 시즌 줄은 모드와 상관없이 목록에서 뺀다.
    for (const r of old) q.deleteOld.run(r.id);
    return true;
  }

  rollSeasons();

  return {
    rollSeasons: async () => rollSeasons(),

    // 지난 시즌들의 상위권
    hallOfFame(seasons = 6) {
      return q.hallSeasons.all(seasons).map(({ season }) => ({
        season,
        top: q.hallOf.all(season)
      }));
    },

    // userId 는 로그인한 경우에만 붙는다. 게스트는 null.
    //
    // 같은 사람이 이미 올린 게 있으면 그 줄을 갱신한다. 더 나쁜 기록이면
    // 횟수만 세고 시간은 그대로 둔다.
    async add(name, time, userId = null, mode = 'normal') {
      const mine = findMine(name, userId, mode);

      if (mine) {
        if (time > mine.time) {
          q.improve.run(time, Date.now(), name, userId ?? null, mine.id);
        } else {
          q.bumpRuns.run(mine.id);
        }
        return q.byId.get(mine.id);
      }

      const entry = {
        id: randomUUID(), name, time, at: Date.now(), user_id: userId ?? null, runs: 1, mode
      };
      q.insert.run(entry.id, name, time, entry.at, entry.user_id, 1, mode);
      return entry;
    },

    top(n, mode = 'normal') {
      return q.top.all(mode, n);
    },

    // 관리 화면용 — 등록 시각과 시도 횟수까지 함께 준다
    all() {
      return q.all.all();
    },

    // 지운 경우에만 true
    async remove(id) {
      return q.remove.run(id).changes > 0;
    },

    async clear() {
      const before = q.countAll.get().n;
      q.clear.run();
      return before;
    },

    // 목록 밖으로 밀려났으면 null
    rankOf(id) {
      const row = q.byId.get(id);
      return row ? rankOfRow(row) : null;
    },

    // 이 사람의 가장 좋은 기록과 그 순위.
    // 한 사람은 한 줄뿐이므로 그 줄이 곧 최고 기록이다.
    bestOf({ userId = null, name = null, mode = 'normal' }) {
      if (!userId && !name) return null;
      const row = userId ? q.findByUser.get(userId, mode) : q.findByName.get(name, mode);
      if (!row) return null;
      // runs = 이 모드에서 1초 이상 버텨 제출된 판 수(프로필의 '플레이' 수)
      return { id: row.id, rank: rankOfRow(row), name: row.name, time: row.time, runs: row.runs };
    },

    // 닉네임을 바꾸면 이미 올려 둔 기록의 이름도 같이 바꾼다.
    // 안 그러면 랭킹에는 옛 이름이, 프로필에는 새 이름이 떠서
    // 같은 사람이 둘로 보인다.
    renameUser(userId, name) {
      if (!userId) return 0;
      return db.prepare('UPDATE scores SET name = ? WHERE user_id = ?').run(name, userId).changes;
    },

    // 점수 한 줄을 id 로 가져온다(다시보기 검증용). 없으면 null.
    rowById(id) {
      return q.byId.get(id) ?? null;
    },

    get size() {
      return q.countAll.get().n;
    }
  };
}

// ---------------------------------------------------------------- 이사

// 옛 JSON 파일을 읽어 표로 옮긴다. 한 번만 돈다.
// 옮기고 나면 원본은 .imported 로 이름만 바꿔 둔다 — 지우지 않는다.
export async function importScoresJson(db, dir) {
  const file = join(dir, 'scores.json');
  let rows;
  try {
    rows = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return 0;      // 없으면 이사할 것도 없다
  }
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO scores (id, name, time, at, user_id, runs)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  let n = 0;
  for (const r of rows) {
    if (!r?.id || typeof r.name !== 'string') continue;
    insert.run(r.id, r.name, Number(r.time), Number(r.at), r.userId ?? null, Number(r.runs ?? 1));
    n++;
  }

  // 명예의 전당도 같이
  try {
    const hall = JSON.parse(await readFile(join(dir, 'hall.json'), 'utf8'));
    const put = db.prepare('INSERT OR REPLACE INTO hall (season, place, name, time) VALUES (?, ?, ?, ?)');
    for (const s of hall ?? []) {
      (s.top ?? []).forEach((e, i) => put.run(s.season, i + 1, e.name, Number(e.time)));
    }
    await rename(join(dir, 'hall.json'), join(dir, 'hall.json.imported'));
  } catch { /* 없으면 넘어간다 */ }

  await rename(file, `${file}.imported`);
  return n;
}
