// 칭호(타이틀). 서버가 정의를 소유하고, 프로필 응답에 그대로 실어 보낸다.
// 클라이언트는 서버가 준 목록을 그리기만 하므로 정의가 한 곳에만 있다.
//
// 지금은 전부 '판수'로 얻는다(서버가 제출된 판수를 이미 안다). 나중에
// 다른 조건(기록·랭킹 등)을 더할 땐 kind 를 늘리고 earnedOf 만 고치면 된다.

export const TITLES = [
  // 판수 칭호 — 파랑 계열로 등급이 올라갈수록 점점 진하게.
  { id: 'rookie',   name: '입문자',   icon: '', plays: 10,   color: '#c2d6ff' },
  { id: 'skilled',  name: '숙련자',   icon: '', plays: 100,  color: '#8aabff' },
  { id: 'veteran',  name: '베테랑',   icon: '', plays: 500,  color: '#5680ff' },
  { id: 'godwater', name: '고인물',   icon: '', plays: 1000, color: '#2f54d4' },
  // 럭키가이 — 룰렛 대박(500코인·가나디라고라·노래) 당첨 시 얻는 업적 칭호. 노랑.
  // 판수와 무관하게, 클라가 대박이 나면 서버에 수여를 요청해 계정에 새긴다.
  // 럭키가이·행운의 여신 — 룰렛 희귀 보상(0.1~5%: 노래·잭팟·가나디)을
  // 누적 몇 번 뽑았는지로 얻는다. 계정의 lucky_hits 로 판정한다.
  { id: 'luckyguy', name: '럭키가이', icon: '', luckyHits: 3,
    cond: '룰렛 희귀 보상 3회', color: '#ffcf3f' },
  { id: 'goddess', name: '행운의 여신', icon: '', luckyHits: 10,
    cond: '룰렛 희귀 보상 10회', color: '#ff8fd8' },
  // 불운·저주받은 자 — 룰렛 꽝 연속. 보라 계열(저주가 더 진하게).
  { id: 'unlucky', name: '불운',       icon: '', achievement: true,
    cond: '룰렛 꽝 5연속 시', color: '#b79bff' },
  { id: 'cursed',  name: '저주받은 자', icon: '', achievement: true,
    cond: '룰렛 꽝 10연속 시', color: '#7c4dd6' },
  // 운영자 전용. 판수와 무관하게 관리자만 얻고 달 수 있다. 특별 칭호라 빨강.
  { id: 'operator', name: '운영자',   icon: '', adminOnly: true, color: '#ff5566' }
];

const byId = new Map(TITLES.map((t) => [t.id, t]));

// 클라가 요청해 수여할 수 있는 업적 칭호인지(그 외 id 의 수여 요청은 무시).
export const isAwardable = (id) => byId.get(id)?.achievement === true;

// ctx = { plays, isAdmin, awards }. 관리자는 모든 칭호를 획득 처리한다.
//  - adminOnly(운영자): 관리자만
//  - achievement(럭키가이 등): 계정에 수여된(awards 에 든) 경우 (관리자는 전부)
//  - 그 외: 판수 문턱
export function isEarned(title, ctx) {
  if (title.adminOnly) return !!ctx.isAdmin;
  if (ctx.isAdmin) return true;
  // 룰렛 희귀 보상 누적 횟수로 얻는 칭호(럭키가이·행운의 여신)
  if (title.luckyHits) return (ctx.luckyHits ?? 0) >= title.luckyHits;
  if (title.achievement) return Array.isArray(ctx.awards) && ctx.awards.includes(title.id);
  return (ctx.plays ?? 0) >= title.plays;
}

// 잠긴 칭호에 보여 줄 획득 조건 문구.
function condOf(title) {
  if (title.cond) return title.cond;
  return title.adminOnly ? '운영자 전용' : `${title.plays}판 달성 시`;
}

// 얻은 칭호 id 들.
export function earnedIds(ctx) {
  return TITLES.filter((t) => isEarned(t, ctx)).map((t) => t.id);
}

// 장착 요청을 검증해 실제로 저장할 id 배열로 만든다.
// - 얻지 못한 칭호는 버린다(치트 방지)
// - 정의에 없는 id 는 버린다
// - 최대 3개, 중복 제거, TITLES 순서 유지
export function sanitizeEquipped(ids, ctx) {
  const want = new Set(Array.isArray(ids) ? ids : []);
  return TITLES
    .filter((t) => want.has(t.id) && isEarned(t, ctx))
    .slice(0, 3)
    .map((t) => t.id);
}

// 프로필 응답용: 모든 칭호 + 이 사람의 획득·장착 여부.
// 운영자 칭호는 그 사람이 관리자일 때만 목록에 넣는다(일반 유저에겐 안 보임).
export function describe(ctx, equippedIds) {
  const eq = new Set(Array.isArray(equippedIds) ? equippedIds : []);
  const visible = TITLES.filter((t) => !t.adminOnly || ctx.isAdmin);
  // 예전에 장착해 뒀어도 지금 조건을 못 채우면 장착으로 안 친다(조건이 바뀐 경우).
  const on = (t) => eq.has(t.id) && isEarned(t, ctx);
  return {
    equipped: visible.filter(on).map((t) => t.id),
    all: visible.map((t) => ({
      id: t.id, name: t.name, icon: t.icon, plays: t.plays,
      color: t.color ?? null,
      cond: condOf(t),
      earned: isEarned(t, ctx),
      equipped: on(t)
    }))
  };
}

// 장착한 칭호의 겉모습만(닉네임 옆·랭킹 등 표시용). 순서는 TITLES 순.
export function equippedChips(equippedIds) {
  const eq = new Set(Array.isArray(equippedIds) ? equippedIds : []);
  return TITLES.filter((t) => eq.has(t.id)).map((t) => ({ name: t.name, icon: t.icon }));
}

export const titleById = (id) => byId.get(id) ?? null;
