// 데이터베이스 백업을 뜬다. 서버를 멈추지 않아도 된다.
//
//   node scripts/backup.js
//
// 왜 파일을 그냥 복사하면 안 되나
// -------------------------------
// WAL 방식에서는 최근 쓴 내용이 아직 본 파일이 아니라 -wal 에 있다.
// 본 파일만 복사하면 그만큼을 잃는다. 실제로 재 봤더니 5000행 중
// 4MB 가 WAL 에 있었다 — 그대로 복사했으면 대부분을 잃었을 것이다.
//
// VACUUM INTO 는 지금 상태를 한 덩어리로 정리해 새 파일 하나로 떠 준다.
// 쓰기를 막지 않으므로 게임이 돌아가는 중에 돌려도 된다.
//
// 어디에 두나
// -----------
// 기본은 data/backups/ 다. **하지만 서버 안에만 두면 의미가 절반이다** —
// Oracle 무료 서버는 오래 놀면 회수될 수 있고, 그때 디스크까지 사라진다.
// BACKUP_UPLOAD 에 명령을 적어 두면 백업을 뜬 뒤 그 명령을 실행한다.
//
//   BACKUP_UPLOAD="rclone copy {file} gdrive:avoidarc"
//
// {file} 자리에 방금 뜬 파일 경로가 들어간다.

import { DatabaseSync } from 'node:sqlite';
import { exec } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(exec);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.DATA_DIR || join(root, 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, 'backups');

// 며칠치를 남길지. 넘으면 오래된 것부터 지운다.
const KEEP = Number(process.env.BACKUP_KEEP || 14);

// 백업 이름. 밀리초까지 넣는다.
//
// 초 단위로만 하면 같은 초에 두 번 뜰 때 이름이 겹쳐서 뒤에 -1, -2 를
// 붙이게 되는데, 그러면 두 가지가 한꺼번에 망가진다.
//   - '-' 가 '.' 보다 작아서 -1 이 원본보다 앞으로 정렬된다
//   - 파일에 적힌 시각도 같아서 무엇이 최신인지 알 수 없다
// 그 상태로 "오래된 것 지우기" 를 돌리면 방금 뜬 백업을 지울 수 있다.
//
// 밀리초까지 넣으면 이름이 곧 시간 순서이고, 겹칠 일이 사실상 없다.
const stamp = (d = new Date()) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `-${p(d.getMilliseconds(), 3)}`;
};

// 그래도 겹치면 1 밀리초 기다렸다 다시 짓는다. 이름에 군더더기를
// 붙이지 않아야 정렬이 계속 옳다.
async function freePath(dir) {
  for (let i = 0; i < 50; i++) {
    const path = join(dir, `avoidarc-${stamp()}.db`);
    try {
      await stat(path);
      await new Promise((r) => setTimeout(r, 2));
    } catch {
      return path;
    }
  }
  throw new Error('백업 이름을 정하지 못했습니다');
}

async function main() {
  const source = join(DATA_DIR, 'avoidarc.db');
  await mkdir(BACKUP_DIR, { recursive: true });

  const target = await freePath(BACKUP_DIR);

  const db = new DatabaseSync(source, { readOnly: true });
  db.prepare('VACUUM INTO ?').run(target);
  db.close();

  const size = (await stat(target)).size;
  console.log(`백업: ${target} (${(size / 1024).toFixed(1)}KB)`);

  // 서버 밖으로 내보내기
  //
  // 명령을 쉘에 통째로 넘긴다. 공백으로 쪼개면 경로에 공백이 있을 때
  // 깨지고(`C:/Program Files/...`), 따옴표나 파이프도 못 쓴다.
  // 이 값은 서버를 세운 사람이 .env 에 직접 적는 것이라 cron 에 적는 것과
  // 다를 바 없다.
  const upload = process.env.BACKUP_UPLOAD;
  if (upload) {
    const command = upload.replaceAll('{file}', target);
    try {
      await run(command);
      console.log(`내보냄: ${command.split(' ')[0]}`);
    } catch (err) {
      // 내보내기가 실패해도 백업 자체는 떠 뒀다. 지우지 않는다.
      const first = String(err.message).split(/\r?\n/)[0];
      console.error(`내보내기 실패 (백업 파일은 남아 있음): ${first}`);
      process.exitCode = 1;
    }
  } else {
    console.warn('BACKUP_UPLOAD 가 없어 서버 안에만 남았습니다. ' +
      '서버가 사라지면 백업도 같이 사라집니다.');
  }

  // 오래된 것 정리. 이름이 곧 시간 순서라 이름으로 줄을 세우면 된다.
  // 그래도 방금 뜬 것은 후보에서 뺀다 — 무슨 일이 있어도 이건 남아야 한다.
  //
  // 여기서 실패해도 백업은 이미 떠 있다. 파일이 잠겨 있거나(다른 데서
  // 열어 뒀거나) 권한이 없어서 못 지우는 일은 생길 수 있는데, 그 때문에
  // "백업 실패"로 끝나면 안 된다. 진짜 할 일은 이미 끝났다.
  const justMade = basename(target);
  const olds = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith('avoidarc-') && f.endsWith('.db') && f !== justMade)
    .sort()
    .reverse()
    .slice(Math.max(0, KEEP - 1));      // 방금 것이 한 자리를 차지한다

  let removed = 0;
  for (const f of olds) {
    try {
      await unlink(join(BACKUP_DIR, f));
      removed++;
    } catch (err) {
      console.warn(`오래된 백업을 못 지웠습니다 (${f}): ${err.code ?? err.message}`);
    }
  }
  if (removed) console.log(`오래된 백업 ${removed}개 정리`);
}

main().catch((err) => {
  console.error('백업 실패:', err.message);
  process.exit(1);
});
