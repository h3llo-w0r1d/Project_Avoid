// 봇·크롤러·스캐너 걸러내기.
//
// 공개 서버는 검색엔진·보안 스캐너·링크 미리보기 봇이 끊임없이 두드린다
// (Censys, Shodan, facebookexternalhit, 각종 크롤러…). 이들은 사람이 아니라
// 방문·접속자 집계를 부풀린다. User-Agent 로 흔한 것들을 걸러낸다.
//
// 완벽하진 않다 — 정교한 스크래퍼는 진짜 브라우저 UA 를 흉내 낸다. 하지만
// JS 를 돌려 접속 신호를 보내는 자동화 봇은 대부분 여기서 잡힌다.

const BOT = new RegExp([
  'bot', 'crawl', 'spider', 'scan', 'slurp', 'headless', 'phantom', 'puppeteer',
  'playwright', 'monitor', 'uptime', 'pingdom', 'censys', 'shodan',
  'facebookexternalhit', 'dataprovider', 'infrawat', 'genomecrawler',
  'cyberconvoy', 'flowiq', 'visionheight', 'semrush', 'ahrefs', 'mj12',
  'dotbot', 'petalbot', 'bytespider', 'gptbot', 'claudebot', 'ccbot',
  'amazonbot', 'applebot', 'yandex', 'baidu', 'duckduck',
  'python', 'curl', 'wget', 'go-http', 'libwww', 'okhttp', 'node-fetch',
  'java/', 'apache-http', 'axios', 'httpx', 'lighthouse', 'headlesschrome',
  'yeti'   // 네이버 검색 크롤러 (Yeti/1.1 +http://naver.me/spd)
].join('|'), 'i');

export function isBot(ua) {
  if (!ua || ua === '-') return true;   // UA 가 없는 요청은 사람 브라우저가 아니다
  return BOT.test(ua);
}

// 모바일(폰·태블릿) 여부. 개인정보가 아니라 기기 종류일 뿐이라 자유롭게 쓴다.
const MOBILE = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

export function isMobile(ua) {
  return !!ua && MOBILE.test(ua);
}
