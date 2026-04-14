// ── friends.js ────────────────────────────────────────────────────────────
// Friends system backed by Firestore.
// Collections:
//   users/{uid}/friends/{friendUid}: { nick, email, friendCode, addedAt }
//   users/{uid}/friendRequests/{fromUid}: { nick, email, friendCode, sentAt }
//   users/{uid}/invites/{inviteId}: { fromNick, roomCode, fromUid, sentAt }

import { auth, firestore } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp, orderBy, limit,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getMyFriendCode, getMyNick, currentUser, userProfile } from './auth.js';

// ── Lookup user by friend code ────────────────────────────────────────────
export async function findUserByFriendCode(code) {
  const q = query(
    collection(firestore, 'users'),
    where('friendCode', '==', code.toUpperCase()),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { uid: snap.docs[0].id, ...snap.docs[0].data() };
}

// ── Send friend request ───────────────────────────────────────────────────
export async function sendFriendRequest(targetFriendCode) {
  const me = auth.currentUser;
  if (!me) throw new Error('Not logged in');

  const target = await findUserByFriendCode(targetFriendCode);
  if (!target) throw new Error('User not found');
  if (target.uid === me.uid) throw new Error("That's your own code!");

  // Check already friends
  const existing = await getDoc(doc(firestore, 'users', me.uid, 'friends', target.uid));
  if (existing.exists()) throw new Error('Already friends!');

  // Send request to their subcollection
  await setDoc(
    doc(firestore, 'users', target.uid, 'friendRequests', me.uid),
    {
      fromUid:    me.uid,
      nick:       getMyNick(),
      email:      me.email,
      friendCode: getMyFriendCode(),
      sentAt:     serverTimestamp(),
    }
  );
}

// ── Accept friend request ─────────────────────────────────────────────────
export async function acceptFriendRequest(fromUid) {
  const me = auth.currentUser;
  if (!me) return;

  const reqRef  = doc(firestore, 'users', me.uid, 'friendRequests', fromUid);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('Request not found');
  const reqData = reqSnap.data();

  const myData = { nick: getMyNick(), email: me.email, friendCode: getMyFriendCode() };

  // Write both sides atomically
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'users', me.uid,      'friends', fromUid),       { ...reqData,  addedAt: serverTimestamp() });
  batch.set(doc(firestore, 'users', fromUid,     'friends', me.uid),        { ...myData,   fromUid: me.uid, addedAt: serverTimestamp() });
  batch.delete(reqRef);
  await batch.commit();
}

// ── Decline / cancel request ──────────────────────────────────────────────
export async function declineFriendRequest(fromUid) {
  const me = auth.currentUser;
  if (!me) return;
  await deleteDoc(doc(firestore, 'users', me.uid, 'friendRequests', fromUid));
}

export async function removeFriend(friendUid) {
  const me = auth.currentUser;
  if (!me) return;
  const batch = writeBatch(firestore);
  batch.delete(doc(firestore, 'users', me.uid,      'friends', friendUid));
  batch.delete(doc(firestore, 'users', friendUid,   'friends', me.uid));
  await batch.commit();
}

// ── Real-time listeners ───────────────────────────────────────────────────
export function listenFriends(onChange) {
  const me = auth.currentUser;
  if (!me) return () => {};
  const q = query(collection(firestore, 'users', me.uid, 'friends'), orderBy('addedAt', 'desc'));
  return onSnapshot(q, snap => {
    const friends = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    onChange(friends);
  });
}

export function listenFriendRequests(onChange) {
  const me = auth.currentUser;
  if (!me) return () => {};
  const q = collection(firestore, 'users', me.uid, 'friendRequests');
  return onSnapshot(q, snap => {
    const reqs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    onChange(reqs);
  });
}

// ── Room invites ──────────────────────────────────────────────────────────
export async function sendRoomInvite(friendUid, roomCode) {
  const me = auth.currentUser;
  if (!me) return;
  await setDoc(
    doc(collection(firestore, 'users', friendUid, 'invites')),
    {
      fromUid:  me.uid,
      fromNick: getMyNick(),
      roomCode: roomCode.toUpperCase(),
      sentAt:   serverTimestamp(),
    }
  );
}

export function listenInvites(onInvite) {
  const me = auth.currentUser;
  if (!me) return () => {};
  const q = collection(firestore, 'users', me.uid, 'invites');
  return onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const data = { id: change.doc.id, ...change.doc.data() };
        onInvite(data);
        // Auto-delete after shown
        setTimeout(() => deleteDoc(change.doc.ref), 500);
      }
    });
  });
}

// ── Load friends list once ────────────────────────────────────────────────
export async function getFriends() {
  const me = auth.currentUser;
  if (!me) return [];
  const snap = await getDocs(collection(firestore, 'users', me.uid, 'friends'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}
