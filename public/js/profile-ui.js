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
      body: $('profile-body')
    };

    this.el.btn.addEventListener('click', () => this.openMine?.());
    $('profile-close').addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });

    this.openMine = null;   // main.js 가 채운다
  }

  get isOpen() { return !this.el.modal.classList.contains('hidden'); }

  close() { this.el.modal.classList.add('hidden'); }

  loading(name) {
    this.el.modal.classList.remove('hidden');
    this.el.name.textContent = name;
    this.el.body.innerHTML = '<p class="profile-empty">불러오는 중…</p>';
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

    const parts = [];

    // ---- 혼자 하기 ----
    parts.push('<h3 class="profile-section">혼자 하기</h3>');
    if (p.best) {
      parts.push(`<div class="stat-row">
        ${ProfileUI.stat('최고 기록', `${p.best.time.toFixed(2)}<em>초</em>`)}
        ${ProfileUI.stat('순위', `${p.best.rank}<em>위</em>`)}
      </div>`);
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
  }
}
