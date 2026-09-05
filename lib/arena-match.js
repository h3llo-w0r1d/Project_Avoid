// 1v1 대전 한 판. 서버가 물리와 판정을 모두 돌린다.
//
// 왜 서버가 다 도는가:
//   서로 밀칠 수 있으니 "누가 누구를 밀었는가"를 한 곳에서 정해야 한다.
//   각자 자기 화면에서 판정하면 둘 다 "내가 밀었다"고 우겨 어긋난다.
//
// 전기선은 통신으로 보내지 않는다. 씨앗만 맞춰 주면 서버와 두 클라이언트가
// 똑같은 전기선을 스스로 만든다 (shared/beams.js 의 난수가 씨앗 기반).

import { Hazards } from '../public/js/shared/beams.js';
import { PlayerBody, resolvePush } from '../public/js/shared/player-physics.js';
import { ARENA_RADIUS } from '../public/js/config.js';

const TICK = 1 / 60;              // 물리 스텝
const SNAPSHOT_EVERY = 3;         // 3틱마다(=20Hz) 상태를 보낸다
const COUNTDOWN = 3;              // 시작 전 카운트다운(초)
const START_RADIUS = ARENA_RADIUS * 0.45;

export class Match {
  constructor(id, seats) {
    this.id = id;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.hazards = new Hazards(this.seed);
    this.elapsed = 0;
    this.tickCount = 0;
    this.phase = 'countdown';     // countdown -> playing -> over
    this.countdown = COUNTDOWN;
    this.timer = null;
    this.winnerId = null;         // 끝난 뒤 전적을 남길 때 쓴다

    // 서로 마주 보게 양쪽에 세운다
    this.players = seats.map((seat, i) => {
      const angle = i === 0 ? Math.PI : 0;
      const body = new PlayerBody();
      body.reset(Math.cos(angle) * START_RADIUS, Math.sin(angle) * START_RADIUS);
      return {
        id: seat.id,
        name: seat.name,
        character: seat.character ?? null,
        send: seat.send,
        body,
        alive: true,
        diedAt: null,
        cause: null,
        // 마지막으로 받은 입력. 새 입력이 안 오면 그대로 유지한다.
        input: { moveX: 0, moveY: 0, jump: false },
        // 점프는 눌린 순간 한 번만 먹어야 해서 따로 센다
        jumpSeq: 0,
        lastJumpSeq: 0
      };
    });

    this.onFinish = null;
  }

  start() {
    this.broadcast({
      type: 'match-start',
      seed: this.seed,
      countdown: COUNTDOWN,
      players: this.players.map((p, i) => ({
        id: p.id, name: p.name, seat: i, character: p.character
      }))
    });
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // 클라이언트에서 온 입력. 물리에 바로 넣지 않고 다음 틱에 반영한다.
  applyInput(playerId, msg) {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || !p.alive) return;
    p.input.moveX = clamp(msg.moveX);
    p.input.moveY = clamp(msg.moveY);
    // 점프 번호가 늘었을 때만 새 점프로 친다.
    // 안 그러면 입력 패킷이 여러 번 오는 동안 계속 점프해 버린다.
    if (typeof msg.jumpSeq === 'number' && msg.jumpSeq > p.jumpSeq) {
      p.jumpSeq = msg.jumpSeq;
    }
  }

  tick() {
    if (this.phase === 'countdown') {
      this.countdown -= TICK;
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.broadcast({ type: 'go' });
      }
      return;
    }
    if (this.phase !== 'playing') return;

    this.elapsed += TICK;
    this.tickCount++;

    this.hazards.update(TICK, this.elapsed);

    for (const p of this.players) {
      if (!p.alive) continue;
      const jump = p.jumpSeq > p.lastJumpSeq;
      if (jump) p.lastJumpSeq = p.jumpSeq;
      p.body.step(TICK, { moveX: p.input.moveX, moveY: p.input.moveY, jump });
    }

    // 밀치기 — 둘 다 살아 있을 때만
    const [a, b] = this.players;
    if (a.alive && b.alive) resolvePush(a.body, b.body, TICK);

    for (const p of this.players) {
      if (!p.alive) continue;
      if (this.hazards.hitTest(p.body.x, p.body.z, p.body.feetY, p.body.headY)) {
        this.kill(p, 'zap');
      } else if (p.body.droppedOff) {
        this.kill(p, 'fall');
      }
    }

    if (this.tickCount % SNAPSHOT_EVERY === 0) this.sendSnapshot();

    const living = this.players.filter((p) => p.alive);
    if (living.length <= 1) this.finish();
  }

  kill(p, cause) {
    p.alive = false;
    p.diedAt = this.elapsed;
    p.cause = cause;
    this.broadcast({ type: 'died', id: p.id, cause, at: round2(this.elapsed) });
  }

  sendSnapshot() {
    this.broadcast({
      type: 'state',
      t: round3(this.elapsed),
      players: this.players.map((p) => ({
        id: p.id,
        alive: p.alive,
        x: round3(p.body.x),
        y: round3(p.body.y),
        z: round3(p.body.z),
        vx: round3(p.body.vx),
        vy: round3(p.body.vy),
        vz: round3(p.body.vz),
        // 밀려난 속도. 이걸 안 주면 클라이언트가 밀림을 예측하지 못해
        // 미끄러지는 동안 계속 위치를 되돌려 받으며 덜컹거린다.
        kx: round3(p.body.kx),
        kz: round3(p.body.kz),
        // 클라이언트가 점프 연출을 맞추는 데 쓴다
        j: p.body.jumpsLeft,
        g: p.body.grounded ? 1 : 0
      }))
    });
  }

  finish() {
    this.phase = 'over';
    this.stop();

    // 마지막까지 살아남은 쪽이 이긴다. 동시에 죽으면 무승부.
    const alive = this.players.filter((p) => p.alive);
    let winner = null;
    if (alive.length === 1) {
      winner = alive[0].id;
    } else if (alive.length === 0) {
      const [a, b] = this.players;
      // 0.15초 안에 둘 다 죽었으면 동시에 죽은 것으로 본다
      if (Math.abs(a.diedAt - b.diedAt) > 0.15) {
        winner = a.diedAt > b.diedAt ? a.id : b.id;
      }
    }

    this.winnerId = winner;
    this.broadcast({
      type: 'match-over',
      winner,
      duration: round2(this.elapsed),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        survived: round2(p.diedAt ?? this.elapsed),
        cause: p.cause
      }))
    });

    this.onFinish?.(this);
  }

  // 한쪽이 나가면 남은 쪽이 이긴다
  forfeit(playerId) {
    if (this.phase === 'over') return;
    const quitter = this.players.find((p) => p.id === playerId);
    if (quitter) {
      quitter.alive = false;
      quitter.diedAt = this.elapsed;
      quitter.cause = 'left';
    }
    this.phase = 'over';
    this.stop();

    const other = this.players.find((p) => p.id !== playerId);
    this.winnerId = other?.id ?? null;
    this.broadcast({
      type: 'match-over',
      winner: other?.id ?? null,
      reason: 'left',
      duration: round2(this.elapsed),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        survived: round2(p.diedAt ?? this.elapsed),
        cause: p.cause
      }))
    });
    this.onFinish?.(this);
  }

  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const p of this.players) p.send(text);
  }
}

const clamp = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
