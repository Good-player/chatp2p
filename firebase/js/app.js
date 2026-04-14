// ── app.js ────────────────────────────────────────────────────────────────
// Main application controller. Wires auth → signaling → webrtc → ui.
// Import order matters: firebase-config first, then each module.

import { auth, db }            from './firebase-config.js';
import { onAuthReady, currentUser, getMyNick, getMyFriendCode, login, register, logout, updateNick, resetPassword } from './auth.js';
import {
  sigHostOpen, sigListenOffers, sigSendAnswer, sigSendOffer,
  sigWaitAnswer, sigStopWaitingAnswer, sigStopHost, sigCloseRoom,
  sigJoinPresence, sigListenPresence, sigRelayTo, sigListenRelay,
  PUBLIC_ROOMS, randomRoomCode, isPublicRoom,
} from './signaling.js';
import {
  ICE, peers, makePeerConnection, setupDC, setLocalAndGather,
  stripSDP, wireOne, broadcast, W, removePeer, detectRelay, setOpusBitrate,
} from './webrtc.js';
import {
  sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  removeFriend, listenFriends, listenFriendRequests, listenInvites,
  sendRoomInvite,
} from './friends.js';
import { UI } from './ui.js';

// ── App state ─────────────────────────────────────────────────────────────
let myNick    = '';
let myCode    = '';
let isHost    = false;
let connAt    = null;
let upTmr     = null;
let relayUnsubscribe = null;
let presenceUnsubscribe = null;
let unsubFriends = null;
let unsubRequests = null;
let unsubInvites = null;

// ── Voice call state ──────────────────────────────────────────────────────
let localStream  = null;
let isMuted      = false;
let callStartedAt = null;
let callTimerTmr  = null;
let pendingCallFrom = null;
let pendingCallSDP  = null;
const callPeers = new Map(); // peerId → { apc, audioEl, volume, senders }
const speakingAnalysers = new Map();

// ── Camera / screen share ─────────────────────────────────────────────────
let cameraStream     = null;
let cameraActive     = false;
let screenStream     = null;
let screenSharingActive = false;
const camPCs   = new Map();
const camRxPCs = new Map();
const screenPCs   = new Map();
const screenRxPCs = new Map();

// ── Keep-alive (prevent timer throttle) ──────────────────────────────────
let _keepAliveCtx = null;
function startKeepAlive() {
  if (_keepAliveCtx) return;
  try {
    _keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = _keepAliveCtx.createOscillator();
    const gain = _keepAliveCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain); gain.connect(_keepAliveCtx.destination);
    osc.start();
  } catch (_) {}
}
function stopKeepAlive() {
  if (!_keepAliveCtx) return;
  try { _keepAliveCtx.close(); } catch (_) {}
  _keepAliveCtx = null;
}

// ── Auth gate ─────────────────────────────────────────────────────────────
onAuthReady(async (user, profile) => {
  if (!user) {
    UI.showScreen('auth');
    return;
  }
  myNick = getMyNick();
  UI.showScreen('home');
  UI.setNick(myNick);
  UI.setFriendCode(getMyFriendCode());
  _startFriendListeners();
});

// ── Auth forms ────────────────────────────────────────────────────────────
UI.on('login', async ({ email, password }) => {
  try {
    UI.setAuthLoading(true);
    await login(email, password);
  } catch (e) {
    UI.showAuthError(e.message);
    UI.setAuthLoading(false);
  }
});

UI.on('register', async ({ email, password, nick }) => {
  try {
    UI.setAuthLoading(true);
    await register(email, password, nick);
  } catch (e) {
    UI.showAuthError(e.message);
    UI.setAuthLoading(false);
  }
});

UI.on('logout', async () => {
  fullReset();
  _stopFriendListeners();
  await logout();
});

UI.on('updateNick', async ({ nick }) => {
  await updateNick(nick);
  myNick = nick;
  UI.setNick(nick);
});

