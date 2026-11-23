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
      this.syncComments();
      this.renderAccount();
      this.renderSettingsAccount();
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
    this.renderSettingsAccount();
  }

  // Sign-in can finish after a pack page has loaded: keep the comment box and the "sign in" note in step.
  syncComments() {
    const me = this.lib.currentUser;
    document.getElementById('comment-form')?.classList.toggle('hidden', !me);
    document.getElementById('comments-signed-out-note')?.classList.toggle('hidden', !!me);
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

  // Account card at the top of Settings (name, username, edit profile, sign out).
  renderSettingsAccount() {
    const box = document.getElementById('settings-account');
    if (!box) return;
    const me = this.lib.currentUser;
    if (!me) {
      box.innerHTML = `<div class="sa-card"><span class="sa-text"><b>You're not signed in</b><small>Sign in to follow creators, message and upload.</small></span><button type="button" class="sa-btn sa-primary" data-sa="signin">Sign in</button></div>`;
    } else {
      box.innerHTML = `<div class="sa-card">
        <img class="sa-avatar" src="${this.esc(me.avatarUrl || 'assets/pepe-profile.png')}" alt="">
        <span class="sa-text"><b>${this.esc(me.name || me.username || 'You')}</b><small>${me.username ? '@' + this.esc(me.username) : 'No username yet'}</small></span>
        <button type="button" class="sa-btn" data-sa="edit">Edit profile</button>
        <button type="button" class="sa-btn sa-danger" data-sa="logout">Sign out</button></div>`;
    }
    box.hidden = false;
    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sa]');
        if (!b) return;
        if (b.dataset.sa === 'edit') this.lib.openProfileModal();
        else if (b.dataset.sa === 'logout') document.getElementById('auth-logout-btn').click();
        else if (this.mq.matches) this.open();
        else document.getElementById('auth-login-btn').click();
      });
    }
  }

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

