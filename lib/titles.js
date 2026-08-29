// 칭호(타이틀). 서버가 정의를 소유하고, 프로필 응답에 그대로 실어 보낸다.
// 클라이언트는 서버가 준 목록을 그리기만 하므로 정의가 한 곳에만 있다.
//
// 지금은 전부 '판수'로 얻는다(서버가 제출된 판수를 이미 안다). 나중에
// 다른 조건(기록·랭킹 등)을 더할 땐 kind 를 늘리고 earnedOf 만 고치면 된다.

export const TITLES = [
  { id: 'rookie',   name: '입문자',   icon: '✨', plays: 10 },
  { id: 'skilled',  name: '숙련자',   icon: '🔰', plays: 100 },
  { id: 'veteran',  name: '베테랑',   icon: '🎖️', plays: 500 },
  { id: 'godwater', name: '고인물',   icon: '🔥', plays: 1000 }
];

const byId = new Map(TITLES.map((t) => [t.id, t]));

// 이 판수로 얻은 칭호인가.
export function isEarned(title, stats) {
  return (stats.plays ?? 0) >= title.plays;
}

// 얻은 칭호 id 들.
export function earnedIds(stats) {
  return TITLES.filter((t) => isEarned(t, stats)).map((t) => t.id);
}

// 장착 요청을 검증해 실제로 저장할 id 배열로 만든다.
// - 얻지 못한 칭호는 버린다(치트 방지)
// - 정의에 없는 id 는 버린다
// - 최대 3개, 중복 제거, TITLES 순서 유지
export function sanitizeEquipped(ids, stats) {
  const want = new Set(Array.isArray(ids) ? ids : []);
  return TITLES
    .filter((t) => want.has(t.id) && isEarned(t, stats))
    .slice(0, 3)
    .map((t) => t.id);
}

// 프로필 응답용: 모든 칭호 + 이 사람의 획득·장착 여부.
export function describe(stats, equippedIds) {
  const eq = new Set(Array.isArray(equippedIds) ? equippedIds : []);
  return {
    equipped: TITLES.filter((t) => eq.has(t.id)).map((t) => t.id),
    all: TITLES.map((t) => ({
      id: t.id, name: t.name, icon: t.icon, plays: t.plays,
      earned: isEarned(t, stats),
      equipped: eq.has(t.id)
    }))
  };
}

// 장착한 칭호의 겉모습만(닉네임 옆·랭킹 등 표시용). 순서는 TITLES 순.
export function equippedChips(equippedIds) {
  const eq = new Set(Array.isArray(equippedIds) ? equippedIds : []);
  return TITLES.filter((t) => eq.has(t.id)).map((t) => ({ name: t.name, icon: t.icon }));
}

export const titleById = (id) => byId.get(id) ?? null;
