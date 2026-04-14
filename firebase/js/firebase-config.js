// ── firebase-config.js ────────────────────────────────────────────────────
// Central Firebase initialisation. Import this first in every other module.

import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase }         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getFirestore }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAnalytics }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';

const firebaseConfig = {
  apiKey:            "AIzaSyADwM9RpqVefD3gzu_qCsPXjLDpTuqCdgw",
  authDomain:        "chatp2p-234ce.firebaseapp.com",
  projectId:         "chatp2p-234ce",
  storageBucket:     "chatp2p-234ce.firebasestorage.app",
  messagingSenderId: "337308804349",
  appId:             "1:337308804349:web:329b448757c34f7a918a94",
  measurementId:     "G-73TWQNXFTJ",
  databaseURL:       "https://chatp2p-234ce-default-rtdb.firebaseio.com",
};

export const app       = initializeApp(firebaseConfig);
export const auth      = getAuth(app);
export const db        = getDatabase(app);   // Realtime Database — signaling
export const firestore = getFirestore(app);  // Firestore — users, friends, rooms
export const analytics = getAnalytics(app);
