// 캐릭터 고르기 화면.
//
// 미리보기 그림은 실제 캐릭터를 작은 렌더러로 한 번 찍어서 쓴다.
// 그림 파일을 따로 두지 않아도 되고, 캐릭터를 고치면 미리보기도 같이 바뀐다.

import * as THREE from 'three';
import { PLAYABLE, isUnlocked, isCoinChar, isRouletteChar, findCharacter } from './characters.js';
import { buildFallbackAvatar } from './avatar.js';

const $ = (id) => document.getElementById(id);
const SIZE = 132;

// 캐릭터 하나를 정면에서 찍어 data URL 로 돌려준다.
// 렌더러를 매번 만들지 않고 하나를 돌려 쓴다. WebGL 컨텍스트는
// 브라우저마다 개수 제한이 있어서 캐릭터 수만큼 만들면 위험하다.
let shot = null;

function snapshot(characterId) {
  if (!shot) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setPixelRatio(2);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.1);
    key.position.set(2, 5, 4);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    shot = { renderer, scene, camera, holder: new THREE.Group() };
    scene.add(shot.holder);
  }

  // 이전 캐릭터를 치우고 새로 얹는다
  shot.holder.clear();
  const skin = buildFallbackAvatar({ characterId });
  shot.holder.add(skin);

  // 캐릭터마다 키가 달라서, 화면에 꽉 차게 카메라를 맞춘다
  const box = new THREE.Box3().setFromObject(skin);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const reach = Math.max(size.x, size.y) * 0.62;
  // 잎이 긴 캐릭터는 키에 맞추느라 뒤로 빠져 작아 보인다. previewZoom 으로
  // 그런 캐릭터만 카메라를 조금 당겨 카드에 크게 담는다 (판정과는 무관).
  const zoom = findCharacter(characterId).previewZoom ?? 1;
  const dist = reach / Math.tan(THREE.MathUtils.degToRad(15)) / zoom;

  shot.camera.position.set(0, center.y, dist);
  shot.camera.lookAt(0, center.y, 0);
  shot.renderer.render(shot.scene, shot.camera);

  return shot.renderer.domElement.toDataURL('image/png');
}

