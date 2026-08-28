// 마이크로 점프. "악!" 한 번 = 점프, "악! 악!" 두 번 = 2단 점프.
//
// 절대 음량이 아니라 '갑자기 커지는 순간'(함성 시작)을 잡는다. 느리게 따라가는
// 기준선(baseline)을 두고 그보다 확 커질 때만 친다 — 음악·에어컨 같은 꾸준한
// 소리에는 안 반응하고, 방/마이크가 달라도 알아서 맞춘다.
//
// 한 번 친 뒤에는 소리가 다시 잦아들 때까지 다음 함성을 안 받는다(히스테리시스).
// 그래서 길게 "아아아~" 지르면 점프 한 번, 끊어서 "악! 악!" 지르면 두 번이 된다.

export class VoiceJump {
  constructor(onShout) {
    this.onShout = onShout;   // 함성 시작마다 호출(= 점프 한 번)
    this.stream = null; this.ctx = null; this.analyser = null; this.buf = null;
    this.on = false;
    this.baseline = 0.03;
    this.armed = true;        // 다음 함성을 받을 준비가 됐는가
    this.warm = 0;            // 켠 직후 잠깐(오작동 방지)
    this.cool = 0;            // 함성 간 최소 간격
    this.level = 0;           // 지금 음량(표시용)
    this.high = 0.1;          // 지금 점프 기준선(표시용)
  }

  supported() {
    return !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  // 마이크를 연다(권한 요청). 이미 열려 있으면 그대로. 실패하면 throw.
  async open() {
    if (this.on) return;
    if (!this.supported()) throw new Error('이 브라우저는 마이크를 지원하지 않습니다.');
    const stream = await navigator.mediaDevices.getUserMedia({
      // 자동 게인은 끈다(함성이 진짜 크게 잡히게). 반향·잡음 억제는 켜 스피커
      // 소리가 마이크로 되도는 걸 줄인다.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* 무시 */ } }
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);

    this.stream = stream; this.ctx = ctx; this.analyser = analyser;
    this.buf = new Uint8Array(analyser.fftSize);
    this.baseline = 0.03; this.armed = true; this.warm = 0.4; this.cool = 0;
    this.on = true;
  }

  close() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = this.ctx = this.analyser = this.buf = null;
    this.on = false;
  }

  // 매 프레임 호출. 마이크 음량을 재서 감지기에 넣는다.
  poll(dt) {
    if (!this.on || !this.analyser) return;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
    this.feed(Math.sqrt(sum / this.buf.length), dt);
  }

  // 음량 하나(0~1)를 받아 함성 시작이면 onShout() 를 부른다. (테스트도 여기로)
  feed(level, dt) {
    this.level = level;
    // 기준선은 느리게만 따라간다(함성으로 확 올려도 기준선은 거의 그대로).
    this.baseline += (level - this.baseline) * 0.03;

    if (this.warm > 0) { this.warm -= dt; return; }   // 켠 직후 잠깐 무시
    if (this.cool > 0) this.cool -= dt;

    const HIGH = Math.max(0.07, this.baseline * 3.2);  // 이보다 크면 함성 시작
    const LOW = Math.max(0.045, this.baseline * 1.8);  // 이 아래로 내려가면 재장전
    this.high = HIGH;                                  // 화면 바에 기준선으로 그린다

    if (this.armed && this.cool <= 0 && level > HIGH) {
      this.armed = false;
      this.cool = 0.09;       // 한 함성이 두 번으로 안 세게 최소 간격
      this.onShout?.();
    } else if (!this.armed && level < LOW) {
      this.armed = true;      // 조용해졌다 → 다음 "악!" 받을 준비
    }
  }
}
