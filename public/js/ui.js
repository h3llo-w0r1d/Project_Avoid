import { STAGES } from './config.js';
import { GUEST_PATTERN } from './profanity.js';

const $ = (id) => document.getElementById(id);

// 한 쪽에 10개씩, 최대 10쪽(=100위)까지 보여 준다.
const PER_PAGE = 10;
const MAX_PAGES = 10;

const BEST_KEY = 'voltline.best';
const HC_KEY = 'voltline.best.hardcore';   // 하드코어 개인 최고기록
const HC_ON_KEY = 'voltline.hardcore';     // 하드코어 토글 상태

// 랭킹 종류. 줄 오른쪽에 무엇을 어떻게 보여 줄지까지 여기서 정한다.
const BOARDS = {
  time: {
    empty: '아직 기록이 없습니다',
    value: (e) => `${Number(e.time).toFixed(2)}<em>초</em>`,
    mine: (me) => `내 최고 기록 ${me.rank}위 · ${Number(me.time).toFixed(2)}초`
  },
  hardcore: {
    empty: '아직 하드코어 기록이 없습니다',
    value: (e) => `${Number(e.time).toFixed(2)}<em>초</em>`,
    mine: (me) => `내 하드코어 ${me.rank}위 · ${Number(me.time).toFixed(2)}초`
  },
  voice: {
    empty: '아직 마이크 기록이 없습니다',
    value: (e) => `${Number(e.time).toFixed(2)}<em>초</em>`,
    mine: (me) => `내 마이크 ${me.rank}위 · ${Number(me.time).toFixed(2)}초`
  },
  voicehard: {
    empty: '아직 마이크(하드코어) 기록이 없습니다',
    value: (e) => `${Number(e.time).toFixed(2)}<em>초</em>`,
    mine: (me) => `내 마이크·하드코어 ${me.rank}위 · ${Number(me.time).toFixed(2)}초`
  },
  wins: {
    empty: '아직 대전 기록이 없습니다',
    value: (e) => `${e.wins}<em>승</em> <span class="dim">${e.losses}패</span>`,
    mine: (me) => `내 순위 ${me.rank}위 · ${me.wins}승 ${me.losses}패`
  },
  rate: {
    empty: '아직 조건을 채운 사람이 없습니다',
    value: (e) => `${(e.rate * 100).toFixed(1)}<em>%</em> <span class="dim">${e.games}전</span>`,
    mine: (me) => `내 순위 ${me.rank}위 · ${(me.rate * 100).toFixed(1)}% (${me.games}전)`
  },
  streak: {
    empty: '2연승 이상 달리는 사람이 아직 없습니다',
    value: (e) => `${e.streak}<em>연승</em>`,
    mine: (me) => `내 순위 ${me.rank}위 · ${me.streak}연승 중`
  }
};

// 기록 막대(1위 대비 비율)를 그릴 때 쓸 숫자값. 보드마다 무엇이 값인지 다르다.
const METRIC = {
  time: (e) => Number(e.time) || 0,
  hardcore: (e) => Number(e.time) || 0,
  voice: (e) => Number(e.time) || 0,
  voicehard: (e) => Number(e.time) || 0,
  wins: (e) => Number(e.wins) || 0,
  rate: (e) => Number(e.rate) || 0,
  streak: (e) => Number(e.streak) || 0
};

