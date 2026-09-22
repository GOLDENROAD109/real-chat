/* ═══════════════════════════════════════════════════════════════════
   Join Us — client app
   Auth · real-time chat · presence · admin controls
   ═══════════════════════════════════════════════════════════════════ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  token: localStorage.getItem('joinus.token') || null,
  user: null,
  mode: 'demo',
  socket: null,
  connected: false,
  lastMsg: null, // { userId, time } for message grouping
  typingUsers: new Map(), // userId -> { name, timer }
  pendingScroll: false,
};

/* ── helpers ────────────────────────────────────────────────────────── */

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(text, type = 'info', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast icon ${type}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 350);
  }, ms);
}

function avatarEl(user, size = '') {
  const el = document.createElement('span');
  el.className = `avatar ${size}`.trim();
  el.style.setProperty('--c', user.avatarColor || '#3b82f6');
  el.textContent = (user.displayName || user.username || '?').slice(0, 1);
  return el;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function adminBadge() {
  const b = document.createElement('span');
  b.className = 'badge-admin';
  b.textContent = 'admin';
  return b;
}

/* ── view switching ─────────────────────────────────────────────────── */

function showView(name) {
  const auth = $('#view-auth');
  const chat = $('#view-chat');
  const target = name === 'chat' ? chat : auth;
  const other = name === 'chat' ? auth : chat;
  other.hidden = true;
  target.hidden = false;
  target.classList.remove('switching-in');
  void target.offsetWidth; // restart animation
  target.classList.add('switching-in');
}

/* ── auth view ──────────────────────────────────────────────────────── */

function initTabs(tabsEl, onChange) {
  const tabs = $$('.tab', tabsEl);
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      tabsEl.classList.toggle('right', i === 1);
      onChange?.(i, tab);
    });
  });
}

function setFormError(form, message) {
  const el = $('[data-error]', form);
  if (!message) {
    el.hidden = true;
    el.textContent = '';
  } else {
    el.textContent = message;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }
}

function setLoading(form, loading) {
  const btn = $('button[type="submit"]', form);
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.textContent = btn.dataset.loadingLabel || 'Working…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

function initAuthView() {
  const loginForm = $('#form-login');
  const registerForm = $('#form-register');

  initTabs($('.tabs', $('.auth-card')), (i) => {
    loginForm.hidden = i === 1;
    registerForm.hidden = i === 0;
    setFormError(loginForm, null);
    setFormError(registerForm, null);
  });

  // password visibility toggles
  $$('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('input', btn.parentElement);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError(loginForm, null);
    setLoading(loginForm, true);
    try {
      const fd = new FormData(loginForm);
      const { token, user } = await api('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { username: fd.get('username'), password: fd.get('password') },
      });
      localStorage.setItem('joinus.token', token);
      state.token = token;
      state.user = user;
      enterChat();
    } catch (err) {
      setFormError(loginForm, err.message);
    } finally {
      setLoading(loginForm, false);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormError(registerForm, null);
    setLoading(registerForm, true);
    try {
      const fd = new FormData(registerForm);
      const { token, user } = await api('/api/auth/register', {
        method: 'POST',
        auth: false,
        body: {
          username: fd.get('username'),
          displayName: fd.get('displayName'),
          password: fd.get('password'),
        },
      });
      localStorage.setItem('joinus.token', token);
      state.token = token;
      state.user = user;
      toast(`Welcome to Join Us, ${user.displayName}! 🎉`, 'success');
      enterChat();
    } catch (err) {
      setFormError(registerForm, err.message);
    } finally {
      setLoading(registerForm, false);
    }
  });

  // demo credential quick-fill
  $$('.demo-cred').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#tab-login').click();
      const [u, p] = btn.dataset.fill.split('|');
      loginForm.username.value = u;
      loginForm.password.value = p;
      loginForm.querySelector('button[type="submit"]').focus();
    });
  });
}

async function refreshModeBadge() {
  try {
    const { mode } = await api('/api/health', { auth: false });
    state.mode = mode;
    const badge = $('#mode-badge');
    badge.hidden = false;
    badge.textContent = mode === 'supabase' ? '⚡ supabase live' : 'demo mode';
    $('#demo-hint').hidden = mode !== 'demo';
  } catch {
    /* server waking up — ignore */
  }
}

/* ── chat view ──────────────────────────────────────────────────────── */

