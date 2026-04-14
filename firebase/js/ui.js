// ── ui.js ─────────────────────────────────────────────────────────────────
// DOM manipulation layer. app.js calls these; DOM events emit back to app.js.
// Keeps all querySelector/innerHTML out of app.js.

const _handlers = {};

export const UI = {
  // ── Event bus ────────────────────────────────────────────────────────────
  on(event, handler) { _handlers[event] = handler; },
  emit(event, data) { _handlers[event]?.(data); },

  // ── Screen management ─────────────────────────────────────────────────────
  showScreen(name) {
    document.querySelectorAll('[data-screen]').forEach(el => {
      el.classList.toggle('active', el.dataset.screen === name);
    });
  },

  // ── Auth UI ───────────────────────────────────────────────────────────────
  setAuthLoading(loading) {
    const btn = _q('#authSubmitBtn');
    if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Please wait…' : btn.dataset.label || 'Continue'; }
  },
  showAuthError(msg) {
    const el = _q('#authError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  },

  // ── Home screen ───────────────────────────────────────────────────────────
  setNick(nick) {
    _qAll('[data-my-nick]').forEach(el => el.textContent = nick);
  },
  setFriendCode(code) {
    _qAll('[data-friend-code]').forEach(el => el.textContent = code);
  },

  // ── Room state ────────────────────────────────────────────────────────────
  showRoomCode(code) {
    const el = _q('[data-room-code]');
    if (el) el.textContent = code;
  },
  setJoining(joining) {
    const btn = _q('#joinBtn');
    if (!btn) return;
    btn.disabled = joining;
    btn.innerHTML = joining ? '<span class="spin"></span> Joining…' : 'Join Room →';
  },
  setStatus(text, on) {
    const pill = _q('#pill');
    const ptxt = _q('#ptxt');
    if (pill) pill.classList.toggle('on', on);
    if (ptxt) ptxt.textContent = text;
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  enableInput() {
    _qAll('[data-chat-input]').forEach(el => { el.disabled = false; });
    const ta = _q('#msgIn'); if (ta) { ta.disabled = false; ta.focus(); }
    const snd = _q('#sndBtn'); if (snd) snd.disabled = false;
    const dsc = _q('#dscBtn'); if (dsc) dsc.disabled = false;
  },
  disableInput() {
    const ta = _q('#msgIn'); if (ta) ta.disabled = true;
    const snd = _q('#sndBtn'); if (snd) snd.disabled = true;
  },
  resetChat() {
    const msgs = _q('#msgs');
    if (msgs) msgs.innerHTML = '<div class="sys">Room is open.</div>';
    UI.disableInput();
    UI.hideCallBar();
  },
  addMessage(text, nick, id, isMe) {
    const msgs = _q('#msgs');
    if (!msgs) return;
    const rendered = _renderMD(_esc(text));
    const col = isMe ? 'var(--g)' : _nickColor(nick);
    const d = document.createElement('div');
    d.className = 'msg ' + (isMe ? 'me' : 'them');
    if (id) d.setAttribute('data-mid', id);
    d.innerHTML = `
      <div class="mw" style="color:${col}">${_esc(nick)}</div>
      <div class="mb">${rendered}</div>
      ${isMe ? `<div class="mr"><span class="ri">+</span> sent</div>` : ''}`;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  },
  markRead(id) {
    const el = document.querySelector(`[data-mid="${id}"] .ri`);
    if (el) { el.textContent = '++'; el.classList.add('read'); }
  },
  sys(txt) {
    const msgs = _q('#msgs');
    if (!msgs) return;
    const d = document.createElement('div');
    d.className = 'sys'; d.textContent = txt;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  },
  showTyping(nick) {
    const el = _q('#typi'); const nm = _q('#typiName');
    if (el) el.classList.add('on');
    if (nm) nm.textContent = nick;
  },
  hideTyping() { _q('#typi')?.classList.remove('on'); },
  updateUptime(s) {
    const el = _q('#s-up');
    if (el) el.textContent = s < 60 ? s + 's' : s < 3600 ? Math.floor(s/60) + 'm' : Math.floor(s/3600) + 'h';
  },
  updatePeerCount(n) { const el = _q('#s-peers'); if (el) el.textContent = n; },
  updatePing(id) { /* implement per-app */ },
  toast(msg, type = '') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'e' ? ' e' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },

  // ── Peer list ─────────────────────────────────────────────────────────────
  updatePeerList(peers, callPeers, isMuted, callbacks) {
    const list = _q('#peerList');
    if (!list) return;
    // Preserve badge
    const badge = _q('#pubBadge');
    list.innerHTML = '';
    if (badge) list.appendChild(badge);

    // Self chip
    const me = document.createElement('div');
    me.className = 'peer-chip on';
    me.textContent = (window._myNick || 'You') + ' (you)';
    list.appendChild(me);

    peers.forEach((peer, id) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap';
      const chip = document.createElement('div');
      chip.className = 'peer-chip ' + (peer.online !== false ? 'on' : '');
      chip.textContent = peer.nick || '?';
      wrap.appendChild(chip);
      if (peer.online !== false) {
        const inCall = callPeers.has(id);
        const cbtn = document.createElement('button');
        cbtn.className = 'peer-call-btn' + (inCall ? ' in-call' : '');
        cbtn.innerHTML = inCall ? _SVG_HANGUP : _SVG_PHONE;
        cbtn.onclick = () => inCall ? callbacks.onHangup?.(id) : callbacks.onCall?.(id);
        wrap.appendChild(cbtn);
      }
      list.appendChild(wrap);
    });
  },

  // ── Call bar ──────────────────────────────────────────────────────────────
  updateCallBar(callPeers, peers, isMuted, callbacks) {
    const bar = _q('#callBar');
    if (!bar) return;
    if (!callPeers.size) { bar.classList.remove('show'); return; }
    bar.classList.add('show');

    const panel = _q('#callParticipants');
    if (!panel) return;
    // In-place update
    const wantedIds = new Set(['ctile-self']);
    callPeers.forEach((_, p) => wantedIds.add('ctile-' + p));
    Array.from(panel.children).forEach(el => { if (!wantedIds.has(el.id)) el.remove(); });

    let selfTile = document.getElementById('ctile-self');
    if (!selfTile) {
      selfTile = document.createElement('div');
      selfTile.id = 'ctile-self';
      selfTile.innerHTML = `<div class="call-tile-avatar">${_initials(window._myNick||'Me')}<span class="mic-icon"></span></div><div class="call-tile-name">${_esc(window._myNick||'Me')} (you)</div>`;
      panel.insertBefore(selfTile, panel.firstChild);
    }
    selfTile.className = 'call-tile' + (isMuted ? ' muted' : '');
    const mic = selfTile.querySelector('.mic-icon');
    if (mic) mic.innerHTML = isMuted ? _SVG_MICOFF : _SVG_MIC;

    callPeers.forEach((entry, peerId) => {
      const nick = peers.get(peerId)?.nick || 'Peer';
      const vol = Math.round(entry.volume * 100);
      let tile = document.getElementById('ctile-' + peerId);
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'call-tile'; tile.id = 'ctile-' + peerId;
        tile.innerHTML = `
          <div class="call-tile-avatar">${_initials(nick)}</div>
          <div class="call-tile-name">${_esc(nick)}</div>
          <div class="call-tile-vol">
            <input type="range" min="0" max="200" step="5" value="${vol}"
              oninput="UI.emit('setVolume',{peerId:'${peerId}',vol:parseInt(this.value)/100})"
              style="flex:1;height:16px;accent-color:var(--g)">
            <span class="call-tile-vol-pct" id="cvol-${peerId}">${vol}%</span>
          </div>`;
        panel.appendChild(tile);
      }
    });
  },
  hideCallBar() { _q('#callBar')?.classList.remove('show'); },
  updateCallTimer(txt) { const el = _q('#callTimer'); if (el) el.textContent = txt; },
  setTileSpeaking(peerId, speaking) {
    const tile = document.getElementById('ctile-' + peerId);
    if (tile) tile.classList.toggle('speaking', speaking);
  },
  showIncomingCall(nick, onAnswer, onDecline) {
    const banner = _q('#callBanner');
    const name = _q('#callCallerName');
    if (name) name.textContent = nick || 'Someone';
    if (banner) banner.classList.add('show');
    window._onAnswer = onAnswer; window._onDecline = onDecline;
  },
  hideIncomingCall() { _q('#callBanner')?.classList.remove('show'); },

  // ── Screen share ──────────────────────────────────────────────────────────
  setShareActive(active) {
    _q('#shareBtn')?.classList.toggle('sharing', active);
    const bar = _q('#screenShareBar');
    if (bar) bar.style.display = active ? 'flex' : 'none';
  },
  showScreenShare(stream, nick) {
    const view = _q('#screenView');
    const vid  = _q('#screenVideo');
    const name = _q('#screenSharerName');
    if (vid) { vid.srcObject = stream; vid.play().catch(() => {}); }
    if (name) name.textContent = nick || 'Someone';
    if (view) view.style.display = 'block';
  },
  hideScreenShare() {
    const view = _q('#screenView');
    const vid  = _q('#screenVideo');
    if (vid) { vid.pause(); vid.srcObject = null; }
    if (view) view.style.display = 'none';
  },

  // ── Camera ────────────────────────────────────────────────────────────────
  setCameraActive(active, stream) {
    const btn  = _q('#camBtn');
    const self = _q('#selfVideo');
    const off  = _q('#selfVideoOff');
    if (btn) btn.classList.toggle('cam-on', active);
    if (self) { self.srcObject = stream || null; if (stream) self.play().catch(() => {}); }
    if (off)  off.style.display = active ? 'none' : 'flex';
    if (active) UI.showVideoGrid(true);
    else UI.updateVideoGridVisibility();
  },
  addRemoteVideo(peerId, nick, stream) {
    const container = _q('#remoteVideos');
    if (!container) return;
    let wrap = document.getElementById('cam-peer-' + peerId);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'video-peer-wrap'; wrap.id = 'cam-peer-' + peerId;
      const vid = document.createElement('video');
      vid.autoplay = true; vid.setAttribute('playsinline', ''); vid.muted = false;
      vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
      vid.srcObject = stream; vid.play().catch(() => {});
      const label = document.createElement('div');
      label.className = 'video-label'; label.textContent = nick || 'Peer';
      wrap.appendChild(vid); wrap.appendChild(label);
      container.appendChild(wrap);
      UI.showVideoGrid(true);
    }
  },
  removeRemoteVideo(peerId) {
    const el = document.getElementById('cam-peer-' + peerId);
    if (el) { el.querySelector('video')?.pause(); el.remove(); }
    UI.updateVideoGridVisibility();
  },
  showVideoGrid(active) {
    const grid = _q('#videoGrid');
    if (grid) { grid.style.display = 'flex'; grid.classList.add('active'); }
  },
  updateVideoGridVisibility() {
    const hasCam = !!_q('#selfVideo')?.srcObject;
    const hasRemote = !!_q('#remoteVideos')?.children.length;
    const grid = _q('#videoGrid');
    if (grid) {
      const show = hasCam || hasRemote;
      grid.style.display = show ? 'flex' : 'none';
      grid.classList.toggle('active', show);
    }
  },

  // ── Friends ───────────────────────────────────────────────────────────────
  updateFriendList(friends, callbacks) {
    const list = _q('#friendList');
    if (!list) return;
    list.innerHTML = '';
    if (!friends.length) {
      list.innerHTML = '<div class="fl-empty">No friends yet.</div>'; return;
    }
    friends.forEach(f => {
      const row = document.createElement('div');
      row.className = 'fl-friend-row';
      row.innerHTML = `
        <div class="fl-friend-avatar">${_initials(f.nick)}</div>
        <div class="fl-friend-info">
          <div class="fl-friend-name">${_esc(f.nick)}</div>
          <div class="fl-friend-code">${f.friendCode || ''}</div>
        </div>
        <div class="fl-friend-actions">
          <button class="fl-btn b" data-uid="${f.uid}" data-nick="${_esc(f.nick)}" data-fc="${f.friendCode||''}" data-action="connect">Connect</button>
          <button class="fl-btn r" data-uid="${f.uid}" data-action="remove">X</button>
        </div>`;
      row.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => {
          if (btn.dataset.action === 'connect') callbacks.onConnect?.(btn.dataset.uid, btn.dataset.nick, btn.dataset.fc);
          if (btn.dataset.action === 'remove') callbacks.onRemove?.(btn.dataset.uid);
        };
      });
      list.appendChild(row);
    });
  },
  updateFriendRequests(reqs, callbacks) {
    const section = _q('#friendReqSection');
    const list    = _q('#friendRequests');
    const badge   = _q('#reqBadge');
    const dot     = _q('#friendNotifDot');
    if (!list) return;
    if (!reqs.length) { if (section) section.style.display = 'none'; if (dot) dot.style.display = 'none'; return; }
    if (section) section.style.display = 'block';
    if (badge)   badge.textContent = reqs.length;
    if (dot)     { dot.style.display = 'inline-flex'; dot.textContent = reqs.length; }
    list.innerHTML = '';
    reqs.forEach(req => {
      const row = document.createElement('div');
      row.className = 'fl-req-row';
      row.innerHTML = `
        <div class="fl-friend-avatar">${_initials(req.nick)}</div>
        <div style="flex:1"><div class="fl-req-name">${_esc(req.nick)}</div><div class="fl-req-code">${req.email || ''}</div></div>
        <div class="fl-friend-actions">
          <button class="fl-btn g" data-uid="${req.uid}" data-action="accept">Accept</button>
          <button class="fl-btn r" data-uid="${req.uid}" data-action="decline">Decline</button>
        </div>`;
      row.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => {
          if (btn.dataset.action === 'accept')  callbacks.onAccept?.(btn.dataset.uid);
          if (btn.dataset.action === 'decline') callbacks.onDecline?.(btn.dataset.uid);
        };
      });
      list.appendChild(row);
    });
  },
  showFriendInvite(invite, onJoin) {
    const banner = document.createElement('div');
    banner.className = 'friend-invite-banner';
    banner.innerHTML = `<span><b>${_esc(invite.fromNick)}</b> invited you to join room <b>${_esc(invite.roomCode)}</b></span>
      <button class="fl-btn g">Join</button><button class="fl-btn" style="margin-left:2px">X</button>`;
    banner.querySelectorAll('.fl-btn')[0].onclick = () => { banner.remove(); onJoin(); };
    banner.querySelectorAll('.fl-btn')[1].onclick = () => banner.remove();
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 60000);
    UI.toast(`${invite.fromNick} invited you to a room!`);
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function _q(sel) { return document.querySelector(sel); }
function _qAll(sel) { return document.querySelectorAll(sel); }
function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

