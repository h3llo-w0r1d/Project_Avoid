export const KART = Object.freeze({
  roadHalfWidth: 6.15,
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
  steerRate: 6,
  turnRate: 1.55,
  driftMinSpeed: 10,
  driftMinTime: 0.28,
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
    drifting: false, driftDirection: 0, driftTime: 0,
    gauge: 0, boosts: 0, boostTimer: 0,
    instantTimer: 0, instantWindow: 0,
    startTimer: 3, startArmed: false, started: false,
    elapsed: 0, distance: 0, hitWall: 0,
    notice: '', noticeTimer: 0
  };
}

export function constrainToRoad(state, centerX, centerZ, halfWidth = KART.roadHalfWidth) {
  const dx = state.x - centerX;
  const dz = state.z - centerZ;
  const distance = Math.hypot(dx, dz);
  if (distance <= halfWidth) return false;
  const scale = (halfWidth - .15) / distance;
  state.x = centerX + dx * scale;
  state.z = centerZ + dz * scale;
  state.speed *= .68;
  state.lateral *= -.3;
  state.steer *= .35;
  state.hitWall = .2;
  flash(state, '충돌!', .35);
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
  const wantsDrift = input.drift && Math.abs(state.speed) >= KART.driftMinSpeed && Math.abs(state.steer) > 0.16;

  if (wantsDrift && !state.drifting) {
    state.drifting = true;
    state.driftDirection = Math.sign(state.steer);
    state.driftTime = 0;
  }
  if (state.drifting && !wantsDrift) {
    if (state.driftTime >= KART.driftMinTime) {
      state.instantWindow = KART.instantWindow;
      flash(state, '가속키를 다시 눌러 순간 부스터');
    }
    state.drifting = false;
    state.driftTime = 0;
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

  const speedRatio = Math.min(Math.abs(state.speed) / KART.maxSpeed, 1);
  const reverse = state.speed < 0 ? -1 : 1;
  const driftTurn = state.drifting ? 1.42 : 1;
  state.heading += state.steer * reverse * KART.turnRate * (0.2 + speedRatio * 0.8) * driftTurn * dt;

  if (state.drifting) {
    state.driftTime += dt;
    const slip = -state.driftDirection * Math.abs(state.speed) * 0.31;
    state.lateral = toward(state.lateral, slip, KART.driftGrip * dt);
    charge(state, Math.abs(state.speed * state.steer) * 0.9 * dt);
  } else {
    state.lateral = toward(state.lateral, 0, KART.grip * dt);
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
