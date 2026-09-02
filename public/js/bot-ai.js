// 봇전(연습)용 인공지능 — 진짜로 빔을 읽고 피한다.
//
// 매 프레임 활성 빔(선분)들을 보고 ①가까운 빔에서 멀어지는 반발력 ②무대 밖으로
// 안 나가게 중앙으로 당기는 힘 을 합쳐 이동 방향을 정하고, 바로 앞 지면에 live 빔이
// 오면 점프해서 넘는다. 난이도(초보~고인물)는 반응속도·인지범위·점프성공률·손떨림으로
// 조절한다. THREE 를 안 써서 서버/브라우저/테스트 어디서든 똑같이 돈다.

import { ARENA_RADIUS } from './config.js';
import { distToSegmentSq, clipToArena } from './shared/beams.js';

// 빔이 h초 뒤에 어디 있을지 미리 그려 본다. Beam.update 와 같은 식으로 u 를 구해
// path(u) 로 선분을 얻는다. 아직 예열 중이거나 이미 지나갔으면 null.
// → { ax, az, bx, bz, live } (live=그 시점에 실제로 맞는 상태인가)
function segAt(b, h, out) {
  const warnEnd = b.delay + b.warnTime;
  const t = b.t + h;
  if (t < warnEnd) {
    // 아직 예열 — 무대에 처음 닿는 자리를 미리 본다(경고 위치).
    b.path(b.previewU(), out);
    return clipToArena(out) ? false : null;   // false = 아직 안 맞음(경고)
  }
  const u = (t - warnEnd) / b.duration;
  if (u >= 1) return null;                    // 이미 지나감
  b.path(u, out);
  return clipToArena(out) ? true : null;      // true = 그 시점에 맞는 빔
}

// 난이도 프리셋. react=결정 주기(클수록 굼뜸), perceive=위험 감지 반경,
// jumpDist=이 거리 안 live 빔이면 점프, jumpSkill=점프 성공확률, noise=이동 손떨림,
// edge=이 반경 넘으면 중앙으로, speed=이동 입력 크기(초보는 굼뜸).
// 회피 성능은 실험으로 찾은 최적값(horizon 0.3 / looks 0.8·1.6·2.4 / jumpLead 0.22)을
// 공통으로 쓰고, 난이도는 반응속도·손떨림·점프성공률로 가른다.
// save: 맞을 뻔했을 때 아슬아슬하게 빠져나갈 확률(상위 티어가 오래 버티게 하는 보정).
const BASE = { perceive: 7.0, horizon: 0.30, looks: [0.8, 1.6, 2.4], jumpLead: 0.22, speed: 1.0 };
export const BOT_TIERS = {
  // 하위 티어는 회피 자체를 약하게(시야 좁고 굼뜨고 점프 실수), 상위 티어는
  // 최적 회피 + 위기탈출(save)로 오래 버틴다.
  novice: { name: '초보', perceive: 5.0, horizon: 0.18, looks: [1.6], jumpLead: 0.18,
    react: 0.24, jumpSkill: 0.68, noise: 0.50, speed: 0.90, save: 0 },
  mid: { name: '중수', perceive: 6.0, horizon: 0.24, looks: [1.2, 2.4], jumpLead: 0.20,
    react: 0.13, jumpSkill: 0.86, noise: 0.27, speed: 0.96, save: 0.12 },
  expert:   { ...BASE, name: '고수',   react: 0.07, jumpSkill: 0.94, noise: 0.14, save: 0.40 },
  master:   { ...BASE, name: '초고수', react: 0.04, jumpSkill: 0.98, noise: 0.07, save: 0.62 },
  godwater: { ...BASE, name: '고인물', react: 0.02, jumpSkill: 1.00, noise: 0.02, save: 0.79 }
};

export class BotAI {
  // tier: BOT_TIERS 의 키. rand: 0~1 난수 함수(없으면 Math.random).
  constructor(tier = 'mid', rand = Math.random) {
    this.p = BOT_TIERS[tier] ?? BOT_TIERS.mid;
    this.rand = rand;
    this.decideT = 0;             // 다음 결정까지 남은 시간
    this.move = { x: 0, y: 0 };   // 지금 유지 중인 이동 방향
  }

