const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Khởi tạo ứng dụng Express và máy chủ HTTP
const app = express();
const server = http.createServer(app);

// Khởi tạo máy chủ WebSocket
const wss = new WebSocket.Server({ server });

// Đường dẫn API đơn giản để kiểm tra xem máy chủ có hoạt động không
app.get('/', (req, res) => {
  res.send('Máy chủ game Hiếu Gà đang chạy!');
});

// Lưu trữ thông tin phòng và người chơi
const rooms = new Map();
const players = new Map();

// Hằng số game
const GAME_DURATION = 120; // 2 phút
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const WORLD_SIZE = 4000; // 4000x4000 pixcel
const SAFE_ZONE_START = 1000;
const SAFE_ZONE_END = 300;

// Xử lý kết nối WebSocket
wss.on('connection', (ws) => {
  console.log('Người chơi mới đã kết nối');
  
  // Gán ID cho kết nối mới
  ws.id = uuidv4();
  
  // Xử lý tin nhắn từ client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Nhận tin nhắn: ${data.type} từ ${ws.id}`);
      
      switch (data.type) {
        case 'register':
          handleRegister(ws, data);
          break;
        case 'create_room':
          handleCreateRoom(ws, data);
          break;
        case 'join_room':
          handleJoinRoom(ws, data);
          break;
        case 'leave_room':
          handleLeaveRoom(ws);
          break;
        case 'toggle_ready':
          handleToggleReady(ws, data);
          break;
        case 'start_game':
          handleStartGame(ws);
          break;
        case 'move':
          handlePlayerMove(ws, data);
          break;
        case 'collect':
          handleCollect(ws, data);
          break;
        case 'action':
          handleAction(ws, data);
          break;
        case 'player_dead':
          handlePlayerDead(ws);
          break;
      }
    } catch (error) {
      console.error('Lỗi xử lý tin nhắn:', error);
    }
  });
  
  // Xử lý ngắt kết nối
  ws.on('close', () => {
    console.log(`Người chơi ${ws.id} đã ngắt kết nối`);
    
    // Xử lý người chơi rời phòng khi ngắt kết nối
    handleLeaveRoom(ws);
    
    // Xóa người chơi khỏi danh sách
    players.delete(ws.id);
  });
});

// Xử lý đăng ký người chơi
function handleRegister(ws, data) {
  const playerId = data.sessionId || ws.id;
  
  // Lưu thông tin người chơi
  players.set(ws.id, {
    id: playerId,
    name: data.name,
    socket: ws,
    room: null
  });
  
  // Thông báo xác nhận đăng ký
  ws.send(JSON.stringify({
    type: 'registered',
    playerId: playerId
  }));
}

// Xử lý tạo phòng
function handleCreateRoom(ws, data) {
  const player = players.get(ws.id);
  
  if (!player) {
    sendError(ws, 'Player not registered');
    return;
  }
  
  // Tạo mã phòng ngẫu nhiên
  const roomCode = generateRoomCode();
  
  // Tạo phòng mới
  const room = {
    code: roomCode,
    host: ws.id,
    players: [
      {
        id: player.id,
        name: player.name,
        ready: true, // Chủ phòng luôn sẵn sàng
        socket: ws,
        x: 0,
        y: 0,
        health: 100,
        flowers: 0,
        isDead: false
      }
    ],
    gameState: 'waiting',
    gameTimer: GAME_DURATION,
    safeRadius: SAFE_ZONE_START,
    entities: {
      flowers: [],
      powerups: [],
      hearts: [],
      obstacles: []
    }
  };
  
  // Lưu thông tin phòng
  rooms.set(roomCode, room);
  
  // Cập nhật thông tin người chơi
  player.room = roomCode;
  
  // Thông báo phòng đã được tạo
  ws.send(JSON.stringify({
    type: 'room_created',
    roomCode: roomCode,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready
    }))
  }));
}

// Xử lý tham gia phòng
function handleJoinRoom(ws, data) {
  const player = players.get(ws.id);
  
  if (!player) {
    sendError(ws, 'Player not registered');
    return;
  }
  
  const roomCode = data.roomCode;
  const room = rooms.get(roomCode);
  
  if (!room) {
    sendError(ws, 'Room not found');
    return;
  }
  
  if (room.gameState !== 'waiting') {
    sendError(ws, 'Game already started');
    return;
  }
  
  if (room.players.length >= MAX_PLAYERS) {
    sendError(ws, 'Room is full');
    return;
  }
  
  // Kiểm tra xem người chơi đã ở trong phòng chưa
  const existingPlayer = room.players.find(p => p.id === player.id);
  if (existingPlayer) {
    // Nếu đã ở trong phòng, cập nhật socket
    existingPlayer.socket = ws;
  } else {
    // Thêm người chơi vào phòng
    room.players.push({
      id: player.id,
      name: player.name,
      ready: false,
      socket: ws,
      x: 0,
      y: 0,
      health: 100,
      flowers: 0,
      isDead: false
    });
  }
  
  // Cập nhật thông tin người chơi
  player.room = roomCode;
  
  // Thông báo người chơi đã tham gia phòng
  ws.send(JSON.stringify({
    type: 'room_joined',
    roomCode: roomCode,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready
    }))
  }));
  
  // Thông báo cho những người chơi khác
  broadcastToRoom(room, {
    type: 'player_joined',
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready
    }))
  }, [ws.id]);
}

