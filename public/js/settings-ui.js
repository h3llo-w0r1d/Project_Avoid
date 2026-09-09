// 설정 창. 값을 보관하는 건 settings.js 가 하고, 여기서는 그리기와
// 사용자 입력만 다룬다.
//
// 소리 크기는 끄는 동안(input) 곧바로 반영한다 — 슬라이더를 놓고 나서야
// 소리가 바뀌면 어느 지점이 맞는지 가늠할 수가 없다.

import { settings, DEFAULTS } from './settings.js';

const $ = (id) => document.getElementById(id);

// 키 코드를 사람이 읽을 이름으로. 자주 쓰는 것만 적고 나머지는 코드 그대로.
const KEY_NAME = {
  Space: 'Space', Enter: 'Enter', ShiftLeft: '← Shift', ShiftRight: 'Shift →',
  ControlLeft: '← Ctrl', ControlRight: 'Ctrl →', AltLeft: '← Alt', AltRight: 'Alt →',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Tab: 'Tab', Backspace: 'Backspace', Escape: 'Esc'
};
function keyLabel(code) {
  if (KEY_NAME[code]) return KEY_NAME[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '숫자판 ' + code.slice(6);
  return code;
}

// 이동에 쓰는 키는 점프로 못 준다. 겹치면 걷다가 뛰어 버린다.
const MOVE_KEYS = new Set([
  'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'
]);

export class SettingsUI {
  // hooks: { audio, onEffects }
  constructor(hooks) {
    this.h = hooks;
    this.el = { modal: $('settings-modal'), body: $('settings-body'), btn: $('settings-btn') };
    if (!this.el.modal) return;
    this.listening = false;    // 키 입력을 기다리는 중인가

    this.el.btn?.addEventListener('click', () => this.open());
    $('settings-close')?.addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });
    // 키 다시 잡기 — 창이 열려 있고 기다리는 중일 때만 가로챈다.
    addEventListener('keydown', (e) => this.#onKey(e), true);
  }

  get open$() { return this.el.modal && !this.el.modal.classList.contains('hidden'); }

  open() { this.el.modal.classList.remove('hidden'); this.draw(); }
  close() {
    this.listening = false;
    this.el.modal.classList.add('hidden');
  }

  #onKey(e) {
    if (!this.open$) return;
    if (!this.listening) {
      if (e.code === 'Escape') { e.preventDefault(); this.close(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.listening = false;
    if (e.code === 'Escape') { this.draw(); return; }
    if (MOVE_KEYS.has(e.code)) {
      this.warn = '이동에 쓰는 키예요';
      this.draw();
      return;
    }
    settings.set('jumpKeys', [e.code]);
    this.warn = '';
    this.draw();
  }

  draw() {
    const s = settings.all;
    const b = this.el.body;
    if (!b) return;
    const pct = (v) => Math.round(v * 100);
    // 점프 키는 하나만 둔다. 여러 개면 무엇이 눌리는지 헷갈리기만 한다.
    const jumpKey = `<button type="button" class="set-key${this.listening ? ' waiting' : ''}" data-jump>`
      + (this.listening ? '아무 키나…' : keyLabel(s.jumpKeys[0])) + '</button>';

    b.innerHTML = `
      <section class="set-sec">
        <h3>소리</h3>
        <label class="set-row">
          <span>배경음</span>
          <input type="range" min="0" max="100" value="${pct(s.musicVolume)}" data-vol="musicVolume">
          <b>${pct(s.musicVolume)}%</b>
        </label>
        <label class="set-row">
          <span>효과음</span>
          <input type="range" min="0" max="100" value="${pct(s.sfxVolume)}" data-vol="sfxVolume">
          <b>${pct(s.sfxVolume)}%</b>
        </label>
      </section>

      <section class="set-sec">
        <h3>배경음악</h3>
        <div class="set-picks">
          <button type="button" class="set-pick${s.musicOn ? ' on' : ''}" data-act="toggle">
            ${s.musicOn ? '켜짐' : '꺼짐'}</button>
          <button type="button" class="set-pick${s.musicSource === 'custom' ? ' on' : ''}" data-act="mine">
            내 음악</button>
        </div>
        <div class="set-music">
          <span class="set-note">${
            this.h.audio?.userMusicName
              ? (s.musicSource === 'custom' ? '▶ ' : '') + escapeHtml(this.h.audio.userMusicName)
              : '「내 음악」 을 누르면 파일을 고릅니다'}</span>
          ${this.h.audio?.userMusicName
            ? '<button type="button" id="set-music-clear" class="set-clear">지우고 기본 곡으로</button>' : ''}
        </div>
        <p class="set-hint">mp3 · m4a · wav · ogg · flac 을 넣을 수 있어요.
          이 브라우저에만 저장되고 서버로 올라가지 않아요.</p>
      </section>

      <section class="set-sec">
        <h3>조작</h3>
        <div class="set-row">
          <span>점프</span>
          <div class="set-keys">${jumpKey}</div>
        </div>
        <p class="set-hint">${this.warn ? '<b class="set-warn">' + this.warn + '</b> · ' : ''}키를 눌러 바꿉니다.
          이동(WASD·화살표)은 고정입니다.</p>
      </section>

      <section class="set-sec">
        <h3>화면</h3>
        <label class="set-row set-check">
          <input type="checkbox" data-flag="lowEffects"${s.lowEffects ? ' checked' : ''}>
          <span>화면 효과 줄이기</span>
        </label>
        <p class="set-hint">감전 번쩍임과 발자국 효과를 끕니다. (렉 걸림 감소)</p>
      </section>

      <button type="button" id="set-reset" class="ghost small">모두 기본값으로</button>
    `;
    this.warn = '';
    this.#bind();
  }

  #bind() {
    const b = this.el.body;

    for (const r of b.querySelectorAll('input[data-vol]')) {
      const key = r.dataset.vol;
      r.addEventListener('input', () => {
        const v = Number(r.value) / 100;
        settings.set(key, v);
        r.parentElement.querySelector('b').textContent = Math.round(v * 100) + '%';
        this.h.audio?.applyVolumes();
      });
    }

    for (const btn of b.querySelectorAll('.set-pick')) {
      btn.addEventListener('click', async () => {
        if (btn.dataset.act === 'toggle') {
          settings.set('musicOn', !settings.get('musicOn'));
          this.h.audio?.applyVolumes();
        } else {
          // 「내 음악」 — 넣어 둔 곡이 있으면 그걸로 바꾸고, 없으면 고르는 창을 연다.
          if (!this.h.audio?.userMusicName) { this.#chooseFile(); return; }
          settings.set('musicSource',
            settings.get('musicSource') === 'custom' ? 'default' : 'custom');
          this.h.audio?.restartMusic?.();
        }
        this.draw();
      });
    }
    $('set-music-clear')?.addEventListener('click', async () => {
      await this.h.audio?.clearUserMusic();
      settings.set('musicSource', 'default');
      this.h.audio?.restartMusic?.();
      this.draw();
    });
    b.querySelector('.set-key')?.addEventListener('click', () => {
      this.listening = true;
      this.draw();
    });

    for (const c of b.querySelectorAll('input[data-flag]')) {
      c.addEventListener('change', () => {
        settings.set(c.dataset.flag, c.checked);
        this.h.onEffects?.(c.checked);
      });
    }

    $('set-reset')?.addEventListener('click', () => {
      settings.reset();
      this.h.audio?.applyVolumes();
      this.h.audio?.restartMusic?.();
      this.h.onEffects?.(DEFAULTS.lowEffects);
      this.draw();
    });
  }

  #chooseFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    // audio/* 만 주면 기기에 따라 mp3 가 목록에 안 뜨는 일이 있어,
    // 확장자도 같이 적어 둔다.
    inp.accept = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const nameEl = $('set-music-name');
      if (nameEl) nameEl.textContent = '읽는 중…';
      const ok = await this.h.audio?.setUserMusic(f);
      if (!ok) {
        if (nameEl) nameEl.textContent = '이 파일은 읽지 못했어요 (mp3·m4a·ogg·wav)';
        return;
      }
      settings.set('musicSource', 'custom');
      settings.set('musicOn', true);          // 꺼 뒀더라도 넣었으면 들려 준다
      this.h.audio?.applyVolumes();
      this.h.audio?.restartMusic?.();
      this.draw();
    });
    inp.click();
  }
}

function escapeHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
