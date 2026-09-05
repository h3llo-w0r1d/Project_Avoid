// 플레이어 물리. three.js 를 쓰지 않아 브라우저와 서버가 똑같이 돌린다.
//
// 1v1 에서는 서버가 이 코드를 돌려 판정하고, 클라이언트도 같은 코드를 돌려
// 입력에 즉시 반응한다(예측). 둘이 어긋나면 서버 값으로 맞춘다.

import { ARENA_RADIUS, PLAYER } from '../config.js';

export class PlayerBody {
  constructor() {
    // 점프 가능 횟수. 기본은 설정값(2단). 하드코어 모드에서 1 로 낮춰 1단만 쓴다.
    // 인스턴스마다 따로 두므로 1v1(서버·상대)은 기본값 그대로다.
    this.maxJumps = PLAYER.maxJumps;
    this.reset();
  }

  reset(x = 0, z = 0) {
    this.x = x;
    this.y = 0;      // 발바닥 높이
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    // 부딪혀 밀려난 속도. vx/vz 와 따로 두어 마찰과 최고 속도 제한을 피한다.
    this.kx = 0;
    this.kz = 0;
    this.jumpsLeft = this.maxJumps;
    this.grounded = true;
    this.airTime = 0;
    this.fell = false;
    // 이번 스텝에 일어난 일. 소리·연출을 붙이는 쪽에서 읽는다.
    this.justJumped = 0;   // 0 없음 / 1 일반 / 2 2단
    this.justLanded = false;

  }

  // input = { moveX, moveY, jump } — moveY 는 화면 위쪽이 양수
  step(dt, input) {
    this.justJumped = 0;
    this.justLanded = false;

    // 밀리는 동안 남는 조작력. 갓 밀려난 순간(pushBase)엔 pushGrip 까지
    // 떨어졌다가, 밀림이 잦아들면서 1 로 돌아온다(끝물에 몰아서 돌아오게
    // 제곱근을 쓴다 — 그래야 버티든 말든 밀려나는 거리가 비슷하다).
    // 방향키를 상대 쪽으로 잡고 있는 것만으로 밀림을 거의 상쇄해 버려서,
    // 같은 세기로 밀어도 밀려나는 거리가 상황마다 제각각이 된다.
    const knock = Math.hypot(this.kx, this.kz);
    const grip = knock > 0
      ? Math.max(PLAYER.pushGrip, 1 - (1 - PLAYER.pushGrip) * Math.sqrt(knock / PLAYER.pushBase))
      : 1;

    // 밀리는 동안에는 이동 입력이 먹지 않는다(pushGrip 0). 버티든 말든
    // 똑같이 밀려나야 거리가 상황마다 달라지지 않는다. 점프는 그대로 된다.
    const wantX = input.moveX * grip;
    const wantZ = -input.moveY * grip;

    // 수평 가속 / 마찰
    if (wantX || wantZ) {
      // 지금 가는 방향과 반대로 눌렀으면 더 세게 민다.
      // 그냥 같은 가속도를 쓰면 최고 속도에서 반대로 꺾는 데 두 배가 걸려 답답하다.
      const opposing = wantX * this.vx + wantZ * this.vz < 0;
      const accel = opposing ? PLAYER.accel * PLAYER.turnBoost : PLAYER.accel;

      this.vx += wantX * accel * dt;
      this.vz += wantZ * accel * dt;

      const speed = Math.hypot(this.vx, this.vz);
      const cap = PLAYER.speed * grip;
      if (speed > cap) {
        const k = cap / speed;
        this.vx *= k;
        this.vz *= k;
      }
    } else {
      const speed = Math.hypot(this.vx, this.vz);
      const drop = Math.min(speed, PLAYER.friction * dt);
      if (speed > 1e-4) {
        this.vx -= (this.vx / speed) * drop;
        this.vz -= (this.vz / speed) * drop;
      }
    }

    // 점프 — 지면을 막 벗어난 직후에도 1단 점프를 인정한다(코요테 타임)
    if (input.jump) {
      const canGroundJump = this.grounded || this.airTime < PLAYER.coyoteTime;
      if (canGroundJump && this.jumpsLeft === this.maxJumps) {
        this.vy = PLAYER.jumpSpeed;
        this.jumpsLeft--;
        this.grounded = false;
        this.justJumped = 1;
      } else if (this.jumpsLeft > 0) {
        // 2단 점프는 낙하 중이어도 항상 같은 높이가 나오도록 속도를 덮어쓴다
        this.vy = PLAYER.jumpSpeed * 0.92;
        this.jumpsLeft--;
        this.justJumped = 2;
      }
    }

    this.vy -= PLAYER.gravity * dt;

    this.x += (this.vx + this.kx) * dt;
    this.y += this.vy * dt;
    this.z += (this.vz + this.kz) * dt;

    // 밀려난 속도. 위의 vx/vz 와 따로 두는 이유는 config 의 push* 주석에 있다.
    // 방향키로 어느 정도 버틸 수는 있어도(최고 11.5 대 밀림 13~24) 완전히
    // 멈추지는 못한다. 맞고도 손을 놓지 않은 느낌이 남게.
    const left = Math.hypot(this.kx, this.kz);
    if (left > 1e-4) {
      const drop = Math.min(left, PLAYER.pushDecay * dt);
      this.kx -= (this.kx / left) * drop;
      this.kz -= (this.kz / left) * drop;
    } else {
      this.kx = 0;
      this.kz = 0;
    }

    const onDeck = Math.hypot(this.x, this.z) <= ARENA_RADIUS;
    const wasAirborne = !this.grounded;

    if (onDeck && this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.airTime = 0;
      this.jumpsLeft = this.maxJumps;
      this.justLanded = wasAirborne;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }

    // 무대 밖으로 나가면 낙사
    if (!onDeck && this.y < -6) this.fell = true;
  }

