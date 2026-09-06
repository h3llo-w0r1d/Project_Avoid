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
//   phys  : 물리 변형 (slip 미끄러움 / heavy 무거운 중력 / fast 과속 / slipheavy 둘 다)
//   zone  : 안전지대가 서서히 좁아진다(밖으로 나가면 실패)

const f = (floor, kind, rest) => ({ floor, kind, ...rest });

export const FLOORS = [
  // ── 1~10층: 입문. 조건 없이 버티기만. 여기서 조작을 익힌다.
  f(1,  'survive', { seconds: 10 }),
  f(2,  'survive', { seconds: 15 }),
  f(3,  'survive', { seconds: 20 }),
  f(4,  'survive', { seconds: 25 }),
  f(5,  'survive', { seconds: 30 }),
  f(6,  'survive', { seconds: 35 }),
  f(7,  'survive', { seconds: 40 }),
  f(8,  'survive', { seconds: 45 }),
  f(9,  'survive', { seconds: 50 }),
  f(10, 'survive', { seconds: 60 }),

  // ── 11~20층: 점프 배급제. 2단 점프는 그대로지만 총 횟수가 정해져 있다.
  //    아껴 쓰는 법을 배우는 구간. 다 쓰면 발로만 피해야 한다.
  f(11, 'survive', { seconds: 30, jumps: 12 }),
  f(12, 'survive', { seconds: 32, jumps: 12 }),
  f(13, 'survive', { seconds: 35, jumps: 12 }),
  f(14, 'survive', { seconds: 35, jumps: 8 }),
  f(15, 'survive', { seconds: 38, jumps: 8 }),
  f(16, 'survive', { seconds: 40, jumps: 8 }),
  f(17, 'survive', { seconds: 40, jumps: 5 }),
  f(18, 'survive', { seconds: 42, jumps: 5 }),
  f(19, 'survive', { seconds: 45, jumps: 5 }),
  f(20, 'survive', { seconds: 45, jumps: 4 }),

  // ── 21~30층: 물리 변형. 발밑 감각 자체가 달라진다.
  f(21, 'survive', { seconds: 30, phys: 'slip' }),
  f(22, 'survive', { seconds: 33, phys: 'slip' }),
  f(23, 'survive', { seconds: 36, phys: 'slip' }),
  f(24, 'survive', { seconds: 30, phys: 'heavy' }),
  f(25, 'survive', { seconds: 33, phys: 'heavy' }),
  f(26, 'survive', { seconds: 36, phys: 'heavy' }),
  f(27, 'survive', { seconds: 33, phys: 'fast' }),
  f(28, 'survive', { seconds: 36, phys: 'fast' }),
  f(29, 'survive', { seconds: 40, phys: 'fast' }),
  f(30, 'survive', { seconds: 40, phys: 'slipheavy' }),

  // ── 31~40층: 가야 할 곳이 생긴다. 빔만 피해서는 안 되고 움직여야 한다.
  f(31, 'circuit', { n: 3, limit: 45 }),
  f(32, 'circuit', { n: 4, limit: 55 }),
  f(33, 'circuit', { n: 5, limit: 60 }),
  f(34, 'circuit', { n: 5, limit: 55, jumps: 8 }),
  f(35, 'circuit', { n: 6, limit: 65 }),
  f(36, 'survive', { seconds: 30, zone: true }),
  f(37, 'survive', { seconds: 35, zone: true }),
  f(38, 'survive', { seconds: 40, zone: true }),
  f(39, 'survive', { seconds: 35, zone: true, jumps: 6 }),
  f(40, 'circuit', { n: 5, limit: 60, zone: true }),

  // ── 41~50층: 코인 수집. 빔을 피하는 것만으로는 안 되고 '가야' 한다.
  f(41, 'coins', { n: 6 }),
  f(42, 'coins', { n: 8 }),
  f(43, 'coins', { n: 10 }),
  f(44, 'coins', { n: 10, limit: 50 }),
  f(45, 'coins', { n: 12, limit: 50 }),
  f(46, 'coins', { n: 12, limit: 45 }),
  f(47, 'coins', { n: 14, limit: 45 }),
  f(48, 'coins', { n: 14, limit: 45, jumps: 8 }),
  f(49, 'coins', { n: 15, limit: 45, zone: true }),
  f(50, 'coins', { n: 18, limit: 45 }),

  // ── 51~60층: 봇전. 먼저 죽으면 진다. 여기에 제약이 얹히기 시작한다.
  f(51, 'bot', { tier: 'novice' }),
  f(52, 'bot', { tier: 'novice', jumps: 10 }),
  f(53, 'bot', { tier: 'novice', phys: 'slip' }),
  f(54, 'bot', { tier: 'mid' }),
  f(55, 'bot', { tier: 'mid', jumps: 8 }),
  f(56, 'bot', { tier: 'mid', phys: 'heavy' }),
  f(57, 'bot', { tier: 'expert' }),
  f(58, 'bot', { tier: 'expert', jumps: 6 }),
  f(59, 'bot', { tier: 'godwater' }),
  f(60, 'bot', { tier: 'godwater', jumps: 5 })
];

export const TOP_FLOOR = FLOORS.length;

export const floorAt = (n) => FLOORS.find((x) => x.floor === n) ?? null;

// 사람이 읽는 조건 문구. 화면에 그대로 쓴다.
const TIER_NAME = { novice: '초보', mid: '중수', expert: '고수', godwater: '고인물' };
const PHYS_NAME = {
  slip: '미끄러운 바닥',
  heavy: '무거운 중력',
  fast: '과속',
  slipheavy: '미끄럽고 무거움'
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
  if (x.jumps) tags.push(`점프 ${x.jumps}번만`);
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
  return {
    cleared: done,
    top: TOP_FLOOR,
    floors: FLOORS.map((x) => ({
      ...x,
      goal: goalText(x),
      done: x.floor <= done,          // 이미 깬 층
      open: all || x.floor === done + 1   // 지금 도전할 수 있는 층
    }))
  };
}
