// 특정 계정에 캐릭터를 선물한다.
//
//   node scripts/gift-character.js <닉네임> <캐릭터id> ["한 줄 멘트"]
//   node scripts/gift-character.js --list
//   node scripts/gift-character.js --revoke <닉네임> <캐릭터id>
//
// 왜 관리 화면(웹)이 아니라 스크립트인가
// --------------------------------------
// 선물은 '그 사람만' 쓰게 하는 게 목적이라, 주는 경로가 적을수록 좋다.
// 웹 엔드포인트를 열면 그만큼 공격면이 늘고, 실수로 권한이 새면 아무나
// 자기에게 줄 수 있게 된다. 서버에 들어갈 수 있는 사람만 줄 수 있으면 된다.
//
// 지갑(users.owned)에 안 넣는 이유는 lib/chargifts.js 머리말에 적어 뒀다.
//
// 서버를 멈출 필요는 없다. 준 선물은 그 사람이 다음에 접속할 때(또는 10초
// 안에 폴링으로) 선물 창과 함께 반영된다.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../lib/db.js';
import { openCharGifts } from '../lib/chargifts.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || join(root, 'data');

const db = await openDatabase(DATA_DIR);
const gifts = openCharGifts(db);

// 닉네임으로 계정을 찾는다. 대소문자만 다른 이름을 막으려고 nickname_key 를
// 쓰지만, 눈으로 준 이름 그대로도 맞춰 본다.
function findUser(nickname) {
  const rows = db.prepare(
    'SELECT id, nickname FROM users WHERE nickname = ? OR nickname_key = ?'
  ).all(nickname, String(nickname).toLowerCase());
  return rows;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === '--list') {
  const all = gifts.all();
  if (!all.length) { console.log('준 선물이 없습니다.'); process.exit(0); }
  const nameOf = (id) =>
    db.prepare('SELECT nickname FROM users WHERE id = ?').get(id)?.nickname ?? '(탈퇴)';
  for (const g of all) {
    const when = new Date(g.createdAt).toISOString().slice(0, 16).replace('T', ' ');
    const seen = g.claimedAt ? '받아봄' : '아직 안 봄';
    console.log(`${when}  ${nameOf(g.userId)}  ${g.charId}  [${seen}]`
      + (g.message ? `  "${g.message}"` : ''));
  }
  process.exit(0);
}

const revoking = cmd === '--revoke';
const [nickname, charId, message = ''] = revoking ? rest : [cmd, ...rest];

if (!nickname || !charId) {
  console.error('사용법: node scripts/gift-character.js <닉네임> <캐릭터id> ["멘트"]');
  console.error('        node scripts/gift-character.js --list');
  console.error('        node scripts/gift-character.js --revoke <닉네임> <캐릭터id>');
  process.exit(1);
}

const found = findUser(nickname);
if (!found.length) {
  console.error(`'${nickname}' 계정을 찾지 못했습니다.`);
  process.exit(1);
}
// 같은 이름이 여럿이면 멈춘다 — 엉뚱한 사람에게 주는 것보다 낫다.
if (found.length > 1) {
  console.error(`'${nickname}' 과 맞는 계정이 ${found.length}개입니다. 직접 고르세요:`);
  for (const u of found) console.error(`  ${u.id}  ${u.nickname}`);
  process.exit(1);
}

const user = found[0];
if (revoking) {
  const left = gifts.revoke(user.id, charId);
  console.log(`거뒀습니다: ${user.nickname} ← ${charId}`);
  console.log(`남은 선물: ${left.length ? left.join(', ') : '없음'}`);
} else {
  const owned = gifts.grant(user.id, charId, message);
  console.log(`선물했습니다: ${user.nickname} → ${charId}`);
  if (message) console.log(`멘트: "${message}"`);
  console.log(`이 계정의 선물: ${owned.join(', ')}`);
  console.log('그 사람이 다음에 접속하면 선물 창이 뜹니다.');
}
