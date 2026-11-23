// Follows and direct messages on the public site.
//   - Profiles: follower/following counts and lists, Follow and Message buttons.
//   - Messages: conversations and threads in a panel opened from the account
//     menu or a profile, with an unread badge on the account pill.
// Data comes from the uploads worker (worker/src/social.js), signed in with
// the same session token as comments.

const DM_POLL_THREAD_MS = 10000;
const DM_POLL_UNREAD_MS = 60000;

class Social {
  constructor(library) {
    this.lib = library;
    this.profile = null;   // social info for the profile being shown
    this.peer = null;      // the person whose conversation is open
    this.bindProfile();
    this.bindFollowList();
    this.bindPanel();
    this.wrapAuth();
    this.refreshUnread();
    setInterval(() => { if (!document.hidden) this.refreshUnread(); }, DM_POLL_UNREAD_MS);
  }

  esc(v) { return this.lib.escapeHtml(v == null ? '' : String(v)); }
  signedIn() { return !!this.lib.currentUser; }
  signIn() { document.getElementById('auth-login-btn').click(); }

  async api(path, { method = 'GET', json } = {}) {
    const headers = {};
    const token = this.lib.getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${UPLOADS_API}${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  userPath(id) { return `/api/community/users/${encodeURIComponent(id)}`; }

  avatar(user, cls) {
    return `<img class="${cls}" src="${UPLOADS_API}/api/community/avatars/${encodeURIComponent(user.id)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/pepe-profile.png'">`;
  }

  // ===== Profile =====

  bindProfile() {
    const original = this.lib.showUserProfile.bind(this.lib);
    this.lib.showUserProfile = async (userId, opts) => {
      this.hideProfileControls();
      const out = await original(userId, opts);
      await this.loadProfile();
      return out;
    };
    document.getElementById('user-profile-follow-btn').addEventListener('click', () => this.toggleFollow());
    document.getElementById('user-profile-message-btn').addEventListener('click', () => {
      if (!this.signedIn()) return this.signIn();
      if (this.profile) this.openPanel(this.profile.user);
    });
  }

  hideProfileControls() {
    this.profile = null;
    ['user-profile-follow', 'user-profile-follow-btn', 'user-profile-message-btn']
      .forEach(id => document.getElementById(id).classList.add('hidden'));
  }

  async loadProfile() {
    const account = this.lib.viewedProfile;
    if (!account) return;
    let info;
    try {
      info = await this.api(`${this.userPath(account.id)}/social`);
    } catch (e) {
      return; // social features unavailable; the rest of the profile still works
    }
    if (!this.lib.viewedProfile || this.lib.viewedProfile.id !== account.id) return;
    this.profile = info;
    this.renderProfile();
  }

  renderProfile() {
    const p = this.profile;
    document.getElementById('user-profile-followers').textContent = this.lib.formatCount(p.followers);
    document.getElementById('user-profile-following').textContent = this.lib.formatCount(p.following);
    document.querySelector('[data-follow-list="followers"]').lastChild.textContent = p.followers === 1 ? ' follower' : ' followers';
    document.getElementById('user-profile-follow').classList.remove('hidden');

    const followBtn = document.getElementById('user-profile-follow-btn');
    const msgBtn = document.getElementById('user-profile-message-btn');
    if (p.self) {
      followBtn.classList.add('hidden');
      msgBtn.classList.add('hidden');
      return;
    }
    followBtn.classList.remove('hidden');
    followBtn.classList.toggle('is-following', p.isFollowing);
    followBtn.innerHTML = p.isFollowing
      ? '<i class="fas fa-user-check"></i> Following'
      : `<i class="fas fa-user-plus"></i> ${p.followsYou ? 'Follow back' : 'Follow'}`;
    followBtn.disabled = this.signedIn() && !p.isFollowing && !p.canMessage;
    msgBtn.classList.remove('hidden');
    msgBtn.disabled = this.signedIn() && !p.canMessage && !p.blockedByYou;
  }

  async toggleFollow() {
    if (!this.signedIn()) return this.signIn();
    const p = this.profile;
    if (!p) return;
    const btn = document.getElementById('user-profile-follow-btn');
    btn.disabled = true;
    try {
      const res = await this.api(`${this.userPath(p.user.id)}/follow`, { method: p.isFollowing ? 'DELETE' : 'POST' });
      Object.assign(p, res);
    } catch (e) {
      this.lib.showToast(e.message);
    }
    btn.disabled = false;
    this.renderProfile();
  }

  // ===== Followers / following list =====

  bindFollowList() {
    const overlay = document.getElementById('follow-list-overlay');
    const close = () => overlay.classList.add('hidden');
    document.getElementById('follow-list-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('user-profile-follow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-follow-list]');
      if (btn && this.profile) this.openFollowList(btn.dataset.followList);
    });
    document.getElementById('follow-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-user]');
      if (!row) return;
      close();
      this.lib.showUserProfile(row.dataset.user);
    });
  }

  async openFollowList(which) {
    const name = this.profile.user.name;
    document.getElementById('follow-list-title').textContent = which === 'followers' ? `${name}'s followers` : `${name} follows`;
    const box = document.getElementById('follow-list');
    box.innerHTML = '<p class="follow-list-empty">Loading…</p>';
    document.getElementById('follow-list-overlay').classList.remove('hidden');
    try {
      const { users } = await this.api(`${this.userPath(this.profile.user.id)}/${which}`);
      box.innerHTML = users.length
        ? users.map(u => `
            <button type="button" class="follow-row" data-user="${this.esc(u.username || u.id)}">
              ${this.avatar(u, 'follow-row-avatar')}
              <span class="follow-row-text"><b>${this.esc(u.name)}</b>${u.username ? `<small>@${this.esc(u.username)}</small>` : ''}</span>
            </button>`).join('')
        : `<p class="follow-list-empty">${which === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>`;
    } catch (e) {
      box.innerHTML = `<p class="follow-list-empty">${this.esc(e.message)}</p>`;
    }
  }

  // ===== Messages panel =====

  bindPanel() {
    document.getElementById('auth-messages-btn').addEventListener('click', () => {
      document.getElementById('auth-account-menu').classList.add('hidden');
      this.openPanel();
    });
    const overlay = document.getElementById('dm-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closePanel(); });
    document.getElementById('dm-close').addEventListener('click', () => this.closePanel());
    document.getElementById('dm-close-2').addEventListener('click', () => this.closePanel());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.classList.contains('hidden')) this.closePanel();
    });
    document.getElementById('dm-back').addEventListener('click', () => this.showList());
    document.getElementById('dm-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-user-id]');
      if (row) this.openThread({ id: row.dataset.userId, name: row.dataset.name, username: row.dataset.username });
    });
    document.getElementById('dm-who').addEventListener('click', () => {
      if (!this.peer) return;
      const key = this.peer.username || this.peer.id;
      this.closePanel();
      this.lib.showUserProfile(key);
    });
    document.getElementById('dm-block').addEventListener('click', () => this.toggleBlock());
    const text = document.getElementById('dm-text');
    text.addEventListener('input', () => this.autosize());
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        document.getElementById('dm-compose').requestSubmit();
      }
    });
    document.getElementById('dm-compose').addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
  }

  async openPanel(user) {
    if (!this.signedIn()) return this.signIn();
    document.getElementById('dm-overlay').classList.remove('hidden');
    await this.loadList();
    if (user) this.openThread(user);
    else this.showList();
  }

  closePanel() {
    document.getElementById('dm-overlay').classList.add('hidden');
    clearInterval(this._threadTimer);
    this.peer = null;
  }

  // On narrow screens only one side shows; has-thread switches to the thread.
  showList() {
    clearInterval(this._threadTimer);
    this.peer = null;
    document.querySelector('.dm-panel').classList.remove('has-thread');
    document.getElementById('dm-msgs').innerHTML = '<p class="dm-empty">Pick a conversation, or open someone\'s profile and press Message.</p>';
    document.getElementById('dm-who').textContent = '';
    document.getElementById('dm-block').classList.add('hidden');
    document.getElementById('dm-compose').classList.add('hidden');
    document.getElementById('dm-note').classList.add('hidden');
    this.markActive();
  }

  async loadList() {
    const box = document.getElementById('dm-list');
    try {
      const { conversations, unread } = await this.api('/api/community/messages');
      this.setUnread(unread);
      box.innerHTML = conversations.length
        ? conversations.map(c => `
            <button type="button" class="dm-conv${c.unread ? ' is-unread' : ''}" data-user-id="${this.esc(c.user.id)}" data-name="${this.esc(c.user.name)}" data-username="${this.esc(c.user.username)}">
              ${this.avatar(c.user, 'dm-avatar')}
              <span class="dm-conv-text">
                <span class="dm-conv-top"><b>${this.esc(c.user.name)}</b><small>${this.esc(this.when(c.last.createdAt))}</small></span>
                <span class="dm-conv-last">${c.last.mine ? 'You: ' : ''}${this.esc(c.last.text)}</span>
              </span>
              ${c.unread ? `<span class="dm-badge">${c.unread}</span>` : ''}
            </button>`).join('')
        : '<p class="dm-empty">No messages yet.</p>';
      this.markActive();
    } catch (e) {
      box.innerHTML = `<p class="dm-empty">${this.esc(e.message)}</p>`;
    }
  }

  markActive() {
    document.querySelectorAll('#dm-list .dm-conv').forEach(el => {
      el.classList.toggle('is-active', !!this.peer && el.dataset.userId === String(this.peer.id));
    });
  }

  async openThread(user) {
    this.peer = { id: String(user.id), name: user.name || '', username: user.username || '' };
    document.querySelector('.dm-panel').classList.add('has-thread');
    document.getElementById('dm-who').innerHTML = `${this.avatar(this.peer, 'dm-avatar dm-avatar-sm')}<span>${this.esc(this.peer.name || 'Conversation')}</span>`;
    document.getElementById('dm-msgs').innerHTML = '<p class="dm-empty">Loading…</p>';
    document.getElementById('dm-compose').classList.remove('hidden');
    this.markActive();
    await this.loadThread(true);
    clearInterval(this._threadTimer);
    this._threadTimer = setInterval(() => { if (!document.hidden) this.loadThread(false); }, DM_POLL_THREAD_MS);
    if (window.matchMedia('(min-width: 721px)').matches) document.getElementById('dm-text').focus();
  }

  async loadThread(first) {
    const peer = this.peer;
    if (!peer) return;
    let data;
    try {
      data = await this.api(`/api/community/messages/${encodeURIComponent(peer.id)}`);
    } catch (e) {
      if (first) document.getElementById('dm-msgs').innerHTML = `<p class="dm-empty">${this.esc(e.message)}</p>`;
      return;
    }
    if (this.peer !== peer) return;
    Object.assign(peer, data.user, { canMessage: data.canMessage, blockedByYou: data.blockedByYou });
    document.querySelector('#dm-who span').textContent = peer.name;
    const box = document.getElementById('dm-msgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const lastId = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
    if (first || lastId !== this._lastId) {
      box.innerHTML = data.messages.length
        ? data.messages.map(m => `
            <div class="dm-msg${m.mine ? ' is-mine' : ''}">
              <p>${this.esc(m.text)}</p>
              <time datetime="${this.esc(m.createdAt)}">${this.esc(this.when(m.createdAt))}</time>
            </div>`).join('')
        : `<p class="dm-empty">Say hi to ${this.esc(peer.name)}.</p>`;
      if (first || atBottom) box.scrollTop = box.scrollHeight;
      this._lastId = lastId;
    }
    this.renderThreadState();
    if (first) { this.loadList(); this.refreshUnread(); }
  }

  renderThreadState() {
    const p = this.peer;
    const block = document.getElementById('dm-block');
    block.classList.remove('hidden');
    block.textContent = p.blockedByYou ? 'Unblock' : 'Block';
    const note = document.getElementById('dm-note');
    const compose = document.getElementById('dm-compose');
    if (p.blockedByYou) {
      note.textContent = `You blocked ${p.name}. Unblock to message each other again.`;
    } else if (!p.canMessage) {
      note.textContent = "You can't message this account.";
    }
    note.classList.toggle('hidden', !!p.canMessage);
    compose.classList.toggle('hidden', !p.canMessage);
  }

  async toggleBlock() {
    const p = this.peer;
    if (!p) return;
    if (!p.blockedByYou && !confirm(`Block ${p.name}? You won't be able to message or follow each other until you unblock.`)) return;
    try {
      const res = await this.api(`${this.userPath(p.id)}/block`, { method: p.blockedByYou ? 'DELETE' : 'POST' });
      Object.assign(p, res);
      this.renderThreadState();
      this.lib.showToast(p.blockedByYou ? `${p.name} is blocked.` : `${p.name} is unblocked.`);
      if (this.profile && this.profile.user.id === p.id) this.loadProfile();
    } catch (e) {
      this.lib.showToast(e.message);
    }
  }

  autosize() {
    const t = document.getElementById('dm-text');
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
  }

  async send() {
    const t = document.getElementById('dm-text');
    const text = t.value.trim();
    const peer = this.peer;
    if (!text || !peer) return;
    const btn = document.getElementById('dm-send');
    btn.disabled = true;
    try {
      await this.api(`/api/community/messages/${encodeURIComponent(peer.id)}`, { method: 'POST', json: { text } });
      t.value = '';
      this.autosize();
      await this.loadThread(true);
    } catch (e) {
      this.lib.showToast(e.message);
    } finally {
      btn.disabled = false;
      t.focus();
    }
  }

  // ===== Unread badge =====

  wrapAuth() {
    const renderAuthUI = this.lib.renderAuthUI.bind(this.lib);
    this.lib.renderAuthUI = (...args) => {
      const out = renderAuthUI(...args);
      this.refreshUnread();
      return out;
    };
  }

  async refreshUnread() {
    if (!this.lib.getSessionToken()) return this.setUnread(0);
    try {
      const { unread } = await this.api('/api/community/messages/unread');
      this.setUnread(unread);
    } catch (e) { /* keep the last count */ }
  }

  setUnread(n) {
    ['dm-pill-badge', 'dm-menu-badge'].forEach(id => {
      const el = document.getElementById(id);
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.toggle('hidden', !n);
    });
  }

  when(iso) {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

(function bootSocial() {
  const start = () => {
    if (!window.packLibrary) return false;
    window.social = new Social(window.packLibrary);
    return true;
  };
  if (!start()) document.addEventListener('DOMContentLoaded', start, { once: true });
})();
