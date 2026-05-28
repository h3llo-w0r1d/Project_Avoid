const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
let leaderboards = {};

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      leaderboards = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (e) {
    leaderboards = {};
  }
}

function saveLeaderboard() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboards, null, 2));
  } catch (e) {
    console.error('Failed to save leaderboard:', e);
  }
}

loadLeaderboard();

const waitingPlayers = {};
const activeRooms = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('submitScore', ({ name, time, mapId }, callback) => {
    if (!name || typeof time !== 'number' || !mapId) return;
    const safeName = name.substring(0, 20).replace(/[<>&"]/g, '');
    if (!leaderboards[mapId]) leaderboards[mapId] = [];

    const entry = { name: safeName, time, date: new Date().toISOString() };
    leaderboards[mapId].push(entry);
    leaderboards[mapId].sort((a, b) => b.time - a.time);
    leaderboards[mapId] = leaderboards[mapId].slice(0, 100);
    saveLeaderboard();

    const rank = leaderboards[mapId].findIndex(e => e === entry) + 1;
    if (callback) callback({ rank, leaderboard: leaderboards[mapId].slice(0, 10) });
  });

  socket.on('getLeaderboard', ({ mapId }, callback) => {
    if (callback) callback(leaderboards[mapId]?.slice(0, 10) || []);
  });

  socket.on('findMatch', ({ mapId }) => {
    const waiting = waitingPlayers[mapId];
    if (waiting && waiting.id !== socket.id && waiting.connected) {
      delete waitingPlayers[mapId];
      const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const seed = Math.floor(Math.random() * 2147483647);

      socket.join(roomId);
      waiting.join(roomId);

      activeRooms[roomId] = { players: [waiting.id, socket.id], alive: [true, true] };

      waiting.emit('matchFound', { roomId, playerNum: 1, seed, mapId });
      socket.emit('matchFound', { roomId, playerNum: 2, seed, mapId });
    } else {
      waitingPlayers[mapId] = socket;
      socket.emit('waitingForOpponent');
    }
  });

  socket.on('cancelMatch', ({ mapId }) => {
    if (waitingPlayers[mapId]?.id === socket.id) {
      delete waitingPlayers[mapId];
    }
  });

  socket.on('playerUpdate', (data) => {
    if (data.roomId) {
      socket.to(data.roomId).emit('opponentUpdate', { x: data.x, y: data.y, z: data.z });
    }
  });

  socket.on('playerDied', ({ roomId }) => {
    socket.to(roomId).emit('opponentDied');
  });

  socket.on('disconnect', () => {
    for (const mapId in waitingPlayers) {
      if (waitingPlayers[mapId]?.id === socket.id) {
        delete waitingPlayers[mapId];
      }
    }
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 전기 피하기 서버 실행 중: http://localhost:${PORT}\n`);
});
