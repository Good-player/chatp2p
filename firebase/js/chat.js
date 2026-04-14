// ── chat.js ───────────────────────────────────────────────────────────────
// All messaging via Firestore. No WebRTC. No signaling. No P2P.
//
// Firestore structure:
//   rooms/{roomCode}/
//     { name, isPublic, createdAt, createdBy, memberCount }
//     messages/{msgId}/
//       { uid, nick, text, type, ts, edited, deleted }
//     members/{uid}/
//       { nick, joinedAt, lastSeen }
//
// Direct messages (friend DMs):
//   dms/{dmId}/           dmId = sorted uid pair: uid1_uid2
//     { members: [uid1,uid2], createdAt }
//     messages/{msgId}/
//       { uid, nick, text, ts }

import { auth, firestore } from './firebase-config.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, limit, where,
  serverTimestamp, deleteDoc, updateDoc,
  runTransaction, increment, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Room codes ────────────────────────────────────────────────────────────
export const WORDS = [
  'APPLE','BRICK','CLOUD','DELTA','EAGLE','FLAME','GHOST','HONEY','IVORY',
  'JOKER','LEMON','MANGO','NOBLE','OCEAN','PIANO','QUEEN','RIVER','STORM',
  'TIGER','ULTRA','VITAL','WHALE','AMBER','BLAZE','CHESS','DRIFT','EMBER',
  'FROST','GROVE','KARMA','LUNAR','MAPLE','ORBIT','PEACH','QUEST','RADAR',
  'SCOUT','TORCH','VAPOR','WALTZ','ARROW','CRANE','FLUTE','GRANT','LANCE',
  'MERIT','NORTH','OLIVE','PLUMB','RAVEN','SOUTH','TRAIL','VAULT','AGENT',
  'CABLE','FOCUS','SPARK','PRISM','NEXUS','ATLAS','BLOOM',
];

export function randomCode() {
  return WORDS[Math.random() * WORDS.length | 0];
}

// ── Public test server rooms ───────────────────────────────────────────────
export const PUBLIC_ROOMS = {
  LOBBY:   { name: 'Lobby',   desc: 'General hangout',  icon: 'house' },
  GENERAL: { name: 'General', desc: 'Open discussion',  icon: 'chat'  },
  RANDOM:  { name: 'Random',  desc: 'Meet strangers',   icon: 'dice'  },
  DEV:     { name: 'Dev',     desc: 'Programming talk', icon: 'code'  },
  GAME:    { name: 'Game',    desc: 'Gaming chat',       icon: 'game'  },
};

// Ensure public rooms exist in Firestore (idempotent)
export async function ensurePublicRooms() {
  for (const [code, info] of Object.entries(PUBLIC_ROOMS)) {
    const ref = doc(firestore, 'rooms', code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        name: info.name, desc: info.desc,
        isPublic: true, createdAt: serverTimestamp(),
        createdBy: 'system', memberCount: 0,
      });
    }
  }
}

// ── Create a private room ─────────────────────────────────────────────────
export async function createRoom(code, nick) {
  const uid  = auth.currentUser.uid;
  const ref  = doc(firestore, 'rooms', code.toUpperCase());
  const snap = await getDoc(ref);
  if (snap.exists()) throw new Error('Room code taken — try another');

  await setDoc(ref, {
    name: code.toUpperCase(), isPublic: false,
    createdAt: serverTimestamp(), createdBy: uid, memberCount: 0,
  });
  return code.toUpperCase();
}

// ── Join / leave room ─────────────────────────────────────────────────────
export async function joinRoom(code, nick) {
  const uid   = auth.currentUser.uid;
  const rCode = code.toUpperCase();
  const rRef  = doc(firestore, 'rooms', rCode);
  const snap  = await getDoc(rRef);
  if (!snap.exists()) throw new Error('Room not found');

  // Write member presence
  await setDoc(doc(firestore, 'rooms', rCode, 'members', uid), {
    nick, joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), online: true,
  });

  // Increment member count
  await updateDoc(rRef, { memberCount: increment(1) });

  // Post join system message
  await postSystemMessage(rCode, `${nick} joined`);
  return snap.data();
}

export async function leaveRoom(code, nick) {
  const uid   = auth.currentUser?.uid;
  if (!uid) return;
  const rCode = code.toUpperCase();

  await deleteDoc(doc(firestore, 'rooms', rCode, 'members', uid));
  await updateDoc(doc(firestore, 'rooms', rCode), { memberCount: increment(-1) }).catch(() => {});
  await postSystemMessage(rCode, `${nick} left`);
}

