// 기록이 진짜인지 최소한이라도 확인하기 위한 표.
//
// 왜 필요한가
// -----------
// 전에는 브라우저가 보낸 시간을 그대로 믿었다. 그래서 게임을 한 판도
// 안 하고 명령 한 줄로 3599초를 올려 1위가 될 수 있었다. 실제로 해 봤다.
// 신원(닉네임)은 잘 막고 있었지만 "정말 그만큼 버텼는가" 는 아무도
// 확인하지 않았다.
//
// 어떻게 막나
// -----------
// 판을 시작할 때 서버가 표를 하나 내준다. 표에는 발급 시각이 적혀 있다.
// 기록을 올릴 때 그 표를 같이 내야 하고, 서버는 이렇게 본다.
//
//   올린 시간 <= 표를 받은 뒤 실제로 흐른 시간
//
// 300초를 주장하려면 표를 받고 실제로 300초를 기다려야 한다. 명령줄로
// 순식간에 1위를 만드는 짓은 이걸로 끝난다.
//
// 무엇을 못 막나
// --------------
// 게임 코드를 고쳐서 "죽지 않은 채로 300초를 흘려보내는" 것은 여전히
// 가능하다. 그건 서버가 판을 통째로 다시 돌려 봐야 잡을 수 있다
// (1v1 이 이미 그렇게 한다). 이 표는 그 전 단계의 값싼 방어다.
//
// 표를 미리 잔뜩 받아 두는 것도 생각해야 한다. 한 IP 가 들고 있을 수 있는
// 표 수를 제한하고, 표에 유효기간을 둬서 쌓아 두기 어렵게 한다.

import { randomUUID } from 'node:crypto';

export function createTickets({
  // 표의 유효기간. 이 시간이 지나면 못 쓴다.
  // 기록 상한(3600초)과 맞춰 둔다 — 더 길게 두면 표를 묵혀 두고
  // 상한에 가까운 값을 부르기 쉬워진다.
  maxAgeMs = 3600_000,
  // 봐주는 오차.
  //
  // 서버가 표에 시각을 적는 순간은 게임이 시작된 순간보다 아주 조금 늦다
  // (요청이 서버까지 가는 시간). 그래서 서버가 재는 경과 시간이 실제
  // 플레이 시간보다 그만큼 짧게 나온다. 보통 0.1초, 느린 모바일에서도
  // 0.5초 정도다. 1.2초면 넉넉하다.
  //
  // 여기를 크게 잡을수록 조작할 여지가 그대로 늘어난다. 2초로 뒀더니
  // 3초 흐른 판에서 4.5초를 불러도 통과했다.
  graceMs = 1200,
  // 한 곳에서 들고 있을 수 있는 표의 수
  perIp = 12
} = {}) {
  const live = new Map();          // id -> { at, ip, userId }

  // 오래된 표를 걷어낸다. 표를 낼 때마다 훑으므로 따로 타이머를 두지 않는다.
  const sweep = (now) => {
    for (const [id, t] of live) {
      if (now - t.at > maxAgeMs) live.delete(id);
    }
  };

  return {
    issue(ip, userId = null) {
      const now = Date.now();
      sweep(now);

      // 같은 곳에서 표를 쌓아 두면 제일 오래된 것부터 버린다.
      // Map 은 넣은 순서를 지키므로 앞에서부터가 곧 오래된 순이다.
      const mine = [...live].filter(([, t]) => t.ip === ip);
      for (const [id] of mine.slice(0, Math.max(0, mine.length - perIp + 1))) {
        live.delete(id);
      }

      const id = randomUUID();
      live.set(id, { at: now, ip, userId });
      return id;
    },

    // 통과하면 { ok: true }, 아니면 { error: '사람이 읽을 말' }
    redeem(id, seconds, { ip, userId = null } = {}) {
      const t = live.get(id);
      if (!t) {
        return { error: '기록을 확인할 수 없습니다. 게임을 다시 시작해 주세요.' };
      }

      // 한 번 쓴 표는 그 자리에서 버린다. 실패해도 버린다 —
      // 남겨 두면 값을 바꿔 가며 될 때까지 찔러 볼 수 있다.
      live.delete(id);

      const now = Date.now();
      if (now - t.at > maxAgeMs) {
        return { error: '너무 오래된 기록입니다. 게임을 다시 시작해 주세요.' };
      }
      // 로그인한 채로 시작했으면 그 계정만 낼 수 있다. 남의 표를 주워
      // 자기 기록으로 올리는 것을 막는다.
      if (t.userId && t.userId !== userId) {
        return { error: '기록을 확인할 수 없습니다. 게임을 다시 시작해 주세요.' };
      }
      if (seconds * 1000 > (now - t.at) + graceMs) {
        return { error: '기록이 실제 경과 시간과 맞지 않습니다.' };
      }
      return { ok: true };
    },

    // 관리 화면과 시험용
    get size() { return live.size; }
  };
}