export class CharacterUI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      modal: $('char-modal'),
      grid: $('char-grid'),
      hint: $('char-hint'),
      btn: $('char-btn')
    };
    this.previews = new Map();

    this.el.btn.addEventListener('click', () => this.open());
    // 첫 그림은 미리 그려 둔다. 창을 한 번도 안 열어도 버튼에 보여야 한다.
    requestAnimationFrame(() => this.paintButton(handlers.selected()));
    $('char-close').addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });
  }

  get open$() { return !this.el.modal.classList.contains('hidden'); }

  open() {
    this.el.modal.classList.remove('hidden');
    this.draw();
  }

  close() {
    this.el.modal.classList.add('hidden');
  }

  // 게임 중에는 못 열게 한다. 게임이 멈추지 않아 그냥 죽는다.
  setAvailable(available) {
    this.el.btn.classList.toggle('hidden', !available);
    if (!available) this.close();
  }

  preview(id) {
    if (!this.previews.has(id)) this.previews.set(id, snapshot(id));
    return this.previews.get(id);
  }

  // 버튼에 지금 쓰는 캐릭터를 얹는다. 이모지보다 "내 캐릭터를 고르는
  // 곳"이라는 게 분명하고, 무엇을 쓰고 있는지도 한눈에 보인다.
  paintButton(id) {
    this.el.btn.style.backgroundImage = `url(${this.preview(id)})`;
    this.el.btn.classList.add('has-face');
  }

  draw() {
    const best = this.h.bestSeconds();
    const chosen = this.h.selected();
    // 게스트는 기본 캐릭터만. 해금은 로그인해야 된다(canUse 가 그걸 반영).
    const signedIn = this.h.signedIn ? this.h.signedIn() : true;
    const usable = (c) => (this.h.canUse ? this.h.canUse(c) : isUnlocked(c, best));
    const locked = PLAYABLE.filter((c) => !usable(c));

    // 코인 잔액도 같이 보여 준다(코인 상점 캐릭터가 있으니).
    const coins = this.h.coins ? this.h.coins() : 0;
    const coinTag = ` · 🪙 ${coins} 보유`;
    this.el.hint.textContent = (!signedIn
      ? '🔒 로그인하면 캐릭터를 해금할 수 있어요'
      : (locked.length
          ? `기록을 세우면 하나씩 열립니다 · 내 최고 ${best.toFixed(1)}초`
          : `내 최고 ${best.toFixed(1)}초`)) + coinTag;

    this.el.grid.innerHTML = '';
    for (const c of PLAYABLE) {
      const unlocked = usable(c);
      // 코인으로 사는(아직 안 산) 캐릭터인가 — 상점 카드로 공개한다.
      const shop = !unlocked && isCoinChar(c);
      const affordable = shop && coins >= c.coinCost;
      // 룰렛 전용(아직 못 얻음) — 모습은 공개하되 살 수는 없다.
      const roul = !unlocked && isRouletteChar(c);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'char-card';
      card.classList.toggle('locked', !unlocked && !shop && !roul);
      card.classList.toggle('shop', shop || roul);
      card.classList.toggle('chosen', c.id === chosen);
      // 잠긴 캐릭터는 못 누른다. 상점 카드는 코인이 충분할 때만. 룰렛 전용은 못 누른다.
      card.disabled = shop ? !affordable : (roul ? true : !unlocked);

      if (unlocked) {
        const img = document.createElement('img');
        img.src = this.preview(c.id);
        img.alt = c.name;
        card.appendChild(img);

        const name = document.createElement('span');
        name.className = 'char-name';
        name.textContent = c.name;
        card.appendChild(name);

        const note = document.createElement('span');
        note.className = 'char-note';
        note.textContent = c.id === chosen ? '사용 중' : '';
        card.appendChild(note);
      } else if (shop) {
        // 코인 상점 캐릭터: 모습·이름을 공개하고 가격표를 붙인다. 코인이
        // 충분하면 눌러서 바로 산다(사면 자동으로 사용 캐릭터가 된다).
        const img = document.createElement('img');
        img.src = this.preview(c.id);
        img.alt = c.name;
        card.appendChild(img);

        const name = document.createElement('span');
        name.className = 'char-name';
        name.textContent = c.name;
        card.appendChild(name);

        const price = document.createElement('span');
        price.className = 'char-note price';
        price.textContent = affordable ? `🪙 ${c.coinCost} 해금` : `🪙 ${c.coinCost} 필요`;
        card.appendChild(price);
      } else if (roul) {
        // 룰렛 전용: 모습·이름을 공개하고 '룰렛에서만' 이라고 알린다(구매 불가).
        const img = document.createElement('img');
        img.src = this.preview(c.id);
        img.alt = c.name;
        card.appendChild(img);

        const name = document.createElement('span');
        name.className = 'char-name';
        name.textContent = c.name;
        card.appendChild(name);

        const note = document.createElement('span');
        note.className = 'char-note price';
        note.textContent = '🎰 룰렛 전용';
        card.appendChild(note);
      } else {
        // 잠긴 캐릭터는 모습도 이름도 숨긴다. "???" 와 해금 조건만 보여
        // 궁금증을 남긴다. (preview 를 부르지 않아 렌더로도 새어 나가지 않는다.)
        const mystery = document.createElement('div');
        mystery.className = 'char-mystery';
        mystery.textContent = '?';
        card.appendChild(mystery);

        const name = document.createElement('span');
        name.className = 'char-name mystery';
        name.textContent = '???';
        card.appendChild(name);

        const note = document.createElement('span');
        note.className = 'char-note goal';
        // 게스트에게는 "로그인 후 해금", 로그인 유저에게는 "N초 달성 시".
        note.textContent = (!signedIn && c.unlockAt > 0) ? '로그인 후 해금' : `${c.unlockAt}초 달성 시`;
        card.appendChild(note);

        const lock = document.createElement('span');
        lock.className = 'char-lock';
        lock.textContent = '🔒';
        card.appendChild(lock);
      }

      card.addEventListener('click', async () => {
        if (unlocked) { this.h.onSelect(c.id); this.draw(); return; }
        // 상점 카드: 한 번 더 확인한 뒤 코인으로 사고(성공하면) 바로 쓴다.
        if (shop && affordable) {
          const ok = await this.confirmBuy(c);
          if (ok && this.h.buy?.(c)) {
            this.h.onSelect(c.id);
            this.draw();
          }
        }
      });

      this.el.grid.appendChild(card);
    }
  }

  // 코인으로 살 때 한 번 더 묻는 확인창(화면 가운데). 확인=true, 취소=false.
  confirmBuy(spec) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal buy-confirm';
      overlay.innerHTML = `
        <div class="modal-card panel">
          <div class="buy-ico">🪙</div>
          <p class="buy-msg"><b>${spec.name}</b> 을(를)<br><b class="buy-cost">${spec.coinCost} 코인</b> 으로 구매할까요?</p>
          <div class="buy-row">
            <button type="button" class="ghost small buy-cancel">취소</button>
            <button type="button" class="primary small buy-ok">확인</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.buy-ok').addEventListener('click', () => done(true));
      overlay.querySelector('.buy-cancel').addEventListener('click', () => done(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    });
  }
}
