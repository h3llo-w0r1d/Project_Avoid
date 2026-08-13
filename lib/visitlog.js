// 방문 기록 보기 (관리자 디버깅용).
//
// 앱 DB 에 IP 를 새로 저장하지 않는다. 대신 이미 보안·장애 확인용으로 쌓이는
// nginx 접속 로그를 읽어, 게임 페이지를 연 요청만 골라 보여 준다. 시간·IP·
// 기기·봇여부를 함께 준다. 봇을 눈으로 확인하고 오류를 잡는 용도다.
//
// 로그를 읽으려면 앱 유저가 adm 그룹에 있어야 한다(로그 파일이 adm 그룹
// 읽기 전용). 서버에서 `usermod -aG adm <유저>` 후 서비스 재시작이 필요하다.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isBot, isMobile } from './bots.js';

const run = promisify(execFile);
const LOG = process.env.ACCESS_LOG || '/var/log/nginx/access.log';

// nginx combined 한 줄:
//   IP - - [time] "METHOD path HTTP/x" status bytes "referer" "user-agent"
const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^ "]*)[^"]*" (\d+) \S+ "[^"]*" "([^"]*)"/;

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// [13/Aug/2026:21:47:03 +0000] → epoch ms
function parseTime(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})/.exec(s);
  if (!m) return null;
  const off = (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5)));
  return Date.UTC(+m[3], MON[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]) - off * 60_000;
}

// 게임 페이지를 연 방문만, 최근 것부터. scan 은 훑을 최근 줄 수.
export async function readVisits({ limit = 50, offset = 0, scan = 6000 } = {}) {
  let stdout;
  try {
    ({ stdout } = await run('tail', ['-n', String(scan), LOG], { maxBuffer: 32 * 1024 * 1024 }));
  } catch (err) {
    return { rows: [], total: 0, error: '로그를 읽지 못했습니다: ' + err.message };
  }

  const lines = stdout.split('\n');
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {   // 최근 것부터
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    const [, ip, time, method, path, status, ua] = m;
    if (method !== 'GET') continue;
    if (path !== '/' && path !== '/index.html') continue;   // 게임 페이지 열림만
    out.push({
      at: parseTime(time),
      ip,
      device: isMobile(ua) ? 'mobile' : 'pc',
      bot: isBot(ua),
      status: Number(status)
    });
  }

  return { rows: out.slice(offset, offset + limit), total: out.length };
}
