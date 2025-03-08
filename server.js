// server.js - WebSocket server cho game Hiếu Gà - Hoa Đua Sắc
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Khởi tạo Express app và HTTP server
const app = express();
const server = http.createServer(app);

// Áp dụng middleware
app.use(cors());
app.use(express.json());

// Thiết lập trang chào đơn giản
app.get('/', (req, res) => {
  res.send('Hiếu Gà - Hoa Đua Sắc WebSocket Server đang chạy!');
});

// Khởi tạo WebSocket server
const wss = new WebSocket.Server({ server });

// Quản lý phòng và người chơi
const rooms = new Map(); // Lưu trữ thông tin về các phòng
const clients = new Map(); // Lưu trữ thông tin về các kết nối websocket

// Cấu hình game
const GAME_CONFIG = {
  MAX_PLAYERS: 5,
  GAME_WIDTH: 2000,
  GAME_HEIGHT: 2000,
  INITIAL_FLOWERS: 30,
  INITIAL_OBSTACLES: 15,
  SAFE_ZONE_SHRINK_INTERVAL: 20000, // 20 giây
  DAMAGE_INTERVAL: 3000, // 3 giây
  DAMAGE_AMOUNT: 25,
  PLAYER_RADIUS: 25,
  FLOWER_RADIUS: 15,
  FLOWER_RESPAWN_TIME: 3000, // 3 giây
  COUNTDOWN_TIME: 3 // 3 giây
};

// Xử lý kết nối mới
wss.on('connection', (ws) => {
  console.log('Người dùng đã kết nối');
  
  const clientId = uuidv4();
  clients.set(ws, { id: clientId });
  
  // Xử lý tin nhắn từ client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Nhận tin nhắn từ ${clientId}:`, data.type);
      
      // Xử lý các loại tin nhắn
      switch(data.type) {
        case 'create':
          handleCreateRoom(ws, data);
          break;
        case 'join':
          handleJoinRoom(ws, data);
          break;
        case 'start':
          handleStartGame(ws, data);
          break;
        case 'move':
          handlePlayerMove(ws, data);
          break;
        case 'collectFlower':
          handleCollectFlower(ws, data);
          break;
        default:
          console.warn(`Loại tin nhắn không được hỗ trợ: ${data.type}`);
      }
    } catch (e) {
      console.error('Lỗi khi xử lý tin nhắn:', e);
      sendToClient(ws, {
        type: 'error',
        message: 'Định dạng tin nhắn không hợp lệ'
      });
    }
  });
  
  // Xử lý ngắt kết nối
  ws.on('close', () => {
    console.log(`Người dùng ${clientId} đã ngắt kết nối`);
    handlePlayerDisconnect(ws);
    clients.delete(ws);
  });
  
  // Xử lý lỗi kết nối
  ws.on('error', (error) => {
    console.error(`Lỗi kết nối với người dùng ${clientId}:`, error);
    clients.delete(ws);
  });
});

// Xử lý tạo phòng mới
function handleCreateRoom(ws, data) {
  const roomCode = generateRoomCode();
  const playerId = data.player.id;
  
  // Tạo phòng mới
  rooms.set(roomCode, {
    host: playerId,
    players: new Map([[playerId, {
      id: playerId,
      name: data.player.name,
      color: data.player.color,
      ws: ws,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      health: 100,
      flowers: 0,
      alive: true
    }]]),
    started: false,
    gameState: null,
    intervals: []
  });
  
  // Cập nhật thông tin client
  const clientData = clients.get(ws);
  clientData.roomCode = roomCode;
  clientData.playerId = playerId;
  
  // Gửi thông báo tạo phòng thành công
  sendToClient(ws, {
    type: 'createSuccess',
    room: roomCode,
    players: Array.from(rooms.get(roomCode).players.values()).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color
    })),
    isHost: true
  });
  
  console.log(`Đã tạo phòng mới: ${roomCode}, chủ phòng: ${playerId}`);
}