// ── Send message ──────────────────────────────────────────────────────────
export async function sendMessage(roomCode, text, nick) {
  const uid = auth.currentUser.uid;
  return addDoc(
    collection(firestore, 'rooms', roomCode.toUpperCase(), 'messages'),
    { uid, nick, text, type: 'text', ts: serverTimestamp(), deleted: false }
  );
}

export async function postSystemMessage(roomCode, text) {
  return addDoc(
    collection(firestore, 'rooms', roomCode.toUpperCase(), 'messages'),
    { uid: 'system', nick: 'system', text, type: 'system', ts: serverTimestamp() }
  );
}

export async function deleteMessage(roomCode, msgId, uid) {
  const ref = doc(firestore, 'rooms', roomCode.toUpperCase(), 'messages', msgId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  // Only author can delete
  if (snap.data().uid !== uid) throw new Error('Not your message');
  await updateDoc(ref, { deleted: true, text: 'This message was deleted.' });
}

// ── Listen to messages (real-time) ────────────────────────────────────────
export function listenMessages(roomCode, onMessage, msgLimit = 100) {
  const q = query(
    collection(firestore, 'rooms', roomCode.toUpperCase(), 'messages'),
    orderBy('ts', 'asc'),
    limit(msgLimit)
  );
  return onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        onMessage({ id: change.doc.id, ...change.doc.data() });
      }
      if (change.type === 'modified') {
        onMessage({ id: change.doc.id, ...change.doc.data(), _modified: true });
      }
    });
  });
}

// ── Listen to members (online presence) ──────────────────────────────────
export function listenMembers(roomCode, onChange) {
  const q = collection(firestore, 'rooms', roomCode.toUpperCase(), 'members');
  return onSnapshot(q, snap => {
    const members = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    onChange(members);
  });
}

// Update lastSeen / online status
export async function updatePresence(roomCode, online = true) {
  const uid = auth.currentUser?.uid;
  if (!uid || !roomCode) return;
  await updateDoc(
    doc(firestore, 'rooms', roomCode.toUpperCase(), 'members', uid),
    { lastSeen: serverTimestamp(), online }
  ).catch(() => {});
}

// ── Get room info ─────────────────────────────────────────────────────────
export async function getRoom(code) {
  const snap = await getDoc(doc(firestore, 'rooms', code.toUpperCase()));
  if (!snap.exists()) return null;
  return { code: snap.id, ...snap.data() };
}

// ── Typing indicator via Realtime DB (lightweight) ────────────────────────
import { db } from './firebase-config.js';
import {
  ref, set, remove, onValue, serverTimestamp as rtServerTs,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

export function setTyping(roomCode, nick, isTyping) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const r = ref(db, `typing/${roomCode.toUpperCase()}/${uid}`);
  if (isTyping) {
    set(r, { nick, ts: Date.now() });
  } else {
    remove(r);
  }
}

export function listenTyping(roomCode, onChange) {
  const r = ref(db, `typing/${roomCode.toUpperCase()}`);
  return onValue(r, snap => {
    const data = snap.val() || {};
    const myUid = auth.currentUser?.uid;
    // Filter out self and stale entries (>5s)
    const now = Date.now();
    const typers = Object.entries(data)
      .filter(([uid, v]) => uid !== myUid && (now - v.ts) < 5000)
      .map(([, v]) => v.nick);
    onChange(typers);
  });
}

// ── Direct messages ───────────────────────────────────────────────────────
function dmId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

export async function sendDM(toUid, text, nick) {
  const myUid = auth.currentUser.uid;
  const id    = dmId(myUid, toUid);
  const ref   = doc(firestore, 'dms', id);

  // Create DM thread if needed
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { members: [myUid, toUid], createdAt: serverTimestamp() });
  }

  return addDoc(collection(firestore, 'dms', id, 'messages'), {
    uid: myUid, nick, text, ts: serverTimestamp(),
  });
}

export function listenDM(toUid, onMessage) {
  const myUid = auth.currentUser.uid;
  const id    = dmId(myUid, toUid);
  const q     = query(
    collection(firestore, 'dms', id, 'messages'),
    orderBy('ts', 'asc'), limit(100)
  );
  return onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        onMessage({ id: change.doc.id, ...change.doc.data() });
      }
    });
  });
}

// ── Room list (browseable public rooms) ───────────────────────────────────
export function listenPublicRooms(onChange) {
  const q = query(
    collection(firestore, 'rooms'),
    where('isPublic', '==', true)
  );
  return onSnapshot(q, snap => {
    onChange(snap.docs.map(d => ({ code: d.id, ...d.data() })));
  });
}