// ── Room start ────────────────────────────────────────────────────────────
UI.on('startRoom', async () => {
  myNick = getMyNick();
  myCode = randomRoomCode();
  isHost = true;
  UI.showRoomCode(myCode);
  UI.showScreen('hosting');
  await sigHostOpen(myCode, myNick);
  sigListenOffers(myCode, handleNewPeer);
  startKeepAlive();
});

// ── Join room ─────────────────────────────────────────────────────────────
UI.on('joinRoom', async ({ code }) => {
  const roomCode = code.toUpperCase().trim();
  if (!roomCode) { UI.toast('Enter a room code', 'e'); return; }
  myNick  = getMyNick();
  myCode  = roomCode;
  isHost  = false;
  UI.setJoining(true);

  const peerId = Math.random().toString(36).slice(2, 10);
  const pc     = makePeerConnection(peerId, _peerHandlers);
  const dc     = pc.createDataChannel('chat');
  setupDC(peerId, dc, _dcHandlers);

  try {
    await setLocalAndGather(pc, await pc.createOffer());
    await sigSendOffer(myCode, peerId, stripSDP(pc.localDescription), myNick);
  } catch (e) {
    UI.toast('Could not reach room: ' + e.message, 'e');
    UI.setJoining(false); removePeer(peerId); return;
  }

  // Listen for host answer via Firebase push (instant, no polling)
  sigWaitAnswer(myCode, peerId, async (data) => {
    try {
      await pc.setRemoteDescription(data.sdp);
      // UI transition to chat happens in onConnected handler
    } catch (e) {
      UI.toast('Connection failed: ' + e.message, 'e');
      UI.setJoining(false); removePeer(peerId);
    }
  });

  // Timeout after 20s
  setTimeout(() => {
    if (!connAt && peers.has(peerId)) {
      sigStopWaitingAnswer();
      UI.toast('Room not found or timed out', 'e');
      UI.setJoining(false); removePeer(peerId);
    }
  }, 20000);
});

// ── Join public room ──────────────────────────────────────────────────────
UI.on('joinPublic', async ({ room }) => {
  UI.emit('joinRoom', { code: room });
});

// ── Disconnect ────────────────────────────────────────────────────────────
UI.on('disc', async () => {
  if (!confirm('Leave room?')) return;
  if (callPeers.size > 0) endCall();
  broadcast({ t: 'pres', s: 'offline' });
  await new Promise(r => setTimeout(r, 200));
  fullReset();
  UI.showScreen('home');
  UI.toast('Left room.');
});

// ── Friend actions ────────────────────────────────────────────────────────
UI.on('sendFriendRequest', async ({ code }) => {
  try {
    await sendFriendRequest(code);
    UI.toast('Friend request sent!');
  } catch (e) { UI.toast(e.message, 'e'); }
});

UI.on('acceptFriendRequest', async ({ uid }) => {
  try {
    await acceptFriendRequest(uid);
    UI.toast('Friend added!');
  } catch (e) { UI.toast(e.message, 'e'); }
});

UI.on('declineFriendRequest', async ({ uid }) => {
  await declineFriendRequest(uid).catch(() => {});
});

UI.on('removeFriend', async ({ uid }) => {
  await removeFriend(uid).catch(() => {});
  UI.toast('Friend removed.');
});

UI.on('connectToFriend', async ({ uid, nick, friendCode }) => {
  // Start a room and invite
  const roomCode = randomRoomCode();
  myCode  = roomCode;
  myNick  = getMyNick();
  isHost  = true;
  UI.showRoomCode(roomCode);
  UI.showScreen('chat');
  await sigHostOpen(roomCode, myNick);
  sigListenOffers(roomCode, handleNewPeer);
  startKeepAlive();
  // Send invite via Firestore
  try {
    await sendRoomInvite(uid, roomCode);
    UI.sys(`Invite sent to ${nick}! Room code: ${roomCode}`);
  } catch (_) {
    UI.sys(`Room open! Share code ${roomCode} with ${nick}`);
  }
});

UI.on('acceptInvite', ({ roomCode }) => {
  UI.emit('joinRoom', { code: roomCode });
});

