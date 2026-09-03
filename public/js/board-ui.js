// 커뮤니티 창.
//
// 서버가 신원·욕설·길이·도배를 막지만, 화면에 그릴 때 반드시 escape 한다.
// 남이 쓴 글을 그대로 innerHTML 에 넣으면 <script> 가 실행된다.
//
// 칸(카테고리) 탭으로 글을 나눠 본다: 패치노트·잡담·버그 제보·Q&A.
// 패치노트 칸은 운영자만 쓴다(서버가 막고, 여기선 관리자에게만 선택지를 준다).
//
// 두 화면을 오간다.
//  - 목록: 글 카드들. 카드를 누르면 상세로 들어간다. 카드에는 칸 뱃지 + 💬 댓글 수.
//  - 상세: 글 하나를 크게 + 그 밑에 댓글 목록과 댓글 입력칸.
// 댓글(답글)은 한 단계만 — 상세에서만 달 수 있고 원글에 붙는다.

const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 칸 정보: 이름·아이콘·뱃지 색 클래스.
const CATS = {
  patch: { label: '패치노트', icon: '📢', cls: 'cat-patch' },
  chat: { label: '잡담', icon: '💬', cls: 'cat-chat' },
  bug: { label: '버그 제보', icon: '🐞', cls: 'cat-bug' },
  qna: { label: 'Q&A', icon: '❓', cls: 'cat-qna' }
};

// 이름 색 → 실제 색(화이트리스트). 임의 CSS 주입을 막는다.
// 패치노트에 쓸 수 있는 색. 어두운 배경에 얹히므로 너무 어두운 색은 안 넣는다
// (검정은 예외 — 흰 인용 상자 안에서 쓰라고 남겨 둔다).
// 이름은 여러 갈래로 받는다. 옛 글에 쓰인 이름이 나중에 깨지면 안 된다.
const COLOR_NAMES = {
  빨강: '#ff5566', 빨간: '#ff5566', red: '#ff5566',
  주황: '#ff9f43', orange: '#ff9f43',
  코랄: '#ff9d8f', 살구: '#ff9d8f', coral: '#ff9d8f',
  노랑: '#ffd54a', yellow: '#ffd54a',
  금색: '#f0b429', 금: '#f0b429', gold: '#f0b429',
  라임: '#a9e34b', 연두: '#a9e34b', lime: '#a9e34b',
  초록: '#57d18a', 녹색: '#57d18a', green: '#57d18a',
  민트: '#3ee0c4', mint: '#3ee0c4',
  하늘: '#4fd6ff', cyan: '#4fd6ff',
  파랑: '#4f8bff', 파란: '#4f8bff', blue: '#4f8bff',
  남색: '#6a5ae0', indigo: '#6a5ae0',
  보라: '#b57bff', purple: '#b57bff',
  자주: '#ff4fd8', 마젠타: '#ff4fd8', magenta: '#ff4fd8',
  분홍: '#ff7eb6', pink: '#ff7eb6',
  갈색: '#b98a5e', brown: '#b98a5e',
  회색: '#9aa4bf', gray: '#9aa4bf', grey: '#9aa4bf',
  흰색: '#ffffff', white: '#ffffff',
  검정: '#000000', 검은: '#000000', black: '#000000'
};
const toColor = (key) =>
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(key)
    ? key : (COLOR_NAMES[key] || COLOR_NAMES[key.toLowerCase()] || null);

// 색이 아닌 서식 키(굵게). 색과 함께 '{빨강+굵게|글자}' 처럼 조합할 수 있다.
const STYLE_KEYS = {
  굵게: 'font-weight:800', 진하게: 'font-weight:800', bold: 'font-weight:800'
};
const toStyleCss = (key) => STYLE_KEYS[key] || STYLE_KEYS[key.toLowerCase()] || null;
const isStyleKey = (key) => !!toStyleCss(key);

// 토큰의 키 부분(색·굵게, '+' 로 여러 개)을 CSS 로. 유효한 게 하나도 없으면 null.
function specToCss(spec) {
  let css = '';
  for (const part of spec.split('+')) {
    const c = toColor(part);
    if (c) { css += `color:${c};`; continue; }
    const s = toStyleCss(part);
    if (s) { css += s + ';'; continue; }
    return null;   // 모르는 키가 섞이면 토큰을 글자 그대로 둔다
  }
  return css || null;
}