// Profile tabs (Packs / Videos / Comments): only the chosen section shows, and a tab
// exists only for sections that have content. The sections keep their own hidden
// state (set when creator data loads); tabs just add .tab-off to the others.
(function profileTabs() {
  const SECTIONS = [
    ['packs', 'Packs', 'user-profile-packs-block', 'fa-cube'],
    ['videos', 'Videos', 'user-profile-videos-block', 'fa-circle-play'],
    ['comments', 'Comments', null, 'fa-comment']
  ];
  let current = null, wired = false;
  const commentsBlock = () => document.getElementById('user-profile-comments')?.closest('.versions-block');
  const block = (id, i) => (i === 2 ? commentsBlock() : document.getElementById(id));
  const has = (id, i) => { const el = block(id, i); return !!el && !el.classList.contains('hidden'); };

  function render() {
    const bar = document.getElementById('user-profile-tabs');
    const page = document.getElementById('page-user');
    if (!bar) return;
    // Videos is always a tab (an empty one says so); Packs only when there are packs.
    const avail = SECTIONS.filter(([k, , id], i) => k === 'videos' || has(id, i));
    if (!avail.some(([k]) => k === current)) current = (SECTIONS.find(([, , id], i) => has(id, i)) || avail[0])[0];
    const html = avail.map(([k, label, , icon]) =>
      `<button type="button" role="tab" class="up-tab-btn${k === current ? ' active' : ''}" aria-selected="${k === current}" data-tab="${k}"><i class="fas ${icon}" aria-hidden="true"></i> ${label}</button>`).join('');
    if (bar.dataset.html !== html) { bar.dataset.html = html; bar.innerHTML = html; } // no rewrite = no observer loop
    bar.classList.remove('hidden');
    SECTIONS.forEach(([k, , id], i) => block(id, i)?.classList.toggle('tab-off', k !== current));
    document.getElementById('user-profile-sk')?.classList.toggle('tab-off', current === 'comments');
    const empty = document.getElementById('user-profile-videos-empty');
    if (empty) {
      const lib = window.packLibrary;
      const mine = lib && lib.currentUser && lib.viewedProfile && String(lib.currentUser.id) === String(lib.viewedProfile.id);
      const text = mine ? 'No featured videos yet. Add YouTube videos under Edit profile.' : 'No videos yet.';
      if (empty.dataset.t !== text) { empty.dataset.t = text; empty.innerHTML = `<i class="fas fa-circle-play" aria-hidden="true"></i><span>${text}</span>`; }
      empty.classList.toggle('hidden', !(current === 'videos' && !has('user-profile-videos-block', 1) && !page.classList.contains('up-sections-loading')));
    }
  }

  function start() {
    const page = document.getElementById('page-user');
    if (!page || wired) return;
    wired = true;
    const bar = document.getElementById('user-profile-tabs');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) { current = b.dataset.tab; render(); }
    });
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; render(); });
    }).observe(page, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// Upload form as three steps (Choose file, Details, Publish) with a live preview of the
// library card. Fields keep their names and ids; steps only show/hide them.
(function uploadSteps() {
  function start() {
    const form = document.getElementById('up-form');
    if (!form) return;
    const lib = () => window.packLibrary;
    const fileIn = document.getElementById('up-file');
    const iconIn = document.getElementById('up-icon');
    const nameIn = form.elements.name;
    const catIn = form.elements.category;
    const back = document.getElementById('up-step-back');
    const next = document.getElementById('up-step-next');
    const toast = (m) => (lib() && lib().showToast ? lib().showToast(m) : alert(m));
    let step = 1, iconUrl = null;

    function problem(n) {
      if (n >= 2 && !(fileIn.files && fileIn.files.length)) return 'Choose your pack file first.';
      if (n >= 3 && !nameIn.value.trim()) return 'Give your pack a name.';
      return '';
    }
    function go(n) {
      n = Math.max(1, Math.min(3, n));
      if (n > step) { const msg = problem(n); if (msg) { toast(msg); return; } }
      step = n;
      form.dataset.stepNow = String(n);
      form.querySelectorAll('[data-step]').forEach(el => { el.hidden = Number(el.dataset.step) !== n; });
      form.querySelectorAll('#up-stepper [data-goto]').forEach(b => {
        const k = Number(b.dataset.goto);
        b.parentElement.className = k < n ? 'done' : (k === n ? 'current' : '');
        b.setAttribute('aria-current', k === n ? 'step' : 'false');
        b.firstElementChild.textContent = k < n ? '✓' : String(k);
      });
      back.style.visibility = n === 1 ? 'hidden' : 'visible';
      next.hidden = n === 3;
      // Hidden error/progress boxes keep their own .hidden class; [hidden] must not override a shown error on step 3.
    }
    form.querySelectorAll('#up-stepper [data-goto]').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.goto))));
    back.addEventListener('click', () => go(step - 1));
    next.addEventListener('click', () => go(step + 1));
    // Enter in a text field moves on instead of submitting early.
    form.addEventListener('submit', (e) => {
      if (step < 3) { e.preventDefault(); e.stopImmediatePropagation(); go(step + 1); }
    }, true);
    form.addEventListener('reset', () => setTimeout(() => { iconUrl && URL.revokeObjectURL(iconUrl); iconUrl = null; go(1); preview(); }, 0));

    function preview() {
      const name = nameIn.value.trim();
      document.getElementById('up-prev-name').textContent = name || 'Your pack name';
      const me = lib() && lib().currentUser;
      const cat = catIn.options[catIn.selectedIndex];
      document.getElementById('up-prev-meta').textContent = `by ${(me && (me.username || me.name)) || 'you'} · ${cat ? cat.textContent : ''}`;
      const img = document.getElementById('up-prev-icon'), ph = document.getElementById('up-prev-ph');
      img.hidden = !iconUrl; ph.hidden = !!iconUrl;
      if (iconUrl) img.src = iconUrl;
    }
    nameIn.addEventListener('input', preview);
    catIn.addEventListener('change', preview);
    iconIn.addEventListener('change', () => {
      if (iconUrl) URL.revokeObjectURL(iconUrl);
      iconUrl = iconIn.files[0] ? URL.createObjectURL(iconIn.files[0]) : null;
      preview();
    });
    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      if (f && !nameIn.value.trim()) {
        nameIn.value = f.name.replace(/\.(mcpack|mcaddon|brarchive|mcworld|mctemplate|zip)$/i, '').replace(/[_-]+/g, ' ').trim();
      }
      setTimeout(preview, 0); // after upload.js has had its turn with the file
    });
    go(1); preview();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