// ── Handle new peer joining (host side) ───────────────────────────────────
async function handleNewPeer(msg) {
  const { peerId, sdp, nick } = msg;
  if (peers.has(peerId)) return;

  const pc = makePeerConnection(peerId, _peerHandlers);
  peers.get(peerId).nick = nick || '?';

  try {
    await pc.setRemoteDescription(sdp);
    await setLocalAndGather(pc, await pc.createAnswer());
    await sigSendAnswer(myCode, peerId, stripSDP(pc.localDescription), myNick);
  } catch (e) {
    removePeer(peerId);
  }
}

// ── Peer event handlers ───────────────────────────────────────────────────
const _peerHandlers = {
  onConnected(peerId) {
    if (!connAt) {
      connAt = Date.now();
      UI.showScreen('chat');
      UI.enableInput();
      upTmr = setInterval(() => {
        UI.updateUptime(Math.floor((Date.now() - connAt) / 1000));
        UI.updatePeerCount(peers.size);
      }, 5000);
    }
    UI.updatePeerList(peers, callPeers, isMuted, {
      onCall: startCall, onHangup: endCallWith
    });
    if (isHost && !connAt) sigListenOffers(myCode, handleNewPeer);
  },
  onOffline(peerId) {
    const p = peers.get(peerId);
    if (p) { p.online = false; }
    UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
  },
  onPeerBack(peerId) {
    UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
  },
  onDisconnected(peerId, reason) {
    const peer = peers.get(peerId);
    if (peer?.nick) UI.sys(`${peer.nick} left`);
    if (callPeers.has(peerId)) { removePeerFromCall(peerId); if (!callPeers.size) _cleanupCall(); }
    removePeer(peerId);
    UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
    if (!peers.size && !isHost) { UI.setStatus('offline', false); UI.disableInput(); }
  },
  onIceState(peerId, state) {},
};

const _dcHandlers = {
  onDCOpen(peerId) {},
  async onMessage(peerId, d) {
    await handleMessage(peerId, d);
  },
};

// ── Message handler ───────────────────────────────────────────────────────
async function handleMessage(fromId, d) {
  const peer = peers.get(fromId);
  if (d.t === 'hi') {
    if (peer) peer.nick = d.nick;
    wireOne(fromId, { t: 'hi', nick: myNick });
    UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
    UI.sys(`${d.nick} joined!`);
  } else if (d.t === 'msg') {
    UI.addMessage(d.v, d.nick, d.id, false);
    wireOne(fromId, { t: 'ack', id: d.id });
    if (isHost) broadcast({ t: 'relay-msg', v: d.v, nick: d.nick, id: d.id }, fromId);
  } else if (d.t === 'relay-msg') {
    UI.addMessage(d.v, d.nick, d.id, false);
  } else if (d.t === 'ack') {
    UI.markRead(d.id);
  } else if (d.t === 'typ') {
    UI.showTyping(peer?.nick || 'Someone');
  } else if (d.t === 'styp') {
    UI.hideTyping();
  } else if (d.t === 'pres') {
    if (peer) peer.online = d.s !== 'offline';
    UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
  } else if (d.t === 'ping') {
    wireOne(fromId, { t: 'pong', id: d.id });
  } else if (d.t === 'pong') {
    UI.updatePing(d.id);
  } else if (d.t === 'call-req') {
    pendingCallFrom = fromId; pendingCallSDP = d.sdp;
    UI.showIncomingCall(d.nick || peer?.nick, () => answerCall(), () => declineCall());
  } else if (d.t === 'call-ans') {
    const entry = callPeers.get(fromId);
    if (entry?.apc && d.sdp) {
      try { await entry.apc.setRemoteDescription(d.sdp); onCallConnected(fromId); }
      catch (_) { removePeerFromCall(fromId); if (!callPeers.size) _cleanupCall(); }
    }
  } else if (d.t === 'call-dec') {
    removePeerFromCall(fromId); if (!callPeers.size) _cleanupCall();
    UI.toast('Call declined');
  } else if (d.t === 'call-end') {
    removePeerFromCall(fromId); if (!callPeers.size) { _cleanupCall(); }
  } else if (d.t === 'screen-offer') {
    await handleScreenOffer(fromId, d.sdp, d.nick || peer?.nick);
  } else if (d.t === 'screen-ans') {
    const spc = screenPCs.get(fromId);
    if (spc) spc.setRemoteDescription(d.sdp).catch(() => {});
  } else if (d.t === 'screen-end') {
    handleScreenEnd(fromId);
  } else if (d.t === 'cam-offer') {
    await handleCamOffer(fromId, d.sdp, d.nick || peer?.nick);
  } else if (d.t === 'cam-ans') {
    const cpc = camPCs.get(fromId);
    if (cpc) cpc.setRemoteDescription(d.sdp).catch(() => {});
  } else if (d.t === 'cam-end') {
    handleCamEnd(fromId);
  }
}

