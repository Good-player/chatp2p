# DIRECT — Firebase Chat

Pure Firebase chat app. No WebRTC. Messages via Firestore, typing via Realtime Database.

## Files

```
server.js           — Express server (for App Hosting)
package.json        — Node deps
apphosting.yaml     — Firebase App Hosting config
firebase.json       — Database + Firestore rules config
database.rules.json — Realtime Database rules (typing indicators)
firestore.rules     — Firestore security rules
firestore.indexes.json
index.html          — App shell
css/app.css         — Win95 + Modern themes
js/
  firebase-config.js  — Firebase init
  auth.js             — Email/password auth + user profiles
  chat.js             — All Firestore messaging logic
  friends.js          — Friends system
  ui.js               — DOM layer
  app.js              — Main controller
```

## Setup (do this once)

### 1. Firebase Console — chatp2p-234ce

**Authentication**
- Authentication → Sign-in method → Email/Password → Enable

**Firestore**
- Firestore Database → Create database → Start in production mode
- Rules tab → paste contents of `firestore.rules` → Publish

**Realtime Database**
- Realtime Database → Create database → Start in test mode
- Rules tab → paste contents of `database.rules.json` → Publish

### 2. Fix "Insufficient Permissions" for App Hosting

App Hosting creates a service account that needs Firestore access:

1. Go to **console.cloud.google.com/iam-admin/iam**
2. Find the service account: `firebase-app-hosting-compute@chatp2p-234ce.iam.gserviceaccount.com`
3. Click the pencil (edit) icon
4. Add these roles:
   - **Cloud Datastore User**
   - **Firebase Realtime Database Admin**
5. Save

### 3. Deploy with App Hosting

```bash
npm install -g firebase-tools
firebase login
firebase use chatp2p-234ce

# Deploy rules first
firebase deploy --only database,firestore:rules

# Set up App Hosting (one time)
firebase apphosting:backends:create --project chatp2p-234ce

# Deploy the app
firebase deploy --only apphosting
```

Your app will be live at the URL shown after deploy (e.g. `https://direct-xxxxx-chatp2p-234ce.web.app`)

## Firestore Structure

```
rooms/{code}/
  { name, isPublic, createdAt, createdBy, memberCount }
  messages/{id}: { uid, nick, text, type, ts, deleted }
  members/{uid}: { nick, joinedAt, lastSeen, online }

dms/{uid1_uid2}/
  { members: [uid1, uid2], createdAt }
  messages/{id}: { uid, nick, text, ts }

users/{uid}/
  { uid, nick, email, friendCode, createdAt }
  friends/{uid}: { nick, email, friendCode, addedAt }
  friendRequests/{uid}: { fromUid, nick, email, friendCode, sentAt }
  invites/{id}: { fromUid, fromNick, roomCode, sentAt }
```

## Realtime Database Structure

```
typing/{roomCode}/{uid}: { nick, ts }
presence/{roomCode}/{uid}: { nick, online, ts }
```
