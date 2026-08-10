// 서비스워커. PWA(홈 화면 앱)로 설치되게 하고, 한 번 연 뒤엔 오프라인에서도 열리게 한다.
//
// 전략: 같은 출처의 GET 만 다룬다.
//   - 네트워크 우선. 성공하면 그 응답을 캐시에 넣어 두고, 실패하면(오프라인)
//     캐시에서 꺼낸다. 그래서 배포하면 새 코드가 바로 반영되고, 인터넷이
//     끊겨도 마지막으로 받은 화면은 열린다.
//   - API(/api), 웹소켓(/ws), 로그인(/auth) 은 건드리지 않는다. 동적이라
//     캐시하면 오히려 틀린 값이 남는다.
//
// 게임 코드를 고쳐 배포하면 CACHE 이름을 그대로 둬도 네트워크 우선이라
// 새 파일을 받는다. 캐시를 통째로 비우고 싶을 때만 버전을 올린다.

// 버전을 올리면 옛 캐시를 통째로 버리고 새로 받는다. 예전 서비스워커에
// 눌러앉은 옛 화면 코드를 강제로 갈아끼울 때 올린다.
const CACHE = 'avoidarc-v2';

self.addEventListener('install', (e) => {
  // 새 워커를 기다리지 않고 바로 활성화한다.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 옛 버전 캐시를 지운다.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // 다른 출처는 그대로 둔다
  if (url.pathname.startsWith('/api')) return;              // 동적 데이터
  if (url.pathname.startsWith('/auth')) return;             // 로그인 흐름
  if (url.pathname.startsWith('/ws')) return;               // 웹소켓

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // 정상 응답만 캐시에 넣는다. 리다이렉트나 오류는 넣지 않는다.
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      // 오프라인 등으로 네트워크 실패 → 캐시에서.
      const cached = await caches.match(req);
      if (cached) return cached;
      // 화면 이동인데 캐시도 없으면 시작 페이지라도 준다.
      if (req.mode === 'navigate') {
        const home = await caches.match('/');
        if (home) return home;
      }
      throw new Error('오프라인이고 캐시에도 없습니다.');
    }
  })());
});
