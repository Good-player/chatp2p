// ── signaling.js ──────────────────────────────────────────────────────────
// WebRTC signaling via Firebase Realtime Database.
// Replaces ntfy.sh — no rate limits, instant delivery via push (onValue).
//
// DB structure:
//   rooms/{roomCode}/
//     host: { uid, nick, active: true, ts }
//     offers/{peerId}: { sdp, nick, uid, ts }
//     answers/{peerId}: { sdp, nick, ts }
//
// Messages are deleted after 60s via a Cloud Function (or client cleanup).

import { db, auth } from './firebase-config.js';
import {
  ref, set, get, push, remove, onChildAdded,
  onValue, off, serverTimestamp, onDisconnect,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

let _hostRef     = null;
let _offersRef   = null;
let _answerRef   = null;
let _offerListener  = null;
let _answerListener = null;

// ── Post beacon — host advertises presence ────────────────────────────────
export async function sigHostOpen(roomCode, nick) {
  const uid = auth.currentUser?.uid || 'anon';
  _hostRef = ref(db, `rooms/${roomCode.toUpperCase()}/host`);
  await set(_hostRef, { uid, nick, active: true, ts: serverTimestamp() });
  // Remove on disconnect so joiners know host is gone
  onDisconnect(_hostRef).remove();
}

// ── Check if a host exists for a room ─────────────────────────────────────
export async function sigCheckHost(roomCode) {
  const snap = await get(ref(db, `rooms/${roomCode.toUpperCase()}/host`));
  return snap.exists() && snap.val()?.active === true;
}

// ── Host: listen for join offers ──────────────────────────────────────────
export function sigListenOffers(roomCode, onOffer) {
  _offersRef = ref(db, `rooms/${roomCode.toUpperCase()}/offers`);
  _offerListener = onChildAdded(_offersRef, (snap) => {
    const data = snap.val();
    if (!data) return;
    onOffer({ peerId: snap.key, ...data });
    // Clean up offer after processing (after 100ms grace)
    setTimeout(() => remove(snap.ref), 100);
  });
}

// ── Host: send answer back to specific peer ───────────────────────────────
export async function sigSendAnswer(roomCode, peerId, sdp, nick) {
  await set(
    ref(db, `rooms/${roomCode.toUpperCase()}/answers/${peerId}`),
    { sdp, nick, ts: serverTimestamp() }
  );
}

// ── Joiner: push offer to room ────────────────────────────────────────────
export async function sigSendOffer(roomCode, peerId, sdp, nick) {
  await set(
    ref(db, `rooms/${roomCode.toUpperCase()}/offers/${peerId}`),
    { sdp, nick, uid: auth.currentUser?.uid || 'anon', ts: serverTimestamp() }
  );
}

// ── Joiner: wait for host answer ──────────────────────────────────────────
export function sigWaitAnswer(roomCode, peerId, onAnswer) {
  const ansRef = ref(db, `rooms/${roomCode.toUpperCase()}/answers/${peerId}`);
  _answerRef = ansRef;
  _answerListener = onValue(ansRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.val();
    onAnswer(data);
    // Clean up
    remove(ansRef);
    sigStopWaitingAnswer();
  });
}

export function sigStopWaitingAnswer() {
  if (_answerRef && _answerListener) {
    off(_answerRef, 'value', _answerListener);
    _answerRef = null; _answerListener = null;
  }
}

// ── Stop all host listeners ────────────────────────────────────────────────
export function sigStopHost(roomCode) {
  if (_offersRef && _offerListener) {
    off(_offersRef, 'child_added', _offerListener);
    _offersRef = null; _offerListener = null;
  }
  if (_hostRef) {
    remove(_hostRef).catch(() => {});
    _hostRef = null;
  }
}

// ── Relay message (host → all peers via DB) ───────────────────────────────
// For group rooms: host writes to relay/{roomCode}/to/{peerId}/msgs
export async function sigRelayTo(roomCode, peerId, msg) {
  const r = ref(db, `relay/${roomCode.toUpperCase()}/to/${peerId}/msgs`);
  await push(r, { ...msg, ts: serverTimestamp() });
}

export function sigListenRelay(roomCode, myPeerId, onMsg) {
  const r = ref(db, `relay/${roomCode.toUpperCase()}/to/${myPeerId}/msgs`);
  return onChildAdded(r, (snap) => {
    const data = snap.val();
    if (data) { onMsg(data); remove(snap.ref); }
  });
}

// ── Room presence: list online peers ──────────────────────────────────────
export async function sigJoinPresence(roomCode, peerId, nick) {
  const presRef = ref(db, `rooms/${roomCode.toUpperCase()}/presence/${peerId}`);
  await set(presRef, { nick, online: true, ts: serverTimestamp() });
  onDisconnect(presRef).remove();
  return presRef;
}

export function sigListenPresence(roomCode, onChange) {
  const presRef = ref(db, `rooms/${roomCode.toUpperCase()}/presence`);
  return onValue(presRef, (snap) => {
    const data = snap.val() || {};
    onChange(data);
  });
}

// ── Clean up entire room (host leaves) ───────────────────────────────────
export async function sigCloseRoom(roomCode) {
  sigStopHost(roomCode);
  // Don't delete offers/answers immediately — let peers finish handshake
  setTimeout(() => {
    remove(ref(db, `rooms/${roomCode.toUpperCase()}`)).catch(() => {});
  }, 5000);
}

// ── Public rooms ──────────────────────────────────────────────────────────
export const PUBLIC_ROOMS = {
  LOBBY:   { name: 'Lobby',   desc: 'General hangout' },
  GENERAL: { name: 'General', desc: 'Open discussion' },
  RANDOM:  { name: 'Random',  desc: 'Meet strangers'  },
};

export function isPublicRoom(code) {
  return Object.keys(PUBLIC_ROOMS).includes(code.toUpperCase());
}

// ── Word codes for room names ──────────────────────────────────────────────
export const WORDS = [
  'APPLE','BRICK','CLOUD','DELTA','EAGLE','FLAME','GHOST','HONEY','IVORY',
  'JOKER','KITE','LEMON','MANGO','NOBLE','OCEAN','PIANO','QUEEN','RIVER',
  'STORM','TIGER','ULTRA','VITAL','WHALE','AMBER','BLAZE','CHESS','DRIFT',
  'EMBER','FROST','GROVE','HATCH','KARMA','LUNAR','MAPLE','ORBIT','PEACH',
  'QUEST','RADAR','SCOUT','TORCH','VAPOR','WALTZ','ARROW','CRANE','ELBOW',
  'FLUTE','GRANT','INDEX','LANCE','MERIT','NORTH','OLIVE','PLUMB','RAVEN',
  'SOUTH','TRAIL','VAULT','AGENT','CABLE','FOCUS',
];

export function randomRoomCode() {
  return WORDS[Math.random() * WORDS.length | 0];
}
