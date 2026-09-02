// 상점 — 코인으로 사는 꾸미기.
//
// 지금은 발자국 효과만 판다. 판정에는 전혀 영향이 없다(그래야 산 사람이
// 유리해지지 않는다). 캐릭터와 달리 한 번에 하나만 켠다.
//
// 코인은 브라우저에 있다(wallet). 서버에는 '누가 뭘 샀다' 만 남긴다 —
// 캐릭터 구매와 같은 방식이라 관리 화면에서 함께 볼 수 있다.

import { TRAILS, findTrail } from './effects.js';
import { wallet } from './wallet.js';

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 효과마다 카드에 보여 줄 미리보기 색. effects.js 의 colors 를 그대로 쓴다.
const swatch = (spec) => spec.rainbow
  ? 'linear-gradient(90deg,#ff5f6d,#ffc371,#7ee8a2,#48c6ef,#b18cff)'
  : `linear-gradient(90deg,${spec.colors.map((c) => '#' + c.toString(16).padStart(6, '0')).join(',')})`;

export class ShopUI {
  constructor() {
    this.overlay = null;
    this.onBuy = null;      // (spec) => boolean — 코인을 깎고 소유 처리
    this.onEquip = null;    // (id|null) => void — 효과를 켜고 끈다
    this.isAdmin = () => false;
  }

  open() {
    if (this.overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-card panel shop-card">
        <div class="modal-head">
          <h2>상점</h2>
          <span class="shop-coins"></span>
          <button type="button" class="icon-btn shop-close" aria-label="닫기">✕</button>
        </div>
        <p class="board-hint">움직일 때 발밑에 남는 효과예요 · 한 번에 하나만 켤 수 있어요</p>
        <div class="shop-grid"></div>
      </div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const close = () => this.close();
    overlay.querySelector('.shop-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    this.paint();
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }

  paint() {
    if (!this.overlay) return;
    const admin = this.isAdmin();
    const coins = wallet.coins();
    const equipped = wallet.equippedFx();

    this.overlay.querySelector('.shop-coins').innerHTML =
      admin ? '<b>🪙 ∞</b>' : `<b>🪙 ${coins.toLocaleString('ko-KR')}</b>`;

    const grid = this.overlay.querySelector('.shop-grid');
    grid.innerHTML = '';

    // '끄기' 칸을 맨 앞에 둔다. 켠 걸 되돌릴 길이 없으면 답답하다.
    grid.appendChild(this.#card({
      id: null, name: '사용 안 함', desc: '발자국 효과를 끕니다',
      plain: true
    }, { owned: true, on: !equipped, afford: true }));

    for (const spec of TRAILS) {
      const owned = admin || wallet.isFxOwned(spec.id);
      grid.appendChild(this.#card(spec, {
        owned,
        on: equipped === spec.id,
        afford: admin || coins >= spec.cost
      }));
    }
  }

  #card(spec, { owned, on, afford }) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'shop-item';
    el.classList.toggle('owned', owned);
    el.classList.toggle('on', on);
    el.classList.toggle('locked', !owned);

    const bar = spec.plain
      ? '<span class="shop-swatch none">✕</span>'
      : `<span class="shop-swatch" style="background:${swatch(spec)}"></span>`;

    const foot = spec.plain
      ? (on ? '<span class="shop-state">사용 중</span>' : '<span class="shop-state dim">누르면 끕니다</span>')
      : owned
        ? (on ? '<span class="shop-state">사용 중</span>' : '<span class="shop-state">누르면 사용</span>')
        : `<span class="shop-cost${afford ? '' : ' short'}">🪙 ${spec.cost}${afford ? '' : ' 필요'}</span>`;

    el.innerHTML = `
      ${bar}
      <span class="shop-name">${esc(spec.name)}</span>
      <span class="shop-desc">${esc(spec.desc)}</span>
      ${foot}`;

    el.addEventListener('click', () => this.#tap(spec, owned, on));
    return el;
  }

  #tap(spec, owned, on) {
    if (spec.plain) { this.onEquip?.(null); this.paint(); return; }
    if (owned) {
      // 이미 켠 걸 다시 누르면 끈다 — 껐다 켜기가 한 손가락으로 된다.
      this.onEquip?.(on ? null : spec.id);
      this.paint();
      return;
    }
    this.#confirmBuy(spec);
  }

  #confirmBuy(spec) {
    const ask = document.createElement('div');
    ask.className = 'modal';
    ask.style.zIndex = '70';
    ask.innerHTML = `
      <div class="modal-card panel buy-card">
        <p class="buy-msg"><b>${esc(spec.name)}</b> 을(를)<br>
          <b class="buy-cost">${spec.cost} 코인</b> 으로 구매할까요?</p>
        <p class="buy-note">${esc(spec.desc)}</p>
        <div class="buy-actions">
          <button type="button" class="ghost small buy-no">취소</button>
          <button type="button" class="buy-yes">구매</button>
        </div>
      </div>`;
    document.body.appendChild(ask);
    const bye = () => ask.remove();
    ask.querySelector('.buy-no').addEventListener('click', bye);
    ask.addEventListener('click', (e) => { if (e.target === ask) bye(); });
    ask.querySelector('.buy-yes').addEventListener('click', () => {
      const ok = this.onBuy?.(spec);
      bye();
      if (ok) {
        this.onEquip?.(spec.id);      // 산 즉시 켜 준다
        this.paint();
        this.#cheer(spec);
      } else {
        this.#toast('코인이 모자랍니다');
      }
    });
  }

  // 샀을 때 잠깐 뜨는 축하. 캐릭터 해금 연출을 작게 줄인 것.
  #cheer(spec) {
    this.#toast(`「${spec.name}」 구매 완료! 바로 켰어요`);
  }

  #toast(text) {
    const t = document.createElement('div');
    t.className = 'shop-toast';
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 240);
    }, 1900);
  }
}

export { findTrail };
