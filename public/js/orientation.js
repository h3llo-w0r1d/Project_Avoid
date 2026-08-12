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
//   width: 100vh; height: 100vw;
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

// 회전을 감안한 그리기 크기. 돌렸으면 폭·높이를 바꾼다.
export function view() {
  if (isForced()) return { w: window.innerHeight, h: window.innerWidth };
  return { w: window.innerWidth, h: window.innerHeight };
}

// 화면 터치 좌표 → 회전된 화면의 로컬 좌표. (CSS 변환의 역)
export function toLocal(clientX, clientY) {
  if (isForced()) return { x: window.innerHeight - clientY, y: clientX };
  return { x: clientX, y: clientY };
}

let applied = null;
function apply() {
  const want = shouldForce();
  if (want === applied) return;
  applied = want;
  root.classList.toggle('force-landscape', want);
  // 크기가 바뀌었으니 게임이 카메라·캔버스를 다시 맞추게 한다.
  dispatchEvent(new Event('resize'));
}

export function startOrientationManager() {
  apply();
  addEventListener('resize', apply);
  addEventListener('orientationchange', apply);
}
