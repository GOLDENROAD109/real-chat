import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';

import { initDb } from './db/index.js';
import {
  signToken,
  verifyToken,
  requireAuth,
  validateUsername,
  validatePassword,
  pickAvatarColor,
  publicUser,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const MAX_MESSAGE_LENGTH = 500;

const { mode, store } = await initDb();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const auth = requireAuth(store);

// ── REST API ───────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode, time: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const rawUsername = String(req.body?.username || '').trim();
    const username = rawUsername.toLowerCase();
    const password = req.body?.password;
    const displayName = String(req.body?.displayName || rawUsername).trim().slice(0, 30);

    if (!validateUsername(username)) {
      return res
        .status(400)
        .json({ error: 'Username must be 3–20 characters (letters, numbers, _)' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (await store.getUserByUsername(username)) {
      return res.status(409).json({ error: 'That username is taken' });
    }

    // First account ever becomes the admin
    const isFirst = (await store.countUsers()) === 0;
    const user = await store.createUser({
      username,
      passwordHash: await bcrypt.hash(password, 10),
      displayName: displayName || username,
      avatarColor: pickAvatarColor(username),
      role: isFirst ? 'admin' : 'member',
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user), mode });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = await store.getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.banned) {
      return res.status(403).json({ error: 'This account has been suspended' });
    }

    res.json({ token: signToken(user), user: publicUser(user), mode });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Could not sign in' });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user), mode });
});

app.get('/api/messages', auth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  res.json({ messages: await store.listMessages(limit) });
});

// ── Real-time layer ────────────────────────────────────────────────────

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

/** userId -> { user: publicUser, sockets: Set<socketId> } */
const online = new Map();

const roster = () =>
  [...online.values()].map(({ user }) => user).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );

const broadcastRoster = () => io.emit('presence:roster', roster());

io.use(async (socket, next) => {
  try {
    const payload = verifyToken(socket.handshake.auth?.token || '');
    if (!payload) return next(new Error('Authentication required'));
    const user = await store.getUserById(payload.sub);
    if (!user) return next(new Error('Authentication required'));
    if (user.banned) return next(new Error('Account suspended'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Authentication required'));
  }
});

const disconnectUserSockets = (userId) => {
  for (const socket of io.sockets.sockets.values()) {
    if (String(socket.user.id) === String(userId)) {
      socket.emit('force:logout', { reason: 'Your account was suspended by an admin.' });
      socket.disconnect(true);
    }
  }
};

io.on('connection', (socket) => {
  const me = publicUser(socket.user);
  const userId = me.id;

  // Track presence
  if (!online.has(userId)) {
    online.set(userId, { user: me, sockets: new Set() });
    socket.broadcast.emit('system', { text: `${me.displayName} joined` });
  }
  online.get(userId).sockets.add(socket.id);
  broadcastRoster();

  // ── Messaging ──
  let lastMessageAt = 0;
  socket.on('message:send', async (payload, ack) => {
    try {
      const now = Date.now();
      if (now - lastMessageAt < 500) return ack?.({ error: 'Slow down a little ✌️' });
      lastMessageAt = now;

      const content = String(payload?.content || '').trim();
      if (!content) return ack?.({ error: 'Message is empty' });
      if (content.length > MAX_MESSAGE_LENGTH) {
        return ack?.({ error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters` });
      }

      const message = await store.addMessage({
        userId: socket.user.id,
        username: socket.user.username,
        displayName: socket.user.displayName,
        avatarColor: socket.user.avatarColor,
        role: socket.user.role,
        content,
      });
      io.emit('message:new', message);
      ack?.({ ok: true, id: message.id });
    } catch (err) {
      console.error('message:send error:', err);
      ack?.({ error: 'Could not send message' });
    }
  });

  socket.on('typing', () => {
    socket.broadcast.emit('typing', { userId, displayName: me.displayName });
  });

  socket.on('message:delete', async ({ id } = {}, ack) => {
    try {
      const message = await store.getMessage(id);
      if (!message) return ack?.({ error: 'Message not found' });

      const isAdmin = socket.user.role === 'admin';
      const isOwn = String(message.userId) === String(socket.user.id);
      if (!isAdmin && !isOwn) return ack?.({ error: 'Not allowed' });

      await store.deleteMessage(id);
      io.emit('message:deleted', { id: String(id) });
      ack?.({ ok: true });
    } catch (err) {
      console.error('message:delete error:', err);
      ack?.({ error: 'Could not delete message' });
    }
  });

  // ── Admin controls ──
  const requireAdmin = (ack) => {
    if (socket.user.role !== 'admin') {
      ack?.({ error: 'Admin only' });
      return false;
    }
    return true;
  };

  socket.on('admin:listUsers', async (ack) => {
    if (!requireAdmin(ack)) return;
    try {
      const users = await store.listUsers();
      ack?.({
        ok: true,
        users: users.map((u) => ({ ...publicUser(u), online: online.has(String(u.id)) })),
      });
    } catch (err) {
      ack?.({ error: 'Could not load users' });
    }
  });

  socket.on('admin:setBanned', async ({ userId: targetId, banned } = {}, ack) => {
    if (!requireAdmin(ack)) return;
    try {
      if (String(targetId) === String(socket.user.id)) {
        return ack?.({ error: 'You cannot ban yourself' });
      }
      const updated = await store.setBanned(targetId, banned);
      if (!updated) return ack?.({ error: 'User not found' });

      if (banned) {
        disconnectUserSockets(targetId);
        io.emit('system', { text: `${updated.displayName || updated.username} was banned by an admin` });
      } else {
        io.emit('system', { text: `${updated.displayName || updated.username} was unbanned` });
      }
      broadcastRoster();
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: 'Could not update user' });
    }
  });

  socket.on('admin:clearChat', async (ack) => {
    if (!requireAdmin(ack)) return;
    try {
      await store.clearMessages();
      io.emit('chat:cleared');
      io.emit('system', { text: `${me.displayName} cleared the chat` });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: 'Could not clear chat' });
    }
  });

  socket.on('admin:announce', async ({ text } = {}, ack) => {
    if (!requireAdmin(ack)) return;
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return ack?.({ error: 'Announcement is empty' });
    io.emit('announcement', { text: clean, from: me.displayName, at: new Date().toISOString() });
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const entry = online.get(userId);
    if (!entry) return;
    entry.sockets.delete(socket.id);
    if (entry.sockets.size === 0) {
      online.delete(userId);
      socket.broadcast.emit('system', { text: `${me.displayName} left` });
    }
    broadcastRoster();
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╭─────────────────────────────────────────╮');
  console.log('  │   💬  Join Us — chat server running     │');
  console.log(`  │   → http://localhost:${String(PORT).padEnd(5, ' ')}               │`);
  console.log(`  │   → storage: ${(mode === 'supabase' ? 'Supabase' : 'demo (local JSON)').padEnd(24, ' ')}│`);
  console.log('  ╰─────────────────────────────────────────╯');
  console.log('');
});
