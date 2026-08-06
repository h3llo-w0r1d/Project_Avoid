// 소리.
//
// config.js 의 SOUNDS 에 파일을 지정하면 그 파일을 쓰고,
// 지정하지 않았거나 불러오기에 실패하면 Web Audio 로 그때그때 합성한다.
// 그래서 오디오 파일 없이도 게임은 그대로 돌아간다.
//
// 브라우저는 사용자가 뭔가 누르기 전에는 소리를 못 내게 막는다.
// 그래서 AudioContext 는 첫 클릭 때 unlock() 에서 만든다.

import { SOUNDS, VOICE } from './config.js';

const MUTE_KEY = 'avoidarc.muted';

// 문자열로 적었으면 { url, volume } 로 펴 준다
function entryOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return { url: value, volume: 1 };
  return { url: value.url, volume: value.volume ?? 1 };
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.noise = null;

    this.buffers = {};      // 이름 -> AudioBuffer (다 받아진 것만)
    this.raw = {};          // 이름 -> ArrayBuffer (아직 디코딩 전)
    this.userVoice = null;         // { buffer, rate } — 유저가 녹음한 점프 소리
    this.pendingVoice = null;      // 아직 소리가 안 깨어서 못 푼 것
    this.prefetch();
  }

  // AudioContext 없이도 내려받기는 할 수 있다. 첫 클릭 때 바로 쓸 수 있도록
  // 미리 받아 두고, 디코딩만 unlock() 뒤로 미룬다.
  prefetch() {
    for (const [name, value] of Object.entries(SOUNDS)) {
      const entry = entryOf(value);
      if (!entry) continue;
      fetch(entry.url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buf) => {
          this.raw[name] = buf;
          if (this.ctx) this.decode(name);
        })
        .catch((err) => {
          console.warn(`소리 파일을 불러오지 못해 합성음을 씁니다 (${name}: ${entry.url}):`, err.message);
        });
    }
  }

  async decode(name) {
    const raw = this.raw[name];
    if (!raw || !this.ctx) return;
    delete this.raw[name];
    try {
      this.buffers[name] = await this.ctx.decodeAudioData(raw);
    } catch (err) {
      console.warn(`소리 파일을 해독하지 못해 합성음을 씁니다 (${name}):`, err.message);
    }
  }

  // 반드시 클릭·키 입력 같은 사용자 제스처 안에서 불러야 한다.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;                 // 아주 오래된 브라우저면 조용히 포기

    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // 잡음은 한 번 만들어 두고 돌려 쓴다
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // 미리 받아 둔 파일들을 이제 해독한다
    for (const name of Object.keys(this.raw)) this.decode(name);

    // 저장해 둔 녹음도 마찬가지다. 페이지를 열자마자 불러오지만
    // 그때는 AudioContext 가 없어서 여기까지 미뤄 둔 것이다.
    if (this.pendingVoice) {
      const { blob, rate } = this.pendingVoice;
      this.pendingVoice = null;
      this.setUserVoice(blob, rate);
    }
  }

  // 파일이 준비돼 있으면 그걸 틀고 true, 아니면 false.
  // 각 효과음은 이걸 먼저 물어보고, 없을 때만 합성한다.
  playFile(name, { loop = false, target = null, volume = null } = {}) {
    const buffer = this.buffers[name];
    if (!buffer || !this.ctx) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;

    const gain = this.ctx.createGain();
    gain.gain.value = volume ?? entryOf(SOUNDS[name])?.volume ?? 1;
    src.connect(gain);
    gain.connect(target ?? this.master);
    src.start();
    return src;
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (muted) window.speechSynthesis?.cancel();
    if (this.master) {
      // 뚝 끊으면 '틱' 소리가 나므로 짧게 넘긴다
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  // ---------------------------------------------------------------- 내 목소리

  // 녹음한 소리에서 앞뒤 빈 곳을 잘라내고 크기를 고르게 맞춘다.
  //
  // 사람은 버튼을 누르고 나서 숨을 고른 뒤에 말한다. 그대로 쓰면 점프하고
  // 한참 뒤에 소리가 나온다. 목소리가 시작되는 지점까지 잘라내야 점프와
  // 붙는다. 크기도 사람마다·마이크마다 제각각이라 맞춰 준다.
  trim(buffer) {
    const src = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < src.length; i++) peak = Math.max(peak, Math.abs(src[i]));
    if (peak < 0.005) return null;              // 아무 소리도 안 들어왔다

    const floor = Math.max(0.02, peak * 0.08);
    let from = 0;
    let to = src.length - 1;
    while (from < src.length && Math.abs(src[from]) < floor) from++;
    while (to > from && Math.abs(src[to]) < floor) to--;

    // 말이 시작되기 직전의 숨결까지 살짝 남긴다. 칼같이 자르면 뚝 끊겨 들린다.
    const pad = Math.round(buffer.sampleRate * 0.02);
    from = Math.max(0, from - pad);
    to = Math.min(src.length - 1, to + pad);

    const max = Math.round(buffer.sampleRate * VOICE.maxSeconds);
    const length = Math.min(to - from + 1, max);
    if (length < buffer.sampleRate * 0.05) return null;

    const out = this.ctx.createBuffer(1, length, buffer.sampleRate);
    const dst = out.getChannelData(0);
    const gain = 0.85 / peak;                   // 최대 크기를 일정하게
    const fade = Math.round(buffer.sampleRate * 0.012);
    for (let i = 0; i < length; i++) {
      // 양 끝을 짧게 여닫는다. 파형이 뚝 끊기면 '틱' 소리가 난다.
      const edge = Math.min(1, i / fade, (length - i) / fade);
      dst[i] = src[from + i] * gain * edge;
    }
    return out;
  }

  // 유저가 녹음한 목소리를 받아 둔다. blob 은 recorder.js 가 만든 원본.
  //
  // 페이지를 열자마자 저장해 둔 걸 불러올 때는 아직 AudioContext 가 없다.
  // (브라우저가 사용자 조작 전에는 소리를 못 내게 막는다.) 그럴 땐 원본만
  // 쥐고 있다가 unlock() 때 푼다.
  async setUserVoice(blob, rate = VOICE.userRate) {
    if (!this.ctx) {
      this.pendingVoice = { blob, rate };
      return { ok: true, seconds: 0, pending: true };
    }
    try {
      const decoded = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      const buffer = this.trim(decoded);
      if (!buffer) return { ok: false, reason: '소리가 너무 작습니다. 다시 녹음해 주세요.' };
      this.userVoice = { buffer, rate };
      return { ok: true, seconds: buffer.duration / rate };
    } catch (err) {
      return { ok: false, reason: `녹음을 읽지 못했습니다: ${err.message}` };
    }
  }

  clearUserVoice() {
    this.userVoice = null;
    this.pendingVoice = null;
  }

  hasUserVoice() {
    return !!(this.userVoice || this.pendingVoice);
  }

  // boost 를 주면 그만큼 더 빠르고 높게 낸다 (2단 점프용).
  playUserVoice(boost = 1) {
    const voice = this.userVoice;
    if (!voice || !this.ctx) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = voice.buffer;
    src.playbackRate.value = voice.rate * boost;

    const gain = this.ctx.createGain();
    gain.gain.value = VOICE.volume;
    src.connect(gain);
    gain.connect(this.master);
    src.start();
    return true;
  }

  // 녹음 칸에서 눌러 듣기. 음소거 중이어도 들려줘야 확인이 된다.
  auditionUserVoice() {
    if (!this.ctx) return false;
    const wasMuted = this.muted;
    if (wasMuted) this.master.gain.setValueAtTime(0.5, this.now);
    const played = this.playUserVoice();
    if (wasMuted) {
      const voice = this.userVoice;
      const after = this.now + (voice ? voice.buffer.duration / voice.rate : 0) + 0.05;
      this.master.gain.setValueAtTime(0, after);
    }
    return played;
  }

  // 점프할 때 내 목소리. 녹음해 둔 게 없으면 아무 소리도 내지 않는다
  // (점프 효과음은 따로 난다).
  say(boost = 1) {
    if (!VOICE.enabled || this.muted || !this.ctx) return;
    this.playUserVoice(boost);
  }

  // ---------------------------------------------------------------- 재료

  get now() { return this.ctx.currentTime; }

  // 감쇠 포락선을 가진 게인 노드
  env(peak, attack, decay, at = this.now) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master);
    return g;
  }

  tone({ type = 'sine', from, to, peak = 0.3, attack = 0.005, decay = 0.15, at = this.now }) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + attack + decay);
    osc.connect(this.env(peak, attack, decay, at));
    osc.start(at);
    osc.stop(at + attack + decay + 0.02);
    return osc;
  }

  // 잡음을 필터에 통과시킨다. 전기·바람·발소리가 전부 여기서 나온다.
  hiss({ filter = 'bandpass', from, to, q = 1, peak = 0.3, attack = 0.005, decay = 0.2, at = this.now }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, at);
    if (to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(to, 20), at + attack + decay);

    src.connect(f);
    f.connect(this.env(peak, attack, decay, at));
    src.start(at);
    src.stop(at + attack + decay + 0.02);
    return src;
  }

  // ---------------------------------------------------------------- 효과음

  // 파일이 있으면 파일, 없으면 합성. 모든 효과음이 이 문을 지난다.
  cue(name, synth) {
    if (!this.ctx || this.muted) return;
    if (this.playFile(name)) return;
    synth();
  }

  jump() {
    this.cue('jump', () => {
      this.tone({ type: 'sine', from: 300, to: 640, peak: 0.28, attack: 0.008, decay: 0.11 });
      this.hiss({ filter: 'highpass', from: 900, to: 2600, peak: 0.05, decay: 0.09 });
    });
  }

  doubleJump() {
    this.cue('doubleJump', () => {
      this.tone({ type: 'triangle', from: 520, to: 1020, peak: 0.24, attack: 0.006, decay: 0.14 });
      // 공중제비 도는 바람 소리
      this.hiss({ filter: 'bandpass', from: 700, to: 2400, q: 2, peak: 0.09, decay: 0.22 });
    });
  }

  land() {
    this.cue('land', () => {
      this.tone({ type: 'sine', from: 170, to: 62, peak: 0.22, attack: 0.004, decay: 0.09 });
      this.hiss({ filter: 'lowpass', from: 1100, to: 300, peak: 0.1, decay: 0.07 });
    });
  }

  // 전기선 경고 — 낮게 차오르는 소리.
  //
  // 짧고 높은 소리를 빠른 어택으로 내면 '틱' 하고 튄다. 전기선은 자주
  // 나오니 그 소리가 계속 귀에 박힌다. 어택을 길게 늘려 튀는 부분을
  // 없애고, 음도 낮춰서 발밑에서 전기가 차오르는 느낌으로 바꿨다.
  warn() {
    this.cue('warn', () => {
      this.tone({ type: 'sine', from: 150, to: 320, peak: 0.09, attack: 0.09, decay: 0.22 });
      this.hiss({ filter: 'lowpass', from: 260, to: 900, q: 3, peak: 0.045, attack: 0.1, decay: 0.2 });
    });
  }

  // 전기선 발사 — 지지직
  zap() {
    this.cue('zap', () => {
      // 위험을 알리는 소리라 점프음보다 묻히면 안 된다
      this.hiss({ filter: 'bandpass', from: 3200, to: 700, q: 1.2, peak: 0.26, attack: 0.004, decay: 0.26 });
      this.tone({ type: 'square', from: 110, to: 70, peak: 0.1, attack: 0.004, decay: 0.16 });
    });
  }

  death() {
    this.cue('death', () => {
      const at = this.now;
      this.hiss({ filter: 'bandpass', from: 4200, to: 260, q: 0.8, peak: 0.34, attack: 0.003, decay: 0.5, at });
      this.tone({ type: 'sawtooth', from: 420, to: 55, peak: 0.22, attack: 0.006, decay: 0.6, at });
      // 잠깐 뒤에 한 번 더 튀는 잔전기
      this.hiss({ filter: 'highpass', from: 2000, to: 5000, peak: 0.1, decay: 0.18, at: at + 0.14 });
    });
  }

  fall() {
    this.cue('fall', () => {
      this.tone({ type: 'sine', from: 620, to: 90, peak: 0.24, attack: 0.01, decay: 0.75 });
    });
  }

  stageUp() {
    this.cue('stageUp', () => {
      const at = this.now;
      this.tone({ type: 'triangle', from: 660, peak: 0.18, attack: 0.01, decay: 0.28, at });
      this.tone({ type: 'triangle', from: 990, peak: 0.15, attack: 0.01, decay: 0.4, at: at + 0.11 });
    });
  }

  // ---------------------------------------------------------------- 환경음

  // 해질녘 풀숲 — 낮은 바람과 이따금 우는 풀벌레.
  // ambient / music 파일을 지정했으면 그걸 대신 반복 재생한다.
  startAmbient() {
    if (!this.ctx || this.ambient) return;

    const group = this.ctx.createGain();
    group.gain.value = 0;
    group.gain.setTargetAtTime(0.35, this.now, 1.5);
    group.connect(this.master);

    // 배경음악은 환경음과 별개다. 둘 다 넣으면 같이 흐른다.
    const music = this.playFile('music', { loop: true, target: group });

    // 환경음 파일이 있으면 바람·풀벌레 합성은 건너뛴다
    const file = this.playFile('ambient', { loop: true, target: group });
    if (file) {
      this.ambient = { group, wind: file, lfo: null, music, timer: null };
      return;
    }

    // 바람 — 잡음을 낮은 통과 필터에 넣고 아주 느리게 흔든다
    const wind = this.ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;

    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.06;

    // 세기를 느리게 오르내리게 하는 저주파 진동
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.035;
    lfo.connect(lfoDepth);
    lfoDepth.connect(windGain.gain);

    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(group);
    wind.start();
    lfo.start();

    // 풀벌레 — 불규칙한 간격으로 짧게 운다
    const chirp = () => {
      if (!this.ambient) return;
      if (!this.muted) {
        const at = this.now;
        const base = 2300 + Math.random() * 1400;
        for (let i = 0; i < 3; i++) {
          this.hiss({
            filter: 'bandpass', from: base, to: base * 0.92, q: 18,
            peak: 0.05, attack: 0.004, decay: 0.05, at: at + i * 0.085
          });
        }
      }
      this.ambient.timer = setTimeout(chirp, 1400 + Math.random() * 4200);
    };

    this.ambient = { group, wind, lfo, music, timer: null };
    this.ambient.timer = setTimeout(chirp, 900);
  }

  stopAmbient() {
    if (!this.ambient) return;
    const { group, wind, lfo, music, timer } = this.ambient;
    clearTimeout(timer);
    this.ambient = null;
    group.gain.setTargetAtTime(0, this.now, 0.4);
    // 페이드가 끝난 뒤에 정리한다
    setTimeout(() => {
      for (const node of [wind, lfo, music]) {
        try { node?.stop(); } catch { /* 이미 끝났으면 무시 */ }
      }
      try { group.disconnect(); } catch { /* 이미 끊겼으면 무시 */ }
    }, 1200);
  }
}
