// ── auth.js ───────────────────────────────────────────────────────────────
// Handles email/password auth, user profile in Firestore, and auth state.

import { auth, firestore } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Auth state ────────────────────────────────────────────────────────────
export let currentUser = null;
export let userProfile = null;  // Firestore profile: { nick, friendCode, createdAt }

const _listeners = [];
export function onAuthReady(fn) { _listeners.push(fn); }

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    userProfile = await _loadOrCreateProfile(user);
  } else {
    userProfile = null;
  }
  _listeners.forEach(fn => fn(user, userProfile));
});

// ── Profile ───────────────────────────────────────────────────────────────
async function _loadOrCreateProfile(user) {
  const ref = doc(firestore, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data();
  }
  // New user — create profile with random 8-char friend code
  const friendCode = _genCode();
  const profile = {
    uid:        user.uid,
    nick:       user.displayName || user.email.split('@')[0],
    email:      user.email,
    friendCode,
    createdAt:  serverTimestamp(),
  };
  await setDoc(ref, profile);
  return profile;
}

function _genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.random() * chars.length | 0]).join('');
}

// ── Register ──────────────────────────────────────────────────────────────
export async function register(email, password, nick) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: nick });
  // Profile will be created by onAuthStateChanged above
  return cred.user;
}

// ── Login ─────────────────────────────────────────────────────────────────
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ── Logout ────────────────────────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ── Update nick ───────────────────────────────────────────────────────────
export async function updateNick(nick) {
  if (!currentUser) return;
  await updateProfile(currentUser, { displayName: nick });
  await updateDoc(doc(firestore, 'users', currentUser.uid), { nick });
  if (userProfile) userProfile.nick = nick;
}

// ── Password reset ────────────────────────────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ── Get friend code ───────────────────────────────────────────────────────
export function getMyFriendCode() {
  return userProfile?.friendCode || '--------';
}

// ── Get display nick ──────────────────────────────────────────────────────
export function getMyNick() {
  return userProfile?.nick || currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Me';
}