// Xử lý tham gia phòng
function handleJoinRoom(ws, data) {
  const roomCode = data.room;
  const playerId = data.player.id;
  
  // Kiểm tra phòng có tồn tại không
  if (!rooms.has(roomCode)) {
    sendToClient(ws, {
      type: 'error',
      message: 'Không tìm thấy phòng!'
    });
    return;
  }
  
  const room = rooms.get(roomCode);
  
  // Kiểm tra trò chơi đã bắt đầu chưa
  if (room.started) {
    sendToClient(ws, {
      type: 'error',
      message: 'Trò chơi đã bắt đầu!'
    });
    return;
  }
  
  // Kiểm tra phòng đã đầy chưa
  if (room.players.size >= GAME_CONFIG.MAX_PLAYERS) {
    sendToClient(ws, {
      type: 'error',
      message: 'Phòng đã đầy!'
    });
    return;
  }
  
  // Thêm người chơi vào phòng
  room.players.set(playerId, {
    id: playerId,
    name: data.player.name,
    color: data.player.color,
    ws: ws,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    health: 100,
    flowers: 0,
    alive: true
  });
  
  // Cập nhật thông tin client
  const clientData = clients.get(ws);
  clientData.roomCode = roomCode;
  clientData.playerId = playerId;
  
  // Chuyển danh sách người chơi sang định dạng để gửi đi
  const playersList = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color
  }));
  
  // Gửi thông báo tham gia thành công cho người chơi mới
  sendToClient(ws, {
    type: 'joinSuccess',
    room: roomCode,
    players: playersList,
    isHost: playerId === room.host
  });
  
  // Thông báo cho các người chơi khác trong phòng
  broadcast(roomCode, {
    type: 'playerJoined',
    player: {
      id: playerId,
      name: data.player.name,
      color: data.player.color
    }
  }, playerId);
  
  console.log(`Người chơi ${playerId} đã tham gia phòng ${roomCode}`);
}

// Xử lý bắt đầu trò chơi
function handleStartGame(ws, data) {
  const clientData = clients.get(ws);
  const roomCode = clientData.roomCode;
  
  if (!roomCode || !rooms.has(roomCode)) {
    sendToClient(ws, {
      type: 'error',
      message: 'Phòng không tồn tại'
    });
    return;
  }
  
  const room = rooms.get(roomCode);
  
  // Kiểm tra người gửi có phải chủ phòng không
  if (clientData.playerId !== room.host) {
    sendToClient(ws, {
      type: 'error',
      message: 'Chỉ chủ phòng mới có thể bắt đầu trò chơi'
    });
    return;
  }
  
  // Kiểm tra số lượng người chơi
  if (room.players.size < 2) {
    sendToClient(ws, {
      type: 'error',
      message: 'Cần ít nhất 2 người chơi để bắt đầu trò chơi'
    });
    return;
  }
  
  // Tạo trạng thái game mới
  room.gameState = generateGameState(room);
  room.started = true;
  
  // Thiết lập vị trí ban đầu cho mỗi người chơi
  setupPlayerPositions(room);
  
  // Gửi thông báo bắt đầu trò chơi cho tất cả người chơi
  broadcastToAll(roomCode, {
    type: 'gameStart',
    map: {
      width: GAME_CONFIG.GAME_WIDTH,
      height: GAME_CONFIG.GAME_HEIGHT,
      flowers: room.gameState.flowers,
      obstacles: room.gameState.obstacles,
      safeZone: room.gameState.safeZone,
      playerPositions: room.gameState.playerPositions
    },
    countdown: GAME_CONFIG.COUNTDOWN_TIME
  });
  
  console.log(`Trò chơi đã bắt đầu trong phòng ${roomCode}`);
  
  // Bắt đầu chu kỳ game
  scheduleSafeZoneShrink(roomCode);
}

