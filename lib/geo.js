// IP → 국가 코드·네트워크 소유 조직. 오프라인 GeoLite2 DB 로만 조회한다.
// 방문자 IP 를 외부로 보내지 않는다(개인정보 안전). DB 파일이 없거나 열리지
// 않으면 조용히 꺼진 채 null 을 돌려주므로, 서버는 문제없이 뜬다.
//
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


// x-forwarded-for 에 포트가 붙어 오면 앞부분만 본다.
function cleanIp(ip) {
  return typeof ip === 'string' ? ip.trim().replace(/:\d+$/, '') : ip;
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
