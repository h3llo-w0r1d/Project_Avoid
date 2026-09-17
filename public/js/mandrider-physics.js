export const KART = Object.freeze({
  roadHalfWidth: 13,
  maxSpeed: 42,
  boostSpeed: 58,
  reverseSpeed: 12,
  accel: 18,
  brake: 36,
  reverseAccel: 13,
  coast: 7,
  boostAccel: 38,
  grip: 38,
  driftGrip: 13,
  steerRate: 8,
  turnRate: 1.45,
  driftTurnRate: 0.62,
  driftEntryTurn: 0.055,
  driftSpeedLoss: 3.1,
  // 드리프트로 게이지가 차는 속도. 1 이 예전 값이고 지금은 그보다 1.5배 빠르다.
  driftCharge: 1.5,
  // 벽을 정면으로 들이받았을 때 잃는 속도 비율. 스쳐 지나가면 이보다 훨씬 덜 잃는다.
  wallBite: 0.4,
  driftExitSeconds: 0.22,
  driftMinSpeed: 10,
  driftMinTime: 0.18,
  driftChainWindow: 0.48,
  // 빠르게 이어 드리프트했을 때 붙는 '고속턴' 보정. 한 번 이어질 때마다
  // 회전은 이만큼 더 날카로워지고 속도는 덜 깎인다(둘 다 두 번까지만 쌓인다).
  chainTurn: 0.55,
  chainKeep: 0.3,
  boostSeconds: 2.35,
  instantSeconds: 0.72,
  instantWindow: 0.62
});

const toward = (value, target, amount) => value < target
  ? Math.min(value + amount, target)
  : Math.max(value - amount, target);

function flash(state, text, seconds = 0.8) {
  state.notice = text;
  state.noticeTimer = seconds;
}

function charge(state, amount) {
  state.gauge += amount;
  while (state.gauge >= 100 && state.boosts < 2) {
    state.gauge -= 100;
    state.boosts++;
    flash(state, '부스터 충전!');
  }
  if (state.boosts === 2) state.gauge = Math.min(state.gauge, 100);
}

export function createKartState() {
  return {
    x: 0, z: 0, heading: 0, speed: 0, lateral: 0, steer: 0,
    drifting: false, driftDirection: 0, driftTime: 0, driftExitTimer: 0,
    driftChain: 0, driftChainTimer: 0,
    gauge: 0, boosts: 0, boostTimer: 0,
    instantTimer: 0, instantWindow: 0,
    startTimer: 3, startArmed: false, started: false,
    elapsed: 0, distance: 0, hitWall: 0,
    notice: '', noticeTimer: 0
  };
}

// 길 밖으로 나가면 가장자리로 되돌린다.
//
// 예전에는 속도 자체를 매 프레임 0.68 배로 깎았다. 그런데 벽에 붙어 있는 동안은
// 이 계산이 계속 돌아, 살짝 스친 것만으로도 속도가 순식간에 0 으로 무너졌다
// ('부딪히면 너무 멈추고 잘 안 움직인다'). 벽을 등지고 있어도 마찬가지였다.
//
// 이제는 벽을 파고드는 성분만 덜어 낸다. 벽과 나란한 성분은 남으므로 긁으면서도
// 계속 달린다. 정면으로 처박으면 파고드는 성분이 곧 속도 전부라 제대로 멈춘다.
export function constrainToRoad(state, centerX, centerZ, halfWidth = KART.roadHalfWidth) {
  const dx = state.x - centerX;
  const dz = state.z - centerZ;
  const distance = Math.hypot(dx, dz);
  if (distance <= halfWidth) return false;
  const scale = (halfWidth - .15) / distance;
  state.x = centerX + dx * scale;
  state.z = centerZ + dz * scale;

  // 지금 실제로 가고 있는 방향(세계 기준). 앞으로 가는 힘과 옆으로 미끄러지는 힘을 합친 것.
  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  const rightX = Math.cos(state.heading);
  const rightZ = Math.sin(state.heading);
  let vx = forwardX * state.speed + rightX * state.lateral;
  let vz = forwardZ * state.speed + rightZ * state.lateral;

  const nx = dx / distance;   // 벽을 향한 방향
  const nz = dz / distance;
  const into = vx * nx + vz * nz;
  if (into > 0) {
    vx -= nx * into;
    vz -= nz * into;
    // 긁히는 만큼만 깎는다. 스치면 거의 그대로, 정면일수록 많이 잃는다.
    const bite = Math.min(1, into / Math.max(8, Math.hypot(vx, vz) + Math.abs(into)));
    const keep = 1 - KART.wallBite * bite;
    vx *= keep;
    vz *= keep;
  }
  state.speed = vx * forwardX + vz * forwardZ;
  state.lateral = vx * rightX + vz * rightZ;
  // 조향은 거의 그대로 둔다 — 벽에 붙었을 때 빠져나올 방법이 조향뿐이다.
  state.steer *= .9;
  state.hitWall = .12;
  flash(state, '충돌!', .35);
  return true;
}

