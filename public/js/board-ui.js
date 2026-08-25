// 자유 게시판 창.
//
// 서버가 신원·욕설·길이·도배를 막지만, 화면에 그릴 때 반드시 escape 한다.
// 남이 쓴 글을 그대로 innerHTML 에 넣으면 <script> 가 실행된다.
//
// 두 화면을 오간다.
//  - 목록: 글 카드들. 카드를 누르면 상세로 들어간다. 카드에는 💬 댓글 수만.
//  - 상세: 글 하나를 크게 + 그 밑에 댓글 목록과 댓글 입력칸.
// 댓글(답글)은 한 단계만 — 상세에서만 달 수 있고 원글에 붙는다.

const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
      input: $('board-input'), send: $('board-send'),
      count: $('board-count'), error: $('board-error'),
      list: $('board-list'), detail: $('board-detail')
    };
    // 목록 화면에서만 보이는 것들(상세로 들어가면 감춘다)
    this.el.hint = this.el.modal.querySelector('.board-hint');
    this.el.write = this.el.modal.querySelector('.board-write');
    this.posts = [];
    this.openId = null;      // 상세로 열려 있는 글 id (없으면 목록)

    this.el.btn.addEventListener('click', () => this.open());
    $('board-close').addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => { if (e.target === this.el.modal) this.close(); });
    this.el.send.addEventListener('click', () => this.submit());
    this.el.input.addEventListener('input', () => {
      this.el.count.textContent = `${[...this.el.input.value].length} / 200`;
      this.el.error.textContent = '';
    });
    // Ctrl+Enter 로도 보낸다
    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); }
    });
  }

  async open() {
    this.el.modal.classList.remove('hidden');
    this.el.error.textContent = '';
    this.showList();
    this.el.list.innerHTML = '<li class="board-empty">불러오는 중…</li>';
    try { this.render(await this.h.list()); }
    catch { this.el.list.innerHTML = '<li class="board-empty">불러오지 못했습니다.</li>'; }
  }

  close() { this.el.modal.classList.add('hidden'); this.showList(); }

  // ── 화면 전환 ─────────────────────────────────────────
  showList() {
    this.openId = null;
    this.el.detail.classList.add('hidden');
    this.el.hint.classList.remove('hidden');
    this.el.write.classList.remove('hidden');
    this.el.list.classList.remove('hidden');
  }

  backToList() {
    this.showList();
    this.render(this.posts);
  }

  openDetail(id) {
    this.openId = id;
    this.el.hint.classList.add('hidden');
    this.el.write.classList.add('hidden');
    this.el.list.classList.add('hidden');
    this.el.detail.classList.remove('hidden');
    this.renderDetail();
    this.el.detail.scrollTop = 0;
  }

  // ── 새 원글 올리기(목록 상단 입력칸) ───────────────────
  async submit() {
    const body = this.el.input.value.trim();
    if (!body) { this.el.error.textContent = '내용을 입력해 주세요.'; return; }
    this.el.send.disabled = true;
    try {
      const posts = await this.h.post(body);
      this.el.input.value = '';
      this.el.count.textContent = '0 / 200';
      this.el.error.textContent = '';
      this.render(posts);
    } catch (err) {
      this.el.error.textContent = err.message;
    } finally {
      this.el.send.disabled = false;
    }
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

    if (this.posts.length === 0) {
      this.el.list.innerHTML = '<li class="board-empty">아직 글이 없습니다. 첫 글을 남겨 보세요!</li>';
      return;
    }
    const admin = this.h.isAdmin();
    this.el.list.innerHTML = '';
    for (const p of this.posts) {
      const li = document.createElement('li');
      li.className = 'board-post board-post-link';
      li.appendChild(this.postHead(p, admin));
      li.appendChild(this.postBody(p));

      // 댓글 수(말풍선). 답글 텍스트 버튼 대신 이 아이콘을 쓴다.
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
    const d = this.el.detail;
    d.innerHTML = '';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'board-back';
    back.textContent = '← 목록';
    back.addEventListener('click', () => this.backToList());
    d.appendChild(back);

    const art = document.createElement('article');
    art.className = 'board-detail-post';
    art.appendChild(this.postHead(p, admin));
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
        li.appendChild(this.postHead(r, admin));
        li.appendChild(this.postBody(r));
        ul.appendChild(li);
      }
      sec.appendChild(ul);
    }
    d.appendChild(sec);

    d.appendChild(this.commentForm(p.id));
  }

  // ── 공용 조각 ────────────────────────────────────────
  // 글 머리(이름·시간·삭제). 원글·댓글 공용.
  postHead(p, admin) {
    const head = document.createElement('div');
    head.className = 'board-post-head';
    head.innerHTML =
      `<span class="board-name${p.member ? ' member' : ''}">${esc(p.name)}</span>` +
      `<span class="board-time">${ago(p.at)}</span>`;
    if (admin) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'board-del';
      del.textContent = '삭제';
      // 목록 카드는 눌러서 상세로 가므로, 삭제 클릭이 상세를 열지 않게 막는다.
      del.addEventListener('click', (e) => { e.stopPropagation(); this.remove(p.id); });
      head.appendChild(del);
    }
    return head;
  }

  postBody(p) {
    const body = document.createElement('div');
    body.className = 'board-body';
    // 본문은 escape 한 뒤 개행만 <br> 로. 순서를 바꾸면 태그가 살아난다.
    body.innerHTML = esc(p.body).replace(/\n/g, '<br>');
    return body;
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
