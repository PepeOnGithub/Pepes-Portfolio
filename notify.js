// Notifications: a bell in the header (left rail on desktop, top bar on phones) with an
// unread count, and a panel listing new followers, new packs from people you follow, and
// your own packs going live or being turned down. Unread messages show as the top row.
// Data comes from the uploads worker (worker/src/notifications.js).

const NOTIF_POLL_MS = 60000;

class Notifications {
  constructor(lib) {
    this.lib = lib;
    this.btn = document.getElementById('notif-btn');
    this.badge = document.getElementById('notif-badge');
    this.panel = document.getElementById('notif-panel');
    this.scrim = document.getElementById('notif-scrim');
    this.list = document.getElementById('notif-list');
    this.unread = 0;

    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.scrim.addEventListener('click', () => this.close());
    document.getElementById('notif-close').addEventListener('click', () => this.close());
    document.getElementById('notif-readall').addEventListener('click', () => this.markAll());
    this.list.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('click', (e) => {
      if (!this.panel.classList.contains('hidden') && !e.target.closest('#notif-panel, #notif-btn')) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.classList.contains('hidden')) { this.close(); this.btn.focus(); }
    });

    const render = lib.renderAuthUI.bind(lib);
    lib.renderAuthUI = (...args) => {
      const out = render(...args);
      this.sync();
      return out;
    };
    setInterval(() => { if (!document.hidden) this.refreshCount(); }, NOTIF_POLL_MS);
    this.sync();
  }

  esc(v) { return this.lib.escapeHtml(v == null ? '' : String(v)); }
  signedIn() { return !!this.lib.currentUser; }

  async api(path, method = 'GET') {
    const headers = {};
    const token = this.lib.getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${UPLOADS_API}${path}`, { method, headers });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  sync() {
    this.btn.classList.toggle('hidden', !this.signedIn());
    if (!this.signedIn()) { this.close(); this.setCount(0); return; }
    this.refreshCount();
  }

  async refreshCount() {
    if (!this.signedIn()) return;
    try { this.setCount((await this.api('/api/community/notifications/unread')).unread); } catch (e) { /* keep last count */ }
  }

  setCount(n) {
    this.unread = n;
    this.badge.textContent = n > 99 ? '99+' : String(n);
    this.badge.classList.toggle('hidden', !n);
    this.btn.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  }

  isOpen() { return !this.panel.classList.contains('hidden'); }
  toggle() { if (this.isOpen()) this.close(); else this.open(); }

  close() {
    this.panel.classList.add('hidden');
    this.scrim.classList.add('hidden');
    this.btn.setAttribute('aria-expanded', 'false');
  }

  async open() {
    if (!this.signedIn()) return;
    this.panel.classList.remove('hidden');
    this.scrim.classList.remove('hidden');
    this.btn.setAttribute('aria-expanded', 'true');
    if (window.mobileNav) window.mobileNav.close();
    if (!this.list.querySelector('.notif-item')) this.list.innerHTML = this.skeleton();
    try {
      const data = await this.api('/api/community/notifications');
      this.render(data.notifications);
      if (data.unread) {
        // The list keeps showing what was new; the count clears.
        this.api('/api/community/notifications/read', 'POST').then(() => this.setCount(0)).catch(() => {});
      }
    } catch (e) {
      this.list.innerHTML = `<p class="notif-empty">${this.esc(e.message)}</p>`;
    }
  }

  async markAll() {
    try {
      await this.api('/api/community/notifications/read', 'POST');
      this.setCount(0);
      this.list.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
    } catch (e) { this.lib.showToast(e.message); }
  }

  skeleton() {
    return '<div role="status" aria-label="Loading notifications">' + [0, 1, 2].map(i => `
      <div class="sk-row"><span class="sk sk-circle" style="width:40px;height:40px"></span>
      <span class="sk-stack"><span class="sk sk-line" style="width:${70 - i * 12}%"></span><span class="sk sk-line" style="width:30%"></span></span></div>`).join('') + '</div>';
  }

  when(iso) { return window.social ? window.social.when(iso) : ''; }

  describe(n) {
    const who = n.actor ? `<b>${this.esc(n.actor.name)}</b>` : 'Someone';
    switch (n.type) {
      case 'follow': return { icon: 'fa-user-plus', html: `${who} started following you`, go: () => this.profile(n.actor) };
      case 'new_pack': return { icon: 'fa-box-open', html: `${who} published <b>${this.esc(n.packName || 'a new pack')}</b>`, go: () => this.pack(n.packSlug) };
      case 'pack_approved': return { icon: 'fa-circle-check', tone: 'good', html: `Your pack <b>${this.esc(n.packName)}</b> is live in the library`, go: () => this.pack(n.packSlug) };
      case 'pack_rejected': return { icon: 'fa-circle-exclamation', tone: 'bad', html: `Your pack <b>${this.esc(n.packName)}</b> wasn't approved${n.note ? `<small>${this.esc(n.note)}</small>` : ''}`, go: () => window.router.show('upload') };
      default: return { icon: 'fa-bell', html: 'Something happened', go: () => {} };
    }
  }

  render(items) {
    const msgs = (window.social && window.social.unread) || 0;
    const msgRow = msgs ? `
      <button type="button" class="notif-item unread" data-act="messages">
        <span class="notif-icon"><i class="fas fa-paper-plane" aria-hidden="true"></i></span>
        <span class="notif-text"><span class="notif-line">You have <b>${msgs}</b> unread message${msgs === 1 ? '' : 's'}</span></span>
      </button>` : '';
    this._items = items;
    const rows = items.map((n, i) => {
      const d = this.describe(n);
      const art = n.actor && n.type !== 'pack_approved' && n.type !== 'pack_rejected'
        ? (window.social ? window.social.avatar(n.actor, 'notif-avatar') : '')
        : `<span class="notif-icon${d.tone ? ' ' + d.tone : ''}"><i class="fas ${d.icon}" aria-hidden="true"></i></span>`;
      return `
        <button type="button" class="notif-item${n.read ? '' : ' unread'}" data-i="${i}">
          ${art}
          <span class="notif-text"><span class="notif-line">${d.html}</span><time datetime="${this.esc(n.createdAt)}">${this.esc(this.when(n.createdAt))}</time></span>
        </button>`;
    }).join('');
    this.list.innerHTML = (msgRow + rows) ||
      '<p class="notif-empty"><i class="far fa-bell" aria-hidden="true"></i>Nothing yet. New followers, new packs from people you follow, and updates on your own packs show up here.</p>';
  }

  onClick(e) {
    const row = e.target.closest('.notif-item');
    if (!row) return;
    this.close();
    if (row.dataset.act === 'messages') { if (window.social) window.social.openPanel(); return; }
    const n = this._items[Number(row.dataset.i)];
    if (n) this.describe(n).go();
  }

  profile(actor) {
    if (actor) this.lib.showUserProfile(actor.username || actor.id);
  }

  async pack(slug) {
    const lib = this.lib;
    if (!slug) { window.router.show('library'); return; }
    await Promise.resolve(lib.communityReady);
    const pack = (lib.packs || []).find(p => lib.packSlug(p) === slug);
    window.router.show('library', { push: false });
    if (pack) lib.showDetail(pack); else window.router.show('library');
  }
}

(function bootNotifications() {
  const start = () => {
    if (!window.packLibrary) return false;
    window.notifications = new Notifications(window.packLibrary);
    return true;
  };
  if (!start()) document.addEventListener('DOMContentLoaded', start, { once: true });
})();