// 길을 막고 선 것과 부딪쳤을 때. 벽은 긁고 지나가지만 이건 튕겨 나간다 —
// 겹친 만큼 밀어낸 뒤 앞으로 가던 힘을 꺾고, 부딪친 반대쪽으로 크게 민다.
export function bounceOff(state, centerX, centerZ, radius) {
  const dx = state.x - centerX;
  const dz = state.z - centerZ;
  const distance = Math.hypot(dx, dz);
  if (distance >= radius) return false;
  // 정확히 한가운데서 부딪치면 밀어낼 방향이 없다. 그때는 옆으로 밀어낸다.
  const nx = distance > .001 ? dx / distance : Math.cos(state.heading);
  const nz = distance > .001 ? dz / distance : Math.sin(state.heading);
  state.x = centerX + nx * radius;
  state.z = centerZ + nz * radius;
  const rightX = Math.cos(state.heading);
  const rightZ = Math.sin(state.heading);
  // 밀어내는 힘. 예전 값(16 / 속도의 .95)의 두 배다 — 스치기만 해도 확실히 튕겨 나간다.
  state.lateral = (nx * rightX + nz * rightZ) * Math.max(32, Math.abs(state.speed) * 1.9);
  state.speed *= -.3;
  state.drifting = false;
  state.driftTime = 0;
  state.steer = 0;
  state.hitWall = .35;
  flash(state, '만드라고라와 충돌!', .7);
  return true;
}