  get feetY() { return this.y; }
  get headY() { return this.y + PLAYER.height; }

  // 무대 밖으로 떨어졌는지 (판정용)
  //  1) 가장자리를 넘어(반지름+0.6 밖) 살짝만 떨어져도 낙사, 그리고
  //  2) 어느 쪽이든 충분히 깊이(-4 아래) 떨어지면 무조건 낙사.
  // 2) 가 없으면 가장자리에 딱 붙어 수직으로 떨어질 때(반지름을 안 넘김)
  //    계속 살아 있는 것으로 잘못 인식된다.
  get droppedOff() {
    return (Math.hypot(this.x, this.z) > ARENA_RADIUS + 0.6 && this.y < -1) || this.y < -4;
  }
}

// 두 사람이 겹치면 서로 밀어낸다. 1v1 에서 상대를 전기선이나 무대 밖으로
// 몰아넣는 수단이다. 서버가 판정한 결과만 진짜로 친다.
export function resolvePush(a, b, dt) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  const minDist = PLAYER.radius * 2;

  if (distSq >= minDist * minDist || distSq < 1e-9) return false;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  // 겹친 만큼 절반씩 떼어 놓는다
  const half = overlap / 2;
  a.x -= nx * half;
  a.z -= nz * half;
  b.x += nx * half;
  b.z += nz * half;

  // 부딪힌 세기만큼 서로를 밀어낸다. 달려와서 박으면 크게 밀린다.
  // 다가오는 속도는 밀려서 미끄러지는 중인 것도 포함해 센다(총 속도).
  const relative = ((b.vx + b.kx) - (a.vx + a.kx)) * nx + ((b.vz + b.kz) - (a.vz + a.kz)) * nz;
  const impact = Math.max(0, -relative);
  const shove = Math.min(PLAYER.pushMax, PLAYER.pushBase + impact * PLAYER.pushScale);

  // 부딪힌 순간 둘 다 하던 걸음을 멈춘다. 달려오던 속도가 그대로 얹히면
  // 같은 세기로 밀어도 거리가 제각각이 된다.
  a.vx = 0; a.vz = 0;
  b.vx = 0; b.vz = 0;

  a.kx -= nx * shove;
  a.kz -= nz * shove;
  b.kx += nx * shove;
  b.kz += nz * shove;

  // 연달아 부딪히면 밀림이 겹쳐 쌓인다. 거기에만 상한을 둔다.
  clampKnock(a);
  clampKnock(b);

  void dt;
  return true;
}

// 밀림이 겹쳐 쌓였을 때 상한을 씌운다.
function clampKnock(p) {
  const k = Math.hypot(p.kx, p.kz);
  if (k <= PLAYER.pushMax) return;
  const s = PLAYER.pushMax / k;
  p.kx *= s;
  p.kz *= s;
}
