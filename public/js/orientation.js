// 세로로 열린 폰(특히 아이폰 PWA)에서 화면을 강제로 가로로 돌린다.
//
// 왜 필요한가
// ----------
// 안드로이드 PWA 는 매니페스트의 orientation:landscape 로 가로로 잠기지만,
// iOS 는 그 설정을 무시하고, 방향을 강제하는 표준 JS API 도 없다. 그래서
// 세로로 열리면 화면 전체(body)를 CSS 로 90도 돌려 가로처럼 꽉 채운다.
//
// 회전하면 터치 좌표계도 같이 돌아간다. 그대로 두면 조이스틱이 엉뚱한
// 방향으로 움직인다. toLocal() 이 화면 좌표를 회전된 화면의 로컬 좌표로
// 되돌려, 입력 코드는 회전 여부를 몰라도 똑같이 동작한다. view() 는 회전에
// 맞춰 폭·높이를 바꿔 돌려준다(캔버스 크기 계산용).
//
// CSS 쪽 변환은 style.css 의 `:root.force-landscape body` 에 있다:
//   transform-origin: 0 0; transform: rotate(-90deg) translate(-100%, 0);
//   width: 100lvh; height: 100lvw;  (큰 뷰포트라 여백 없이 꽉 채움)
// toLocal 의 식은 그 변환의 정확한 역변환이다. 둘을 함께 바꿔야 한다.

const root = document.documentElement;

function isTouch() {
  return matchMedia('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0
    || 'ontouchstart' in window;
}

// 터치 기기이고 세로(높이가 더 김)일 때만 돌린다. 물리적으로 가로로 들면
// orientation 이 landscape 가 되어 저절로 풀린다.
function shouldForce() {
  return isTouch() && window.innerHeight > window.innerWidth;
}

export function isForced() {
  return root.classList.contains('force-landscape');
}

// 회전을 감안한 그리기 크기. 돌렸으면 body 의 '실제 크기'(CSS dvh/dvw 로
// 화면에 맞춰진 값)를 읽는다. innerHeight 는 iOS 에서 주소창 때문에 어긋나므로
// 쓰지 않는다. 회전한 body 는 폭=화면높이, 높이=화면폭 이 된다.
export function view() {
  if (isForced()) {
    const b = document.body;
    return { w: b.clientWidth, h: b.clientHeight };
  }
  return { w: window.innerWidth, h: window.innerHeight };
}

// 화면 터치 좌표 → 회전된 화면의 로컬 좌표. (CSS 변환의 정확한 역)
// rotate(-90deg) translate(-100%,0) 의 역: (lx,ly) = (W - clientY, clientX), W=body 폭
export function toLocal(clientX, clientY) {
  if (isForced()) return { x: document.body.clientWidth - clientY, y: clientX };
  return { x: clientX, y: clientY };
}

let applied = null;
function apply() {
  const want = shouldForce();
  root.classList.toggle('force-landscape', want);
  // 크기는 CSS(dvh/dvw)가 화면 변화에 맞춰 알아서 조절한다. JS 는 방향만 관리.
  if (want !== applied) {
    applied = want;
    // 방향이 바뀌었으니 게임이 카메라·캔버스를 다시 맞추게 한다.
    dispatchEvent(new Event('resize'));
  }
}

// 회전 상태에선 iOS 네이티브 세로 스크롤이 먹지 않는다. 화면을 -90도 돌렸기 때문에
// '화면상 아래'는 실제 터치의 clientX 축이라(toLocal 참고), 손가락을 세로로 끌어도
// 브라우저는 그걸 가로 스크롤로 보고 목록이 제자리로 튕긴다.
// 그래서 스크롤되는 조상을 찾아 손가락 이동량을 scrollTop 에 직접 반영한다.
function scrollableFrom(node) {
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
  }
  return null;
}

function startRotatedScroll() {
  let target = null, last = 0;
  addEventListener('touchstart', (e) => {
    target = null;
    if (!isForced() || e.touches.length !== 1) return;
    target = scrollableFrom(e.target);
    last = e.touches[0].clientX;
  }, { passive: true });

  addEventListener('touchmove', (e) => {
    // 스크롤되는 곳을 잡고 있을 때만 가로챈다(게임 조이스틱 입력은 건드리지 않는다).
    if (!target || !isForced() || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    target.scrollTop -= (x - last);
    last = x;
    e.preventDefault();          // 페이지가 튕기지 않게
  }, { passive: false });

  const end = () => { target = null; };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', end, { passive: true });
}

export function startOrientationManager() {
  apply();
  addEventListener('resize', apply);
  addEventListener('orientationchange', apply);
  startRotatedScroll();
}