// ── Send message ──────────────────────────────────────────────────────────
// ── Additional action listeners from HTML/UI ─────────────────────────────
UI.on('toggleMute',        ()  => toggleMute());
UI.on('toggleCamera',      ()  => toggleCamera());
UI.on('toggleScreenShare', ()  => toggleScreenShare());
UI.on('stopScreenShare',   ()  => stopScreenShare());
UI.on('endCall',           ()  => endCall());
UI.on('typing',            ()  => { broadcast({ t: 'typ' }); });
UI.on('stopTyping',        ()  => { broadcast({ t: 'styp' }); });
UI.on('resetPassword', async ({ email }) => {
  try { await resetPassword(email); UI.toast('Password reset email sent!'); }
  catch (e) { UI.toast(e.message, 'e'); }
});
// Aliases used by the HTML title-bar onclick handlers
UI.on('_toggleMute',        ()  => toggleMute());
UI.on('_toggleCamera',      ()  => toggleCamera());
UI.on('_toggleScreenShare', ()  => toggleScreenShare());
UI.on('_stopScreenShare',   ()  => stopScreenShare());
UI.on('_endCall',           ()  => endCall());

UI.on('send', ({ text, id }) => {
  broadcast({ t: 'msg', v: text, nick: myNick, id });
  UI.addMessage(text, myNick, id, true);
});

// ── Voice call ────────────────────────────────────────────────────────────
function makeAudioPC(peerId) {
  const existing = callPeers.get(peerId);
  if (existing) { try { existing.apc.close(); } catch (_) {} existing.audioEl?.remove(); callPeers.delete(peerId); }

  const apc = new RTCPeerConnection({ iceServers: ICE });
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true; audioEl.setAttribute('playsinline', '');
  audioEl.volume = 1.0; audioEl.style.display = 'none';
  document.body.appendChild(audioEl);

  apc.onconnectionstatechange = () => {
    if (apc.connectionState === 'failed' || apc.connectionState === 'closed') {
      UI.sys(`Call lost with ${peers.get(peerId)?.nick || 'peer'}`);
      removePeerFromCall(peerId); if (!callPeers.size) _cleanupCall();
    }
  };
  apc.ontrack = e => {
    if (e.track.kind === 'audio') {
      const stream = e.streams[0] || new MediaStream([e.track]);
      const entry = callPeers.get(peerId);
      if (entry) {
        entry.audioEl.srcObject = stream;
        entry.audioEl.play().catch(() => {
          const resume = () => { entry.audioEl.play().catch(() => {}); document.removeEventListener('click', resume); };
          document.addEventListener('click', resume, { once: true });
        });
        startSpeakingDetection(peerId, stream);
      }
    }
  };

  callPeers.set(peerId, { apc, audioEl, volume: 1.0, senders: [] });
  return apc;
}