// Xử lý rời phòng
function handleLeaveRoom(ws) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room) return;
  
  // Xóa người chơi khỏi phòng
  const playerIndex = room.players.findIndex(p => p.id === player.id);
  
  if (playerIndex !== -1) {
    room.players.splice(playerIndex, 1);
    
    // Thông báo cho những người chơi khác
    broadcastToRoom(room, {
      type: 'player_left',
      playerId: player.id,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready
      }))
    });
    
    // Nếu đây là chủ phòng, chuyển quyền chủ phòng cho người chơi kế tiếp
    if (player.id === room.host && room.players.length > 0) {
      room.host = room.players[0].id;
    }
    
    // Nếu không còn người chơi, xóa phòng
    if (room.players.length === 0) {
      rooms.delete(player.room);
    }
    
    // Cập nhật thông tin người chơi
    player.room = null;
  }
}

// Xử lý chuyển trạng thái sẵn sàng
function handleToggleReady(ws, data) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room || room.gameState !== 'waiting') return;
  
  // Tìm người chơi trong phòng
  const roomPlayer = room.players.find(p => p.id === player.id);
  
  if (roomPlayer) {
    roomPlayer.ready = data.ready;
    
    // Thông báo cho tất cả người chơi trong phòng
    broadcastToRoom(room, {
      type: 'player_ready',
      playerId: player.id,
      ready: roomPlayer.ready,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready
      }))
    });
  }
}

// Xử lý bắt đầu trò chơi
function handleStartGame(ws) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room || room.gameState !== 'waiting') return;
  
  // Kiểm tra xem người gửi có phải là chủ phòng không
  if (room.host !== player.id) {
    sendError(ws, 'Only host can start the game');
    return;
  }
  
  // Kiểm tra xem có đủ người chơi không
  if (room.players.length < MIN_PLAYERS) {
    sendError(ws, 'Not enough players');
    return;
  }
  
  // Kiểm tra xem tất cả người chơi đã sẵn sàng chưa
  const allReady = room.players.every(p => p.ready || p.id === room.host);
  
  if (!allReady) {
    sendError(ws, 'Not all players are ready');
    return;
  }
  
  // Khởi tạo game
  initializeGame(room);
  
  // Thông báo cho tất cả người chơi trong phòng
  broadcastToRoom(room, {
    type: 'game_starting',
    gameState: getGameState(room)
  });
  
  // Bắt đầu trò chơi
  room.gameState = 'playing';
  
  // Bắt đầu bộ đếm thời gian
  startGameTimer(room);
}

// Khởi tạo trò chơi
function initializeGame(room) {
  // Đặt lại thời gian
  room.gameTimer = GAME_DURATION;
  room.safeRadius = SAFE_ZONE_START;
  
  // Đặt vị trí cho người chơi
  room.players.forEach((player, index) => {
    const angle = (index / room.players.length) * Math.PI * 2;
    player.x = Math.cos(angle) * 300;
    player.y = Math.sin(angle) * 300;
    player.health = 100;
    player.flowers = 0;
    player.isDead = false;
  });
  
  // Tạo các đối tượng trong game
  generateObstacles(room);
  generateCollectibles(room);
}

// Tạo các chướng ngại vật
function generateObstacles(room) {
  room.entities.obstacles = [];
  
  // Tạo 40 chướng ngại vật ngẫu nhiên
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 900 + 100;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    
    const types = ['tree', 'bush', 'rock'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    room.entities.obstacles.push({
      id: `obstacle_${i}`,
      x,
      y,
      type
    });
  }
}

// Tạo các vật phẩm có thể thu thập
function generateCollectibles(room) {
  room.entities.flowers = [];
  room.entities.powerups = [];
  room.entities.hearts = [];
  
  // Tạo 100 bông hoa
  for (let i = 0; i < 100; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 900 + 100;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    
    room.entities.flowers.push({
      id: `flower_${i}`,
      x,
      y,
      collected: false
    });
  }
  
  // Tạo 10 powerup
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 800 + 200;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    
    room.entities.powerups.push({
      id: `powerup_${i}`,
      x,
      y,
      collected: false
    });
  }
  
  // Tạo 5 trái tim
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 800 + 200;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    
    room.entities.hearts.push({
      id: `heart_${i}`,
      x,
      y,
      collected: false
    });
  }
}

