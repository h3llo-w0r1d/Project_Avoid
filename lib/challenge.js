// 도전모드(탑) — 1층부터 한 층씩 올라가며 깬다.
//
// 층 정의를 서버가 갖고 프로필/도전 API 로 내려보낸다. 그래서 조건을 바꾸고 싶으면
// 이 파일만 고치면 클라 화면도 같이 바뀐다.
//
// 층은 '이기는 조건(kind) × 제약(나머지 칸)' 으로 짠다. 조건 종류를 100개 만드는
// 대신 몇 개를 제약과 조합하면 층이 얼마든지 나온다. 같은 '30초 버티기'라도
// 점프가 8번뿐인 층과 바닥이 미끄러운 층은 전혀 다른 판이 된다.
//
// kind — 이기는 조건
//   survive : seconds 초 버티기
//   circuit : limit 초 안에 발판 n 곳 밟기
//   coins   : (limit 초 안에) 코인 n 개 모으기
//   bot     : 봇(tier) 이기기
//
// 제약 — 있으면 얹는다. 서로 자유롭게 겹칠 수 있다.
//   jumps : 이 판에서 점프를 총 몇 번만 쓸 수 있다
//   phys  : 물리 조작 (slip 미끄러움 / heavy 무거운 중력 / fast 과속 / all 셋 다)
//   zone  : 안전지대가 서서히 좁아진다(밖으로 나가면 실패)

const f = (floor, kind, rest) => ({ floor, kind, ...rest });

export const FLOORS = [
  // ── 1~10층: 튜토리얼. 조건 없이 버티기만. 여기서 조작을 익힌다.
  f(1,  'survive', { seconds: 10 }),
  f(2,  'survive', { seconds: 15 }),
  f(3,  'survive', { seconds: 20 }),
  f(4,  'survive', { seconds: 25 }),
  f(5,  'survive', { seconds: 30 }),
  f(6,  'survive', { seconds: 35 }),
  f(7,  'survive', { seconds: 40 }),
  f(8,  'survive', { seconds: 45 }),
  f(9,  'survive', { seconds: 50 }),
  f(10, 'survive', { seconds: 55 }),

  // ── 11~20층: 점프 제한. 2단 점프는 그대로지만 총 횟수가 정해져 있다.
  //    예산은 실제 기록 131판에서 잰 사용량을 기준으로 잡았다 — 점프는 전부
  //    22번으로 통일하고 시간만 15초부터 3초씩 늘린다. 실측으로 사람들은
  //    초당 중앙값 0.75번을 쓰므로, 22번이면 29초쯤부터 모자라기 시작한다 —
  //    앞쪽 다섯 층은 몸풀기, 30초를 넘어가는 층부터는 아껴 써야 넘어간다.
  f(11, 'survive', { seconds: 15, jumps: 22 }),
  f(12, 'survive', { seconds: 18, jumps: 22 }),
  f(13, 'survive', { seconds: 21, jumps: 22 }),
  f(14, 'survive', { seconds: 24, jumps: 22 }),
  f(15, 'survive', { seconds: 27, jumps: 22 }),
  f(16, 'survive', { seconds: 30, jumps: 22 }),
  f(17, 'survive', { seconds: 33, jumps: 22 }),
  f(18, 'survive', { seconds: 36, jumps: 22 }),
  f(19, 'survive', { seconds: 39, jumps: 22 }),
  f(20, 'survive', { seconds: 42, jumps: 22 }),

  // ── 21~30층: 코인 수집. 빔을 피하는 것만으로는 안 되고 '가야' 한다.
  //    21~23 은 제한 시간이 없다 — 오래 버티며 줍는 층이다.
  //    24층부터는 30초 안에 끝내야 해서 무대를 쉬지 않고 훑어야 하고,
  //    28~30 은 거기에 점프 배급이 얹혀 뛰어서 가로지르는 길이 막힌다.
  f(21, 'coins', { n: 20 }),
  f(22, 'coins', { n: 30 }),
  f(23, 'coins', { n: 40 }),
  f(24, 'coins', { n: 15, limit: 30 }),
  f(25, 'coins', { n: 20, limit: 30 }),
  f(26, 'coins', { n: 25, limit: 30 }),
  f(27, 'coins', { n: 30, limit: 30 }),
  f(28, 'coins', { n: 20, limit: 30, jumps: 30 }),
  f(29, 'coins', { n: 25, limit: 30, jumps: 25 }),
  f(30, 'coins', { n: 30, limit: 30, jumps: 20 }),

  // ── 31~40층: 물리 조작. 발밑 감각 자체가 달라진다.
  f(31, 'survive', { seconds: 30, phys: 'slip' }),
  f(32, 'survive', { seconds: 35, phys: 'slip' }),
  f(33, 'survive', { seconds: 40, phys: 'slip' }),
  f(34, 'survive', { seconds: 30, phys: 'heavy' }),
  f(35, 'survive', { seconds: 35, phys: 'heavy' }),
  f(36, 'survive', { seconds: 40, phys: 'heavy' }),
  f(37, 'survive', { seconds: 40, phys: 'fast' }),
  f(38, 'survive', { seconds: 35, phys: 'fast' }),
  f(39, 'survive', { seconds: 40, phys: 'fast' }),
  f(40, 'survive', { seconds: 50, phys: 'all' }),

  // ── 41~50층: 봇전. 먼저 죽으면 진다. 상대 실력은 왕초보 한 층 뒤로 세 층씩 올라간다.
  //    같은 실력 안에서는 맨손 → 점프 배급 → 물리 조작 순으로 얹는다. 안 그러면
  //    조건 문구가 똑같은 층이 세 번 이어져 뭘 더 해야 하는지 알 수 없다.
  f(41, 'bot', { tier: 'rookie' }),
  f(42, 'bot', { tier: 'novice' }),
  f(43, 'bot', { tier: 'novice', jumps: 25 }),
  f(44, 'bot', { tier: 'novice', phys: 'fast' }),
  f(45, 'bot', { tier: 'mid' }),
  f(46, 'bot', { tier: 'mid', jumps: 25 }),
  f(47, 'bot', { tier: 'mid', phys: 'fast' }),
  f(48, 'bot', { tier: 'expert' }),
  f(49, 'bot', { tier: 'expert', jumps: 25 }),
  f(50, 'bot', { tier: 'expert', phys: 'all' })
];