const _nickColors = ['#60a5fa','#a78bfa','#fb923c','#22d3ee','#f472b6','#34d399'];
const _nickColorMap = {};
function _nickColor(nick) {
  if (!_nickColorMap[nick]) { const keys = Object.keys(_nickColorMap); _nickColorMap[nick] = _nickColors[keys.length % _nickColors.length]; }
  return _nickColorMap[nick];
}

function _renderMD(text) {
  return text
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)/gm, '<blockquote>$1</blockquote>')
    .replace(/\n/g, '<br>');
}

const _SVG_PHONE   = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M3.6 1l2.4 3-1.5 1.5c.6 1.4 1.6 2.8 3 4.2 1.4 1.4 2.8 2.4 4.2 3L13.2 11l3 2.4-1.8 1.8C11 14.8 1.2 5 1.8-.4z"/></svg>`;
const _SVG_HANGUP  = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 5.5C5.5 5.5 3.3 6.4 1.6 8L0 6.4C2 4.4 4.9 3 8 3s6 1.4 8 3.4L14.4 8C12.7 6.4 10.5 5.5 8 5.5z" transform="rotate(135,8,8)"/></svg>`;
const _SVG_MIC     = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 16 16"><rect x="5" y="1" width="6" height="8" rx="3" fill="currentColor"/><path d="M3 8a5 5 0 0010 0" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>`;
const _SVG_MICOFF  = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 16 16"><rect x="5" y="1" width="6" height="8" rx="3" fill="currentColor"/><path d="M3 8a5 5 0 0010 0" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="15" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="1" x2="14" y2="15" stroke="currentColor" stroke-width="2"/></svg>`;