// 문장 속 {색|부분} 을 그 색 span 으로. 색이 아니면 토큰을 글자 그대로 둔다.
// 나머지는 전부 escape 하고 개행만 <br>.
function colorize(s) {
  const re = /\{(#[0-9a-fA-F]{3,6}|[가-힣A-Za-z]+(?:\+[가-힣A-Za-z]+)*)\|([^}]*)\}/g;
  let out = '', last = 0, m;
  const put = (t) => esc(t).replace(/\n/g, '<br>');
  while ((m = re.exec(s))) {
    out += put(s.slice(last, m.index));
    const css = specToCss(m[1]);
    out += css ? `<span style="${css}">${put(m[2])}</span>` : put(m[0]);
    last = m.index + m[0].length;
  }
  return out + put(s.slice(last));
}

// 팔레트에 놓는 순서. 무지개 순으로 늘어놓아야 원하는 색을 눈으로 빨리 찾는다.
// (색 이름은 더 많다 — 여기 없는 이름도 {민트|글자} 처럼 직접 쓸 수 있다.)
const PALETTE = [
  '빨강', '코랄', '주황', '금색', '노랑', '라임', '초록', '민트',
  '하늘', '파랑', '남색', '보라', '자주', '분홍', '갈색', '회색', '흰색'
];

// 언제 올렸는지 사람이 읽기 좋게. 방금·N분 전·N시간 전·날짜.
function ago(at) {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export class BoardUI {
  constructor(handlers) {
    this.h = handlers;       // { list, post, remove, isAdmin }
    this.el = {
      modal: $('board-modal'), btn: $('board-btn'),
      tabs: $('board-tabs'),
      colors: $('board-colors'),
      input: $('board-input'), send: $('board-send'),
      editCancel: $('board-edit-cancel'),
      count: $('board-count'), error: $('board-error'),
      list: $('board-list'), detail: $('board-detail')
    };
    // 목록 화면에서만 보이는 것들(상세로 들어가면 감춘다)
    this.el.write = this.el.modal.querySelector('.board-write');
    this.posts = [];
    this.openId = null;      // 상세로 열려 있는 글 id (없으면 목록)
    this.editingId = null;   // 수정 중인 글 id (없으면 새 글 쓰기)
    this.tab = 'patch';      // 지금 보고 있는 칸 (기본: 패치노트)
    this.writeCat = 'patch'; // 글을 올릴 칸 = 보고 있는 탭(수정 중엔 그 글의 칸)

    this.el.btn.addEventListener('click', () => this.open());
    $('board-close').addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => { if (e.target === this.el.modal) this.close(); });
    this.el.send.addEventListener('click', () => this.submit());
    this.el.editCancel.addEventListener('click', () => this.exitEdit());
    this.el.input.addEventListener('input', () => {
      this.el.count.textContent = `${[...this.el.input.value].length} / ${this.el.input.maxLength}`;
      this.el.error.textContent = '';
    });
    // Ctrl+Enter 로도 보낸다
    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); }
    });

    // 탭 누르면 그 칸으로 거르고, 글도 그 칸으로 올라간다.
    for (const b of this.el.tabs.querySelectorAll('button')) {
      b.addEventListener('click', () => this.setTab(b.dataset.cat));
    }

    this.buildPalette();
  }

  async open() {
    this.el.modal.classList.remove('hidden');
    this.el.error.textContent = '';
    this.showList();
    this.el.list.innerHTML = '<li class="board-empty">불러오는 중…</li>';
    try { this.render(await this.h.list()); }
    catch { this.el.list.innerHTML = '<li class="board-empty">불러오지 못했습니다.</li>'; }
  }

  close() { this.el.modal.classList.add('hidden'); this.exitEdit(); this.showList(); }

  // ── 탭(칸) ───────────────────────────────────────────
  setTab(cat) {
    this.tab = cat;
    for (const b of this.el.tabs.querySelectorAll('button')) {
      b.classList.toggle('current', b.dataset.cat === cat);
    }
    // 수정 중이 아니면 글을 올릴 칸을 보고 있는 탭으로 맞춘다.
    if (!this.editingId) {
      this.writeCat = cat;
      this.syncWriteMode();
    }
    this.showList();
    this.render(this.posts);
  }

  // 올릴 칸이 패치노트면 색 팔레트를 보이고 길이 제한을 늘린다.
  syncWriteMode() {
    const isPatch = this.writeCat === 'patch';
    this.el.colors.classList.toggle('hidden', !isPatch);
    this.el.input.maxLength = isPatch ? 6000 : 200;
    this.el.input.placeholder = isPatch
      ? '패치노트를 적으세요. 글자를 선택하고 색을 눌러 색을 입힐 수 있어요.'
      : '자유롭게 남겨 보세요 (200자)';
    this.el.count.textContent = `${[...this.el.input.value].length} / ${this.el.input.maxLength}`;
  }

  // ── 화면 전환 ─────────────────────────────────────────
  showList() {
    this.openId = null;
    this.el.detail.classList.add('hidden');
    this.el.tabs.classList.remove('hidden');
    // 패치노트 칸은 일반 사용자에겐 읽기 전용 — 입력칸을 숨겨 공지만 보게 한다.
    // (관리자는 패치노트를 써야 하므로 입력칸을 유지한다.)
    const canWriteHere = this.tab !== 'patch' || this.h.isAdmin();
    this.el.write.classList.toggle('hidden', !canWriteHere);
    this.el.list.classList.remove('hidden');
  }

  backToList() {
    this.showList();
    this.render(this.posts);
  }

  openDetail(id) {
    this.openId = id;
    this.el.tabs.classList.add('hidden');
    this.el.write.classList.add('hidden');
    this.el.list.classList.add('hidden');
    this.el.detail.classList.remove('hidden');
    this.renderDetail();
    this.el.detail.scrollTop = 0;
  }

  // ── 새 원글 올리기 / 수정 저장(목록 상단 입력칸) ─────────
  async submit() {
    const body = this.el.input.value.trim();
    if (!body) { this.el.error.textContent = '내용을 입력해 주세요.'; return; }
    this.el.send.disabled = true;
    try {
      let posts, targetTab;
      if (this.editingId) {
        posts = await this.h.edit(this.editingId, body);
      } else {
        posts = await this.h.post(body, null, this.writeCat);
        targetTab = this.writeCat;       // 방금 쓴 칸으로 탭을 옮겨 보이게
      }
      this.el.error.textContent = '';
      this.exitEdit();                    // 입력칸·버튼 라벨을 원래대로
      if (targetTab) this.setTab(targetTab);
      this.render(posts);
    } catch (err) {
      this.el.error.textContent = err.message;
    } finally {
      this.el.send.disabled = false;
    }
  }

  // 관리자: 글을 상단 입력칸으로 불러와 본문을 고친다. 칸·작성자·시각은 그대로.
  enterEdit(post) {
    this.editingId = post.id;
    this.writeCat = post.category || 'chat';   // 수정은 그 글의 칸을 그대로 유지
    this.showList();                      // 상세에서 눌렀을 수 있으니 목록 화면으로
    this.syncWriteMode();                 // 그 칸에 맞는 색 팔레트·길이 제한
    this.el.input.value = post.body;
    this.el.count.textContent = `${[...post.body].length} / ${this.el.input.maxLength}`;
    this.el.send.textContent = '수정 저장';
    this.el.editCancel.classList.remove('hidden');
    this.el.error.textContent = '';
    this.el.write.scrollIntoView({ block: 'nearest' });
    this.el.input.focus();
  }

  // 수정 모드 해제(취소·저장 후·창 닫기).
  exitEdit() {
    if (!this.editingId) return;
    this.editingId = null;
    this.writeCat = this.tab;              // 다시 보고 있는 탭 기준으로
    this.el.input.value = '';
    this.el.send.textContent = '남기기';
    this.el.editCancel.classList.add('hidden');
    this.syncWriteMode();
  }

  async remove(id) {
    if (!confirm('이 글을 지웁니다.')) return;
    try { this.render(await this.h.remove(id)); }
    catch (err) { this.el.error.textContent = err.message; }
  }

  // ── 목록 ─────────────────────────────────────────────
  render(posts) {
    this.posts = posts ?? [];
    // 상세를 보고 있으면 그쪽을 갱신한다(댓글을 달고 돌아온 경우 등)
    if (this.openId) { this.renderDetail(); return; }

    const shown = this.posts.filter((p) => (p.category || 'chat') === this.tab);

    if (shown.length === 0) {
      this.el.list.innerHTML = '<li class="board-empty">이 칸에는 아직 글이 없습니다.</li>';
      return;
    }
    const admin = this.h.isAdmin();
    this.el.list.innerHTML = '';
    for (const p of shown) {
      const cat = CATS[p.category] || CATS.chat;
      const li = document.createElement('li');
      li.className = `board-post board-post-link ${cat.cls}`;
      if (p.category === 'patch') {
        li.classList.add('patch-card');
        this.fillPatchCard(li, p, admin);
      } else {
        li.appendChild(this.postHead(p, admin, true));
        li.appendChild(this.postBody(p));
      }

      // 댓글 수(말풍선).
      const meta = document.createElement('div');
      meta.className = 'board-actions';
      meta.innerHTML = `<span class="board-cmt"><span class="board-cmt-ico">💬</span> ${(p.replies?.length ?? 0)}</span>`;
      li.appendChild(meta);

      li.addEventListener('click', () => this.openDetail(p.id));
      this.el.list.appendChild(li);
    }
  }

  // ── 상세(글 하나 + 댓글) ──────────────────────────────
  renderDetail() {
    const p = this.posts.find((x) => x.id === this.openId);
    if (!p) { this.backToList(); return; }   // 지워졌으면 목록으로
    const admin = this.h.isAdmin();
    const replies = p.replies ?? [];
    const cat = CATS[p.category] || CATS.chat;
    const d = this.el.detail;
    d.innerHTML = '';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'board-back';
    back.textContent = '← 목록';
    back.addEventListener('click', () => this.backToList());
    d.appendChild(back);

    const art = document.createElement('article');
    art.className = `board-detail-post ${cat.cls}`;
    if (p.category === 'patch') {
      art.classList.add('patch-card');
      this.fillPatchCard(art, p, admin);
    } else {
      art.appendChild(this.postHead(p, admin, true));
      art.appendChild(this.postBody(p));
    }
    const actions = document.createElement('div');
    actions.className = 'board-detail-actions';
    actions.innerHTML = `<span class="board-cmt"><span class="board-cmt-ico">💬</span> ${replies.length}</span>`;
    art.appendChild(actions);
    d.appendChild(art);

    const sec = document.createElement('div');
    sec.className = 'board-comments-sec';
    const title = document.createElement('h3');
    title.className = 'board-comments-title';
    title.textContent = `댓글 ${replies.length}`;
    sec.appendChild(title);

    if (replies.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'board-empty';
      empty.textContent = '첫 댓글을 남겨보세요.';
      sec.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'board-comments';
      for (const r of replies) {
        const li = document.createElement('li');
        li.className = 'board-comment';
        li.appendChild(this.postHead(r, admin, false));
        li.appendChild(this.postBody(r));
        ul.appendChild(li);
      }
      sec.appendChild(ul);
    }
    d.appendChild(sec);

    d.appendChild(this.commentForm(p.id));
  }

  // ── 공용 조각 ────────────────────────────────────────
  // 관리자 버튼 묶음(수정·삭제). withEdit 면 수정도 붙인다(원글만).
  adminTools(p, withEdit) {
    const tools = document.createElement('span');
    tools.className = 'board-tools';
    if (withEdit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'board-edit';
      edit.textContent = '수정';
      edit.addEventListener('click', (e) => { e.stopPropagation(); this.enterEdit(p); });
      tools.appendChild(edit);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'board-del';
    del.textContent = '삭제';
    // 목록 카드는 눌러서 상세로 가므로, 버튼 클릭이 상세를 열지 않게 막는다.
    del.addEventListener('click', (e) => { e.stopPropagation(); this.remove(p.id); });
    tools.appendChild(del);
    return tools;
  }

  // 글 머리(칸 뱃지·이름·시간·수정·삭제). withBadge 면 칸 뱃지를 붙인다(원글만).
  postHead(p, admin, withBadge) {
    const head = document.createElement('div');
    head.className = 'board-post-head';
    const cat = CATS[p.category];
    const badge = (withBadge && cat)
      ? `<span class="board-cat-badge ${cat.cls}">${cat.icon} ${esc(cat.label)}</span>` : '';
    head.innerHTML = badge +
      `<span class="board-name${p.member ? ' member' : ''}">${esc(p.name)}</span>` +
      `<span class="board-time">${ago(p.at)}</span>`;
    if (admin) head.appendChild(this.adminTools(p, withBadge));
    return head;
  }

  postBody(p) {
    const body = document.createElement('div');
    body.className = 'board-body';
    // 본문은 colorize 가 escape 하고 {색|글자}만 색 span 으로, 개행은 <br> 로.
    body.innerHTML = colorize(p.body);
    return body;
  }

  // 패치노트 카드 속을 채운다. 뱃지·작성자·시간 줄은 빼고, 본문 첫 줄을
  // 날짜 제목으로 크게, 나머지를 내용으로 보여 준다. 관리자 버튼은 우상단.
  fillPatchCard(container, p, admin) {
    if (admin) container.appendChild(this.adminTools(p, true));
    const nl = p.body.indexOf('\n');
    const dateLine = nl === -1 ? p.body : p.body.slice(0, nl);
    const rest = nl === -1 ? '' : p.body.slice(nl + 1);

    const date = document.createElement('div');
    date.className = 'patch-date';
    date.innerHTML = colorize(dateLine);
    container.appendChild(date);

    if (rest.trim()) {
      const body = document.createElement('div');
      body.className = 'board-body';
      body.innerHTML = colorize(rest);
      container.appendChild(body);
    }
  }

  // 색 팔레트(패치노트 쓸 때만 보인다). 선택한 글자에 {색|..} 을 씌운다.
  buildPalette() {
    const bar = this.el.colors;
    if (!bar || bar.dataset.built) return;
    bar.dataset.built = '1';
    const make = (key, bg, text, cls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'patch-swatch'; b.title = text || key || '서식 지우기';
      if (cls) b.classList.add(cls);
      if (bg) b.style.background = bg; else { b.classList.add('clear'); b.textContent = text; }
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.applyStyle(key); });
      bar.appendChild(b);
    };
    for (const name of PALETTE) make(name, COLOR_NAMES[name]);
    make('검정', COLOR_NAMES['검정']);   // 검정 색(어두운 배경이라 테두리로 보이게)
    make('굵게', null, '가', 'bold');    // 굵게 토글(색과 함께 쓸 수 있다)
    make(null, null, '기본');            // 모든 서식 지우기
  }

  // 선택한 글자에 서식을 씌운다. 색은 하나만(바꾸면 교체), 굵게는 토글.
  // 색과 굵게는 '{빨강+굵게|글자}' 처럼 함께 쓸 수 있어 서로 지우지 않는다.
  // key=null 이면 '기본' — 선택 안의 모든 서식을 벗긴다.
  applyStyle(key) {
    const input = this.el.input;
    const a = input.selectionStart, b = input.selectionEnd;
    if (a === b) return;                       // 선택한 게 없으면 아무것도 안 함
    const before = input.value.slice(0, a);
    const after = input.value.slice(b);
    // 선택 안의 기존 토큰에서 키(색·굵게)를 모으고 글자만 남긴다.
    let keys = [];
    const sel = input.value.slice(a, b).replace(
      /\{(#[0-9a-fA-F]{3,6}|[가-힣A-Za-z]+(?:\+[가-힣A-Za-z]+)*)\|([^}]*)\}/g,
      (_mm, k, t) => { keys.push(...k.split('+')); return t; });

    if (key === null) {
      keys = [];                               // 기본: 서식 모두 지우기
    } else if (isStyleKey(key)) {
      keys = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
    } else {                                   // 색: 기존 색은 빼고 새 색으로
      keys = keys.filter((k) => !toColor(k));
      keys.push(key);
    }
    const spec = keys.join('+');
    input.value = before + (spec ? `{${spec}|${sel}}` : sel) + after;
    const innerStart = before.length + (spec ? `{${spec}|`.length : 0);
    input.focus();
    input.selectionStart = innerStart;
    input.selectionEnd = innerStart + sel.length;
    this.el.count.textContent = `${[...input.value].length} / ${input.maxLength}`;
  }

  // 상세 하단 댓글 입력칸.
  commentForm(parentId) {
    const form = document.createElement('div');
    form.className = 'board-comment-form';
    const ta = document.createElement('textarea');
    ta.maxLength = 200;
    ta.rows = 2;
    ta.placeholder = '댓글을 남겨 보세요 (200자)';
    const row = document.createElement('div');
    row.className = 'board-write-row';
    const err = document.createElement('em');
    err.className = 'field-error';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary small';
    btn.textContent = '댓글';
    row.appendChild(err);
    row.appendChild(btn);
    form.appendChild(ta);
    form.appendChild(row);

    const send = () => this.submitComment(parentId, ta, err, btn);
    btn.addEventListener('click', send);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });
    return form;
  }

  async submitComment(parentId, textarea, errEl, btn) {
    const body = textarea.value.trim();
    if (!body) { errEl.textContent = '내용을 입력해 주세요.'; return; }
    btn.disabled = true;
    try {
      const posts = await this.h.post(body, parentId);
      this.render(posts);   // openId 가 살아 있으므로 상세가 갱신된다
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  }
}
