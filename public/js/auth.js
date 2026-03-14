// Authentication functions

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}

async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        alert('Please fill in all fields');
        return;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            state.currentUser = data.user;
            state.isAuthenticated = true;
            showApp();
            await loadUserServers();
            initializeSocket();
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login');
    }
}

async function register() {
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    if (!username || !email || !password) {
        alert('Please fill in all fields');
        return;
    }

    if (username.length < 3 || username.length > 32) {
        alert('Username must be between 3 and 32 characters');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();

        if (response.ok) {
            state.currentUser = data.user;
            state.isAuthenticated = true;
            showApp();
            await loadUserServers();
            initializeSocket();
        } else {
            alert(data.error || 'Registration failed');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('An error occurred during registration');
    }
}

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}

async function login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) { alert('Please fill in all fields'); return; }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            const returnTo = new URLSearchParams(window.location.search).get('returnTo');
            if (returnTo && /^https:\/\/([a-z0-9-]+\.)?nexusguild\.gg(\/.*)?$/.test(returnTo)) {
                window.location.href = returnTo;
                return;
            }
            state.currentUser = data.user;
            loadUnread();
            state.isAuthenticated = true;
            showApp();
            await loadUserServers();
            initializeSocket();
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login');
    }
}

async function register() {
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    if (!username || !email || !password) { alert('Please fill in all fields'); return; }
    if (username.length < 3 || username.length > 32) { alert('Username must be 3?32 characters'); return; }
    if (password.length < 6) { alert('Password must be at least 6 characters'); return; }

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();

        if (response.ok) {
            const returnTo = new URLSearchParams(window.location.search).get('returnTo');
            if (returnTo && /^https:\/\/([a-z0-9-]+\.)?nexusguild\.gg(\/.*)?$/.test(returnTo)) {
                window.location.href = returnTo;
                return;
            }
            state.currentUser = data.user;
            loadUnread();
            state.isAuthenticated = true;
            showApp();
            await loadUserServers();
            initializeSocket();
        } else {
            alert(data.error || 'Registration failed');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('An error occurred during registration');
    }
}

function showForgotPassword() {
    const form = document.getElementById('forgot-password-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function requestPasswordReset() {
    const email = document.getElementById('forgot-email')?.value?.trim();
    const msgEl = document.getElementById('forgot-msg');
    if (!email) { msgEl.textContent = 'Enter your email address.'; msgEl.style.color = '#da373c'; return; }

    const res = await fetch('/api/auth/reset-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    const data = await res.json();
    msgEl.style.color = res.ok ? '#23a559' : '#da373c';
    msgEl.textContent = data.message || data.error || 'Something went wrong.';
}

async function logout() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            // Disconnect socket cleanly
            if (state.socket) {
                state.socket.disconnect();
                state.socket = null;
            }

            // ? Reset ALL state, not just the arrays
            state.currentUser = null;
            state.currentServer = null;
            state.currentChannel = null;
            state.isAuthenticated = false;
            state.servers = [];
            state.channels = [];
            state.messages = [];
            state.members = [];

            // ? Clear the UI panels so old data isn't visible on next login
            document.getElementById('serverList').innerHTML = '';
            document.getElementById('channelsList').innerHTML = '';
            document.getElementById('messagesContainer').innerHTML = '';
            document.getElementById('membersPanel').innerHTML = '';
            document.getElementById('currentServerName').textContent = 'Select a server';
            document.getElementById('currentChannelName').textContent = '';

            showAuth();
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}