// 10층씩 묶은 구간. 화면에서 "여기부터 성격이 바뀐다"를 알려 주는 표지판이다.
// 층 정의와 같이 두어야 둘이 안 어긋난다.
export const ZONES = [
  { from: 1,  to: 10, name: '튜토리얼' },
  { from: 11, to: 20, name: '점프 제한' },
  { from: 21, to: 30, name: '코인 수집' },
  { from: 31, to: 40, name: '물리 조작' },
  { from: 41, to: 50, name: '봇전' }
];

export const TOP_FLOOR = FLOORS.length;

// 지금까지 내놓은 층. 그 위는 아직 다듬는 중이라 목록에는 보이되 들어갈 수
// 없다 — 탑이 50층까지 있다는 건 보여 주고, 어디까지 준비됐는지도 같이
// 보여 주는 편이 "왜 여기서 끊기지?" 보다 낫다. 관리자는 이 선을 무시한다.
//
// 지금은 꼭대기까지 다 열었다. 이 값이 TOP_FLOOR 와 같으면 "N층까지 열렸어요"
// 안내와 「업데이트 중」 표시가 저절로 사라진다.
export const RELEASED = 50;

export const floorAt = (n) => FLOORS.find((x) => x.floor === n) ?? null;

// 사람이 읽는 조건 문구. 화면에 그대로 쓴다.
const TIER_NAME = { rookie: '왕초보', novice: '초보', mid: '중수',
  expert: '고수', master: '초고수', godwater: '고인물' };
const PHYS_NAME = {
  slip: '미끄러운 바닥',
  heavy: '무거운 중력',
  fast: '과속',
  all: '미끄럽고 무겁고 빠름'
};

function baseText(x) {
  if (x.kind === 'survive') return `${x.seconds}초 버티기`;
  if (x.kind === 'circuit') return `${x.limit}초 안에 발판 ${x.n}곳 밟기`;
  if (x.kind === 'coins') {
    return x.limit ? `${x.limit}초 안에 코인 ${x.n}개` : `코인 ${x.n}개 모으기`;
  }
  if (x.kind === 'bot') return `봇(${TIER_NAME[x.tier] ?? x.tier}) 이기기`;
  return '';
}

export function goalText(x) {
  if (!x) return '';
  const tags = [];
  if (x.jumps) tags.push(`점프 ${x.jumps}번 제한`);
  if (x.phys) tags.push(PHYS_NAME[x.phys] ?? x.phys);
  if (x.zone) tags.push('좁아지는 안전지대');
  const base = baseText(x);
  return tags.length ? `${base} · ${tags.join(' · ')}` : base;
}

// 클라에 내려보낼 목록(각 층 + 조건 문구 + 깼는지/지금 도전 가능한지).
// 층 정의를 통째로 펼쳐 보내므로, 여기에 칸을 더해도 클라가 알아서 받는다.
// all = true 면 순서를 무시하고 전부 열어 준다. 관리자가 층을 확인할 때 쓴다 —
// 40층을 보려고 39층까지 깨고 올 수는 없다.
export function describe(cleared, all = false) {
  const done = Math.max(0, Math.min(TOP_FLOOR, cleared | 0));
  const released = all ? TOP_FLOOR : RELEASED;
  return {
    cleared: done,
    // 아직 안 내놓은 구간은 이름까지 가린다 — 무엇이 기다리는지는 열릴 때의
    // 재미다. 서버에서 가려야 응답을 들여다봐도 안 보인다.
    zones: ZONES.map((z) => (z.from > released ? { ...z, name: '???', soon: true } : z)),
    top: TOP_FLOOR,
    released,
    floors: FLOORS.map((x) => ({
      ...x,
      goal: goalText(x),
      done: x.floor <= done,               // 이미 깬 층
      soon: !all && x.floor > RELEASED,    // 아직 안 내놓은 층
      open: all || (x.floor === done + 1 && x.floor <= RELEASED)
    }))
  };
}
