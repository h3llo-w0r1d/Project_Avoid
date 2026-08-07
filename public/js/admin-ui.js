// 게임 안 관리 창. 관리자로 로그인했을 때만 상단 바에 버튼이 뜬다.
//
// 관리 화면은 이것 하나뿐이다. 전에는 열쇠(ADMIN_TOKEN)를 들고 들어가는
// /admin.html 이 따로 있었는데, 하는 일이 여기와 겹쳐서 지웠다.
// 서버의 requireAdmin 은 여전히 열쇠도 받아 주므로, 계정으로 못 들어가는
// 상황이 오면 그 열쇠로 API 를 직접 부를 수는 있다.

const $ = (id) => document.getElementById(id);

// 한 쪽에 10줄. 창(84vh)에 머리말·탭·검색칸·쪽번호까지 다 들어가는 최대치다.
// 더 늘리면 쪽번호가 화면 밖으로 밀려나 쪽을 넘길 수가 없다.
const PER_PAGE = 10;

const when = (at) => {
  if (!at) return '';
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export class AdminUI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      modal: $('admin-modal'),
      btn: $('admin-btn'),
      tabs: $('admin-tabs'),
      summary: $('admin-summary'),
      search: $('admin-search'),
      count: $('admin-count'),
      state: $('admin-state'),
      body: $('admin-body'),
      pager: $('admin-pager')
    };
    this.panel = 'scores';
    this.page = 0;
    this.query = '';
    this.data = null;
    this.inspecting = null;   // 대전 기록을 들여다보는 중인 계정

    this.el.btn.addEventListener('click', () => this.open());
    $('admin-close').addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });

    for (const tab of this.el.tabs.querySelectorAll('button')) {
      tab.addEventListener('click', () => {
        this.panel = tab.dataset.panel;
        this.inspecting = null;
        this.page = 0;      // 탭을 옮기면 첫 쪽부터. 3쪽에 있다 옮기면 빈 화면이 뜬다.
        for (const t of this.el.tabs.querySelectorAll('button')) {
          t.classList.toggle('current', t === tab);
        }
        this.draw();
      });
    }

    this.el.search.addEventListener('input', () => {
      this.query = this.el.search.value.trim().toLowerCase();
      this.page = 0;      // 걸러 놓고 옛 쪽에 남아 있으면 아무것도 안 보인다
      this.draw();
    });

    // 기록 전체 비우기. 기록 탭에서만, 지울 게 있을 때만 나타난다.
    this.el.clear = AdminUI.button('전체 비우기', () => this.clearAll(), 'danger');
    this.el.clear.classList.add('hidden');
    this.el.search.parentElement.appendChild(this.el.clear);
  }

  // 되돌릴 수 없는 일이다. 두 번 묻고, 두 번째는 직접 입력하게 한다.
  // 확인 문구는 서버도 요구하므로 여기서 빠뜨리면 400 으로 되돌아온다.
  async clearAll() {
    const n = this.data?.scores?.length ?? 0;
    if (n === 0) return;
    if (!confirm(`기록 ${n}개를 모두 지웁니다. 되돌릴 수 없습니다.`)) return;
    if (prompt('정말 지우려면 DELETE ALL 을 입력하세요.') !== 'DELETE ALL') {
      this.say('취소했습니다.');
      return;
    }
    try {
      const r = await this.h.clearScores();
      await this.reload();
      this.say(`${r.removed}개를 모두 지웠습니다.`);
    } catch (err) {
      this.say(`전체 삭제 실패: ${err.message}`, true);
    }
  }

  // 관리자일 때만 버튼을 보여 준다. 버튼이 없다고 안전해지는 건 아니지만
  // (서버가 막는다) 남에게 보일 이유도 없다.
  setAdmin(isAdmin) {
    this.el.btn.classList.toggle('hidden', !isAdmin);
  }

  close() { this.el.modal.classList.add('hidden'); }

  async open() {
    this.el.modal.classList.remove('hidden');
    this.el.body.innerHTML = '';
    this.say('불러오는 중…');
    await this.reload();
  }

  say(text, isError = false) {
    this.el.state.textContent = text;
    this.el.state.classList.toggle('error', isError);
  }

  async reload() {
    try {
      this.data = await this.h.load();
      this.el.summary.textContent =
        `${this.data.season.name} · 접속 ${this.data.online?.online ?? 0}명`;
      this.say('');
      this.draw();
    } catch (err) {
      this.say(`불러오지 못했습니다: ${err.message}`, true);
    }
  }

  // 지금 탭에서 보여 줄 목록 (검색어까지 적용)
  rows() {
    if (!this.data) return [];
    const all = this.panel === 'scores' ? this.data.scores : this.data.accounts;
    if (!this.query) return all;
    return all.filter((e) => (e.name ?? e.nickname ?? '').toLowerCase().includes(this.query));
  }

  draw() {
    if (!this.data) return;

    // 기록 탭에서, 지울 게 있고, 대전 기록을 들여다보는 중이 아닐 때만 보인다.
    // 검색으로 걸러진 개수가 아니라 전체 개수로 판단한다 — 비우기는 전체를 지운다.
    this.el.clear.classList.toggle('hidden',
      this.inspecting !== null || this.panel !== 'scores' || this.data.scores.length === 0);

    if (this.inspecting) return this.drawHistory();

    const rows = this.rows();
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    // 지우다 보면 마지막 쪽이 통째로 비는 수가 있다. 그때는 한 쪽 당긴다.
    this.page = Math.min(this.page, pages - 1);

    const total = this.panel === 'scores' ? this.data.scores.length : this.data.accounts.length;
    this.el.count.textContent = this.query
      ? `${rows.length}개 / 전체 ${total}개`
      : `${total}개`;

    this.el.body.innerHTML = '';
    if (rows.length === 0) {
      this.el.body.innerHTML = `<p class="profile-empty">${
        this.query ? '찾는 이름이 없습니다' : '비어 있습니다'}</p>`;
      this.el.pager.innerHTML = '';
      return;
    }

    const start = this.page * PER_PAGE;
    const list = document.createElement('ul');
    list.className = 'admin-list';

    for (const [offset, e] of rows.slice(start, start + PER_PAGE).entries()) {
      list.appendChild(this.panel === 'scores'
        ? this.scoreRow(e, start + offset + 1)
        : this.accountRow(e));
    }
    this.el.body.appendChild(list);
    this.drawPager(pages);
  }

  drawPager(pages) {
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
        this.draw();
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

  row(cells) {
    const li = document.createElement('li');
    li.className = 'admin-row';
    for (const c of cells) li.appendChild(c);
    return li;
  }

  static text(value, cls = '') {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = value;
    return span;
  }

  static button(label, onClick, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `admin-act ${cls}`.trim();
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  scoreRow(e, rank) {
    const del = AdminUI.button('삭제', async () => {
      // 지우면 되돌릴 수 없다. 누가 눌렸는지 이름까지 보여 주고 묻는다.
      if (!confirm(`"${e.name}" 의 ${e.time.toFixed(2)}초 기록을 지웁니다.`)) return;
      try {
        await this.h.removeScore(e.id);
        await this.reload();
      } catch (err) {
        this.say(`삭제 실패: ${err.message}`, true);
      }
    }, 'danger');

    return this.row([
      AdminUI.text(`${rank}`, 'admin-rank'),
      AdminUI.text(e.name, 'admin-name'),
      AdminUI.text(`${e.time.toFixed(2)}초`, 'admin-value'),
      AdminUI.text(`${e.runs}번 · ${when(e.at)}`, 'admin-sub'),
      del
    ]);
  }

  // 이 계정이 치른 대전을 펼쳐 본다
  async inspect(u) {
    this.inspecting = { user: u, data: null };
    this.el.body.innerHTML = '<p class="profile-empty">불러오는 중…</p>';
    this.el.pager.innerHTML = '';
    try {
      this.inspecting.data = await this.h.matchesOf(u.id);
    } catch (err) {
      this.say(`대전 기록을 불러오지 못했습니다: ${err.message}`, true);
      this.inspecting = null;
      return;
    }
    this.draw();
  }

  drawHistory() {
    const { user, data } = this.inspecting;
    this.el.count.textContent = '';
    this.el.pager.innerHTML = '';
    this.el.body.innerHTML = '';

    const back = AdminUI.button('← 목록으로', () => {
      this.inspecting = null;
      this.draw();
    });
    const head = document.createElement('div');
    head.className = 'admin-inspect-head';
    head.appendChild(back);
    head.appendChild(AdminUI.text(`${user.nickname ?? '(닉네임 없음)'} 의 대전`, 'admin-name'));
    this.el.body.appendChild(head);

    // 무엇이 수상한지부터. 숫자를 늘어놓기만 하면 눈에 안 들어온다.
    const f = data.flags;
    if (!f) {
      this.el.body.insertAdjacentHTML('beforeend',
        '<p class="profile-empty">기록된 대전이 없습니다. ' +
        '이 기능을 넣기 전의 대전은 남아 있지 않습니다.</p>');
      return;
    }

    const pct = (v) => `${Math.round(v * 100)}%`;
    const warn = (on) => (on ? ' warn' : '');
    const marks = [
      // 한 사람과만 계속 붙었으면 짜고 쳤을 가능성이 높다
      { label: '같은 상대', value: `${pct(f.topOpponentShare)}`,
        sub: `${f.topOpponent} 와 ${f.topOpponentGames}판`, bad: f.topOpponentShare >= 0.7 && f.games >= 5 },
      { label: '방 코드 비율', value: pct(f.roomShare),
        sub: `${f.games}판 중`, bad: f.roomShare >= 0.9 && f.games >= 5 },
      { label: '짧은 승리', value: pct(f.shortWinShare),
        sub: `${f.wins}승 중 ${f.shortWins}판`, bad: f.shortWinShare >= 0.5 && f.wins >= 3 },
      { label: '평균 시간', value: `${f.avgSeconds}초`, sub: `상대 ${f.opponents}명`, bad: f.avgSeconds < 10 }
    ];

    const row = document.createElement('div');
    row.className = 'stat-row admin-flags';
    row.innerHTML = marks.map((m) => `
      <div class="stat${warn(m.bad)}">
        <span class="stat-value">${m.value}</span>
        <span class="stat-label">${m.label}</span>
        <span class="stat-sub">${m.sub}</span>
      </div>`).join('');
    this.el.body.appendChild(row);

    const list = document.createElement('ul');
    list.className = 'admin-list';
    for (const m of data.rows) {
      const when2 = new Date(m.at);
      const stamp = `${when2.getMonth() + 1}/${when2.getDate()} ` +
        `${String(when2.getHours()).padStart(2, '0')}:${String(when2.getMinutes()).padStart(2, '0')}`;
      const result = m.result === 'win' ? '승' : m.result === 'lose' ? '패' : '무';
      const li = this.row([
        AdminUI.text(result, `admin-rank result-${m.result}`),
        AdminUI.text(m.opponent, 'admin-name'),
        AdminUI.text(`${m.seconds.toFixed(1)}초`, 'admin-value'),
        AdminUI.text(`${m.mode === 'room' ? '방 코드' : '무작위'} · ${stamp}`, 'admin-sub')
      ]);
      list.appendChild(li);
    }
    this.el.body.appendChild(list);
  }

  accountRow(u) {
    const look = AdminUI.button('대전 기록', () => this.inspect(u));
    const reset = AdminUI.button('전적 초기화', async () => {
      if (!confirm(`"${u.nickname ?? '(닉네임 없음)'}" 의 승패를 0 으로 되돌립니다.`)) return;
      try {
        await this.h.resetUser(u.id);
        await this.reload();
      } catch (err) {
        this.say(`초기화 실패: ${err.message}`, true);
      }
    }, 'danger');

    return this.row([
      AdminUI.text(u.nickname ?? '(닉네임 없음)', 'admin-name'),
      AdminUI.text(`${u.seasonWins}승 ${u.seasonLosses}패`, 'admin-value'),
      AdminUI.text(`통산 ${u.wins}-${u.losses} · ${when(u.createdAt)} 가입`, 'admin-sub'),
      look,
      reset
    ]);
  }
}
