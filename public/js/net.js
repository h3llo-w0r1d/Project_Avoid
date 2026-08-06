// 1v1 통신.
//
// 판정은 전부 서버가 한다. 하지만 서버 응답을 기다렸다 움직이면
// 지연만큼 조작이 늦게 먹혀 점프 타이밍(0.58초 창)을 못 맞춘다.
// 그래서 내 캐릭터는 입력을 받자마자 여기서 먼저 굴리고(예측),
// 서버 값이 오면 어긋난 만큼 슬쩍 당겨서 맞춘다.
//
// 상대는 예측할 수 없으니(입력을 모르니) 받은 위치 사이를 보간해 그린다.

import { PlayerBody } from './shared/player-physics.js';

const INPUT_HZ = 30;              // 입력 전송 주기
const SNAP_DISTANCE = 2.5;        // 이만큼 어긋나면 부드럽게 말고 그냥 순간이동
const CORRECT_RATE = 12;          // 어긋남을 당겨오는 속도 (클수록 빠르고 뻣뻣)
const REMOTE_LAG = 0.1;           // 상대를 이만큼 과거로 그린다(보간용 여유)

export class Net {
  constructor() {
    this.socket = null;
    this.id = null;
    this.ping = 0;

    this.handlers = {};           // type -> fn
    this.jumpSeq = 0;
    this.inputTimer = null;

    // 서버가 보낸 마지막 상태
    this.remote = null;           // 상대 { body, buffer }
    this.correction = { x: 0, y: 0, z: 0 };
  }

  on(type, fn) { this.handlers[type] = fn; }

  connect(name, character) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${location.host}/ws`);
      this.socket = socket;

      const failed = () => reject(new Error('서버에 연결하지 못했습니다.'));
      socket.addEventListener('error', failed, { once: true });

      socket.addEventListener('open', () => {
        socket.removeEventListener('error', failed);
        this.send({ type: 'hello', name, character });
        this.startPing();
        resolve();
      });

      socket.addEventListener('message', (e) => this.receive(e.data));

      socket.addEventListener('close', () => {
        this.stopInput();
        this.stopPing();
        this.handlers.disconnected?.();
      });
    });
  }

  close() {
    this.stopInput();
    this.stopPing();
    this.socket?.close();
    this.socket = null;
  }

  get connected() { return this.socket?.readyState === 1; }

  send(msg) {
    if (this.connected) this.socket.send(JSON.stringify(msg));
  }

  receive(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'hello') this.id = msg.id;
    if (msg.type === 'pong') this.ping = Math.round(performance.now() - msg.t);
    if (msg.type === 'state') return this.onState(msg);

    this.handlers[msg.type]?.(msg);
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 3000);
    this.send({ type: 'ping', t: performance.now() });
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ---------------------------------------------------------------- 대전

  // 대전이 시작될 때 부른다. local 은 내가 조종하는 PlayerBody.
  // rivalStart 를 넣어 주지 않으면 첫 스냅샷이 오기 전까지 상대가
  // 원점(무대 한가운데)에 서 있는 것처럼 보인다.
  beginMatch(localBody, rivalStart = { x: 0, z: 0 }) {
    this.localBody = localBody;
    this.remote = { body: new PlayerBody(), buffer: [], alive: true };
    this.remote.body.reset(rivalStart.x, rivalStart.z);
    this.correction = { x: 0, y: 0, z: 0 };
    this.startInput();
  }

  endMatch() {
    this.stopInput();
    this.localBody = null;
  }

  startInput() {
    this.stopInput();
    this.inputTimer = setInterval(() => {
      if (!this.currentInput) return;
      this.send({
        type: 'input',
        moveX: round3(this.currentInput.move.x),
        moveY: round3(this.currentInput.move.y),
        jumpSeq: this.jumpSeq
      });
    }, 1000 / INPUT_HZ);
  }

  stopInput() {
    if (this.inputTimer) clearInterval(this.inputTimer);
    this.inputTimer = null;
  }

  // 매 프레임 부른다. 점프는 눌린 순간에만 번호를 올려,
  // 30Hz 전송 사이에 눌렀다 뗀 점프도 빠짐없이 전달된다.
  feedInput(input) {
    this.currentInput = input;
    if (input.jumpPressed) this.jumpSeq++;
  }

  onState(msg) {
    if (!this.localBody || !this.remote) return;

    // 서버 시각을 알려 준다. 전기선을 서버와 같은 속도로 굴리는 데 쓴다.
    this.handlers.time?.(msg.t);

    for (const p of msg.players) {
      if (p.id === this.id) {
        // 내 캐릭터: 예측한 위치와 서버 위치의 차이를 기록해 둔다.
        // 바로 덮어쓰면 조작할 때마다 화면이 튄다.
        const dx = p.x - this.localBody.x;
        const dy = p.y - this.localBody.y;
        const dz = p.z - this.localBody.z;

        if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) {
          // 너무 벌어졌으면(밀쳐졌거나 패킷을 오래 놓쳤거나) 그냥 맞춘다
          this.localBody.x = p.x;
          this.localBody.y = p.y;
          this.localBody.z = p.z;
          this.correction = { x: 0, y: 0, z: 0 };
        } else {
          this.correction = { x: dx, y: dy, z: dz };
        }
        this.localBody.vx = p.vx;
        this.localBody.vy = p.vy;
        this.localBody.vz = p.vz;
        this.localBody.grounded = !!p.g;
        this.localBody.jumpsLeft = p.j;
        this.localAlive = p.alive;
      } else {
        // 상대: 받은 위치를 시간과 함께 쌓아 두고 조금 과거를 그린다
        this.remote.alive = p.alive;
        this.remote.buffer.push({ t: performance.now() / 1000, x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz });
        if (this.remote.buffer.length > 20) this.remote.buffer.shift();
      }
    }
  }

  // 매 프레임 호출. 예측 오차를 조금씩 당겨오고 상대 위치를 보간한다.
  update(dt) {
    if (!this.localBody || !this.remote) return;

    // 어긋남을 한 번에 다 당기면 튀므로 지수적으로 줄인다
    const k = 1 - Math.exp(-CORRECT_RATE * dt);
    for (const axis of ['x', 'y', 'z']) {
      const step = this.correction[axis] * k;
      this.localBody[axis] += step;
      this.correction[axis] -= step;
    }

    this.interpolateRemote();
  }

  interpolateRemote() {
    const buf = this.remote.buffer;
    if (buf.length === 0) return;

    const target = performance.now() / 1000 - REMOTE_LAG;
    const body = this.remote.body;

    // 목표 시각을 감싸는 두 지점을 찾아 사이를 잇는다
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= target && buf[i + 1].t >= target) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
    }

    const span = b.t - a.t;
    const f = span > 1e-4 ? Math.max(0, Math.min(1, (target - a.t) / span)) : 1;
    body.x = a.x + (b.x - a.x) * f;
    body.y = a.y + (b.y - a.y) * f;
    body.z = a.z + (b.z - a.z) * f;
    body.vx = b.vx;
    body.vz = b.vz;
    body.grounded = body.y <= 0.001;
  }
}

const round3 = (v) => Math.round(v * 1000) / 1000;