// Bắt đầu bộ đếm thời gian
function startGameTimer(room) {
  const gameInterval = setInterval(() => {
    if (!rooms.has(room.code) || room.gameState !== 'playing') {
      clearInterval(gameInterval);
      return;
    }
    
    // Giảm thời gian
    room.gameTimer--;
    
    // Thu nhỏ vùng an toàn
    room.safeRadius = Math.max(SAFE_ZONE_END, SAFE_ZONE_START - (SAFE_ZONE_START - SAFE_ZONE_END) * (1 - room.gameTimer / GAME_DURATION));
    
    // Thỉnh thoảng tạo thêm bông hoa mới
    if (Math.random() < 0.05) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * room.safeRadius * 0.8;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      
      const flowerId = `flower_new_${Date.now()}`;
      
      room.entities.flowers.push({
        id: flowerId,
        x,
        y,
        collected: false
      });
    }
    
    // Gửi cập nhật trạng thái game
    broadcastGameState(room);
    
    // Kiểm tra kết thúc game
    if (room.gameTimer <= 0 || isGameOver(room)) {
      endGame(room);
      clearInterval(gameInterval);
    }
  }, 1000);
}

// Kiểm tra xem trò chơi đã kết thúc chưa
function isGameOver(room) {
  // Đếm số người chơi còn sống
  const alivePlayers = room.players.filter(p => !p.isDead);
  
  // Trò chơi kết thúc khi chỉ còn 1 người chơi hoặc tất cả đều chết
  return alivePlayers.length <= 1;
}

// Kết thúc trò chơi
function endGame(room) {
  room.gameState = 'ended';
  
  // Sắp xếp người chơi theo số hoa đã thu thập
  const winners = [...room.players]
    .filter(p => !p.isDead)
    .sort((a, b) => b.flowers - a.flowers);
  
  // Thông báo kết quả cho tất cả người chơi
  broadcastToRoom(room, {
    type: 'game_over',
    winners: winners.map(p => ({
      id: p.id,
      name: p.name,
      flowers: p.flowers
    }))
  });
  
  // Đặt lại phòng sau một khoảng thời gian
  setTimeout(() => {
    if (rooms.has(room.code)) {
      room.gameState = 'waiting';
      room.gameTimer = GAME_DURATION;
      room.safeRadius = SAFE_ZONE_START;
      
      // Đặt lại người chơi
      room.players.forEach(p => {
        p.ready = p.id === room.host;
        p.health = 100;
        p.flowers = 0;
        p.isDead = false;
      });
    }
  }, 10000);
}

// Xử lý di chuyển người chơi
function handlePlayerMove(ws, data) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room || room.gameState !== 'playing') return;
  
  // Tìm người chơi trong phòng
  const roomPlayer = room.players.find(p => p.id === player.id);
  
  if (roomPlayer && !roomPlayer.isDead) {
    // Cập nhật vị trí người chơi
    roomPlayer.x += data.vx;
    roomPlayer.y += data.vy;
    
    // Kiểm tra va chạm với chướng ngại vật
    room.entities.obstacles.forEach(obstacle => {
      const dx = roomPlayer.x - obstacle.x;
      const dy = roomPlayer.y - obstacle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < 40) {
        // Đẩy người chơi ra xa chướng ngại vật
        const pushFactor = 1;
        roomPlayer.x += (dx / distance) * pushFactor;
        roomPlayer.y += (dy / distance) * pushFactor;
      }
    });
    
    // Kiểm tra xem người chơi có ở ngoài vùng an toàn không
    const distanceFromCenter = Math.sqrt(roomPlayer.x * roomPlayer.x + roomPlayer.y * roomPlayer.y);
    
    if (distanceFromCenter > room.safeRadius) {
      // Người chơi nhận sát thương khi ở ngoài vùng an toàn
      roomPlayer.health -= 0.5;
      
      // Kiểm tra xem người chơi có chết không
      if (roomPlayer.health <= 0) {
        roomPlayer.isDead = true;
      }
    }
  }
}