async function startCall(peerId) {
  if (!peers.size) { UI.toast('No peers connected'); return; }
  if (callPeers.has(peerId)) { UI.toast('Already in call'); return; }
  if (!localStream) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { UI.toast('Mic denied: ' + e.message, 'e'); return; }
  }
  startKeepAlive();
  const apc = makeAudioPC(peerId);
  const entry = callPeers.get(peerId);
  localStream.getAudioTracks().forEach(track => {
    const sender = apc.addTrack(track, localStream);
    entry.senders.push(sender);
    setTimeout(() => setOpusBitrate(sender, 128000), 1500);
  });
  try {
    await setLocalAndGather(apc, await apc.createOffer());
    wireOne(peerId, { t: 'call-req', nick: myNick, sdp: apc.localDescription });
    if (!callStartedAt) startCallTimer();
    UI.updateCallBar(callPeers, peers, isMuted, {
      onMute: toggleMute, onEnd: endCall, onShare: toggleScreenShare,
      onCamera: toggleCamera, onVolume: setPeerVolume,
    });
    UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
  } catch (e) {
    UI.toast('Call failed: ' + e.message, 'e');
    removePeerFromCall(peerId);
  }
}

async function answerCall() {
  if (!pendingCallFrom) return;
  const peerId = pendingCallFrom; const sdp = pendingCallSDP;
  pendingCallFrom = null; pendingCallSDP = null;
  UI.hideIncomingCall();
  if (!localStream) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { UI.toast('Mic denied: ' + e.message, 'e'); return; }
  }
  startKeepAlive();
  const apc = makeAudioPC(peerId);
  const entry = callPeers.get(peerId);
  localStream.getAudioTracks().forEach(track => {
    const sender = apc.addTrack(track, localStream);
    entry.senders.push(sender);
    setTimeout(() => setOpusBitrate(sender, 128000), 1500);
  });
  try {
    await apc.setRemoteDescription(sdp);
    await setLocalAndGather(apc, await apc.createAnswer());
    wireOne(peerId, { t: 'call-ans', nick: myNick, sdp: apc.localDescription });
    onCallConnected(peerId);
  } catch (e) { UI.toast('Call error: ' + e.message, 'e'); removePeerFromCall(peerId); }
}

function declineCall() {
  if (!pendingCallFrom) return;
  wireOne(pendingCallFrom, { t: 'call-dec' });
  pendingCallFrom = null; pendingCallSDP = null;
  UI.hideIncomingCall();
}

function onCallConnected(peerId) {
  if (!callStartedAt) startCallTimer();
  UI.updateCallBar(callPeers, peers, isMuted, {
    onMute: toggleMute, onEnd: endCall, onShare: toggleScreenShare,
    onCamera: toggleCamera, onVolume: setPeerVolume,
  });
  UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
  UI.sys(`Call connected with ${peers.get(peerId)?.nick || 'peer'}`);
}

function startCallTimer() {
  callStartedAt = Date.now();
  callTimerTmr = setInterval(() => {
    const s = Math.floor((Date.now() - callStartedAt) / 1000);
    UI.updateCallTimer(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
  }, 1000);
}

function endCallWith(peerId) {
  wireOne(peerId, { t: 'call-end' });
  removePeerFromCall(peerId);
  if (!callPeers.size) _cleanupCall();
}

function endCall() {
  callPeers.forEach((_, peerId) => wireOne(peerId, { t: 'call-end' }));
  _cleanupCall();
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  UI.updateCallBar(callPeers, peers, isMuted, {
    onMute: toggleMute, onEnd: endCall, onShare: toggleScreenShare,
    onCamera: toggleCamera, onVolume: setPeerVolume,
  });
}

function setPeerVolume(peerId, vol) {
  const entry = callPeers.get(peerId);
  if (!entry) return;
  entry.volume = vol;
  entry.audioEl.volume = Math.min(1.0, vol);
}

function removePeerFromCall(peerId) {
  stopSpeakingDetection(peerId);
  const entry = callPeers.get(peerId);
  if (!entry) return;
  try { entry.apc.close(); } catch (_) {}
  entry.audioEl.pause(); entry.audioEl.srcObject = null;
  try { entry.audioEl.remove(); } catch (_) {}
  callPeers.delete(peerId);
  UI.updateCallBar(callPeers, peers, isMuted, {
    onMute: toggleMute, onEnd: endCall, onShare: toggleScreenShare,
    onCamera: toggleCamera, onVolume: setPeerVolume,
  });
  UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
}

function _cleanupCall() {
  clearInterval(callTimerTmr); callTimerTmr = null;
  speakingAnalysers.forEach((_, id) => stopSpeakingDetection(id));
  callPeers.forEach(entry => {
    try { entry.apc.close(); } catch (_) {}
    entry.audioEl.pause(); entry.audioEl.srcObject = null;
    try { entry.audioEl.remove(); } catch (_) {}
  });
  callPeers.clear();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  _cleanupCamera();
  stopScreenShare();
  stopKeepAlive();
  callStartedAt = null; isMuted = false;
  UI.hideCallBar();
  UI.updatePeerList(peers, callPeers, isMuted, { onCall: startCall, onHangup: endCallWith });
}

function startSpeakingDetection(peerId, stream) {
  stopSpeakingDetection(peerId);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      UI.setTileSpeaking(peerId, rms > 0.02);
    };
    raf = requestAnimationFrame(tick);
    speakingAnalysers.set(peerId, { ctx, raf });
  } catch (_) {}
}

