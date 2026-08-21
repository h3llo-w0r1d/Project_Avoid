// 전기선의 규칙. three.js 를 쓰지 않아 브라우저와 서버가 똑같이 돌린다.
//
// 1v1 은 서버가 판정하므로, 두 화면이 어긋나지 않으려면 전기선의
// 위치 계산이 양쪽에서 완전히 같아야 한다. 그래서 그리는 코드
// (hazards.js) 와 규칙(이 파일)을 갈라 놓았다.

import { ARENA_RADIUS, BEAM, PLAYER, STAGES } from '../config.js';

const R = ARENA_RADIUS;
const OUT = R * 1.6;           // 패턴은 무대 밖까지 넉넉히 그린 뒤 아래에서 잘라 낸다
const CLIP_R = R + 0.9;        // 실제로 보이는(그리고 맞는) 범위
const TWO_PI = Math.PI * 2;

const lerp = (a, b, t) => a + (b - a) * t;

// 점(px,pz)과 선분(a-b) 사이 거리의 제곱
export function distToSegmentSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return (px - cx) ** 2 + (pz - cz) ** 2;
}

// 선분을 무대 원(반지름 CLIP_R) 안쪽으로 잘라 낸다.
// 전기선이 화면 밖까지 뻗지 않게 하고, 무대 밖 구간이 판정에 잡히는 일도 없앤다.
// 원과 만나지 않으면(아직 무대 밖) false 를 돌려준다.
export function clipToArena(seg) {
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return false;

  const b = 2 * (seg.ax * dx + seg.az * dz);
  const c = seg.ax * seg.ax + seg.az * seg.az - CLIP_R * CLIP_R;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return false;

  const root = Math.sqrt(disc);
  let s1 = (-b - root) / (2 * a);
  let s2 = (-b + root) / (2 * a);
  s1 = s1 < 0 ? 0 : s1 > 1 ? 1 : s1;
  s2 = s2 < 0 ? 0 : s2 > 1 ? 1 : s2;
  if (s2 - s1 < 1e-4) return false;

  const ax = seg.ax + dx * s1;
  const az = seg.az + dz * s1;
  seg.bx = seg.ax + dx * s2;
  seg.bz = seg.az + dz * s2;
  seg.ax = ax;
  seg.az = az;
  return true;
}

// ---------------------------------------------------------------- 전기선 하나

export class Beam {
  constructor() {
    this.seg = { ax: 0, az: 0, bx: 0, bz: 0 };
    this.phase = 'idle';
  }

  // spec: { path(u, out), duration, delay, warnPath?(k, out) }
  launch(spec) {
    this.path = spec.path;
    this.warnPath = spec.warnPath || null;   // 예열 때만 쓰는 특수 모양(회전 빔의 와인드업)
    this.duration = spec.duration;
    this.delay = spec.delay || 0;
    this.cachedPreview = undefined;
    this.t = 0;
    this.dead = false;
    this.live = false;
    this.onStage = false;
    this.phase = 'idle';   // idle -> warn -> live -> done
    this.progress = 0;     // 그리는 쪽에서 페이드에 쓴다
  }

  // u 시점의 선분을 구해 무대 안쪽으로 잘라 낸다.
  shape(u) {
    this.path(u, this.seg);
    this.onStage = clipToArena(this.seg);
    return this.onStage;
  }

  update(dt) {
    this.t += dt;

    const warnEnd = this.delay + BEAM.warnTime;
    if (this.t < this.delay) {
      this.onStage = false;
      return;
    }

    if (this.t < warnEnd) {
      // 경고 단계 — 아직 맞지 않는다. 어느 방향에서 오는지만 보여 준다.
      this.live = false;
      this.phase = 'warn';
      this.progress = (this.t - this.delay) / BEAM.warnTime;
      if (this.warnPath) {
        // 회전 빔: 돌 방향으로 감았다 푸는 예비동작을 보여 준다.
        this.warnPath(this.progress, this.seg);
        this.onStage = clipToArena(this.seg);
      } else {
        // 진입 직전 위치는 대개 무대 밖이라, 무대에 처음 걸리는 지점을 미리 잡는다.
        this.shape(this.previewU());
      }
    } else {
      const u = (this.t - warnEnd) / this.duration;
      if (u >= 1) {
        this.live = false;
        this.dead = true;
        this.onStage = false;
        this.phase = 'done';
        return;
      }
      this.phase = 'live';
      this.shape(u);
      this.live = this.onStage;
      this.progress = u;
    }
  }

  // 전기선이 무대에 처음 닿는 u 를 대충 찾는다(경고 표시용).
  previewU() {
    if (this.cachedPreview !== undefined) return this.cachedPreview;
    for (let i = 0; i <= 12; i++) {
      const u = i / 40;
      this.path(u, this.seg);
      if (clipToArena(this.seg)) {
        this.cachedPreview = u;
        return u;
      }
    }
    this.cachedPreview = 0;
    return 0;
  }

