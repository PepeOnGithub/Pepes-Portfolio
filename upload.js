// Community uploads: the Upload page (new upload, My uploads, profile & earnings,
// and the owner's review log). Talks to the uploads worker (worker/ in this
// repo) at UPLOADS_API, using the same session token as comments and ratings.

// The version of the terms (the "Last updated" date on terms.html) that the
// upload form asks people to agree to. Must match TERMS_VERSION in
// worker/src/index.js; change both when the terms change.
const TERMS_VERSION = '2026-11-23';

// Social platforms creators can link (same list the worker accepts).
window.SOCIAL_META = {
  discord: ['Discord', 'fab fa-discord'],
  youtube: ['YouTube', 'fab fa-youtube'],
  x: ['X', 'fab fa-x-twitter'],
  tiktok: ['TikTok', 'fab fa-tiktok'],
  twitch: ['Twitch', 'fab fa-twitch'],
  instagram: ['Instagram', 'fab fa-instagram'],
  github: ['GitHub', 'fab fa-github'],
  patreon: ['Patreon', 'fab fa-patreon'],
  kofi: ['Ko-fi', 'fas fa-mug-hot'],
  mcpedl: ['MCPEDL', 'fas fa-cube'],
  bluesky: ['Bluesky', 'fas fa-cloud'],
  website: ['Website', 'fas fa-globe']
};
window.detectSocialType = function detectSocialType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
  const map = {
    'discord.gg': 'discord', 'discord.com': 'discord', 'discordapp.com': 'discord', 'youtube.com': 'youtube', 'm.youtube.com': 'youtube',
    'x.com': 'x', 'twitter.com': 'x', 'tiktok.com': 'tiktok', 'twitch.tv': 'twitch', 'instagram.com': 'instagram', 'github.com': 'github',
    'patreon.com': 'patreon', 'ko-fi.com': 'kofi', 'mcpedl.com': 'mcpedl', 'bsky.app': 'bluesky'
  };
  return map[host] || (host.includes('.') ? 'website' : '');
};

class UploadsPage {
  constructor(library) {
    this.lib = library;
    this.me = null;
    this.isAdmin = false;
    this.mine = [];
    this.queue = [];
    this.settings = null;
    this.tab = 'new';
    this.loadedFor = undefined;
    this.bind();
  }

  // ===== API =====

  token() {
    try { return this.lib.getSessionToken() || ''; } catch (e) { return ''; }
  }