function stopSpeakingDetection(peerId) {
  const s = speakingAnalysers.get(peerId);
  if (!s) return;
  cancelAnimationFrame(s.raf);
  try { s.ctx.close(); } catch (_) {}
  speakingAnalysers.delete(peerId);
}

// ── Screen share ──────────────────────────────────────────────────────────
async function toggleScreenShare() {
  if (screenSharingActive) { stopScreenShare(); return; }
  if (!callPeers.size) { UI.toast('Start a call first'); return; }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  } catch (e) { if (e.name !== 'NotAllowedError') UI.toast('Screen share failed', 'e'); return; }
  screenSharingActive = true;
  UI.setShareActive(true);
  screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
  for (const [peerId] of callPeers) {
    const peer = peers.get(peerId);
    if (!peer?.dc || peer.dc.readyState !== 'open') continue;
    const spc = new RTCPeerConnection({ iceServers: ICE });
    screenPCs.set(peerId, spc);
    screenStream.getVideoTracks().forEach(t => spc.addTrack(t, screenStream));
    try {
      await setLocalAndGather(spc, await spc.createOffer());
      wireOne(peerId, { t: 'screen-offer', nick: myNick, sdp: spc.localDescription });
    } catch (_) {}
  }
}

function stopScreenShare() {
  if (!screenSharingActive) return;
  screenSharingActive = false;
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  screenPCs.forEach((spc, peerId) => { wireOne(peerId, { t: 'screen-end' }); try { spc.close(); } catch (_) {} });
  screenPCs.clear();
  UI.setShareActive(false);
}

async function handleScreenOffer(fromId, sdp, nick) {
  const existing = screenRxPCs.get(fromId);
  if (existing) { try { existing.close(); } catch (_) {} }
  const rpc = new RTCPeerConnection({ iceServers: ICE });
  screenRxPCs.set(fromId, rpc);
  rpc.ontrack = e => {
    if (e.track.kind === 'video') {
      UI.showScreenShare(e.streams[0] || new MediaStream([e.track]), nick);
    }
  };
  rpc.onconnectionstatechange = () => {
    if (rpc.connectionState === 'failed' || rpc.connectionState === 'closed') {
      UI.hideScreenShare(); screenRxPCs.delete(fromId);
    }
  };
  try {
    await rpc.setRemoteDescription(sdp);
    await setLocalAndGather(rpc, await rpc.createAnswer());
    wireOne(fromId, { t: 'screen-ans', sdp: rpc.localDescription });
  } catch (_) { screenRxPCs.delete(fromId); }
}

function handleScreenEnd(fromId) {
  const rpc = screenRxPCs.get(fromId);
  if (rpc) { try { rpc.close(); } catch (_) {} screenRxPCs.delete(fromId); }
  UI.hideScreenShare();
  UI.sys((peers.get(fromId)?.nick || 'Peer') + ' stopped sharing');
}

