// 설정 창. 값을 보관하는 건 settings.js 가 하고, 여기서는 그리기와
// 사용자 입력만 다룬다.
//
// 소리 크기는 끄는 동안(input) 곧바로 반영한다 — 슬라이더를 놓고 나서야
// 소리가 바뀌면 어느 지점이 맞는지 가늠할 수가 없다.

import { settings, DEFAULTS } from './settings.js';
import { t, getLangPref, setLang } from './i18n.js';

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
  if (code.startsWith('Numpad')) return t('settings.numpad') + ' ' + code.slice(6);
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
      this.warn = t('settings.moveKeyWarn');
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
    // 배경음악을 꺼 두면 배경음 칸은 0 을 가리키고 손대지 못하게 한다.
    // 소리는 이미 안 나는데 40% 라고 적혀 있으면 어느 쪽이 맞는지 알 수가
    // 없다. 저장값(musicVolume)은 건드리지 않아서 다시 켜면 그대로 돌아온다.
    const musicPct = s.musicOn ? pct(s.musicVolume) : 0;
    // 점프 키는 하나만 둔다. 여러 개면 무엇이 눌리는지 헷갈리기만 한다.
    const jumpKey = `<button type="button" class="set-key${this.listening ? ' waiting' : ''}" data-jump>`
      + (this.listening ? t('settings.pressKey') : keyLabel(s.jumpKeys[0])) + '</button>';
    const langPref = getLangPref();

    b.innerHTML = `
      <section class="set-sec">
        <h3>${t('settings.lang')}</h3>
        <div class="set-picks">
          <button type="button" class="set-pick${langPref === 'auto' ? ' on' : ''}" data-lang="auto">${t('settings.langAuto')}</button>
          <button type="button" class="set-pick${langPref === 'ko' ? ' on' : ''}" data-lang="ko">${t('settings.langKo')}</button>
          <button type="button" class="set-pick${langPref === 'en' ? ' on' : ''}" data-lang="en">${t('settings.langEn')}</button>
        </div>
      </section>

      <section class="set-sec">
        <h3>${t('settings.sound')}</h3>
        <label class="set-row${s.musicOn ? '' : ' off'}">
          <span>${t('settings.music')}</span>
          <input type="range" min="0" max="100" value="${musicPct}" data-vol="musicVolume"
            ${s.musicOn ? '' : 'disabled'}>
          <b>${musicPct}%</b>
        </label>
        <label class="set-row">
          <span>${t('settings.sfx')}</span>
          <input type="range" min="0" max="100" value="${pct(s.sfxVolume)}" data-vol="sfxVolume">
          <b>${pct(s.sfxVolume)}%</b>
        </label>
      </section>

      <section class="set-sec">
        <h3>${t('settings.bgm')}</h3>
        <div class="set-picks">
          <button type="button" class="set-pick${s.musicOn ? ' on' : ''}" data-act="toggle">
            ${s.musicOn ? t('common.on') : t('common.off')}</button>
          <button type="button" class="set-pick${s.musicSource === 'custom' ? ' on' : ''}" data-act="mine">
            ${t('settings.myMusic')}</button>
        </div>
        ${this.h.audio?.userMusicName ? `
        <div class="set-music">
          <span class="set-note">${(s.musicSource === 'custom' ? '▶ ' : '')
            + escapeHtml(this.h.audio.userMusicName)}</span>
          <button type="button" id="set-music-clear" class="set-clear">${t('settings.clearMusic')}</button>
        </div>` : `
        <p class="set-hint">${t('settings.myMusicHint')}</p>`}
      </section>

      <section class="set-sec">
        <h3>${t('settings.controls')}</h3>
        <div class="set-row">
          <span>${t('settings.jump')}</span>
          <div class="set-keys">${jumpKey}</div>
        </div>
        <p class="set-hint">${this.warn ? '<b class="set-warn">' + this.warn + '</b> · ' : ''}${t('settings.pressToChange')}
          ${t('settings.moveFixedHint')}</p>
      </section>

      <section class="set-sec">
        <h3>${t('settings.screen')}</h3>
        <label class="set-row set-check">
          <input type="checkbox" data-flag="lowEffects"${s.lowEffects ? ' checked' : ''}>
          <span>${t('settings.lowEffects')}</span>
        </label>
        <p class="set-hint">${t('settings.lowEffectsHint')}</p>
      </section>

      <button type="button" id="set-reset" class="ghost small">${t('settings.resetAll')}</button>
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

    for (const btn of b.querySelectorAll('.set-pick[data-lang]')) {
      btn.addEventListener('click', () => {
        setLang(btn.dataset.lang);
        this.draw();
      });
    }

    for (const btn of b.querySelectorAll('.set-pick[data-act]')) {
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
      if (nameEl) nameEl.textContent = t('settings.loadingFile');
      const ok = await this.h.audio?.setUserMusic(f);
      if (!ok) {
        if (nameEl) nameEl.textContent = t('settings.fileError');
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
