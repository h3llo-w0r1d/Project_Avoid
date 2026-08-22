// IP → 지역(국가·시도). 오프라인 GeoLite2 DB 로만 조회한다.
// 방문자 IP 를 외부로 보내지 않는다(개인정보 안전). DB 파일이 없거나 열리지
// 않으면 조용히 꺼진 채 null 을 돌려주므로, 서버는 문제없이 뜬다.
//
// 이름 한국어화
// -------------
// 무료 GeoLite2 빌드에는 한국어(ko) 이름이 없고 영어만 있는 경우가 많다.
// 그래서 국가 코드와 한국 시·도 영문명을 한국어로 직접 옮긴다. 한국은
// 세부 구/시(노원구·성남시)까지 가지 않고 '서울·경기'처럼 시·도까지만
// 보여 준다 — 관리용으로는 그 정도가 읽기 좋다. 그 밖의 나라는 국가 이름
// (한국어) + 도시(영문)로 둔다.
//
// 데이터 출처(라이선스 표기 의무):
//   This product includes GeoLite2 data created by MaxMind, available from
//   https://www.maxmind.com

import maxmind from 'maxmind';

let reader = null;    // 도시 DB (GeoLite2-City)
let asnReader = null; // ASN DB (GeoLite2-ASN) — 어느 네트워크(구글·텐센트…) 소유인지

// 시작할 때 한 번 연다. 실패해도 예외를 던지지 않는다(기능만 꺼짐).
export async function openGeo(path) {
  try {
    reader = await maxmind.open(path);
    return true;
  } catch {
    reader = null;
    return false;
  }
}

export async function openAsn(path) {
  try {
    asnReader = await maxmind.open(path);
    return true;
  } catch {
    asnReader = null;
    return false;
  }
}

export function geoReady() { return reader !== null; }
export function asnReady() { return asnReader !== null; }

// 국가 코드 → 한국어 이름 (흔한 나라만. 없으면 영어 이름으로 떨어진다).
const COUNTRY_KO = {
  KR: '대한민국', US: '미국', JP: '일본', CN: '중국', HK: '홍콩', TW: '대만',
  SG: '싱가포르', VN: '베트남', TH: '태국', IN: '인도', ID: '인도네시아',
  PH: '필리핀', MY: '말레이시아', KH: '캄보디아', MM: '미얀마', LA: '라오스',
  DE: '독일', FR: '프랑스', GB: '영국', NL: '네덜란드', RU: '러시아',
  CA: '캐나다', AU: '호주', BR: '브라질', IT: '이탈리아', ES: '스페인',
  SE: '스웨덴', PL: '폴란드', TR: '튀르키예', UA: '우크라이나', CH: '스위스',
  FI: '핀란드', NO: '노르웨이', DK: '덴마크', IE: '아일랜드', MX: '멕시코',
  AT: '오스트리아', BE: '벨기에', CZ: '체코', RO: '루마니아', PT: '포르투갈',
  IL: '이스라엘', AE: '아랍에미리트', SA: '사우디아라비아', ZA: '남아프리카',
  AR: '아르헨티나', CL: '칠레', NZ: '뉴질랜드', BG: '불가리아', GR: '그리스',
  HU: '헝가리', KZ: '카자흐스탄', PK: '파키스탄', BD: '방글라데시', NG: '나이지리아'
};

// 한국 시·도 영문명 → 한국어. GeoLite2 가 쓰는 표기 변형까지 함께 담는다.
const KR_SIDO = {
  Seoul: '서울', Busan: '부산', Daegu: '대구', Incheon: '인천',
  Gwangju: '광주', Daejeon: '대전', Ulsan: '울산', Sejong: '세종', 'Sejong-si': '세종',
  'Gyeonggi-do': '경기', Gyeonggi: '경기',
  'Gangwon-do': '강원', Gangwon: '강원', 'Gangwon State': '강원',
  'Chungcheongbuk-do': '충북', 'North Chungcheong': '충북',
  'Chungcheongnam-do': '충남', 'South Chungcheong': '충남',
  'Jeollabuk-do': '전북', 'North Jeolla': '전북', Jeonbuk: '전북', 'Jeonbuk State': '전북',
  'Jeollanam-do': '전남', 'South Jeolla': '전남',
  'Gyeongsangbuk-do': '경북', 'North Gyeongsang': '경북',
  'Gyeongsangnam-do': '경남', 'South Gyeongsang': '경남',
  'Jeju-do': '제주', Jeju: '제주'
};

// x-forwarded-for 에 포트가 붙어 오면 앞부분만 본다.
function cleanIp(ip) {
  return typeof ip === 'string' ? ip.trim().replace(/:\d+$/, '') : ip;
}

// { country, city } 또는 null. country 는 한국어, city 는 한국이면 시·도.
export function lookupCity(ip) {
  if (!reader) return null;
  const clean = cleanIp(ip);
  if (typeof clean !== 'string') return null;
  let r;
  try { r = reader.get(clean); } catch { return null; }
  if (!r) return null;

  const iso = r.country?.iso_code || '';
  const country = r.country?.names?.ko || COUNTRY_KO[iso] || r.country?.names?.en || iso || '';

  const subEn = r.subdivisions?.[0]?.names?.en || '';
  const cityEn = r.city?.names?.ko || r.city?.names?.en || '';
  // 한국은 시·도까지만. 그 밖은 도시(있으면).
  const region = iso === 'KR' ? (KR_SIDO[subEn] || cityEn || '') : cityEn;

  if (!country && !region) return null;
  return { country, city: region };
}

// 이 IP 를 소유한 네트워크(AS)의 조직명. 예: 'Google LLC', 'Shenzhen Tencent…'.
export function asnOrg(ip) {
  if (!asnReader) return null;
  const clean = cleanIp(ip);
  if (typeof clean !== 'string') return null;
  let r;
  try { r = asnReader.get(clean); } catch { return null; }
  return r?.autonomous_system_organization || null;
}

// 국가 코드(ISO, 예 'KR'). 없으면 null.
export function countryCode(ip) {
  if (!reader) return null;
  const clean = cleanIp(ip);
  if (typeof clean !== 'string') return null;
  let r;
  try { r = reader.get(clean); } catch { return null; }
  return r?.country?.iso_code || null;
}