// Xử lý di chuyển người chơi
function handlePlayerMove(ws, data) {
  const clientData = clients.get(ws);
  const roomCode = clientData.roomCode;
  
  if (!roomCode || !rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  if (!room.started) return;
  
  const playerId = data.player.id;
  const player = room.players.get(playerId);
  
  if (!player || !player.alive) return;
  
  // Cập nhật vị trí người chơi
  player.x = data.x;
  player.y = data.y;
  player.vx = data.vx;
  player.vy = data.vy;
  
  // Truyền dữ liệu di chuyển cho tất cả người chơi
  broadcastToAll(roomCode, {
    type: 'playerMove',
    playerId: playerId,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy
  });
}

// Xử lý thu thập hoa
function handleCollectFlower(ws, data) {
  const clientData = clients.get(ws);
  const roomCode = clientData.roomCode;
  
  if (!roomCode || !rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  if (!room.started) return;
  
  const playerId = data.playerId;
  const flowerIndex = data.flowerIndex;
  const player = room.players.get(playerId);
  
  if (!player || !player.alive) return;
  
  // Kiểm tra hoa có tồn tại không
  if (flowerIndex >= 0 && flowerIndex < room.gameState.flowers.length && room.gameState.flowers[flowerIndex]) {
    // Tăng số hoa đã thu thập
    player.flowers += 1;
    
    // Thông báo hoa đã được thu thập
    broadcastToAll(roomCode, {
      type: 'flowerCollected',
      playerId: playerId,
      flowerIndex: flowerIndex,
      flowerCount: player.flowers
    });
    
    // Đánh dấu hoa đã bị thu thập
    room.gameState.flowers[flowerIndex] = null;
    
    // Tạo hoa mới sau một khoảng thời gian
    setTimeout(() => {
      if (room.started && rooms.has(roomCode)) {
        const newFlower = generateRandomFlower(room.gameState.safeZone.x, room.gameState.safeZone.y, room.gameState.safeZone.radius);
        room.gameState.flowers[flowerIndex] = newFlower;
        
        broadcastToAll(roomCode, {
          type: 'newFlower',
          flower: newFlower,
          index: flowerIndex
        });
      }
    }, GAME_CONFIG.FLOWER_RESPAWN_TIME);
  }
}

// Xử lý người chơi ngắt kết nối
function handlePlayerDisconnect(ws) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.roomCode) return;
  
  const roomCode = clientData.roomCode;
  const playerId = clientData.playerId;
  
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  // Xóa người chơi khỏi phòng
  room.players.delete(playerId);
  
  // Thông báo cho các người chơi khác
  broadcastToAll(roomCode, {
    type: 'playerLeft',
    playerId: playerId
  });
  
  // Nếu là chủ phòng, chuyển quyền cho người chơi khác
  if (playerId === room.host && room.players.size > 0) {
    const newHost = room.players.keys().next().value;
    room.host = newHost;
    
    // Thông báo chủ phòng mới
    broadcastToAll(roomCode, {
      type: 'newHost',
      playerId: newHost
    });
  }
  
  // Nếu đang chơi và người chơi còn sống, đánh dấu là đã loại
  if (room.started && room.gameState && room.gameState.playerStatus) {
    if (room.gameState.playerStatus[playerId] && room.gameState.playerStatus[playerId].alive) {
      room.gameState.playerStatus[playerId].alive = false;
      
      broadcastToAll(roomCode, {
        type: 'playerEliminated',
        playerId: playerId
      });
      
      // Kiểm tra điều kiện kết thúc game
      checkGameEnd(roomCode);
    }
  }
  
  // Xóa phòng nếu không còn người chơi
  if (room.players.size === 0) {
    cleanupRoom(roomCode);
  }
}