function initChatView() {
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-sidebar').addEventListener('click', () => toggleSidebar(true));
  $('#sidebar-backdrop').addEventListener('click', () => toggleSidebar(false));
  $('#btn-dismiss-announcement').addEventListener('click', () => {
    $('#announcement').hidden = true;
  });

  $('#jump-pill').addEventListener('click', () => {
    scrollMessagesToBottom(true);
    hideJumpPill();
  });

  $('#messages').addEventListener('scroll', () => {
    if (nearBottom()) hideJumpPill();
  });

  // composer
  const composer = $('#composer');
  const input = $('#composer-input');
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });
  let lastTypingSent = 0;
  input.addEventListener('input', () => {
    const now = Date.now();
    if (state.connected && now - lastTypingSent > 1500) {
      lastTypingSent = now;
      state.socket?.emit('typing');
    }
  });

  initAdminPanel();
}

function toggleSidebar(open) {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const willOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', willOpen);
  backdrop.hidden = !willOpen;
}

function updateMeChip() {
  const me = state.user;
  const av = $('#me-avatar');
  av.style.setProperty('--c', me.avatarColor || '#3b82f6');
  av.textContent = (me.displayName || me.username).slice(0, 1);
  $('#me-name').textContent = me.displayName || me.username;
  $('#btn-admin').hidden = me.role !== 'admin';
}

async function enterChat() {
  updateMeChip();
  showView('chat');
  await loadHistory();
  connectSocket();
  $('#composer-input').focus();
}

function logout() {
  localStorage.removeItem('joinus.token');
  state.token = null;
  state.user = null;
  state.lastMsg = null;
  state.typingUsers.forEach(({ timer }) => clearTimeout(timer));
  state.typingUsers.clear();
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
    state.socket = null;
  }
  $('#messages').querySelectorAll('.msg, .system-line').forEach((n) => n.remove());
  $('#announcement').hidden = true;
  closeAdminDrawer();
  showView('auth');
  refreshModeBadge();
}

/* ── messages rendering ─────────────────────────────────────────────── */

const messagesEl = () => $('#messages');

function nearBottom() {
  const el = messagesEl();
  return el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}

