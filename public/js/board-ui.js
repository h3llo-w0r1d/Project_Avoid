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
const COLOR_NAMES = {
  빨강: '#ff5566', 빨간: '#ff5566', red: '#ff5566',
  주황: '#ff9f43', orange: '#ff9f43',
  노랑: '#ffd54a', yellow: '#ffd54a',
  초록: '#57d18a', 녹색: '#57d18a', green: '#57d18a',
  파랑: '#4f8bff', 파란: '#4f8bff', blue: '#4f8bff',
  하늘: '#4fd6ff', cyan: '#4fd6ff',
  보라: '#b57bff', purple: '#b57bff',
  분홍: '#ff7eb6', pink: '#ff7eb6',
  회색: '#9aa4bf', gray: '#9aa4bf', grey: '#9aa4bf',
  흰색: '#ffffff', white: '#ffffff'
};
const toColor = (key) =>
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(key)
    ? key : (COLOR_NAMES[key] || COLOR_NAMES[key.toLowerCase()] || null);

// 문장 속 {색|부분} 을 그 색 span 으로. 색이 아니면 토큰을 글자 그대로 둔다.
// 나머지는 전부 escape 하고 개행만 <br>.
function colorize(s) {
  const re = /\{(#[0-9a-fA-F]{3,6}|[가-힣A-Za-z]+)\|([^}]*)\}/g;
  let out = '', last = 0, m;
  const put = (t) => esc(t).replace(/\n/g, '<br>');
  while ((m = re.exec(s))) {
    out += put(s.slice(last, m.index));
    const color = toColor(m[1]);
    out += color ? `<span style="color:${color}">${put(m[2])}</span>` : put(m[0]);
    last = m.index + m[0].length;
  }
  return out + put(s.slice(last));
}

const PALETTE = ['빨강', '주황', '노랑', '초록', '파랑', '하늘', '보라', '분홍', '회색'];

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
      cat: $('board-cat'), colors: $('board-colors'),
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
    this.patchReady = false; // 관리자 선택지(패치노트)를 넣었는지

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

    // 탭 누르면 그 칸으로 거른다. 쓰기 칸의 기본 선택도 맞춘다.
    for (const b of this.el.tabs.querySelectorAll('button')) {
      b.addEventListener('click', () => this.setTab(b.dataset.cat));
    }
    // 쓰기 칸을 바꾸면 색 팔레트·글자수 제한을 그에 맞춘다.
    this.el.cat.addEventListener('change', () => this.syncWriteMode());

    this.buildPalette();
  }

  async open() {
    this.el.modal.classList.remove('hidden');
    this.el.error.textContent = '';
    this.ensurePatchOption();
    this.showList();
    this.el.list.innerHTML = '<li class="board-empty">불러오는 중…</li>';
    try { this.render(await this.h.list()); }
    catch { this.el.list.innerHTML = '<li class="board-empty">불러오지 못했습니다.</li>'; }
  }

  close() { this.el.modal.classList.add('hidden'); this.exitEdit(); this.showList(); }

  // 관리자면 쓰기 칸에 '패치노트' 선택지를 한 번만 추가한다.
  ensurePatchOption() {
    if (this.patchReady || !this.h.isAdmin()) return;
    const opt = document.createElement('option');
    opt.value = 'patch';
    opt.textContent = '📢 패치노트';
    this.el.cat.insertBefore(opt, this.el.cat.firstChild);
    this.patchReady = true;
  }

  // ── 탭(칸) ───────────────────────────────────────────
  setTab(cat) {
    this.tab = cat;
    for (const b of this.el.tabs.querySelectorAll('button')) {
      b.classList.toggle('current', b.dataset.cat === cat);
    }
    // 수정 중이면 쓰기 칸(입력·칸 선택)은 건드리지 않는다.
    if (!this.editingId) {
      // 보고 있는 칸으로 바로 쓰게 기본 선택을 맞춘다(쓸 수 있는 칸일 때만).
      if ([...this.el.cat.options].some((o) => o.value === cat)) {
        this.el.cat.value = cat;
      }
      this.syncWriteMode();
    }
    this.showList();
    this.render(this.posts);
  }

  // 쓰기 칸이 패치노트면 색 팔레트를 보이고 길이 제한을 늘린다.
  syncWriteMode() {
    const isPatch = this.el.cat.value === 'patch';
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
    this.el.write.classList.remove('hidden');
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
        posts = await this.h.post(body, null, this.el.cat.value);
        targetTab = this.el.cat.value;   // 방금 쓴 칸으로 탭을 옮겨 보이게
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
    this.showList();                      // 상세에서 눌렀을 수 있으니 목록 화면으로
    const cat = post.category || 'chat';
    if ([...this.el.cat.options].some((o) => o.value === cat)) this.el.cat.value = cat;
    this.el.cat.disabled = true;          // 수정은 칸을 바꾸지 않는다
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
    this.el.cat.disabled = false;
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
      li.appendChild(this.postHead(p, admin, true));
      li.appendChild(this.postBody(p));

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
    art.appendChild(this.postHead(p, admin, true));
    art.appendChild(this.postBody(p));
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
  // 글 머리(칸 뱃지·이름·시간·삭제). withBadge 면 칸 뱃지를 붙인다(원글만).
  postHead(p, admin, withBadge) {
    const head = document.createElement('div');
    head.className = 'board-post-head';
    const cat = CATS[p.category];
    const badge = (withBadge && cat)
      ? `<span class="board-cat-badge ${cat.cls}">${cat.icon} ${esc(cat.label)}</span>` : '';
    head.innerHTML = badge +
      `<span class="board-name${p.member ? ' member' : ''}">${esc(p.name)}</span>` +
      `<span class="board-time">${ago(p.at)}</span>`;
    if (admin) {
      const tools = document.createElement('span');
      tools.className = 'board-tools';
      // 수정 버튼은 원글에만(withBadge 로 원글 여부를 안다). 댓글은 지우기만.
      if (withBadge) {
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
      head.appendChild(tools);
    }
    return head;
  }

  postBody(p) {
    const body = document.createElement('div');
    body.className = 'board-body';
    // 본문은 colorize 가 escape 하고 {색|글자}만 색 span 으로, 개행은 <br> 로.
    body.innerHTML = colorize(p.body);
    return body;
  }

  // 색 팔레트(패치노트 쓸 때만 보인다). 선택한 글자에 {색|..} 을 씌운다.
  buildPalette() {
    const bar = this.el.colors;
    if (!bar || bar.dataset.built) return;
    bar.dataset.built = '1';
    const make = (name, bg, text) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'patch-swatch'; b.title = name || '색 지우기';
      if (bg) b.style.background = bg; else { b.classList.add('clear'); b.textContent = text; }
      b.addEventListener('mousedown', (e) => { e.preventDefault(); this.applyColor(name); });
      bar.appendChild(b);
    };
    for (const name of PALETTE) make(name, COLOR_NAMES[name]);
    make(null, null, '기본');
  }

  // 선택 안의 기존 색 토큰을 벗긴다(중첩 방지).
  applyColor(name) {
    const input = this.el.input;
    const a = input.selectionStart, b = input.selectionEnd;
    if (a === b) return;                       // 선택한 게 없으면 아무것도 안 함
    const strip = (s) => s.replace(/\{(?:#[0-9a-fA-F]{3,6}|[가-힣A-Za-z]+)\|([^}]*)\}/g, '$1');
    const before = input.value.slice(0, a);
    const sel = strip(input.value.slice(a, b));
    const after = input.value.slice(b);
    input.value = before + (name ? `{${name}|${sel}}` : sel) + after;
    const innerStart = before.length + (name ? `{${name}|`.length : 0);
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
