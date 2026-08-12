// 키보드 + 터치 입력을 하나의 {move, jumpPressed} 형태로 합친다.
// move.y 는 화면 위쪽이 양수.
//
// 화면을 강제로 가로로 돌렸을 때(아이폰 세로)는 터치 좌표도 함께 돌려야
// 조이스틱이 올바른 방향으로 움직인다. toLocal() 이 화면 좌표를 회전된
// 화면의 로컬 좌표로 되돌린다. 안 돌렸으면 그대로 반환한다.

import { toLocal } from './orientation.js';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyK: 'jump', KeyZ: 'jump'
};

export class Input {
  constructor() {
    this.keys = { up: false, down: false, left: false, right: false };
    this.move = { x: 0, y: 0 };
    this.jumpPressed = false;
    this.jumpQueued = false;
    this.enabled = false;

    this.touch = { id: null, x: 0, y: 0, dx: 0, dy: 0 };

    this.bindKeyboard();
    this.bindTouch();
  }

  bindKeyboard() {
    addEventListener('keydown', (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (this.enabled) e.preventDefault();
      if (action === 'jump') {
        if (!e.repeat) this.jumpQueued = true;
      } else {
        this.keys[action] = true;
      }
    });

    addEventListener('keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (action && action !== 'jump') this.keys[action] = false;
    });

    // 창에서 포커스가 빠지면 키가 눌린 채로 남는 걸 막는다
    addEventListener('blur', () => this.releaseAll());
  }

  bindTouch() {
    const stickZone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const jumpZone = document.getElementById('jump-zone');
    const jumpBtn = document.getElementById('jump-btn');
    if (!stickZone || !jumpZone) return;

    const RANGE = 46; // 최대 기울기 픽셀

    const start = (e) => {
      const t = e.changedTouches[0];
      const p = toLocal(t.clientX, t.clientY);
      this.touch.id = t.identifier;
      this.touch.x = p.x;
      this.touch.y = p.y;
      base.style.left = `${p.x}px`;
      base.style.top = `${p.y}px`;
      base.classList.add('on');
      knob.style.transform = 'translate(0,0)';
      e.preventDefault();
    };

    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.id) continue;
        const p = toLocal(t.clientX, t.clientY);
        let dx = p.x - this.touch.x;
        let dy = p.y - this.touch.y;
        const d = Math.hypot(dx, dy);
        if (d > RANGE) {
          dx = (dx / d) * RANGE;
          dy = (dy / d) * RANGE;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;

        // 데드존(4px) 밖이면 기울기에 비례해 속도를 준다.
        // RANGE의 55% 만 기울여도 최고 속도가 나오게 해서 조작이 답답하지 않다.
        if (d > 4) {
          const clamped = Math.hypot(dx, dy) || 1;
          const mag = Math.min(1, d / (RANGE * 0.55));
          this.touch.dx = (dx / clamped) * mag;
          this.touch.dy = (dy / clamped) * mag;
        } else {
          this.touch.dx = 0;
          this.touch.dy = 0;
        }
      }
      e.preventDefault();
    };

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.id) continue;
        this.touch.id = null;
        this.touch.dx = 0;
        this.touch.dy = 0;
        base.classList.remove('on');
      }
    };

    stickZone.addEventListener('touchstart', start, { passive: false });
    stickZone.addEventListener('touchmove', move, { passive: false });
    stickZone.addEventListener('touchend', end);
    stickZone.addEventListener('touchcancel', end);

    jumpZone.addEventListener('touchstart', (e) => {
      this.jumpQueued = true;
      jumpBtn.classList.add('on');
      e.preventDefault();
    }, { passive: false });

    const jumpOff = () => jumpBtn.classList.remove('on');
    jumpZone.addEventListener('touchend', jumpOff);
    jumpZone.addEventListener('touchcancel', jumpOff);
  }

  releaseAll() {
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
    this.touch.id = null;
    this.touch.dx = this.touch.dy = 0;
  }

  // 매 프레임 시작에 한 번 호출. 눌림 이벤트를 이번 프레임 것으로 확정한다.
  poll() {
    let x = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    let y = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);

    if (this.touch.id !== null) {
      x += this.touch.dx;
      y += -this.touch.dy; // 터치 y는 아래가 양수
    }

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;

    this.jumpPressed = this.jumpQueued;
    this.jumpQueued = false;
    return this;
  }
}
