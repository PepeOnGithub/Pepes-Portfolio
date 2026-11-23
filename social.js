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
    this.bindSettings();
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

  // The verified tick: owner gets the "site owner" one, qualifying creators the "verified creator" one.
  badge(user) {
    if (!user || !(user.verified || user.owner)) return '';
    const title = user.owner ? 'Verified: this is the site owner' : 'Verified creator';
    return `<span class="author-badge" title="${title}"><i class="fas fa-check" aria-hidden="true"></i></span>`;
  }

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
    ['user-profile-follow', 'user-profile-follow-btn', 'user-profile-message-btn', 'user-profile-verified-badge', 'user-profile-verify']
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
    if (!info || !info.user || !this.lib.viewedProfile || this.lib.viewedProfile.id !== account.id) return;
    this.profile = info;
    this.renderProfile();
  }

  renderProfile() {
    const p = this.profile;
    let packs = p.packs || 0, downloads = p.downloads || 0;
    if (p.user.owner) { // the owner's packs come from packs.json
      const mine = (this.lib.packs || []).filter(x => !x.community && /^pepe/i.test(x.author || ''));
      packs = mine.length;
      downloads = mine.reduce((n, x) => n + (this.lib.liveDownloadCounts.get(x.id) ?? x.downloads ?? 0), 0);
    }
    document.getElementById('user-profile-packs-tile').classList.toggle('hidden', !packs);
    document.getElementById('user-profile-downloads-tile').classList.toggle('hidden', !packs || !downloads);
    document.getElementById('user-profile-packs-count').textContent = this.lib.formatCount(packs);
    document.getElementById('user-profile-downloads-count').textContent = this.lib.formatCount(downloads);
    document.getElementById('user-profile-followers').textContent = this.lib.formatCount(p.followers);
    document.getElementById('user-profile-following').textContent = this.lib.formatCount(p.following);
    document.querySelector('[data-follow-list="followers"]').lastChild.textContent = p.followers === 1 ? ' follower' : ' followers';
    document.getElementById('user-profile-follow').classList.remove('hidden');
    // The site owner already has their own tick (from the accounts worker).
    document.getElementById('user-profile-verified-badge').classList.toggle('hidden', !(p.user.verified && !p.user.owner));
    this.renderVerify();

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
    msgBtn.disabled = this.signedIn() && !p.canDM && !p.blockedByYou;
    msgBtn.title = this.signedIn() && !p.canDM && p.canMessage ? `${p.user.name} only takes messages from followers. Follow them first.` : '';
  }

  // Your own progress toward the verified tick, shown on your own profile.
  renderVerify() {
    const box = document.getElementById('user-profile-verify');
    const v = this.profile && this.profile.verification;
    if (!v || v.owner) { box.classList.add('hidden'); return; }
    const n = (x) => this.lib.formatCount(x);
    if (v.verified) {
      box.textContent = 'You have the verified badge.';
    } else {
      const ok = (met, text) => `${met ? '✓ ' : ''}${text}`;
      const need = v.need;
      box.textContent = 'To get the verified badge: ' + [
        ok(v.followers >= need.followers, `${n(v.followers)}/${n(need.followers)} followers`),
        ok(v.downloads >= need.downloads, `${n(v.downloads)}/${n(need.downloads)} downloads`),
        ok(v.ratings >= need.ratings && v.rating >= need.rating,
          `rating ${v.ratings ? v.rating.toFixed(1) : '–'} (needs ${need.rating.toFixed(1)}+ from ${need.ratings}+ ratings, you have ${v.ratings})`)
      ].join(' · ');
    }
    box.classList.remove('hidden');
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
    document.getElementById('follow-list').addEventListener('click', async (e) => {
      const un = e.target.closest('[data-unblock]');
      if (un) {
        un.disabled = true;
        try {
          await this.api(`${this.userPath(un.dataset.unblock)}/block`, { method: 'DELETE' });
          un.closest('.follow-row').remove();
          if (!document.querySelector('#follow-list .follow-row')) document.getElementById('follow-list').innerHTML = '<p class="follow-list-empty">You haven\'t blocked anyone.</p>';
        } catch (err) { un.disabled = false; this.lib.showToast(err.message); }
        return;
      }
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
    box.innerHTML = this.skRows(4, 40);
    document.getElementById('follow-list-overlay').classList.remove('hidden');
    try {
      const { users } = await this.api(`${this.userPath(this.profile.user.id)}/${which}`);
      box.innerHTML = users.length
        ? users.map(u => `
            <button type="button" class="follow-row" data-user="${this.esc(u.username || u.id)}">
              ${this.avatar(u, 'follow-row-avatar')}
              <span class="follow-row-text"><b>${this.esc(u.name)}${this.badge(u)}</b>${u.username ? `<small>@${this.esc(u.username)}</small>` : ''}</span>
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
      if (row) this.openThread({ id: row.dataset.userId, name: row.dataset.name, username: row.dataset.username, verified: !!row.dataset.verified, owner: !!row.dataset.owner });
    });
    document.getElementById('dm-who').addEventListener('click', () => {
      if (!this.peer) return;
      const key = this.peer.username || this.peer.id;
      this.closePanel();
      this.lib.showUserProfile(key);
    });
    document.getElementById('dm-block').addEventListener('click', () => this.toggleBlock());
    this.dmFilter = 'all';
    this.dmQuery = '';
    document.getElementById('dm-search').addEventListener('input', (e) => { this.dmQuery = e.target.value.trim().toLowerCase(); this.renderList(); });
    document.querySelectorAll('[data-dm-filter]').forEach(b => b.addEventListener('click', () => {
      this.dmFilter = b.dataset.dmFilter;
      document.querySelectorAll('[data-dm-filter]').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
      this.renderList();
    }));
    const text = document.getElementById('dm-text');
    text.addEventListener('input', () => this.autosize());
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        document.getElementById('dm-compose').requestSubmit();
      }
    });
    document.getElementById('dm-compose').addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.bindEmoji();
  }

  bindEmoji() {
    const pop = document.getElementById('dm-emoji-pop');
    const btn = document.getElementById('dm-emoji');
    const grid = document.getElementById('dm-emoji-grid');
    grid.innerHTML = ChatFormat.PICKER.map(e => `<button type="button" class="dm-emoji-item" data-emoji="${e}">${e}</button>`).join('');
    const setOpen = (open) => { pop.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => setOpen(pop.classList.contains('hidden')));
    grid.addEventListener('click', (e) => {
      const item = e.target.closest('[data-emoji]');
      if (!item) return;
      const t = document.getElementById('dm-text');
      t.setRangeText(item.dataset.emoji, t.selectionStart, t.selectionEnd, 'end');
      t.dispatchEvent(new Event('input'));
      t.focus();
    });
    document.addEventListener('click', (e) => {
      if (!pop.classList.contains('hidden') && !e.target.closest('#dm-emoji-pop, #dm-emoji')) setOpen(false);
    });
    // Escape closes the picker first, then the panel.
    document.getElementById('dm-compose').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.classList.contains('hidden')) { e.stopPropagation(); setOpen(false); }
    });
    this.closeEmoji = () => setOpen(false);
  }

  async openPanel(user) {
    if (!this.signedIn()) return this.signIn();
    document.getElementById('dm-overlay').classList.remove('hidden');
    if (!user) this.showList(); // right pane ready while the list loads
    await this.loadList();
    if (user) this.openThread(user);
    else this.showList();
  }

  closePanel() {
    if (this.closeEmoji) this.closeEmoji();
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

  // Placeholder rows (avatar + two lines) while a list loads.
  skRows(n, size) {
    return '<div role="status" aria-label="Loading">' + Array.from({ length: n }, (_, i) => `
      <div class="sk-row"><span class="sk sk-circle" style="width:${size}px;height:${size}px"></span>
      <span class="sk-stack"><span class="sk sk-line" style="width:${45 + (i * 17) % 35}%"></span><span class="sk sk-line" style="width:${30 + (i * 23) % 40}%"></span></span></div>`).join('') + '</div>';
  }

  async loadList() {
    const box = document.getElementById('dm-list');
    if (!box.querySelector('.dm-conv')) box.innerHTML = this.skRows(5, 44);
    try {
      const { conversations, unread } = await this.api('/api/community/messages');
      this.setUnread(unread);
      this.convs = conversations;
      this.renderList();
    } catch (e) {
      box.innerHTML = `<p class="dm-empty">${this.esc(e.message)}</p>`;
    }
  }

  renderList() {
    const box = document.getElementById('dm-list');
    const all = this.convs || [];
    const q = this.dmQuery || '';
    const rows = all.filter(c => (this.dmFilter !== 'unread' || c.unread) && (this.dmFilter !== 'creators' || c.user.creator) &&
      (!q || `${c.user.name} ${c.user.username || ''} ${c.last.text}`.toLowerCase().includes(q)));
    box.innerHTML = rows.length
      ? rows.map(c => `
          <button type="button" class="dm-conv${c.unread ? ' is-unread' : ''}" data-user-id="${this.esc(c.user.id)}" data-name="${this.esc(c.user.name)}" data-username="${this.esc(c.user.username)}" data-verified="${c.user.verified || c.user.owner ? 1 : ''}" data-owner="${c.user.owner ? 1 : ''}">
            ${this.avatar(c.user, 'dm-avatar')}
            <span class="dm-conv-text">
              <span class="dm-conv-top"><b>${this.esc(c.user.name)}${this.badge(c.user)}</b><small>${this.esc(this.when(c.last.createdAt))}</small></span>
              <span class="dm-conv-last">${c.last.mine ? 'You: ' : ''}${this.esc(ChatFormat.preview(c.last.text))}</span>
            </span>
            ${c.unread ? `<span class="dm-badge">${c.unread}</span>` : ''}
          </button>`).join('')
      : `<p class="dm-empty">${all.length ? 'No conversations match.' : 'No messages yet.'}</p>`;
    this.markActive();
  }

  markActive() {
    document.querySelectorAll('#dm-list .dm-conv').forEach(el => {
      el.classList.toggle('is-active', !!this.peer && el.dataset.userId === String(this.peer.id));
    });
  }

  async openThread(user) {
    this.peer = { id: String(user.id), name: user.name || '', username: user.username || '', verified: !!user.verified, owner: !!user.owner };
    document.querySelector('.dm-panel').classList.add('has-thread');
    this.renderWho();
    document.getElementById('dm-msgs').innerHTML = '<div class="sk-bubble-wrap" role="status" aria-label="Loading messages">'
      + ['55%', '40%', '65%', '30%'].map(w => `<span class="sk sk-bubble" style="width:${w}"></span>`).join('') + '</div>';
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
    Object.assign(peer, data.user, { canMessage: data.canMessage, canDM: data.canDM, blockedByYou: data.blockedByYou });
    this.renderWho();
    const box = document.getElementById('dm-msgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const lastId = data.messages.length ? data.messages[data.messages.length - 1].id : 0;
    if (first || lastId !== this._lastId) {
      box.innerHTML = data.messages.length
        ? data.messages.map(m => `
            <div class="dm-msg${m.mine ? ' is-mine' : ''}${ChatFormat.isEmojiOnly(m.text) ? ' is-jumbo' : ''}">
              <div class="dm-text">${ChatFormat.render(m.text)}</div>
              <time datetime="${this.esc(m.createdAt)}">${this.esc(this.when(m.createdAt))}</time>
            </div>`).join('')
        : `<p class="dm-empty">Say hi to ${this.esc(peer.name)}.</p>`;
      this.packCards(box);
      if (first || atBottom) box.scrollTop = box.scrollHeight;
      this._lastId = lastId;
    }
    this.renderThreadState();
    if (first) { this.loadList(); this.refreshUnread(); }
  }

  // A link to a pack on this site becomes a small card (icon, name, author, Open) under the message.
  packCards(root) {
    const lib = this.lib;
    root.querySelectorAll('.dm-text a[href]').forEach(a => {
      let u;
      try { u = new URL(a.href); } catch (e) { return; }
      const m = /^\/pack\/([^/]+)\/?$/.exec(u.pathname);
      if (!m || !(u.hostname === location.hostname || u.hostname === 'pepe.glacierclient.xyz')) return;
      const slug = decodeURIComponent(m[1]);
      const pack = (lib.packs || []).find(p => lib.packSlug(p) === slug);
      if (!pack || a.dataset.carded) return;
      a.dataset.carded = '1';
      const card = document.createElement('a');
      card.className = 'dm-pack-card';
      card.href = `/pack/${encodeURIComponent(slug)}`;
      const img = lib.isImagePath(pack.thumbnail) ? `<img src="${this.esc(pack.thumbnail)}" alt="" loading="lazy">` : '<i class="fas fa-box-open" aria-hidden="true"></i>';
      card.innerHTML = `<span class="dm-pack-art">${img}</span><span class="dm-pack-text"><b>${this.esc(pack.name)}</b><small>${this.esc(lib.capitalizeFirst(pack.category))} · ${this.esc(pack.author || 'Pepe')}</small></span><span class="dm-pack-open">Open</span>`;
      card.addEventListener('click', (e) => {
        e.preventDefault();
        this.closePanel();
        window.router.show('library', { push: false });
        lib.showDetail(pack);
      });
      const wrap = a.closest('.dm-msg');
      // Link alone in the message: show only the card; otherwise keep the text and add the card.
      const onlyLink = a.closest('.dm-text').textContent.trim() === a.textContent.trim();
      if (onlyLink) { a.closest('.dm-text').replaceWith(card); } else { a.closest('.dm-text').after(card); }
      if (wrap) wrap.classList.add('has-pack-card');
    });
  }

  renderWho() {
    const p = this.peer;
    document.getElementById('dm-who').innerHTML =
      `${this.avatar(p, 'dm-avatar dm-avatar-sm')}<span>${this.esc(p.name || 'Conversation')}</span>${this.badge(p)}`;
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
    } else if (!p.canDM) {
      note.textContent = `${p.name} only takes messages from followers. Follow them to message.`;
    }
    note.classList.toggle('hidden', !!p.canDM);
    compose.classList.toggle('hidden', !p.canDM);
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

  // ===== Settings > Messages: who can message you, blocked accounts =====

  bindSettings() {
    const box = document.getElementById('dm-followers-only');
    if (!box) return;
    box.addEventListener('change', async () => {
      const want = box.checked;
      box.disabled = true;
      try {
        const res = await this.api('/api/community/messages/settings', { method: 'PUT', json: { followersOnly: want } });
        box.checked = res.followersOnly;
        this.lib.showToast(res.followersOnly ? 'Only followers can message you now.' : 'Anyone can message you now.');
      } catch (e) {
        box.checked = !want;
        this.lib.showToast(e.message);
      }
      box.disabled = false;
    });
    document.getElementById('dm-blocked-btn').addEventListener('click', () => this.openBlocked());
    this.refreshPrivacy();
  }

  async refreshPrivacy() {
    const box = document.getElementById('dm-followers-only');
    const desc = document.getElementById('dm-privacy-desc');
    if (!box) return;
    if (!this.signedIn()) { box.disabled = true; box.checked = false; desc.textContent = 'Sign in to change this.'; return; }
    desc.textContent = 'People who don\'t follow you can\'t start a conversation. You can still message them.';
    try {
      const res = await this.api('/api/community/messages/settings');
      box.checked = !!res.followersOnly;
      box.disabled = false;
    } catch (e) { box.disabled = true; desc.textContent = e.message; }
  }

  async openBlocked() {
    if (!this.signedIn()) return this.signIn();
    document.getElementById('follow-list-title').textContent = 'Blocked accounts';
    const list = document.getElementById('follow-list');
    list.innerHTML = this.skRows(3, 40);
    document.getElementById('follow-list-overlay').classList.remove('hidden');
    try {
      const { users } = await this.api('/api/community/blocks');
      list.innerHTML = users.length
        ? users.map(u => `
            <div class="follow-row" data-blocked="${this.esc(u.id)}">
              ${this.avatar(u, 'follow-row-avatar')}
              <span class="follow-row-text"><b>${this.esc(u.name)}</b>${u.username ? `<small>@${this.esc(u.username)}</small>` : ''}</span>
              <button type="button" class="dm-chip" data-unblock="${this.esc(u.id)}">Unblock</button>
            </div>`).join('')
        : '<p class="follow-list-empty">You haven\'t blocked anyone.</p>';
    } catch (e) {
      list.innerHTML = `<p class="follow-list-empty">${this.esc(e.message)}</p>`;
    }
  }

  // ===== Unread badge =====

  wrapAuth() {
    const renderAuthUI = this.lib.renderAuthUI.bind(this.lib);
    this.lib.renderAuthUI = (...args) => {
      const out = renderAuthUI(...args);
      this.refreshUnread();
      this.refreshPrivacy();
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
    this.unread = n;
    ['dm-pill-badge', 'dm-menu-badge', 'dm-top-badge', 'dm-tab-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
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
