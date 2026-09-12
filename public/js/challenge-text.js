// 탑(도전모드) 층 조건 문구를 화면 언어로 만든다.
//
// 서버(lib/challenge.js 의 goalText()/baseText())는 관리자 기록에 남길
// 한국어 문구만 만든다. 화면에 보여줄 문구는 여기서 지금 언어로 새로
// 만든다 — 규칙(kind별 기본 문장 + jumps/phys/zone 꼬리표)은 서버와
// 글자 하나까지 같아야 한다(한국어일 때). 서버 쪽을 고치면 여기도 같이 고쳐라.
import { t } from './i18n.js';

// 봇 실력 이름. main.js 의 BOT_TIER_KEY(봇전 난이도 선택 화면)와 같은 키를 쓴다.
const TIER_KEY = {
  rookie: 'bot.tierRookie', novice: 'bot.tierNovice', mid: 'bot.tierMid',
  expert: 'bot.tierExpert', master: 'bot.tierMaster', godwater: 'bot.tierVeteran'
};

const PHYS_KEY = {
  slip: 'goal.physSlip', heavy: 'goal.physHeavy', fast: 'goal.physFast', all: 'goal.physAll'
};

function baseText(f) {
  if (f.kind === 'survive') return t('goal.survive', { n: f.seconds });
  if (f.kind === 'circuit') return t('goal.circuit', { limit: f.limit, n: f.n });
  if (f.kind === 'coins') {
    return f.limit ? t('goal.coinsLimit', { limit: f.limit, n: f.n }) : t('goal.coins', { n: f.n });
  }
  if (f.kind === 'bot') return t('goal.bot', { tier: TIER_KEY[f.tier] ? t(TIER_KEY[f.tier]) : f.tier });
  return '';
}

// 층 객체({ floor, kind, seconds, n, limit, jumps, phys, zone, tier })를 받아
// "30초 버티기 · 미끄러운 바닥" 같은 문구를 만든다.
export function floorGoal(f) {
  if (!f) return '';
  const tags = [];
  if (f.jumps) tags.push(t('goal.tagJumps', { n: f.jumps }));
  if (f.phys) tags.push(PHYS_KEY[f.phys] ? t(PHYS_KEY[f.phys]) : f.phys);
  if (f.zone) tags.push(t('goal.tagZone'));
  const base = baseText(f);
  return tags.length ? `${base} · ${tags.join(' · ')}` : base;
}

// 구간 이름. from(구간 시작 층)으로 구분한다 — 서버가 보내는 이름 문자열을
// 그대로 매칭하면 서버 쪽 표현이 바뀔 때 같이 깨지기 쉽다.
const ZONE_KEY = { 1: 'goal.zoneTutorial', 11: 'goal.zoneJumps', 21: 'goal.zoneCoins', 31: 'goal.zonePhys', 41: 'menu.bot' };

// zones[] 원소를 받아 화면 언어 이름을 돌려준다. 서버가 '???' 로 가린
// 구간(soon)은 그대로 '???' 로 둔다 — 아직 안 내놓은 구간 이름을 숨기는 게
// 원래 의도라, 여기서 번역해 버리면 숨긴 의미가 없어진다.
export function zoneName(z) {
  if (!z) return '';
  if (z.soon) return z.name;
  const key = ZONE_KEY[z.from];
  return key ? t(key) : z.name;
}
