const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Trong production nên giới hạn nguồn cụ thể 
    methods: ["GET", "POST"]
  }
});

// Lưu trữ phòng và người chơi
const rooms = {};

io.on('connection', (socket) => {
  console.log('Người chơi đã kết nối:', socket.id);

  // Xử lý tạo phòng
  socket.on('create_room', (data) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    // Tạo phòng mới
    rooms[roomCode] = {
      players: [],
      owner: socket.id,
      isPlaying: false
    };
    
    // Thêm người chơi vào phòng
    const player = {
      ...data.player,
      socketId: socket.id,
      isOwner: true
    };
    
    rooms[roomCode].players.push(player);
    
    // Tham gia socket vào phòng
    socket.join(roomCode);
    socket.roomCode = roomCode;
    
    // Gửi thông tin phòng cho người tạo
    socket.emit('room_created', { roomCode });
    
    console.log(`Phòng ${roomCode} đã được tạo bởi ${player.nickname}`);
  });

  // Xử lý tham gia phòng
  socket.on('join_room', (data) => {
    const { roomCode, player } = data;
    
    if (!rooms[roomCode]) {
      socket.emit('error', { message: 'Phòng không tồn tại!' });
      return;
    }
    
    if (rooms[roomCode].isPlaying) {
      socket.emit('error', { message: 'Trận đấu đã bắt đầu!' });
      return;
    }
    
    if (rooms[roomCode].players.length >= 8) {
      socket.emit('error', { message: 'Phòng đã đầy!' });
      return;
    }
    
    // Thêm người chơi vào phòng
    const newPlayer = {
      ...player,
      socketId: socket.id,
      isOwner: false
    };
    
    rooms[roomCode].players.push(newPlayer);
    
    // Tham gia socket vào phòng
    socket.join(roomCode);
    socket.roomCode = roomCode;
    
    // Gửi thông tin phòng cho tất cả người chơi trong phòng
    io.to(roomCode).emit('room_joined', {
      roomCode,
      players: rooms[roomCode].players
    });
    
    console.log(`${newPlayer.nickname} đã tham gia phòng ${roomCode}`);
  });

  // Xử lý rời phòng
  socket.on('leave_room', () => {
    const roomCode = socket.roomCode;
    
    if (roomCode && rooms[roomCode]) {
      // Xóa người chơi khỏi phòng
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.socketId !== socket.id);
      
      socket.leave(roomCode);
      socket.roomCode = null;
      
      // Kiểm tra xem còn ai trong phòng không
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
        console.log(`Phòng ${roomCode} đã bị xóa do không còn người chơi`);
      } else {
        // Nếu người rời đi là chủ phòng, chuyển quyền cho người tiếp theo
        if (rooms[roomCode].owner === socket.id) {
          rooms[roomCode].owner = rooms[roomCode].players[0].socketId;
          rooms[roomCode].players[0].isOwner = true;
        }
        
        // Cập nhật thông tin phòng cho những người còn lại
        io.to(roomCode).emit('room_updated', {
          players: rooms[roomCode].players
        });
      }
    }
  });

  // Xử lý bắt đầu trò chơi
  socket.on('start_game', () => {
    const roomCode = socket.roomCode;
    
    if (!roomCode || !rooms[roomCode]) return;
    
    // Kiểm tra xem người gửi có phải chủ phòng không
    if (rooms[roomCode].owner !== socket.id) return;
    
    rooms[roomCode].isPlaying = true;
    
    // Tạo vị trí ngẫu nhiên cho hoa
    const flowers = Array(30).fill().map((_, i) => {
      const flowerType = Math.floor(Math.random() * 4); // 0-3 tương ứng với 4 loại hoa
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * 400 * 0.9; // 400 là maxMapRadius mặc định
      
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        type: {
          color: ['#FF69B4', '#FF0000', '#FFFF00', '#800080'][flowerType],
          points: [1, 2, 3, 5][flowerType],
          radius: [15, 18, 20, 22][flowerType],
          petals: [5, 8, 6, 10][flowerType]
        }
      };
    });
    
    // Bắt đầu trò chơi
    io.to(roomCode).emit('game_started', {
      players: rooms[roomCode].players,
      flowers: flowers,
      mapRadius: 400, // Bán kính ban đầu
      timeRemaining: 60 // Thời gian trò chơi
    });
    
    console.log(`Trò chơi đã bắt đầu trong phòng ${roomCode}`);
    
    // Bắt đầu đếm ngược và cập nhật trạng thái trò chơi
    let gameTime = 60;
    let mapRadius = 400;
    let gameFlowers = [...flowers];
    
    const gameInterval = setInterval(() => {
      if (!rooms[roomCode]) {
        clearInterval(gameInterval);
        return;
      }
      
      gameTime--;
      
      // Thu nhỏ bản đồ mỗi 10 giây
      if (gameTime % 10 === 0 && mapRadius > 120) {
        mapRadius -= 40;
        
        // Tạo thêm hoa mới
        if (gameFlowers.length < 50) {
          const newFlowers = Array(5).fill().map((_, i) => {
            const flowerType = Math.floor(Math.random() * 4);
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * mapRadius * 0.9;
            
            return {
              id: gameFlowers.length + i,
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance,
              type: {
                color: ['#FF69B4', '#FF0000', '#FFFF00', '#800080'][flowerType],
                points: [1, 2, 3, 5][flowerType],
                radius: [15, 18, 20, 22][flowerType],
                petals: [5, 8, 6, 10][flowerType]
              }
            };
          });
          
          gameFlowers = [...gameFlowers, ...newFlowers];
        }
      }
      
      // Cập nhật trạng thái trò chơi
      io.to(roomCode).emit('game_update', {
        players: rooms[roomCode].players,
        flowers: gameFlowers,
        mapRadius: mapRadius,
        timeRemaining: gameTime
      });
      
      // Kiểm tra kết thúc trò chơi
      if (gameTime <= 0 || mapRadius <= 120) {
        clearInterval(gameInterval);
        
        // Sắp xếp người chơi theo điểm số
        const sortedPlayers = [...rooms[roomCode].players].sort((a, b) => b.score - a.score);
        
        // Gửi kết quả trò chơi
        io.to(roomCode).emit('game_over', {
          winners: sortedPlayers.slice(0, 3),
          allPlayers: sortedPlayers
        });
        
        // Đặt lại trạng thái phòng
        if (rooms[roomCode]) {
          rooms[roomCode].isPlaying = false;
          rooms[roomCode].players.forEach(p => p.score = 0);
        }
        
        console.log(`Trò chơi đã kết thúc trong phòng ${roomCode}`);
      }
    }, 1000);
  });

  // Xử lý di chuyển người chơi
  socket.on('player_move', (data) => {
    const roomCode = socket.roomCode;
    
    if (!roomCode || !rooms[roomCode] || !rooms[roomCode].isPlaying) return;
    
    // Cập nhật vị trí người chơi
    const playerIndex = rooms[roomCode].players.findIndex(p => p.id === data.playerId);
    
    if (playerIndex !== -1) {
      rooms[roomCode].players[playerIndex].x = data.x;
      rooms[roomCode].players[playerIndex].y = data.y;
      
      // Kiểm tra va chạm với hoa
      checkFlowerCollection(roomCode, rooms[roomCode].players[playerIndex]);
    }
  });

  // Xử lý ngắt kết nối
  socket.on('disconnect', () => {
    console.log('Người chơi đã ngắt kết nối:', socket.id);
    
    // Xử lý người chơi rời phòng khi ngắt kết nối
    const roomCode = socket.roomCode;
    
    if (roomCode && rooms[roomCode]) {
      // Xóa người chơi khỏi phòng
      rooms[roomCode].players = rooms[roomCode].players.filter(p => p.socketId !== socket.id);
      
      // Kiểm tra xem còn ai trong phòng không
      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
        console.log(`Phòng ${roomCode} đã bị xóa do không còn người chơi`);
      } else {
        // Nếu người rời đi là chủ phòng, chuyển quyền cho người tiếp theo
        if (rooms[roomCode].owner === socket.id) {
          rooms[roomCode].owner = rooms[roomCode].players[0].socketId;
          rooms[roomCode].players[0].isOwner = true;
        }
        
        // Cập nhật thông tin phòng cho những người còn lại
        io.to(roomCode).emit('room_updated', {
          players: rooms[roomCode].players
        });
      }
    }
  });
});

