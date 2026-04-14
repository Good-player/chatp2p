// ── app.js ────────────────────────────────────────────────────────────────
// Main controller. Pure Firebase — no WebRTC, no P2P, no signaling.

import { auth }                           from './firebase-config.js';
import {
  onAuthReady, getMyNick, getMyFriendCode,
  login, register, logout, updateNick, resetPassword,
} from './auth.js';
import {
  PUBLIC_ROOMS, randomCode,
  ensurePublicRooms, createRoom, joinRoom, leaveRoom,
  sendMessage, listenMessages, listenMembers,
  updatePresence, getRoom,
  setTyping, listenTyping,
  sendDM, listenDM,
  deleteMessage,
} from './chat.js';
import {
  sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  removeFriend, listenFriends, listenFriendRequests, listenInvites,
  sendRoomInvite,
} from './friends.js';
import { UI } from './ui.js';

// ── App state ─────────────────────────────────────────────────────────────
let currentRoom      = null;
let currentDMUid     = null;
let currentDMNick    = '';
let unsubMessages    = null;
let unsubMembers     = null;
let unsubTyping      = null;
let unsubFriends     = null;
let unsubRequests    = null;
let unsubInvites     = null;
let _typingTimer     = null;
let _presenceTimer   = null;

// ── Auth gate ─────────────────────────────────────────────────────────────
onAuthReady(async (user) => {
  if (!user) { UI.showScreen('auth'); return; }
  await ensurePublicRooms();
  UI.showScreen('home');
  UI.setNick(getMyNick());
  UI.setFriendCode(getMyFriendCode());
  _startFriendListeners();
  UI.renderPublicRooms(PUBLIC_ROOMS, (code) => UI.emit('joinPublic', { room: code }));
});

// ── Auth ──────────────────────────────────────────────────────────────────
UI.on('login', async ({ email, password }) => {
  try { UI.setAuthLoading(true, 'login'); await login(email, password); }
  catch (e) { UI.showAuthError(e.message, 'login'); UI.setAuthLoading(false, 'login'); }
});
UI.on('register', async ({ email, password, nick }) => {
  try { UI.setAuthLoading(true, 'reg'); await register(email, password, nick); }
  catch (e) { UI.showAuthError(e.message, 'reg'); UI.setAuthLoading(false, 'reg'); }
});
UI.on('logout', async () => {
  await _leaveCurrentRoom(); _stopFriendListeners(); await logout();
});
UI.on('resetPassword', async ({ email }) => {
  try { await resetPassword(email); UI.toast('Reset email sent!'); }
  catch (e) { UI.toast(e.message, 'e'); }
});
UI.on('updateNick', async ({ nick }) => {
  if (!nick.trim()) return;
  await updateNick(nick.trim()); UI.setNick(getMyNick());
});

// ── Rooms ─────────────────────────────────────────────────────────────────
UI.on('startRoom', async () => {
  const code = randomCode();
  try {
    await createRoom(code, getMyNick());
    await _enterRoom(code, getMyNick());
    UI.showRoomCode(code);
  } catch (e) { UI.toast(e.message, 'e'); }
});

UI.on('joinRoom', async ({ code }) => {
  const clean = code.toUpperCase().trim();
  if (!clean) { UI.toast('Enter a room code', 'e'); return; }
  UI.setJoining(true);
  try { await _enterRoom(clean, getMyNick()); }
  catch (e) { UI.toast(e.message, 'e'); UI.setJoining(false); }
});

UI.on('joinPublic', async ({ room }) => {
  UI.setJoining(true);
  try { await _enterRoom(room, getMyNick()); }
  catch (e) { UI.toast(e.message, 'e'); UI.setJoining(false); }
});

UI.on('disc', async () => {
  if (!confirm('Leave room?')) return;
  await _leaveCurrentRoom();
  UI.showScreen('home');
  UI.toast('Left room.');
});

// ── Messages ──────────────────────────────────────────────────────────────
UI.on('send', async ({ text }) => {
  if (!text.trim()) return;
  try {
    if (currentDMUid) await sendDM(currentDMUid, text.trim(), getMyNick());
    else if (currentRoom) await sendMessage(currentRoom.code, text.trim(), getMyNick());
    _clearTyping();
  } catch (e) { UI.toast('Send failed: ' + e.message, 'e'); }
});

UI.on('typing', () => {
  if (!currentRoom) return;
  setTyping(currentRoom.code, getMyNick(), true);
  clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => _clearTyping(), 3000);
});

UI.on('deleteMsg', async ({ msgId }) => {
  if (!currentRoom) return;
  try { await deleteMessage(currentRoom.code, msgId, auth.currentUser.uid); }
  catch (e) { UI.toast(e.message, 'e'); }
});

function _clearTyping() {
  clearTimeout(_typingTimer);
  if (currentRoom) setTyping(currentRoom.code, getMyNick(), false);
}

