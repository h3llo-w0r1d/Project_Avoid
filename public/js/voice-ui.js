// 점프할 때 낼 내 목소리를 녹음하는 칸. 타이틀 화면 아래에 있다.
//
// 목소리는 캐릭터마다 따로 두지 않는다. 하나를 녹음해 두면 어떤 캐릭터로
// 뛰든 그 소리가 난다.

import { recorder } from './recorder.js';

const $ = (id) => document.getElementById(id);

export class VoiceUI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      panel: $('voice-panel'),
      mic: $('voice-record'),
      extra: $('voice-extra'),
      play: $('voice-play'),
      erase: $('voice-erase'),
      state: $('voice-state')
    };
    this.taking = null;      // 녹음 중이면 { stop, done }

    this.el.mic.addEventListener('click', () => this.toggle());
    this.el.play.addEventListener('click', () => this.h.onPlay());
    this.el.erase.addEventListener('click', async () => {
      await this.h.onErase();
      this.draw();
    });

    this.draw();
  }

  async toggle() {
    if (this.taking) {           // 녹음 중이면 여기서 끝낸다
      this.taking.stop();
      return;
    }

    if (!recorder.supported()) {
      this.say(recorder.unsupportedReason(), true);
      return;
    }

    let take;
    try {
      take = await recorder.start();
    } catch (err) {
      // 대부분 사용자가 마이크 권한을 거절한 경우다
      const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
      this.say(denied ? '마이크 사용을 허용해 주세요' : `마이크를 열지 못했습니다: ${err.message}`, true);
      return;
    }

    this.taking = take;
    this.el.mic.textContent = '⏹ 멈추기';
    this.el.mic.classList.add('recording');
    this.say('녹음 중…');

    const blob = await take.done;
    this.taking = null;
    this.el.mic.classList.remove('recording');

    const result = await this.h.onRecorded(blob);
    this.draw();
    if (!result.ok) this.say(result.reason, true);
    else this.say(`저장했습니다 · ${result.seconds.toFixed(2)}초`);
  }

  say(text, isError = false) {
    this.el.state.textContent = text;
    this.el.state.classList.toggle('error', isError);
  }

  draw() {
    const has = this.h.hasVoice();
    this.el.mic.textContent = has ? '🎤 다시 녹음' : '🎤 녹음';
    this.el.extra.classList.toggle('hidden', !has);
    if (!has) this.say('점프할 때 낼 내 목소리');
  }

  // 게임에 들어가면 녹음을 멈춘다. 마이크가 켜진 채로 남으면 안 된다.
  stop() {
    this.taking?.stop();
  }
}