// Lên lịch thu hẹp vùng an toàn
function scheduleSafeZoneShrink(roomCode) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  const intervalId = setInterval(() => {
    if (!rooms.has(roomCode) || !room.started) {
      clearInterval(intervalId);
      return;
    }
    
    // Cập nhật vùng an toàn
    const currentRadius = room.gameState.safeZone.radius;
    const nextRadius = room.gameState.safeZone.nextRadius;
    
    room.gameState.safeZone.radius = nextRadius;
    room.gameState.safeZone.nextRadius = Math.max(150, nextRadius * 0.7);
    
    // Thông báo cập nhật vùng an toàn
    broadcastToAll(roomCode, {
      type: 'updateSafeZone',
      safeZone: room.gameState.safeZone
    });
    
    // Bắt đầu gây sát thương cho người chơi ngoài vùng an toàn
    scheduleOutOfZoneDamage(roomCode);
    
    // Nếu vùng an toàn đã đủ nhỏ, dừng thu hẹp
    if (room.gameState.safeZone.nextRadius <= 150) {
      clearInterval(intervalId);
      
      // Sau một thời gian, kết thúc trò chơi nếu vẫn còn quá nhiều người
      setTimeout(() => {
        if (rooms.has(roomCode) && room.started) {
          const alivePlayers = getAlivePlayers(room);
          if (alivePlayers.length > 3) {
            // Sắp xếp người chơi theo số hoa thu thập được
            const sortedPlayers = alivePlayers.sort((a, b) => b.flowers - a.flowers);
            // Chỉ giữ lại top 3
            const winners = sortedPlayers.slice(0, 3);
            
            // Kết thúc trò chơi
            endGame(roomCode, winners);
          }
        }
      }, 30000); // 30 giây sau khi vùng an toàn đạt kích thước tối thiểu
    }
  }, GAME_CONFIG.SAFE_ZONE_SHRINK_INTERVAL);
  
  // Lưu intervalId để dọn dẹp sau này
  room.intervals.push(intervalId);
}

// Lên lịch gây sát thương cho người chơi ngoài vùng an toàn
function scheduleOutOfZoneDamage(roomCode) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  const intervalId = setInterval(() => {
    if (!rooms.has(roomCode) || !room.started) {
      clearInterval(intervalId);
      return;
    }
    
    // Kiểm tra từng người chơi
    room.players.forEach(player => {
      if (!player.alive) return;
      
      // Tính khoảng cách đến trung tâm vùng an toàn
      const distance = Math.sqrt(
        Math.pow(player.x - room.gameState.safeZone.x, 2) +
        Math.pow(player.y - room.gameState.safeZone.y, 2)
      );
      
      // Nếu ngoài vùng an toàn, gây sát thương
      if (distance > room.gameState.safeZone.radius) {
        player.health -= GAME_CONFIG.DAMAGE_AMOUNT;
        
        // Thông báo người chơi bị sát thương
        broadcastToAll(roomCode, {
          type: 'playerHit',
          playerId: player.id,
          damage: GAME_CONFIG.DAMAGE_AMOUNT
        });
        
        // Nếu máu về 0, loại người chơi
        if (player.health <= 0) {
          player.health = 0;
          player.alive = false;
          
          // Thông báo người chơi bị loại
          broadcastToAll(roomCode, {
            type: 'playerEliminated',
            playerId: player.id
          });
          
          // Kiểm tra điều kiện kết thúc game
          checkGameEnd(roomCode);
        }
      }
    });
  }, GAME_CONFIG.DAMAGE_INTERVAL);
  
  // Lưu intervalId để dọn dẹp sau này
  room.intervals.push(intervalId);
}

// Kiểm tra điều kiện kết thúc game
function checkGameEnd(roomCode) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  // Đếm số người chơi còn sống
  const alivePlayers = getAlivePlayers(room);
  
  // Nếu chỉ còn <= 3 người chơi, kết thúc trò chơi
  if (alivePlayers.length <= 3 && alivePlayers.length > 0) {
    endGame(roomCode, alivePlayers);
  }
}

// Kết thúc trò chơi
function endGame(roomCode, winners) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  room.started = false;
  
  // Dọn dẹp các interval
  for (const intervalId of room.intervals) {
    clearInterval(intervalId);
  }
  room.intervals = [];
  
  // Sắp xếp người thắng theo số hoa thu thập được
  const sortedWinners = winners.sort((a, b) => b.flowers - a.flowers);
  
  // Gửi thông báo kết thúc trò chơi
  broadcastToAll(roomCode, {
    type: 'gameOver',
    winners: sortedWinners.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      flowers: p.flowers
    }))
  });
  
  console.log(`Trò chơi kết thúc trong phòng ${roomCode}`);
}

