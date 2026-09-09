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
    this.listening = null;      // 키를 기다리는 중이면 그 자리 번호

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
    this.listening = null;
    this.el.modal.classList.add('hidden');
  }

  #onKey(e) {
    if (!this.open$) return;
    if (this.listening === null) {
      if (e.code === 'Escape') { e.preventDefault(); this.close(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { this.listening = null; this.draw(); return; }
    if (MOVE_KEYS.has(e.code)) {
      this.warn = '이동에 쓰는 키예요';
      this.listening = null;
      this.draw();
      return;
    }
    const keys = [...settings.get('jumpKeys')];
    // 이미 다른 자리에 있는 키면 그 자리를 비운다 — 같은 키가 두 번 뜨면
    // 무엇을 지우는지 알 수 없다.
    const dup = keys.indexOf(e.code);
    if (dup >= 0 && dup !== this.listening) keys.splice(dup, 1);
    const at = Math.min(this.listening, keys.length);
    keys[at] = e.code;
    settings.set('jumpKeys', keys.filter(Boolean));
    this.listening = null;
    this.warn = '';
    this.draw();
  }

  draw() {
    const s = settings.all;
    const b = this.el.body;
    if (!b) return;
    const pct = (v) => Math.round(v * 100);
    const jumpRow = s.jumpKeys.map((k, i) => (
      `<button type="button" class="set-key${this.listening === i ? ' waiting' : ''}" data-slot="${i}">`
      + (this.listening === i ? '아무 키나…' : keyLabel(k)) + '</button>'
    )).join('');
    const canAdd = s.jumpKeys.length < 3;

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
          <button type="button" class="set-pick${s.musicPick === 'default' ? ' on' : ''}" data-pick="default">기본 곡</button>
          <button type="button" class="set-pick${s.musicPick === 'custom' ? ' on' : ''}" data-pick="custom">내 음악</button>
          <button type="button" class="set-pick${s.musicPick === 'off' ? ' on' : ''}" data-pick="off">끄기</button>
        </div>
        <div class="set-music">
          <button type="button" id="set-music-pick" class="set-file">파일 고르기</button>
          <span class="set-note" id="set-music-name">${
            this.h.audio?.userMusicName
              ? escapeHtml(this.h.audio.userMusicName)
              : '아직 넣은 곡이 없어요'}</span>
          ${this.h.audio?.userMusicName
            ? '<button type="button" id="set-music-clear" class="set-clear">지우기</button>' : ''}
        </div>
        <p class="set-hint">내 음악은 이 브라우저에만 저장되고 서버로 올라가지 않아요.
          다른 기기에서는 안 들립니다.</p>
      </section>

      <section class="set-sec">
        <h3>조작</h3>
        <div class="set-row">
          <span>점프</span>
          <div class="set-keys">${jumpRow}
            ${canAdd ? '<button type="button" class="set-key add" data-slot="' + s.jumpKeys.length + '">+ 추가</button>' : ''}
          </div>
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
        <p class="set-hint">감전 번쩍임과 발자국 효과를 끕니다.
          기기가 버거울 때나 번쩍임이 불편할 때 켜세요.</p>
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
        const pick = btn.dataset.pick;
        // 내 음악을 고르려는데 아직 파일이 없으면 바로 고르는 창을 연다.
        if (pick === 'custom' && !this.h.audio?.userMusicName) { this.#chooseFile(); return; }
        settings.set('musicPick', pick);
        this.h.audio?.applyVolumes();
        this.h.audio?.restartMusic?.();
        this.draw();
      });
    }
    $('set-music-pick')?.addEventListener('click', () => this.#chooseFile());
    $('set-music-clear')?.addEventListener('click', async () => {
      await this.h.audio?.clearUserMusic();
      if (settings.get('musicPick') === 'custom') settings.set('musicPick', 'default');
      this.h.audio?.restartMusic?.();
      this.draw();
    });

    for (const btn of b.querySelectorAll('.set-key')) {
      btn.addEventListener('click', () => {
        this.listening = Number(btn.dataset.slot);
        this.draw();
      });
    }

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
    inp.accept = 'audio/*';
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
      settings.set('musicPick', 'custom');
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