// Hàm kiểm tra va chạm với hoa
function checkFlowerCollection(roomCode, player) {
  if (!rooms[roomCode] || !rooms[roomCode].gameFlowers) return;
  
  const playerRadius = 25;
  
  rooms[roomCode].gameFlowers = rooms[roomCode].gameFlowers.filter(flower => {
    const dx = player.x - flower.x;
    const dy = player.y - flower.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < playerRadius + flower.type.radius) {
      // Thu thập hoa
      player.score += flower.type.points;
      
      // Sinh ra hoa mới sau một khoảng thời gian
      setTimeout(() => {
        if (rooms[roomCode] && rooms[roomCode].gameFlowers) {
          const flowerType = Math.floor(Math.random() * 4);
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.random() * rooms[roomCode].mapRadius * 0.9;
          
          rooms[roomCode].gameFlowers.push({
            id: Date.now(),
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance,
            type: {
              color: ['#FF69B4', '#FF0000', '#FFFF00', '#800080'][flowerType],
              points: [1, 2, 3, 5][flowerType],
              radius: [15, 18, 20, 22][flowerType],
              petals: [5, 8, 6, 10][flowerType]
            }
          });
        }
      }, 2000);
      
      return false;
    }
    return true;
  });
}

// Đường dẫn API đơn giản để kiểm tra máy chủ hoạt động
app.get('/', (req, res) => {
  res.send('Socket.IO server for Flower Collection Game is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
