import jwt from 'jsonwebtoken';

export const JWT_SECRET =
  process.env.JWT_SECRET || 'joinus-dev-secret-change-me';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username);
}

export function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 6 &&
    password.length <= 100
  );
}

/** Blue-family palette so every avatar fits the Join Us look. */
const AVATAR_PALETTE = [
  '#3b82f6', '#2563eb', '#0ea5e9', '#22d3ee',
  '#38bdf8', '#60a5fa', '#818cf8', '#6366f1',
];

export function pickAvatarColor(username) {
  let hash = 0;
  for (const ch of String(username)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Strip sensitive fields before sending a user to clients. */
export function publicUser(u) {
  return {
    id: String(u.id),
    username: u.username,
    displayName: u.displayName || u.username,
    avatarColor: u.avatarColor,
    role: u.role,
    banned: !!u.banned,
    createdAt: u.createdAt,
  };
}

/** Express middleware — requires a valid Bearer token for a non-banned user. */
export function requireAuth(store) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });

    const user = await store.getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    if (user.banned) return res.status(403).json({ error: 'Account suspended' });

    req.user = user;
    next();
  };
}
