import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/**
 * Local JSON-file store. Used automatically when Supabase is not configured,
 * so the MVP runs out of the box with zero setup.
 * Implements the same interface as the Supabase store.
 */
export async function createDemoStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let state = { users: [], messages: [], messageSeq: 1 };
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      state = { users: [], messages: [], messageSeq: 1, ...parsed };
    } catch (err) {
      console.warn('⚠️  Demo database unreadable, starting fresh:', err.message);
    }
  }

  let saveTimer = null;
  const save = () => {
    if (saveTimer) return; // coalesce bursts of writes
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const tmp = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DB_FILE);
    }, 25);
  };

  const toUser = (r) =>
    r && {
      id: r.id,
      username: r.username,
      passwordHash: r.password_hash,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      role: r.role,
      banned: r.banned,
      createdAt: r.created_at,
    };

  const toMessage = (r) =>
    r && {
      id: String(r.id),
      userId: String(r.user_id),
      username: r.username,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    };

  const store = {
    mode: 'demo',

    async countUsers() {
      return state.users.length;
    },

    async getUserByUsername(username) {
      return toUser(state.users.find((u) => u.username === username));
    },

    async getUserById(id) {
      return toUser(state.users.find((u) => String(u.id) === String(id)));
    },

    async createUser({ username, passwordHash, displayName, avatarColor, role }) {
      const row = {
        id: crypto.randomUUID(),
        username,
        password_hash: passwordHash,
        display_name: displayName || username,
        avatar_color: avatarColor,
        role: role || 'member',
        banned: false,
        created_at: new Date().toISOString(),
      };
      state.users.push(row);
      save();
      return toUser(row);
    },

    async listUsers() {
      return [...state.users].map(toUser);
    },

    async setBanned(id, banned) {
      const u = state.users.find((x) => String(x.id) === String(id));
      if (!u) return null;
      u.banned = !!banned;
      save();
      return toUser(u);
    },

    async addMessage({ userId, username, displayName, avatarColor, role, content }) {
      const row = {
        id: state.messageSeq++,
        user_id: String(userId),
        username,
        display_name: displayName || username,
        avatar_color: avatarColor,
        role,
        content,
        created_at: new Date().toISOString(),
      };
      state.messages.push(row);
      if (state.messages.length > 1000) {
        state.messages.splice(0, state.messages.length - 1000); // cap history
      }
      save();
      return toMessage(row);
    },

    async getMessage(id) {
      return toMessage(state.messages.find((m) => String(m.id) === String(id)));
    },

    async listMessages(limit = 80) {
      return state.messages.slice(-limit).map(toMessage);
    },

    async deleteMessage(id) {
      const i = state.messages.findIndex((m) => String(m.id) === String(id));
      if (i === -1) return false;
      state.messages.splice(i, 1);
      save();
      return true;
    },

    async clearMessages() {
      state.messages = [];
      save();
    },
  };

  // ── Seed demo data on first run ──────────────────────────────────────
  if (state.users.length === 0 && process.env.SEED_DEMO !== 'false') {
    const seed = async (username, password, role, displayName, color) =>
      store.createUser({
        username,
        passwordHash: await bcrypt.hash(password, 10),
        displayName,
        avatarColor: color,
        role,
      });

    const admin = await seed('admin', 'admin123', 'admin', 'Admin', '#2563eb');
    const alice = await seed('alice', 'alice123', 'member', 'Alice', '#22d3ee');
    const bob = await seed('bob', 'bob123', 'member', 'Bob', '#818cf8');

    const base = Date.now();
    const seedMsgs = [
      [admin, 'Welcome to Join Us! 👋 This is the lobby — pull up a chair.', -1000 * 60 * 42],
      [alice, 'This place looks great. Hello everyone! 💙', -1000 * 60 * 31],
      [bob, 'Real-time chat, buttery smooth. I am in.', -1000 * 60 * 18],
      [admin, 'Tip: sign in as admin (admin / admin123) to try the admin panel.', -1000 * 60 * 5],
    ];
    for (const [u, content, offset] of seedMsgs) {
      state.messages.push({
        id: state.messageSeq++,
        user_id: String(u.id),
        username: u.username,
        display_name: u.displayName,
        avatar_color: u.avatarColor,
        role: u.role,
        content,
        created_at: new Date(base + offset).toISOString(),
      });
    }
    save();
    console.log('🌱 Demo database seeded — admin / admin123 · alice / alice123 · bob / bob123');
  }

  return store;
}