  async api(path, { method = 'GET', body, json } = {}) {
    const headers = {};
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    // Give up after 25 seconds so the page shows "Try again" instead of spinning forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res;
    let data = null;
    try {
      res = await fetch(`${UPLOADS_API}${path}`, { method, headers, body: payload, signal: ctrl.signal });
      try { data = await res.json(); } catch (e) { /* empty body */ }
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'The upload service took too long to answer.' : ((e && e.message) || 'Request failed'));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  // XHR instead of fetch so the progress bar can follow the upload.
  upload(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${UPLOADS_API}${path}`);
      const token = this.token();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error) || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Couldn't reach the upload service. Check your connection."));
      xhr.send(formData);
    });
  }

  // ===== Page state =====

  async open() {
    document.title = 'Upload a pack · Pepe';
    const token = this.token();
    if (this.loadedFor === token && this.me !== null) {
      this.render();
      return;
    }
    await this.load();
  }

  async load() {
    this.loadedFor = this.token();
    this.showState('loading');
    const note = document.getElementById('up-loading-note');
    if (note) { note.textContent = ''; note.classList.add('hidden'); }
    const slow = setTimeout(() => { if (note) { note.textContent = 'Still loading… the upload service is slower than usual right now.'; note.classList.remove('hidden'); } }, 6000);
    try {
      // These don't depend on each other, so ask for all of them at once rather
      // than one after the other. If you aren't signed in the last two answer
      // "sign in", which is ignored because /me says so first.
      const signedIn = !!this.token();
      const mineRequest = signedIn ? this.api('/api/community/mine') : null;
      const settingsRequest = signedIn ? this.api('/api/community/creator') : null;
      [mineRequest, settingsRequest].forEach(p => { if (p) p.catch(() => {}); });

      const me = await this.api('/api/community/me');
      this.me = me.user;
      this.isAdmin = !!me.isAdmin;
      if (!this.me) {
        this.showState('signed-out');
        return;
      }
      const [mine, queue, settings] = await Promise.all([
        mineRequest,
        this.isAdmin ? this.api('/api/community/queue') : Promise.resolve({ packs: [] }),
        settingsRequest
      ]);
      this.mine = mine.packs || [];
      this.queue = queue.packs || [];
      this.settings = settings.settings;
      this.profileFilled = false;
      this.render();
    } catch (e) {
      this.me = null;
      this.loadedFor = undefined;
      this.showState('offline');
    } finally {
      clearTimeout(slow);
    }
  }

  showState(state) {
    const ids = { loading: 'up-loading', 'signed-out': 'up-signed-out', offline: 'up-offline', main: 'up-main' };
    Object.entries(ids).forEach(([key, id]) => {
      document.getElementById(id).classList.toggle('hidden', key !== state);
    });
  }

  needsYou(pack) {
    return pack.status === 'pending' || pack.versions.some(v => v.status === 'pending');
  }

  render() {
    this.showState('main');
    document.getElementById('up-account-name').textContent = this.me.username || this.me.name || '';
    document.getElementById('up-account-id').textContent = this.me.id;
    document.getElementById('up-mine-count').textContent = this.mine.length;
    document.getElementById('up-queue-count').textContent = this.queue.filter(p => this.needsYou(p)).length;
    document.getElementById('up-queue-tab').classList.toggle('hidden', !this.isAdmin);
    if (this.tab === 'queue' && !this.isAdmin) this.tab = 'new';
    this.switchTab(this.tab);
    this.renderMine();
    this.renderCreator();
    if (this.isAdmin) this.renderQueue();
    this.scheduleCheckPoll();
  }

  // While an automatic check is running, refresh every few seconds so the
  // status flips to Live or Not approved without a reload.
  scheduleCheckPoll() {
    clearTimeout(this._pollTimer);
    const lootWaiting = this.settings && this.settings.hasLootToken && this.settings.lootStatus !== 'ok'
      && !(this.settings.lootStatus || '').startsWith('failed')
      && this.mine.some(p => p.versions.some(v => v.status === 'approved' && !v.lootUrl));
    const running = this.mine.some(p => p.checking) || this.queue.some(p => p.checking) || lootWaiting;
    if (!running) {
      this._polls = 0;
      return;
    }
    if ((this._polls = (this._polls || 0) + 1) > 20) return;
    this._pollTimer = setTimeout(async () => {
      if (!document.getElementById('page-upload').classList.contains('active')) return;
      try {
        const [mine, queue, settings] = await Promise.all([
          this.api('/api/community/mine'),
          this.isAdmin ? this.api('/api/community/queue') : Promise.resolve({ packs: [] }),
          this.api('/api/community/creator')
        ]);
        const wentLive = this.mine.some(p => p.checking && (mine.packs || []).some(n => n.id === p.id && n.status === 'approved' && !n.checking));
        this.mine = mine.packs || [];
        this.queue = queue.packs || [];
        this.settings = settings.settings;
        this.render();
        if (wentLive) {
          this.refreshLibrary();
          this.lib.showToast('Your pack passed the check and is live.');
        }
      } catch (e) { /* try again on the next tick */ }
    }, 4000);
  }

  // Opens "My packs" with one pack's Edit or Update drawer ready (used by the
  // Update button on a pack's own page).
  async editPack(packId, drawer = 'version') {
    window.router.show('upload', { push: false });
    await this.open();
    if (!this.me) return;
    this.switchTab('mine');
    const item = document.querySelector(`#up-mine-list .up-item[data-pack="${packId}"]`);
    if (!item) return;
    const btn = item.querySelector(`[data-act="toggle"][data-target="${drawer}"]`);
    if (btn && item.querySelector(`[data-drawer="${drawer}"]`).classList.contains('hidden')) btn.click();
    item.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  switchTab(tab) {
    this.tab = tab;
    document.querySelectorAll('.up-tab').forEach(btn => {
      const on = btn.dataset.upTab === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    ['new', 'mine', 'profile', 'queue'].forEach(name => {
      document.getElementById(`up-panel-${name}`).classList.toggle('hidden', name !== tab);
    });
  }

  // ===== Events =====

  bind() {
    document.querySelectorAll('.up-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.upTab));
    });
    document.getElementById('page-upload').addEventListener('click', (e) => {
      const go = e.target.closest('[data-up-goto]');
      if (go) { e.preventDefault(); this.switchTab(go.dataset.upGoto); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    document.getElementById('up-retry-btn').addEventListener('click', () => this.load());
    document.getElementById('up-signin-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById('auth-login-btn').click();
    });
    document.getElementById('auth-upload-btn').addEventListener('click', () => {
      document.getElementById('auth-account-menu').classList.add('hidden');
    });

    const fileInput = document.getElementById('up-file');
    const drop = document.getElementById('up-file-drop');
    fileInput.addEventListener('change', () => this.onPackFile(fileInput.files[0]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('dragging')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        this.onPackFile(fileInput.files[0]);
      }
    });

    const iconInput = document.getElementById('up-icon');
    iconInput.addEventListener('change', () => this.previewIcon(iconInput.files[0], document.getElementById('up-icon-preview')));

    document.getElementById('up-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitNew();
    });

    // Actions inside My uploads and the review log.
    document.getElementById('up-mine-list').addEventListener('click', (e) => this.onListClick(e));
    document.getElementById('up-queue-list').addEventListener('click', (e) => this.onListClick(e));
    document.getElementById('up-mine-list').addEventListener('submit', (e) => this.onListSubmit(e));
    document.getElementById('up-queue-list').addEventListener('submit', (e) => this.onListSubmit(e));

    this.bindCreator();

    // Signing in, out or switching account reloads the page's data.
    const renderAuthUI = this.lib.renderAuthUI.bind(this.lib);
    this.lib.renderAuthUI = (...args) => {
      const out = renderAuthUI(...args);
      if (this.loadedFor !== undefined && this.loadedFor !== this.token()) {
        this.loadedFor = undefined;
        this.me = null;
        if (document.getElementById('page-upload').classList.contains('active')) this.load();
      }
      return out;
    };
  }

  onPackFile(file) {
    const label = document.getElementById('up-file-label');
    const drop = document.getElementById('up-file-drop');
    if (!file) {
      label.textContent = 'Choose your pack file';
      drop.classList.remove('has-file');
      return;
    }
    label.textContent = `${file.name} · ${this.formatSize(file.size)}`;
    drop.classList.add('has-file');
    // Prefill the name and version from a file like "My_Pack_v1.2.0.mcpack".
    const form = document.getElementById('up-form');
    const base = file.name.replace(/\.(mcpack|mcaddon|brarchive|mcworld|mctemplate|zip)$/i, '');
    const vMatch = base.match(/[_\s-]v?(\d+(?:\.\d+){1,3})$/i);
    if (!form.elements.name.value.trim()) {
      form.elements.name.value = (vMatch ? base.slice(0, vMatch.index) : base).replace(/[_]+/g, ' ').trim().slice(0, 60);
    }
    if (vMatch && (!form.elements.version.value.trim() || form.elements.version.value === '1.0.0')) {
      form.elements.version.value = vMatch[1];
    }
  }

  previewIcon(file, target) {
    if (!file) {
      target.innerHTML = '<i class="fas fa-image" aria-hidden="true"></i>';
      return;
    }
    const url = URL.createObjectURL(file);
    target.innerHTML = '';
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    target.appendChild(img);
  }

  validateNew(form) {
    const f = form.elements;
    const file = document.getElementById('up-file').files[0];
    if (!file) return ['up-file', 'Choose your pack file.'];
    if (!/\.(mcpack|mcaddon|brarchive|mcworld|mctemplate|zip)$/i.test(file.name)) return ['up-file', 'Pack files must be .mcpack, .mcaddon, .brarchive, .mcworld, .mctemplate or .zip.'];
    if (file.size > 50 * 1024 * 1024) return ['up-file', 'Pack files can be up to 50 MB.'];
    const icon = document.getElementById('up-icon').files[0];
    if (icon && icon.size > 1024 * 1024) return ['up-icon', 'Icons can be up to 1 MB.'];
    const name = f.name.value.trim();
    if (name.length < 3) return ['name', 'Give your pack a name (at least 3 characters).'];
    if (!/^v?[0-9A-Za-z][0-9A-Za-z.\-+]{0,19}$/.test(f.version.value.trim())) return ['version', 'Version should look like 1.0.0.'];
    if (f.description.value.trim().length < 10) return ['description', 'Describe your pack in at least 10 characters.'];
    if (f.tags.value.split(',').map(t => t.trim()).filter(Boolean).length > 6) return ['tags', 'Use up to 6 tags.'];
    const showcase = f.showcaseUrl.value.trim();
    if (showcase && !/^https:\/\/\S+$/i.test(showcase)) return ['showcaseUrl', 'The video link must start with https://'];
    if (!f.rights.checked) return ['rights', 'Confirm you made this pack or have permission to share it.'];
    return null;
  }

  async submitNew() {
    const form = document.getElementById('up-form');
    const errorEl = document.getElementById('up-form-error');
    const submit = document.getElementById('up-submit');
    const progress = document.getElementById('up-progress');
    const fill = document.getElementById('up-progress-fill');
    errorEl.classList.add('hidden');
    form.querySelectorAll('.up-invalid').forEach(el => el.classList.remove('up-invalid'));

    const problem = this.validateNew(form);
    if (problem) {
      const [field, message] = problem;
      const el = form.elements[field] || document.getElementById(field);
      const box = el && (el.closest('.up-field, .up-drop, .up-check, .up-icon-row') || el);
      if (box) box.classList.add('up-invalid');
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
      if (el && el.focus) el.focus({ preventScroll: true });
      if (box) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const data = new FormData();
    ['name', 'category', 'version', 'description', 'tags', 'changelog', 'showcaseUrl'].forEach(k => {
      data.append(k, form.elements[k].value.trim());
    });
    data.append('file', document.getElementById('up-file').files[0]);
    const icon = document.getElementById('up-icon').files[0];
    if (icon) data.append('icon', icon);
    data.append('terms', TERMS_VERSION); // they ticked the agreement above

    submit.disabled = true;
    submit.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Uploading…';
    progress.classList.remove('hidden');
    fill.style.width = '0%';
    try {
      const res = await this.upload('/api/community/packs', data, (p) => { fill.style.width = `${Math.round(p * 100)}%`; });
      this.mine.unshift(res.pack);
      if (this.isAdmin) this.queue = (await this.api('/api/community/queue')).packs || [];
      form.reset();
      this.onPackFile(null);
      this.previewIcon(null, document.getElementById('up-icon-preview'));
      this.lib.showToast(`${res.pack.name} is being checked. This usually takes under a minute.`);
      this.tab = 'mine';
      this.render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      submit.disabled = false;
      submit.innerHTML = '<i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload for review';
      progress.classList.add('hidden');
    }
  }

  // ===== Earnings, and the creator profile in the Edit profile dialog =====

  bindCreator() {
    document.getElementById('up-earn-form').addEventListener('submit', (e) => { e.preventDefault(); this.saveEarnings(); });
    document.getElementById('up-loot-remove').addEventListener('click', () => {
      if (confirm('Remove your LootLabs token? Your LootLabs download links will stop being made and existing ones are removed.')) this.saveEarnings({ removeToken: true });
    });
    this.bindProfileDialog();
  }

  // The bio, links and featured videos live in the header's Edit profile
  // dialog (script.js) next to the username, picture and banner. This adds
  // their loading and saving to that dialog: they're loaded from the uploads
  // worker when it opens, and saved together with the account details.
  bindProfileDialog() {
    document.getElementById('up-social-add').addEventListener('click', () => this.addRow('up-social-rows', 8, 'social'));
    document.getElementById('up-video-add').addEventListener('click', () => this.addRow('up-video-rows', 3, 'video'));
    const bio = document.getElementById('up-bio');
    bio.addEventListener('input', () => { document.getElementById('up-bio-count').textContent = `${bio.value.length}/500`; });
    ['up-social-rows', 'up-video-rows'].forEach(id => {
      const box = document.getElementById(id);
      box.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-row-remove]');
        if (rm) { rm.closest('.up-row-item').remove(); this.syncRowButtons(); }
      });
      box.addEventListener('input', (e) => {
        const row = e.target.closest('.up-row-item');
        if (row && id === 'up-social-rows') this.updateBadge(row);
      });
    });

    document.getElementById('profile-creator-state').addEventListener('click', (e) => {
      if (e.target.closest('#profile-creator-retry')) this.loadCreatorFields();
    });

    const open = this.lib.openProfileModal.bind(this.lib);
    this.lib.openProfileModal = () => { open(); this.loadCreatorFields(); };

    // Creator details are saved first; if they're rejected the dialog stays open
    // with the reason, and the account details are saved once they're fine.
    const save = this.lib.saveProfile.bind(this.lib);
    this.lib.saveProfile = async () => {
      const result = await this.saveCreatorFields();
      if (!result.ok) return;
      await save();
      if (result.pending && document.getElementById('profile-modal-overlay').classList.contains('hidden')) {
        this.lib.showToast('Profile saved. Your bio and links are being checked.');
      }
    };
  }

  async loadCreatorFields() {
    const box = document.getElementById('profile-creator-fields');
    const state = document.getElementById('profile-creator-state');
    const body = document.getElementById('profile-creator-body');
    this.creatorFieldsReady = false;
    const seq = this._creatorSeq = (this._creatorSeq || 0) + 1;
    if (!this.lib.currentUser) { box.classList.add('hidden'); return; }
    // Show the section straight away so it's clear something is coming.
    box.classList.remove('hidden');
    body.classList.add('hidden');
    state.classList.remove('hidden');
    state.innerHTML = '<div class="sk-stack" role="status" aria-label="Loading your creator profile"><span class="sk sk-line" style="width:25%"></span><span class="sk" style="height:88px"></span><span class="sk sk-line" style="width:20%"></span><span class="sk" style="height:44px"></span></div>';
    try {
      const res = await this.api('/api/community/creator');
      if (seq !== this._creatorSeq) return; // the dialog was closed and reopened meanwhile
      this.settings = res.settings;
      this.fillCreatorFields();
      this.renderCreator();
      this.creatorFieldsReady = true;
      state.classList.add('hidden');
      body.classList.remove('hidden');
    } catch (e) {
      if (seq !== this._creatorSeq) return;
      // Your username, picture and banner still save without it.
      state.innerHTML = `Couldn't load your creator profile (${this.esc(e.message)}). <button type="button" class="up-link-btn" id="profile-creator-retry">Try again</button>`;
    }
  }

  fillCreatorFields() {
    const draft = (this.settings && this.settings.profile && this.settings.profile.draft) || { bio: '', socials: [], videos: [] };
    const bio = document.getElementById('up-bio');
    bio.value = draft.bio || '';
    document.getElementById('up-bio-count').textContent = `${bio.value.length}/500`;
    document.getElementById('up-social-rows').innerHTML = '';
    document.getElementById('up-video-rows').innerHTML = '';
    (draft.socials || []).forEach(s => this.addRow('up-social-rows', 8, 'social', s.url));
    (draft.videos || []).forEach(v => this.addRow('up-video-rows', 3, 'video', `https://youtu.be/${typeof v === 'string' ? v : v.id}`));
    this.syncRowButtons();
  }

  // Returns { ok, pending }. Nothing to save if the creator section never loaded.
  async saveCreatorFields() {
    if (!this.creatorFieldsReady) return { ok: true, pending: false };
    const err = document.getElementById('profile-form-error');
    err.classList.add('hidden');
    const socials = [...document.querySelectorAll('#up-social-rows input')].map(i => i.value.trim()).filter(Boolean);
    const videos = [...document.querySelectorAll('#up-video-rows input')].map(i => i.value.trim()).filter(Boolean);
    const btn = document.getElementById('profile-save-btn');
    btn.disabled = true;
    try {
      const res = await this.api('/api/community/creator', {
        method: 'PUT',
        json: { profile: { bio: document.getElementById('up-bio').value.trim(), socials, videos } }
      });
      this.settings = res.settings;
      this._settingsPolls = 0;
      this.renderCreator();
      return { ok: true, pending: !!(res.settings.profile && res.settings.profile.status === 'pending') };
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
      return { ok: false, pending: false };
    } finally {
      btn.disabled = false;
    }
  }

  addRow(boxId, max, kind, value = '') {
    const box = document.getElementById(boxId);
    if (box.children.length >= max) return;
    const row = document.createElement('div');
    row.className = 'up-row-item';
    row.innerHTML = `
      <input type="text" maxlength="200" autocomplete="off" spellcheck="false" aria-label="${kind === 'video' ? 'YouTube video link' : 'Link'}"
        placeholder="${kind === 'video' ? 'https://youtu.be/…' : 'discord.gg/… · youtube.com/@… · your website'}">
      ${kind === 'social' ? '<span class="up-badge hidden"></span>' : ''}
      <button type="button" class="up-icon-btn" data-row-remove aria-label="Remove"><i class="fas fa-xmark" aria-hidden="true"></i></button>`;
    row.querySelector('input').value = value;
    box.appendChild(row);
    if (kind === 'social') this.updateBadge(row);
    this.syncRowButtons();
    return row;
  }

  updateBadge(row) {
    const badge = row.querySelector('.up-badge');
    if (!badge) return;
    const type = window.detectSocialType(row.querySelector('input').value);
    const meta = type && window.SOCIAL_META[type];
    badge.classList.toggle('hidden', !meta);
    badge.innerHTML = meta ? `<i class="${meta[1]}" aria-hidden="true"></i> ${meta[0]}` : '';
  }

  syncRowButtons() {
    document.getElementById('up-social-add').classList.toggle('hidden', document.getElementById('up-social-rows').children.length >= 8);
    document.getElementById('up-video-add').classList.toggle('hidden', document.getElementById('up-video-rows').children.length >= 3);
  }

  renderCreator() {
    const st = this.settings;
    if (!st) return;

    // Earnings summary on the New upload tab.
    const parts = [];
    if (st.linkvertiseId) parts.push('Linkvertise');
    if (st.hasLootToken) parts.push('LootLabs');
    const text = document.getElementById('up-earn-text');
    const btn = document.querySelector('#up-earn-note [data-up-goto]');
    // The site owner earns through the site's own accounts; no form to fill.
    document.getElementById('up-earn-site').classList.toggle('hidden', !st.siteEarnings);
    document.getElementById('up-earn-form').classList.toggle('hidden', !!st.siteEarnings);
    btn.classList.toggle('hidden', !!st.siteEarnings);
    if (st.siteEarnings) {
      text.textContent = "Your packs use the site's own Linkvertise and LootLabs accounts, the same as the library packs. The links are made automatically.";
    } else if (parts.length) {
      text.textContent = `Earning with ${parts.join(' and ')}. The site makes your download links automatically, and you keep 100%.`;
      btn.innerHTML = '<i class="fas fa-gear" aria-hidden="true"></i> Manage earnings';
    } else {
      text.textContent = "You haven't added an earning account yet, so downloads of your packs go through the site's Linkvertise and LootLabs. Add yours and every download earns for you instead.";
      btn.innerHTML = '<i class="fas fa-sack-dollar" aria-hidden="true"></i> Set up earnings';
    }

    // Fill the forms once per load, so typing isn't overwritten by background refreshes.
    if (!this.profileFilled) {
      this.profileFilled = true;
      document.getElementById('up-lv-id').value = st.linkvertiseId || '';
      document.getElementById('up-loot-token').value = '';
    }

    const lootState = document.getElementById('up-loot-state');
    lootState.textContent = st.hasLootToken ? '✓ saved' : 'optional';
    document.getElementById('up-loot-remove').classList.toggle('hidden', !st.hasLootToken);
    document.getElementById('up-loot-token').placeholder = st.hasLootToken ? 'Saved. Paste a new token to replace it' : 'Paste your token';
    const status = document.getElementById('up-loot-status');
    if (st.hasLootToken && st.lootStatus && st.lootStatus.startsWith('failed')) {
      status.textContent = `LootLabs said no: ${st.lootStatus.replace(/^failed:\s*/, '')} Check the token and save again.`;
      status.classList.remove('hidden');
    } else if (st.hasLootToken && st.lootStatus === 'ok') {
      status.textContent = 'LootLabs is connected. Links are made automatically for every live version.';
      status.classList.remove('hidden');
    } else if (st.hasLootToken) {
      status.textContent = 'Token saved. Your first LootLabs link is made when a pack goes live.';
      status.classList.remove('hidden');
    } else {
      status.classList.add('hidden');
    }

    const ps = document.getElementById('up-profile-status');
    const prof = st.profile || {};
    if (prof.status === 'pending') {
      ps.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Your profile is being checked. This takes a few seconds.';
      ps.classList.remove('hidden');
    } else if (prof.note) {
      ps.textContent = prof.note;
      ps.classList.remove('hidden');
    } else if (prof.public && (prof.public.bio || (prof.public.socials || []).length || (prof.public.videos || []).length)) {
      ps.textContent = 'Your profile is live.';
      ps.classList.remove('hidden');
    } else {
      ps.classList.add('hidden');
    }
    if (prof.status === 'pending') this.pollSettings();
  }

  pollSettings() {
    clearTimeout(this._settingsTimer);
    if ((this._settingsPolls = (this._settingsPolls || 0) + 1) > 15) return;
    this._settingsTimer = setTimeout(async () => {
      try {
        const res = await this.api('/api/community/creator');
        const wasPending = this.settings && this.settings.profile && this.settings.profile.status === 'pending';
        this.settings = res.settings;
        this.renderCreator();
        if (wasPending && res.settings.profile.status !== 'pending') this._settingsPolls = 0;
      } catch (e) { /* try again */ }
    }, 3000);
  }

  async saveEarnings({ removeToken = false } = {}) {
    const err = document.getElementById('up-earn-error');
    const btn = document.getElementById('up-earn-save');
    err.classList.add('hidden');
    const lv = document.getElementById('up-lv-id').value.trim();
    const token = document.getElementById('up-loot-token').value.trim();
    if (lv && !/^\d{1,12}$/.test(lv)) { err.textContent = 'Your Linkvertise user id is a number, like 123456.'; err.classList.remove('hidden'); return; }
    const body = { linkvertiseId: lv };
    if (removeToken) body.lootToken = '';
    else if (token) body.lootToken = token;
    btn.disabled = true;
    try {
      const res = await this.api('/api/community/creator', { method: 'PUT', json: body });
      this.settings = res.settings;
      document.getElementById('up-loot-token').value = '';
      this.render();
      this.refreshLibrary();
      this.lib.showToast(removeToken ? 'LootLabs token removed.' : 'Earnings saved.');
      if (body.lootToken) this.scheduleCheckPoll();
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  }

  // ===== My uploads =====

  statusChip(status, note) {
    const map = {
      approved: ['live', 'fa-circle-check', 'Live'],
      pending: ['pending', 'fa-clock', 'Waiting'],
      rejected: ['rejected', 'fa-circle-xmark', 'Not approved'],
      checking: ['pending', 'fa-circle-notch fa-spin', 'Being checked']
    };
    const [cls, icon, label] = map[status] || map.pending;
    return `<span class="up-status up-status-${cls}" ${note ? `title="${this.esc(note)}"` : ''}><i class="fas ${icon}" aria-hidden="true"></i> ${label}</span>`;
  }

  iconHtml(pack) {
    return pack.thumbnail
      ? `<img src="${this.esc(pack.thumbnail)}" alt="" loading="lazy">`
      : `<span>${this.esc((pack.name || '?').charAt(0).toUpperCase())}</span>`;
  }

  renderMine() {
    const list = document.getElementById('up-mine-list');
    if (!this.mine.length) {
      list.innerHTML = `
        <div class="up-empty">
          <i class="fas fa-box-open" aria-hidden="true"></i>
          <p>You haven't uploaded anything yet.</p>
          <button type="button" class="up-btn up-btn-primary" data-act="goto-new"><i class="fas fa-plus" aria-hidden="true"></i> Upload your first pack</button>
        </div>`;
      return;
    }
    list.innerHTML = this.mine.map(pack => this.mineItem(pack)).join('');
  }

  mineItem(pack) {
    const latest = pack.versions[0] || {};
    const st = this.settings || {};
    const note = pack.status === 'rejected' && pack.reviewNote
      ? `<p class="up-note"><i class="fas fa-message" aria-hidden="true"></i> ${this.esc(pack.reviewNote)}</p>` : '';
    const earning = [
      st.linkvertiseId ? `<span class="up-pill"><i class="fas fa-link" aria-hidden="true"></i> Linkvertise ${this.esc(st.linkvertiseId)}</span>` : '',
      st.hasLootToken ? `<span class="up-pill"><i class="fas fa-link" aria-hidden="true"></i> LootLabs ${latest.lootUrl ? 'link ready' : 'link being made'}</span>` : '',
      !st.linkvertiseId && !st.hasLootToken ? '<span class="up-pill up-pill-muted">Earning for the site <button type="button" class="up-link-btn" data-up-goto="profile">Use my accounts</button></span>' : ''
    ].join('');
    const versions = pack.versions.map(v => `
      <li>
        <span class="up-mono">v${this.esc(v.version)}</span>
        <span class="up-muted">${this.esc(v.size)} · ${this.esc(v.date)}${v.status === 'approved' ? ` · ${this.lib.formatCount(v.downloads || 0)} downloads` : ''}</span>
        ${this.statusChip(v.status, v.reviewNote)}
        ${pack.versions.length > 1 ? `<button type="button" class="up-link-btn" data-act="delete-version" data-version="${v.id}" data-pack="${pack.id}">Remove</button>` : ''}
        ${v.status === 'rejected' && v.reviewNote ? `<p class="up-note">${this.esc(v.reviewNote)}</p>` : ''}
      </li>`).join('');
    return `
      <article class="up-item" data-pack="${pack.id}">
        <div class="up-item-head">
          <span class="up-item-icon">${this.iconHtml(pack)}</span>
          <div class="up-item-title">
            <h3>${this.esc(pack.name)}</h3>
            <p class="up-muted">${this.esc(this.lib.capitalizeFirst(pack.category))} · v${this.esc(latest.version || '')}</p>
          </div>
          ${this.statusChip(pack.checking ? 'checking' : pack.status, pack.reviewNote)}
        </div>
        ${note}
        <div class="up-pills">${earning}</div>
        <div class="up-actions">
          ${pack.status === 'approved' ? `<button type="button" class="up-btn" data-act="view" data-pack="${pack.id}"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> View in library</button>` : ''}
          ${pack.status === 'rejected' && (pack.aiRuns || 0) < 6 ? `<button type="button" class="up-btn up-btn-primary" data-act="recheck" data-pack="${pack.id}"><i class="fas fa-rotate-right" aria-hidden="true"></i> Check again</button>` : ''}
          <button type="button" class="up-btn" data-act="toggle" data-target="edit"><i class="fas fa-pen" aria-hidden="true"></i> Edit</button>
          <button type="button" class="up-btn" data-act="toggle" data-target="version"><i class="fas fa-code-branch" aria-hidden="true"></i> Update pack</button>
          <button type="button" class="up-btn up-btn-danger" data-act="delete" data-pack="${pack.id}"><i class="fas fa-trash" aria-hidden="true"></i> Delete</button>
        </div>

        <form class="up-drawer up-form hidden" data-drawer="edit" data-form="edit" data-pack="${pack.id}">
          <div class="up-row">
            <label class="up-field"><span class="up-label">Name</span><input type="text" name="name" maxlength="60" value="${this.esc(pack.name)}"></label>
            <label class="up-field"><span class="up-label">Category</span>
              <select name="category">${['packs', 'cosmetics', 'utility', 'addons', 'other'].map(c => `<option value="${c}"${c === pack.category ? ' selected' : ''}>${this.lib.capitalizeFirst(c)}</option>`).join('')}</select>
            </label>
          </div>
          <label class="up-field"><span class="up-label">Description</span><textarea name="description" rows="3" maxlength="2000">${this.esc(pack.description)}</textarea></label>
          <label class="up-field"><span class="up-label">Tags</span><input type="text" name="tags" maxlength="140" value="${this.esc((pack.tags || []).join(', '))}"></label>
          <label class="up-field"><span class="up-label">Showcase video (YouTube)</span><input type="url" name="showcaseUrl" maxlength="500" value="${this.esc(pack.showcaseUrl)}"></label>
          <div class="up-icon-row">
            <label class="up-icon-pick" aria-label="Replace icon">
              <input type="file" name="icon" accept="image/png,image/jpeg,image/webp" data-preview>
              <span class="up-icon-preview">${pack.thumbnail ? `<img src="${this.esc(pack.thumbnail)}" alt="">` : '<i class="fas fa-image" aria-hidden="true"></i>'}</span>
            </label>
            <p class="up-help">Any change here is checked automatically again before it shows. This usually takes under a minute.</p>
          </div>
          <p class="up-error hidden" role="alert"></p>
          <div class="up-actions"><button type="submit" class="up-btn up-btn-primary"><i class="fas fa-check" aria-hidden="true"></i> Save changes</button></div>
        </form>

        <form class="up-drawer up-form hidden" data-drawer="version" data-form="version" data-pack="${pack.id}">
          <div class="up-row">
            <label class="up-field"><span class="up-label">Pack file</span><input type="file" name="file" accept=".mcpack,.mcaddon,.brarchive,.mcworld,.mctemplate,.zip"></label>
            <label class="up-field"><span class="up-label">Version</span><input type="text" name="version" maxlength="20" placeholder="1.1.0"></label>
          </div>
          <label class="up-field"><span class="up-label">What changed</span><textarea name="changelog" rows="2" maxlength="2000"></textarea></label>
          <p class="up-error hidden" role="alert"></p>
          <div class="up-actions"><button type="submit" class="up-btn up-btn-primary"><i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload version for review</button></div>
        </form>

        <ul class="up-versions">${versions}</ul>
      </article>`;
  }

  // ===== Review log (owner only) =====

  renderQueue() {
    const list = document.getElementById('up-queue-list');
    if (!this.queue.length) {
      list.innerHTML = `<div class="up-empty"><i class="fas fa-robot" aria-hidden="true"></i><p>Nothing yet. Every upload is approved or rejected by the AI automatically, and shows up here.</p></div>`;
      return;
    }
    const needs = this.queue.filter(p => this.needsYou(p));
    const done = this.queue.filter(p => !this.needsYou(p));
    list.innerHTML =
      (needs.length
        ? `<h3 class="up-section">Waiting <span class="up-muted">(the AI couldn't finish these)</span></h3>${needs.map(p => this.queueItem(p)).join('')}`
        : '<div class="up-empty up-empty-slim"><i class="fas fa-circle-check" aria-hidden="true"></i><p>Nothing is waiting. The AI is handling everything.</p></div>')
      + (done.length ? `<h3 class="up-section">Recent automatic decisions <span class="up-muted">(you can override any of them)</span></h3>${done.map(p => this.queueItem(p)).join('')}` : '');
  }

  queueItem(pack) {
    const pendingVersions = pack.versions.filter(v => v.status === 'pending');
    const newPack = pack.status === 'pending';
    const versionRows = (newPack || !pendingVersions.length ? pack.versions : pendingVersions).slice(0, 6).map(v => `
      <li>
        <span class="up-mono">v${this.esc(v.version)}</span>
        <span class="up-muted">${this.esc(v.fileName)} · ${this.esc(v.size)}</span>
        ${this.statusChip(v.status, v.reviewNote)}
        <button type="button" class="up-link-btn" data-act="fetch-file" data-url="${this.esc(v.downloadUrl)}" data-name="${this.esc(v.fileName)}"><i class="fas fa-download" aria-hidden="true"></i> Download to check</button>
        ${v.changelog ? `<p class="up-muted">${this.esc(v.changelog)}</p>` : ''}
      </li>`).join('');
    return `
      <article class="up-item" data-pack="${pack.id}">
        <div class="up-item-head">
          <span class="up-item-icon">${this.iconHtml(pack)}</span>
          <div class="up-item-title">
            <h3>${this.esc(pack.name)}</h3>
            <p class="up-muted">by ${this.esc(pack.author)} · ${this.esc(this.lib.capitalizeFirst(pack.category))}</p>
          </div>
          ${this.statusChip(pack.checking ? 'checking' : pack.status, pack.reviewNote)}
        </div>
        <p class="up-desc">${this.esc(pack.description)}</p>
        ${pack.tags && pack.tags.length ? `<div class="up-pills">${pack.tags.map(t => `<span class="up-pill">${this.esc(t)}</span>`).join('')}</div>` : ''}
        ${pack.reviewNote ? `<p class="up-note">${this.esc(pack.reviewNote)}</p>` : ''}
        ${this.aiBlock(pack)}
        <ul class="up-versions">${versionRows}</ul>
        <form class="up-review" data-form="review-pack" data-pack="${pack.id}">
          <input type="text" name="note" maxlength="500" placeholder="${newPack ? 'Reason, if not approving' : 'Reason, if overriding to reject'}">
          <button type="submit" class="up-btn up-btn-primary" name="action" value="approve"><i class="fas fa-check" aria-hidden="true"></i> Approve${newPack ? '' : ' anyway'}</button>
          <button type="submit" class="up-btn up-btn-danger" name="action" value="reject"><i class="fas fa-xmark" aria-hidden="true"></i> ${newPack ? 'Reject' : 'Take down'}</button>
          <p class="up-error hidden" role="alert"></p>
        </form>
      </article>`;
  }

  // What the AI reviewer said, for the review log.
  aiBlock(pack) {
    const rerun = `<button type="button" class="up-link-btn" data-act="rerun-ai" data-pack="${pack.id}"><i class="fas fa-rotate-right" aria-hidden="true"></i> Check again</button>`;
    if (pack.checking) {
      return `<div class="up-ai up-ai-running"><p class="up-ai-head"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> AI check running…</p></div>`;
    }
    const ai = pack.ai;
    if (!ai) return `<div class="up-ai"><p class="up-ai-head"><i class="fas fa-robot" aria-hidden="true"></i> No AI check yet. ${rerun}</p></div>`;
    const labels = {
      approve: 'Approved', reject: 'Rejected', human: 'Unsure',
      skipped: 'AI not set up', error: 'Check failed, retrying'
    };
    const pct = ['approve', 'reject'].includes(ai.verdict) ? ` · ${Math.round((ai.confidence || 0) * 100)}% sure` : '';
    const issues = (ai.issues || []).length
      ? `<ul>${ai.issues.map(i => `<li>${this.esc(i)}</li>`).join('')}</ul>` : '';
    return `
      <div class="up-ai up-ai-${this.esc(ai.verdict)}">
        <p class="up-ai-head"><i class="fas fa-robot" aria-hidden="true"></i> <b>AI: ${labels[ai.verdict] || this.esc(ai.verdict)}</b>${pct} ${rerun}</p>
        ${ai.summary ? `<p>${this.esc(ai.summary)}</p>` : ''}
        ${issues}
      </div>`;
  }

  // ===== List actions =====

  async onListClick(e) {
    const input = e.target.closest('input[data-preview]');
    if (input) {
      if (!input._bound) {
        input._bound = true;
        input.addEventListener('change', () => this.previewIcon(input.files[0], input.parentElement.querySelector('.up-icon-preview')));
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = btn.closest('.up-item');
    const act = btn.dataset.act;

    if (act === 'goto-new') {
      this.switchTab('new');
    } else if (act === 'toggle') {
      const drawer = item.querySelector(`[data-drawer="${btn.dataset.target}"]`);
      const opening = drawer.classList.contains('hidden');
      item.querySelectorAll('.up-drawer').forEach(d => d.classList.add('hidden'));
      item.querySelectorAll('[data-act="toggle"]').forEach(b => b.classList.remove('active'));
      if (opening) {
        drawer.classList.remove('hidden');
        btn.classList.add('active');
      }
    } else if (act === 'view') {
      const pack = this.lib.packs.find(p => p.id === Number(btn.dataset.pack));
      if (pack) {
        window.router.show('library', { push: false });
        this.lib.showDetail(pack);
      } else {
        this.lib.showToast('It will show in the library after a refresh.');
      }
    } else if (act === 'recheck') {
      await this.run(btn, async () => {
        const res = await this.api(`/api/community/packs/${btn.dataset.pack}/recheck`, { method: 'POST' });
        this._polls = 0;
        this.replaceMine(res.pack);
        this.lib.showToast('Checking again…');
      });
    } else if (act === 'delete') {
      const pack = this.mine.find(p => p.id === Number(btn.dataset.pack));
      if (!pack || !confirm(`Delete "${pack.name}" and all its versions? This can't be undone.`)) return;
      await this.run(btn, async () => {
        await this.api(`/api/community/packs/${pack.id}`, { method: 'DELETE' });
        this.mine = this.mine.filter(p => p.id !== pack.id);
        this.render();
        this.refreshLibrary();
        this.lib.showToast(`${pack.name} was deleted.`);
      });
    } else if (act === 'delete-version') {
      if (!confirm('Remove this version? This can\'t be undone.')) return;
      await this.run(btn, async () => {
        const res = await this.api(`/api/community/versions/${btn.dataset.version}`, { method: 'DELETE' });
        this.replaceMine(res.pack);
        this.refreshLibrary();
      });
    } else if (act === 'rerun-ai') {
      await this.run(btn, async () => {
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Checking…';
        await this.api(`/api/community/packs/${btn.dataset.pack}/recheck`, { method: 'POST' });
        const [queue, mine] = await Promise.all([this.api('/api/community/queue'), this.api('/api/community/mine')]);
        this.queue = queue.packs || [];
        this.mine = mine.packs || [];
        this.render();
        this.refreshLibrary();
      });
    } else if (act === 'fetch-file') {
      // Pending files need the session token, so fetch then save as a file.
      await this.run(btn, async () => {
        const res = await fetch(btn.dataset.url, { headers: { Authorization: `Bearer ${this.token()}` } });
        if (!res.ok) throw new Error('Could not download that file.');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = btn.dataset.name || 'pack.mcpack';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      });
    }
  }

  async onListSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const errorEl = form.querySelector('.up-error');
    errorEl.classList.add('hidden');
    const submitter = e.submitter || form.querySelector('[type="submit"]');
    const fail = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };

    try {
      if (form.dataset.form === 'edit') {
        const data = new FormData();
        for (const k of ['name', 'category', 'description', 'tags', 'showcaseUrl']) {
          data.append(k, form.elements[k].value.trim());
        }
        const icon = form.elements.icon.files[0];
        if (icon) data.append('icon', icon);
        await this.run(submitter, async () => {
          const res = await this.api(`/api/community/packs/${form.dataset.pack}`, { method: 'PATCH', body: data });
          this._polls = 0;
          this.replaceMine(res.pack);
          this.refreshLibrary();
          this.lib.showToast(res.sentForReview ? 'Saved. The changes are being checked before they go live.' : 'Saved.');
        });
      } else if (form.dataset.form === 'version') {
        const file = form.elements.file.files[0];
        if (!file) return fail('Choose the new pack file.');
        if (!form.elements.version.value.trim()) return fail('Enter the new version number.');
        const data = new FormData();
        data.append('file', file);
        data.append('version', form.elements.version.value.trim());
        data.append('changelog', form.elements.changelog.value.trim());
        await this.run(submitter, async () => {
          const res = await this.upload(`/api/community/packs/${form.dataset.pack}/versions`, data);
          if (this.isAdmin) this.queue = (await this.api('/api/community/queue')).packs || [];
          this._polls = 0;
          this.replaceMine(res.pack);
          this.lib.showToast('New version sent for checking.');
        });
      } else if (form.dataset.form === 'review-pack' || form.dataset.form === 'review-version') {
        const action = submitter && submitter.value;
        const note = form.elements.note.value.trim();
        if (action === 'reject' && !note) return fail('Add a reason so the uploader knows what to fix.');
        const path = form.dataset.form === 'review-pack'
          ? `/api/community/packs/${form.dataset.pack}/review`
          : `/api/community/versions/${form.dataset.version}/review`;
        await this.run(submitter, async () => {
          await this.api(path, { method: 'POST', json: { action, note } });
          const [queue, mine] = await Promise.all([this.api('/api/community/queue'), this.api('/api/community/mine')]);
          this.queue = queue.packs || [];
          this.mine = mine.packs || [];
          this.render();
          this.refreshLibrary();
          this.lib.showToast(action === 'approve' ? 'Approved. It is live now.' : 'Rejected. The uploader can see your reason.');
        });
      }
    } catch (err) {
      fail(err.message);
    }
  }

  replaceMine(pack) {
    const i = this.mine.findIndex(p => p.id === pack.id);
    if (i === -1) this.mine.unshift(pack); else this.mine[i] = pack;
    this.render();
  }

  // Disables a button while its request runs; errors surface in the nearest form or a toast.
  async run(btn, fn) {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      const form = btn && btn.closest('form');
      const errorEl = form && form.querySelector('.up-error');
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      } else {
        this.lib.showToast(err.message);
      }
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  // Re-pulls approved community packs so the library matches without a reload.
  async refreshLibrary() {
    this.lib.mergeCommunityPacks(await this.lib.loadCommunityPacks({ fresh: true }));
  }

  // ===== Helpers =====

  esc(value) {
    return this.lib.escapeHtml(value == null ? '' : String(value));
  }

  formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

(function bootUploads() {
  const start = () => {
    if (!window.packLibrary) return false;
    window.uploadsPage = new UploadsPage(window.packLibrary);
    // The router may already be on /upload from the initial route.
    if (document.getElementById('page-upload').classList.contains('active')) window.uploadsPage.open();
    return true;
  };
  if (!start()) document.addEventListener('DOMContentLoaded', start, { once: true });
})();
