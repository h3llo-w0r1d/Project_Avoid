import assert from 'node:assert/strict';
import { constrainToRoad, createKartState, stepKart } from '../public/js/mandrider-physics.js';

const step = (state, input, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) stepKart(state, input, 1 / 60);
};

const state = createKartState();
step(state, {}, 3.1);
step(state, { up: true }, 2);
assert(state.speed > 20 && state.z < -10, '가속 주행이 되어야 한다');

for (let i = 0; i < 210; i++) {
  stepKart(state, { up: true, right: true, drift: true }, 1 / 60);
  // 충돌과 별개인 충전 규칙을 검사하려고 넓은 시험장처럼 위치만 되돌린다.
  state.x = 0;
  state.heading = 0;
}
assert(state.boosts > 0 || state.gauge > 70, '드리프트가 부스터 게이지를 채워야 한다');
stepKart(state, { up: true }, 1 / 60);
assert(state.instantWindow > 0, '드리프트 종료 뒤 순간 부스터 창이 열려야 한다');
stepKart(state, { up: true, acceleratePressed: true }, 1 / 60);
assert(state.instantTimer > 0, '가속키를 다시 누르면 순간 부스터가 나가야 한다');

state.boosts = 1;
stepKart(state, { up: true, boostPressed: true }, 1 / 60);
assert.equal(state.boosts, 0, '부스터 사용 시 슬롯을 하나 써야 한다');
assert(state.boostTimer > 2, 'N2O 부스터가 유지되어야 한다');

const start = createKartState();
step(start, {}, 2.82);
stepKart(start, { acceleratePressed: true }, 1 / 60);
step(start, { up: true }, 0.25);
assert(start.started && start.boostTimer > 0 && start.speed >= 15, 'GO 타이밍에 출발 부스터가 나가야 한다');

const reverse = createKartState();
step(reverse, {}, 3.1);
step(reverse, { brake: true }, 1.2);
assert(reverse.speed < -5 && reverse.z > 0, '정지 상태에서 브레이크를 누르면 후진해야 한다');

const collision = createKartState();
collision.x = 10;
collision.speed = 30;
assert(constrainToRoad(collision, 0, 0, 6), '트랙 바깥이면 충돌해야 한다');
assert(collision.x < 6 && collision.speed < 30, '충돌 시 트랙 안으로 밀고 감속해야 한다');

console.log('만드라이더 물리 검사 통과');
