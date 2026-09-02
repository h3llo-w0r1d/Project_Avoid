// 상점 — 코인으로 사는 꾸미기.
//
// 항목(발자국 효과·발밑 링…)을 위쪽 탭으로 나눠 둔다. 파는 게 늘어날 때
// 창을 새로 만들지 않고 CATEGORIES 에 한 줄만 더하면 되게 했다.
//
// 어느 항목이든 규칙은 같다: 산 것만 켤 수 있고, 한 번에 하나만 켠다.
// 판정에는 전혀 영향이 없다(그래야 산 사람이 유리해지지 않는다).
//
// 코인은 브라우저에 있다(wallet). 서버에는 '누가 뭘 샀다' 만 남긴다 —
// 캐릭터 구매와 같은 방식이라 관리 화면에서 함께 볼 수 있다.

import { TRAILS, RINGS, DEFAULT_RING } from './effects.js';
import { wallet } from './wallet.js';

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// 파는 항목들. kind 는 wallet 이 '산 목록/켠 것' 을 담는 칸 이름이기도 하다.
//
//  allowNone : '사용 안 함' 칸을 맨 앞에 둘지. 링처럼 늘 하나는 켜져 있어야
//              하는 항목은 false 로 두고, 대신 공짜 기본값을 하나 넣는다.
//  free      : 살 필요 없이 처음부터 쓸 수 있는 id
//  swatch    : 카드 위 색 미리보기. 사기 전에 무슨 색인지 보여 준다.
export const CATEGORIES = [
  {
    id: 'trail', kind: 'trail', name: '발자국 효과',
    hint: '움직일 때 발밑에 남는 효과예요 · 한 번에 하나만 켤 수 있어요',
    allowNone: true,
    items: TRAILS,
    swatch: (s) => s.rainbow
      ? 'linear-gradient(90deg,#ff5f6d,#ffc371,#7ee8a2,#48c6ef,#b18cff)'
      : `linear-gradient(90deg,${s.colors.map(hex).join(',')})`
  },
  {
    id: 'ring', kind: 'ring', name: '발밑 링',
    hint: '캐릭터 발밑에서 빛나는 링의 색이에요 · 어두운 무대에서 늘 보여요',
    allowNone: false,
    free: DEFAULT_RING,
    items: RINGS,
    // 링이니까 미리보기도 링 모양으로 — 색만 칠한 막대보다 뭘 사는지 분명하다.
    swatch: (s) => `radial-gradient(circle at 50% 50%, transparent 34%, ${hex(s.color)} 38%, ${hex(s.color)} 52%, transparent 56%)`
  }
];

export class ShopUI {
  constructor() {
    this.overlay = null;
    this.tab = CATEGORIES[0].id;
    this.onBuy = null;      // (item, category) => boolean — 코인을 깎고 소유 처리
    this.onEquip = null;    // (kind, id|null) => void — 켜고 끈다
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
        <nav class="shop-tabs">
          ${CATEGORIES.map((c) =>
            `<button type="button" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
        </nav>
        <p class="board-hint shop-hint"></p>
        <div class="shop-grid"></div>
      </div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const close = () => this.close();
    overlay.querySelector('.shop-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    for (const b of overlay.querySelectorAll('.shop-tabs button')) {
      b.addEventListener('click', () => { this.tab = b.dataset.cat; this.paint(); });
    }
    this.paint();
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }

  // 이 항목에서 이 물건을 가지고 있나. 공짜 기본값과 관리자는 늘 가진 것으로 본다.
  #owns(cat, item) {
    return this.isAdmin() || item.cost === 0 || item.id === cat.free
      || wallet.isOwnedIn(cat.kind, item.id);
  }

  // 이 항목에서 지금 켜 둔 것. 아무것도 안 켰으면 공짜 기본값으로 친다.
  #current(cat) {
    return wallet.equippedIn(cat.kind) ?? cat.free ?? null;
  }

  paint() {
    if (!this.overlay) return;
    const cat = CATEGORIES.find((c) => c.id === this.tab) ?? CATEGORIES[0];
    const admin = this.isAdmin();
    const coins = wallet.coins();
    const on = this.#current(cat);

    this.overlay.querySelector('.shop-coins').innerHTML =
      admin ? '<b>🪙 ∞</b>' : `<b>🪙 ${coins.toLocaleString('ko-KR')}</b>`;
    this.overlay.querySelector('.shop-hint').textContent = cat.hint;
    for (const b of this.overlay.querySelectorAll('.shop-tabs button')) {
      b.classList.toggle('current', b.dataset.cat === cat.id);
    }

    const grid = this.overlay.querySelector('.shop-grid');
    grid.innerHTML = '';

    // 끌 수 있는 항목은 '사용 안 함' 칸을 맨 앞에. 켠 걸 되돌릴 길이
    // 없으면 답답하다.
    if (cat.allowNone) {
      grid.appendChild(this.#card(cat, { id: null, name: '사용 안 함', desc: '이 효과를 끕니다', plain: true },
        { owned: true, on: !on, afford: true }));
    }

    for (const item of cat.items) {
      const owned = this.#owns(cat, item);
      grid.appendChild(this.#card(cat, item, {
        owned, on: on === item.id, afford: admin || coins >= item.cost
      }));
    }
  }

  #card(cat, item, { owned, on, afford }) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'shop-item';
    el.classList.toggle('owned', owned);
    el.classList.toggle('on', on);
    el.classList.toggle('locked', !owned);

    const bar = item.plain
      ? '<span class="shop-swatch none">✕</span>'
      : `<span class="shop-swatch" style="background:${cat.swatch(item)}"></span>`;

    const foot = on
      ? '<span class="shop-state">사용 중</span>'
      : owned
        ? (item.plain
          ? '<span class="shop-state dim">누르면 끕니다</span>'
          : '<span class="shop-state">누르면 사용</span>')
        : `<span class="shop-cost${afford ? '' : ' short'}">🪙 ${item.cost}${afford ? '' : ' 필요'}</span>`;

    el.innerHTML = `
      ${bar}
      <span class="shop-name">${esc(item.name)}</span>
      <span class="shop-desc">${esc(item.desc ?? '')}</span>
      ${foot}`;

    el.addEventListener('click', () => this.#tap(cat, item, owned, on));
    return el;
  }

  #tap(cat, item, owned, on) {
    if (item.plain) { this.onEquip?.(cat.kind, null); this.paint(); return; }
    if (owned) {
      // 끌 수 있는 항목이면, 켠 걸 다시 눌러 끈다. 링처럼 늘 하나는 켜져
      // 있어야 하는 항목은 다시 눌러도 그대로 둔다.
      const next = (on && cat.allowNone) ? null : item.id;
      this.onEquip?.(cat.kind, next);
      this.paint();
      return;
    }
    this.#confirmBuy(cat, item);
  }

  #confirmBuy(cat, item) {
    const ask = document.createElement('div');
    ask.className = 'modal';
    ask.style.zIndex = '70';
    ask.innerHTML = `
      <div class="modal-card panel buy-card">
        <p class="buy-msg"><b>${esc(item.name)}</b> 을(를)<br>
          <b class="buy-cost">${item.cost} 코인</b> 으로 구매할까요?</p>
        <p class="buy-note">${esc(item.desc ?? '')}</p>
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
      const ok = this.onBuy?.(item, cat);
      bye();
      if (ok) {
        this.onEquip?.(cat.kind, item.id);   // 산 즉시 켜 준다
        this.paint();
        this.#toast(`「${item.name}」 구매 완료! 바로 켰어요`);
      } else {
        this.#toast('코인이 모자랍니다');
      }
    });
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
