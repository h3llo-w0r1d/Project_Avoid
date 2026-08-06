// 랭킹 관리 화면.
//
// 열쇠는 sessionStorage 에만 둔다. 탭을 닫으면 사라지므로
// 공용 컴퓨터에 남지 않는다.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'avoidarc.adminToken';

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let entries = [];

// ---------------------------------------------------------------- 통신

async function call(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...options.headers, 'x-admin-token': token }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------- 화면

function notify(text, isError = false) {
  const el = $('notice');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

const fmtTime = (t) => `${Number(t).toFixed(2)}s`;

function fmtWhen(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '-';
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// 다른 기록에 비해 유독 튀는 값을 표시한다.
// 조작 판정이 아니라 "눈으로 확인해 보라"는 표시일 뿐이다.
function suspectThreshold(list) {
  if (list.length < 5) return Infinity;
  const times = list.map((e) => e.time).sort((a, b) => a - b);
  const median = times[times.length >> 1];
  return Math.max(median * 4, 180);
}

function render() {
  const rows = $('rows');
  rows.innerHTML = '';

  $('summary').textContent = `기록 ${entries.length}개`;

  if (entries.length === 0) {
    rows.innerHTML = '<tr><td colspan="5" class="empty-row">기록이 없습니다</td></tr>';
    return;
  }

  const limit = suspectThreshold(entries);

  entries.forEach((e, i) => {
    const tr = document.createElement('tr');
    if (e.time >= limit) tr.className = 'suspect';

    tr.innerHTML = `
      <td class="rank">${i + 1}</td>
      <td class="who"></td>
      <td class="time">${fmtTime(e.time)}</td>
      <td class="when">${fmtWhen(e.at)}</td>
      <td><button class="del-btn" type="button">삭제</button></td>`;

    // 닉네임은 textContent 로만 넣는다. innerHTML 로 넣으면
    // 이름에 넣은 태그가 이 화면에서 실행된다.
    tr.querySelector('.who').textContent = e.name;
    if (e.time >= limit) {
      const flag = document.createElement('span');
      flag.className = 'flag';
      flag.textContent = '확인 필요';
      tr.querySelector('.who').appendChild(flag);
    }

    tr.querySelector('.del-btn').addEventListener('click', (ev) => remove(e, ev.target));
    rows.appendChild(tr);
  });
}

// ---------------------------------------------------------------- 동작

async function load() {
  try {
    entries = await call('/api/admin/scores');
    render();
    notify('');
  } catch (err) {
    if (/HTTP 401|열쇠/.test(err.message)) {
      showLogin('관리자 열쇠가 올바르지 않습니다.');
      return;
    }
    notify(`불러오지 못했습니다: ${err.message}`, true);
  }
}

async function remove(entry, button) {
  if (!confirm(`"${entry.name}" 의 ${fmtTime(entry.time)} 기록을 지웁니다.`)) return;

  button.disabled = true;
  try {
    await call(`/api/admin/scores/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    entries = entries.filter((e) => e.id !== entry.id);
    render();
    notify(`"${entry.name}" ${fmtTime(entry.time)} 기록을 지웠습니다.`);
  } catch (err) {
    button.disabled = false;
    notify(`삭제 실패: ${err.message}`, true);
  }
}

async function clearAll() {
  if (entries.length === 0) return;
  if (!confirm(`기록 ${entries.length}개를 모두 지웁니다. 되돌릴 수 없습니다.`)) return;
  if (prompt('정말 지우려면 DELETE ALL 을 입력하세요.') !== 'DELETE ALL') {
    notify('취소했습니다.');
    return;
  }

  try {
    const r = await call('/api/admin/scores/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE ALL' })
    });
    entries = [];
    render();
    notify(`${r.removed}개를 모두 지웠습니다.`);
  } catch (err) {
    notify(`삭제 실패: ${err.message}`, true);
  }
}

function showLogin(message = '') {
  $('login').classList.remove('hidden');
  $('board').classList.add('hidden');
  $('login-error').textContent = message;
  $('token').focus();
}

function showBoard() {
  $('login').classList.add('hidden');
  $('board').classList.remove('hidden');
}

async function signIn() {
  token = $('token').value.trim();
  if (!token) {
    $('login-error').textContent = '열쇠를 입력해 주세요.';
    return;
  }
  try {
    entries = await call('/api/admin/scores');
    sessionStorage.setItem(TOKEN_KEY, token);
    showBoard();
    render();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
}

$('login-btn').addEventListener('click', signIn);
$('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
$('refresh-btn').addEventListener('click', load);
$('clear-btn').addEventListener('click', clearAll);

// 이미 열쇠가 있으면 바로 들어간다
if (token) {
  showBoard();
  load();
} else {
  showLogin();
}
