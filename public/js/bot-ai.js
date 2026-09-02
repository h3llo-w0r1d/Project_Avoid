// 봇전(연습)용 인공지능 — 진짜로 빔을 읽고 피한다.
//
// 매 프레임 활성 빔(선분)들을 보고 ①가까운 빔에서 멀어지는 반발력 ②무대 밖으로
// 안 나가게 중앙으로 당기는 힘 을 합쳐 이동 방향을 정하고, 바로 앞 지면에 live 빔이
// 오면 점프해서 넘는다. 난이도(초보~고인물)는 반응속도·인지범위·점프성공률·손떨림으로
// 조절한다. THREE 를 안 써서 서버/브라우저/테스트 어디서든 똑같이 돈다.

import { ARENA_RADIUS } from './config.js';
import { distToSegmentSq } from './shared/beams.js';

// 난이도 프리셋. react=결정 주기(클수록 굼뜸), perceive=위험 감지 반경,
// jumpDist=이 거리 안 live 빔이면 점프, jumpSkill=점프 성공확률, noise=이동 손떨림,
// edge=이 반경 넘으면 중앙으로, speed=이동 입력 크기(초보는 굼뜸).
export const BOT_TIERS = {
  novice:   { name: '초보',   react: 0.40, perceive: 4.5, jumpDist: 1.30, jumpSkill: 0.50, noise: 0.75, speed: 0.78 },
  mid:      { name: '중수',   react: 0.22, perceive: 6.0, jumpDist: 1.60, jumpSkill: 0.72, noise: 0.42, speed: 0.90 },
  expert:   { name: '고수',   react: 0.12, perceive: 7.5, jumpDist: 1.85, jumpSkill: 0.86, noise: 0.22, speed: 0.97 },
  master:   { name: '초고수', react: 0.065, perceive: 9.0, jumpDist: 2.05, jumpSkill: 0.95, noise: 0.10, speed: 1.00 },
  godwater: { name: '고인물', react: 0.033, perceive: 11.0, jumpDist: 2.25, jumpSkill: 0.995, noise: 0.03, speed: 1.00 }
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
    this.decideT -= dt;
    // 반응 주기가 되면 이동 방향을 다시 계산(그 사이엔 이전 방향 유지 = 반응 지연).
    if (this.decideT <= 0) {
      this.decideT = p.react;
      this.move = this.#chooseMove(body, sim);
    }

    // 점프는 매 프레임 판단하되, 성공률로 흔들어 난이도를 준다.
    // 지면에선 1단, 공중 하강 중 위험이 닥치면 2단 점프로 한 번 더 버틴다.
    let jumpPressed = false;
    if (this.#beamImminent(body, sim, p.jumpDist) && this.rand() < p.jumpSkill) {
      if (body.grounded) jumpPressed = true;
      else if (body.jumpsLeft > 0 && body.vy < 0) jumpPressed = true;
    }
    return { move: this.move, jumpPressed };
  }

  // 여러 방향으로 조금 가 본 자리를 점수 매겨, 가장 안전한 쪽으로 간다.
  // (반발 벡터는 빔이 중앙쪽에 있으면 봇을 무대 밖으로 밀어내서 안 쓴다.)
  #chooseMove(body, sim) {
    const p = this.p;
    const SAFE_R = ARENA_RADIUS - 1.1;                 // 이 반경 안에 있으려 한다
    const look = 1.8;                                  // 앞을 내다보는 거리
    const DIRS = [
      [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]
    ];
    let best = [0, 0], bestScore = -Infinity;
    for (const [dx, dz] of DIRS) {
      const cx = body.x + dx * look, cz = body.z + dz * look;
      const r = Math.hypot(cx, cz);
      let score = 0;
      // 무대 밖으로 나가는 후보는 크게 감점(낙사 방지).
      if (r > SAFE_R) score -= (r - SAFE_R) * 10;
      // 가장 가까운 위험 빔까지 거리(멀수록 안전). live 는 그대로, warn 은 덜 무섭게.
      let minD = p.perceive;
      for (const b of sim.active) {
        const w = b.live ? 1 : (b.phase === 'warn' ? 0.6 : 0);
        if (w === 0) continue;
        const s = b.seg;
        const d = Math.sqrt(distToSegmentSq(cx, cz, s.ax, s.az, s.bx, s.bz)) / w;
        if (d < minD) minD = d;
      }
      score += minD;                       // 안전거리 보너스(상한 perceive)
      score -= r * 0.06;                    // 살짝 중앙 선호(도망 여유)
      score += (this.rand() - 0.5) * p.noise * 2;   // 손떨림(초보일수록 큼)
      if (score > bestScore) { bestScore = score; best = [dx, dz]; }
    }
    const [dx, dz] = best;
    const mag = Math.hypot(dx, dz);
    if (mag < 1e-3) return { x: 0, y: 0 };
    // world (dvx,dvz) → 입력 move. player-physics: wantX=moveX, wantZ=-moveY.
    return { x: (dx / mag) * p.speed, y: -(dz / mag) * p.speed };
  }

  // 지면(발밑)으로 오는 live 빔이 dist 안에 있나 → 점프 판단.
  #beamImminent(body, sim, dist) {
    for (const b of sim.active) {
      if (!b.live) continue;
      const s = b.seg;
      const d = Math.sqrt(distToSegmentSq(body.x, body.z, s.ax, s.az, s.bx, s.bz));
      if (d <= dist) return true;
    }
    return false;
  }
}
