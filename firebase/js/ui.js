// ── ui.js ─────────────────────────────────────────────────────────────────
// All DOM manipulation. app.js calls these; HTML events emit back to app.js.

const _h = {};
export const UI = {
  on(e, fn)   { _h[e] = fn; },
  emit(e, d)  { _h[e]?.(d); },

  // ── Screens ───────────────────────────────────────────────────────────
  showScreen(name) {
    document.querySelectorAll('[data-screen]').forEach(el => {
      el.classList.remove('active');
    });
    const t = document.querySelector(`[data-screen="${name}"]`);
    if (t) t.classList.add('active');
    if (name === 'home')    _scr('s1');
    if (name === 'hosting') _scr('s2');
    window._currentScreen = name;
  },

  // ── Auth ──────────────────────────────────────────────────────────────
  setAuthLoading(on, form) {
    const btn = _q(`#${form}Btn`);
    if (btn) { btn.disabled = on; btn.textContent = on ? 'Please wait…' : (form === 'login' ? 'Sign In' : 'Create Account'); }
  },
  showAuthError(msg, form) {
    const el = _q(`#${form}Error`);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  },
  clearAuthError(form) {
    const el = _q(`#${form}Error`);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  },

  // ── Home ──────────────────────────────────────────────────────────────
  setNick(nick) {
    document.querySelectorAll('[data-my-nick]').forEach(el => el.textContent = nick);
    const inp = _q('#nick'); if (inp && !inp.value) inp.value = nick;
  },
  setFriendCode(code) {
    document.querySelectorAll('[data-friend-code]').forEach(el => el.textContent = code);
  },
  showRoomCode(code) {
    document.querySelectorAll('[data-room-code]').forEach(el => el.textContent = code);
  },
  setJoining(on) {
    const btn = _q('#joinBtn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spin"></span> Joining…' : 'Join Room →';
  },

  // ── Public rooms ──────────────────────────────────────────────────────
  renderPublicRooms(rooms, onJoin) {
    const container = _q('#pubRoomList');
    if (!container) return;
    container.innerHTML = '';
    const icons = {
      house: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 7h2v7h4v-4h2v4h4V7h2z"/></svg>',
      chat:  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v9H9l-3 3v-3H2z"/></svg>',
      dice:  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="5" r="1.2" fill="currentColor"/><circle cx="11" cy="5" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="5" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="11" r="1.2" fill="currentColor"/></svg>',
      code:  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12"/></svg>',
      game:  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6h2v2H4V6zm4-2h2v2H8V4zm0 4h2v2H8V8zM12 6h2v2h-2V6zM2 4h12a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V5a1 1 0 011-1z"/></svg>',
    };
    for (const [code, info] of Object.entries(rooms)) {
      const row = document.createElement('div');
      row.className = 'pub-room';
      row.innerHTML = `
        <div class="pub-icon">${icons[info.icon] || icons.chat}</div>
        <div class="pub-info">
          <div class="pub-name">${_e(info.name)}</div>
          <div class="pub-sub">${_e(info.desc)}</div>
        </div>
        <div class="pub-join">Join →</div>`;
      row.onclick = () => onJoin(code);
      container.appendChild(row);
    }
  },

  // ── Chat ──────────────────────────────────────────────────────────────
  setChatTitle(title) {
    const el = _q('#chatTitle'); if (el) el.textContent = title;
    const el2 = _q('#s-code');  if (el2) el2.textContent = title;
  },
  clearMessages() {
    const msgs = _q('#msgs');
    if (msgs) msgs.innerHTML = '';
  },
  enableInput() {
    const ta  = _q('#msgIn');  if (ta)  { ta.disabled  = false; ta.focus(); }
    const snd = _q('#sndBtn'); if (snd) snd.disabled = false;
    const dsc = _q('#dscBtn'); if (dsc) dsc.disabled = false;
  },
  disableInput() {
    const ta  = _q('#msgIn');  if (ta)  ta.disabled  = true;
    const snd = _q('#sndBtn'); if (snd) snd.disabled = true;
  },

  addMessage(msg, myUid) {
    const msgs = _q('#msgs');
    if (!msgs) return;

    // Avoid duplicate (Firestore can fire twice on cached data)
    if (msg.id && document.getElementById('msg-' + msg.id)) {
      // Update if modified
      if (msg._modified) {
        const existing = document.getElementById('msg-' + msg.id);
        const body = existing?.querySelector('.mb');
        if (body) body.innerHTML = _md(_e(msg.text));
        if (msg.deleted) existing?.classList.add('deleted');
      }
      return;
    }

    if (msg.type === 'system') {
      const d = document.createElement('div');
      d.className = 'sys';
      if (msg.id) d.id = 'msg-' + msg.id;
      d.textContent = msg.text;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
      return;
    }

    const isMe   = msg.uid === myUid;
    const tsText = msg.ts?.toDate ? _time(msg.ts.toDate()) : '';
    const d      = document.createElement('div');
    d.className  = 'msg ' + (isMe ? 'me' : 'them') + (msg.deleted ? ' deleted' : '');
    if (msg.id)  d.id = 'msg-' + msg.id;

    d.innerHTML = `
      <div class="mw" style="color:${isMe ? 'var(--g)' : _nickColor(msg.nick)}">
        ${_e(msg.nick)} <span class="msg-ts">${tsText}</span>
      </div>
      <div class="mb">${_md(_e(msg.text))}</div>
      ${isMe && !msg.deleted ? `<div class="msg-actions"><button class="msg-del-btn" data-id="${msg.id}" title="Delete">×</button></div>` : ''}`;

    // Delete button
    d.querySelector('.msg-del-btn')?.addEventListener('click', e => {
      UI.emit('deleteMsg', { msgId: e.target.dataset.id });
    });

    msgs.appendChild(d);
    // Auto-scroll if near bottom
    if (msgs.scrollHeight - msgs.scrollTop < msgs.clientHeight + 80) {
      msgs.scrollTop = msgs.scrollHeight;
    }
  },

  sys(txt) {
    const msgs = _q('#msgs');
    if (!msgs) return;
    const d = document.createElement('div');
    d.className = 'sys'; d.textContent = txt;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  },

  showTyping(who) {
    const el = _q('#typi'); const nm = _q('#typiName');
    if (el) el.classList.add('on');
    if (nm) nm.textContent = who;
  },
  hideTyping() { _q('#typi')?.classList.remove('on'); },

  toast(msg, type = '') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'e' ? ' e' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  },

  // ── Member list ───────────────────────────────────────────────────────
  updateMemberList(members, myUid, callbacks) {
    const list = _q('#memberList');
    if (!list) return;
    list.innerHTML = '';
    const online  = members.filter(m => m.online !== false);
    const offline = members.filter(m => m.online === false);
    const render  = (m) => {
      const row = document.createElement('div');
      row.className = 'member-row' + (m.uid === myUid ? ' me' : '');
      row.innerHTML = `
        <div class="member-dot ${m.online !== false ? 'online' : ''}"></div>
        <span class="member-nick">${_e(m.nick)}${m.uid === myUid ? ' (you)' : ''}</span>
        ${m.uid !== myUid ? `<button class="member-dm-btn" title="DM ${_e(m.nick)}">✉</button>` : ''}`;
      row.querySelector('.member-dm-btn')?.addEventListener('click', () => {
        callbacks.onDM?.(m.uid, m.nick);
      });
      list.appendChild(row);
    };
    online.forEach(render);
    offline.forEach(render);
    // Update count
    const cnt = _q('#s-peers'); if (cnt) cnt.textContent = online.length;
  },

  // ── Friends ───────────────────────────────────────────────────────────
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
        <div class="fl-friend-avatar">${_ini(f.nick)}</div>
        <div class="fl-friend-info">
          <div class="fl-friend-name">${_e(f.nick)}</div>
          <div class="fl-friend-code">${f.friendCode || f.email || ''}</div>
        </div>
        <div class="fl-friend-actions">
          <button class="fl-btn" data-action="dm"      data-uid="${f.uid}" data-nick="${_e(f.nick)}">DM</button>
          <button class="fl-btn b" data-action="connect" data-uid="${f.uid}" data-nick="${_e(f.nick)}">Connect</button>
          <button class="fl-btn r" data-action="remove"  data-uid="${f.uid}">×</button>
        </div>`;
      row.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => {
          const a = btn.dataset.action, uid = btn.dataset.uid, nick = btn.dataset.nick;
          if (a === 'dm')      callbacks.onDM?.(uid, nick);
          if (a === 'connect') callbacks.onConnect?.(uid, nick);
          if (a === 'remove')  callbacks.onRemove?.(uid);
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
    const hasReqs = reqs.length > 0;
    if (section) section.style.display = hasReqs ? 'block' : 'none';
    if (badge)   badge.textContent = reqs.length;
    if (dot)     { dot.style.display = hasReqs ? 'inline-flex' : 'none'; dot.textContent = reqs.length; }
    list.innerHTML = '';
    reqs.forEach(req => {
      const row = document.createElement('div');
      row.className = 'fl-req-row';
      row.innerHTML = `
        <div class="fl-friend-avatar">${_ini(req.nick)}</div>
        <div style="flex:1;min-width:0">
          <div class="fl-req-name">${_e(req.nick)}</div>
          <div class="fl-req-code">${req.email || ''}</div>
        </div>
        <div class="fl-friend-actions">
          <button class="fl-btn g" data-uid="${req.uid}" data-action="accept">Accept</button>
          <button class="fl-btn r" data-uid="${req.uid}" data-action="decline">×</button>
        </div>`;
      row.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => {
          btn.dataset.action === 'accept'
            ? callbacks.onAccept?.(btn.dataset.uid)
            : callbacks.onDecline?.(btn.dataset.uid);
        };
      });
      list.appendChild(row);
    });
  },

  showFriendInvite(invite, onJoin) {
    const b = document.createElement('div');
    b.className = 'friend-invite-banner';
    b.innerHTML = `<span><b>${_e(invite.fromNick)}</b> invited you → <b>${_e(invite.roomCode)}</b></span>
      <button class="fl-btn g">Join</button><button class="fl-btn" style="margin-left:2px">×</button>`;
    b.querySelectorAll('.fl-btn')[0].onclick = () => { b.remove(); onJoin(); };
    b.querySelectorAll('.fl-btn')[1].onclick = () => b.remove();
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 60000);
    UI.toast(`${invite.fromNick} invited you to a room!`);
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function _q(sel)   { return document.querySelector(sel); }
function _e(s)     { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _ini(n)   { return (n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function _scr(id)  { document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on')); document.getElementById(id)?.classList.add('on'); }

const _nc = ['#60a5fa','#a78bfa','#fb923c','#22d3ee','#f472b6','#34d399'];
const _nm = {};
function _nickColor(nick) {
  if (!_nm[nick]) { _nm[nick] = _nc[Object.keys(_nm).length % _nc.length]; }
  return _nm[nick];
}

function _time(d) {
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function _md(text) {
  return text
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,        '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,    '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,        '<em>$1</em>')
    .replace(/^&gt; (.+)/gm,      '<blockquote>$1</blockquote>')
    .replace(/\n/g,               '<br>');
}
