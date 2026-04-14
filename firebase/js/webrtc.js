// ── webrtc.js ─────────────────────────────────────────────────────────────
// Pure WebRTC peer connection management.
// Signaling is injected from the outside (signaling.js callbacks).
// This module owns: ICE, data channels, SDP, wire protocol, media.

// ── ICE Servers ───────────────────────────────────────────────────────────
export const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:3478' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:3478' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'turn:free.expressturn.com:3478',         username: '000000002089490852', credential: '47MfC+l9nOTiijmLTIGyZ32gXqQ=' },
  { urls: 'turn:eu.relay.metered.ca:80',            username: '2cf116991a6a04cbee8fcd9a', credential: '/NmwpIw3nexKDXIi' },
  { urls: 'turn:eu.relay.metered.ca:80?transport=tcp', username: '2cf116991a6a04cbee8fcd9a', credential: '/NmwpIw3nexKDXIi' },
  { urls: 'turn:eu.relay.metered.ca:443',           username: '2cf116991a6a04cbee8fcd9a', credential: '/NmwpIw3nexKDXIi' },
  { urls: 'turns:eu.relay.metered.ca:443?transport=tcp', username: '2cf116991a6a04cbee8fcd9a', credential: '/NmwpIw3nexKDXIi' },
];

// ── Peer state ────────────────────────────────────────────────────────────
export const peers = new Map(); // peerId → { pc, dc, nick, online }

// ── Make peer connection ──────────────────────────────────────────────────
export function makePeerConnection(peerId, handlers = {}) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  peers.set(peerId, { pc, dc: null, nick: '?', online: true });

  let _disconnectTimer = null;

  pc.oniceconnectionstatechange = () => {
    handlers.onIceState?.(peerId, pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') {
      if (_disconnectTimer) { clearTimeout(_disconnectTimer); _disconnectTimer = null; }
      const p = peers.get(peerId);
      if (p && p.online === false) { p.online = true; handlers.onPeerBack?.(peerId); }
      handlers.onConnected?.(peerId);
    }
    if (s === 'failed' || s === 'closed') {
      if (_disconnectTimer) { clearTimeout(_disconnectTimer); _disconnectTimer = null; }
      handlers.onDisconnected?.(peerId, 'Connection failed');
    }
    if (s === 'disconnected') {
      const p = peers.get(peerId);
      if (p) { p.online = false; handlers.onOffline?.(peerId); }
      _disconnectTimer = setTimeout(() => {
        _disconnectTimer = null;
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          handlers.onDisconnected?.(peerId, 'Connection lost');
        }
      }, 8000);
    }
  };

  pc.ondatachannel = e => setupDC(peerId, e.channel, handlers);
  return pc;
}

// ── Setup data channel ─────────────────────────────────────────────────────
export function setupDC(peerId, ch, handlers = {}) {
  const peer = peers.get(peerId);
  if (peer) peer.dc = ch;

  ch.onopen  = () => handlers.onDCOpen?.(peerId, ch);
  ch.onclose = () => {};
  ch.onerror = () => {};
  ch.onmessage = e => {
    try {
      const decoded = W.dec(e.data);
      handlers.onMessage?.(peerId, decoded).catch?.(() => {});
    } catch (_) {}
  };
}

// ── ICE gathering ──────────────────────────────────────────────────────────
export function setLocalAndGather(pc, desc, maxMs = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(pc.localDescription); } };
    const hasSrflx = () => (pc.localDescription?.sdp || '').includes('typ srflx');

    pc.addEventListener('icecandidate', e => {
      if (!e.candidate) { finish(); return; }
      if (hasSrflx()) setTimeout(finish, 2000);
    });

    pc.setLocalDescription(desc).then(() => {
      if (pc.iceGatheringState === 'complete') { finish(); return; }
      setTimeout(finish, maxMs);
    }).catch(reject);
  });
}

// ── Strip unnecessary SDP ─────────────────────────────────────────────────
export function stripSDP(sdp) {
  if (!sdp?.sdp) return sdp;
  const keep = sdp.sdp.split('\r\n').filter(l =>
    !l.startsWith('a=extmap') &&
    !l.startsWith('a=msid') &&
    !l.startsWith('a=ssrc') &&
    !l.startsWith('b=')
  ).join('\r\n');
  return { type: sdp.type, sdp: keep };
}

