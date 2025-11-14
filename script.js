class Messenger {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = 'general';
        this.typingTimer = null;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Табы авторизации
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Формы авторизации
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });

        // Выход
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // Отправка сообщений
        document.getElementById('message-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // Ввод сообщения (для индикатора набора)
        document.getElementById('message-input').addEventListener('input', () => {
            this.handleTyping();
        });

        // Выбор пользователя для чата
        document.addEventListener('click', (e) => {
            if (e.target.closest('.user-item')) {
                const userItem = e.target.closest('.user-item');
                const username = userItem.dataset.user;
                this.selectChat(username);
            }
        });
    }

    switchTab(tabName) {
        // Обновляем активные табы
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.toggle('active', tab.id === `${tabName}-form`);
        });
        
        document.getElementById('auth-error').style.display = 'none';
    }

    async login() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.handleAuthSuccess(data);
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Ошибка соединения');
        }
    }

    async register() {
        const username = document.getElementById('register-username').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.handleAuthSuccess(data);
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Ошибка соединения');
        }
    }

    handleAuthSuccess(data) {
        this.currentUser = data.username;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        
        this.showAppInterface();
        this.initializeSocket();
        this.loadMessages();
        this.loadUsers();
    }

    showAppInterface() {
        document.getElementById('auth-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        document.getElementById('current-user').textContent = this.currentUser;
    }

    initializeSocket() {
        this.socket = io();

        this.socket.emit('user_online', this.currentUser);

        this.socket.on('new_message', (message) => {
            this.displayMessage(message);
        });

        this.socket.on('users_updated', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('user_typing', (data) => {
            this.showTypingIndicator(data);
        });
    }

    async loadMessages() {
        try {
            const response = await fetch('/api/messages');
            const messages = await response.json();
            
            const messagesList = document.getElementById('messages-list');
            messagesList.innerHTML = '';
            
            messages.forEach(message => {
                if (this.shouldShowMessage(message)) {
                    this.displayMessage(message);
                }
            });
        } catch (error) {
            console.error('Ошибка загрузки сообщений:', error);
        }
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users');
            const users = await response.json();
            this.updateUsersList(users);
        } catch (error) {
            console.error('Ошибка загрузки пользователей:', error);
        }
    }

    updateUsersList(users) {
        const usersList = document.getElementById('users-list');
        const onlineUsers = Array.isArray(users) ? users : users.filter(u => u.online);
        
        usersList.innerHTML = onlineUsers
            .filter(user => user.username !== this.currentUser)
            .map(user => `
                <div class="user-item ${user.online ? 'online' : ''}" data-user="${user.username}">
                    <i class="fas fa-user"></i>
                    <span>${user.username}</span>
                    ${user.online ? '<span class="online-status">online</span>' : ''}
                </div>
            `).join('');
    }

    selectChat(username) {
        this.currentChat = username;
        
        // Обновляем активный элемент
        document.querySelectorAll('.user-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-user="${username}"]`).classList.add('active');
        
        // Обновляем заголовок чата
        document.getElementById('chat-with').textContent = 
            username === 'general' ? 'Общий чат' : `Чат с ${username}`;
        
        // Перезагружаем сообщения
        this.loadMessages();
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (!text) return;

        const message = {
            from: this.currentUser,
            to: this.currentChat === 'general' ? null : this.currentChat,
            text: text,
            timestamp: new Date().toISOString()
        };

        this.socket.emit('send_message', message);
        input.value = '';
        
        // Останавливаем индикатор набора
        this.socket.emit('typing_stop', { to: this.currentChat === 'general' ? null : this.currentChat });
    }

    handleTyping() {
        // Очищаем предыдущий таймер
        clearTimeout(this.typingTimer);
        
        // Отправляем событие начала набора
        this.socket.emit('typing_start', { 
            to: this.currentChat === 'general' ? null : this.currentChat 
        });
        
        // Устанавливаем таймер для остановки индикатора
        this.typingTimer = setTimeout(() => {
            this.socket.emit('typing_stop', { 
                to: this.currentChat === 'general' ? null : this.currentChat 
            });
        }, 1000);
    }

    displayMessage(message) {
        if (!this.shouldShowMessage(message)) return;

        const messagesList = document.getElementById('messages-list');
        const isOwnMessage = message.from === this.currentUser;
        
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isOwnMessage ? 'own' : 'other'}`;
        messageElement.innerHTML = `
            <div class="message-header">
                ${isOwnMessage ? 'Вы' : message.from} • ${this.formatTime(message.timestamp)}
            </div>
            <div class="message-text">${this.escapeHtml(message.text)}</div>
        `;
        
        messagesList.appendChild(messageElement);
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    shouldShowMessage(message) {
        if (message.to === 'general' || !message.to) {
            return this.currentChat === 'general';
        } else {
            return (message.from === this.currentUser && message.to === this.currentChat) ||
                   (message.to === this.currentUser && message.from === this.currentChat);
        }
    }

    showTypingIndicator(data) {
        const indicator = document.getElementById('typing-indicator');
        
        if (data.typing && data.from !== this.currentUser) {
            indicator.textContent = `${data.from} печатает...`;
        } else {
            indicator.textContent = '';
        }
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showError(message) {
        const errorElement = document.getElementById('auth-error');
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        
        if (this.socket) {
            this.socket.disconnect();
        }
        
        location.reload();
    }

    checkAuth() {
        const token = localStorage.getItem('token');
        const username = localStorage.getItem('username');
        
        if (token && username) {
            this.currentUser = username;
            this.showAppInterface();
            this.initializeSocket();
            this.loadMessages();
            this.loadUsers();
        }
    }
}

// Инициализация приложения
const app = new Messenger();

// Проверяем авторизацию при загрузке
document.addEventListener('DOMContentLoaded', () => {
    app.checkAuth();
});