  // 캡슐 [feetY, headY] 가 전기선에 닿았는지
  hits(px, pz, feetY, headY) {
    if (!this.live) return false;
    if (feetY >= BEAM.y + BEAM.radius || headY <= BEAM.y - BEAM.radius) return false;
    const s = this.seg;
    const reach = BEAM.radius + PLAYER.radius;
    return distToSegmentSq(px, pz, s.ax, s.az, s.bx, s.bz) <= reach * reach;
  }
}

// ---------------------------------------------------------------- 패턴

// 각 패턴은 spec 배열을 돌려준다. spec.path(u, out) 이 u(0→1) 시점의 선분을 채운다.
// rand 를 인자로 받는 이유는 1v1 때문이다. 서버와 두 클라이언트가 같은 씨앗의
// 난수를 쓰면 전기선이 세 곳에서 똑같이 생긴다.

// 1) 가로 훑기 — 무대를 직선으로 가로지른다. 가장 기본.
//
// count 를 올리면 같은 방향에서 여러 줄이 줄지어 따라온다.
// 줄 사이는 시간으로 벌린다(BEAM.volleyGap). 거리로 벌리면 후반에 빔이
// 빨라질수록 줄 사이를 지나갈 시간이 짧아져서 넘을 수 없는 벽이 된다.
function sweep(mul, rand, delay = 0, angle = rand() * TWO_PI, count = 1) {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const px = -dz;
  const pz = dx;
  const from = R * 1.3;
  const to = -R * 1.3;
  const speed = 9 * mul;
  const duration = Math.abs(from - to) / speed;

  const specs = [];
  for (let i = 0; i < count; i++) {
    specs.push({
      delay: delay + i * BEAM.volleyGap,
      duration,
      path(u, out) {
        const d = lerp(from, to, u);
        const cx = dx * d;
        const cz = dz * d;
        out.ax = cx + px * OUT;
        out.az = cz + pz * OUT;
        out.bx = cx - px * OUT;
        out.bz = cz - pz * OUT;
      }
    });
  }
  return specs;
}

// 2) 회전 빔 — 중앙을 축으로 도는 팔. 중앙에 서 있으면 무조건 맞는다.
//
// 예열(노란색) 동안 팔이 돌 방향의 '반대'로 살짝 감겼다가, 발사되는 순간
// 시작각으로 돌아오며 그쪽으로 확 풀린다(와인드업). 어느 쪽으로 돌지
// 미리 읽게 해 준다. warnPath 는 예열 세그먼트만 바꾸므로 판정엔 영향이 없다.
const WINDUP = 0.6;   // 감아 두는 각(rad). 클수록 예비동작이 큼

function rotate(mul, rand, arms = 1) {
  const start = rand() * TWO_PI;
  const dir = rand() < 0.5 ? 1 : -1;
  const omega = 1.35 * mul;                 // rad/s
  const total = TWO_PI * (arms > 1 ? 0.75 : 1.35);
  const duration = total / omega;

  const specs = [];
  for (let i = 0; i < arms; i++) {
    const offset = start + (i / arms) * TWO_PI;
    const armAt = (a, out) => {
      out.ax = 0;
      out.az = 0;
      out.bx = Math.cos(a) * OUT;
      out.bz = Math.sin(a) * OUT;
    };
    specs.push({
      delay: 0,
      duration,
      path(u, out) {
        armAt(offset + dir * total * u, out);
      },
      // k: 예열 진행도 0→1.
      // 앞부분(~0.45)은 돌 방향의 '반대'로 감고(뒤로 당김),
      // 뒷부분은 시작각으로 풀며 그 방향으로 출발한다. k=1 에 정확히 시작각(offset)에
      // 안착하므로 발사(live u=0)와 이어져 튀지 않는다.
      warnPath(k, out) {
        const wind = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55; // 0→1→0 삼각파
        const eased = wind * wind * (3 - 2 * wind);               // smoothstep 로 매끈하게
        armAt(offset - dir * WINDUP * eased, out);
      }
    });
  }
  return specs;
}

// 3) V자 조이기 — 양쪽에서 마주 보고 다가와 정중앙에서 겹친다. 그 순간엔 점프뿐.
function squeeze(mul, rand) {
  const angle = rand() * TWO_PI;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const px = -dz;
  const pz = dx;
  const from = R * 1.3;
  const speed = 6.5 * mul;
  const duration = (from * 2) / speed;

  const make = (sign) => ({
    delay: 0,
    duration,
    path(u, out) {
      const d = lerp(from * sign, -from * sign, u);
      const cx = dx * d;
      const cz = dz * d;
      out.ax = cx + px * OUT;
      out.az = cz + pz * OUT;
      out.bx = cx - px * OUT;
      out.bz = cz - pz * OUT;
    }
  });

  return [make(1), make(-1)];
}

// 4) 격자 / 십자 — 직각으로 엇갈리는 두 줄기. 빈틈을 찾아 서 있어야 한다.
function cross(mul, rand) {
  const a = rand() * TWO_PI;
  return [
    ...sweep(mul, rand, 0, a),
    ...sweep(mul * 0.9, rand, 0.45, a + Math.PI / 2)
  ];
}

const PATTERNS = { sweep, rotate, squeeze, cross };

