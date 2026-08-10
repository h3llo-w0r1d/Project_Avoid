// 지금 사이트에 몇 명이 있는지(실시간 접속).
//
// 페이지를 열어 둔 사람이 주기적으로 신호(heartbeat)를 보낸다. 서버는 최근에
// 신호가 온 사람만 센다. 그래서:
//   - 봇처럼 열고 바로 나간 건 안 잡힌다 (신호를 안 보낸다)
//   - 탭을 닫으면 신호가 끊겨 잠시 뒤 저절로 빠진다
//
// 개인정보를 저장하지 않는다. 신호마다 붙는 id 는 브라우저가 페이지를 열 때
// 새로 만드는 임시 난수라 사람을 특정할 수 없고, 메모리에만 잠깐 있다가
// 사라진다. 서버를 다시 켜면 0 부터 다시 센다.

export function openPresence({ windowMs = 45_000 } = {}) {
  const seen = new Map();   // id -> 마지막 신호 시각

  const purge = (now) => {
    for (const [id, at] of seen) {
      if (now - at > windowMs) seen.delete(id);
    }
  };

  return {
    // 신호 하나. 그 id 를 지금 본 것으로 기록한다.
    beat(id) {
      if (typeof id !== 'string' || id.length < 8 || id.length > 64) return;
      seen.set(id, Date.now());
    },

    // 탭을 닫을 때 오는 작별 신호. 45초를 기다리지 않고 바로 뺀다.
    leave(id) {
      if (typeof id === 'string') seen.delete(id);
    },

    // 최근 windowMs 안에 신호가 온 사람 수.
    count() {
      const now = Date.now();
      purge(now);
      return seen.size;
    }
  };
}
