// 지금 사이트에 몇 명이 있는지(실시간 접속).
//
// 페이지를 열어 둔 사람이 주기적으로 신호(heartbeat)를 보낸다. 서버는 최근에
// 신호가 온 사람만 센다. 그래서:
//   - 봇처럼 열고 바로 나간 건 안 잡힌다 (신호를 안 보낸다)
//   - 탭을 닫으면 신호가 끊겨 잠시 뒤 저절로 빠진다
//
// 신호마다 붙는 id 는 브라우저가 페이지를 열 때 새로 만드는 임시 난수라
// 사람을 특정할 수 없다. 관리 화면에 누가 있는지 보여 주려고 화면에 쓰는
// 이름(닉네임·게스트 이름)을 같이 들고 있는데, 이것도 메모리에만 잠깐
// 있다가 사라진다 — 디스크에 남기지 않고, 서버를 다시 켜면 0 부터 다시
// 센다. 닉네임은 랭킹에 이미 공개되는 값이다.

export function openPresence({ windowMs = 45_000 } = {}) {
  const seen = new Map();   // id -> { at: 마지막 신호 시각, name: 화면에 쓰는 이름 }

  const purge = (now) => {
    for (const [id, v] of seen) {
      if (now - v.at > windowMs) seen.delete(id);
    }
  };

  return {
    // 신호 하나. 그 id 를 지금 본 것으로 기록한다.
    beat(id, name) {
      if (typeof id !== 'string' || id.length < 8 || id.length > 64) return;
      const who = typeof name === 'string' ? name.trim().slice(0, 24) : '';
      seen.set(id, { at: Date.now(), name: who });
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
    },

    // 지금 있는 사람들의 이름. 한 사람이 탭을 여러 개 열어 두면 한 줄로
    // 묶고 몇 개인지만 적는다 — 같은 이름이 여러 번 뜨면 몇 명인지 헷갈린다.
    // 이름을 아직 못 받은 신호(페이지가 막 열린 참)는 세지 않는다.
    names() {
      purge(Date.now());
      const byName = new Map();
      for (const v of seen.values()) {
        if (!v.name) continue;
        byName.set(v.name, (byName.get(v.name) ?? 0) + 1);
      }
      return [...byName]
        .map(([name, tabs]) => ({ name, tabs }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }
  };
}