// Xử lý thu thập vật phẩm
function handleCollect(ws, data) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room || room.gameState !== 'playing') return;
  
  // Tìm người chơi trong phòng
  const roomPlayer = room.players.find(p => p.id === player.id);
  
  if (!roomPlayer || roomPlayer.isDead) return;
  
  // Tìm vật phẩm
  let item;
  let items;
  
  if (data.itemType === 'flower') {
    items = room.entities.flowers;
  } else if (data.itemType === 'powerup') {
    items = room.entities.powerups;
  } else if (data.itemType === 'heart') {
    items = room.entities.hearts;
  } else {
    return;
  }
  
  item = items.find(i => i.id === data.itemId && !i.collected);
  
  if (!item) return;
  
  // Kiểm tra khoảng cách
  const dx = roomPlayer.x - item.x;
  const dy = roomPlayer.y - item.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance < 30) {
    // Thu thập vật phẩm
    item.collected = true;
    
    // Áp dụng hiệu ứng của vật phẩm
    if (data.itemType === 'flower') {
      roomPlayer.flowers += 1;
    } else if (data.itemType === 'heart') {
      roomPlayer.health = Math.min(100, roomPlayer.health + 30);
    }
    
    // Thông báo cho tất cả người chơi
    broadcastToRoom(room, {
      type: 'item_collected',
      itemType: data.itemType,
      itemId: data.itemId,
      playerId: player.id
    });
  }
}

// Xử lý hành động người chơi
function handleAction(ws, data) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room || room.gameState !== 'playing') return;
  
  // Tìm người chơi trong phòng
  const roomPlayer = room.players.find(p => p.id === player.id);
  
  if (!roomPlayer || roomPlayer.isDead) return;
  
  if (data.action === 'collect_flower') {
    // Thu thập tất cả hoa ở gần
    let collected = false;
    
    room.entities.flowers.forEach(flower => {
      if (!flower.collected) {
        const dx = roomPlayer.x - flower.x;
        const dy = roomPlayer.y - flower.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 100) {
          flower.collected = true;
          roomPlayer.flowers += 1;
          collected = true;
          
          // Thông báo cho tất cả người chơi
          broadcastToRoom(room, {
            type: 'item_collected',
            itemType: 'flower',
            itemId: flower.id,
            playerId: player.id
          });
        }
      }
    });
  }
}

// Xử lý người chơi chết
function handlePlayerDead(ws) {
  const player = players.get(ws.id);
  
  if (!player || !player.room) return;
  
  const room = rooms.get(player.room);
  
  if (!room || room.gameState !== 'playing') return;
  
  // Tìm người chơi trong phòng
  const roomPlayer = room.players.find(p => p.id === player.id);
  
  if (!roomPlayer) return;
  
  // Đánh dấu người chơi đã chết
  roomPlayer.isDead = true;
  
  // Thông báo cho tất cả người chơi
  broadcastToRoom(room, {
    type: 'player_dead',
    playerId: player.id
  });
  
  // Kiểm tra xem trò chơi đã kết thúc chưa
  if (isGameOver(room)) {
    endGame(room);
  }
}

// Gửi cập nhật trạng thái game cho tất cả người chơi trong phòng
function broadcastGameState(room) {
  broadcastToRoom(room, {
    type: 'game_state',
    gameTimer: room.gameTimer,
    safeRadius: room.safeRadius,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      health: p.health,
      flowers: p.flowers,
      isDead: p.isDead
    })),
    entities: getEntitiesUpdate(room)
  });
}

// Lấy cập nhật về các đối tượng trong game
function getEntitiesUpdate(room) {
  return [
    ...room.entities.flowers.filter(f => !f.collected).map(f => ({
      id: f.id,
      type: 'flower',
      x: f.x,
      y: f.y,
      collected: f.collected
    })),
    ...room.entities.powerups.filter(p => !p.collected).map(p => ({
      id: p.id,
      type: 'powerup',
      x: p.x,
      y: p.y,
      collected: p.collected
    })),
    ...room.entities.hearts.filter(h => !h.collected).map(h => ({
      id: h.id,
      type: 'heart',
      x: h.x,
      y: h.y,
      collected: h.collected
    }))
  ];
}

// Lấy toàn bộ trạng thái game
function getGameState(room) {
  return {
    gameTimer: room.gameTimer,
    safeRadius: room.safeRadius,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      health: p.health,
      flowers: p.flowers,
      isDead: p.isDead
    })),
    obstacles: room.entities.obstacles,
    flowers: room.entities.flowers,
    powerups: room.entities.powerups,
    hearts: room.entities.hearts
  };
}

// Gửi thông báo lỗi cho client
function sendError(ws, message) {
  ws.send(JSON.stringify({
    type: 'error',
    error: message
  }));
}

// Gửi thông báo cho tất cả người chơi trong phòng
function broadcastToRoom(room, message, excludeIds = []) {
  room.players.forEach(player => {
    if (!excludeIds.includes(player.id) && player.socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(JSON.stringify(message));
    }
  });
}

// Tạo mã phòng ngẫu nhiên
function generateRoomCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Khởi động máy chủ
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Máy chủ đang chạy tại cổng ${PORT}`);
});
