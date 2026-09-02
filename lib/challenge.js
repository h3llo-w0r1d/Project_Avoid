// 도전모드(탑) — 1층부터 한 층씩 올라가며 깬다.
//
// 층 정의를 서버가 갖고 프로필/도전 API 로 내려보낸다. 그래서 조건을 바꾸고 싶으면
// 이 파일만 고치면 클라 화면도 같이 바뀐다.
//
// kind:
//   survive — 한 판에서 seconds 초 이상 버티기
//   coins   — 한 판에서 코인 n 개 모으기
//   bot     — 봇전에서 tier 난이도 이기기
// (지금은 임시로 survive 만 쓴다. 조건 컨셉이 정해지면 여기만 갈아끼우면 된다.)

export const FLOORS = [
  { floor: 1,  kind: 'survive', seconds: 10 },
  { floor: 2,  kind: 'survive', seconds: 15 },
  { floor: 3,  kind: 'survive', seconds: 20 },
  { floor: 4,  kind: 'survive', seconds: 25 },
  { floor: 5,  kind: 'survive', seconds: 30 },
  { floor: 6,  kind: 'survive', seconds: 35 },
  { floor: 7,  kind: 'survive', seconds: 40 },
  { floor: 8,  kind: 'survive', seconds: 45 },
  { floor: 9,  kind: 'survive', seconds: 50 },
  { floor: 10, kind: 'survive', seconds: 60 }
];

export const TOP_FLOOR = FLOORS.length;

export const floorAt = (n) => FLOORS.find((f) => f.floor === n) ?? null;

// 사람이 읽는 조건 문구. 화면에 그대로 쓴다.
export function goalText(f) {
  if (!f) return '';
  if (f.kind === 'survive') return `${f.seconds}초 버티기`;
  if (f.kind === 'coins') return `한 판에 코인 ${f.n}개 모으기`;
  if (f.kind === 'bot') return `봇(${f.tier}) 이기기`;
  return '';
}

// 클라에 내려보낼 목록(각 층 + 조건 문구 + 깼는지/지금 도전 가능한지).
export function describe(cleared) {
  const done = Math.max(0, Math.min(TOP_FLOOR, cleared | 0));
  return {
    cleared: done,
    top: TOP_FLOOR,
    floors: FLOORS.map((f) => ({
      floor: f.floor,
      kind: f.kind,
      seconds: f.seconds,
      n: f.n,
      tier: f.tier,
      goal: goalText(f),
      done: f.floor <= done,          // 이미 깬 층
      open: f.floor === done + 1      // 지금 도전할 수 있는 층
    }))
  };
}