// ── Send / broadcast ──────────────────────────────────────────────────────
export function wireOne(peerId, obj) {
  const peer = peers.get(peerId);
  if (!peer?.dc || peer.dc.readyState !== 'open') return;
  try {
    const s = W.enc(obj);
    peer.dc.send(s);
  } catch (_) {}
}

export function broadcast(obj, exceptId = null) {
  peers.forEach((_, id) => { if (id !== exceptId) wireOne(id, obj); });
}

// ── Compact wire protocol ─────────────────────────────────────────────────
export const W = {
  enc(obj) {
    switch (obj.t) {
      case 'hi':           return JSON.stringify([0, obj.nick]);
      case 'msg':          return JSON.stringify([1, obj.v, obj.nick, obj.id]);
      case 'ack':          return JSON.stringify([2, obj.id]);
      case 'typ':          return '[3]';
      case 'styp':         return '[4]';
      case 'pres':         return JSON.stringify([5, obj.s === 'online' ? 1 : obj.s === 'away' ? 2 : 0]);
      case 'ping':         return JSON.stringify([6, obj.id]);
      case 'pong':         return JSON.stringify([7, obj.id]);
      case 'relay-msg':    return JSON.stringify([8, obj.v, obj.nick, obj.id]);
      case 'call-req':     return JSON.stringify({ t: 'call-req', nick: obj.nick, sdp: obj.sdp });
      case 'call-ans':     return JSON.stringify({ t: 'call-ans', nick: obj.nick, sdp: obj.sdp });
      case 'call-dec':     return '[11]';
      case 'call-end':     return '[12]';
      case 'screen-offer': return JSON.stringify({ t: 'screen-offer', nick: obj.nick, sdp: obj.sdp });
      case 'screen-ans':   return JSON.stringify({ t: 'screen-ans', sdp: obj.sdp });
      case 'screen-end':   return '[13]';
      case 'cam-offer':    return JSON.stringify({ t: 'cam-offer', nick: obj.nick, sdp: obj.sdp });
      case 'cam-ans':      return JSON.stringify({ t: 'cam-ans', sdp: obj.sdp });
      case 'cam-end':      return '[14]';
      default:             return JSON.stringify(obj);
    }
  },
  dec(raw) {
    const a = JSON.parse(raw);
    if (Array.isArray(a)) {
      switch (a[0]) {
        case 0:  return { t: 'hi', nick: a[1] };
        case 1:  return { t: 'msg', v: a[1], nick: a[2], id: a[3] };
        case 2:  return { t: 'ack', id: a[1] };
        case 3:  return { t: 'typ' };
        case 4:  return { t: 'styp' };
        case 5:  return { t: 'pres', s: a[1] === 1 ? 'online' : a[1] === 2 ? 'away' : 'offline' };
        case 6:  return { t: 'ping', id: a[1] };
        case 7:  return { t: 'pong', id: a[1] };
        case 8:  return { t: 'relay-msg', v: a[1], nick: a[2], id: a[3] };
        case 11: return { t: 'call-dec' };
        case 12: return { t: 'call-end' };
        case 13: return { t: 'screen-end' };
        case 14: return { t: 'cam-end' };
        default: return { t: 'unknown' };
      }
    }
    return a; // already an object (call/screen/cam sdp messages)
  },
};

// ── Remove peer ────────────────────────────────────────────────────────────
export function removePeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  try { peer.dc?.close(); } catch (_) {}
  try { peer.pc?.close(); } catch (_) {}
  peers.delete(peerId);
}

// ── Detect relay type ──────────────────────────────────────────────────────
export async function detectRelay(pc) {
  if (!pc) return '?';
  try {
    const stats = await pc.getStats();
    let type = 'Direct';
    stats.forEach(r => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded') {
        stats.forEach(c => {
          if (c.id === r.localCandidateId) {
            type = c.candidateType === 'relay' ? 'TURN' : c.candidateType === 'srflx' ? 'STUN' : 'Direct';
          }
        });
      }
    });
    return type;
  } catch (_) { return '?'; }
}

// ── Opus bitrate helper ────────────────────────────────────────────────────
export function setOpusBitrate(sender, bitrate) {
  const params = sender.getParameters();
  if (!params.encodings) return;
  params.encodings[0].maxBitrate = bitrate;
  sender.setParameters(params).catch(() => {});
}
