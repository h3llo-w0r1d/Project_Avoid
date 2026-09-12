// 상점 — 코인으로 사는 꾸미기.
//
// 항목(발자국 효과·경기장 스킨…)을 위쪽 탭으로 나눠 둔다. 파는 게 늘어날 때
// 창을 새로 만들지 않고 CATEGORIES 에 한 줄만 더하면 되게 했다.
//
// 어느 항목이든 규칙은 같다: 산 것만 켤 수 있고, 한 번에 하나만 켠다.
// 판정에는 전혀 영향이 없다(그래야 산 사람이 유리해지지 않는다).
//
// 코인은 브라우저에 있다(wallet). 서버에는 '누가 뭘 샀다' 만 남긴다 —
// 캐릭터 구매와 같은 방식이라 관리 화면에서 함께 볼 수 있다.

import { TRAILS, ARENAS, DEFAULT_ARENA } from './effects.js';
import { FX_LEVEL_AT } from './wallet.js';
import { wallet } from './wallet.js';
import { t, onLangChange } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// item.name(한국어 원문)은 소유 로그용으로 그대로 두고, 화면에는 nameKey 로
// 옮긴 문구를 쓴다. nameKey 가 없는 항목('사용 안 함' 같은 즉석 객체)은
// name 을 이미 번역된 문자열로 채워 뒀으므로 그대로 쓴다.
const itemName = (item) => item.nameKey ? t(item.nameKey) : item.name;
const itemDesc = (item) => item.descKey ? t(item.descKey) : (item.desc ?? '');

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// 경기장 스킨 미리보기. 색 두 개를 위아래로 칠하면 무슨 스킨인지 알 수 없어서,
// 작은 무대 그림을 직접 그린다 — 하늘, 떠 있는 섬, 가장자리 장식까지.
// 한 번 그려 두고 돌려 쓴다(카드를 다시 그릴 때마다 새로 그리면 깜빡인다).
const thumbCache = new Map();
function arenaThumb(spec) {
  if (thumbCache.has(spec.id)) return thumbCache.get(spec.id);

  const W = 320, H = 150;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  // 하늘
  const sky = spec.thumbSky ?? ['#0d1524', '#31414a', '#7a6647'];
  const grad = g.createLinearGradient(0, 0, 0, H);
  sky.forEach((c, i) => grad.addColorStop(i / (sky.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.62, rx = W * 0.40, ry = H * 0.20;
  const top = hex(spec.swatchTop ?? 0x6f9e4a);
  const side = hex(spec.swatchSide ?? 0x7a5a3a);

  // 아래로 좁아지는 절벽 — 섬이 떠 있는 게 보여야 무대로 읽힌다
  g.fillStyle = side;
  g.beginPath();
  g.moveTo(cx - rx, cy);
  g.quadraticCurveTo(cx - rx * 0.55, cy + ry * 3.1, cx, cy + ry * 3.4);
  g.quadraticCurveTo(cx + rx * 0.55, cy + ry * 3.1, cx + rx, cy);
  g.closePath();
  g.fill();
  // 절벽에 드리운 그늘
  g.fillStyle = 'rgba(0, 0, 0, 0.22)';
  g.beginPath();
  g.moveTo(cx, cy);
  g.quadraticCurveTo(cx + rx * 0.55, cy + ry * 3.1, cx, cy + ry * 3.4);
  g.lineTo(cx, cy);
  g.fill();

  // 상판
  g.fillStyle = top;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  // 볕이 드는 쪽을 살짝 밝게
  const lit = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, 0, cx, cy, rx);
  lit.addColorStop(0, 'rgba(255,255,255,0.28)');
  lit.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lit;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();

  // 가장자리 장식 — 바위면 둥글게, 얼음이면 뾰족하게
  const ice = spec.thumbEdge === 'ice';
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx * 0.97;
    const y = cy + Math.sin(a) * ry * 0.97;
    const s2 = 0.7 + Math.random() * 0.6;
    if (ice) {
      const h = (5 + Math.random() * 9) * s2;
      g.fillStyle = 'rgba(214, 236, 255, 0.95)';
      g.beginPath();
      g.moveTo(x - 2.2 * s2, y);
      g.lineTo(x, y - h);
      g.lineTo(x + 2.2 * s2, y);
      g.closePath(); g.fill();
    } else {
      g.fillStyle = 'rgba(196, 188, 172, 0.95)';
      g.beginPath();
      g.ellipse(x, y - 1.5, 3.4 * s2, 2.6 * s2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 눈 내리는 스킨이면 눈송이 몇 점
  if (spec.snowfall) {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      g.arc(Math.random() * W, Math.random() * H * 0.8, Math.random() * 1.4 + 0.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  const url = cv.toDataURL('image/png');
  thumbCache.set(spec.id, url);
  return url;
}

// 파는 항목들. kind 는 wallet 이 '산 목록/켠 것' 을 담는 칸 이름이기도 하다.
//
//  allowNone : '사용 안 함' 칸을 맨 앞에 둘지. 무대처럼 늘 하나는 켜져 있어야
//              하는 항목은 false 로 두고, 대신 공짜 기본값을 하나 넣는다.
//  free      : 살 필요 없이 처음부터 쓸 수 있는 id
//  swatch    : 카드 위 색 미리보기. 사기 전에 무슨 색인지 보여 준다.
export const CATEGORIES = [
  {
    id: 'trail', kind: 'trail', name: '발자국 효과', nameKey: 'shop.tabTrail',
    hint: '움직일 때 발밑에 남는 효과예요 · 켠 채로 오래 버티면 단계가 올라 더 화려해져요', hintKey: 'shop.hintTrail',
    allowNone: true,
    // 카드에는 이름과 색만. 설명은 살 때 확인창에서 보여 준다.
    hideDesc: true,
    levels: true,   // 카드에 단계와 다음 단계까지 남은 시간을 보여 준다
    items: TRAILS,
    swatch: (s) => s.rainbow
      ? 'linear-gradient(90deg,#ff5f6d,#ffc371,#7ee8a2,#48c6ef,#b18cff)'
      : `linear-gradient(90deg,${s.colors.map(hex).join(',')})`
  },
  {
    id: 'arena', kind: 'arena', name: '경기장 스킨', nameKey: 'shop.tabArena',
    hint: '전기선을 피하는 무대의 모습이에요 · 새 스킨은 곧 추가됩니다', hintKey: 'shop.hintArena',
    allowNone: false,
    free: DEFAULT_ARENA,
    items: ARENAS,
    // 색 막대 대신 작은 무대 그림. 이름만으로는 어떤 무대인지 모른다.
    swatch: (s) => `center / cover no-repeat url(${arenaThumb(s)})`,
    hideDesc: true,   // 그림이 곧 설명이라 글은 오히려 어수선하다
    tallSwatch: true
  }
];

export class ShopUI {
  constructor() {
    this.overlay = null;
    this.tab = CATEGORIES[0].id;
    this.onBuy = null;      // (item, category) => boolean — 코인을 깎고 소유 처리
    this.onEquip = null;    // (kind, id|null) => void — 켜고 끈다
    this.isAdmin = () => false;
    // 창을 열어 둔 채로 언어를 바꿀 수도 있다. 열려 있을 때만 다시 그린다.
    onLangChange(() => { if (this.overlay) this.paint(); });
  }

  open() {
    if (this.overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-card panel shop-card">
        <div class="modal-head">
          <h2>${t('menu.shop')}</h2>
          <span class="shop-coins"></span>
          <button type="button" class="icon-btn shop-close" aria-label="${t('common.close')}">✕</button>
        </div>
        <nav class="shop-tabs">
          ${CATEGORIES.map((c) =>
            `<button type="button" data-cat="${c.id}">${esc(t(c.nameKey))}</button>`).join('')}
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
  //
  // 룰렛 전용은 값이 0 이지만 '공짜' 가 아니다 — 값을 매기지 않았을 뿐,
  // 룰렛으로 따야 가진 것이 된다. 여기서 걸러 주지 않으면 누구나 쓸 수 있다.
  #owns(cat, item) {
    if (item.rouletteOnly) return this.isAdmin() || wallet.isOwnedIn(cat.kind, item.id);
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
      admin ? '<b><span class="coin-ico"></span> ∞</b>' : `<b><span class="coin-ico"></span> ${coins.toLocaleString('ko-KR')}</b>`;
    this.overlay.querySelector('.shop-hint').textContent = t(cat.hintKey);
    for (const b of this.overlay.querySelectorAll('.shop-tabs button')) {
      const c = CATEGORIES.find((x) => x.id === b.dataset.cat);
      b.textContent = t(c.nameKey);
      b.classList.toggle('current', b.dataset.cat === cat.id);
    }

    const grid = this.overlay.querySelector('.shop-grid');
    grid.innerHTML = '';

    // 끌 수 있는 항목은 '사용 안 함' 칸을 맨 앞에. 켠 걸 되돌릴 길이
    // 없으면 답답하다.
    if (cat.allowNone) {
      grid.appendChild(this.#card(cat, { id: null, name: t('shop.none'), desc: t('shop.noneDesc'), plain: true },
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
      ? `<span class="shop-state">${t('shop.using')}</span>`
      : owned
        ? (item.plain
          ? `<span class="shop-state dim">${t('shop.tapOff')}</span>`
          : `<span class="shop-state">${t('shop.tapUse')}</span>`)
        // 룰렛 전용은 값을 매기지 않는다 — 코인으로는 살 수 없다.
        : item.rouletteOnly
          ? `<span class="shop-cost roul">${t('shop.rouletteOnly')}</span>`
          : `<span class="shop-cost${afford ? '' : ' short'}"><span class="coin-ico"></span> ${afford ? item.cost : t('shop.costNeed', { cost: item.cost })}</span>`;

    // 단계가 있는 항목(발자국)은 가진 것에 한해 단계와 진행도를 보여 준다.
    // 아직 안 산 것에까지 붙이면 살지 말지 정하는 데 방해만 된다.
    // 지금 몇 단계로 쓰는지 + 다음 단계까지. 산 것에만 붙인다.
    const lvLine = (cat.levels && owned && !item.plain)
      ? `<span class="shop-lv">${t('shop.lvPick', { lv: wallet.fxPick(item.id) })}${wallet.fxLevel(item.id) > wallet.fxPick(item.id) ? ` <em>${t('shop.lvOpenUpTo', { lv: wallet.fxLevel(item.id) })}</em>` : (wallet.fxToNext(item.id) === null ? ` <em>${t('shop.lvMax')}</em>` : ` <em>${t('shop.lvNext', { secs: wallet.fxToNext(item.id), sec: t('common.sec') })}</em>`)}</span>`
      : '';
    if (cat.tallSwatch) el.classList.add('tall');
    el.innerHTML = `
      ${bar}
      <span class="shop-name">${esc(itemName(item))}</span>
      ${lvLine}
      ${cat.hideDesc ? '' : `<span class="shop-desc">${esc(itemDesc(item))}</span>`}
      ${foot}`;

    el.addEventListener('click', () => this.#tap(cat, item, owned, on));
    return el;
  }

  #tap(cat, item, owned, on) {
    if (item.plain) { this.onEquip?.(cat.kind, null); this.paint(); return; }
    // 단계가 있는 항목은 눌렀을 때 몇 단계로 쓸지 고르게 한다.
    // 3단계까지 열어도 1단계의 담백한 쪽이 취향일 수 있다.
    if (owned && cat.levels && !item.plain) { this.#pickLevel(cat, item); return; }
    if (owned) {
      // 끌 수 있는 항목이면, 켠 걸 다시 눌러 끈다. 무대처럼 늘 하나는 켜져
      // 있어야 하는 항목은 다시 눌러도 그대로 둔다.
      const next = (on && cat.allowNone) ? null : item.id;
      this.onEquip?.(cat.kind, next);
      this.paint();
      return;
    }
    // 룰렛 전용은 구매창을 띄우지 않는다. 코인이 아무리 많아도 못 산다.
    if (item.rouletteOnly) { this.#toast(t('shop.rouletteOnlyToast')); return; }
    this.#confirmBuy(cat, item);
  }

  // 단계 고르는 창. 아직 안 열린 단계는 눌리지 않고, 얼마나 더 버티면
  // 열리는지 알려 준다.
  #pickLevel(cat, item) {
    // 관리자는 단계를 전부 열어 둔다. 실제로 500·1000초를 버티지 않고도
    // 어떻게 보이는지 확인할 수 있어야 한다.
    const max = this.isAdmin() ? 3 : wallet.fxLevel(item.id);
    const now = wallet.fxPick(item.id);
    const equipped = this.#current(cat) === item.id;

    const ask = document.createElement('div');
    ask.className = 'modal';
    ask.style.zIndex = '70';
    const rows = [1, 2, 3].map((lv) => {
      const open = lv <= max;
      const on = lv === now;
      const need = open ? null : FX_LEVEL_AT[lv - 2] - wallet.fxTime(item.id);
      const note = open ? '' : t('shop.lvUnlockIn', { secs: Math.ceil(need), sec: t('common.sec') });
      return `<button type="button" class="lv-row${on ? ' on' : ''}${open ? '' : ' locked'}"
        data-lv="${lv}"${open ? '' : ' disabled'}><span class="lv-num">${t('shop.lvPick', { lv })}</span><span class="lv-note">${esc(note)}</span><span class="lv-state">${on ? t('shop.using') : open ? t('shop.lvChoose') : '🔒'}</span></button>`;
    }).join('');

    ask.innerHTML = `
      <div class="modal-card panel buy-card lv-card">
        <p class="buy-msg">${t('shop.pickLevelTitle', { name: esc(itemName(item)) })}</p>
        <p class="buy-note">${t('shop.pickLevelNote')}</p>
        <div class="lv-list">${rows}</div>
        <div class="buy-actions"><button type="button" class="ghost small lv-close">${t('common.close')}</button></div>
      </div>`;
    document.body.appendChild(ask);
    const bye = () => ask.remove();
    ask.querySelector('.lv-close').addEventListener('click', bye);
    ask.addEventListener('click', (e) => { if (e.target === ask) bye(); });
    for (const b of ask.querySelectorAll('.lv-row:not([disabled])')) {
      b.addEventListener('click', () => {
        wallet.setFxPick(item.id, Number(b.dataset.lv));
        // 고르면 그 효과를 켠다. 이미 켠 것이면 단계만 바뀐다.
        this.onEquip?.(cat.kind, item.id);
        bye();
        this.paint();
      });
    }
    // 켠 적 없는 효과였다면, 창을 그냥 닫아도 켜지지 않는다(고를 때만 켠다)
    void equipped;
  }

  #confirmBuy(cat, item) {
    const ask = document.createElement('div');
    ask.className = 'modal';
    ask.style.zIndex = '70';
    ask.innerHTML = `
      <div class="modal-card panel buy-card">
        <p class="buy-msg">${t('shop.buyMsg', { name: esc(itemName(item)), cost: item.cost })}</p>
        <p class="buy-note">${esc(itemDesc(item))}</p>
        <div class="buy-actions">
          <button type="button" class="ghost small buy-no">${t('common.cancel')}</button>
          <button type="button" class="buy-yes">${t('shop.buyDo')}</button>
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
        this.#toast(t('shop.boughtToast', { name: itemName(item) }));
      } else {
        this.#toast(t('shop.notEnoughCoins'));
      }
    });
  }

  #toast(text) {
    const el = document.createElement('div');
    el.className = 'shop-toast';
    el.textContent = text;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 240);
    }, 1900);
  }
}