export class UI {
  constructor(handlers) {
    this.el = {
      title: $('title-screen'),
      over: $('over-screen'),
      hud: $('hud'),
      touchUi: $('touch-ui'),
      timer: $('timer'),
      stage: $('stage-label'),
      bestInline: $('best-inline'),
      finalTime: $('final-time'),
      finalNote: $('final-note'),
      submitState: $('submit-state'),
      rankBtn: $('rank-btn'),
      rankModal: $('rank-modal'),
      tabs: $('rank-tabs'),
      note: $('rank-note'),
      board: $('leaderboard'),
      pager: $('rank-pager'),
      myRank: $('my-rank'),
      rankMe: $('rank-me'),          // 헤더에 늘 보이는 내 순위(100위 밖이어도)
      season: $('season-label')
    };

    this.entries = [];
    this.me = null;
    this.page = 0;
    this.boardKind = 'time';     // time | wins | rate

    for (const tab of this.el.tabs.querySelectorAll('button')) {
      tab.addEventListener('click', () => this.setBoard(tab.dataset.board));
    }

    this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    this.bestHardcore = Number(localStorage.getItem(HC_KEY)) || 0;

    // 하드코어 토글. 켜 두면 '혼자 하기'가 하드코어로 시작한다.
    this.hardcore = localStorage.getItem(HC_ON_KEY) === '1';
    this.el.hcToggle = $('hardcore-toggle');
    if (this.el.hcToggle) {
      this.#paintHardcore();
      this.el.hcToggle.addEventListener('click', () => {
        this.hardcore = !this.hardcore;
        localStorage.setItem(HC_ON_KEY, this.hardcore ? '1' : '0');
        this.#paintHardcore();
      });
    }

    $('start-btn').addEventListener('click', () => handlers.onStart());
    $('retry-btn').addEventListener('click', () => handlers.onStart());
    // 타이틀로 돌아가는 길은 한 곳으로 모은다. 여기서 showTitle() 만
    // 부르면 무대를 감추는 처리가 빠져 뒤에 그대로 비친다.
    $('home-btn').addEventListener('click', () => handlers.onHome());

    // 랭킹 창 열고 닫기
    const openRank = () => this.setRankOpen(true);
    this.el.rankBtn.addEventListener('click', openRank);
    $('rank-open-btn').addEventListener('click', openRank);
    $('rank-close').addEventListener('click', () => this.setRankOpen(false));
    // 바깥을 눌러도 닫힌다
    this.el.rankModal.addEventListener('click', (e) => {
      if (e.target === this.el.rankModal) this.setRankOpen(false);
    });
    // ESC 는 두 가지 일을 한다. 랭킹 창이 열려 있으면 그걸 닫고,
    // 아니면 일시정지로 넘긴다. 두 곳에서 따로 듣게 두면 창을 닫으면서
    // 동시에 일시정지가 걸린다.
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.el.rankModal.classList.contains('hidden')) {
        this.setRankOpen(false);
        return;
      }
      handlers.onEscape?.();
    });

    const mute = $('mute-btn');
    const paintMute = (muted) => {
      mute.textContent = muted ? '🔇' : '🔊';
      mute.classList.toggle('off', muted);
    };
    paintMute(handlers.isMuted());
    mute.addEventListener('click', () => paintMute(handlers.onToggleMute()));


    // 모바일이면 가상 조작을 켠다
    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  // 랭킹 창을 열 때마다 최신 목록을 받아 온다
  setRankOpen(open) {
    this.el.rankModal.classList.toggle('hidden', !open);
    if (open) this.onRankOpen?.(this.boardKind);
  }

  // 탭 표시만 맞춘다. 새로 받아오지는 않는다.
  //
  // 게임이 끝나면 기록을 올린 결과를 그대로 그리는데, 그때 사용자가
  // 다승 탭에 있었으면 시간 기록을 승수 형식으로 그리려다 깨진다.
  setBoardQuiet(kind) {
    if (!BOARDS[kind] && kind !== 'hall') return;
    this.boardKind = kind;
    for (const tab of this.el.tabs.querySelectorAll('button')) {
      tab.classList.toggle('current', tab.dataset.board === kind);
    }
  }

  // 명예의 전당. 순위 하나짜리 목록이 아니라 시즌 묶음이라 따로 그린다.
  renderHall(seasons) {
    this.setBoardQuiet('hall');
    this.el.note.textContent = '';
    this.el.pager.innerHTML = '';
    this.el.myRank.textContent = '';

    if (!seasons?.length) {
      this.el.board.innerHTML =
        '<li class="empty">아직 끝난 시즌이 없습니다. 이번 달이 첫 시즌입니다.</li>';
      return;
    }

    this.el.board.innerHTML = '';
    for (const season of seasons) {
      const head = document.createElement('li');
      head.className = 'hall-head';
      head.textContent = season.name;
      this.el.board.appendChild(head);

      season.top.slice(0, 3).forEach((e, i) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="rank medal medal-${i + 1}">${i + 1}</span>
          <button type="button" class="who"></button>
          <span class="secs">${Number(e.time).toFixed(2)}<em>초</em></span>`;
        const who = li.querySelector('.who');
        who.textContent = e.name;
        who.addEventListener('click', () => this.onName?.(e.name));
        this.el.board.appendChild(li);
      });
    }
  }

  // 시즌 이름과 남은 기간
  showSeason(season) {
    if (!season) return;
    const days = Math.max(0, Math.ceil(season.msLeft / 86400_000));
    this.el.season.textContent = `${season.name} 시즌 · ${days}일 남음`;
  }

  // 탭 바꾸기. 종류마다 받아오는 곳이 달라 main.js 에 다시 물어본다.
  setBoard(kind) {
    if (!BOARDS[kind] && kind !== 'hall') return;
    this.setBoardQuiet(kind);
    this.el.board.innerHTML = '<li class="empty">불러오는 중…</li>';
    this.el.pager.innerHTML = '';
    this.el.myRank.textContent = '';
    this.onRankOpen?.(kind);
  }

  // 로그인 계정은 서버 기록이 진짜다. 로그인하면 이 값으로 로컬 최고기록을
  // 맞춘다(남의 기기에서 대신 플레이해 부풀려진 로컬값을 되돌린다).
  setBest(normal, hardcore) {
    this.best = Number(normal) || 0;
    this.bestHardcore = Number(hardcore) || 0;
    localStorage.setItem(BEST_KEY, String(this.best));
    localStorage.setItem(HC_KEY, String(this.bestHardcore));
    this.el.bestInline.textContent = this.best ? `내 최고 ${this.best.toFixed(2)}초` : '';
  }

  // 온라인 화면으로 넘어갈 때처럼, 내가 관리하는 화면을 전부 내린다
  hideAllScreens() {
    this.el.title.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.hud.classList.add('hidden');
    this.el.touchUi.classList.add('hidden');
    this.setRankOpen(false);
  }

  // 게임 중 표시를 끈다. 상단바가 다시 나온다.
  #endPlaying() { document.body.classList.remove('playing'); }

  showRankButton() {
    this.el.rankBtn.classList.remove('hidden');
    this.onPlayableChange?.(true);
  }

  showTitle() {
    this.el.title.classList.remove('hidden');
    this.el.over.classList.add('hidden');
    this.el.hud.classList.add('hidden');
    this.el.touchUi.classList.add('hidden');
    this.el.rankBtn.classList.remove('hidden');
    this.#endPlaying();
    this.onPlayableChange?.(true);
  }

  showGame() {
    this.el.title.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.touchUi.classList.toggle('hidden', !this.isTouch);
    // 게임 중에는 상단 버튼 줄을 감춘다. 화면이 좁은 폰에서 타이머를 가리고,
    // 어차피 게임 중엔 안 쓰는 버튼들이다. (CSS 가 body.playing 을 보고 감춘다.)
    document.body.classList.add('playing');
    // 게임 중에는 랭킹·캐릭터 창을 못 열게 한다. 게임이 멈추지 않아 그냥 죽는다.
    this.el.rankBtn.classList.add('hidden');
    this.setRankOpen(false);
    this.onPlayableChange?.(false);
    this.el.bestInline.textContent = this.best ? `내 최고 ${this.best.toFixed(2)}초` : '';
  }

  // 스테이지가 막 바뀌었으면 true 를 돌려준다 (소리를 낼 타이밍)
  updateHud(elapsed) {
    this.el.timer.textContent = elapsed.toFixed(2);

    let name = STAGES[0].name;
    for (const s of STAGES) if (elapsed >= s.at) name = s.name;
    if (this.el.stage.textContent === name) return false;

    this.el.stage.textContent = name;
    // 스테이지가 바뀌면 잠깐 크게 보여 준다
    this.el.stage.animate(
      [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 450, easing: 'cubic-bezier(.2,.9,.3,1)' }
    );
    return true;
  }

  flashZap() {
    document.body.classList.remove('zapped');
    void document.body.offsetWidth; // 리플로우로 애니메이션 재시작
    document.body.classList.add('zapped');
    setTimeout(() => document.body.classList.remove('zapped'), 500);
  }

  // 하드코어 토글 모양과 시작 버튼 문구를 상태에 맞춘다.
  #paintHardcore() {
    const on = this.hardcore;
    if (this.el.hcToggle) {
      this.el.hcToggle.classList.toggle('on', on);
      this.el.hcToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      const state = this.el.hcToggle.querySelector('.hc-state');
      if (state) state.textContent = on ? 'ON' : 'OFF';
    }
    const start = $('start-btn');
    if (start) start.textContent = on ? '🔥 하드코어 시작' : '혼자 하기';
    document.body.classList.toggle('hardcore', on);
  }

  isHardcore() { return !!this.hardcore; }

  showGameOver(elapsed, cause, hardcore = false) {
    this.el.hud.classList.add('hidden');
    this.el.touchUi.classList.add('hidden');
    this.el.over.classList.remove('hidden');
    this.el.rankBtn.classList.remove('hidden');
    this.#endPlaying();
    this.el.finalTime.textContent = elapsed.toFixed(2);

    // 하드코어 기록은 일반 최고기록과 따로 관리한다.
    const prev = hardcore ? this.bestHardcore : this.best;
    const isBest = elapsed > prev;
    if (isBest) {
      if (hardcore) { this.bestHardcore = elapsed; localStorage.setItem(HC_KEY, String(elapsed)); }
      else { this.best = elapsed; localStorage.setItem(BEST_KEY, String(elapsed)); }
    }
    const bestNow = hardcore ? this.bestHardcore : this.best;

    const causeText = cause === 'fall' ? '무대 밖으로 떨어졌습니다' : '전기선에 닿았습니다';
    const tag = hardcore ? '🔥 하드코어 · ' : '';
    this.el.finalNote.textContent = isBest
      ? `${tag}${causeText} · 개인 최고 기록 경신!`
      : `${tag}${causeText} · 내 최고 ${bestNow.toFixed(2)}초`;

    this.el.submitState.textContent = '';
    this.el.submitState.classList.remove('error');
    return isBest;
  }

  setSubmitState(text, isError = false) {
    this.el.submitState.textContent = text;
    this.el.submitState.classList.toggle('error', isError);
  }

  // payload = { top: [...], me: {rank, ...} | null, note }
  renderLeaderboard(payload, highlightId, kind = this.boardKind) {
    this.setBoardQuiet(kind);
    // 방금 올린 기록은 다시 불러와도 계속 강조해 준다.
    // 창을 열 때마다 목록을 새로 받으므로, 기억해 두지 않으면 표시가 사라진다.
    if (highlightId) this.myEntryId = highlightId;

    this.entries = payload?.top ?? [];
    this.me = payload?.me ?? null;
    this.el.note.textContent = payload?.note ?? '';
    this.showSeason(payload?.season);

    // 내 기록이 있는 쪽을 먼저 펼쳐 준다. 없으면 1쪽.
    const mine = this.myEntryId
      ? this.entries.findIndex((e) => e.id === this.myEntryId)
      : -1;
    this.page = mine >= 0 ? Math.floor(mine / PER_PAGE) : 0;

    this.drawPage();
  }

  drawPage() {
    const board = this.el.board;
    board.innerHTML = '';

    const kindOf = BOARDS[this.boardKind];

    if (this.entries.length === 0) {
      board.innerHTML = `<li class="empty">${kindOf.empty}</li>`;
      this.el.pager.innerHTML = '';
      this.drawMyRank();
      return;
    }

    // 기록 막대는 1위(=목록 맨 위, 내림차순) 값을 100%로 삼는다.
    const metric = METRIC[this.boardKind] ?? (() => 0);
    const topVal = this.entries.length ? metric(this.entries[0]) : 0;

    const start = this.page * PER_PAGE;
    for (const [offset, e] of this.entries.slice(start, start + PER_PAGE).entries()) {
      const rank = start + offset + 1;
      const li = document.createElement('li');
      if (this.myEntryId && e.id === this.myEntryId) li.className = 'me';
      // 1~3위는 색이 다른 메달을 준다
      const medal = rank <= 3 ? ` medal medal-${rank}` : '';
      // 막대 길이(최소 6%는 남겨 아주 낮아도 보이게).
      const pct = topVal > 0 ? Math.max(6, Math.round((metric(e) / topVal) * 100)) : 0;
      li.innerHTML = `
        <span class="rank${medal}">${rank}</span>
        <button type="button" class="who"></button>
        <span class="rbar"><span class="rbar-fill" style="width:${pct}%"></span></span>
        <span class="secs">${kindOf.value(e)}</span>`;
      const who = li.querySelector('.who');
      who.textContent = e.name;
      // 게스트(Guest####)는 회색으로 — 로그인 유저와 구분되게.
      if (GUEST_PATTERN.test(e.name)) who.classList.add('guest');
      who.addEventListener('click', () => this.onName?.(e.name));
      board.appendChild(li);
    }

    this.drawPager();
    this.drawMyRank();
  }

  drawPager() {
    const pages = Math.min(Math.ceil(this.entries.length / PER_PAGE), MAX_PAGES);
    this.el.pager.innerHTML = '';
    if (pages <= 1) return;

    const button = (label, page, disabled, current) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = disabled;
      if (current) b.classList.add('current');
      b.addEventListener('click', () => {
        this.page = page;
        this.drawPage();
      });
      return b;
    };

    this.el.pager.appendChild(button('‹', Math.max(0, this.page - 1), this.page === 0));
    for (let i = 0; i < pages; i++) {
      this.el.pager.appendChild(button(String(i + 1), i, false, i === this.page));
    }
    this.el.pager.appendChild(
      button('›', Math.min(pages - 1, this.page + 1), this.page === pages - 1)
    );
  }

  // 내 순위. 100위 밖이라 목록에 안 나오는 경우가 이 줄의 존재 이유다.
  drawMyRank() {
    const me = this.me;
    // 헤더에 늘 보이는 짧은 내 순위(100위 밖으로 밀려도 보이게).
    if (this.el.rankMe) {
      if (me) {
        this.el.rankMe.textContent = `내 순위 ${me.rank}위`;
        this.el.rankMe.classList.remove('hidden');
      } else {
        this.el.rankMe.textContent = '';
        this.el.rankMe.classList.add('hidden');
      }
    }
    if (!me) {
      this.el.myRank.textContent = '';
      return;
    }
    const line = BOARDS[this.boardKind].mine(me);
    this.el.myRank.textContent = me.rank > this.entries.length ? `${line} (100위 밖)` : line;
  }

  leaderboardError(msg) {
    this.el.board.innerHTML = `<li class="empty">${msg}</li>`;
    this.el.pager.innerHTML = '';
    this.el.myRank.textContent = '';
    this.el.note.textContent = '';
  }
}

// ---------------------------------------------------------------- 랭킹 API

export const api = {
  // name 은 게스트의 순위를 찾기 위한 것. 로그인했으면 서버가 계정으로 찾는다.
  async top(name, mode = 'normal') {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (mode && mode !== 'normal') params.set('mode', mode);
    const query = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/scores${query}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async versus() {
    const res = await fetch('/api/versus-ranks');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // 공지 — 누구나 읽고, 관리자만 저장한다.
  // 공지 목록(줄마다 하나). 여러 개면 화면에서 번갈아 뜬다.
  async notices() {
    const res = await fetch('/api/notice');
    return res.ok ? ((await res.json()).notices ?? []) : [];
  },

  async saveNotice(text) {
    const res = await fetch('/api/admin/notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.notices ?? [];
  },

  // 관리자: 코인 지급용 계정 목록.
  async adminAccounts() {
    const res = await fetch('/api/admin/accounts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).rows;
  },

  // 관리자: 계정에 코인 지급(대기에 쌓임).
  async grantCoins(userId, amount) {
    const res = await fetch('/api/admin/coins/grant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data.pending;
  },

  // 로그인한 내가 대기 중인 코인을 받아 온다(있으면 개수, 없으면 0).
  async claimCoins() {
    const res = await fetch('/api/me/coins/claim', { method: 'POST' });
    return res.ok ? (await res.json()).amount ?? 0 : 0;
  },

  // 코인으로 캐릭터를 샀다고 서버에 남긴다(관리자 참고용). 실패해도 조용히 넘어간다.
  recordPurchase(character, charName, cost, guestName) {
    fetch('/api/purchase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character, charName, cost, name: guestName })
    }).catch(() => {});
  },

  // 룰렛 한 번 돌린 결과를 남긴다(참고용). 관리자는 서버가 걸러 저장 안 함.
  // prize: 특별 당첨(예: '노래')이면 함께 남겨 관리 화면에 표시한다.
  recordSpin(cost, reward, guestName, prize) {
    fetch('/api/spin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost, reward, name: guestName, prize })
    }).catch(() => {});
  },

  // ---- 관리 (관리자 계정으로 로그인했을 때만 통한다) ----

  async amIAdmin() {
    const res = await fetch('/api/admin/me');
    return res.ok ? (await res.json()).admin === true : false;
  },

  async adminOverview() {
    const res = await fetch('/api/admin/overview');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async adminRemoveScore(id) {
    const res = await fetch(`/api/admin/scores/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
  },

  // 기록을 통째로 비운다. 서버가 확인 문구까지 요구한다 — 실수로 눌려도
  // 본문이 정확히 맞지 않으면 400 으로 되돌린다.
  async adminClearScores() {
    const res = await fetch('/api/admin/scores/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL' })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
  },

  // ---- 게시판 ----

  async boardList() {
    const res = await fetch('/api/board');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).posts;
  },

  // 게스트면 이름을 같이 보낸다. 로그인했으면 서버가 계정 닉네임을 쓴다.
  // parentId 가 있으면 그 원글에 대한 답글로 올린다. category 는 원글의 칸.
  async boardPost(body, guestName, parentId, category) {
    const res = await fetch('/api/board', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, name: guestName, parentId, category })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.posts;
  },

  async boardRemove(id) {
    const res = await fetch(`/api/admin/board/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.posts;
  },

  // 게시글 본문 수정(관리자). 패치노트를 다듬는 데 쓴다.
  async boardEdit(id, body) {
    const res = await fetch(`/api/admin/board/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.posts;
  },

  async adminClearUsage() {
    const res = await fetch('/api/admin/usage/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL' })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
  },

  async adminMatches(userId) {
    const res = await fetch(`/api/admin/matches?user=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
  },

  async adminResetUser(id) {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reset`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
  },

  async profile(name) {
    const res = await fetch(`/api/profile?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // 칭호 장착 저장. 얻은 것만·최대 3개는 서버가 다시 걸러 확정본을 준다.
  async equipTitles(equipped) {
    const res = await fetch('/api/titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipped })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).titles;
  },

  // 업적 칭호 수여(예: 럭키가이 — 룰렛 대박). { fresh, title } 을 준다.
  // 로그인 안 했거나 실패하면 조용히 null(축하만 못 뜬다).
  async awardTitle(id) {
    try {
      const res = await fetch('/api/titles/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async hall() {
    const res = await fetch('/api/hall');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  // 판을 시작할 때 표를 받아 둔다. 기록을 올릴 때 이 표를 같이 내야 하고,
  // 표를 받은 뒤 실제로 흐른 시간보다 긴 기록은 서버가 거절한다.
  async startRun() {
    const res = await fetch('/api/run/start', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).ticket;
  },

  async submit(name, time, ticket, mode = 'normal') {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, time, ticket, mode })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // 다시보기 기록을 올린다(최고 기록일 때만 호출). 실패해도 조용히 넘어간다.
  async saveReplay(payload) {
    const res = await fetch('/api/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  },

  // 다시보기 기록을 받아온다(관리자 전용). { seed, mode, time, name, frames }
  async getReplay(scoreId) {
    const res = await fetch(`/api/admin/replay/${encodeURIComponent(scoreId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
};