// Composer (comment and reply box): avatar + a text box that grows as you type, a counter,
// a button that only lights up when there is something to send, Ctrl/Cmd + Enter to send,
// and Cancel on replies. Works for any .composer on the page.
(function composers() {
  const MAX_H = 220;
  const sendBtn = (c) => c.querySelector('.composer-btn:not(.composer-cancel)');
  function refresh(ta) {
    const c = ta.closest('.composer');
    if (!c) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_H)}px`;
    const n = ta.value.length, max = ta.maxLength > 0 ? ta.maxLength : 1000;
    const count = c.querySelector('.composer-count');
    if (count) { count.textContent = `${n} / ${max}`; count.classList.toggle('near', n > max * 0.9); }
    c.classList.toggle('has-text', n > 0);
    const btn = sendBtn(c);
    if (btn) btn.disabled = !ta.value.trim();
  }
  document.addEventListener('input', (e) => { if (e.target.matches('.composer textarea')) refresh(e.target); });
  document.addEventListener('focusin', (e) => {
    const c = e.target.closest && e.target.closest('.composer');
    if (!c) return;
    const me = window.packLibrary && window.packLibrary.currentUser;
    const av = c.querySelector('.composer-avatar');
    if (me && av) av.src = me.avatarUrl || 'assets/pepe-profile.png';
  });
  document.addEventListener('keydown', (e) => {
    if (!e.target.matches || !e.target.matches('.composer textarea')) return;
    const c = e.target.closest('.composer');
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const btn = sendBtn(c);
      if (btn && !btn.disabled) btn.click();
    } else if (e.key === 'Escape' && c.classList.contains('composer-reply')) {
      c.querySelector('.composer-cancel')?.click();
    }
  });
  document.addEventListener('click', (e) => {
    const cancel = e.target.closest('.composer-cancel');
    if (!cancel) return;
    const c = cancel.closest('.composer');
    const ta = c.querySelector('textarea');
    ta.value = '';
    refresh(ta);
    c.classList.add('hidden');
  });
})();

// Settings on phones works like the Android Settings app: a home list of categories, and each category
// opens as its own page with a back arrow (the browser's back button returns to the list as well).
(function settingsNav() {
  const mq = matchMedia('(max-width: 768px)');
  let page, appbar, titleEl, searching = false;
  const label = () => { const r = page.querySelector('.category-row.active'); return (r && (r.dataset.label || r.textContent.trim())) || 'Settings'; };
  function setView(v) {
    if (!mq.matches) { delete page.dataset.stView; return; }
    page.dataset.stView = v;
    if (v === 'detail') titleEl.textContent = label();
    appbar.classList.toggle('no-reset', false);
    if (v !== 'search') window.scrollTo({ top: 0 });
  }
  function start() {
    page = document.getElementById('page-settings');
    if (!page || page.dataset.stBound) return;
    page.dataset.stBound = '1';
    appbar = document.getElementById('st-appbar'); titleEl = document.getElementById('st-appbar-title');
    setView('home');
    page.querySelectorAll('.category-row').forEach((row) => row.addEventListener('click', () => {
      if (!mq.matches) return;
      setView('detail');
      try { history.pushState({ page: 'settings', st: 'detail' }, '', '/settings'); } catch (e) { /* ignore */ }
    }));
    document.getElementById('st-back').addEventListener('click', () => {
      if (history.state && history.state.st === 'detail') history.back(); else setView('home');
    });
    document.getElementById('st-appbar-reset').addEventListener('click', () => {
      const btn = page.querySelector('.settings-panel.active [data-reset-section]'); if (btn) btn.click();
    });
    const input = document.getElementById('settings-search-input');
    if (input) input.addEventListener('input', () => {
      if (!mq.matches) return;
      if (input.value.trim()) { searching = true; setView('search'); }
      else if (searching) { searching = false; setView('home'); }
    });
    window.addEventListener('popstate', (e) => {
      if (!page.classList.contains('active')) return;
      setView(e.state && e.state.st === 'detail' ? 'detail' : (searching ? 'search' : 'home'));
    });
    mq.addEventListener('change', () => setView('home'));
    // every time the Settings page is opened it starts on the list
    if (window.router && window.router.show) {
      const show = window.router.show.bind(window.router);
      window.router.show = (id, opts) => { const out = show(id, opts); if (id === 'settings') { searching = false; if (input) input.value = ''; setView('home'); } return out; };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0)); else setTimeout(start, 0);
})();

// Settings: the Text size control (Small / Default / Large) drives the font-size slider, and on desktop the
// search sits in the page head and the account card on top of the panel (the Settings design).
(function settingsExtras() {
  const SIZES = [['Small', 90], ['Default', 100], ['Large', 115]];
  function textSize() {
    const slider = document.getElementById('font-size-slider');
    const row = slider && slider.closest('.setting-row');
    if (!row || row.dataset.segBound) return;
    row.dataset.segBound = '1';
    const seg = document.createElement('span');
    seg.className = 'st-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Text size');
    seg.innerHTML = SIZES.map(([l, v]) => `<button type="button" data-size="${v}" aria-pressed="false">${l}</button>`).join('');
    row.append(seg); row.classList.add('st-seg-on');
    const paint = () => {
      const v = Number(slider.value);
      const near = SIZES.reduce((a, b) => (Math.abs(b[1] - v) < Math.abs(a[1] - v) ? b : a));
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === near[1])));
    };
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      slider.value = b.dataset.size;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      paint();
    });
    slider.addEventListener('input', paint);
    new MutationObserver(paint).observe(slider, { attributes: true, attributeFilter: ['value'] });
    paint();
    // reset section / load can change the value without an event
    setInterval(paint, 1500);
  }
  const mq = matchMedia('(max-width: 768px)');
  function place() {
    const page = document.getElementById('page-settings'); if (!page) return;
    const search = page.querySelector('.settings-search'), account = document.getElementById('settings-account');
    const headRow = page.querySelector('.page-head-row'), main = page.querySelector('.main-content'), side = page.querySelector('.sidebar');
    if (!search || !account || !headRow || !main || !side) return;
    if (!place.home) place.home = { searchParent: search.parentElement, accountParent: account.parentElement };
    if (mq.matches) {
      if (search.parentElement !== place.home.searchParent) place.home.searchParent.append(search);
      if (account.parentElement !== place.home.accountParent) place.home.accountParent.prepend(account);
    } else {
      if (search.parentElement !== headRow) headRow.append(search);
      if (account.parentElement !== main) main.prepend(account);
    }
  }
  function start() { textSize(); place(); mq.addEventListener('change', place); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 0)); else setTimeout(start, 0);
})();
