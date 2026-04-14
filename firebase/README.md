# DIRECT — Firebase Edition

P2P chat with Firebase backend. No rate limits, no CORS, real-time push.

## Architecture

```
index.html          — App shell (auth + UI)
css/app.css         — All styles (Win95 + Modern themes)
js/
  firebase-config.js — Firebase init (edit YOUR config here)
  auth.js            — Email/password login, user profiles
  signaling.js       — WebRTC signaling via Realtime Database
  friends.js         — Friends system via Firestore
  webrtc.js          — WebRTC peer connections (pure, no backend)
  ui.js              — DOM layer, event bus
  app.js             — Main controller
firebase.json       — Hosting + database config
database.rules.json — Realtime Database security rules
firestore.rules     — Firestore security rules
```

## vs ntfy.sh version

| Feature | ntfy.sh | Firebase |
|---|---|---|
| Rate limit | 60 req/min | Unlimited (Spark: 50K writes/day) |
| CORS | ❌ Needs text/plain hack | ✅ No CORS ever |
| Friends | localStorage only | ✅ Firestore, cross-device |
| Auth | None | ✅ Email/password |
| Signaling | Polling every 4s | ✅ Push (instant) |
| Offline | No | ✅ onDisconnect cleanup |

## Setup

### 1. Firebase Console

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password
3. Enable **Realtime Database** → Start in test mode, then deploy rules
4. Enable **Firestore** → Start in test mode, then deploy rules
5. Enable **Hosting**

### 2. Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 3. Deploy rules

```bash
cd direct-firebase
firebase use chatp2p-234ce
firebase deploy --only database,firestore:rules
```

### 4. Deploy to hosting

```bash
firebase deploy --only hosting
```

Your app will be live at `https://chatp2p-234ce.web.app`

## Realtime Database structure

```
rooms/
  {ROOMCODE}/
    host: { uid, nick, active, ts }
    offers/
      {peerId}: { sdp, nick, uid, ts }
    answers/
      {peerId}: { sdp, nick, ts }
    presence/
      {peerId}: { nick, online, ts }
relay/
  {ROOMCODE}/
    to/
      {peerId}/
        msgs/: [...messages]
```

## Firestore structure

```
users/
  {uid}/
    { uid, nick, email, friendCode, createdAt }
    friends/
      {friendUid}: { nick, email, friendCode, addedAt }
    friendRequests/
      {fromUid}: { fromUid, nick, email, friendCode, sentAt }
    invites/
      {inviteId}: { fromUid, fromNick, roomCode, sentAt }
```

## Notes

- The old `p2p-chat.html` (ntfy.sh version) is unchanged and still works
- This is a separate app targeting the same Firebase project
- WebRTC P2P connections are still direct — Firebase only handles signaling
- Room codes are random words (STORM, EAGLE, etc) — no account needed to join
  but you need to be logged in to create/join rooms
