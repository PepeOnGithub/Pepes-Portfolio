// Phone navigation, modelled on Instagram / TikTok / YouTube:
//   - bottom tabs: Home, Library, "+" (Upload), Customize, You
//   - top bar: search and messages
//   - "You" opens a sheet with your account, messages, the other pages,
//     appearance and sign-in. It replaces the header account menu on phones,
//     so anything that clicks #auth-login-btn to ask for sign-in opens it.
// Desktop keeps the left rail and the account pill; none of this shows there.

class MobileNav {
  constructor(lib) {
    this.lib = lib;
    this.mq = window.matchMedia('(max-width: 768px)');
    this.sheet = document.getElementById('mobile-you-sheet');
    this.panel = document.getElementById('mobile-you-panel');
    this.btn = document.getElementById('mobile-you-btn');
    this.page = 'home';
    this.viewingId = null;

    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.sheet.addEventListener('click', (e) => { if (e.target === this.sheet) this.close(); });
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) { this.close(); this.btn.focus(); }
    });

    document.getElementById('top-search-btn').addEventListener('click', () => this.openSearch());
    document.getElementById('top-dm-btn').addEventListener('click', () => window.social && window.social.openPanel());

    // Sign-in requests from anywhere (Follow, Upload, comments) open the sheet on phones.
    document.getElementById('auth-login-btn').addEventListener('click', () => {
      if (!this.mq.matches) return;
      document.getElementById('auth-login-menu').classList.add('hidden');
      this.open();
    });

    // Keep the avatar, messages button and sheet in step with the account.
    const render = this.lib.renderAuthUI.bind(this.lib);
    this.lib.renderAuthUI = (...args) => {
      const out = render(...args);
      this.renderAccount();
      return out;
    };
    const showProfile = this.lib.showUserProfile.bind(this.lib);
    this.lib.showUserProfile = (userId, opts) => {
      this.viewingId = String(userId);
      const out = showProfile(userId, opts);
      this.onPage('user');
      return out;
    };
    this.renderAccount();
  }

  isOpen() { return !this.sheet.hidden; }

  open() {
    this.renderPanel();
    this.sheet.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    this.btn.classList.add('open');
    const first = this.panel.querySelector('button, a');
    if (first) first.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen()) return;
    this.sheet.hidden = true;
    this.adding = false;
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.classList.remove('open');
  }

  toggle() { if (this.isOpen()) this.close(); else this.open(); }

  // Called by the router on every page change (null for 404 / download pages).
  onPage(pageId) {
    this.page = pageId;
    this.close();
    const me = this.lib.currentUser;
    const ownProfile = pageId === 'user' && me && [String(me.id), String(me.username || '')].includes(this.viewingId);
    const youPages = ['projects', 'socials', 'stats', 'settings'];
    this.btn.classList.toggle('active', !!ownProfile || youPages.includes(pageId));
  }

  openSearch() {
    if (window.router) window.router.show('library');
    const input = document.getElementById('search-input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  esc(v) { return this.lib.escapeHtml(v == null ? '' : String(v)); }

  renderAccount() {
    const me = this.lib.currentUser;
    const icon = document.getElementById('mobile-you-icon');
    icon.innerHTML = me
      ? `<img src="${this.esc(me.avatarUrl || 'assets/pepe-profile.png')}" alt="" class="mobile-you-avatar">`
      : '<i class="fas fa-circle-user" aria-hidden="true"></i>';
    document.getElementById('top-dm-btn').classList.toggle('hidden', !me);
    if (this.isOpen()) this.renderPanel();
  }

  renderPanel() {
    const me = this.lib.currentUser;
    const unread = (window.social && window.social.unread) || 0;
    const dark = !document.body.classList.contains('light-mode');
    const item = (action, icon, label, extra = '') =>
      `<button type="button" class="you-row" data-act="${action}"><i class="fas ${icon}" aria-hidden="true"></i><span>${label}</span>${extra}</button>`;
    const page = (id, icon, label) =>
      `<a href="#" class="mobile-more-link${this.page === id ? ' active' : ''}" data-page-link="${id}"><i class="fas ${icon}" aria-hidden="true"></i><span>${label}</span></a>`;

    let account;
    if (me && !this.adding) {
      const token = this.lib.getSessionToken();
      const others = this.lib.getAccounts().filter(a => a.token !== token);
      account = `
        <button type="button" class="you-head" data-act="profile">
          <img src="${this.esc(me.avatarUrl || 'assets/pepe-profile.png')}" alt="" class="you-head-avatar">
          <span class="you-head-text"><b>${this.esc(me.name || me.username || 'You')}</b><small>${me.username ? `@${this.esc(me.username)}` : 'View your profile'}</small></span>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>
        <div class="you-group">
          ${item('messages', 'fa-paper-plane', 'Messages', unread ? `<span class="dm-badge">${unread > 99 ? '99+' : unread}</span>` : '')}
          ${item('edit', 'fa-user-pen', 'Edit profile')}
          ${item('stats', 'fa-chart-line', 'Your stats and earnings')}
        </div>
        <div class="you-group">
          ${others.map(a => `<button type="button" class="you-row" data-switch="${this.esc(a.token)}">
              <img src="${this.esc(a.user.avatarUrl || 'assets/pepe-profile.png')}" alt="" class="you-row-avatar">
              <span>Switch to ${this.esc(a.user.name || a.user.username || 'account')}</span></button>`).join('')}
          ${item('add', 'fa-plus', 'Add account')}
          ${item('logout', 'fa-right-from-bracket', 'Sign out')}
        </div>`;
    } else {
      account = `
        <div class="you-signin">
          <p class="you-signin-title">${me ? 'Add another account' : 'Sign in to follow creators, message and upload'}</p>
          <button type="button" class="you-provider" data-act="google"><i class="fab fa-google" aria-hidden="true"></i> Continue with Google</button>
          <button type="button" class="you-provider" data-act="github"><i class="fab fa-github" aria-hidden="true"></i> Continue with GitHub</button>
          <button type="button" class="you-provider" data-act="email"><i class="fas fa-envelope" aria-hidden="true"></i> Continue with Email</button>
          <p class="you-legal-note">By continuing you agree to the <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy Policy</a> and confirm you are 13 or older.</p>
        </div>`;
    }

    this.panel.innerHTML = `
      <span class="you-grabber" aria-hidden="true"></span>
      ${account}
      <div class="you-pages">
        ${page('projects', 'fa-diagram-project', 'Projects')}
        ${page('socials', 'fa-share-nodes', 'Socials')}
        ${page('stats', 'fa-chart-simple', 'Stats')}
        ${page('settings', 'fa-gear', 'Settings')}
      </div>
      <div class="you-group">
        ${item('theme', dark ? 'fa-sun' : 'fa-moon', dark ? 'Light mode' : 'Dark mode')}
      </div>
      <p class="mobile-more-legal">
        <a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="guidelines.html">Guidelines</a><a href="copyright.html">Copyright</a>
      </p>`;
  }

  onPanelClick(e) {
    const pageLink = e.target.closest('[data-page-link]');
    if (pageLink) {
      e.preventDefault();
      this.close();
      window.router.show(pageLink.dataset.pageLink);
      return;
    }
    const sw = e.target.closest('[data-switch]');
    if (sw) { this.close(); this.lib.switchAccount(sw.dataset.switch); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const click = (id) => document.getElementById(id).click();
    if (act !== 'theme') this.close();
    switch (act) {
      case 'profile': click('auth-view-profile-btn'); break;
      case 'messages': if (window.social) window.social.openPanel(); break;
      case 'edit': this.lib.openProfileModal(); break;
      case 'stats':
        window.router.show('stats');
        setTimeout(() => document.querySelector('[data-stats-view="creator"]')?.click(), 50);
        break;
      case 'add': this.adding = true; this.open(); break;
      case 'google': this.lib.startLogin('google'); break;
      case 'github': this.lib.startLogin('github'); break;
      case 'email': this.lib.openEmailAuthModal(); break;
      case 'logout': click('auth-logout-btn'); break;
      case 'theme': this.lib.toggleTheme(); this.renderPanel(); break;
    }
  }
}

// Hover text: quick, styled tooltips (Discord-style) instead of the browser's slow
// native ones. Uses each element's title (moved to data-tip so the native one
// doesn't also appear). Mouse hover and keyboard focus only; touch skips it.
(function tooltips() {
  const SEL = '[data-tip], button[title], a[title], span[title], label[title]';
  let tip = null, current = null, timer = null;
  const take = (el) => {
    if (el.hasAttribute('title')) {
      const t = el.getAttribute('title');
      el.removeAttribute('title');
      if (!t) return '';
      el.dataset.tip = t;
      if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
    }
    return el.dataset.tip || '';
  };
  const hide = () => {
    clearTimeout(timer);
    current = null;
    if (tip) tip.classList.remove('show');
  };
  const show = (el) => {
    const text = take(el);
    if (!text) return;
    current = el;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (current !== el || !el.isConnected) return;
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'ui-tip';
        tip.setAttribute('role', 'tooltip');
        document.body.append(tip);
      }
      tip.textContent = text;
      const r = el.getBoundingClientRect();
      tip.classList.add('show');
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let top = r.top - h - 8, below = false;
      if (top < 8) { top = r.bottom + 8; below = true; }
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
      tip.classList.toggle('below', below);
    }, 250);
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest(SEL);
    if (el && el !== current) show(el);
    else if (!el && current) hide();
  });
  document.addEventListener('pointerout', (e) => {
    if (current && !current.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest(SEL);
    if (el && el.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', hide);
  ['scroll', 'pointerdown', 'keydown'].forEach(t => window.addEventListener(t, hide, { passive: true, capture: true }));
})();

(function bootMobileNav() {
  const start = () => {
    if (!window.packLibrary) return false;
    window.mobileNav = new MobileNav(window.packLibrary);
    return true;
  };
  if (!start()) document.addEventListener('DOMContentLoaded', start, { once: true });
})();