  // dt: 프레임 시간, body: PlayerBody(x,z,grounded), sim: 공유 Hazards(active 배열).
  // → { move:{x,y}, jumpPressed }
  think(dt, body, sim) {
    const p = this.p;
    // 이번 프레임의 '미래 빔 위치'를 한 번만 계산해 두고 이동·점프가 같이 쓴다.
    this.threats = this.#predict(sim, p.horizon);

    this.decideT -= dt;
    // 반응 주기가 되면 이동 방향을 다시 계산(그 사이엔 이전 방향 유지 = 반응 지연).
    if (this.decideT <= 0) {
      this.decideT = p.react;
      this.move = this.#chooseMove(body);
    }

    // 점프는 매 프레임 판단하되, 성공률로 흔들어 난이도를 준다.
    // 지면에선 1단, 공중 하강 중 위험이 닥치면 2단 점프로 한 번 더 버틴다.
    let jumpPressed = false;
    if (this.#willBeHit(body, p.jumpLead) && this.rand() < p.jumpSkill) {
      if (body.grounded) jumpPressed = true;
      else if (body.jumpsLeft > 0 && body.vy < 0) jumpPressed = true;
    }
    return { move: this.move, jumpPressed };
  }

  // 앞으로 horizon 초 동안 빔들이 지나갈 자리를 뽑아 둔다.
  #predict(sim, horizon) {
    const out = [];
    const tmp = { ax: 0, az: 0, bx: 0, bz: 0 };
    const steps = 4;
    for (const b of sim.active) {
      if (b.dead) continue;
      for (let i = 0; i <= steps; i++) {
        const h = (horizon * i) / steps;
        const live = segAt(b, h, tmp);
        if (live === null) continue;
        out.push({ ax: tmp.ax, az: tmp.az, bx: tmp.bx, bz: tmp.bz, live, h });
      }
    }
    return out;
  }

  // 여러 방향으로 조금 가 본 자리를, '그때 빔이 어디 있을지'로 점수 매겨 고른다.
  // 미래를 보므로 빔이 오기 전에 미리 비켜난다.
  #chooseMove(body) {
    const p = this.p;
    const SAFE_R = ARENA_RADIUS - 1.0;
    const DIRS = [
      [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71],
      [0.38, 0.92], [-0.38, 0.92], [0.38, -0.92], [-0.38, -0.92],
      [0.92, 0.38], [-0.92, 0.38], [0.92, -0.38], [-0.92, -0.38]
    ];
    let best = [0, 0], bestScore = -Infinity;
    for (const [dx, dz] of DIRS) {
      // 그 방향으로 갈 때 '가는 길 전체'에서 가장 아슬아슬한 지점(병목)으로 평가한다.
      // 멀리만 안전한 곳을 고르면 가는 도중에 맞으므로, 최악 지점을 본다.
      let worst = Infinity;
      for (const look of p.looks) {
        const cx = body.x + dx * look, cz = body.z + dz * look;
        const r = Math.hypot(cx, cz);
        let here = p.perceive;
        for (const t of this.threats) {
          const d = Math.sqrt(distToSegmentSq(cx, cz, t.ax, t.az, t.bx, t.bz))
            / (t.live ? 1 : 0.55);           // 아직 예열인 빔은 덜 무섭게
          if (d < here) here = d;
        }
        if (r > SAFE_R) here -= (r - SAFE_R) * 14;   // 낙사 방지
        here -= r * 0.05;                             // 살짝 중앙 선호
        if (here < worst) worst = here;
      }
      const score = worst + (this.rand() - 0.5) * p.noise * 2;
      if (score > bestScore) { bestScore = score; best = [dx, dz]; }
    }
    const [dx, dz] = best;
    const mag = Math.hypot(dx, dz);
    if (mag < 1e-3) return { x: 0, y: 0 };
    // world (dvx,dvz) → 입력 move. player-physics: wantX=moveX, wantZ=-moveY.
    return { x: (dx / mag) * p.speed, y: -(dz / mag) * p.speed };
  }

  // lead 초 안에 지금 자리로 live 빔이 덮치나 → 점프해서 넘는다.
  #willBeHit(body, lead) {
    const reach = 0.95;   // 빔 굵기 + 몸 반지름 + 여유
    for (const t of this.threats) {
      if (!t.live || t.h > lead) continue;
      if (distToSegmentSq(body.x, body.z, t.ax, t.az, t.bx, t.bz) <= reach * reach) return true;
    }
    return false;
  }
}
