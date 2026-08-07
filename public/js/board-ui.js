// 자유 게시판 창.
//
// 서버가 신원·욕설·길이·도배를 막지만, 화면에 그릴 때 반드시 escape 한다.
// 남이 쓴 글을 그대로 innerHTML 에 넣으면 <script> 가 실행된다.

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
    this.h = handlers;       // { list, post, remove, isAdmin, canWrite }
    this.el = {
      modal: $('board-modal'), btn: $('board-btn'),
      input: $('board-input'), send: $('board-send'),
      count: $('board-count'), error: $('board-error'),
      list: $('board-list')
    };
    this.posts = [];

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
    this.el.list.innerHTML = '<li class="board-empty">불러오는 중…</li>';
    try { this.render(await this.h.list()); }
    catch { this.el.list.innerHTML = '<li class="board-empty">불러오지 못했습니다.</li>'; }
  }

  close() { this.el.modal.classList.add('hidden'); }

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

  render(posts) {
    this.posts = posts ?? [];
    const admin = this.h.isAdmin();
    if (this.posts.length === 0) {
      this.el.list.innerHTML = '<li class="board-empty">아직 글이 없습니다. 첫 글을 남겨 보세요!</li>';
      return;
    }
    this.el.list.innerHTML = '';
    for (const p of this.posts) {
      const li = document.createElement('li');
      li.className = 'board-post';
      // 본문은 escape 한 뒤 개행만 <br> 로. 순서를 바꾸면 태그가 살아난다.
      const bodyHtml = esc(p.body).replace(/\n/g, '<br>');
      li.innerHTML = `
        <div class="board-post-head">
          <span class="board-name${p.member ? ' member' : ''}">${esc(p.name)}</span>
          <span class="board-time">${ago(p.at)}</span>
        </div>
        <div class="board-body">${bodyHtml}</div>`;
      if (admin) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'board-del';
        del.textContent = '삭제';
        del.addEventListener('click', () => this.remove(p.id));
        li.querySelector('.board-post-head').appendChild(del);
      }
      this.el.list.appendChild(li);
    }
  }
}
