// 룰렛 기준(초/1회)을 올릴 때, 이미 벌어 둔 횟수를 살려 준다.
//
//   node scripts/regrade-spins.js            (미리보기 — 아무것도 안 바꾼다)
//   node scripts/regrade-spins.js --apply
//   node scripts/regrade-spins.js --from 80 --to 150 --apply
//
// 왜 필요한가
// -----------
// 남은 횟수는 floor(누적시간 / 기준) - 돌린횟수 로 계산한다. 기준을 올리면
// 앞항이 작아져서, 이미 쌓아 둔 사람의 남은 횟수까지 줄어든다. 앞으로 벌기
// 어려워지는 건 의도한 바지만 번 걸 회수하는 건 아니다.
//
// 어떻게 살리나
// -------------
// 누적시간을 새 기준에 맞춰 다시 매긴다.
//
//   벌었던 횟수 = floor(누적시간 / 옛기준)
//   남은 횟수   = 벌었던 횟수 - 돌린횟수
//   나머지      = 누적시간 - 벌었던횟수 * 옛기준      (다음 회까지 모아 둔 초)
//   새 누적시간 = (돌린횟수 + 남은횟수) * 새기준 + 나머지
//
// 그러면 floor(새누적시간 / 새기준) - 돌린횟수 = 남은 횟수 그대로다.
// 앞으로 쌓이는 초는 새 기준으로만 계산되니 "기존은 유지, 새로 버는 건
// 어렵게" 가 된다.
//
// 누적시간은 룰렛 말고 쓰는 데가 없다(코드 전체를 확인했다). 그래서 이
// 값을 다시 매겨도 랭킹·칭호·발자국 효과에는 아무 영향이 없다.
//
// 여러 번 돌려도 안전하다 — 이미 올려 둔 값보다 크거나 같으면 건너뛴다.
// 그 사이 그 사람 브라우저가 옛 값을 밀어 올렸으면 다시 맞춰 준다.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../lib/db.js';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const APPLY = argv.includes('--apply');
const FROM = flag('from', 80);
const TO = flag('to', 150);

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const db = await openDatabase(process.env.DATA_DIR || join(root, 'data'));

// 무엇을 어떻게 바꿨는지 남긴다. 다시 돌릴 때 이미 한 건지 보려고.
db.exec(`CREATE TABLE IF NOT EXISTS spin_regrade (
  user_id  TEXT PRIMARY KEY,
  from_per INTEGER NOT NULL,
  to_per   INTEGER NOT NULL,
  old_time REAL NOT NULL,
  new_time REAL NOT NULL,
  at       INTEGER NOT NULL
)`);

const rows = db.prepare(
  'SELECT id, nickname, playtime, spins_used FROM users WHERE playtime > 0'
).all();
const doneBy = new Map(
  db.prepare('SELECT user_id, new_time FROM spin_regrade').all().map((r) => [r.user_id, r.new_time])
);

const avail = (t, used, per) => Math.max(0, Math.floor(t / per) - used);
const plan = [];
for (const r of rows) {
  const t = Math.max(0, Number(r.playtime) || 0);
  const used = Math.max(0, Number(r.spins_used) || 0);
  const before = avail(t, used, FROM);
  const after = avail(t, used, TO);
  if (before <= after) continue;                 // 줄어들지 않는 사람은 둘 것 없다

  const earned = Math.floor(t / FROM);
  const rest = t - earned * FROM;
  const next = (used + before) * TO + rest;

  // 이미 맞춰 둔 값 이상이면 건너뛴다(중복 적용 방지)
  const had = doneBy.get(r.id);
  if (had != null && t >= had) continue;

  plan.push({ id: r.id, nickname: r.nickname, used, before, after, t, next,
              redo: had != null });
}

console.log(`기준 ${FROM}초 → ${TO}초 · ${APPLY ? '적용' : '미리보기(안 바꿈)'}`);
console.log(`대상 ${plan.length}명 / 플레이시간 있는 계정 ${rows.length}명\n`);
if (!plan.length) { console.log('바꿀 것이 없습니다.'); process.exit(0); }

plan.sort((a, b) => (b.before - b.after) - (a.before - a.after));
console.log('닉네임             그대로 뒀을 때 → 살린 뒤   누적시간');
for (const p of plan) {
  console.log('  ' + String(p.nickname ?? '(이름없음)').padEnd(18)
    + String(p.after + '회').padStart(6) + ' → ' + String(p.before + '회').padEnd(7)
    + '  ' + Math.round(p.t) + '초 → ' + Math.round(p.next) + '초'
    + (p.redo ? '   (다시 맞춤)' : ''));
}
const saved = plan.reduce((s, p) => s + (p.before - p.after), 0);
console.log(`\n살려 주는 횟수 합계: ${saved}회`);

if (!APPLY) { console.log('\n실제로 바꾸려면 --apply 를 붙이세요.'); process.exit(0); }

const setTime = db.prepare('UPDATE users SET playtime = ? WHERE id = ?');
const note = db.prepare(`INSERT INTO spin_regrade (user_id, from_per, to_per, old_time, new_time, at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    from_per = excluded.from_per, to_per = excluded.to_per,
    old_time = excluded.old_time, new_time = excluded.new_time, at = excluded.at`);
let n = 0;
for (const p of plan) {
  setTime.run(p.next, p.id);
  note.run(p.id, FROM, TO, p.t, p.next, Date.now());
  n++;
}
console.log(`\n${n}명 적용했습니다. 그 사람들이 다음에 접속하면 반영됩니다`);
console.log('(이미 로그인한 기기는 계정 지갑을 받아 와 사본을 맞춥니다).');
