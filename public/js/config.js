// 게임 전체가 공유하는 튜닝 값. 밸런스는 대부분 여기서 조정한다.

export const ARENA_RADIUS = 11;

export const PLAYER = {
  radius: 0.5,
  height: 2.0,
  speed: 11.5,        // 최고 이동 속도 (units/s)
  accel: 145,         // 가속도 — 클수록 조작이 즉각적
  turnBoost: 2.4,     // 진행 방향과 반대로 입력했을 때 가속 배율.
                      // 이게 없으면 방향 전환이 굼뜨게 느껴진다.
  friction: 110,      // 입력이 없을 때 감속
  gravity: 32,
  jumpSpeed: 12,      // 점프 초속 -> 최고 높이 약 2.25
  maxJumps: 2,        // 2단 점프
  coyoteTime: 0.1,    // 발판을 막 벗어난 뒤에도 점프를 허용하는 유예

  // 1v1 에서 서로 부딪혔을 때 밀려나는 세기
  pushBase: 2.5,      // 가만히 붙어 있어도 떨어지는 최소량
  pushScale: 0.55     // 달려와 박은 속도에 비례해 더 밀린다
};

// 캐릭터 모델. url 을 지정하면 그 .glb 를 쓰고, 없거나 불러오기에 실패하면
// 도형으로 조립한 기본 캐릭터로 돌아간다. 게임은 어느 쪽이든 그대로 돌아간다.
//
//   public/models/ 에 .glb 를 넣고 url 만 바꾸면 끝.
//   높이는 PLAYER.height(2.0)에 자동으로 맞춰지므로 모델 크기는 신경 쓸 필요 없다.
export const AVATAR = {
  url: null,          // 예: './models/hero.glb'
  yaw: 0,             // 모델이 엉뚱한 곳을 보면 여기서 돌린다 (라디안, 보통 0 또는 Math.PI)
  animation: null,    // 재생할 클립 이름. null 이면 첫 번째 클립을 쓴다.
  yOffset: 0,         // 발이 바닥에 안 붙을 때 미세 조정

  // 정규화가 끝난 뒤 곱하는 배율. 캐릭터를 화면에서 더 크게 보이게 한다.
  //
  // 잎이 히트박스 위로 삐져나가는 건 상관없다. 전기선은 y 0.38~0.82 에만
  // 있어서 머리 위쪽은 판정에 아예 닿지 않는다.
  // 반면 몸통 폭은 PLAYER.radius 와 맞아야 한다. 안 맞으면 "안 닿았는데 죽었다"
  // 또는 "닿았는데 안 죽었다"가 된다. 이 값을 바꾸면 radius 도 같이 봐야 한다.
  scale: 1.35
};

export const BEAM = {
  y: 0.6,             // 전기선 높이 (바닥 기준)
  radius: 0.22,       // 굵기 — 충돌 판정에 그대로 쓰인다
  warnTime: 0.85,     // 발사 전 경고 시간

  // 가로 훑기가 가끔 여러 줄로 몰려 나온다.
  //
  // 간격은 거리가 아니라 시간이다. 거리로 잡으면 빔이 빨라질수록 줄 사이를
  // 지나가는 시간이 짧아져서, 후반에는 넘을 수 없는 벽이 된다.
  // 점프로 넘을 수 있는 시간 창이 약 0.58초라, 세 줄(간격 두 번 = 0.44초)까지가
  // 한 번의 점프로 넘어갈 수 있는 한계다. 이 값을 키우면 착지했다 다시
  // 뛰어야 하는데 그럴 여유는 없어서 그냥 못 피하는 패턴이 된다.
  volleyGap: 0.22,
  // 여러 줄로 나올 확률 (스테이지가 허용할 때만).
  //
  // 실제로 나오는 빈도는 이 값보다 낮다. maxLive 상한에 걸리면 그 판은
  // 통째로 취소되고 다른 패턴을 새로 뽑기 때문이다. 여기를 올려도
  // 후반에는 상한이 먼저 걸려서 그만큼 늘지는 않는다.
  volleyChance: 0.5
};

// 점프 최고점 2.25 > 전기선 윗면 0.82 이므로 항상 넘을 수 있다.
// 넘을 수 있는 시간 창은 점프 한 번당 약 0.6초.