function scrollMessagesToBottom(smooth = false) {
  const el = messagesEl();
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

function showJumpPill() {
  $('#jump-pill').hidden = false;
}
function hideJumpPill() {
  $('#jump-pill').hidden = true;
}

function clearMessages() {
  messagesEl().querySelectorAll('.msg, .system-line').forEach((n) => n.remove());
  state.lastMsg = null;
  updateEmptyState();
}

function updateEmptyState() {
  const has = !!messagesEl().querySelector('.msg, .system-line');
  $('#empty-state').hidden = has;
}

function appendSystemLine(text) {
  const el = document.createElement('div');
  el.className = 'system-line';
  el.textContent = text;
  messagesEl().append(el);
  state.lastMsg = null; // break message grouping
  trimDom();
  if (nearBottom()) scrollMessagesToBottom(true);
}

function trimDom() {
  const nodes = messagesEl().querySelectorAll('.msg, .system-line');
  if (nodes.length > 320) nodes.forEach((n, i) => i < nodes.length - 300 && n.remove());
}

async function loadHistory() {
  clearMessages();
  try {
    const { messages } = await api('/api/messages?limit=80');
    messages.forEach((m) => renderMessage(m, { instant: true }));
    updateEmptyState();
    scrollMessagesToBottom(false);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderMessage(m, { instant = false } = {}) {
  const isOwn = state.user && String(m.userId) === String(state.user.id);
  const canDelete = isOwn || state.user?.role === 'admin';

  const now = new Date(m.createdAt).getTime();
  const compact =
    !instant &&
    state.lastMsg &&
    state.lastMsg.userId === String(m.userId) &&
    now - state.lastMsg.time < 5 * 60 * 1000;

  const row = document.createElement('div');
  row.className = `msg${isOwn ? ' own' : ''}${compact ? ' compact' : ' later'}`;
  row.dataset.id = String(m.id);
  if (instant) row.style.animation = 'none';

  const avatar = avatarEl(m);
  if (isOwn) avatar.style.display = 'none';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const author = document.createElement('span');
  author.className = 'msg-author';
  author.textContent = isOwn ? 'You' : m.displayName || m.username;
  meta.append(author);
  if (m.role === 'admin') meta.append(adminBadge());
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = fmtTime(m.createdAt);
  meta.append(time);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = m.content;

  if (canDelete) {
    const del = document.createElement('button');
    del.className = 'msg-delete';
    del.title = 'Delete message';
    del.setAttribute('aria-label', 'Delete message');
    del.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    del.addEventListener('click', () => {
      state.socket?.emit('message:delete', { id: m.id }, (res) => {
        if (!res?.ok) toast(res?.error || 'Could not delete message', 'error');
      });
    });
    bubble.append(del);
  }

  body.append(meta, bubble);
  row.append(avatar, body);
  messagesEl().append(row);

  state.lastMsg = { userId: String(m.userId), time: now };
  trimDom();
  return row;
}

function removeMessage(id) {
  const row = messagesEl().querySelector(`.msg[data-id="${CSS.escape(String(id))}"]`);
  if (!row) return;
  row.classList.add('removing');
  setTimeout(() => {
    row.remove();
    updateEmptyState();
  }, 320);
}

/* ── typing indicator ───────────────────────────────────────────────── */

function renderTyping() {
  const el = $('#typing');
  const names = [...state.typingUsers.values()].map((t) => t.name);
  if (names.length === 0) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = '';
  const dots = document.createElement('span');
  dots.className = 'typing-dots';
  dots.innerHTML = '<i></i><i></i><i></i>';
  const label = document.createElement('span');
  label.textContent =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : 'Several people are typing…';
  el.append(dots, label);
}

function handleTyping({ userId, displayName }) {
  clearTimeout(state.typingUsers.get(userId)?.timer);
  const timer = setTimeout(() => {
    state.typingUsers.delete(userId);
    renderTyping();
  }, 2600);
  state.typingUsers.set(userId, { name: displayName, timer });
  renderTyping();
}

/* ── presence ───────────────────────────────────────────────────────── */

function renderRoster(users) {
  $('#online-count').textContent = String(users.length);
  const list = $('#user-list');
  list.textContent = '';
  users.forEach((u, i) => {
    const li = document.createElement('li');
    li.className = 'user-row';
    li.style.animationDelay = `${Math.min(i * 0.04, 0.4)}s`;

    const meta = document.createElement('div');
    meta.className = 'user-row-meta';
    const name = document.createElement('div');
    name.className = 'user-row-name';
    name.textContent = u.displayName || u.username;
    if (u.role === 'admin') name.append(adminBadge());
    if (state.user && String(u.id) === String(state.user.id)) {
      const you = document.createElement('span');
      you.className = 'badge-you';
      you.textContent = '(you)';
      name.append(you);
    }
    const status = document.createElement('div');
    status.className = 'user-row-status';
    status.textContent = 'online now';
    meta.append(name, status);

    li.append(avatarEl(u), meta);
    list.append(li);
  });
}

/* ── announcements ──────────────────────────────────────────────────── */

function showAnnouncement({ text, from }) {
  $('#announcement-text').textContent = `${from}: ${text}`;
  $('#announcement').hidden = false;
}

/* ── socket ─────────────────────────────────────────────────────────── */

function setConnStatus(status) {
  const el = $('#conn-status');
  el.classList.remove('online', 'offline');
  $('.conn-label', el).textContent = status;
  if (status === 'online') el.classList.add('online');
  if (status === 'reconnecting' || status === 'offline') el.classList.add('offline');
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();

  const socket = io({ auth: { token: state.token } });
  state.socket = socket;
  setConnStatus('connecting');

  socket.on('connect', () => {
    state.connected = true;
    setConnStatus('online');
  });

  socket.on('disconnect', () => {
    state.connected = false;
    setConnStatus('reconnecting');
  });

  socket.on('connect_error', (err) => {
    state.connected = false;
    setConnStatus('offline');
    if (['Authentication required', 'Account suspended'].includes(err.message)) {
      toast(err.message === 'Account suspended' ? 'Your account was suspended.' : 'Session expired — please sign in again.', 'error');
      logout();
    }
  });

  socket.on('presence:roster', renderRoster);

  socket.on('message:new', (m) => {
    // drop typing indicator for the sender
    if (state.typingUsers.delete(String(m.userId))) renderTyping();

    const wasNear = nearBottom();
    renderMessage(m);
    if (wasNear || (state.user && String(m.userId) === String(state.user.id))) {
      scrollMessagesToBottom(true);
    } else {
      showJumpPill();
    }
  });

  socket.on('message:deleted', ({ id }) => removeMessage(id));

  socket.on('chat:cleared', () => {
    clearMessages();
    toast('Chat history was cleared', 'info');
  });

  socket.on('system', ({ text }) => appendSystemLine(text));

  socket.on('typing', (data) => {
    if (state.user && String(data.userId) !== String(state.user.id)) handleTyping(data);
  });

  socket.on('announcement', (a) => {
    showAnnouncement(a);
    toast('📣 New announcement', 'info');
  });

  socket.on('force:logout', ({ reason }) => {
    toast(reason || 'You were signed out.', 'error', 5200);
    logout();
  });
}

/* ── sending ────────────────────────────────────────────────────────── */

function sendMessage() {
  const input = $('#composer-input');
  const content = input.value.trim();
  if (!content) return;
  if (!state.connected) {
    toast('Not connected — trying to reconnect…', 'error');
    return;
  }
  state.socket.emit('message:send', { content }, (res) => {
    if (!res?.ok) {
      toast(res?.error || 'Could not send message', 'error');
    } else {
      input.value = '';
      input.focus();
    }
  });
}

/* ── admin panel ────────────────────────────────────────────────────── */

function initAdminPanel() {
  $('#btn-admin').addEventListener('click', openAdminDrawer);
  $('#btn-close-admin').addEventListener('click', closeAdminDrawer);
  $('#admin-overlay').addEventListener('click', closeAdminDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAdminDrawer();
  });

  initTabs($('.tabs.small'), (i) => {
    $('#admin-panel-users').hidden = i === 1;
    $('#admin-panel-controls').hidden = i === 0;
  });

  $('#form-announce').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = new FormData(e.target).get('text');
    state.socket?.emit('admin:announce', { text }, (res) => {
      if (res?.ok) {
        e.target.reset();
        toast('Announcement broadcast 📣', 'success');
      } else {
        toast(res?.error || 'Could not announce', 'error');
      }
    });
  });

  $('#btn-clear-chat').addEventListener('click', () => {
    if (!confirm('Delete ALL messages in the lobby? This cannot be undone.')) return;
    state.socket?.emit('admin:clearChat', (res) => {
      if (!res?.ok) toast(res?.error || 'Could not clear chat', 'error');
    });
  });
}

