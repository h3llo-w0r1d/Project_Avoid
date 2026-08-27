// 1v1 로비. WebSocket 연결을 받아 짝을 지어 주고, 대전을 굴린다.
//
// 방을 서버 메모리에만 둔다. 서버를 재시작하면 진행 중인 방은 사라지는데,
// 한 판이 길어야 2~3분이라 굳이 저장할 이유가 없다.

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { Match } from './arena-match.js';
import { GUEST_PATTERN } from '../public/js/profanity.js';

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 방 코드용 글자
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

const HEARTBEAT_MS = 25000;   // 죽은 연결을 걷어내는 주기

// users 를 넘기면 로그인한 사람의 승패를 기록한다. 없으면 그냥 안 남긴다.
export function attachLobby(httpServer, users = null, matchLog = null) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const clients = new Map();   // id -> client
  const rooms = new Map();     // code -> { code, host, guest }
  const matches = new Map();   // matchId -> Match
  let queue = [];              // 무작위 매칭 대기열 (client)

  // ---------------------------------------------------------------- 도구

  const send = (client, msg) => {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(msg));
  };

  function makeCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
      }
      if (!rooms.has(code)) return code;
    }
    // 거의 올 일이 없지만, 그래도 겹치면 길게 만든다
    return randomUUID().slice(0, 8).toUpperCase();
  }

  function leaveEverything(client) {
    queue = queue.filter((c) => c !== client);

    if (client.roomCode) {
      const room = rooms.get(client.roomCode);
      if (room) {
        if (room.host === client) {
          // 방장이 나가면 방을 없애고 손님을 내보낸다
          if (room.guest) {
            send(room.guest, { type: 'room-closed' });
            room.guest.roomCode = null;
          }
          rooms.delete(room.code);
        } else if (room.guest === client) {
          room.guest = null;
          send(room.host, { type: 'room-update', code: room.code, guest: null });
        }
      }
      client.roomCode = null;
    }

    if (client.matchId) {
      const match = matches.get(client.matchId);
      match?.forfeit(client.id);
      client.matchId = null;
    }
  }

  function beginMatch(a, b, mode) {
    const id = randomUUID();
    const seats = [a, b].map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      send: (text) => { if (c.socket.readyState === 1) c.socket.send(text); }
    }));

    const match = new Match(id, seats);
    match.onFinish = (finished) => {
      for (const c of [a, b]) if (c.matchId === id) c.matchId = null;
      matches.delete(id);
      recordResult(finished, a, b, mode);
    };

    matches.set(id, match);
    a.matchId = id;
    b.matchId = id;
    a.roomCode = null;
    b.roomCode = null;
    match.start();
  }

  // 로그인한 사람만 전적이 쌓인다. 게스트는 남길 곳이 없다.
  // 무승부면 아무것도 세지 않는다.
  function recordResult(match, a, b, mode) {
    if (!match.winnerId) return;
    const winner = [a, b].find((c) => c.id === match.winnerId);
    const loser = [a, b].find((c) => c.id !== match.winnerId);
    if (!winner?.userId && !loser?.userId) return;

    users?.recordMatch(winner?.userId ?? null, loser?.userId ?? null)
      .catch((err) => console.error('전적 기록 실패:', err));

    // 무엇이 있었는지도 남긴다. 승패 숫자만으로는 짜고 친 것인지
    // 알 수 없다 — 누구와 몇 초 동안 했는지가 판단의 근거다.
    const side = (c) => (c ? { userId: c.userId ?? null, name: c.name } : null);
    matchLog?.add({
      seconds: match.elapsed ?? 0,
      mode,
      winner: side(winner),
      loser: side(loser)
    }).catch((err) => console.error('대전 기록 저장 실패:', err));
  }

  // ---------------------------------------------------------------- 메시지

  const handlers = {
    hello(client, msg) {
      // 로그인한 사람의 이름은 서버가 안다. 브라우저가 보낸 이름은 무시한다.
      // 게스트도 Guest0000 형식만 받는다. 아무 이름이나 허용하면
      // 로그인한 사람의 닉네임을 그대로 적어 사칭할 수 있다.
      if (!client.userId) {
        const given = String(msg.name ?? '');
        client.name = GUEST_PATTERN.test(given) ? given : 'Guest0000';
      }
      if (typeof msg.character === 'string') client.character = msg.character.slice(0, 24);
      send(client, { type: 'hello', id: client.id, name: client.name });
    },

    // 캐릭터를 바꿨을 때. 다음 대전부터 상대에게 그대로 보인다.
    character(client, msg) {
      if (typeof msg.id === 'string') client.character = msg.id.slice(0, 24);
    },

    // 무작위 매칭 대기열에 들어간다
    'queue-join'(client) {
      if (client.matchId) return;
      if (queue.includes(client)) return;

      // 이미 기다리는 사람이 있으면 바로 붙인다
      const partner = queue.find((c) => c !== client && c.socket.readyState === 1);
      if (partner) {
        queue = queue.filter((c) => c !== partner);
        beginMatch(partner, client, 'queue');
        return;
      }

      queue.push(client);
      send(client, { type: 'queued', waiting: queue.length });
    },

    'queue-leave'(client) {
      queue = queue.filter((c) => c !== client);
      send(client, { type: 'queue-left' });
    },

    // 방을 만들어 코드를 받는다
    'room-create'(client) {
      if (client.matchId) return;
      leaveEverything(client);
      const code = makeCode();
      rooms.set(code, { code, host: client, guest: null });
      client.roomCode = code;
      send(client, { type: 'room-created', code });
    },

    // 코드로 방에 들어간다
    'room-join'(client, msg) {
      if (client.matchId) return;
      const code = String(msg.code ?? '').trim().toUpperCase();
      const room = rooms.get(code);

      if (!room) return send(client, { type: 'room-error', error: '그런 방이 없습니다.' });
      if (room.host === client) return send(client, { type: 'room-error', error: '내가 만든 방입니다.' });
      if (room.guest) return send(client, { type: 'room-error', error: '이미 두 명이 차 있습니다.' });

      leaveEverything(client);
      room.guest = client;
      client.roomCode = code;

      send(room.host, { type: 'room-update', code, guest: client.name });
      send(client, { type: 'room-joined', code, host: room.host.name });

      // 두 명이 모였으니 바로 시작한다
      rooms.delete(code);
      room.host.roomCode = null;
      room.guest.roomCode = null;
      beginMatch(room.host, room.guest, 'room');
    },

    'room-leave'(client) {
      leaveEverything(client);
      send(client, { type: 'room-left' });
    },

    // 대전 중 입력
    input(client, msg) {
      const match = matches.get(client.matchId);
      match?.applyInput(client.id, msg);
    },

    // 대전 도중 나가기
    'match-leave'(client) {
      if (!client.matchId) return;
      const match = matches.get(client.matchId);
      match?.forfeit(client.id);
      client.matchId = null;
    },

    ping(client, msg) {
      send(client, { type: 'pong', t: msg.t });
    }
  };

  // ---------------------------------------------------------------- 연결

  wss.on('connection', (socket, req) => {
    // WebSocket 업그레이드 요청에도 쿠키가 실려 온다.
    // 여기서 세션을 읽어 두면 대전이 끝났을 때 누구 전적인지 알 수 있다.
    const account = users ? users.userForToken(sessionToken(req)) : null;

    const client = {
      id: randomUUID(),
      userId: account?.id ?? null,
      name: account?.nickname ?? '익명',
      socket,
      roomCode: null,
      matchId: null,
      alive: true,
      lastSeen: Date.now()   // 마지막 '실제 활동' 시각(ping 은 빼고 센다)
    };
    clients.set(client.id, client);
    send(client, { type: 'hello', id: client.id, name: client.name });

    socket.on('pong', () => { client.alive = true; });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;   // 이상한 게 오면 그냥 무시한다
      }
      // ping(3초마다 자동)은 활동으로 치지 않는다 — 켜만 두고 가만있는 유령
      // 연결을 걸러내려는 것이므로, 실제 조작 메시지만 활동으로 본다.
      if (msg?.type && msg.type !== 'ping') client.lastSeen = Date.now();
      const handler = handlers[msg?.type];
      if (handler) {
        try {
          handler(client, msg);
        } catch (err) {
          console.error(`로비 처리 실패 (${msg.type}):`, err);
        }
      }
    });

    socket.on('close', () => {
      leaveEverything(client);
      clients.delete(client.id);
    });

    socket.on('error', () => socket.terminate());
  });

  // 끊긴 걸 모르는 연결이 대기열에 남아 상대를 못 만나는 일을 막는다
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      if (client.socket.readyState === 1) client.socket.ping();
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));

  // 쿠키 헤더에서 세션 토큰만 꺼낸다. WebSocket 에는 cookie-parser 가
  // 끼어들 자리가 없어서 직접 판다.
  function sessionToken(req) {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === 'session') return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  // 접속 현황처럼, 일정 시간 활동이 없는 유령 연결은 1v1 수에서 뺀다.
  // 대전·방·큐에 들어가 있으면 무조건 세고, 그 외에는 최근 활동만 센다.
  const ACTIVE_MS = 45_000;
  const isEngaged = (c, now) =>
    c.matchId || c.roomCode || queue.includes(c) || (now - c.lastSeen < ACTIVE_MS);

  return {
    stats: () => {
      const now = Date.now();
      let online = 0;
      for (const c of clients.values()) if (isEngaged(c, now)) online++;
      return {
        online,
        queued: queue.length,
        rooms: rooms.size,
        matches: matches.size
      };
    }
  };
}
