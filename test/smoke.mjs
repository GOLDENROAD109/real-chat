/**
 * Join Us — end-to-end smoke test.
 * Requires the server to be running (npm start), then: node test/smoke.mjs
 * Env: BASE_URL (default http://localhost:3000)
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let pass = 0, fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  cond ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a socket event with a timeout. */
function once(sock, event, timeout = 5000) {
  return Promise.race([
    new Promise((r) => sock.once(event, r)),
    wait(timeout).then(() => { throw new Error(`timeout waiting for "${event}"`); }),
  ]);
}

/** Emit with ack, wrapped in a promise. */
const emit = (sock, event, payload) =>
  new Promise((r) => (payload === undefined ? sock.emit(event, r) : sock.emit(event, payload, r)));

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const admin = await login('admin', 'admin123').then((r) => r.data);
  const alice = await login('alice', 'alice123').then((r) => r.data);

  const adminSock = io(BASE, { auth: { token: admin.token } });
  await once(adminSock, 'connect');
  check('admin socket connected', adminSock.connected);

  // attach roster listener BEFORE alice connects so we catch her join broadcast
  const rosterPromise = once(adminSock, 'presence:roster');
  const aliceSock = io(BASE, { auth: { token: alice.token } });
  await once(aliceSock, 'connect');
  check('alice socket connected', aliceSock.connected);

  const roster = await rosterPromise;
  check('roster includes alice', roster.some((u) => u.username === 'alice'));

  // alice sends a message → admin receives the broadcast
  const msgPromise = once(adminSock, 'message:new');
  const sent = await emit(aliceSock, 'message:send', { content: 'Hello from the socket test! 🧪' });
  check('send ack ok', sent.ok === true);
  const msg = await msgPromise;
  check('admin received broadcast', msg.content.includes('socket test'));

  // permissions on delete
  const denied = await emit(aliceSock, 'message:delete', { id: '1' });
  check('member cannot delete others’ messages', denied.error === 'Not allowed');

  const delEvent = once(aliceSock, 'message:deleted');
  const del = await emit(adminSock, 'message:delete', { id: msg.id });
  check('admin can delete any message', del.ok === true);
  check('delete broadcast received', (await delEvent).id === msg.id);

  // admin-only actions
  const forbidden = await emit(aliceSock, 'admin:clearChat');
  check('member blocked from clearChat', forbidden.error === 'Admin only');
  const forbidden2 = await emit(aliceSock, 'admin:setBanned', { userId: admin.user.id, banned: true });
  check('member blocked from banning', forbidden2.error === 'Admin only');

  // announcements
  const annPromise = once(aliceSock, 'announcement');
  await emit(adminSock, 'admin:announce', { text: 'Server test announcement' });
  check('announcement broadcast received', (await annPromise).text === 'Server test announcement');

  // admin lists users
  const list = await emit(adminSock, 'admin:listUsers');
  check('admin:listUsers ok', list.ok === true && list.users.length >= 2);

  // ban flow: alice is force-logged-out, then blocked from login
  const fl = once(aliceSock, 'force:logout');
  const ban = await emit(adminSock, 'admin:setBanned', { userId: alice.user.id, banned: true });
  check('ban ack ok', ban.ok === true);
  check('banned user force-logged-out', !!(await fl).reason);

  const bannedLogin = await login('alice', 'alice123');
  check('banned login rejected (403)', bannedLogin.status === 403);

  // eslint-disable-next-line
  const unban = await emit(adminSock, 'admin:setBanned', { userId: alice.user.id, banned: false });
  check('unban ack ok', unban.ok === true);
  const relogin = await login('alice', 'alice123');
  check('unbanned user can log in again', relogin.status === 200);

  // self-ban protection
  const selfBan = await emit(adminSock, 'admin:setBanned', { userId: admin.user.id, banned: true });
  check('admin cannot ban self', selfBan.error === 'You cannot ban yourself');

  // bad tokens rejected
  const badSock = io(BASE, { auth: { token: 'garbage' } });
  const err = await once(badSock, 'connect_error');
  check('bad token rejected', err.message === 'Authentication required');
  badSock.close();

  // rate limiting: two rapid messages → second rejected
  const ok1 = await emit(adminSock, 'message:send', { content: 'rate limit probe 1' });
  const ok2 = await emit(adminSock, 'message:send', { content: 'rate limit probe 2' });
  check('rate limiter kicks in', ok1.ok === true && !!ok2.error);
  await emit(adminSock, 'message:delete', { id: ok1.id });

  adminSock.close();
  aliceSock.close();

  console.log(`\n${fail === 0 ? '🎉 ALL PASSED' : '⚠️  SOME FAILED'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 smoke test crashed:', err.message);
  process.exit(1);
});

// global watchdog
setTimeout(() => {
  console.error('\n⏱️  smoke test timed out');
  process.exit(1);
}, 25000);