function openAdminDrawer() {
  $('#admin-overlay').hidden = false;
  $('#admin-drawer').classList.add('open');
  $('#admin-drawer').setAttribute('aria-hidden', 'false');
  refreshAdminUsers();
}

function closeAdminDrawer() {
  $('#admin-overlay').hidden = true;
  $('#admin-drawer').classList.remove('open');
  $('#admin-drawer').setAttribute('aria-hidden', 'true');
}

function refreshAdminUsers() {
  state.socket?.emit('admin:listUsers', (res) => {
    if (!res?.ok) return toast(res?.error || 'Could not load members', 'error');
    renderAdminUsers(res.users);
  });
}

function renderAdminUsers(users) {
  const list = $('#admin-user-list');
  list.textContent = '';
  users.forEach((u, i) => {
    const li = document.createElement('li');
    li.className = 'admin-user-row';
    li.style.animationDelay = `${Math.min(i * 0.04, 0.3)}s`;

    const meta = document.createElement('div');
    meta.className = 'user-row-meta';
    const name = document.createElement('div');
    name.className = 'user-row-name';
    name.textContent = u.displayName || u.username;
    if (u.role === 'admin') name.append(adminBadge());
    if (u.banned) {
      const b = document.createElement('span');
      b.className = 'badge-banned';
      b.textContent = 'banned';
      name.append(b);
    }
    const status = document.createElement('div');
    status.className = `user-row-status ${u.online ? 'online' : 'offline'}`;
    status.textContent = u.online ? 'online now' : `offline · @${u.username}`;
    meta.append(name, status);

    li.append(avatarEl(u), meta);

    const isSelf = state.user && String(u.id) === String(state.user.id);
    if (!isSelf) {
      const btn = document.createElement('button');
      btn.className = `mini-btn${u.banned ? '' : ' danger'}`;
      btn.textContent = u.banned ? 'Unban' : 'Ban';
      btn.addEventListener('click', () => {
        state.socket?.emit('admin:setBanned', { userId: u.id, banned: !u.banned }, (res) => {
          if (res?.ok) {
            toast(`${u.displayName || u.username} ${u.banned ? 'unbanned' : 'banned'} ✓`, 'success');
            refreshAdminUsers();
          } else {
            toast(res?.error || 'Action failed', 'error');
          }
        });
      });
      li.append(btn);
    }

    list.append(li);
  });
}

/* ── boot ───────────────────────────────────────────────────────────── */

async function boot() {
  initAuthView();
  initChatView();
  await refreshModeBadge();

  if (state.token) {
    try {
      const { user, mode } = await api('/api/me');
      state.user = user;
      state.mode = mode;
      await enterChat();
      return;
    } catch {
      localStorage.removeItem('joinus.token');
      state.token = null;
    }
  }
  showView('auth');
}

boot();
