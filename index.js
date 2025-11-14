const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('../public'));

// Хранилище данных (в продакшн используйте базу данных)
const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Функции для работы с файлами
function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function writeMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Инициализация файлов
if (!fs.existsSync(USERS_FILE)) {
  writeUsers({});
}
if (!fs.existsSync(MESSAGES_FILE)) {
  writeMessages([]);
}

// Хранилище онлайн пользователей
const onlineUsers = new Map();

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    const users = readUsers();
    
    if (users[username]) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = {
      password: hashedPassword,
      email,
      createdAt: new Date().toISOString()
    };
    
    writeUsers(users);
    
    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token, username });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    const users = readUsers();
    const user = users[username];
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Неверные данные' });
    }
    
    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token, username });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/users', (req, res) => {
  const users = readUsers();
  const usersList = Object.keys(users).map(username => ({
    username,
    online: onlineUsers.has(username),
    lastSeen: users[username].lastSeen
  }));
  res.json(usersList);
});

app.get('/api/messages', (req, res) => {
  const messages = readMessages();
  res.json(messages.slice(-100)); // Последние 100 сообщений
});

// Socket.io соединения
io.on('connection', (socket) => {
  console.log('Новое соединение:', socket.id);

  socket.on('user_online', (username) => {
    onlineUsers.set(username, socket.id);
    socket.username = username;
    
    // Обновляем время последнего входа
    const users = readUsers();
    if (users[username]) {
      users[username].lastSeen = new Date().toISOString();
      writeUsers(users);
    }
    
    // Уведомляем всех о новом онлайн пользователе
    io.emit('users_updated', Array.from(onlineUsers.keys()));
    console.log(`Пользователь ${username} онлайн`);
  });

  socket.on('send_message', (data) => {
    const { from, to, text, timestamp } = data;
    
    if (!from || !text) return;
    
    const message = {
      id: Date.now() + Math.random(),
      from,
      to: to || 'general', // 'general' для общих сообщений
      text,
      timestamp: timestamp || new Date().toISOString()
    };
    
    // Сохраняем сообщение
    const messages = readMessages();
    messages.push(message);
    writeMessages(messages);
    
    if (to && to !== 'general') {
      // Личное сообщение
      const recipientSocketId = onlineUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('new_message', message);
      }
      socket.emit('new_message', message); // Отправляем обратно отправителю
    } else {
      // Общее сообщение
      io.emit('new_message', message);
    }
  });

  socket.on('typing_start', (data) => {
    if (data.to) {
      const recipientSocketId = onlineUsers.get(data.to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('user_typing', {
          from: socket.username,
          typing: true
        });
      }
    } else {
      socket.broadcast.emit('user_typing', {
        from: socket.username,
        typing: true
      });
    }
  });

  socket.on('typing_stop', (data) => {
    if (data.to) {
      const recipientSocketId = onlineUsers.get(data.to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('user_typing', {
          from: socket.username,
          typing: false
        });
      }
    } else {
      socket.broadcast.emit('user_typing', {
        from: socket.username,
        typing: false
      });
    }
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('users_updated', Array.from(onlineUsers.keys()));
      console.log(`Пользователь ${socket.username} отключился`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});