// Dọn dẹp phòng
function cleanupRoom(roomCode) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  
  // Dọn dẹp các interval
  for (const intervalId of room.intervals) {
    clearInterval(intervalId);
  }
  
  // Xóa phòng khỏi danh sách
  rooms.delete(roomCode);
  
  console.log(`Đã xóa phòng ${roomCode}`);
}

// Lấy danh sách người chơi còn sống
function getAlivePlayers(room) {
  return Array.from(room.players.values()).filter(p => p.alive);
}

// Thiết lập vị trí người chơi ban đầu
function setupPlayerPositions(room) {
  const playerPositions = {};
  const centerX = GAME_CONFIG.GAME_WIDTH / 2;
  const centerY = GAME_CONFIG.GAME_HEIGHT / 2;
  const radius = 200; // Khoảng cách từ trung tâm
  
  // Phân bố người chơi theo hình tròn quanh trung tâm
  let index = 0;
  const totalPlayers = room.players.size;
  
  room.players.forEach(player => {
    const angle = (index / totalPlayers) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    
    player.x = x;
    player.y = y;
    player.vx = 0;
    player.vy = 0;
    
    playerPositions[player.id] = { x, y };
    index++;
  });
  
  room.gameState.playerPositions = playerPositions;
}

// Tạo trạng thái trò chơi mới
function generateGameState(room) {
  const width = GAME_CONFIG.GAME_WIDTH;
  const height = GAME_CONFIG.GAME_HEIGHT;
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Tạo hoa
  const flowers = [];
  for (let i = 0; i < GAME_CONFIG.INITIAL_FLOWERS; i++) {
    flowers.push(generateRandomFlower(centerX, centerY, width / 2 - 100));
  }
  
  // Tạo chướng ngại vật
  const obstacles = [];
  for (let i = 0; i < GAME_CONFIG.INITIAL_OBSTACLES; i++) {
    obstacles.push({
      x: centerX + (Math.random() * width / 2 - width / 4),
      y: centerY + (Math.random() * height / 2 - height / 4),
      radius: Math.random() * 30 + 20
    });
  }
  
  // Thiết lập vùng an toàn
  const safeZone = {
    x: centerX,
    y: centerY,
    radius: width / 2,
    nextRadius: width / 2.5
  };
  
  return {
    flowers,
    obstacles,
    safeZone,
    playerPositions: {},
    startTime: Date.now()
  };
}

// Tạo hoa ngẫu nhiên
function generateRandomFlower(centerX, centerY, radius) {
  // Tạo vị trí ngẫu nhiên trong vùng an toàn
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * radius * 0.8; // 80% bán kính để đảm bảo nằm trong vùng an toàn
  
  return {
    x: centerX + Math.cos(angle) * distance,
    y: centerY + Math.sin(angle) * distance,
    type: Math.floor(Math.random() * 3) // 3 loại hoa khác nhau
  };
}

// Tạo mã phòng ngẫu nhiên
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Bỏ các ký tự dễ nhầm lẫn
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Gửi tin nhắn đến một client
function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Phát tin nhắn đến tất cả người chơi trong phòng trừ người gửi
function broadcast(roomCode, message, excludePlayerId = null) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  room.players.forEach(player => {
    if (player.id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// Phát tin nhắn đến tất cả người chơi trong phòng
function broadcastToAll(roomCode, message) {
  if (!rooms.has(roomCode)) return;
  
  const room = rooms.get(roomCode);
  room.players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// Thiết lập ping để giữ kết nối
setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    }
  });
}, 30000);

// Khởi động server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server đang chạy tại port ${PORT}`);
});

// Xử lý khi server đóng
process.on('SIGINT', () => {
  console.log('Đang đóng server...');
  
  // Đóng tất cả các kết nối
  wss.clients.forEach(client => {
    client.close();
  });
  
  // Dọn dẹp tất cả các phòng
  rooms.forEach((room, roomCode) => {
    cleanupRoom(roomCode);
  });
  
  // Đóng server
  server.close(() => {
    console.log('Server đã đóng');
    process.exit(0);
  });
});