// ---------------------------------------------------------------- 난이도 디렉터

// 씨앗을 넣으면 같은 순서로 같은 패턴이 나온다. 32비트 xorshift.
export function makeRandom(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

export class Hazards {
  // seed 를 주면 재현 가능한 순서로 전기선이 나온다 (1v1 용).
  constructor(seed) {
    this.seed = seed;
    this.pool = [];
    this.active = [];
    this.reset();

    // 소리를 붙일 수 있게 사건만 알려 준다.
    this.onWarn = null;
    this.onFire = null;
  }

  reset() {
    for (const b of this.active) this.pool.push(b);
    this.active.length = 0;
    this.spawnTimer = 1.2;   // 첫 전기선까지의 여유
    this.lastKind = null;
    this.rand = makeRandom(this.seed ?? (Math.random() * 2 ** 31) | 0);
  }

  take() {
    return this.pool.pop() ?? new Beam();
  }

  // 난이도 곡선 ------------------------------------------------------

  // 지금 몇 번째 스테이지인지 (STAGES 의 인덱스)
  stageIndex(elapsed) {
    let i = 0;
    while (i + 1 < STAGES.length && elapsed >= STAGES[i + 1].at) i++;
    return i;
  }

  // 다음 스테이지 값까지 구간 안에서 서서히 변하는 값.
  // 계단으로만 두면 스테이지가 바뀔 때만 어려워지고 그 사이엔 지루하다.
  ramped(elapsed, key) {
    const i = this.stageIndex(elapsed);
    const cur = STAGES[i];
    const next = STAGES[i + 1];
    if (!next) return cur[key];
    const span = next.at - cur.at;
    const k = span > 0 ? Math.min(1, (elapsed - cur.at) / span) : 1;
    return lerp(cur[key], next[key], k);
  }

  speedMul(elapsed) { return this.ramped(elapsed, 'speed'); }
  spawnInterval(elapsed) { return this.ramped(elapsed, 'interval'); }

  // 이건 계단이다. 스테이지가 바뀌는 순간 확 달라지는 게 체감이 크다.
  maxLive(elapsed) { return STAGES[this.stageIndex(elapsed)].maxLive; }
  arms(elapsed) { return STAGES[this.stageIndex(elapsed)].arms; }
  volley(elapsed) { return STAGES[this.stageIndex(elapsed)].volley ?? 1; }

  // 이번 가로 훑기를 몇 줄로 낼지. 스테이지가 허용할 때만 가끔 여러 줄.
  volleyCount(elapsed) {
    const max = this.volley(elapsed);
    if (max <= 1 || this.rand() >= BEAM.volleyChance) return 1;
    return 2 + ((this.rand() * (max - 1)) | 0);
  }

  availableKinds(elapsed) {
    const kinds = [];
    for (let i = 0; i <= this.stageIndex(elapsed); i++) {
      for (const k of STAGES[i].unlock ?? []) kinds.push(k);
    }
    return kinds;
  }

  // 상한을 넘기면 아무것도 띄우지 않고 null 을 돌려준다.
  spawn(elapsed) {
    const mul = this.speedMul(elapsed);
    const kinds = this.availableKinds(elapsed);
    const choices = kinds.length > 1 ? kinds.filter((k) => k !== this.lastKind) : kinds;
    const kind = choices[(this.rand() * choices.length) | 0];

    let specs;
    if (kind === 'rotate') {
      specs = rotate(mul, this.rand, this.arms(elapsed));
    } else if (kind === 'sweep') {
      // 방향을 먼저 뽑고 줄 수를 정한다. 순서가 바뀌면 같은 씨앗이라도
      // 난수가 다른 순서로 소비돼 서버와 클라이언트의 전기선이 어긋난다.
      specs = sweep(mul, this.rand, 0, this.rand() * TWO_PI, this.volleyCount(elapsed));
    } else {
      specs = PATTERNS[kind](mul, this.rand);
    }

    // 패턴 하나가 전기선을 여러 개 만들 수 있으므로 개수까지 세어 판단한다
    if (this.active.length + specs.length > this.maxLive(elapsed)) return null;

    this.lastKind = kind;
    for (const spec of specs) {
      const beam = this.take();
      beam.launch(spec);
      this.active.push(beam);
    }
    return kind;
  }

  update(dt, elapsed) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      // 무대가 꽉 차 있으면 조금 뒤에 다시 시도한다
      this.spawnTimer = this.spawn(elapsed) ? this.spawnInterval(elapsed) : 0.3;
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      const before = b.phase;
      b.update(dt);
      // 단계가 바뀌는 순간에만 알린다. 매 프레임 부르면 소리가 겹쳐 터진다.
      if (b.phase !== before) {
        if (b.phase === 'warn') this.onWarn?.();
        else if (b.phase === 'live') this.onFire?.();
      }
      if (b.dead) {
        this.pool.push(b);
        this.active.splice(i, 1);
      }
    }
  }

  hitTest(px, pz, feetY, headY) {
    for (const b of this.active) {
      if (b.hits(px, pz, feetY, headY)) return true;
    }
    return false;
  }
}
