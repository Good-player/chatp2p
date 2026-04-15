// server.js — minimal Express server for Firebase App Hosting
// App Hosting runs this on Cloud Run. It just serves the static files.

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

// Serve all static files from the project root
app.use(express.static(path.join(__dirname), {
  // Don't serve node_modules or config files
  index: 'index.html',
}));

// Block sensitive files
app.get('/firebase.json',          (_, res) => res.status(403).end());
app.get('/database.rules.json',    (_, res) => res.status(403).end());
app.get('/firestore.rules',        (_, res) => res.status(403).end());
app.get('/firestore.indexes.json', (_, res) => res.status(403).end());
app.get('/apphosting.yaml',        (_, res) => res.status(403).end());
app.get('/package.json',           (_, res) => res.status(403).end());
app.get('/package-lock.json',      (_, res) => res.status(403).end());

// SPA fallback — all unmatched routes serve index.html
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DIRECT chat server running on port ${PORT}`);
});