// 난이도. 스테이지 표 하나로 관리한다.
//
//   at       이 스테이지가 시작되는 시각(초)
//   speed    전기선 속도 배율
//   interval 전기선이 나오는 간격(초)
//   maxLive  동시에 살아 있을 수 있는 전기선 수
//   arms     회전 빔의 팔 개수
//   volley   가로 훑기가 한 번에 몇 줄까지 몰려 나올 수 있는지 (1 이면 한 줄)
//   unlock   이 스테이지에서 새로 등장하는 패턴
//
// speed 와 interval 은 다음 스테이지 값까지 구간 안에서 서서히 변한다.
// maxLive·arms·unlock 은 스테이지가 바뀌는 순간 계단처럼 뛴다.
// 그래서 구간 안에서는 조금씩 조여들고, 구간이 바뀔 때 확 달라진다.
//
// maxLive 상한이 없으면 후반에 빠져나갈 틈이 아예 사라져서
// 실력과 무관하게 죽는다. 늘릴 때도 아주 조심해서 늘려야 한다.
export const STAGES = [
  { at: 0, name: 'STAGE 1', speed: 1.00, interval: 2.60, maxLive: 3, arms: 1, volley: 1, unlock: ['sweep'] },
  { at: 12, name: 'STAGE 2', speed: 1.20, interval: 2.15, maxLive: 4, arms: 1, volley: 1, unlock: ['rotate'] },
  { at: 28, name: 'STAGE 3', speed: 1.45, interval: 1.75, maxLive: 4, arms: 2, volley: 2, unlock: ['squeeze'] },
  { at: 45, name: 'STAGE 4', speed: 1.70, interval: 1.40, maxLive: 5, arms: 2, volley: 2, unlock: ['cross'] },
  { at: 70, name: 'STAGE 5', speed: 1.95, interval: 1.20, maxLive: 5, arms: 2, volley: 3 },
  { at: 100, name: 'OVERLOAD', speed: 2.20, interval: 1.00, maxLive: 5, arms: 3, volley: 3 },
  { at: 140, name: 'OVERLOAD Ⅱ', speed: 2.45, interval: 0.88, maxLive: 6, arms: 3, volley: 3 }
];

// 소리 파일. 넣지 않으면(null) audio.js 가 그때그때 합성해서 쓴다.
//
//   public/sounds/ 에 파일을 넣고 경로만 적으면 끝.
//   문자열 대신 { url, volume } 로 적으면 소리별 크기를 따로 줄 수 있다.
//   예)  jump: './sounds/jump.mp3'
//        zap:  { url: './sounds/zap.wav', volume: 0.7 }
//
// 브라우저가 읽을 수 있는 형식이면 된다 (mp3 / ogg / wav / m4a).
// 파일이 없거나 형식이 안 맞으면 콘솔에 경고를 남기고 합성음으로 돌아간다.
export const SOUNDS = {
  jump: null,
  doubleJump: null,
  land: null,
  warn: null,        // 전기선 경고
  zap: null,         // 전기선 발사
  death: null,       // 감전
  fall: null,        // 낙사
  stageUp: null,     // 스테이지 상승

  ambient: null,     // 환경음 (반복 재생)

  // 배경음악. 화면마다 다른 곡을 튼다. 파일은 public/sounds/ 에 둔다.
  // 문자열만 적으면 원래 크기로 나오고, 볼륨을 따로 주려면 이렇게 적는다.
  //
  //   music: { url: './sounds/game.mp3', volume: 0.5 }
  //
  // 반복 재생이라 크게 틀면 금세 거슬린다. 효과음이 묻히지 않을 만큼만.
  homeMusic: null,   // 첫 화면
  music: { url: './sounds/game.mp3', volume: 0.4 }        // 게임 중
};

// 점프할 때 낼 내 목소리. 타이틀 화면에서 직접 녹음한다.
//
// 녹음은 브라우저(IndexedDB)에 저장된다. 기기를 옮기면 따라오지 않고,
// 1v1 에서도 상대에게는 들리지 않는다.
export const VOICE = {
  enabled: true,
  volume: 0.9,
  maxSeconds: 1.2,   // 이보다 길면 잘라낸다. 점프보다 늦게 끝나면 어색하다.
  // 재생 속도. 올리면 음이 같이 올라가 만화 목소리가 된다.
  // 1.0 으로 두면 녹음한 그대로 나온다.
  userRate: 1.25,
  // 2단 점프는 이 배율만큼 더 높게 낸다. 같은 소리를 연달아 두 번 틀면
  // 말을 더듬는 것처럼 들려서, 살짝 올려 "한 번 더!" 하는 느낌을 준다.
  doubleRate: 1.18
};

// 화면에서 무대가 얼마나 크게 보일지. 숫자를 만질 곳은 여기 하나뿐이다.
export const CAMERA = {
  // 고각(도). 눕힐수록 무대가 가로로 넓게 퍼지지만 전기선 높이를 읽기 어렵다.
  tiltWide: 38,      // 가로로 긴 화면
  tiltTall: 55,      // 세로로 긴 화면 — 위에서 내려다봐야 남는 세로를 쓴다
  // 무대 반지름에 더해 프레임에 함께 넣을 여유. 키우면 무대가 작아진다.
  padding: 2,
  // 화면 가장자리 여백. 1.0 이면 딱 붙는다. 키우면 무대가 커진다.
  margin: 0.92
};

export const COLORS = {
  volt: 0xff2a40,
  voltGlow: 0xff8a70,
  warn: 0xffc44d,
  node: 0xc8ff72,   // 반딧불이 — 풀숲과 어울리는 연둣빛
  haze: 0x3c4438    // 안개 = 지평선 색. 멀리 있는 나무가 여기로 녹아든다.
};