// ── Camera ────────────────────────────────────────────────────────────────
async function toggleCamera() {
  if (cameraActive) { _cleanupCamera(); return; }
  if (!callPeers.size) { UI.toast('Start a call first'); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) { UI.toast('Camera denied: ' + e.message, 'e'); return; }
  cameraActive = true;
  UI.setCameraActive(true, cameraStream);
  for (const [peerId] of callPeers) {
    const peer = peers.get(peerId);
    if (!peer?.dc || peer.dc.readyState !== 'open') continue;
    const cpc = new RTCPeerConnection({ iceServers: ICE });
    camPCs.set(peerId, cpc);
    cameraStream.getVideoTracks().forEach(t => cpc.addTrack(t, cameraStream));
    try {
      await setLocalAndGather(cpc, await cpc.createOffer());
      wireOne(peerId, { t: 'cam-offer', nick: myNick, sdp: cpc.localDescription });
    } catch (_) {}
  }
}

async function handleCamOffer(fromId, sdp, nick) {
  const rpc = new RTCPeerConnection({ iceServers: ICE });
  camRxPCs.set(fromId, rpc);
  rpc.ontrack = e => {
    if (e.track.kind === 'video') {
      UI.addRemoteVideo(fromId, nick, e.streams[0] || new MediaStream([e.track]));
    }
  };
  try {
    await rpc.setRemoteDescription(sdp);
    await setLocalAndGather(rpc, await rpc.createAnswer());
    wireOne(fromId, { t: 'cam-ans', sdp: rpc.localDescription });
    UI.showVideoGrid(true);
  } catch (_) { camRxPCs.delete(fromId); }
}

function handleCamEnd(fromId) {
  const rpc = camRxPCs.get(fromId);
  if (rpc) { try { rpc.close(); } catch (_) {} camRxPCs.delete(fromId); }
  UI.removeRemoteVideo(fromId);
}

function _cleanupCamera() {
  cameraActive = false;
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  camPCs.forEach((cpc, peerId) => { wireOne(peerId, { t: 'cam-end' }); try { cpc.close(); } catch (_) {} });
  camPCs.clear();
  camRxPCs.forEach(rpc => { try { rpc.close(); } catch (_) {} });
  camRxPCs.clear();
  UI.setCameraActive(false, null);
}

// ── Full reset ────────────────────────────────────────────────────────────
function fullReset() {
  clearInterval(upTmr); upTmr = null;
  if (relayUnsubscribe) { relayUnsubscribe(); relayUnsubscribe = null; }
  if (presenceUnsubscribe) { presenceUnsubscribe(); presenceUnsubscribe = null; }
  if (isHost) sigCloseRoom(myCode);
  else sigStopWaitingAnswer();
  _cleanupCall();
  stopScreenShare();
  _cleanupCamera();
  stopKeepAlive();
  peers.forEach((_, id) => removePeer(id));
  connAt = null; myCode = ''; isHost = false;
  UI.resetChat();
}

// ── Friend listeners ──────────────────────────────────────────────────────
function _startFriendListeners() {
  unsubFriends   = listenFriends(friends  => UI.updateFriendList(friends, { onConnect: (uid, nick, fc) => UI.emit('connectToFriend', { uid, nick, friendCode: fc }), onRemove: uid => UI.emit('removeFriend', { uid }) }));
  unsubRequests  = listenFriendRequests(reqs => UI.updateFriendRequests(reqs, { onAccept: uid => UI.emit('acceptFriendRequest', { uid }), onDecline: uid => UI.emit('declineFriendRequest', { uid }) }));
  unsubInvites   = listenInvites(invite  => UI.showFriendInvite(invite, () => UI.emit('acceptInvite', { roomCode: invite.roomCode })));
}

function _stopFriendListeners() {
  [unsubFriends, unsubRequests, unsubInvites].forEach(fn => fn?.());
  unsubFriends = unsubRequests = unsubInvites = null;
}

// ── Tab visibility ────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!peers.size) return;
  broadcast({ t: 'pres', s: document.hidden ? 'away' : 'online' });
  if (!document.hidden) {
    speakingAnalysers.forEach(s => { try { if (s.ctx?.state === 'suspended') s.ctx.resume(); } catch (_) {} });
  }
});

window.addEventListener('beforeunload', () => {
  if (callPeers.size) endCall();
  broadcast({ t: 'pres', s: 'offline' });
});
