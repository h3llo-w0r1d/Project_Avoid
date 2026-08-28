// 한 사람의 기록 모음.
//
// 상단 바의 사람 버튼으로 내 것을 열고, 랭킹에서 이름을 누르면 그 사람
// 것을 연다. 둘 다 같은 화면이다 — 남의 프로필이라고 다르게 보여 줄
// 이유가 없고, 하나만 만들면 어긋날 일도 없다.

const $ = (id) => document.getElementById(id);

export class ProfileUI {
  constructor() {
    this.el = {
      modal: $('profile-modal'),
      btn: $('profile-btn'),
      name: $('profile-name'),
      body: $('profile-body'),
      replayBtn: $('profile-replay')   // 관리자 전용 '다시보기' (기록 있을 때만)
    };

    this.el.btn.addEventListener('click', () => this.openMine?.());
    $('profile-close').addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });
    this.el.replayBtn?.addEventListener('click', () => {
      if (this.replayId) this.onReplay?.(this.replayId);
    });

    this.openMine = null;   // main.js 가 채운다
    this.onRename = null;   // main.js 가 채운다. 없으면 바꾸기 버튼을 안 만든다.
    this.onReplay = null;   // main.js 가 채운다(관리자만). 최고기록 다시보기.
    this.me = null;         // 지금 로그인한 사람의 닉네임 (게스트면 null)
    this.replayId = null;   // 지금 프로필의 최고기록 점수 id (다시보기 대상)
  }

  get isOpen() { return !this.el.modal.classList.contains('hidden'); }

  close() { this.el.modal.classList.add('hidden'); }

  loading(name) {
    this.el.modal.classList.remove('hidden');
    this.el.name.textContent = name;
    this.el.body.innerHTML = '<p class="profile-empty">불러오는 중…</p>';
    this.replayId = null;
    this.el.replayBtn?.classList.add('hidden');
  }

  error(msg) {
    this.el.body.innerHTML = `<p class="profile-empty">${msg}</p>`;
  }

  // 큰 숫자 한 칸
  static stat(label, value, sub = '') {
    return `
      <div class="stat">
        <span class="stat-value">${value}</span>
        <span class="stat-label">${label}</span>
        ${sub ? `<span class="stat-sub">${sub}</span>` : ''}
      </div>`;
  }

  static rankText(rank) {
    return rank ? `${rank}위` : '순위 밖';
  }

  draw(p) {
    this.el.name.textContent = p.name;

    // 다시보기 버튼: 관리자에게만, 그 최고기록의 리플레이가 있을 때만 뜬다.
    // (서버가 관리자에게만 best.id·best.replay 를 내려준다.)
    this.replayId = p.best?.replay ? p.best.id : null;
    this.el.replayBtn?.classList.toggle('hidden', !this.replayId);

    const parts = [];

    // ---- 혼자 하기 ----
    parts.push('<h3 class="profile-section">혼자 하기</h3>');
    if (p.best) {
      parts.push(`<div class="stat-row">
        ${ProfileUI.stat('최고 기록', `${p.best.time.toFixed(2)}<em>초</em>`)}
        ${ProfileUI.stat('순위', `${p.best.rank}<em>위</em>`)}
        ${ProfileUI.stat('플레이', `${p.plays ?? 0}<em>판</em>`)}
      </div>`);
      // 하드코어 기록이 있으면 한 줄 더.
      if (p.hardcore) {
        parts.push(`<p class="profile-total">🔥 하드코어 최고 ` +
          `${p.hardcore.time.toFixed(2)}초 · ${ProfileUI.rankText(p.hardcore.rank)}</p>`);
      }
      // 111초를 넘긴 적 있으면 커피 클럽 뱃지.
      if (p.coffee) {
        parts.push('<p class="profile-badge">☕ 111초 클럽</p>');
      }
    } else if (p.plays > 0) {
      // 기록은 시즌 밖으로 밀렸지만 플레이한 적은 있는 경우
      parts.push(`<p class="profile-empty">이번 시즌 순위권 기록은 없지만 ${p.plays}판 플레이했습니다</p>`);
    } else {
      parts.push('<p class="profile-empty">이번 시즌 기록이 없습니다</p>');
    }

    // ---- 1v1 ----
    parts.push('<h3 class="profile-section">온라인 1v1</h3>');
    const v = p.versus;
    if (!v) {
      // 게스트다. 계정이 없으니 쌓일 곳이 없다.
      parts.push('<p class="profile-empty">게스트는 대전 전적이 남지 않습니다. ' +
        '로그인하면 승패와 연승이 쌓입니다.</p>');
    } else if (v.games === 0) {
      parts.push('<p class="profile-empty">이번 시즌 대전 기록이 없습니다</p>');
    } else {
      const rate = v.rate === null ? '–' : `${(v.rate * 100).toFixed(1)}<em>%</em>`;
      // 승률은 최소 판수를 넘겨야 랭킹에 오른다. 몇 판 남았는지 알려 준다.
      const rateSub = v.rateRank
        ? ProfileUI.rankText(v.rateRank)
        : `${v.minGames}전부터 (${Math.max(0, v.minGames - v.games)}전 남음)`;

      parts.push(`<div class="stat-row">
        ${ProfileUI.stat('전적', `${v.wins}<em>승</em> ${v.losses}<em>패</em>`, ProfileUI.rankText(v.winRank))}
        ${ProfileUI.stat('승률', rate, rateSub)}
        ${ProfileUI.stat('연승', `${v.streak}<em>연승</em>`,
    v.streak >= 2 ? ProfileUI.rankText(v.streakRank) : `최고 ${v.bestStreak}연승`)}
      </div>`);

      parts.push(`<p class="profile-total">통산 ${v.totalWins}승 ${v.totalLosses}패 ` +
        `· 최고 ${v.bestStreak}연승</p>`);
    }

    parts.push(`<p class="profile-note">${p.season.name} 시즌 기준입니다. ` +
      '통산 기록만 시즌이 바뀌어도 남습니다.</p>');

    this.el.body.innerHTML = parts.join('');

    // 내 프로필일 때만 닉네임을 바꿀 수 있다. 남의 프로필에 이 버튼이
    // 뜨면 안 되므로 이름이 같은지 확인한다.
    if (this.onRename && this.me && this.me === p.name) {
      const row = document.createElement('div');
      row.className = 'profile-actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost small';
      btn.textContent = '닉네임 바꾸기';
      btn.addEventListener('click', () => this.askRename(p.name));
      row.appendChild(btn);
      this.el.body.appendChild(row);
    }
  }

  // 화면 가운데 뜨는 입력창. 브라우저 기본 prompt() 는 창 맨 위에 떠서
  // 어색하다. 확인하면 입력값, 취소/바깥클릭/Esc 면 null 로 resolve.
  centerPrompt(label, initial = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.style.zIndex = '60';   // 프로필(45) 위에
      overlay.innerHTML = `
        <div class="modal-card panel" style="max-width:340px">
          <div class="modal-head"><h2>닉네임 바꾸기</h2></div>
          <label class="field"><span>${label}</span>
            <input class="cp-input" type="text" maxlength="10" autocomplete="off" /></label>
          <div class="board-write-row" style="justify-content:flex-end;gap:8px;margin-top:12px">
            <button type="button" class="ghost small cp-cancel">취소</button>
            <button type="button" class="primary small cp-ok">확인</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('.cp-input');
      input.value = initial;
      const done = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('.cp-ok').addEventListener('click', () => done(input.value));
      overlay.querySelector('.cp-cancel').addEventListener('click', () => done(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
      // 창이 뜨면 바로 입력·전체선택
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  async askRename(current) {
    const next = await this.centerPrompt('새 닉네임 (10자 이내)', current);
    if (next === null) return;                 // 취소
    const name = next.trim();
    if (!name || name === current) return;

    const note = document.createElement('p');
    note.className = 'profile-empty';
    note.textContent = '바꾸는 중…';
    this.el.body.appendChild(note);

    try {
      await this.onRename(name);
      // 바뀐 이름으로 화면을 다시 그린다. 옛 이름이 남아 있으면
      // 방금 바꾼 게 안 된 것처럼 보인다.
      this.me = name;
      await this.openMine?.();
    } catch (err) {
      note.textContent = err.message;
      note.classList.add('error');
    }
  }
}