export function stepKart(state, input, rawDt) {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  state.noticeTimer = Math.max(0, state.noticeTimer - dt);
  state.hitWall = Math.max(0, state.hitWall - dt);
  state.startTimer -= dt;

  if (!state.started) {
    if (input.acceleratePressed && Math.abs(state.startTimer) <= 0.24) state.startArmed = true;
    if (state.startTimer <= 0) {
      state.started = true;
      if (state.startArmed || input.acceleratePressed) {
        state.boostTimer = 0.9;
        state.speed = 15;
        flash(state, '출발 부스터!', 1);
      }
    } else {
      return state;
    }
  }

  state.elapsed += dt;
  state.boostTimer = Math.max(0, state.boostTimer - dt);
  state.instantTimer = Math.max(0, state.instantTimer - dt);
  state.instantWindow = Math.max(0, state.instantWindow - dt);
  state.driftChainTimer = Math.max(0, state.driftChainTimer - dt);
  state.driftExitTimer = Math.max(0, state.driftExitTimer - dt);
  if (!state.drifting && state.driftChainTimer === 0) state.driftChain = 0;

  if (input.boostPressed && state.boosts > 0) {
    state.boosts--;
    state.boostTimer = KART.boostSeconds;
    charge(state, 0); // 두 슬롯 뒤에 가득 채워 둔 게이지도 즉시 다음 슬롯으로 넘긴다.
    flash(state, '부스터!');
  }

  if (input.acceleratePressed && state.instantWindow > 0) {
    state.instantWindow = 0;
    state.instantTimer = KART.instantSeconds;
    state.speed = Math.max(state.speed, 29);
    flash(state, '순간 부스터!');
  }

  const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  state.steer = toward(state.steer, steerInput, KART.steerRate * dt);
  const steerTap = (input.rightPressed ? 1 : 0) - (input.leftPressed ? 1 : 0);
  if (steerTap && !state.drifting) state.steer = toward(state.steer, steerTap, .32);
  const canDrift = Math.abs(state.speed) >= KART.driftMinSpeed && steerInput !== 0;
  if (input.driftPressed && canDrift && !state.drifting) {
    state.drifting = true;
    state.driftDirection = Math.sign(steerInput);
    state.driftTime = 0;
    state.driftChain = state.driftChainTimer > 0 ? Math.min(3, state.driftChain + 1) : 1;
    state.driftChainTimer = 0;
    state.driftExitTimer = 0;
    state.heading += state.driftDirection * KART.driftEntryTurn * Math.min(Math.abs(state.speed) / KART.maxSpeed, 1);
    state.lateral -= state.driftDirection * Math.abs(state.speed) * 0.24;
    if (state.driftChain > 1) flash(state, `${state.driftChain}연속 드리프트!`);
  }
  const counterSteering = steerInput && Math.sign(steerInput) === -state.driftDirection;
  const endsDrift = state.drifting && (
    Math.abs(state.speed) < KART.driftMinSpeed * .75
    || (!input.drift && state.driftTime > .12)
    || (counterSteering && state.driftTime > KART.driftMinTime)
  );
  if (endsDrift) {
    const driftTime = state.driftTime;
    if (driftTime >= KART.driftMinTime) {
      state.instantWindow = KART.instantWindow;
      state.driftChainTimer = KART.driftChainWindow;
      const driftName = counterSteering ? '커팅 드리프트' : driftTime < .38 ? '숏 드리프트' : driftTime > .95 ? '풀 드리프트' : '최적화 드리프트';
      flash(state, `${driftName} · 가속키를 다시 눌러 순간 부스터`, 1);
    }
    state.drifting = false;
    state.driftTime = 0;
    state.driftExitTimer = KART.driftExitSeconds;
  }

  if (input.up) {
    state.speed += (state.speed < 0 ? KART.brake : KART.accel) * dt;
  } else if (input.brake) {
    state.speed -= (state.speed > 0 ? KART.brake : KART.reverseAccel) * dt;
  } else {
    state.speed = toward(state.speed, 0, KART.coast * dt);
  }

  const boosting = state.boostTimer > 0;
  if (boosting) state.speed += KART.boostAccel * dt;
  if (state.instantTimer > 0) state.speed += KART.boostAccel * 0.52 * dt;
  const maxForward = boosting ? KART.boostSpeed : (state.instantTimer > 0 ? KART.maxSpeed + 7 : KART.maxSpeed);
  state.speed = Math.max(-KART.reverseSpeed, Math.min(state.speed, maxForward));

  const speedRatio = Math.min(Math.abs(state.speed) / KART.maxSpeed, 1.25);
  const reverse = state.speed < 0 ? -1 : 1;
  const highSpeedGrip = 1 - Math.max(0, speedRatio - .72) * .45;
  const baseTurn = state.steer * KART.turnRate * (.2 + Math.min(speedRatio, 1) * .8) * highSpeedGrip;
  const driftBuild = state.drifting ? Math.min(state.driftTime / .32, 1) : 0;
  // 고속턴 — 짧은 시간 안에 다시 드리프트를 걸면 그만큼 더 날카롭게 돈다.
  // 첫 드리프트는 0 이라 종전과 같고, 두 번째부터 붙는다.
  const chain = Math.min(Math.max(0, state.driftChain - 1), 2);
  const driftTurn = state.drifting
    ? state.driftDirection * KART.driftTurnRate * speedRatio * (.72 + driftBuild * .28) * (1 + chain * KART.chainTurn)
    : 0;
  state.heading += (baseTurn * (state.drifting ? .62 : 1) + driftTurn) * reverse * dt;

  if (state.drifting) {
    state.driftTime += dt;
    const slip = -state.driftDirection * Math.abs(state.speed) * (.27 + driftBuild * .1 + state.driftChain * .015);
    state.lateral = toward(state.lateral, slip, KART.driftGrip * dt);
    // 고속턴이라는 이름값을 하려면 속도가 남아야 한다. 이어 걸수록 덜 깎는다.
    state.speed = toward(state.speed, 0,
      KART.driftSpeedLoss * (.72 + Math.abs(state.steer) * .28) * (1 - chain * KART.chainKeep) * dt);
    charge(state, KART.driftCharge * Math.abs(state.speed) * (.7 + Math.abs(state.steer) * .3) * (1 + state.driftChain * .08) * dt);
  } else {
    const recoveryGrip = state.driftExitTimer > 0 ? KART.grip * 1.7 : boosting ? KART.grip * 1.35 : KART.grip;
    state.lateral = toward(state.lateral, 0, recoveryGrip * dt);
  }

  const forwardX = Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  const rightX = Math.cos(state.heading);
  const rightZ = Math.sin(state.heading);
  state.x += (forwardX * state.speed + rightX * state.lateral) * dt;
  state.z += (forwardZ * state.speed + rightZ * state.lateral) * dt;
  state.distance += Math.max(0, state.speed) * dt;

  return state;
}