// ── Friends ───────────────────────────────────────────────────────────────
UI.on('sendFriendRequest',   async ({ code }) => {
  try { await sendFriendRequest(code); UI.toast('Friend request sent!'); }
  catch (e) { UI.toast(e.message, 'e'); }
});
UI.on('acceptFriendRequest', async ({ uid }) => {
  try { await acceptFriendRequest(uid); UI.toast('Friend added!'); }
  catch (e) { UI.toast(e.message, 'e'); }
});
UI.on('declineFriendRequest', async ({ uid }) => { await declineFriendRequest(uid).catch(()=>{}); });
UI.on('removeFriend',         async ({ uid }) => { await removeFriend(uid).catch(()=>{}); UI.toast('Friend removed.'); });

UI.on('connectToFriend', async ({ uid, nick }) => {
  const code = randomCode();
  try {
    await createRoom(code, getMyNick());
    await sendRoomInvite(uid, code);
    await _enterRoom(code, getMyNick());
    UI.showRoomCode(code);
    UI.sys('Invite sent to ' + nick + '! Room: ' + code);
  } catch (e) { UI.toast(e.message, 'e'); }
});

UI.on('openDM', async ({ uid, nick }) => {
  await _leaveCurrentRoom();
  currentDMUid = uid; currentDMNick = nick; currentRoom = null;
  UI.showScreen('chat');
  UI.setChatTitle('DM: ' + nick);
  UI.clearMessages();
  UI.enableInput();
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  unsubMessages = listenDM(uid, msg => UI.addMessage(msg, auth.currentUser.uid));
});

UI.on('acceptInvite', async ({ roomCode }) => {
  UI.setJoining(true);
  try { await _enterRoom(roomCode, getMyNick()); }
  catch (e) { UI.toast(e.message, 'e'); UI.setJoining(false); }
});

// ── Enter room (core) ─────────────────────────────────────────────────────
async function _enterRoom(code, nick) {
  await _leaveCurrentRoom();
  currentDMUid = null;

  const roomData = await joinRoom(code, nick);
  currentRoom = { code: code.toUpperCase(), ...roomData };

  UI.showScreen('chat');
  UI.setChatTitle(currentRoom.isPublic ? '# ' + (currentRoom.name || code) : code);
  UI.clearMessages();
  UI.setJoining(false);
  UI.enableInput();
  UI.showRoomCode(code);

  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  unsubMessages = listenMessages(code, msg => UI.addMessage(msg, auth.currentUser.uid));

  if (unsubMembers) { unsubMembers(); unsubMembers = null; }
  unsubMembers = listenMembers(code, members => {
    UI.updateMemberList(members, auth.currentUser.uid, {
      onDM: (uid, n) => UI.emit('openDM', { uid, nick: n }),
    });
  });

  if (unsubTyping) { unsubTyping(); unsubTyping = null; }
  unsubTyping = listenTyping(code, typers => {
    if (!typers.length) UI.hideTyping();
    else UI.showTyping(typers.length === 1 ? typers[0] : typers.length + ' people');
  });

  _presenceTimer = setInterval(() => updatePresence(code, true), 30000);
  _setupPresenceDisconnect(code, nick);
}

async function _leaveCurrentRoom() {
  if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubMembers)  { unsubMembers();  unsubMembers  = null; }
  if (unsubTyping)   { unsubTyping();   unsubTyping   = null; }
  _clearTyping();
  if (currentRoom) { await leaveRoom(currentRoom.code, getMyNick()); currentRoom = null; }
  currentDMUid = null;
  UI.disableInput();
}

function _setupPresenceDisconnect(code, nick) {
  // Presence cleanup handled by leaveRoom() on beforeunload
  // and by Firestore member doc TTL
}

// ── Friend listeners ──────────────────────────────────────────────────────
function _startFriendListeners() {
  unsubFriends  = listenFriends(friends => UI.updateFriendList(friends, {
    onDM:      (uid, nick) => UI.emit('openDM',          { uid, nick }),
    onConnect: (uid, nick) => UI.emit('connectToFriend', { uid, nick }),
    onRemove:  (uid)       => UI.emit('removeFriend',    { uid }),
  }));
  unsubRequests = listenFriendRequests(reqs => UI.updateFriendRequests(reqs, {
    onAccept:  uid => UI.emit('acceptFriendRequest',  { uid }),
    onDecline: uid => UI.emit('declineFriendRequest', { uid }),
  }));
  unsubInvites  = listenInvites(invite => UI.showFriendInvite(invite,
    () => UI.emit('acceptInvite', { roomCode: invite.roomCode })
  ));
}
function _stopFriendListeners() {
  [unsubFriends, unsubRequests, unsubInvites].forEach(fn => fn?.());
  unsubFriends = unsubRequests = unsubInvites = null;
}

document.addEventListener('visibilitychange', () => {
  if (currentRoom) updatePresence(currentRoom.code, !document.hidden);
});
window.addEventListener('beforeunload', () => {
  _clearTyping();
  if (currentRoom) updatePresence(currentRoom.code, false);
});
