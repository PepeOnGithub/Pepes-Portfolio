const CATEGORY_ORDER = ['packs', 'cosmetics', 'utility', 'clients', 'addons', 'apps', 'website', 'other'];

const DEFAULT_BANNER_URL = 'assets/default-banner.png';
const API_BASE = 'https://pepes-portfolio-api.pepeoncloudeflare.workers.dev';
const LINKVERTISE_USER_ID = 499358;
// Community uploads worker (worker/ in this repo). localStorage.uploadsApi
// overrides it for local testing, e.g. http://127.0.0.1:8787.
const UPLOADS_API = (() => {
  try {
    const override = localStorage.getItem('uploadsApi');
    if (override && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override)) return override;
  } catch (e) { /* storage unavailable */ }
  return 'https://pepes-portfolio-uploads.pepeoncloudeflare.workers.dev';
})();
const MONETIZATION_PROVIDER_KEY = 'monetizationProvider';

// ===== Anti link-bypasser =====
// "Link bypasser" sites/extensions let visitors skip past Linkvertise/
// LootLabs without completing them, by loading our /download/<token> gate
// themselves (usually inside an iframe, or via an automated headless-browser
// fetch) and grabbing the real file URL out of it. Both of the checks below
// only run client-side JS, so they only catch bypassers that actually render
// the page in a browser (iframe embeds, headless-browser automation) — a
// pure server-side HTTP scraper never executes this script at all and can't
// be stopped from a static site. This list is inherently a moving target;
// add newly-spotted bypasser domains here as they show up.
const BYPASS_TOOL_DOMAINS = [
  'bypass.city',
  'bypass.vip',
  'unlockcontent.net',
  'boost.ink',
  'social-unlock.com',
  'quickkey.cc',
  'key-bypasser.com',
  'linkbypass.net',
  'adfly-bypasser.com'
];

function isKnownBypassReferrer() {
  if (!document.referrer) return false;
  try {
    const host = new URL(document.referrer).hostname.toLowerCase();
    return BYPASS_TOOL_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch (e) {
    return false;
  }
}

// Bypasser sites/extensions commonly iframe the real target page so their own
// script can drive it (click through, read the resulting file URL) without
// the visitor ever seeing linkvertise/lootlabs. Break out of any frame whose
// parent isn't this same site.
(function bustFrame() {
  try {
    if (window.top !== window.self) {
      window.top.location.href = window.self.location.href;
    }
  } catch (e) {
    // Cross-origin parent blocked the navigation — fall back to hiding the
    // page content so at least nothing usable renders inside the iframe.
    document.documentElement.style.display = 'none';
  }
})();

// The Assets Pack warning is on by default. Older "Don't show again" choices are cleared
// once so everyone sees it again and gets the current Assets Pack.
try {
  if (!localStorage.getItem('assetsWarnMigrated')) {
    localStorage.removeItem('hideAssetsModal');
    localStorage.setItem('assetsWarnMigrated', '1');
  }
} catch (e) { /* storage unavailable */ }

// Every setting key persisted in localStorage. Single source of truth for
// "Reset All Settings" and for Export/Import Settings.
const SETTINGS_KEYS = [
  'darkMode', 'compactView', 'reduceMotion', 'newTabLinks', 'heroVisibility',
  'accentColor', 'monetizationProvider', 'defaultSort', 'autoplayShowcase',
  'askProviderEveryTime', 'libraryViewMode', 'showDownloadCounts',
  'collapseOldVersions', 'showDiscontinued', 'collapseSectionsByDefault',
  'collapsedSections', 'hideAssetsModal', 'fontSizeScale', 'rememberLastPage',
  'highContrastMode', 'sharpCorners', 'reduceTransparency', 'disableCardHover',
  'hideCategoryBadges', 'hideVersionTags', 'compactDescriptions', 'hideCardAuthor',
  'stickySearchBar', 'hideCategoryIcons', 'disableSmoothScroll', 'confirmExternalLinks',
  'scrollToTopOnNav', 'confirmBeforeDownload', 'copyNameOnDownload', 'openGateNewTab',
  'trackDownloadCounts', 'trackRecentlyViewed', 'recentlyViewedPacks'
];

// ===== Color conversion helpers (Theme Studio) =====
function clamp01(n) { return Math.min(1, Math.max(0, n)); }

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 72, g: 156, b: 73 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(n => n.toString(16).padStart(2, '0')).join('');
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; } else if (h < 120) { r1 = x; g1 = c; }
  else if (h < 180) { g1 = c; b1 = x; } else if (h < 240) { g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; b1 = c; } else { r1 = c; b1 = x; }
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

// Lighten (positive percent) or darken (negative) a hex color toward white/black.
function shadeHex(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

const ACCENT_PRESETS = {
  green: '#86d177',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  pink: '#ec4899',
  orange: '#f97316'
};

// Keeps a reskinned <input type="range">'s fill in sync with its value,
// since CSS has no way to read a range input's current position on its own.
function updateSliderFill(el) {
  if (!el) return;
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const value = parseFloat(el.value) || 0;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--slider-percent', `${pct}%`);
  // Settings sliders show their value ("65%") in a readout next to the track.
  const readout = el.parentElement && el.parentElement.querySelector('.setting-slider-value');
  if (readout) readout.textContent = `${Math.round(value)}%`;
}

// A boolean setting read straight from localStorage, defaulting when unset.
function getBoolSetting(key, defaultValue = false) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === 'true';
  } catch (e) {
    return defaultValue;
  }
}

// Settings that are nothing more than "toggle a body class, persist the flag".
// Declarative list so binding + load-time re-application share one code path
// instead of a hand-written listener/sync pair per setting.
const SIMPLE_TOGGLE_SETTINGS = [
  { id: 'high-contrast-toggle', key: 'highContrastMode', className: 'high-contrast' },
  { id: 'sharp-corners-toggle', key: 'sharpCorners', className: 'sharp-corners' },
  { id: 'reduce-transparency-toggle', key: 'reduceTransparency', className: 'reduce-transparency' },
  { id: 'disable-card-hover-toggle', key: 'disableCardHover', className: 'no-card-hover' },
  { id: 'hide-category-badges-toggle', key: 'hideCategoryBadges', className: 'hide-category-badges' },
  { id: 'hide-version-tags-toggle', key: 'hideVersionTags', className: 'hide-version-tags' },
  { id: 'compact-descriptions-toggle', key: 'compactDescriptions', className: 'compact-descriptions' },
  { id: 'hide-card-author-toggle', key: 'hideCardAuthor', className: 'hide-card-author' },
  { id: 'sticky-search-toggle', key: 'stickySearchBar', className: 'sticky-search' },
  { id: 'hide-category-icons-toggle', key: 'hideCategoryIcons', className: 'hide-category-icons' },
  { id: 'disable-smooth-scroll-toggle', key: 'disableSmoothScroll', className: 'no-smooth-scroll' }
];

// Settings that are just a persisted boolean flag consulted elsewhere in the
// code (no direct body-class effect of their own).
const SIMPLE_FLAG_SETTINGS = [
  { id: 'confirm-external-links-toggle', key: 'confirmExternalLinks' },
  { id: 'confirm-before-download-toggle', key: 'confirmBeforeDownload' },
  { id: 'copy-name-on-download-toggle', key: 'copyNameOnDownload' },
  { id: 'open-gate-new-tab-toggle', key: 'openGateNewTab' },
  { id: 'track-recently-viewed-toggle', key: 'trackRecentlyViewed' }
];

function isMonetizationOn() { return true; }

function getMonetizationProvider() {
  let stored = null;
  try { stored = localStorage.getItem(MONETIZATION_PROVIDER_KEY); } catch (e) { /* storage unavailable */ }
  return stored === 'lootlabs' ? 'lootlabs' : 'linkvertise';
}

// ===== Download gate tokens =====
// Monetized links never point straight at a raw .mcpack file - they point at
// our own /download/<token> page instead, which decodes the real file and
// finishes the download from there. This keeps the actual file URL out of
// the Linkvertise/LootLabs redirect chain, so a bypass tool scanning that
// chain for a recognizable download-file URL has nothing to latch onto; it
// has to actually load our page and let this script run to get the file.
function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

// t: 0 means "no expiry" (used for build-time-baked LootLabs links, which
// may legitimately be clicked long after the site was built).
function encodeDownloadToken(rawUrl, expiring) {
  return base64UrlEncode(JSON.stringify({ u: rawUrl, t: expiring ? Date.now() : 0 }));
}

const DOWNLOAD_TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

function decodeDownloadToken(token) {
  try {
    const payload = JSON.parse(base64UrlDecode(token));
    if (!payload || typeof payload.u !== 'string') return { invalid: true };
    if (payload.t && Date.now() - payload.t > DOWNLOAD_TOKEN_MAX_AGE_MS) return { expired: true };
    return { url: payload.u };
  } catch (e) {
    return { invalid: true };
  }
}

function getDownloadGateUrl(rawUrl, { expiring = true } = {}) {
  return `${location.origin}/download/${encodeDownloadToken(rawUrl, expiring)}`;
}

// userId is whose Linkvertise account earns from the click: Pepe's for his
// own packs, the uploader's own id for community packs.
function getLinkvertiseUrl(targetUrl, userId = LINKVERTISE_USER_ID) {
  if (!userId) return targetUrl;
  try {
    const gateUrl = getDownloadGateUrl(targetUrl, { expiring: true });
    const encoded = encodeURIComponent(btoa(gateUrl));
    const random = Math.random() * 1000;
    return `https://link-to.net/${userId}/${random}/dynamic/?r=${encoded}`;
  } catch (e) {
    return targetUrl;
  }
}

// lootUrl is a link pre-generated at build time (see generator.py) via the
// LootLabs content-locker API, already wrapping our /download/<token> gate
// (not the raw file) for the same anti-bypass reason as getLinkvertiseUrl.
// It can't be generated client-side without exposing a secret API token to
// every visitor, so packs without a cached lootUrl fall back to Linkvertise
// when LootLabs is selected.
// lvId: the Linkvertise account to credit. Community packs pass their
// uploader's id (or null when the uploader only uses LootLabs or no ads).
function getMonetizedUrl(targetUrl, lootUrl, forcedProvider, lvId = LINKVERTISE_USER_ID) {
  if (!targetUrl || targetUrl === '#' || !isMonetizationOn()) return targetUrl;

  const provider = forcedProvider || getMonetizationProvider();
  if (provider === 'lootlabs' && lootUrl) return lootUrl;
  if (!lvId) return lootUrl || targetUrl;

  return getLinkvertiseUrl(targetUrl, lvId);
}

class Router {
  constructor() {
    this.pages = ['home', 'projects', 'socials', 'library', 'customizer', 'settings', 'stats', 'user', 'upload'];
    this.setupNav();
    this.setupMobileNav();
  }

  setupNav() {
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.show(el.dataset.page);
      });
    });
  }

  setupMobileNav() {
    const toggle = document.getElementById('mobile-nav-toggle');
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!toggle || !drawer) return;

    const closeDrawer = () => {
      drawer.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const isOpen = drawer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    drawer.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', closeDrawer);
    });

    document.addEventListener('click', (e) => {
      if (!drawer.classList.contains('open')) return;
      if (drawer.contains(e.target) || toggle.contains(e.target)) return;
      closeDrawer();
    });
  }

  show(pageId, { push = true } = {}) {
    if (!this.pages.includes(pageId)) return;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`).classList.add('active');
    // the customizer is a full-screen editor: it covers the site chrome and the page behind it stops scrolling
    document.body.classList.toggle('cz-open', pageId === 'customizer');

    document.querySelectorAll('.topnav-link, .mobile-nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageId);
    });
    if (window.mobileNav) window.mobileNav.onPage(pageId);

    document.getElementById('main-content').focus({ preventScroll: true });
    if (getBoolSetting('scrollToTopOnNav', true)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (localStorage.getItem('rememberLastPage') === 'true') {
      localStorage.setItem('lastVisitedPage', pageId);
    }

    if (pageId === 'socials') {
      this.updateSocialsStats();
    }

    if (pageId === 'customizer') {
      this.loadCustomizer();
    }

    if (pageId === 'upload' && window.uploadsPage) {
      window.uploadsPage.open();
    }

    if (window.packLibrary) {
      window.packLibrary.showBrowse({ push: false });
      if (pageId === 'stats') window.packLibrary.renderStatsPage();
    }

    if (push) {
      history.pushState({ page: pageId }, '', pageId === 'home' ? '/' : `/${pageId}`);
    }
    document.title = "Pepe's Portfolio";
  }

  // The customizer (index.html #page-customizer) loads its scripts the first time the tab opens,
  // so visitors who never open it don't download JSZip or the settings code.
  loadCustomizer() {
    if (this.customizerLoading) return;
    this.customizerLoading = true;
    // resolveInitialRoute() strips the query (e.g. the download gate's ?unlock=1) right after this call, so the
    // customizer reads the query captured here instead of location.search
    window.czEntrySearch = location.search;
    const load = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.body.append(s);
    });
    load('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js')
      .then(() => load('customizer-ui.js'))
      .then(() => load('customizer-preview.js'))
      .then(() => load('customizer.js'))
      .then(() => window.CzBoot && window.CzBoot())
      .catch(() => {
        const info = document.getElementById('cz-pack');
        if (info) { info.textContent = 'Could not load the customizer. Check your connection and reload.'; info.classList.add('cz-error'); }
      });
  }

  updateSocialsStats() {
    // Recomputed fresh from the real calendar date on every page load - no
    // stored/incrementing value anywhere, so this only ever changes once a
    // year, on the actual birthday below, never per-day.
    const today = new Date();
    const birthDate = new Date(2008, 11, 26); // year, month (0-indexed), day
    let age = today.getFullYear() - birthDate.getFullYear();
    const hasHadBirthdayThisYear =
      today.getMonth() > birthDate.getMonth() ||
      (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
    if (!hasHadBirthdayThisYear) age--;
    const ageEl = document.getElementById('socials-age');
    if (ageEl) ageEl.textContent = age;

    // Update packs shipped count
    if (window.packLibrary && window.packLibrary.packs) {
      const packsEl = document.getElementById('socials-packs');
      if (packsEl) packsEl.textContent = window.packLibrary.packs.length;
    }
  }
}

class CustomDropdown {
  constructor(id, onSelect) {
    this.wrap = document.getElementById(id);
    if (!this.wrap) return;
    this.trigger = this.wrap.querySelector('.custom-dropdown-trigger');
    this.menu = this.wrap.querySelector('.custom-dropdown-menu');
    if (!this.trigger || !this.menu) return;
    this.label = this.trigger.querySelector('span');
    this.onSelect = onSelect;

    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.menu.querySelectorAll('li').forEach(item => {
      item.addEventListener('click', () => {
        this.select(item.dataset.value, item.textContent);
      });
    });

    document.addEventListener('click', (e) => {
      if (!this.wrap.contains(e.target)) this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  toggle() {
    const isOpen = this.menu.classList.contains('open');
    if (isOpen) this.close(); else this.open();
  }

  open() {
    this.menu.classList.add('open');
    this.trigger.classList.add('open');
    this.trigger.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.menu.classList.remove('open');
    this.trigger.classList.remove('open');
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  select(value, text) {
    this.value = value;
    this.trigger.dataset.value = value;
    this.label.textContent = text;
    this.menu.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.value === value);
    });
    this.close();
    if (this.onSelect) this.onSelect(value);
  }
}

class PackLibrary {
  constructor() {
    this.packs = [];
    this.filteredPacks = [];
    this.currentFilter = {
      search: '',
      category: localStorage.getItem('selectedCategory') || '',
      sort: localStorage.getItem('defaultSort') || 'relevance',
      tags: new Set()
    };
    this.viewMode = localStorage.getItem('libraryViewMode') === 'grid' ? 'grid' : 'list';
    this.favorites = this.loadFavorites();
    this.collapsedSections = this.loadCollapsedSections();
    this.defaultCollapseSections = localStorage.getItem('collapseSectionsByDefault') === 'true';
    this.liveDownloadCounts = new Map();
    this.inFlightDownloadFetches = new Map();
    this.downloadFetchQueue = [];
    this.activeDownloadFetches = 0;
    this.ready = this.init();
  }

  async init() {
    this.currentUser = null;
    this.captureSessionFromUrl();
    this.setupEventListeners();
    this.setupAuth();
    this.sortDropdown = new CustomDropdown('sort-dropdown', (value) => {
      this.currentFilter.sort = value;
      this.applyFilters();
    });
    this.monetizationDropdown = new CustomDropdown('monetization-provider-dropdown', (value) => {
      localStorage.setItem(MONETIZATION_PROVIDER_KEY, value);
    });
    this.defaultSortDropdown = new CustomDropdown('default-sort-dropdown', (value) => {
      localStorage.setItem('defaultSort', value);
    });
    this.setupThemeStudio();
    this.syncSortDropdownLabel();
    this.loadTheme();
    this.applyViewMode();
    await this.loadPacks();
    this.updateCategoryCounts();
    this.renderTagChips();
    this.renderClientsTimeline();
    this.syncCategorySidebar();
    this.syncSettingsCategorySidebar();
    this.applyFilters();
    this.setupFilterDropdowns();
    this.communityReady = this.communityPromise.then(list => this.mergeCommunityPacks(list));
  }

  // Adds approved community packs to the library and refreshes everything
  // that counts or lists packs. Safe to call again with a fresh list.
  mergeCommunityPacks(list) {
    if (this.packsLoadError) return;
    const hadCommunity = this.packs.some(p => p.community);
    if (!list.length && !hadCommunity) return;
    this.packs = [...this.packs.filter(p => !p.community), ...list];
    this.updateCategoryCounts();
    this.renderTagChips();
    this.renderHomeAndProjects();
    this.applyFilters();
  }

  // Categories/Tags use a <details> that's forced open on desktop (via the
  // `open` attribute in the markup) and starts collapsed on mobile, where
  // the summary becomes a real dropdown trigger. Re-applied on resize so
  // rotating a device or resizing past the breakpoint doesn't leave a
  // dropdown stuck in the wrong state.
  setupFilterDropdowns() {
    // The Settings category list is always a visible strip on phones (css/settings.css), never a collapsed dropdown.
    const ids = ['library-category-dropdown', 'library-tags-dropdown'];
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => {
      const isMobile = mq.matches;
      ids.forEach(id => {
        const details = document.getElementById(id);
        if (!details) return;
        if (isMobile) {
          details.removeAttribute('open');
        } else {
          details.setAttribute('open', '');
        }
      });
    };
    apply();
    // Only on breakpoint crossings: a plain resize listener also fired when a
    // phone's URL bar hid while scrolling and snapped open dropdowns shut.
    if (mq.addEventListener) mq.addEventListener('change', apply); else mq.addListener(apply);
  }

  // Home + Projects content that comes from packs.json. Called from
  // renderClientsTimeline so it runs once the packs have loaded.
  renderHomeAndProjects() {
    const packs = this.packs || [];
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const count = (cat) => packs.filter(p => p.category === cat).length;
    setText('home-stat-releases', packs.length);
    setText('home-stat-hud', count('packs'));
    setText('home-stat-clients', count('clients'));
    setText('home-stat-apps', count('apps'));

    // Apps/websites carry an emoji in `thumbnail` instead of an image path.
    const hasImg = (p) => p.thumbnail && /\.(png|webp|jpe?g|gif|svg)$/i.test(p.thumbnail);
    const icon = (p) => hasImg(p)
      ? this.pictureTag(p.thumbnail, p.thumbnailWebp)
      : p.faIcon ? `<span class="hm-slot-letter"><i class="fas ${p.faIcon}" aria-hidden="true"></i></span>`
      : `<span class="hm-slot-letter">${this.escapeHtml(p.name.replace(/^Pepe's\s+/, '').charAt(0).toUpperCase())}</span>`;
    const ver = (p) => `v${this.escapeHtml(String((p.versions && p.versions[0] && p.versions[0].version) || p.version || '1.0.0'))}`;
    const catLabel = { packs: 'HUD pack', clients: 'Client', addons: 'Addon', apps: 'App', cosmetics: 'Cosmetic', utility: 'Utility', website: 'Website', other: 'Pack' };

    const latestEl = document.getElementById('home-latest');
    const latestRow = document.getElementById('home-latest-row');
    const latest = [...packs]
      .filter(p => p.category !== 'website')
      .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))
      .slice(0, 3);
    if (latestEl) {
      latestEl.innerHTML = latest.length ? latest.map(p => `
        <button type="button" class="hm-rel" data-open-pack="${p.id}">
          <span class="hm-slot hm-slot-56">${icon(p)}</span>
          <span class="hm-rel-body"><b>${this.escapeHtml(p.name)}</b><span class="hm-mono">${ver(p)}${p.size ? ' &middot; ' + this.escapeHtml(p.size) : ''}</span></span>
          <span class="hm-rel-go" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>
        </button>`).join('') : '<p class="hm-empty">Releases could not be loaded.</p>';
    }
    if (latestRow) {
      latestRow.innerHTML = latest.map(p => `
        <button type="button" class="hm-pk" data-open-pack="${p.id}">
          <span class="hm-slot">${icon(p)}</span>
          <span><b>${this.escapeHtml(p.name)}</b><span class="hm-mono">${ver(p)}</span></span>
        </button>`).join('');
    }

    const featuredEl = document.getElementById('home-featured');
    if (featuredEl) {
      const names = ['Glacier Client', "Pepe's ArmorHUD", "Pepe's Elytra Pitch", "Pepe's Waypoints+"];
      const featured = names.map(n => packs.find(p => p.name === n)).filter(Boolean);
      featuredEl.innerHTML = featured.map(p => `
        <button type="button" class="hm-pk hm-pk-lg" data-open-pack="${p.id}">
          <span class="hm-slot">${icon(p)}</span>
          <span><b>${this.escapeHtml(p.name)}</b><span class="hm-mono">${catLabel[p.category] || 'Pack'} &middot; ${ver(p)}</span></span>
        </button>`).join('');
    }

    // One delegated handler for every "open this pack" button on Home and Projects.
    if (!this._homeOpenBound) {
      this._homeOpenBound = true;
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-open-pack]');
        if (!btn) return;
        const pack = this.packs.find(p => p.id === parseInt(btn.dataset.openPack, 10));
        if (!pack) return;
        if (window.router) window.router.show('library', { push: false });
        this.showDetail(pack);
      });
    }

    this.renderProjectsTimeline();
  }

  renderProjectsTimeline() {
    const track = document.getElementById('projects-timeline-track');
    const detail = document.getElementById('projects-timeline-detail');
    const section = document.getElementById('projects-timeline');
    if (!track || !detail) return;

    const clients = (this.packs || [])
      .filter(p => p.category === 'clients' && p.timelineOrder != null)
      .sort((a, b) => (a.timelineOrder || 0) - (b.timelineOrder || 0));
    if (!clients.length) { if (section) section.classList.add('hidden'); return; }

    const initials = (p) => p.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const ver = (p) => String((p.versions && p.versions[0] && p.versions[0].version) || p.version || '1.0.0');
    const slot = (p) => (p.thumbnail && /\.(png|webp|jpe?g|gif|svg)$/i.test(p.thumbnail))
      ? `<span class="pr-slot">${this.pictureTag(p.thumbnail, p.thumbnailWebp)}</span>`
      : `<span class="pr-slot pr-slot-ini">${this.escapeHtml(initials(p))}</span>`;
    const lastIdx = clients.length - 1;

    const select = (i) => {
      track.querySelectorAll('.pr-tn').forEach((b, k) => {
        b.classList.toggle('on', k === i);
        b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
      });
      const p = clients[i];
      detail.innerHTML = `
        ${slot(p)}
        <div>
          <h3>${this.escapeHtml(p.name)}</h3>
          <div class="pr-sub"><span class="pr-tag">${i === lastIdx ? 'Current' : 'Discontinued'}</span><span class="hm-mono">Generation ${i + 1} of ${clients.length}</span><span class="hm-mono">v${this.escapeHtml(ver(p))}</span></div>
        </div>
        <button type="button" class="hm-btn hm-btn-sec" data-open-pack="${p.id}">View in library <i class="fas fa-arrow-right" aria-hidden="true"></i></button>`;
    };

    track.innerHTML = clients.map((p, i) => `
      <button type="button" class="pr-tn${i === lastIdx ? ' cur' : ''}" aria-pressed="false" data-idx="${i}">
        <span class="pr-d"></span>${slot(p)}<b>${this.escapeHtml(p.name)}</b><span class="hm-mono">v${this.escapeHtml(ver(p))}</span>
      </button>`).join('');
    track.querySelectorAll('.pr-tn').forEach(b => b.addEventListener('click', () => select(parseInt(b.dataset.idx, 10))));
    select(lastIdx);
  }

  renderClientsTimeline() {
    this.renderHomeAndProjects();
    const track = document.getElementById('timeline-track');
    if (!track) return;

    const clients = this.packs
      .filter(p => p.category === 'clients' && p.timelineOrder != null);

    // Pinned packs (like Assets Pack) always float to the top regardless of timeline order
    const sortedClients = [...clients].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (a.timelineOrder || 0) - (b.timelineOrder || 0);
    });

    if (sortedClients.length === 0) {
      document.getElementById('clients-timeline').classList.add('hidden-empty');
      return;
    }

    const nodesHtml = sortedClients.map((pack, i) => `
      <button type="button" class="timeline-node ${i === sortedClients.length - 1 ? 'timeline-node-current' : ''}" data-pack-id="${pack.id}">
        <span class="timeline-dot"></span>
        <span class="timeline-label">${this.escapeHtml(pack.name)}</span>
      </button>
    `).join('');
    track.innerHTML = `<div class="timeline-track-inner">${nodesHtml}</div>`;

    track.querySelectorAll('.timeline-node').forEach(node => {
      node.addEventListener('click', () => {
        const id = parseInt(node.dataset.packId, 10);
        const pack = this.packs.find(p => p.id === id);
        if (pack) this.showDetail(pack);
      });
    });
  }

  syncSortDropdownLabel() {
    const option = document.querySelector(`#sort-menu li[data-value="${this.currentFilter.sort}"]`);
    if (option) this.sortDropdown.select(option.dataset.value, option.textContent);
  }

  setupEventListeners() {
    // One delegated listener for the whole grid instead of re-binding a
    // listener to every card/favorite/divider on each render.
    const packsGrid = document.getElementById('packs-grid');
    if (packsGrid) packsGrid.addEventListener('click', (e) => {
      const fav = e.target.closest('.pack-favorite-btn');
      if (fav) {
        e.stopPropagation();
        this.toggleFavorite(parseInt(fav.dataset.packId, 10));
        return;
      }
      const divider = e.target.closest('.category-section-divider, .category-sub-divider');
      if (divider) { this.toggleSectionCollapsed(divider); return; }
      const card = e.target.closest('.pack-card');
      if (!card) return;
      const pack = this.packs.find(p => p.id === parseInt(card.dataset.packId, 10));
      if (!pack) return;
      if (pack.category === 'website' && pack.externalUrl) this.openExternal(pack.externalUrl);
      else this.showDetail(pack);
    });

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => this.handleSearch(e));
    searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
    searchInput.addEventListener('focus', () => this.renderSearchSuggestions(searchInput.value));
    searchInput.addEventListener('blur', () => {
      setTimeout(() => this.hideSearchSuggestions(), 150);
    });

    document.getElementById('search-clear').addEventListener('click', () => {
      searchInput.value = '';
      this.currentFilter.search = '';
      this.applyFilters();
      this.hideSearchSuggestions();
      document.getElementById('search-clear').classList.add('hidden');
      searchInput.focus();
    });

    document.querySelectorAll('#page-library .category-row').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleCategoryClick(e));
    });

    document.querySelectorAll('#page-settings .category-row').forEach(btn => {
      btn.addEventListener('click', () => this.handleSettingsCategoryClick(btn));
    });

    document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());

    document.getElementById('view-grid-btn').addEventListener('click', () => this.setViewMode('grid'));
    document.getElementById('view-list-btn').addEventListener('click', () => this.setViewMode('list'));

    document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
      this.setDarkMode(e.target.checked);
    });

    document.getElementById('compact-view-toggle').addEventListener('change', (e) => {
      this.setCompactView(e.target.checked);
    });

    document.getElementById('reduce-motion-toggle').addEventListener('change', (e) => {
      this.setReduceMotion(e.target.checked);
    });

    document.getElementById('new-tab-toggle').addEventListener('change', (e) => {
      this.setNewTabLinks(e.target.checked);
    });

    document.getElementById('hero-visibility-slider').addEventListener('input', (e) => {
      this.setHeroVisibility(e.target.value);
    });

    document.querySelectorAll('.setting-slider').forEach(updateSliderFill);

    document.getElementById('autoplay-showcase-toggle').addEventListener('change', (e) => {
      localStorage.setItem('autoplayShowcase', e.target.checked);
    });

    document.getElementById('show-downloads-toggle').addEventListener('change', (e) => {
      this.setShowDownloadCounts(e.target.checked);
    });

    document.getElementById('show-assets-warning-toggle').addEventListener('change', (e) => {
      localStorage.setItem('hideAssetsModal', String(!e.target.checked));
    });

    document.getElementById('collapse-old-versions-toggle').addEventListener('change', (e) => {
      localStorage.setItem('collapseOldVersions', e.target.checked);
      if (this.currentPack) this.renderVersionsList(this.currentPack);
    });

    document.getElementById('show-discontinued-toggle').addEventListener('change', (e) => {
      localStorage.setItem('showDiscontinued', e.target.checked);
      this.updateCategoryCounts();
      this.applyFilters();
    });

    document.getElementById('collapse-sections-toggle').addEventListener('change', (e) => {
      this.defaultCollapseSections = e.target.checked;
      localStorage.setItem('collapseSectionsByDefault', e.target.checked);
      this.render();
    });

    const askProviderToggle = document.getElementById('ask-provider-toggle');
    askProviderToggle.addEventListener('change', (e) => {
      localStorage.setItem('askProviderEveryTime', e.target.checked);
      this.updateMonetizationProviderDropdownState(e.target.checked);
    });

    document.getElementById('clear-favorites-btn').addEventListener('click', () => {
      if (this.favorites.size === 0) return;
      if (confirm(`Remove all ${this.favorites.size} favorited pack(s)?`)) {
        this.clearFavorites();
      }
    });

    const resetBtn = document.getElementById('reset-settings-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Reset all settings to their defaults?')) return;
        SETTINGS_KEYS.forEach(key => localStorage.removeItem(key));
        location.reload();
      });
    }

    const exportBtn = document.getElementById('export-settings-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportSettings());
    }

    const importBtn = document.getElementById('import-settings-btn');
    const importInput = document.getElementById('import-settings-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.importSettings(file);
        importInput.value = '';
      });
    }

    document.getElementById('font-size-slider').addEventListener('input', (e) => {
      this.setFontSize(e.target.value);
    });

    const rememberLastPageToggle = document.getElementById('remember-last-page-toggle');
    if (rememberLastPageToggle) {
      rememberLastPageToggle.addEventListener('change', (e) => {
        localStorage.setItem('rememberLastPage', e.target.checked);
      });
    }

    const settingsSearchInput = document.getElementById('settings-search-input');
    if (settingsSearchInput) {
      settingsSearchInput.addEventListener('input', (e) => this.filterSettingsRows(e.target.value));
      const clearBtn = document.getElementById('settings-search-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          settingsSearchInput.value = '';
          this.filterSettingsRows('');
          settingsSearchInput.focus();
        });
      }
    }

    document.querySelectorAll('#page-settings [data-reset-section]').forEach(btn => {
      btn.addEventListener('click', () => this.resetSettingsSection(btn.dataset.resetSection));
    });
    // The toggles are native checkboxes dressed as switches; tell assistive tech.
    document.querySelectorAll('#page-settings .custom-checkbox > input[type="checkbox"]').forEach(input => {
      input.setAttribute('role', 'switch');
    });

    SIMPLE_TOGGLE_SETTINGS.forEach(({ id, key, className }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', (e) => {
        localStorage.setItem(key, e.target.checked);
        document.body.classList.toggle(className, e.target.checked);
      });
    });

    SIMPLE_FLAG_SETTINGS.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', (e) => {
        localStorage.setItem(key, e.target.checked);
      });
    });

    const scrollToTopToggle = document.getElementById('scroll-to-top-toggle');
    if (scrollToTopToggle) {
      scrollToTopToggle.addEventListener('change', (e) => {
        localStorage.setItem('scrollToTopOnNav', e.target.checked);
      });
    }

    const trackDownloadsToggle = document.getElementById('track-downloads-toggle');
    if (trackDownloadsToggle) {
      trackDownloadsToggle.addEventListener('change', (e) => {
        localStorage.setItem('trackDownloadCounts', e.target.checked);
      });
    }

    const clearRecentlyViewedBtn = document.getElementById('clear-recently-viewed-btn');
    if (clearRecentlyViewedBtn) {
      clearRecentlyViewedBtn.addEventListener('click', () => {
        localStorage.removeItem('recentlyViewedPacks');
        alert('Recently viewed packs cleared.');
      });
    }

    const copySummaryBtn = document.getElementById('copy-settings-summary-btn');
    if (copySummaryBtn) {
      copySummaryBtn.addEventListener('click', () => this.copySettingsSummary());
    }

    // Confirm before navigating away to an external link, when enabled.
    document.addEventListener('click', (e) => {
      if (!getBoolSetting('confirmExternalLinks')) return;
      const link = e.target.closest('a[href^="http"]');
      if (!link || link.closest('#detail-download, .version-download-btn')) return;
      if (!confirm(`Open this external link?\n\n${link.href}`)) {
        e.preventDefault();
      }
    });

    document.getElementById('back-to-browse').addEventListener('click', () => {
      if (history.state && history.state.page === 'pack') {
        history.back();
      } else {
        this.showBrowse();
      }
    });

    document.getElementById('detail-share-btn').addEventListener('click', () => this.copyPackLink());
    document.getElementById('detail-copy-info-btn').addEventListener('click', () => this.copyPackInfo());

    document.querySelectorAll('#rating-stars-input .rating-star').forEach(btn => {
      const value = parseInt(btn.dataset.value, 10);
      btn.addEventListener('click', () => {
        if (this.currentPack) this.submitPackRating(this.currentPack, value);
      });
      btn.addEventListener('mouseenter', () => {
        document.querySelectorAll('#rating-stars-input .rating-star').forEach(b => {
          b.classList.toggle('rating-star-hover', parseInt(b.dataset.value, 10) <= value);
        });
      });
    });
    document.getElementById('rating-stars-input').addEventListener('mouseleave', () => {
      document.querySelectorAll('#rating-stars-input .rating-star').forEach(b => b.classList.remove('rating-star-hover'));
    });

    const resetFilters = () => {
      searchInput.value = '';
      this.currentFilter.search = '';
      this.currentFilter.category = '';
      localStorage.setItem('selectedCategory', '');
      this.currentFilter.tags.clear();
      this.syncCategorySidebar();
      this.renderTagChips();
      this.applyFilters();
      document.getElementById('search-clear').classList.add('hidden');
    };
    ['empty-state-clear-btn', 'lib-filters-reset'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', resetFilters);
    });

    // Filters popover (favorites + tags): toggle, outside click, Escape.
    const filtersBtn = document.getElementById('lib-filters-btn');
    const filtersPop = document.getElementById('lib-filters-pop');
    if (filtersBtn && filtersPop) {
      const setFiltersOpen = (open) => {
        filtersPop.classList.toggle('hidden', !open);
        filtersBtn.setAttribute('aria-expanded', String(open));
      };
      filtersBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setFiltersOpen(filtersPop.classList.contains('hidden'));
      });
      document.addEventListener('click', (e) => {
        if (!filtersPop.classList.contains('hidden') && !filtersPop.contains(e.target)) setFiltersOpen(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !filtersPop.classList.contains('hidden')) {
          setFiltersOpen(false);
          filtersBtn.focus();
        }
      });
    }

    const detailFavBtn = document.getElementById('detail-fav-btn');
    if (detailFavBtn) detailFavBtn.addEventListener('click', () => {
      if (this.currentPack) this.toggleFavorite(this.currentPack.id);
    });

    // ===== Global keyboard shortcuts (Library page) =====
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (e.key === '/' && !typing) {
        const libraryPage = document.getElementById('page-library');
        if (libraryPage && libraryPage.classList.contains('active')) {
          e.preventDefault();
          searchInput.focus();
        }
        return;
      }

      if (e.key === 'Escape') {
        const openModal = [...document.querySelectorAll('.assets-modal-overlay:not(.hidden)')].pop();
        if (openModal) {
          const closeBtn = openModal.querySelector('.assets-modal-close');
          if (closeBtn) { closeBtn.click(); return; }
        }
      }

      if (e.key === 'Escape' && !typing) {
        const detailView = document.getElementById('detail-view');
        if (detailView && !detailView.classList.contains('hidden')) {
          document.getElementById('back-to-browse').click();
        }
      }
    });

    // ===== Version selector (multi-version packs) =====
    const versionTrigger = document.getElementById('version-select-trigger');
    const versionMenu = document.getElementById('version-select-menu');
    versionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = versionMenu.classList.toggle('open');
      versionTrigger.classList.toggle('open', isOpen);
      versionTrigger.setAttribute('aria-expanded', String(isOpen));
    });
    document.addEventListener('click', (e) => {
      if (!document.getElementById('version-select-dropdown').contains(e.target)) {
        versionMenu.classList.remove('open');
        versionTrigger.classList.remove('open');
        versionTrigger.setAttribute('aria-expanded', 'false');
      }
    });

    // ===== Download provider choice modal =====
    this.selectedProvider = getMonetizationProvider();
    document.querySelectorAll('#provider-choice-tabs .provider-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.selectedProvider = tab.dataset.value;
        document.querySelectorAll('#provider-choice-tabs .provider-tab').forEach(t => {
          t.classList.toggle('selected', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        });
      });
    });

    document.getElementById('download-provider-modal-close').addEventListener('click', () => this.hideProviderModal());
    document.getElementById('download-provider-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'download-provider-modal-overlay') this.hideProviderModal();
    });
    document.getElementById('provider-choice-confirm').addEventListener('click', () => this.confirmProviderModal());

    // ===== Assets-required modal =====
    document.getElementById('assets-modal-close').addEventListener('click', () => this.hideAssetsModal());
    document.getElementById('assets-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'assets-modal-overlay') this.hideAssetsModal();
    });
    document.getElementById('assets-modal-get').addEventListener('click', () => {
      const link = this.pendingDownloadLink;
      this.hideAssetsModal();
      if (link) {
        this.downloadFlowBypass = true;
        link.click();
        this.downloadFlowBypass = false;
      }
    });

    // ===== Download click interception (provider choice + assets requirement) =====
    document.addEventListener('click', (e) => {
      if (this.downloadFlowBypass) return;
      const link = e.target.closest('#detail-download, .version-download-btn');
      if (!link || link.classList.contains('btn-download-disabled')) return;
      if (!this.currentPack || !link.dataset.rawUrl) return;

      if (getBoolSetting('openGateNewTab')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
      } else {
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }

      if (getBoolSetting('confirmBeforeDownload')) {
        if (!confirm(`Download "${this.currentPack.name}"?`)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }

      const askEveryTime = localStorage.getItem('askProviderEveryTime') !== 'false'
        && this.hasProviderChoice(this.currentPack);
      const needsAssets = this.currentPack.requiresAssets && !this.currentPack.pinned
        && !this.assetsWarningHidden();

      if (!askEveryTime && !needsAssets) return; // let the plain <a href> navigate normally

      e.preventDefault();
      e.stopImmediatePropagation();

      this.pendingDownloadLink = link;
      this.chosenProvider = null;

      if (askEveryTime) {
        this.showProviderModal(needsAssets);
      } else {
        this.showAssetsModal(this.currentPack, link);
      }
    }, true);

    // Increment the download counter whenever a download link actually navigates
    // (either a plain click that wasn't intercepted, or a bypassed re-click after modals).
    document.addEventListener('click', (e) => {
      const link = e.target.closest('#detail-download, .version-download-btn');
      if (!link || link.classList.contains('btn-download-disabled') || !link.dataset.rawUrl) return;
      if (!this.currentPack) return;
      link.classList.add('is-busy');
      setTimeout(() => link.classList.remove('is-busy'), 1500);
      this.showToast(`${this.currentPack.name} is on its way. Enjoy!`);
      const pack = this.currentPack;
      const versions = pack.versions;
      const multi = versions && versions.length > 1;
      const version = multi
        ? (link.id === 'detail-download' ? versions[this.selectedVersionIndex || 0] : versions[parseInt(link.dataset.versionIndex, 10)])
        : null;

      if (getBoolSetting('copyNameOnDownload') && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pack.name).catch(() => {});
      }

      this.markDownloaded(pack);
      if (!getBoolSetting('trackDownloadCounts', true)) return;

      this.incrementDownloads(pack, version).then(count => {
        this.writeCachedDownloadCount(this.counterKey(pack, version), count);
        this.liveDownloadCounts.delete(pack.id);
        if (multi) {
          const idx = versions.indexOf(version);
          const el = document.querySelector(`.version-downloads[data-version-index="${idx}"]`);
          if (el) el.textContent = `${this.formatCount(count)} downloads`;
          if (this.currentPack === pack && idx === (this.selectedVersionIndex || 0)) {
            document.getElementById('detail-downloads').textContent = this.formatCount(count);
          }
        } else {
          pack.downloads = count;
          if (this.currentPack === pack) this.updateDownloadsDisplay(pack, count);
        }
      });
    });
  }

  handleSettingsCategoryClick(btn) {
    const category = btn.dataset.settingsCategory;
    localStorage.setItem('selectedSettingsCategory', category);

    document.querySelectorAll('#page-settings .category-row').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.settings-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.settingsPanel === category);
    });

    const currentEl = document.getElementById('settings-category-current');
    if (currentEl) currentEl.textContent = btn.querySelector('span').textContent.trim();
    const dd = document.getElementById('settings-category-dropdown');
    if (dd) dd.setAttribute('open', '');
    btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  syncSettingsCategorySidebar() {
    const saved = localStorage.getItem('selectedSettingsCategory');
    const btn = saved && document.querySelector(`#page-settings .category-row[data-settings-category="${saved}"]`);
    if (btn) this.handleSettingsCategoryClick(btn);
    this.updateSettingsCategoryCounts();
  }

  // Row count badge on each category (matching rows only while a search is active).
  updateSettingsCategoryCounts() {
    document.querySelectorAll('#page-settings .category-row').forEach(btn => {
      const panel = document.querySelector(`#page-settings .settings-panel[data-settings-panel="${btn.dataset.settingsCategory}"]`);
      if (!panel) return;
      let badge = btn.querySelector('.category-count');
      const rows = panel.querySelectorAll('.setting-row');
      if (!rows.length) { if (badge) badge.remove(); return; }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'category-count';
        btn.appendChild(badge);
      }
      badge.textContent = panel.querySelectorAll('.setting-row:not(.setting-row-hidden)').length;
    });
  }

  // Puts every control in a Settings panel back to the value written in the markup (the default).
  resetSettingsSection(category) {
    const panel = document.querySelector(`#page-settings .settings-panel[data-settings-panel="${category}"]`);
    if (!panel) return;
    if (category === 'theme') {
      const classic = panel.querySelector('.theme-look-card');
      if (classic) classic.click();
      return;
    }
    panel.querySelectorAll('input[type="checkbox"].setting-input').forEach(input => {
      if (input.checked !== input.defaultChecked) {
        input.checked = input.defaultChecked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    panel.querySelectorAll('input[type="range"].setting-slider').forEach(input => {
      if (input.value !== input.defaultValue) {
        input.value = input.defaultValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    if (category === 'library' && this.defaultSortDropdown) this.defaultSortDropdown.select('relevance', 'Relevance');
    if (category === 'downloads' && this.monetizationDropdown) this.monetizationDropdown.select('linkvertise', 'Linkvertise');
  }

  // Toggle the "Download Link Provider" dropdown disabled state.
  // When "Ask Every Time" is checked (default), the dropdown is greyed out since it's not used.
  updateMonetizationProviderDropdownState(isChecked) {
    const dropdown = document.getElementById('monetization-provider-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('monetization-provider-dropdown-disabled', isChecked);
  }

  // ===== Download Provider Modal =====

  showProviderModal(chainToAssets) {
    this.providerModalChainsToAssets = chainToAssets;

    const confirmBtn = document.getElementById('provider-choice-confirm');
    confirmBtn.innerHTML = chainToAssets
      ? `Next <i class="fas fa-arrow-right"></i>`
      : `<i class="fas fa-download"></i> Download`;

    this.setModalStep('download-provider-modal-overlay', chainToAssets ? 'Step 1 of 2' : '');

    this.selectedProvider = getMonetizationProvider();
    document.querySelectorAll('#provider-choice-tabs .provider-tab').forEach(tab => {
      const selected = tab.dataset.value === this.selectedProvider;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });

    document.getElementById('download-provider-modal-overlay').classList.remove('hidden');
  }

  // Shows "Step n of m" above a modal's title so people can see how far along a multi-step flow is.
  setModalStep(overlayId, text) {
    const modal = document.querySelector(`#${overlayId} .assets-modal`);
    if (!modal) return;
    let el = modal.querySelector('.modal-step');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('p');
      el.className = 'modal-step';
      modal.insertBefore(el, modal.querySelector('h3'));
    }
    el.textContent = text;
  }

  // Peak-end rule: finish the download flow on a clear, friendly confirmation.
  showToast(message) {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = '<i class="fas fa-circle-check"></i><span></span>';
    toast.querySelector('span').textContent = message;
    host.appendChild(toast);
    setTimeout(() => toast.classList.add('leaving'), 2600);
    setTimeout(() => toast.remove(), 3000);
  }

  hideProviderModal() {
    document.getElementById('download-provider-modal-overlay').classList.add('hidden');
  }

  confirmProviderModal() {
    const provider = this.selectedProvider || 'linkvertise';
    this.chosenProvider = provider; // the Assets Pack button must use this choice, not the saved default
    this.hideProviderModal();

    const link = this.pendingDownloadLink;
    if (!link) return;

    const rawUrl = link.dataset.rawUrl;
    const lootUrl = link.dataset.lootUrl || null;
    link.href = getMonetizedUrl(rawUrl, lootUrl, provider, this.lvIdFor(this.currentPack));

    if (this.providerModalChainsToAssets) {
      this.showAssetsModal(this.currentPack, link);
    } else {
      this.downloadFlowBypass = true;
      link.click();
      this.downloadFlowBypass = false;
    }
  }

  getAssetsPack() {
    return this.packs.find(p => p.pinned) || this.packs.find(p => /assets pack/i.test(p.name));
  }

  latestAssetsVersion() {
    const a = this.getAssetsPack();
    const v = a && ((a.versions && a.versions[0]) || a);
    return (v && v.version) || (a && a.version) || '';
  }

  // 'true' = turned off in Settings. 'v:<version>' = "Don't show again" for that Assets Pack
  // version only, so the warning returns when a newer Assets Pack is released.
  assetsWarningHidden() {
    const v = localStorage.getItem('hideAssetsModal');
    if (v === 'true') return true;
    return !!v && v === 'v:' + this.latestAssetsVersion();
  }

  showAssetsModal(pack, link) {
    const assetsPack = this.getAssetsPack();
    if (!assetsPack) return;
    const verEl = document.getElementById('assets-modal-version');
    const ver = this.latestAssetsVersion();
    if (verEl) verEl.textContent = ver ? ` v${ver.replace(/^v/i, '')}` : '';

    this.pendingDownloadLink = link;
    this.setModalStep('assets-modal-overlay', this.chosenProvider ? 'Step 2 of 2' : '');
    document.getElementById('assets-modal-pack-name').textContent = pack.name;

    const getBtn = document.getElementById('assets-modal-get');
    const latestVersion = (assetsPack.versions && assetsPack.versions[0]) || assetsPack;
    getBtn.href = getMonetizedUrl(latestVersion.downloadUrl || assetsPack.downloadUrl, latestVersion.lootUrl || assetsPack.lootUrl, this.chosenProvider);
    getBtn.setAttribute('target', '_blank');
    getBtn.setAttribute('rel', 'noopener');
    getBtn.onclick = () => {
      this.incrementDownloads(assetsPack);
    };

    document.getElementById('assets-modal-dont-show').checked = false;
    document.getElementById('assets-modal-overlay').classList.remove('hidden');
  }

  hideAssetsModal() {
    if (document.getElementById('assets-modal-dont-show').checked) {
      localStorage.setItem('hideAssetsModal', 'v:' + this.latestAssetsVersion());
    }
    document.getElementById('assets-modal-overlay').classList.add('hidden');
    this.pendingDownloadLink = null;
  }

  // packs.json renders straight away; community packs come from the uploads
  // worker and are merged in when they arrive (see mergeCommunityPacks), so a
  // slow worker never holds up the library or the first page load.
  async loadPacks() {
    this.communityPromise = this.loadCommunityPacks();
    try {
      const response = await fetch('packs.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`packs.json request failed: ${response.status}`);
      const data = await response.json();
      this.packs = [...(data.packs || [])];
      this.packsLoadError = false;
      this.filteredPacks = [...this.packs];
      return this.packs;
    } catch (error) {
      console.error('Error loading packs:', error);
      this.packs = [];
      this.filteredPacks = [];
      this.packsLoadError = true;
    }
  }

  renderTagChips() {
    const listEl = document.getElementById('tag-chip-list');
    if (!listEl) return;

    // Category names are already filterable via the Categories list above,
    // so only surface the more descriptive keyword-derived tags here.
    const categoryNames = new Set(CATEGORY_ORDER);
    const counts = new Map();
    this.packs.forEach(pack => {
      (pack.tags || []).forEach(tag => {
        if (categoryNames.has(tag.toLowerCase())) return;
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });

    const tags = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
    if (tags.length === 0) {
      listEl.innerHTML = '<p class="tag-chip-empty">No tags yet</p>';
      return;
    }

    // Hick's / Miller's law: only the 8 most common tags (plus any active ones) are shown up front.
    const TAG_LIMIT = 8;
    const visibleTags = this.tagsExpanded
      ? tags
      : tags.filter((tag, i) => i < TAG_LIMIT || this.currentFilter.tags.has(tag));
    const hiddenCount = tags.length - visibleTags.length;

    listEl.innerHTML = visibleTags.map(tag => `
      <button type="button" class="tag-chip${this.currentFilter.tags.has(tag) ? ' active' : ''}" data-tag="${this.escapeHtml(tag)}">
        ${this.escapeHtml(tag)} <span class="tag-chip-count">${counts.get(tag)}</span>
      </button>
    `).join('') + (tags.length > TAG_LIMIT ? `
      <button type="button" class="tag-more-btn" aria-expanded="${this.tagsExpanded ? 'true' : 'false'}">
        ${this.tagsExpanded ? 'Show fewer' : `Show ${hiddenCount} more`}
      </button>` : '');

    const moreBtn = listEl.querySelector('.tag-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        this.tagsExpanded = !this.tagsExpanded;
        this.renderTagChips();
      });
    }

    listEl.querySelectorAll('.tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        if (this.currentFilter.tags.has(tag)) {
          this.currentFilter.tags.delete(tag);
        } else {
          this.currentFilter.tags.add(tag);
        }
        btn.classList.toggle('active');
        this.applyFilters();
        this.updateTagsDropdownLabel();
      });
    });

    this.updateTagsDropdownLabel();
  }

  updateTagsDropdownLabel() {
    const el = document.getElementById('library-tags-current');
    if (!el) return;
    const count = this.currentFilter.tags.size;
    el.textContent = count === 0 ? 'Any' : `${count} selected`;
  }

  updateCategoryCounts() {
    const showDiscontinued = localStorage.getItem('showDiscontinued') !== 'false';
    const countablePacks = showDiscontinued ? this.packs : this.packs.filter(p => !p.discontinued);

    document.getElementById('count-all').textContent = countablePacks.length;
    CATEGORY_ORDER.forEach(cat => {
      const count = countablePacks.filter(p => p.category === cat).length;
      const elem = document.getElementById(`count-${cat}`);
      if (elem) elem.textContent = count;
    });
    this.updateFavoritesCount();
  }

  renderStatsPage() {
    if (!this.packs.length) return;

    // packs.json's own `downloads` snapshot is essentially always 0 (it only
    // ever comes from a local .metadata.json that doesn't really exist) -
    // use whatever's already cached from live fetches, and kick off fetches
    // for anything not cached yet so the page fills in once they resolve.
    const liveCount = (pack) => this.liveDownloadCounts.get(pack.id) ?? pack.downloads ?? 0;
    const uncached = this.packs.filter(p => !this.liveDownloadCounts.has(p.id));
    if (uncached.length) {
      Promise.all(uncached.map(pack => {
        const totalPromise = (pack.versions && pack.versions.length > 1)
          ? Promise.all(pack.versions.map(v => this.fetchLiveDownloads(pack, v))).then(counts => counts.reduce((a, b) => a + b, 0))
          : this.fetchLiveDownloads(pack);
        return totalPromise.then(count => this.liveDownloadCounts.set(pack.id, count));
      })).then(() => {
        if (document.getElementById('page-stats').classList.contains('active')) this.renderStatsPage();
      });
    }

    const active = this.packs.filter(p => !p.discontinued);
    const totalDownloads = this.packs.reduce((sum, p) => sum + liveCount(p), 0);
    const mostDownloaded = [...this.packs].sort((a, b) => liveCount(b) - liveCount(a))[0];
    const newest = [...this.packs]
      .filter(p => p.createdAt)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    const summary = [
      { label: 'Total packs', value: this.packs.length },
      { label: 'Total downloads', value: this.formatCount(totalDownloads), hi: true },
      { label: 'Active', value: active.length },
      { label: 'Discontinued', value: this.packs.length - active.length },
    ];
    document.getElementById('stats-summary-grid').innerHTML = summary.map(s => `
      <div class="stats-summary-card${s.hi ? ' is-hi' : ''}">
        <span class="stats-summary-label">${s.label}</span>
        <span class="stats-summary-value">${s.value}</span>
      </div>
    `).join('');

    const presentCats = CATEGORY_ORDER.filter(cat => this.packs.some(p => p.category === cat));
    const maxCatCount = Math.max(1, ...presentCats.map(cat => this.packs.filter(p => p.category === cat).length));
    const topCatIdx = presentCats.findIndex(c => this.packs.filter(p => p.category === c).length === maxCatCount);
    document.getElementById('stats-category-total').textContent = `${this.packs.length} packs`;
    document.getElementById('stats-category-list').innerHTML = presentCats.map((cat, i) => {
      const count = this.packs.filter(p => p.category === cat).length;
      const pct = Math.round((count / maxCatCount) * 100);
      return `
        <div class="stats-category-row">
          <span class="stats-category-name">${this.capitalizeFirst(cat)}</span>
          <div class="stats-category-bar-track"><div class="stats-category-bar-fill${i === topCatIdx ? ' is-hi' : ''}" style="width:${pct}%"></div></div>
          <span class="stats-category-count">${count}</span>
        </div>
      `;
    }).join('');

    // Top packs: ranked by live download count, filterable by category.
    if (!presentCats.includes(this.statsTopCategory)) this.statsTopCategory = 'all';
    const chipsEl = document.getElementById('stats-top-chips');
    chipsEl.innerHTML = ['all', ...presentCats].map(cat => `
      <button type="button" class="stats-chip${cat === this.statsTopCategory ? ' on' : ''}" data-cat="${cat}" aria-pressed="${cat === this.statsTopCategory}">${cat === 'all' ? 'All' : this.capitalizeFirst(cat)}</button>
    `).join('');
    chipsEl.querySelectorAll('.stats-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.statsTopCategory = chip.dataset.cat;
        this.renderStatsPage();
      });
    });
    const ranked = this.packs
      .filter(p => this.statsTopCategory === 'all' || p.category === this.statsTopCategory)
      .sort((a, b) => liveCount(b) - liveCount(a))
      .slice(0, 10);
    const topCount = Math.max(1, ...ranked.map(liveCount));
    document.getElementById('stats-top-list').innerHTML = ranked.length ? ranked.map((pack, i) => {
      const icon = this.isImagePath(pack.thumbnail)
        ? this.pictureTag(pack.thumbnail, pack.thumbnailWebp)
        : this.fallbackIconContent(pack);
      const dl = liveCount(pack);
      return `
        <button type="button" class="stats-rank-row" data-pack-id="${pack.id}">
          <span class="stats-rank-n">${i + 1}</span>
          <span class="stats-rank-icon">${icon}</span>
          <span class="stats-rank-name"><b>${this.escapeHtml(pack.name)}</b><span>${this.capitalizeFirst(pack.category)}</span></span>
          <span class="stats-category-bar-track stats-rank-bar"><span class="stats-category-bar-fill${i === 0 ? ' is-hi' : ''}" style="width:${Math.round((dl / topCount) * 100)}%"></span></span>
          <span class="stats-rank-num">${dl.toLocaleString('en-US')}</span>
        </button>
      `;
    }).join('') : '<p class="stats-empty">No packs in this category yet</p>';

    const spotlightCard = (label, pack) => {
      if (!pack) return '';
      return `
        <button type="button" class="stats-spotlight-card" data-pack-id="${pack.id}">
          <p class="stats-spotlight-label">${label}</p>
          <p class="stats-spotlight-name">${this.escapeHtml(pack.name)}</p>
          <p class="stats-spotlight-meta">${this.formatCount(liveCount(pack))} downloads &middot; ${this.capitalizeFirst(pack.category)}</p>
        </button>
      `;
    };
    document.getElementById('stats-spotlight-grid').innerHTML =
      spotlightCard('Most downloaded', mostDownloaded) + spotlightCard('Newest addition', newest);

    document.querySelectorAll('#page-stats .stats-spotlight-card, #page-stats .stats-rank-row').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.packId, 10);
        const pack = this.packs.find(p => p.id === id);
        if (pack) {
          window.router.show('library', { push: false });
          this.showDetail(pack);
        }
      });
    });
  }

  loadFavorites() {
    try {
      const raw = localStorage.getItem('favoritePacks');
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  saveFavorites() {
    try {
      localStorage.setItem('favoritePacks', JSON.stringify([...this.favorites]));
    } catch (e) { /* storage full or unavailable */ }
  }

  loadCollapsedSections() {
    try {
      const raw = localStorage.getItem('collapsedSections');
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  saveCollapsedSections() {
    try {
      localStorage.setItem('collapsedSections', JSON.stringify([...this.collapsedSections]));
    } catch (e) { /* storage full or unavailable */ }
  }

  // A leading "!" marks a section the user explicitly re-opened despite the
  // "Collapse Sections by Default" setting being on.
  isSectionCollapsed(key) {
    if (this.collapsedSections.has(`!${key}`)) return false;
    if (this.collapsedSections.has(key)) return true;
    return this.defaultCollapseSections;
  }

  toggleSectionCollapsed(divider) {
    const key = divider.dataset.sectionKey;
    const collapsed = divider.classList.toggle('section-collapsed');
    if (collapsed) {
      this.collapsedSections.add(key);
      this.collapsedSections.delete(`!${key}`);
    } else {
      this.collapsedSections.delete(key);
      if (this.defaultCollapseSections) this.collapsedSections.add(`!${key}`);
      else this.collapsedSections.delete(`!${key}`);
    }
    this.saveCollapsedSections();

    const isTopLevel = divider.classList.contains('category-section-divider');
    let el = divider.nextElementSibling;
    while (el) {
      if (isTopLevel && el.classList.contains('category-section-divider')) break;
      if (!isTopLevel && (el.classList.contains('category-section-divider') || el.classList.contains('category-sub-divider'))) break;
      el.classList.toggle('section-hidden', collapsed);
      el = el.nextElementSibling;
    }
  }

  isFavorite(packId) {
    return this.favorites.has(packId);
  }

  toggleFavorite(packId) {
    if (this.favorites.has(packId)) {
      this.favorites.delete(packId);
    } else {
      this.favorites.add(packId);
    }
    this.saveFavorites();
    this.updateFavoritesCount();

    if (this.currentFilter.category === 'favorites') {
      this.applyFilters();
    } else {
      document.querySelectorAll(`.pack-favorite-btn[data-pack-id="${packId}"]`).forEach(btn => {
        btn.classList.toggle('active', this.favorites.has(packId));
      });
    }

    if (this.currentPack && this.currentPack.id === packId) {
      this.syncDetailFavorite();
    }
  }

  updateFavoritesCount() {
    const elem = document.getElementById('count-favorites');
    if (elem) elem.textContent = this.favorites.size;
  }

  // Keeps the detail panel's heart button in step with the favorites set.
  syncDetailFavorite() {
    const btn = document.getElementById('detail-fav-btn');
    if (!btn || !this.currentPack) return;
    const on = this.favorites.has(this.currentPack.id);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Remove from favorites' : 'Add to favorites';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.querySelector('i').className = `${on ? 'fas' : 'far'} fa-heart`;
  }

  // "Open in Customizer" only shows for packs the customizer actually knows.
  async syncCustomizerLink(pack) {
    const btn = document.getElementById('detail-customizer-btn');
    if (!btn) return;
    btn.classList.add('hidden');
    try {
      if (!this._customizerNames) {
        this._customizerNames = fetch('customizer-packs.json')
          .then(r => (r.ok ? r.json() : { packs: [] }))
          .then(d => new Set((d.packs || []).map(p => this.normalizeSearch(p.name))));
      }
      const names = await this._customizerNames;
      if (this.currentPack === pack && names.has(this.normalizeSearch(pack.name))) btn.classList.remove('hidden');
    } catch (e) { /* link just stays hidden */ }
  }

  clearFavorites() {
    this.favorites.clear();
    this.saveFavorites();
    this.updateFavoritesCount();
    if (this.currentFilter.category === 'favorites') this.applyFilters();
    document.querySelectorAll('.pack-favorite-btn.active').forEach(btn => btn.classList.remove('active'));
    const detailFav = document.getElementById('detail-favorite-btn');
    if (detailFav) detailFav.classList.remove('active');
  }

  handleSearch(e) {
    const value = e.target.value;
    this.currentFilter.search = value.toLowerCase();
    // Re-rendering the whole grid on every keystroke is the most expensive
    // thing on the page; suggestions stay instant, the grid catches up.
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.applyFilters(), value ? 120 : 0);
    document.getElementById('search-clear').classList.toggle('hidden', !value);
    this.renderSearchSuggestions(value);
  }

  renderSearchSuggestions(value) {
    const box = document.getElementById('search-suggestions');
    const query = value.trim().toLowerCase();

    if (!query) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const matches = this.packs
      .filter(p => p.name.toLowerCase().includes(query))
      .slice(0, 7);

    if (matches.length === 0) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    box.innerHTML = matches.map((p, i) => {
      const idx = p.name.toLowerCase().indexOf(query);
      const highlighted = idx === -1
        ? this.escapeHtml(p.name)
        : this.escapeHtml(p.name.slice(0, idx)) +
          `<mark>${this.escapeHtml(p.name.slice(idx, idx + query.length))}</mark>` +
          this.escapeHtml(p.name.slice(idx + query.length));

      return `
        <li class="search-suggestion${i === 0 ? ' active' : ''}" data-pack-id="${p.id}" role="option">
          <span>${highlighted}</span>
          <span class="suggestion-category">${this.capitalizeFirst(p.category)}</span>
        </li>
      `;
    }).join('');

    box.querySelectorAll('.search-suggestion').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const id = parseInt(item.dataset.packId, 10);
        const pack = this.packs.find(p => p.id === id);
        if (pack) this.selectSearchSuggestion(pack);
      });
    });

    box.classList.remove('hidden');
  }

  selectSearchSuggestion(pack) {
    document.getElementById('search-input').value = pack.name;
    this.currentFilter.search = pack.name.toLowerCase();
    this.hideSearchSuggestions();
    document.getElementById('search-clear').classList.remove('hidden');

    if (pack.category === 'website' && pack.externalUrl) {
      this.openExternal(pack.externalUrl);
    } else {
      this.showDetail(pack);
    }
  }

  hideSearchSuggestions() {
    const box = document.getElementById('search-suggestions');
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  handleSearchKeydown(e) {
    const box = document.getElementById('search-suggestions');
    if (box.classList.contains('hidden')) return;

    const items = [...box.querySelectorAll('.search-suggestion')];
    if (items.length === 0) return;

    let activeIndex = items.findIndex(item => item.classList.contains('active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = items[activeIndex] || items[0];
      const id = parseInt(active.dataset.packId, 10);
      const pack = this.packs.find(p => p.id === id);
      if (pack) this.selectSearchSuggestion(pack);
      return;
    } else if (e.key === 'Escape') {
      this.hideSearchSuggestions();
      return;
    } else {
      return;
    }

    items.forEach(item => item.classList.remove('active'));
    items[activeIndex].classList.add('active');
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  handleCategoryClick(e) {
    const row = e.currentTarget;
    let category = row.dataset.category;
    // Favorites is a switch in the Filters popover: clicking it again goes back to All.
    if (category === 'favorites' && this.currentFilter.category === 'favorites') category = '';
    this.currentFilter.category = category;
    localStorage.setItem('selectedCategory', category);

    this.syncCategorySidebar();

    const currentEl = document.getElementById('library-category-current');
    if (currentEl) currentEl.textContent = row.querySelector('span:first-child').textContent.trim();
    this.closeFilterDropdownOnMobile('library-category-dropdown');

    this.applyFilters();
  }

  // On mobile, picking a single-select option (category / settings section)
  // should collapse the dropdown back down, like a native <select>. Desktop
  // keeps every <details> forced open, so this is a no-op there.
  closeFilterDropdownOnMobile(id) {
    if (window.innerWidth > 768) return;
    const details = document.getElementById(id);
    if (details) details.removeAttribute('open');
  }

  syncCategorySidebar() {
    document.querySelectorAll('#page-library .category-row').forEach(btn => {
      const isActive = btn.dataset.category === this.currentFilter.category;
      btn.classList.toggle('active', isActive);
      btn.setAttribute(btn.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(isActive));
      if (isActive) {
        const currentEl = document.getElementById('library-category-current');
        if (currentEl) currentEl.textContent = btn.querySelector('span:first-child').textContent.trim();
      }
    });
  }

  handleSort(e) {
    this.currentFilter.sort = e.target.value;
    this.applyFilters();
  }

  // Postel's law: be liberal in what the search accepts. Case, accents, apostrophes and
  // hyphens/underscores don't matter, and every word only has to appear somewhere.
  normalizeSearch(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['\u2019`]/g, '')
      .replace(/[-_.+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Real download count: the live counter once it has loaded, else the snapshot.
  downloadsOf(pack) {
    const live = this.liveDownloadCounts.get(pack.id);
    return live != null ? live : (pack.downloads || 0);
  }

  // Relevance score (higher is better). While searching, how well the words
  // match comes first (name beats tags beats description). Always on top of
  // that: popularity (log, so a huge pack can't bury everything), freshness
  // (recently updated packs fade out slowly) and a short boost for brand-new
  // packs so new uploads get seen. Pinned and discontinued packs are
  // placed by applyFilters.
  packScore(pack, words) {
    let score = 0;
    if (words.length) {
      const name = this.normalizeSearch(pack.name);
      const phrase = words.join(' ');
      const nameWords = name.split(' ');
      const tags = (pack.tags || []).map(t => this.normalizeSearch(t));
      if (name === phrase) score += 100;
      else if (name.startsWith(phrase)) score += 70;
      else if (name.includes(phrase)) score += 50;
      for (const w of words) {
        if (nameWords.some(n => n === w)) score += 14;
        else if (nameWords.some(n => n.startsWith(w))) score += 9;
        else if (name.includes(w)) score += 5;
        if (tags.some(t => t === w)) score += 6;
        else if (tags.some(t => t.includes(w))) score += 3;
      }
    }
    score += Math.log10(1 + this.downloadsOf(pack)) * 10;
    const updated = Date.parse(pack.updatedAt || pack.addedAt || '') || 0;
    if (updated) score += 15 * Math.exp(-Math.max(0, Date.now() - updated) / (90 * 86400000));
    const added = Date.parse(pack.addedAt || '') || 0;
    if (added && Date.now() - added < 14 * 86400000) score += 8;
    return score;
  }

  applyFilters() {
    let filtered = [...this.packs];

    if (localStorage.getItem('showDiscontinued') === 'false') {
      filtered = filtered.filter(pack => !pack.discontinued);
    }

    if (this.currentFilter.search) {
      const words = this.normalizeSearch(this.currentFilter.search).split(' ').filter(Boolean);
      filtered = filtered.filter(pack => {
        const haystack = this.normalizeSearch([pack.name, pack.description, ...(pack.tags || [])].join(' '));
        return words.every(word => haystack.includes(word));
      });
    }

    if (this.currentFilter.tags.size > 0) {
      filtered = filtered.filter(pack => (pack.tags || []).some(tag => this.currentFilter.tags.has(tag)));
    }

    if (this.currentFilter.category === 'favorites') {
      filtered = filtered.filter(pack => this.favorites.has(pack.id));
    } else if (this.currentFilter.category) {
      // A pinned pack (e.g. the Assets Pack) always belongs to the Packs
      // category only, regardless of its own actual category field.
      filtered = filtered.filter(pack =>
        pack.pinned ? this.currentFilter.category === 'packs' : pack.category === this.currentFilter.category
      );
    }

    switch (this.currentFilter.sort) {
      case 'recent':
        filtered.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        break;
      case 'oldest':
        filtered.sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
        break;
      case 'popular':
        filtered.sort((a, b) => this.downloadsOf(b) - this.downloadsOf(a));
        break;
      case 'least-popular':
        filtered.sort((a, b) => this.downloadsOf(a) - this.downloadsOf(b));
        break;
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        filtered.sort((a, b) => b.name.localeCompare(a.name));
        break;
      default: {
        const words = this.currentFilter.search ? this.normalizeSearch(this.currentFilter.search).split(' ').filter(Boolean) : [];
        const scores = new Map(filtered.map(p => [p.id, this.packScore(p, words)]));
        filtered.sort((a, b) => (scores.get(b.id) - scores.get(a.id)) || a.name.localeCompare(b.name));
      }
    }

    // Pinned packs always float to the top, regardless of sort order.
    // Also separate discontinued packs into their own group at the end.
    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.discontinued && !b.discontinued) return 1;
      if (!a.discontinued && b.discontinued) return -1;
      return 0;
    });

    this.filteredPacks = filtered;
    this.render();
  }

  setViewMode(mode) {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    localStorage.setItem('libraryViewMode', mode);
    this.applyViewMode();
    this.render();
  }

  applyViewMode() {
    const grid = document.getElementById('packs-grid');
    grid.classList.toggle('list-view', this.viewMode === 'list');

    const gridBtn = document.getElementById('view-grid-btn');
    const listBtn = document.getElementById('view-list-btn');
    gridBtn.classList.toggle('active', this.viewMode === 'grid');
    listBtn.classList.toggle('active', this.viewMode === 'list');
    gridBtn.setAttribute('aria-pressed', this.viewMode === 'grid');
    listBtn.setAttribute('aria-pressed', this.viewMode === 'list');
  }

  render() {
    const grid = document.getElementById('packs-grid');
    const emptyState = document.getElementById('empty-state');
    const resultsText = document.getElementById('results-text');

    document.getElementById('clients-timeline').classList.toggle('hidden', this.currentFilter.category !== 'clients');

    if (this.filteredPacks.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'block';
      const clearBtn = document.getElementById('empty-state-clear-btn');
      const hasActiveFilters = !!this.currentFilter.search || !!this.currentFilter.category || this.currentFilter.tags.size > 0;
      if (this.packsLoadError) {
        emptyState.querySelector('h2').textContent = "Couldn't load packs";
        emptyState.querySelector('p').textContent = 'Please check your connection and refresh the page.';
        if (clearBtn) clearBtn.classList.add('hidden');
      } else {
        emptyState.querySelector('h2').textContent = 'No packs found';
        emptyState.querySelector('p').textContent = hasActiveFilters
          ? 'Try adjusting your search or filters'
          : 'Nothing in this category yet, check back soon';
        if (clearBtn) clearBtn.classList.toggle('hidden', !hasActiveFilters);
      }
      resultsText.textContent = '0 projects';
      return;
    }

    emptyState.style.display = 'none';
    const count = this.filteredPacks.length;
    resultsText.textContent = `${count} result${count !== 1 ? "s" : ""}`;

    // Reusable card renderer
    const renderPackCards = (packs) => packs.map(pack => this.createPackCard(pack)).join('');

    // Packs sub-groups by Assets Pack compatibility; Clients sub-groups by
    // whether they're still actively maintained. Every other category
    // renders as one flat list.
    const renderCategoryPacks = (packsInCat, cat) => {
      if (cat === 'clients') {
        const pinned = packsInCat.filter(p => p.pinned);
        const rest = packsInCat.filter(p => !p.pinned);
        const working = rest.filter(p => !p.discontinued);
        const discontinued = rest.filter(p => p.discontinued);

        let html = '';
        if (pinned.length > 0) html += renderPackCards(pinned);
        if (working.length > 0) {
          html += this.createSubDivider('Working', 'assets-none');
          html += renderPackCards(working);
        }
        if (discontinued.length > 0) {
          html += this.createSubDivider('Discontinued', 'discontinued');
          html += renderPackCards(discontinued);
        }
        return html;
      }

      if (cat !== 'packs') return renderPackCards(packsInCat);

      // Pinned packs (e.g. the Assets Pack) always float above every sub-group.
      const pinned = packsInCat.filter(p => p.pinned);
      const rest = packsInCat.filter(p => !p.pinned);
      const discontinued = rest.filter(p => p.discontinued);
      const active = rest.filter(p => !p.discontinued);
      const needsAssets = active.filter(p => p.requiresAssets);
      const noAssets = active.filter(p => !p.requiresAssets);

      let html = '';
      if (pinned.length > 0) {
        html += renderPackCards(pinned);
      }
      if (needsAssets.length > 0) {
        html += this.createSubDivider('Assets Required', 'assets-required');
        html += renderPackCards(needsAssets);
      }
      if (noAssets.length > 0) {
        html += this.createSubDivider('No Assets Needed', 'assets-none');
        html += renderPackCards(noAssets);
      }
      if (discontinued.length > 0) {
        html += this.createSubDivider('Discontinued', 'discontinued');
        html += renderPackCards(discontinued);
      }
      return html;
    };

    if (this.currentFilter.search && !this.currentFilter.category) {
      // Searching: one list in rank order, so the best match is first whatever its category.
      grid.innerHTML = renderPackCards(this.filteredPacks);
    } else if (this.currentFilter.category === '') {
      // All categories view
      const pinnedPacks = this.filteredPacks.filter(p => p.pinned);
      const nonPinnedPacks = this.filteredPacks.filter(p => !p.pinned);

      let html = '';

      if (pinnedPacks.length > 0) {
        html += this.createCategoryDivider('pinned');
        html += renderPackCards(pinnedPacks);
      }

      html += CATEGORY_ORDER
        .map(cat => {
          const packsInCat = nonPinnedPacks.filter(p => p.category === cat);
          if (packsInCat.length === 0) return '';
          return this.createCategoryDivider(cat) + renderCategoryPacks(packsInCat, cat);
        })
        .join('');

      grid.innerHTML = html;
    } else if (this.currentFilter.category === 'packs' || this.currentFilter.category === 'clients') {
      grid.innerHTML = renderCategoryPacks(this.filteredPacks, this.currentFilter.category);
    } else {
      // Single category view
      grid.innerHTML = renderPackCards(this.filteredPacks);
    }

    // Collapsible category/sub-category sections: apply any already-collapsed
    // state (a divider carries the class from createCategoryDivider/createSubDivider,
    // but its sibling cards need it re-applied on every fresh render) and wire clicks.
    grid.querySelectorAll('.category-section-divider, .category-sub-divider').forEach(divider => {
      if (divider.classList.contains('section-collapsed')) {
        const isTopLevel = divider.classList.contains('category-section-divider');
        let el = divider.nextElementSibling;
        while (el) {
          if (isTopLevel && el.classList.contains('category-section-divider')) break;
          if (!isTopLevel && (el.classList.contains('category-section-divider') || el.classList.contains('category-sub-divider'))) break;
          el.classList.add('section-hidden');
          el = el.nextElementSibling;
        }
      }
    });

    this.fetchVisibleCardDownloadCounts();
  }

  // Card download counts come from packs.json's snapshot value (usually 0 -
  // it's only ever populated from a local .metadata.json that doesn't really
  // exist), so fetch each visible card's real count from the counter API,
  // once per pack per session.
  fetchVisibleCardDownloadCounts() {
    const cards = document.querySelectorAll('#packs-grid .downloads[data-pack-id]');
    const pending = [];
    cards.forEach(el => {
      const id = parseInt(el.dataset.packId, 10);
      if (this.liveDownloadCounts.has(id)) {
        el.textContent = this.formatCount(this.liveDownloadCounts.get(id));
        return;
      }
      const pack = this.packs.find(p => p.id === id);
      if (!pack) return;

      const totalPromise = (pack.versions && pack.versions.length > 1)
        ? Promise.all(pack.versions.map(v => this.fetchLiveDownloads(pack, v))).then(counts => counts.reduce((a, b) => a + b, 0))
        : this.fetchLiveDownloads(pack);

      pending.push(totalPromise.then(count => {
        this.liveDownloadCounts.set(id, count);
        const liveEl = document.querySelector(`#packs-grid .downloads[data-pack-id="${id}"]`);
        if (liveEl) liveEl.textContent = this.formatCount(count);
      }).catch(() => {}));
    });
    // The first ranking used snapshot numbers; once the real counts are in, rank once more.
    if (pending.length && !this.rankSettled) {
      this.rankSettled = true;
      Promise.all(pending).then(() => {
        if (this.currentFilter.sort === 'relevance' || this.currentFilter.sort === 'popular') this.applyFilters();
      });
    }
  }

  openExternal(url) {
    const newTab = localStorage.getItem('newTabLinks') !== 'false';
    if (newTab) {
      window.open(url, '_blank', 'noopener');
    } else {
      window.location.href = url;
    }
  }

  createCategoryDivider(category) {
    const label = category === 'pinned' ? 'Pinned' : this.capitalizeFirst(category);
    const key = `cat-${category}`;
    const collapsed = this.isSectionCollapsed(key);
    return `
      <div class="category-section-divider ${collapsed ? 'section-collapsed' : ''}" data-section-key="${key}">
        <span></span><p>${label}</p><span></span>
        <i class="fas fa-chevron-down divider-toggle-icon"></i>
      </div>
    `;
  }

  createSubDivider(label, kind) {
    const icons = {
      'assets-required': '<i class="fas fa-triangle-exclamation"></i>',
      'assets-none': '<i class="fas fa-check"></i>',
      'discontinued': '<i class="fas fa-ban"></i>'
    };
    const icon = icons[kind] || '';
    const key = `sub-${kind}`;
    const collapsed = this.isSectionCollapsed(key);
    return `
      <div class="category-sub-divider category-sub-divider-${kind} ${collapsed ? 'section-collapsed' : ''}" data-section-key="${key}">
        ${icon} <span>${label}</span>
        <i class="fas fa-chevron-down divider-toggle-icon"></i>
      </div>
    `;
  }

  isImagePath(value) {
    return !!value && (value.startsWith('http') || value.includes('/'));
  }

  assetsTag(pack) {
    if (pack.discontinued) {
      return `<span class="assets-tag assets-tag-discontinued"><i class="fas fa-ban"></i> Discontinued</span>`;
    }
    if (pack.pinned || pack.community || pack.category !== 'packs') return '';
    return pack.requiresAssets
      ? `<span class="assets-tag assets-tag-required"><i class="fas fa-triangle-exclamation"></i> Assets Required</span>`
      : `<span class="assets-tag assets-tag-none"><i class="fas fa-check"></i> No Assets Needed</span>`;
  }

  favoriteButton(pack) {
    const active = this.isFavorite(pack.id);
    return `
      <button type="button" class="pack-favorite-btn ${active ? 'active' : ''}" data-pack-id="${pack.id}" aria-label="Toggle favorite" aria-pressed="${active}">
        <i class="${active ? 'fas' : 'far'} fa-heart"></i>
      </button>
    `;
  }

  pictureTag(src, webpSrc, alt = '', attrs = '') {
    if (!webpSrc) return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async" ${attrs}>`;
    return `<picture><source type="image/webp" srcset="${webpSrc}"><img src="${src}" alt="${alt}" loading="lazy" decoding="async" ${attrs}></picture>`;
  }

  fallbackIconContent(pack) {
    if (pack.faIcon) return `<i class="fas ${pack.faIcon} pack-letter"></i>`;
    return `<span class="pack-letter">${this.escapeHtml(pack.name.charAt(0).toUpperCase())}</span>`;
  }

  mcVersionTag(pack) {
    if (!pack.mcVersion) return '';
    return `<span class="mc-version-tag"><i class="fas fa-cube"></i> ${this.escapeHtml(pack.mcVersion)}</span>`;
  }

  comingSoonTag(pack) {
    if (!pack.comingSoon) return '';
    return `<span class="assets-tag assets-tag-coming-soon"><i class="fas fa-clock"></i> Coming Soon</span>`;
  }

  // Tracks, per favorited pack, the updatedAt value the user last saw its
  // detail page with - so we can badge "Updated" on cards for favorites
  // that changed since the user last looked.
  loadSeenPackUpdates() {
    try {
      const raw = localStorage.getItem('seenPackUpdates');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  markPackUpdateSeen(pack) {
    if (!pack.updatedAt) return;
    const seen = this.loadSeenPackUpdates();
    seen[pack.id] = pack.updatedAt;
    try {
      localStorage.setItem('seenPackUpdates', JSON.stringify(seen));
    } catch (e) { /* storage full or unavailable */ }
  }

  hasUnseenUpdate(pack) {
    if (!this.isFavorite(pack.id) || !pack.updatedAt) return false;
    const seen = this.loadSeenPackUpdates();
    const lastSeen = seen[pack.id];
    if (!lastSeen) return true;
    return new Date(pack.updatedAt) > new Date(lastSeen);
  }

  updatedBadge(pack) {
    if (!this.hasUnseenUpdate(pack)) return '';
    return `<span class="updated-badge" title="This favorite has been updated since you last viewed it"><i class="fas fa-star"></i> Updated</span>`;
  }

  isNewPack(pack) {
    if (!pack.addedAt) return false;
    const ageMs = Date.now() - new Date(pack.addedAt).getTime();
    return ageMs >= 0 && ageMs < 14 * 24 * 60 * 60 * 1000;
  }

  newBadge(pack) {
    if (!this.isNewPack(pack)) return '';
    return `<span class="new-badge" title="Added in the last 14 days">New</span>`;
  }

  popularThreshold() {
    const downloadCounts = this.packs
      .map(p => this.liveDownloadCounts.get(p.id) ?? p.downloads ?? 0)
      .filter(n => n > 0)
      .sort((a, b) => b - a);
    if (downloadCounts.length < 5) return Infinity;
    return downloadCounts[Math.floor(downloadCounts.length * 0.1)] ?? Infinity;
  }

  popularBadge(pack) {
    const count = this.liveDownloadCounts.get(pack.id) ?? pack.downloads ?? 0;
    if (count === 0 || count < this.popularThreshold()) return '';
    return `<span class="popular-badge" title="One of the most downloaded packs"><i class="fas fa-fire"></i> Popular</span>`;
  }

  createPackCard(pack) {
    const hasImage = this.isImagePath(pack.thumbnail);
    const requiredBadge = pack.pinned
      ? `<span class="pinned-badge"><i class="fas fa-thumbtack"></i> Required</span>`
      : '';
    const flags = [
      requiredBadge,
      this.communityTag(pack),
      this.mcVersionTag(pack),
      this.assetsTag(pack),
      this.comingSoonTag(pack),
      this.newBadge(pack),
      this.popularBadge(pack),
      this.updatedBadge(pack)
    ].join('');
    const latest = (pack.versions && pack.versions[0]) || pack;
    const version = String(latest.version || pack.version || '').replace(/^v/i, '');
    const size = latest.size || pack.size || '';
    const categoryLabel = pack.pinned ? 'Required' : this.capitalizeFirst(pack.category);
    const updatedAgo = this.timeAgo(pack.updatedAt || (pack.versions && pack.versions[0] && pack.versions[0].date) || pack.addedAt);
    const iconContent = hasImage
      ? this.pictureTag(pack.thumbnail, pack.thumbnailWebp)
      : this.fallbackIconContent(pack);

    // One markup for both layouts (grid cards and list rows); library.css
    // decides what each view shows.
    return `
      <div class="pack-card ${pack.pinned ? 'pack-card-pinned' : ''}${this.downloadedIds().has(pack.id) ? ' is-downloaded' : ''}" data-pack-id="${pack.id}">
        <div class="pack-thumbnail"><span class="pack-icon-badge">${iconContent}</span><span class="pack-cat-chip">${this.escapeHtml(this.capitalizeFirst(pack.category))}</span></div>
        ${this.favoriteButton(pack)}
        <div class="pack-content">
          <div class="pack-title-row">
            <span class="pack-name">${this.escapeHtml(pack.name)}</span>
          </div>
          <span class="pack-author">by ${this.escapeHtml(pack.author || 'Pepe')}</span>
          ${flags ? `<div class="pack-flags">${flags}</div>` : ''}
          <p class="pack-description">${this.escapeHtml(pack.description)}</p>
          <div class="pack-meta">
            <span class="pack-meta-main">${this.escapeHtml(categoryLabel)}${version ? ` &middot; v${this.escapeHtml(version)}` : ''}</span>
            ${size ? `<span class="pack-meta-size">${this.escapeHtml(size)}</span>` : ''}
          </div>
        </div>
        <div class="pack-footer">
          <span class="downloads" data-pack-id="${pack.id}">${this.formatCount(this.liveDownloadCounts.get(pack.id) ?? pack.downloads)}</span>
          ${updatedAgo ? `<span class="pack-updated" title="Last updated"><i class="far fa-clock" aria-hidden="true"></i> ${updatedAgo}</span>` : ''}
          <span class="pack-dl-btn">${this.downloadedIds().has(pack.id) ? '<i class="fas fa-check"></i> Downloaded' : '<i class="fas fa-download"></i> Download'}</span>
        </div>
      </div>
    `;
  }

  trackRecentlyViewed(pack) {
    if (!getBoolSetting('trackRecentlyViewed')) return;
    let ids;
    try {
      const raw = localStorage.getItem('recentlyViewedPacks');
      ids = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(ids)) ids = [];
    } catch (e) {
      ids = [];
    }
    ids = ids.filter(id => id !== pack.id);
    ids.unshift(pack.id);
    try {
      localStorage.setItem('recentlyViewedPacks', JSON.stringify(ids.slice(0, 20)));
    } catch (e) { /* storage full or unavailable */ }
  }

  // Community pack pages use the author's own profile picture and banner.
  async applyAuthorLook(pack) {
    if (!pack.authorId) return;
    await null; // let showDetail finish setting currentPack
    this.authorLooks = this.authorLooks || new Map();
    let user = this.authorLooks.get(pack.authorId);
    if (!user) {
      try {
        const res = await this.authFetch(`/api/users/${encodeURIComponent(pack.authorId)}`);
        if (res.ok) user = (await res.json()).user;
      } catch (e) { /* keep the initial */ }
      if (user) this.authorLooks.set(pack.authorId, user);
    }
    if (!user || this.currentPack !== pack) return;
    if (user.avatarUrl) document.getElementById('detail-avatar').src = user.avatarUrl;
    const bg = document.querySelector('#detail-banner img.detail-banner-bg');
    if (user.bannerUrl && bg) {
      const pic = bg.closest('picture');
      if (pic) pic.querySelectorAll('source').forEach(src => src.remove());
      bg.src = user.bannerUrl;
      bg.style.display = '';
    }
  }

  showDetail(pack, { push = true } = {}) {
    this.trackRecentlyViewed(pack);
    this.markPackUpdateSeen(pack);
    const hasImage = this.isImagePath(pack.thumbnail);
    const hasBanner = this.isImagePath(pack.bannerUrl);
    const bannerSrc = hasBanner ? pack.bannerUrl : DEFAULT_BANNER_URL;

    document.getElementById('detail-banner').innerHTML = `
      ${this.pictureTag(bannerSrc, hasBanner ? pack.bannerUrlWebp : null, '', `class="detail-banner-bg" onerror="this.style.display='none'"`)}
      <span class="detail-splash-name">${this.escapeHtml(pack.name)}</span>
    `;
    document.getElementById('detail-thumb').innerHTML = hasImage
      ? this.pictureTag(pack.thumbnail, pack.thumbnailWebp, this.escapeHtml(pack.name))
      : this.fallbackIconContent(pack);

    document.getElementById('detail-name').textContent = pack.name;
    document.getElementById('detail-badge').textContent = this.capitalizeFirst(pack.category);
    document.getElementById('detail-author').textContent = `by ${pack.author || 'Unknown'}${pack.community ? ' · Community upload' : ''}`;
    document.getElementById('detail-description').textContent = pack.description;

    const showsAssetsState = !pack.discontinued && !pack.pinned && !pack.community && pack.category === 'packs';
    const assetsBadge = document.getElementById('detail-assets-badge');
    assetsBadge.classList.toggle('hidden', !(showsAssetsState && pack.requiresAssets));
    assetsBadge.onclick = () => this.showAssetsModal(pack, null);

    document.getElementById('detail-assets-none-badge').classList.toggle('hidden', !(showsAssetsState && !pack.requiresAssets));
    document.getElementById('detail-discontinued-badge').classList.toggle('hidden', !pack.discontinued);
    document.getElementById('detail-coming-soon-badge').classList.toggle('hidden', !pack.comingSoon);

    document.getElementById('detail-discontinued-notice').classList.toggle('hidden', !pack.discontinued);
    document.getElementById('detail-coming-soon-notice').classList.toggle('hidden', !pack.comingSoon);

    const mcVersionStat = document.getElementById('detail-mcversion-stat');
    mcVersionStat.classList.toggle('hidden', !pack.mcVersion);
    document.getElementById('detail-mcversion').textContent = pack.mcVersion || '';

    this.renderNotice(pack);
    this.renderShowcase(pack);
    this.renderRelatedPacks(pack);
    this.loadPackRating(pack);
    this.loadComments(pack);

    const hasOlderVersions = !!(pack.versions && pack.versions.length > 1);
    document.getElementById('versions-sub').textContent = hasOlderVersions
      ? `Every release of ${pack.name}, newest first. Older versions stay available in case a newer one doesn't work for you.`
      : `Download the current release of ${pack.name}.`;
    this.renderVersionsList(pack);
    this.renderExtensionsList(pack);

    this.selectedVersionIndex = 0;
    const hasMultipleVersions = !!(pack.versions && pack.versions.length > 1);
    document.getElementById('version-select-wrap').classList.toggle('hidden', !hasMultipleVersions || pack.comingSoon);
    if (hasMultipleVersions) this.renderVersionSelectMenu(pack);

    const detailDownload = document.getElementById('detail-download');
    detailDownload.removeAttribute('data-raw-url');
    detailDownload.removeAttribute('data-loot-url');
    if (pack.comingSoon) {
      detailDownload.classList.add('btn-download-disabled');
      detailDownload.removeAttribute('href');
      detailDownload.innerHTML = `<i class="fas fa-clock"></i> Coming Soon`;
    } else if (!pack.downloadUrl && !(pack.versions && pack.versions.length)) {
      detailDownload.classList.add('btn-download-disabled');
      detailDownload.removeAttribute('href');
      detailDownload.innerHTML = `<i class="fas fa-ban"></i> No Longer Available`;
    } else {
      detailDownload.classList.remove('btn-download-disabled');
      const latestVersion = (pack.versions && pack.versions[0]) || pack;
      const rawUrl = latestVersion.downloadUrl || pack.downloadUrl;
      const lootUrl = latestVersion.lootUrl || pack.lootUrl || '';
      detailDownload.dataset.rawUrl = rawUrl;
      detailDownload.dataset.lootUrl = lootUrl;
      detailDownload.href = getMonetizedUrl(rawUrl, lootUrl, undefined, this.lvIdFor(pack));
      detailDownload.innerHTML = pack.discontinued
        ? `<i class="fas fa-download"></i> Download (Archived)`
        : `<i class="fas fa-download"></i> Download`;
    }
    this.applyLinkTargets();

    const detailAvatar = document.getElementById('detail-avatar');
    if (pack.community) {
      // Someone else's pack: show their picture, or their initial when they have none
      // (never the site's own logo, which looks like it's Pepe's).
      const letter = (pack.author || '?').trim().charAt(0).toUpperCase() || '?';
      const hue = [...(pack.author || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0);
      const fallback = 'data:image/svg+xml,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue},45%,40%)"/><text x="32" y="43" font-family="Arial,sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="#fff">${this.escapeHtml(letter)}</text></svg>`);
      detailAvatar.onerror = null;
      detailAvatar.src = fallback;
      this.applyAuthorLook(pack);
      // Straight from the uploads service too, so the author's banner doesn't wait on anything else.
      const bannerImg = document.querySelector('#detail-banner img.detail-banner-bg');
      if (bannerImg && pack.authorId) {
        const mine = `${UPLOADS_API}/api/community/banners/${encodeURIComponent(pack.authorId)}`;
        bannerImg.removeAttribute('onerror');
        bannerImg.onerror = () => { bannerImg.onerror = null; bannerImg.src = DEFAULT_BANNER_URL; };
        bannerImg.src = mine;
      }
    } else {
      detailAvatar.onerror = null;
      detailAvatar.src = 'assets/pepe-profile.png';
    }
    document.getElementById('detail-author-name').textContent = pack.author || 'Unknown';
    document.getElementById('detail-made').textContent = this.formatDate(pack.addedAt || pack.createdAt);
    document.getElementById('detail-updated').textContent = this.formatDate(pack.updatedAt || pack.addedAt || pack.createdAt);

    this.currentPack = pack;
    this.syncDetailFavorite();
    this.syncCustomizerLink(pack);
    if (hasMultipleVersions) {
      // renderVersionsList() above already fetches each version's own count
      // and fills in #detail-downloads for the currently selected version.
      document.getElementById('detail-downloads').textContent = '…';
    } else {
      this.updateDownloadsDisplay(pack, pack.downloads);
      this.fetchLiveDownloads(pack).then(count => {
        pack.downloads = count;
        if (this.currentPack === pack) this.updateDownloadsDisplay(pack, count);
      });
    }

    document.getElementById('browse-view').classList.add('hidden');
    document.getElementById('detail-view').classList.remove('hidden');
    document.querySelector('#page-library .page-hero').classList.add('hidden');
    document.querySelector('#page-library .search-bar-wrap').classList.add('hidden');
    window.scrollTo(0, 0);

    if (push) {
      history.pushState({ page: 'pack', id: pack.id }, '', `/pack/${this.packSlug(pack)}`);
    }
    document.title = `${pack.name} · Pepe`;
  }

  async showUserProfile(userId, { push = true } = {}) {
    window.router.show('user', { push: false });
    if (push) {
      history.pushState({ page: 'user', id: userId }, '', `/user/${userId}`);
    }
    document.title = 'Profile · Pepe';

    const nameEl = document.getElementById('user-profile-name-text');
    const avatarEl = document.getElementById('user-profile-avatar');
    const joinedEl = document.getElementById('user-profile-joined');
    const statsEl = document.getElementById('user-profile-stats');
    const commentsEl = document.getElementById('user-profile-comments');
    const authorBadgeEl = document.getElementById('user-profile-author-badge');

    // The account being shown (accounts worker user), for follows, DMs and packs.
    this.viewedProfile = null;
    // Skeleton until the account loads, so the page never flashes someone else's name or avatar.
    nameEl.innerHTML = '<span class="sk sk-inline" style="width:180px;height:34px" aria-label="Loading profile"></span>';
    avatarEl.classList.add('sk', 'sk-img');
    avatarEl.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    joinedEl.innerHTML = '<span class="sk sk-inline sk-line" style="width:220px"></span>';
    statsEl.textContent = '';
    commentsEl.innerHTML = [0, 1].map(() => '<div class="sk-card"><span class="sk sk-line" style="width:90px"></span><span class="sk sk-line" style="width:60%"></span></div>').join('');
    const doneLoading = () => avatarEl.classList.remove('sk', 'sk-img');
    authorBadgeEl.classList.add('hidden');
    const bannerImg = document.getElementById('user-profile-banner-img');
    const editBtn = document.getElementById('user-profile-edit-btn');
    bannerImg.classList.add('hidden');
    bannerImg.removeAttribute('src');
    editBtn.classList.add('hidden');

    try {
      const res = await this.authFetch(`/api/users/${userId}`);
      if (!res.ok) {
        doneLoading();
        avatarEl.src = 'assets/pepe-profile.png';
        nameEl.textContent = 'User not found';
        joinedEl.textContent = '';
        commentsEl.innerHTML = '';
        return;
      }
      const data = await res.json();
      doneLoading();
      this.viewedProfile = data.user;
      nameEl.textContent = data.user.name || data.user.username || 'Unknown';
      avatarEl.src = data.user.avatarUrl || 'assets/pepe-profile.png';
      joinedEl.textContent = data.user.joinedAt ? `Joined ${this.formatDate(data.user.joinedAt)}` : '';
      statsEl.textContent = `${data.commentCount} comment${data.commentCount === 1 ? '' : 's'} · ${data.ratingCount} rating${data.ratingCount === 1 ? '' : 's'}`;
      authorBadgeEl.classList.toggle('hidden', !data.user.isAuthor);
      if (data.user.bannerUrl) {
        bannerImg.src = data.user.bannerUrl;
        bannerImg.classList.remove('hidden');
      }
      editBtn.classList.toggle('hidden', !(this.currentUser && data.user.id && this.currentUser.id === data.user.id));
      editBtn.onclick = () => this.openProfileModal();

      const commentsRes = await this.authFetch(`/api/users/${userId}/comments`);
      if (commentsRes.ok) {
        const commentsData = await commentsRes.json();
        commentsEl.innerHTML = commentsData.comments.length
          ? commentsData.comments.map((c) => `
              <div class="comment-item">
                <div class="comment-body">
                  <div class="comment-header">
                    <span class="comment-time">${this.formatDate(c.createdAt)}</span>
                  </div>
                  <p class="comment-text">${this.escapeHtml(c.text)}</p>
                </div>
              </div>
            `).join('')
          : '<p class="comments-empty">No comments yet.</p>';
      } else {
        commentsEl.innerHTML = '<p class="comments-empty">Comments couldn\'t be loaded.</p>';
      }
    } catch (e) {
      doneLoading();
      avatarEl.src = 'assets/pepe-profile.png';
      nameEl.textContent = 'Could not load profile';
      joinedEl.textContent = '';
      commentsEl.innerHTML = '';
    }
  }

  closeUserProfile() {
    history.back();
  }

  showBrowse({ push = true } = {}) {
    document.getElementById('detail-view').classList.add('hidden');
    document.getElementById('browse-view').classList.remove('hidden');
    document.querySelector('#page-library .page-hero').classList.remove('hidden');
    document.querySelector('#page-library .search-bar-wrap').classList.remove('hidden');

    if (push) {
      history.pushState({ page: 'library' }, '', '/library');
    }
    document.title = 'Pepe';
  }

  copyPackLink() {
    const url = `${location.origin}/pack/${this.packSlug(this.currentPack)}`;
    const btn = document.getElementById('detail-share-btn');
    const revert = () => { btn.innerHTML = `<i class="fas fa-link"></i> Share`; };
    const showCopied = () => {
      btn.innerHTML = `<i class="fas fa-check"></i> Copied!`;
      setTimeout(revert, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showCopied, () => alert(url));
    } else {
      alert(url);
    }
  }

  copyPackInfo() {
    const pack = this.currentPack;
    if (!pack) return;
    const version = (pack.versions && pack.versions[this.selectedVersionIndex]) || pack;
    const lines = [
      `Pack: ${pack.name}`,
      `Version: ${version.version || pack.version || '1.0.0'}`,
      `MC Version: ${pack.mcVersion || 'N/A'}`,
      `Category: ${this.capitalizeFirst(pack.category)}`,
      `Link: ${location.origin}/pack/${this.packSlug(pack)}`
    ];
    const text = lines.join('\n');
    const btn = document.getElementById('detail-copy-info-btn');
    const revert = () => { btn.innerHTML = `<i class="fas fa-copy"></i> Copy Info`; };
    const showCopied = () => {
      btn.innerHTML = `<i class="fas fa-check"></i> Copied!`;
      setTimeout(revert, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, () => alert(text));
    } else {
      alert(text);
    }
  }

  renderRelatedPacks(pack) {
    const block = document.getElementById('related-packs-block');
    const grid = document.getElementById('related-packs-grid');
    const related = this.packs
      .filter(p => p.id !== pack.id && p.category === pack.category && !p.comingSoon)
      .slice(0, 4);

    if (related.length === 0) {
      block.classList.add('hidden');
      grid.innerHTML = '';
      return;
    }

    block.classList.remove('hidden');
    grid.innerHTML = related.map(p => {
      const hasImage = this.isImagePath(p.thumbnail);
      const iconContent = hasImage
        ? this.pictureTag(p.thumbnail, p.thumbnailWebp)
        : this.fallbackIconContent(p);
      return `
        <button type="button" class="related-pack-card" data-pack-id="${p.id}">
          <span class="related-pack-icon">${iconContent}</span>
          <span class="related-pack-text">
            <span class="related-pack-name">${this.escapeHtml(p.name)}</span>
            <span class="related-pack-meta">${this.escapeHtml(this.capitalizeFirst(p.category))}${(((p.versions && p.versions[0]) || p).version) ? ' &middot; v' + this.escapeHtml(String(((p.versions && p.versions[0]) || p).version).replace(/^v/i, '')) : ''}</span>
          </span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.related-pack-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.packId, 10);
        const target = this.packs.find(p => p.id === id);
        if (target) this.showDetail(target);
      });
    });
  }

  getVoterId() {
    let id = null;
    try {
      id = localStorage.getItem('voterId');
    } catch (e) { /* storage unavailable - fall back to a per-call id */ }
    if (!id) {
      id = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try {
        localStorage.setItem('voterId', id);
      } catch (e) { /* not persisted - not fatal */ }
    }
    return id;
  }

  renderStarsDisplay(average) {
    const rounded = Math.round(average);
    return Array.from({ length: 5 }, (_, i) =>
      `<i class="fas fa-star${i < rounded ? ' rating-star-filled' : ''}"></i>`
    ).join('');
  }

  async loadPackRating(pack) {
    const starsDisplay = document.getElementById('rating-average-stars');
    const averageText = document.getElementById('rating-average-text');
    const starButtons = document.querySelectorAll('#rating-stars-input .rating-star');
    const voterId = this.getVoterId();

    starsDisplay.innerHTML = this.renderStarsDisplay(0);
    averageText.textContent = '…';
    starButtons.forEach(btn => btn.classList.remove('rating-star-active'));

    try {
      const res = await fetch(`${API_BASE}/api/ratings/${this.packSlug(pack)}`);
      const data = await res.json();
      if (this.currentPack !== pack) return;
      starsDisplay.innerHTML = this.renderStarsDisplay(data.average || 0);
      averageText.textContent = data.count > 0
        ? `${data.average.toFixed(1)} (${data.count} rating${data.count !== 1 ? 's' : ''})`
        : 'No ratings yet';

      const myRating = parseInt(localStorage.getItem(`myRating:${this.packSlug(pack)}`) || '0', 10);
      starButtons.forEach(btn => {
        btn.classList.toggle('rating-star-active', parseInt(btn.dataset.value, 10) <= myRating);
      });
    } catch (e) {
      averageText.textContent = 'No ratings yet';
    }
  }

  async submitPackRating(pack, rating) {
    const voterId = this.getVoterId();
    const slug = this.packSlug(pack);
    localStorage.setItem(`myRating:${slug}`, String(rating));
    try {
      const res = await fetch(`${API_BASE}/api/ratings/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voterId, rating }),
      });
      const data = await res.json();
      if (this.currentPack !== pack) return;
      document.getElementById('rating-average-stars').innerHTML = this.renderStarsDisplay(data.average || 0);
      document.getElementById('rating-average-text').textContent =
        `${data.average.toFixed(1)} (${data.count} rating${data.count !== 1 ? 's' : ''})`;
    } catch (e) { /* rating submission is best-effort */ }
  }

  // ===== Auth (Google / GitHub login via Cloudflare Worker) =====

  captureSessionFromUrl() {
    const params = new URLSearchParams(location.search);
    const session = params.get('session');
    if (!session) return;
    localStorage.setItem('sessionToken', session);
    this.pendingNewAccount = true;
    params.delete('session');
    const newSearch = params.toString();
    const newUrl = location.pathname + (newSearch ? `?${newSearch}` : '') + location.hash;
    history.replaceState(history.state, '', newUrl);
  }

  getSessionToken() {
    try {
      return localStorage.getItem('sessionToken');
    } catch (e) {
      return null; // storage blocked (private mode / site data cleared) - treat as signed out
    }
  }

  // ===== Multi-account support =====
  // Every signed-in provider/email account the visitor has added on this
  // browser is kept as {token, user} in localStorage so they can switch
  // between them without re-authenticating each time - similar to Google's
  // or GitHub's "post as" account switcher.

  getAccounts() {
    try {
      const raw = localStorage.getItem('accounts');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  saveAccounts(accounts) {
    localStorage.setItem('accounts', JSON.stringify(accounts));
  }

  addAccount(token, user) {
    const accounts = this.getAccounts().filter((a) => a.user.id !== user.id);
    accounts.push({ token, user });
    this.saveAccounts(accounts);
    localStorage.setItem('sessionToken', token);
  }

  removeAccount(token) {
    const accounts = this.getAccounts().filter((a) => a.token !== token);
    this.saveAccounts(accounts);
    return accounts;
  }

  async switchAccount(token) {
    localStorage.setItem('sessionToken', token);
    document.getElementById('auth-account-menu').classList.add('hidden');
    await this.refreshAuthState();
  }

  async authFetch(path, options = {}) {
    const token = this.getSessionToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API_BASE}${path}`, { ...options, headers });
  }

  async setupAuth() {
    document.getElementById('auth-login-btn').addEventListener('click', () => {
      document.getElementById('auth-login-menu').classList.toggle('hidden');
      document.getElementById('auth-account-menu').classList.add('hidden');
    });
    document.getElementById('auth-user-btn').addEventListener('click', () => {
      document.getElementById('auth-account-menu').classList.toggle('hidden');
      document.getElementById('auth-login-menu').classList.add('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#auth-control')) {
        document.getElementById('auth-login-menu').classList.add('hidden');
        document.getElementById('auth-account-menu').classList.add('hidden');
      }
    });

    document.getElementById('auth-login-google').addEventListener('click', () => this.startLogin('google'));
    document.getElementById('auth-login-github').addEventListener('click', () => this.startLogin('github'));
    document.getElementById('auth-login-email-btn').addEventListener('click', () => this.openEmailAuthModal());
    document.getElementById('auth-logout-btn').addEventListener('click', () => this.logout());
    document.getElementById('auth-edit-profile-btn').addEventListener('click', () => this.openProfileModal());
    document.getElementById('auth-view-profile-btn').addEventListener('click', () => {
      if (this.currentUser) this.showUserProfile(this.currentUser.username || this.currentUser.id);
    });
    document.getElementById('user-profile-back-link').addEventListener('click', (e) => {
      e.preventDefault();
      this.closeUserProfile();
    });
    document.getElementById('auth-add-account-btn').addEventListener('click', () => {
      document.getElementById('auth-account-menu').classList.add('hidden');
      document.getElementById('auth-login-menu').classList.remove('hidden');
    });

    this.authFormMode = 'login';
    document.getElementById('auth-form-toggle-btn').addEventListener('click', () => {
      this.setAuthFormMode(this.authFormMode === 'login' ? 'signup' : 'login');
    });

    document.getElementById('auth-password-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitAuthForm();
    });

    document.getElementById('email-auth-modal-close').addEventListener('click', () => this.closeEmailAuthModal());

    document.getElementById('profile-modal-close').addEventListener('click', () => this.closeProfileModal());
    document.getElementById('profile-save-btn').addEventListener('click', () => this.saveProfile());
    document.getElementById('profile-avatar-pick-btn').addEventListener('click', () => {
      document.getElementById('profile-avatar-file').click();
    });
    document.getElementById('profile-avatar-remove-btn').addEventListener('click', () => {
      this.pendingAvatarDataUrl = '';
      document.getElementById('profile-avatar-file').value = '';
      document.getElementById('profile-avatar-preview').src = 'assets/pepe-profile.png';
      document.getElementById('profile-avatar-remove-btn').classList.add('hidden');
      document.getElementById('profile-avatar-error').classList.add('hidden');
    });
    document.getElementById('profile-avatar-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const errorEl = document.getElementById('profile-avatar-error');
      errorEl.classList.add('hidden');
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        errorEl.textContent = 'Please choose a PNG, JPEG, or WebP image.';
        errorEl.classList.remove('hidden');
        return;
      }
      try {
        const dataUrl = await this.resizeImageToDataUrl(file, 256, 256);
        this.pendingAvatarDataUrl = dataUrl;
        document.getElementById('profile-avatar-preview').src = dataUrl;
        document.getElementById('profile-avatar-remove-btn').classList.remove('hidden');
      } catch (err) {
        errorEl.textContent = 'Could not process that image. Please try another.';
        errorEl.classList.remove('hidden');
      }
    });

    document.getElementById('profile-banner-pick-btn').addEventListener('click', () => {
      document.getElementById('profile-banner-file').click();
    });
    document.getElementById('profile-banner-remove-btn').addEventListener('click', () => {
      this.pendingBannerDataUrl = '';
      document.getElementById('profile-banner-file').value = '';
      const preview = document.getElementById('profile-banner-preview');
      preview.src = '';
      preview.classList.add('hidden');
      document.getElementById('profile-banner-remove-btn').classList.add('hidden');
      document.getElementById('profile-banner-error').classList.add('hidden');
    });
    document.getElementById('profile-banner-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const errorEl = document.getElementById('profile-banner-error');
      errorEl.classList.add('hidden');
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        errorEl.textContent = 'Please choose a PNG, JPEG, or WebP image.';
        errorEl.classList.remove('hidden');
        return;
      }
      try {
        const dataUrl = await this.resizeImageToDataUrl(file, 960, 240);
        this.pendingBannerDataUrl = dataUrl;
        const preview = document.getElementById('profile-banner-preview');
        preview.src = dataUrl;
        preview.classList.remove('hidden');
        document.getElementById('profile-banner-remove-btn').classList.remove('hidden');
      } catch (err) {
        errorEl.textContent = 'Could not process that image. Please try another.';
        errorEl.classList.remove('hidden');
      }
    });

    document.getElementById('comment-submit-btn').addEventListener('click', () => this.submitComment());

    await this.refreshAuthState();
  }

  startLogin(provider) {
    const redirect = encodeURIComponent(location.href);
    location.href = `${API_BASE}/auth/${provider}/start?redirect=${redirect}`;
  }

  openEmailAuthModal() {
    document.getElementById('auth-login-menu').classList.add('hidden');
    document.getElementById('auth-password-form').reset();
    document.getElementById('auth-form-error').classList.add('hidden');
    this.setAuthFormMode('login');
    document.getElementById('email-auth-modal-overlay').classList.remove('hidden');
  }

  closeEmailAuthModal() {
    document.getElementById('email-auth-modal-overlay').classList.add('hidden');
  }

  setAuthFormMode(mode) {
    this.authFormMode = mode;
    const isSignup = mode === 'signup';
    document.getElementById('auth-username-input').classList.toggle('hidden', !isSignup);
    document.getElementById('auth-password-input').autocomplete = isSignup ? 'new-password' : 'current-password';
    document.getElementById('auth-form-submit-btn').textContent = isSignup ? 'Sign up' : 'Login';
    document.getElementById('email-auth-modal-title').textContent = isSignup ? 'Sign up' : 'Login';
    document.getElementById('email-auth-modal-sub').textContent = isSignup
      ? 'Create a new account with your email and password.'
      : 'Sign in with your email and password.';
    document.getElementById('auth-form-toggle-btn').textContent = isSignup
      ? 'Already have an account? Login'
      : "Don't have an account? Sign up";
    document.getElementById('auth-form-error').classList.add('hidden');
  }

  async submitAuthForm() {
    const errorEl = document.getElementById('auth-form-error');
    errorEl.classList.add('hidden');

    const email = document.getElementById('auth-email-input').value.trim();
    const password = document.getElementById('auth-password-input').value;
    const isSignup = this.authFormMode === 'signup';
    const path = isSignup ? '/auth/signup' : '/auth/login';
    const body = isSignup
      ? { email, password, displayName: document.getElementById('auth-username-input').value.trim() }
      : { email, password };

    const btn = document.getElementById('auth-form-submit-btn');
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || 'Something went wrong.';
        errorEl.classList.remove('hidden');
        return;
      }
      this.addAccount(data.session, data.user);
      this.currentUser = data.user;
      this.renderAuthUI();
      this.closeEmailAuthModal();
      document.getElementById('auth-password-form').reset();
    } catch (e) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  }

  async logout() {
    const token = this.getSessionToken();
    if (token) {
      this.authFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    }
    const remaining = this.removeAccount(token);
    document.getElementById('auth-account-menu').classList.add('hidden');

    if (remaining.length > 0) {
      // Signing out of one account drops back to another already-added
      // account, rather than a fully signed-out state, to match how
      // multi-account switchers on other sites behave.
      localStorage.setItem('sessionToken', remaining[0].token);
      await this.refreshAuthState();
    } else {
      localStorage.removeItem('sessionToken');
      this.currentUser = null;
      this.renderAuthUI();
    }
  }

  async refreshAuthState() {
    const token = this.getSessionToken();
    if (!token) {
      this.currentUser = null;
      this.renderAuthUI();
      return;
    }
    try {
      const res = await this.authFetch('/api/session');
      const data = await res.json();
      this.currentUser = data.user || null;
      if (this.currentUser) {
        if (this.pendingNewAccount) {
          this.addAccount(token, this.currentUser);
          this.pendingNewAccount = false;
        } else {
          // Keep the cached copy (avatar/username shown in the switcher
          // before a network round-trip) in sync with the server.
          const accounts = this.getAccounts();
          const idx = accounts.findIndex((a) => a.token === token);
          if (idx !== -1) {
            accounts[idx].user = this.currentUser;
            this.saveAccounts(accounts);
          }
        }
      }
    } catch (e) {
      this.currentUser = null;
    }
    this.renderAuthUI();
  }

  renderAuthUI() {
    const loggedIn = !!this.currentUser;
    document.getElementById('auth-login-btn').classList.toggle('hidden', loggedIn);
    document.getElementById('auth-user-btn').classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return;

    const avatar = this.currentUser.avatarUrl || 'assets/pepe-profile.png';
    document.getElementById('auth-user-avatar').src = avatar;
    document.getElementById('auth-pill-username').textContent = this.currentUser.name || this.currentUser.username || 'Account';

    const activeToken = this.getSessionToken();
    const listEl = document.getElementById('auth-account-list');
    const accounts = this.getAccounts();
    listEl.innerHTML = accounts.map((a) => {
      const isActive = a.token === activeToken;
      const accAvatar = a.user.avatarUrl || 'assets/pepe-profile.png';
      const name = this.escapeHtml(a.user.name || 'Unnamed');
      const username = a.user.username ? `@${this.escapeHtml(a.user.username)}` : 'No username set';
      return `
        <button type="button" class="auth-account-item${isActive ? ' active' : ''}" data-token="${a.token}">
          <img class="auth-account-avatar" src="${accAvatar}" alt="" loading="lazy" decoding="async">
          <span class="auth-account-info">
            <span class="auth-account-name">${name}</span>
            <span class="auth-account-username">${username}</span>
          </span>
          ${isActive ? '<i class="fas fa-check auth-account-check"></i>' : ''}
        </button>
      `;
    }).join('');

    listEl.querySelectorAll('.auth-account-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.token === activeToken) return;
        this.switchAccount(btn.dataset.token);
      });
    });
  }

  openProfileModal() {
    if (!this.currentUser) return;
    document.getElementById('auth-account-menu').classList.add('hidden');
    document.getElementById('profile-username').value = this.currentUser.username || '';
    document.getElementById('profile-display-name').value = this.currentUser.name || '';
    document.getElementById('profile-form-error').classList.add('hidden');

    document.getElementById('profile-avatar-error').classList.add('hidden');
    document.getElementById('profile-avatar-file').value = '';
    document.getElementById('profile-avatar-preview').src = this.currentUser.avatarUrl || 'assets/pepe-profile.png';
    document.getElementById('profile-avatar-remove-btn').classList.add('hidden');
    this.pendingAvatarDataUrl = undefined;

    const bannerPreview = document.getElementById('profile-banner-preview');
    document.getElementById('profile-banner-error').classList.add('hidden');
    document.getElementById('profile-banner-file').value = '';
    if (this.currentUser.bannerUrl) {
      bannerPreview.src = this.currentUser.bannerUrl;
      bannerPreview.classList.remove('hidden');
      document.getElementById('profile-banner-remove-btn').classList.remove('hidden');
    } else {
      bannerPreview.src = '';
      bannerPreview.classList.add('hidden');
      document.getElementById('profile-banner-remove-btn').classList.add('hidden');
    }
    this.pendingBannerDataUrl = undefined;

    document.getElementById('profile-modal-overlay').classList.remove('hidden');
  }

  // Cover-crops an uploaded image onto a canvas of the given size and
  // returns it as a compressed WebP data URL (used for both the square
  // avatar and the wide banner - just called with different dimensions).
  resizeImageToDataUrl(file, width, height) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read image'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
          resolve(canvas.toDataURL('image/webp', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.add('hidden');
  }

  async saveProfile() {
    const errorEl = document.getElementById('profile-form-error');
    errorEl.classList.add('hidden');

    const username = document.getElementById('profile-username').value.trim();
    const displayName = document.getElementById('profile-display-name').value.trim();

    try {
      const res = await this.authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username || null,
          displayName: displayName || null,
          avatarUrl: this.pendingAvatarDataUrl !== undefined ? this.pendingAvatarDataUrl : null,
          bannerUrl: this.pendingBannerDataUrl !== undefined ? this.pendingBannerDataUrl : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || 'Could not save profile.';
        errorEl.classList.remove('hidden');
        return;
      }
      this.currentUser = data.user;
      this.renderAuthUI();
      this.closeProfileModal();
    } catch (e) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.classList.remove('hidden');
    }
  }

  // ===== Comments =====

  async loadComments(pack) {
    const listEl = document.getElementById('comments-list');
    listEl.innerHTML = [0, 1].map(() => '<div class="sk-row"><span class="sk sk-circle" style="width:36px;height:36px"></span><span class="sk-stack"><span class="sk sk-line" style="width:120px"></span><span class="sk sk-line" style="width:70%"></span></span></div>').join('');
    document.getElementById('comments-signed-out-note').classList.toggle('hidden', !!this.currentUser);
    document.getElementById('comment-form').classList.toggle('hidden', !this.currentUser);

    try {
      const res = await this.authFetch(`/api/comments/${this.packSlug(pack)}`);
      const data = await res.json();
      if (this.currentPack !== pack) return;
      this.renderComments(data.comments || []);
    } catch (e) {
      listEl.innerHTML = '<p class="comments-empty">Could not load comments.</p>';
    }
  }

  renderComments(comments) {
    const listEl = document.getElementById('comments-list');
    if (comments.length === 0) {
      listEl.innerHTML = '<p class="comments-empty">No comments yet. Be the first!</p>';
      return;
    }

    const byParent = new Map();
    comments.forEach((c) => {
      const key = c.parentId || 'root';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(c);
    });

    const renderOne = (c, depth) => {
      const isOwn = this.currentUser && this.currentUser.id === c.user.id;
      const avatar = c.user.avatarUrl || 'assets/pepe-profile.png';
      const replies = byParent.get(c.id) || [];
      const canReply = depth === 0; // one level of nesting keeps threads readable
      const profileLink = c.user.username || c.user.id;
      return `
        <div class="comment-item" data-comment-id="${c.id}">
          <img class="comment-avatar comment-author-link" data-user-id="${profileLink}" src="${avatar}" alt="" loading="lazy" decoding="async">
          <div class="comment-body">
            <div class="comment-header">
              <span class="comment-author comment-author-link" data-user-id="${profileLink}">${this.escapeHtml(c.user.name || 'Unknown')}</span>
              ${c.isAuthor ? `<span class="author-badge" title="Verified: this is the site owner"><i class="fas fa-check"></i></span>` : ''}
              <span class="comment-time">${this.formatDate(c.createdAt)}</span>
              ${isOwn ? `<button type="button" class="comment-delete-btn" data-comment-id="${c.id}" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <p class="comment-text">${this.escapeHtml(c.text)}</p>
            <div class="comment-actions">
              <button type="button" class="comment-like-btn${c.likedByMe ? ' liked' : ''}" data-comment-id="${c.id}">
                <i class="${c.likedByMe ? 'fas' : 'far'} fa-heart"></i> ${c.likeCount > 0 ? c.likeCount : ''}
              </button>
              ${canReply ? `<button type="button" class="comment-reply-btn" data-comment-id="${c.id}">Reply</button>` : ''}
              ${!isOwn ? `<button type="button" class="comment-report-btn" data-comment-id="${c.id}" title="Report this comment"><i class="fas fa-flag"></i></button>` : ''}
            </div>
            <div class="composer composer-reply hidden" id="reply-form-${c.id}">
              <img class="composer-avatar" src="${this.currentUser ? (this.currentUser.avatarUrl || 'assets/pepe-profile.png') : 'assets/pepe-profile.png'}" alt="" decoding="async">
              <div class="composer-main">
                <textarea placeholder="Reply to ${this.escapeHtml(c.user.name || 'this comment')}…" aria-label="Your reply" maxlength="1000" rows="1" data-parent-id="${c.id}"></textarea>
                <div class="composer-bar">
                  <span class="composer-count">0 / 1000</span>
                  <button type="button" class="composer-btn composer-cancel" data-cancel-reply="${c.id}">Cancel</button>
                  <button type="button" class="composer-btn comment-reply-submit-btn" data-parent-id="${c.id}" disabled>Reply</button>
                </div>
              </div>
            </div>
            ${replies.length ? `<div class="comment-replies">${replies.map((r) => renderOne(r, depth + 1)).join('')}</div>` : ''}
          </div>
        </div>
      `;
    };

    listEl.innerHTML = (byParent.get('root') || []).map((c) => renderOne(c, 0)).join('');

    listEl.querySelectorAll('.comment-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteComment(btn.dataset.commentId));
    });
    listEl.querySelectorAll('.comment-like-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleCommentLike(btn.dataset.commentId));
    });
    listEl.querySelectorAll('.comment-reply-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.currentUser) return;
        const form = document.getElementById(`reply-form-${btn.dataset.commentId}`);
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) form.querySelector('textarea').focus();
      });
    });
    listEl.querySelectorAll('.comment-reply-submit-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.submitComment(btn.dataset.parentId));
    });
    listEl.querySelectorAll('.comment-report-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.reportComment(btn.dataset.commentId));
    });
    listEl.querySelectorAll('.comment-author-link').forEach((el) => {
      el.addEventListener('click', () => this.showUserProfile(el.dataset.userId));
    });
  }

  async reportComment(commentId) {
    if (!this.currentUser) return;
    const btn = document.querySelector(`.comment-report-btn[data-comment-id="${commentId}"]`);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    try {
      const res = await this.authFetch(`/api/comment/${commentId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        btn.innerHTML = '<i class="fas fa-check"></i> Reported';
      } else {
        btn.disabled = false;
      }
    } catch (e) {
      btn.disabled = false;
    }
  }

  async submitComment(parentId = null) {
    if (!this.currentUser || !this.currentPack) return;
    const input = parentId
      ? document.querySelector(`#reply-form-${parentId} textarea`)
      : document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text) return;

    const btn = parentId
      ? document.querySelector(`.comment-reply-submit-btn[data-parent-id="${parentId}"]`)
      : document.getElementById('comment-submit-btn');
    btn.disabled = true;
    try {
      const res = await this.authFetch(`/api/comments/${this.packSlug(this.currentPack)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parentId ? { text, parentId: Number(parentId) } : { text }),
      });
      if (res.ok) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true })); // reset height, counter and button
        this.loadComments(this.currentPack);
      }
    } catch (e) {
      /* network error - keep the draft so it can be re-sent */
    } finally {
      btn.disabled = false;
    }
  }

  async toggleCommentLike(commentId) {
    if (!this.currentUser) return;
    const btn = document.querySelector(`.comment-like-btn[data-comment-id="${commentId}"]`);
    if (!btn) return;
    btn.disabled = true;
    try {
      const res = await this.authFetch(`/api/comment/${commentId}/like`, { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      btn.classList.toggle('liked', data.likedByMe);
      btn.innerHTML = `<i class="${data.likedByMe ? 'fas' : 'far'} fa-heart"></i> ${data.likeCount > 0 ? data.likeCount : ''}`;
    } catch (e) { /* network error - leave the button as it was */ } finally {
      btn.disabled = false;
    }
  }

  async deleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;
    try {
      const res = await this.authFetch(`/api/comment/${commentId}`, { method: 'DELETE' });
      if (res.ok && this.currentPack) this.loadComments(this.currentPack);
    } catch (e) { /* network error - comment stays listed */ }
  }

  // "3d ago" style, for the library rows.
  timeAgo(dateStr) {
    const t = Date.parse(dateStr || '');
    if (!t) return '';
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return 'today';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Approved community uploads from the uploads worker, shaped like
  // packs.json entries. A slow or missing worker never blocks the library.
  async loadCommunityPacks({ fresh = false } = {}) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${UPLOADS_API}/api/community/packs`, { signal: ctrl.signal, cache: fresh ? 'reload' : 'default' });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      // Each version already carries its own LootLabs link (made by the uploads worker).
      return data.packs || [];
    } catch (e) {
      return [];
    }
  }

  // Whose Linkvertise account a download credits: Pepe's for his packs,
  // the uploader's for community packs (null = no Linkvertise).
  lvIdFor(pack) {
    if (pack && pack.community) return pack.linkvertiseId || null;
    return LINKVERTISE_USER_ID;
  }

  // The Linkvertise/LootLabs chooser only makes sense when a pack has both.
  hasProviderChoice(pack) {
    if (!pack || !pack.community) return true;
    return !!(pack.linkvertiseId && (pack.versions || []).some(v => v.lootUrl));
  }

  communityTag(pack) {
    if (!pack.community) return '';
    return `<span class="community-badge" title="Uploaded by ${this.escapeHtml(pack.author || 'a community member')}"><i class="fas fa-users"></i> Community</span>`;
  }

  packSlug(pack) {
    if (pack.slug) return pack.slug;
    return (pack.name || `pack-${pack.id}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Pass a `version` object (from pack.versions) to get a counter key scoped
  // to that specific version, so multi-version packs track downloads per version.
  counterKey(pack, version) {
    const source = version || pack;
    const base = (source.fileName || pack.name || `pack-${pack.id}`)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base}-${pack.id}`;
  }

  getYoutubeEmbedUrl(url) {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : null;
  }

  renderShowcase(pack) {
    const box = document.getElementById('detail-showcase');
    let embedUrl = this.getYoutubeEmbedUrl(pack.showcaseUrl);

    if (!embedUrl) {
      box.classList.add('hidden');
      document.getElementById('detail-showcase-embed').innerHTML = '';
      return;
    }

    if (localStorage.getItem('autoplayShowcase') === 'true') {
      embedUrl += '&autoplay=1&mute=1';
    }

    document.getElementById('detail-showcase-embed').innerHTML = `
      <iframe
        src="${embedUrl}"
        title="${this.escapeHtml(pack.name)} showcase"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    `;
    box.classList.remove('hidden');
  }

  updateDownloadsDisplay(pack, count) {
    const downloadsEl = document.getElementById('detail-downloads');
    if (downloadsEl) downloadsEl.textContent = this.formatCount(count);
    // Multi-version packs track (and display) each version's downloads separately.
    if (!(pack.versions && pack.versions.length > 1)) {
      document.querySelectorAll('.version-downloads').forEach(el => {
        el.textContent = `${this.formatCount(count)} downloads`;
      });
    }
  }

  renderNotice(pack) {
    const box = document.getElementById('detail-notice');
    const notice = pack.notice;

    if (!notice) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const features = (notice.features || []).map(f => `
      <li>
        <strong>${this.escapeHtml(f.title)}</strong>: ${this.escapeHtml(f.text)}
      </li>
    `).join('');

    box.innerHTML = `
      <div class="notice-header">
        <i class="fas fa-triangle-exclamation"></i>
        <h3>${this.escapeHtml(notice.title || 'Important')}</h3>
      </div>
      ${notice.intro ? `<p>${this.escapeHtml(notice.intro)}</p>` : ''}
      ${notice.instruction ? `<p class="notice-instruction">${this.escapeHtml(notice.instruction)}</p>` : ''}
      ${notice.featuresTitle ? `<h4>${this.escapeHtml(notice.featuresTitle)}</h4>` : ''}
      ${notice.featuresIntro ? `<p>${this.escapeHtml(notice.featuresIntro)}</p>` : ''}
      ${features ? `<ul class="notice-features">${features}</ul>` : ''}
      ${notice.critical ? `<div class="notice-critical"><i class="fas fa-circle-exclamation"></i> ${this.escapeHtml(notice.critical)}</div>` : ''}
    `;
    box.classList.remove('hidden');
  }

  renderVersionSelectMenu(pack) {
    const menu = document.getElementById('version-select-menu');
    menu.innerHTML = pack.versions.map((v, i) => `
      <li role="option" data-index="${i}" class="${i === 0 ? 'selected' : ''}" aria-selected="${i === 0}"><b>v${this.escapeHtml(String(v.version || '1.0.0').replace(/^v/i, ''))}</b>${i === 0 ? '<span class="version-opt-latest">latest</span>' : ''}<span class="version-opt-size">${this.escapeHtml(v.size || '')}</span></li>
    `).join('');
    document.getElementById('version-select-label').innerHTML = this.versionLabelHtml(pack, 0);

    menu.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        this.selectPackVersion(pack, parseInt(li.dataset.index, 10));
        menu.classList.remove('open');
        document.getElementById('version-select-trigger').classList.remove('open');
      });
    });
  }

  versionLabelHtml(pack, index) {
    const v = pack.versions[index] || {};
    const num = this.escapeHtml(String(v.version || '1.0.0').replace(/^v/i, ''));
    return `v${num}${index === 0 ? ' <span class="version-opt-latest">latest</span>' : ''}`;
  }

  selectPackVersion(pack, index) {
    const version = pack.versions[index];
    if (!version) return;
    this.selectedVersionIndex = index;

    document.getElementById('version-select-label').innerHTML = this.versionLabelHtml(pack, index);
    document.querySelectorAll('#version-select-menu li').forEach(li => {
      const on = parseInt(li.dataset.index, 10) === index;
      li.classList.toggle('selected', on);
      li.setAttribute('aria-selected', String(on));
    });

    const detailDownload = document.getElementById('detail-download');
    detailDownload.dataset.rawUrl = version.downloadUrl;
    detailDownload.dataset.lootUrl = version.lootUrl || '';
    detailDownload.href = getMonetizedUrl(version.downloadUrl, version.lootUrl, undefined, this.lvIdFor(pack));
    this.applyLinkTargets();

    document.getElementById('detail-downloads').textContent = '…';
    this.fetchLiveDownloads(pack, version).then(count => {
      if (this.currentPack === pack && this.selectedVersionIndex === index) {
        document.getElementById('detail-downloads').textContent = this.formatCount(count);
      }
    });
  }

  renderVersionsList(pack) {
    const list = document.getElementById('versions-list');
    const block = list.closest('.versions-block');

    if (pack.comingSoon || (!pack.downloadUrl && !(pack.versions && pack.versions.length))) {
      block.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    block.classList.remove('hidden');

    const versions = (pack.versions && pack.versions.length ? pack.versions : [{
      version: pack.version,
      fileName: pack.fileName,
      size: pack.size,
      downloadUrl: pack.downloadUrl,
      date: pack.updatedAt || pack.addedAt || pack.createdAt
    }]);
    const multi = versions.length > 1;
    const collapseOld = multi && localStorage.getItem('collapseOldVersions') !== 'false';

    const rowHtml = (v, i) => `
      <div class="version-row">
        <div class="version-info">
          <div class="version-top">
            <span class="version-number">${this.escapeHtml(pack.name)} v${this.escapeHtml(v.version || '1.0.0')}</span>
            <span class="version-date">${this.formatDate(v.date)}</span>
          </div>
          <p class="version-file">${this.escapeHtml(v.fileName || 'download.zip')} &middot; ${this.escapeHtml(v.size || '')} &middot; <span class="version-downloads" data-version-index="${i}">${multi ? '&hellip;' : this.formatCount(pack.downloads)} downloads</span></p>
          <div class="version-tags">
            ${pack.gameVersion && pack.gameVersion !== 'N/A' ? `<span>${this.escapeHtml(pack.gameVersion)}</span>` : ''}
            <span>${this.capitalizeFirst(pack.category)}</span>
            ${i === 0 && versions.length > 1 ? '<span class="latest-tag">Latest</span>' : ''}
          </div>
          ${v.changelog ? `<p class="version-changelog">${this.escapeHtml(v.changelog)}</p>` : ''}
        </div>
        <a href="${getMonetizedUrl(v.downloadUrl, v.lootUrl, undefined, this.lvIdFor(pack))}" class="btn-download version-download-btn" data-version-index="${i}" data-raw-url="${v.downloadUrl}" data-loot-url="${v.lootUrl || ''}">
          <i class="fas fa-download"></i> Download
        </a>
      </div>
    `;

    if (collapseOld) {
      const older = versions.length - 1;
      list.innerHTML = rowHtml(versions[0], 0) +
        `<div class="older-versions hidden" id="older-versions">${versions.slice(1).map((v, i) => rowHtml(v, i + 1)).join('')}</div>` +
        `<button type="button" class="show-older-versions-btn" id="show-older-versions-btn">
          <i class="fas fa-chevron-down"></i> Show ${older} older version${older !== 1 ? 's' : ''}
        </button>`;

      document.getElementById('show-older-versions-btn').addEventListener('click', (e) => {
        const older = document.getElementById('older-versions');
        const nowShown = older.classList.toggle('hidden') === false;
        e.currentTarget.innerHTML = nowShown
          ? `<i class="fas fa-chevron-up"></i> Hide older versions`
          : `<i class="fas fa-chevron-down"></i> Show ${versions.length - 1} older version${versions.length - 1 !== 1 ? 's' : ''}`;
      });
    } else {
      list.innerHTML = versions.map((v, i) => rowHtml(v, i)).join('');
    }

    this.applyLinkTargets();

    // Each version of a multi-version pack tracks its downloads separately.
    if (multi) {
      versions.forEach((v, i) => {
        this.fetchLiveDownloads(pack, v).then(count => {
          const el = list.querySelector(`.version-downloads[data-version-index="${i}"]`);
          if (el) el.textContent = `${this.formatCount(count)} downloads`;
          if (this.currentPack === pack && i === (this.selectedVersionIndex || 0)) {
            document.getElementById('detail-downloads').textContent = this.formatCount(count);
          }
        });
      });
    }
  }

  renderExtensionsList(pack) {
    const list = document.getElementById('extensions-list');
    const block = document.getElementById('extensions-block');

    if (!pack.extensions || !pack.extensions.length) {
      block.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    block.classList.remove('hidden');

    // Group extensions by version
    const groupedByVersion = {};
    pack.extensions.forEach(ext => {
      const version = ext.version || 'Latest';
      if (!groupedByVersion[version]) {
        groupedByVersion[version] = [];
      }
      groupedByVersion[version].push(ext);
    });

    // Sort versions (numeric versions descending, Latest at end)
    const sortedVersions = Object.keys(groupedByVersion).sort((a, b) => {
      if (a === 'Latest') return 1;
      if (b === 'Latest') return -1;
      const aNum = parseFloat(a);
      const bNum = parseFloat(b);
      return bNum - aNum;
    });

    const rowHtml = (ext) => `
      <div class="version-row">
        <div class="version-info">
          <div class="version-top">
            <span class="version-number">${this.escapeHtml(pack.name)} - ${this.escapeHtml(ext.name)}</span>
          </div>
          <p class="version-file">${this.escapeHtml(ext.fileName)} &middot; ${this.escapeHtml(ext.size)}</p>
        </div>
        <a href="${getMonetizedUrl(ext.downloadUrl)}" class="btn-download version-download-btn" data-raw-url="${ext.downloadUrl}" data-loot-url="">
          <i class="fas fa-download"></i> Download
        </a>
      </div>
    `;

    let html = '';
    sortedVersions.forEach((version, idx) => {
      const versionLabel = version === 'Latest' ? `${pack.name} (Latest)` : `${pack.name} v${version}`;
      const groupId = `ext-group-${idx}`;
      html += `<div class="extension-version-group">
        <button class="extension-version-label" data-group-id="${groupId}" style="background: none; border: none; cursor: pointer; width: 100%; text-align: left; padding: 0; display: flex; align-items: center; gap: 0.5rem;">
          <i class="fas fa-chevron-down"></i> ${this.escapeHtml(versionLabel)}
        </button>
        <div class="extension-version-items" id="${groupId}">
          ${groupedByVersion[version].map(ext => rowHtml(ext)).join('')}
        </div>
      </div>`;
    });

    list.innerHTML = html;

    // Add collapse/expand functionality
    document.querySelectorAll('.extension-version-label').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const groupId = btn.dataset.groupId;
        const items = document.getElementById(groupId);
        const icon = btn.querySelector('i');

        items.classList.toggle('hidden');
        if (items.classList.contains('hidden')) {
          icon.className = 'fas fa-chevron-right';
        } else {
          icon.className = 'fas fa-chevron-down';
        }
      });
    });

    this.applyLinkTargets();
  }

  // Routes through a small concurrency-limited queue (the counter API 429s
  // if too many requests land at once, which happens easily when the
  // library grid fetches a live count per card) and dedupes concurrent
  // requests for the same pack/version so callers awaiting the same key
  // share one in-flight request instead of firing duplicates.
  fetchLiveDownloads(pack, version) {
    // Community packs are counted by the uploads worker when the file is really fetched.
    if (pack.community) return Promise.resolve((version ? version.downloads : pack.downloads) || 0);
    const key = this.counterKey(pack, version);

    // Short-lived cache across page loads: reloading the library repeatedly
    // (e.g. switching categories back and forth) shouldn't re-hit the
    // counter API for every pack every time within the same few minutes.
    const cached = this.readCachedDownloadCount(key);
    if (cached !== null) return Promise.resolve(cached);

    if (this.inFlightDownloadFetches.has(key)) return this.inFlightDownloadFetches.get(key);

    const promise = this.enqueueDownloadFetch(() => this.rawFetchLiveDownloads(pack, version, key))
      .then(count => {
        this.writeCachedDownloadCount(key, count);
        return count;
      })
      .finally(() => this.inFlightDownloadFetches.delete(key));
    this.inFlightDownloadFetches.set(key, promise);
    return promise;
  }

  readCachedDownloadCount(key) {
    try {
      const raw = sessionStorage.getItem(`dlcount:${key}`);
      if (!raw) return null;
      const { count, t } = JSON.parse(raw);
      if (Date.now() - t > 5 * 60 * 1000) return null;
      return count;
    } catch (e) {
      return null;
    }
  }

  writeCachedDownloadCount(key, count) {
    try {
      sessionStorage.setItem(`dlcount:${key}`, JSON.stringify({ count, t: Date.now() }));
    } catch (e) { /* sessionStorage full/unavailable - not fatal */ }
  }

  async rawFetchLiveDownloads(pack, version, key) {
    const fallback = version ? 0 : pack.downloads;
    try {
      const res = await fetch(`${API_BASE}/api/downloads/${key}`);
      if (!res.ok) return fallback;
      const data = await res.json();
      return typeof data.count === 'number' ? data.count : fallback;
    } catch (error) {
      return fallback;
    }
  }

  enqueueDownloadFetch(task) {
    return new Promise((resolve, reject) => {
      this.downloadFetchQueue.push({ task, resolve, reject });
      this.pumpDownloadFetchQueue();
    });
  }

  pumpDownloadFetchQueue() {
    // Our own Worker API easily handles this traffic, but a small stagger
    // still keeps the grid's counts filling in smoothly rather than all at once.
    const MAX_CONCURRENT = 4;
    const STAGGER_MS = 60;
    if (this.pumpScheduled || this.activeDownloadFetches >= MAX_CONCURRENT || !this.downloadFetchQueue.length) return;

    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      if (!this.downloadFetchQueue.length) return;
      const { task, resolve, reject } = this.downloadFetchQueue.shift();
      this.activeDownloadFetches++;
      task().then(resolve, reject).finally(() => {
        this.activeDownloadFetches--;
        this.pumpDownloadFetchQueue();
      });
    }, this.activeDownloadFetches === 0 && this.downloadFetchQueue.length === 1 ? 0 : STAGGER_MS);
  }

  // Packs downloaded on this device (ids only, kept in this browser) so cards can say "Downloaded".
  downloadedIds() {
    try { const a = JSON.parse(localStorage.getItem('downloadedPacks') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
  }

  markDownloaded(pack) {
    const ids = this.downloadedIds();
    ids.add(pack.id);
    try { localStorage.setItem('downloadedPacks', JSON.stringify([...ids].slice(-500))); } catch (e) { /* storage full or blocked */ }
    document.querySelectorAll(`.pack-card[data-pack-id="${pack.id}"]`).forEach(c => this.paintDownloaded(c));
  }

  paintDownloaded(card) {
    card.classList.add('is-downloaded');
    const btn = card.querySelector('.pack-dl-btn');
    if (btn) btn.innerHTML = '<i class="fas fa-check"></i> Downloaded';
  }

  async incrementDownloads(pack, version) {
    this.markDownloaded(pack);
    if (pack.community) return (version ? version.downloads : pack.downloads) || 0;
    const fallback = (version ? 0 : pack.downloads) + 1;
    try {
      const key = this.counterKey(pack, version);
      const res = await fetch(`${API_BASE}/api/downloads/${key}`, { method: 'POST' });
      if (!res.ok) return fallback;
      const data = await res.json();
      if (typeof data.count === 'number') {
        this.writeCachedDownloadCount(key, data.count);
        return data.count;
      }
      return fallback;
    } catch (error) {
      return fallback;
    }
  }

  capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // 950 -> "950", 1200 -> "1.2k", 1000000 -> "1m", 2500000 -> "2.5m"
  formatCount(num) {
    num = Number(num) || 0;
    if (num < 1000) return String(num);
    const units = [{ value: 1e9, suffix: 'b' }, { value: 1e6, suffix: 'm' }, { value: 1e3, suffix: 'k' }];
    for (let i = 0; i < units.length; i++) {
      const { value, suffix } = units[i];
      if (num >= value) {
        const scaled = num / value;
        let rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
        // e.g. 999999 rounds to 1000k - bump up to the next unit instead.
        if (rounded >= 1000 && units[i - 1]) return `1${units[i - 1].suffix}`;
        return `${rounded}${suffix}`;
      }
    }
    return String(num);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  toggleTheme() {
    const isLight = document.body.classList.contains('light-mode');
    this.setDarkMode(isLight);
  }

  setDarkMode(isDark) {
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const themeIcon = document.querySelector('#theme-toggle i');
    if (isDark) {
      document.body.classList.remove('light-mode');
      darkModeToggle.checked = true;
      if (themeIcon) themeIcon.className = 'fas fa-sun';
      localStorage.setItem('darkMode', 'true');
    } else {
      document.body.classList.add('light-mode');
      darkModeToggle.checked = false;
      if (themeIcon) themeIcon.className = 'fas fa-moon';
      localStorage.setItem('darkMode', 'false');
    }
  }

  setCompactView(isCompact) {
    const toggle = document.getElementById('compact-view-toggle');
    if (isCompact) {
      document.body.classList.add('compact-view');
      localStorage.setItem('compactView', 'true');
    } else {
      document.body.classList.remove('compact-view');
      localStorage.setItem('compactView', 'false');
    }
    if (toggle) toggle.checked = isCompact;
  }

  setShowDownloadCounts(isShown) {
    const toggle = document.getElementById('show-downloads-toggle');
    document.body.classList.toggle('hide-download-counts', !isShown);
    localStorage.setItem('showDownloadCounts', isShown ? 'true' : 'false');
    if (toggle) toggle.checked = isShown;
  }

  setReduceMotion(isReduced) {
    const toggle = document.getElementById('reduce-motion-toggle');
    if (isReduced) {
      document.body.classList.add('reduce-motion');
      localStorage.setItem('reduceMotion', 'true');
    } else {
      document.body.classList.remove('reduce-motion');
      localStorage.setItem('reduceMotion', 'false');
    }
    if (toggle) toggle.checked = isReduced;
  }

  setNewTabLinks(isNewTab) {
    const toggle = document.getElementById('new-tab-toggle');
    localStorage.setItem('newTabLinks', isNewTab ? 'true' : 'false');
    if (toggle) toggle.checked = isNewTab;
    this.applyLinkTargets();
  }

  applyLinkTargets() {
    const newTab = localStorage.getItem('newTabLinks') !== 'false';
    document.querySelectorAll('a[href^="http"]').forEach(link => {
      if (newTab) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
      } else {
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
    });
  }

  loadTheme() {
    const darkMode = localStorage.getItem('darkMode');
    const compactView = localStorage.getItem('compactView');
    const reduceMotion = localStorage.getItem('reduceMotion');
    const newTabLinks = localStorage.getItem('newTabLinks');

    if (darkMode === 'false') {
      this.setDarkMode(false);
    }

    if (compactView === 'true') {
      this.setCompactView(true);
    }

    if (reduceMotion === 'true') {
      this.setReduceMotion(true);
    }

    this.setNewTabLinks(newTabLinks !== 'false');
    this.setShowDownloadCounts(localStorage.getItem('showDownloadCounts') !== 'false');

    const collapseOldVersionsToggle = document.getElementById('collapse-old-versions-toggle');
    if (collapseOldVersionsToggle) collapseOldVersionsToggle.checked = localStorage.getItem('collapseOldVersions') !== 'false';

    const showDiscontinuedToggle = document.getElementById('show-discontinued-toggle');
    if (showDiscontinuedToggle) showDiscontinuedToggle.checked = localStorage.getItem('showDiscontinued') !== 'false';

    const collapseSectionsToggle = document.getElementById('collapse-sections-toggle');
    if (collapseSectionsToggle) collapseSectionsToggle.checked = this.defaultCollapseSections;

    const showAssetsWarningToggle = document.getElementById('show-assets-warning-toggle');
    if (showAssetsWarningToggle) showAssetsWarningToggle.checked = localStorage.getItem('hideAssetsModal') !== 'true';

    const heroVisibility = localStorage.getItem('heroVisibility');
    this.setHeroVisibility(heroVisibility !== null ? heroVisibility : 65, { persist: false });

    const fontSizeScale = localStorage.getItem('fontSizeScale');
    this.setFontSize(fontSizeScale !== null ? fontSizeScale : 100, { persist: false });

    const rememberLastPageToggle = document.getElementById('remember-last-page-toggle');
    if (rememberLastPageToggle) rememberLastPageToggle.checked = localStorage.getItem('rememberLastPage') === 'true';

    SIMPLE_TOGGLE_SETTINGS.forEach(({ id, key, className }) => {
      const checked = getBoolSetting(key, false);
      document.body.classList.toggle(className, checked);
      const el = document.getElementById(id);
      if (el) el.checked = checked;
    });

    SIMPLE_FLAG_SETTINGS.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (el) el.checked = getBoolSetting(key, false);
    });

    const scrollToTopToggle = document.getElementById('scroll-to-top-toggle');
    if (scrollToTopToggle) scrollToTopToggle.checked = getBoolSetting('scrollToTopOnNav', true);

    const trackDownloadsToggle = document.getElementById('track-downloads-toggle');
    if (trackDownloadsToggle) trackDownloadsToggle.checked = getBoolSetting('trackDownloadCounts', true);

    this.syncDropdownSelection(this.monetizationDropdown, getMonetizationProvider());
    this.syncDropdownSelection(this.defaultSortDropdown, this.currentFilter.sort);

    const sharedParams = new URLSearchParams(location.search);
    const sharedAccent = sharedParams.get('accent');
    const sharedHex = sharedAccent && /^[0-9a-f]{6}$/i.test(sharedAccent) ? `#${sharedAccent}` : null;
    const sharedRadius = sharedParams.get('radius');
    const sharedGradient = sharedParams.get('gradient');
    const isShared = !!sharedHex;
    this.setAccentColor(sharedHex || localStorage.getItem('accentColor') || 'green', { persist: isShared });
    this.setThemeRadiusStyle(
      ['default', 'sharp', 'pill'].includes(sharedRadius) ? sharedRadius : (localStorage.getItem('themeRadiusStyle') || 'default'),
      { persist: isShared }
    );
    this.setAccentGradient(
      isShared ? sharedGradient === '1' : localStorage.getItem('accentGradient') === 'true',
      { persist: isShared }
    );

    document.getElementById('autoplay-showcase-toggle').checked = localStorage.getItem('autoplayShowcase') === 'true';
    // "Ask Every Time" should be default true. If it's never been set, or set to true, enable it. Only false explicitly disables it.
    const askProviderToggle = document.getElementById('ask-provider-toggle');
    askProviderToggle.checked = localStorage.getItem('askProviderEveryTime') !== 'false';
    this.updateMonetizationProviderDropdownState(askProviderToggle.checked);
  }

  syncDropdownSelection(dropdown, value) {
    if (!dropdown || !dropdown.menu) return;
    // Compare in JS instead of building a selector: a stored value containing
    // quotes would make querySelector throw and abort loadTheme() entirely.
    const option = Array.from(dropdown.menu.querySelectorAll('li[data-value]'))
      .find(li => li.dataset.value === String(value));
    if (option) dropdown.select(option.dataset.value, option.textContent);
  }

  setHeroVisibility(value, { persist = true } = {}) {
    const visibility = Math.min(100, Math.max(10, parseInt(value, 10) || 65));
    const alpha = (1 - visibility / 100) * 0.85 + 0.05;
    document.documentElement.style.setProperty('--hero-overlay-alpha', alpha.toFixed(2));
    const slider = document.getElementById('hero-visibility-slider');
    slider.value = visibility;
    updateSliderFill(slider);
    if (persist) localStorage.setItem('heroVisibility', visibility);
  }

  setFontSize(value, { persist = true } = {}) {
    const scale = Math.min(130, Math.max(90, parseInt(value, 10) || 100));
    document.documentElement.style.setProperty('--content-scale', (scale / 100).toFixed(2));
    const slider = document.getElementById('font-size-slider');
    slider.value = scale;
    updateSliderFill(slider);
    if (persist) localStorage.setItem('fontSizeScale', scale);
  }

  exportSettings() {
    const data = {};
    SETTINGS_KEYS.forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pepes-portfolio-settings.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  importSettings(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alert('That file is not a valid settings export.');
        return;
      }
      if (!data || typeof data !== 'object') {
        alert('That file is not a valid settings export.');
        return;
      }
      Object.keys(data).forEach(key => {
        if (SETTINGS_KEYS.includes(key) && typeof data[key] === 'string') {
          localStorage.setItem(key, data[key]);
        }
      });
      location.reload();
    };
    reader.readAsText(file);
  }

  copySettingsSummary() {
    const lines = SETTINGS_KEYS
      .filter(key => key !== 'recentlyViewedPacks' && key !== 'collapsedSections')
      .map(key => `${key}: ${localStorage.getItem(key) ?? '(default)'}`);
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => alert('Settings summary copied to clipboard.'),
        () => alert(text)
      );
    } else {
      alert(text);
    }
  }

  filterSettingsRows(query) {
    const term = query.trim().toLowerCase();
    const main = document.querySelector('#page-settings .main-content');
    if (main) main.classList.toggle('settings-searching', !!term);

    document.querySelectorAll('#page-settings .setting-row').forEach(row => {
      const name = row.querySelector('.setting-name');
      const desc = row.querySelector('.setting-desc');
      const text = `${name ? name.textContent : ''} ${desc ? desc.textContent : ''}`.toLowerCase();
      row.classList.toggle('setting-row-hidden', !!term && !text.includes(term));
    });

    // Group headings and their cards disappear when none of their rows match.
    document.querySelectorAll('#page-settings .settings-list').forEach(list => {
      const hasVisible = !!list.querySelector('.setting-row:not(.setting-row-hidden)');
      list.classList.toggle('setting-row-hidden', !hasVisible);
      const title = list.previousElementSibling;
      if (title && title.classList.contains('settings-group-title')) title.classList.toggle('setting-row-hidden', !hasVisible);
    });
    const empty = document.getElementById('settings-empty');
    if (empty) {
      const anyHit = !!document.querySelector('#page-settings .setting-row:not(.setting-row-hidden)');
      empty.hidden = !term || anyHit;
    }
    const clear = document.getElementById('settings-search-clear');
    if (clear) clear.hidden = !term;
    this.updateSettingsCategoryCounts();
  }

  // `value` is either a preset name ('green', 'blue', ...) or a custom
  // "#rrggbb" hex string picked in the Theme Studio. Dark/light shades for
  // custom colors are derived algorithmically (shadeHex) instead of being
  // hand-picked like the presets, so any color the user picks gets usable
  // hover/border shades for free.
  setAccentColor(value, { persist = true } = {}) {
    const isCustomHex = /^#[0-9a-f]{6}$/i.test(value || '');
    const accent = isCustomHex ? value : (ACCENT_PRESETS[value] || ACCENT_PRESETS.green);
    const dark = shadeHex(accent, -0.2);
    const light = shadeHex(accent, 0.25);

    const root = document.documentElement.style;
    const isGreen = !isCustomHex && (value === 'green' || !ACCENT_PRESETS[value]);
    root.setProperty('--color-accent', accent);
    root.setProperty('--color-accent-dark', isGreen ? '#348b25' : dark);
    root.setProperty('--color-accent-light', isGreen ? '#a3de97' : light);
    root.setProperty('--accent-deep', isGreen ? '#216639' : shadeHex(accent, -0.5));
    root.setProperty('--accent-deepest', isGreen ? '#074723' : shadeHex(accent, -0.72));
    // Text on an accent fill: dark ink on light accents, white on dark ones.
    const { r: ar, g: ag, b: ab } = hexToRgb(accent);
    const lum = (0.2126 * ar + 0.7152 * ag + 0.0722 * ab) / 255;
    root.setProperty('--on-accent', lum > 0.55 ? (isGreen ? '#074723' : shadeHex(accent, -0.75)) : '#ffffff');

    this.syncThemeStudio(accent);

    if (persist) localStorage.setItem('accentColor', isCustomHex ? accent : value);
  }

  // ===== Theme Studio =====

  syncThemeStudio(hex) {
    const { r, g, b } = hexToRgb(hex);
    const hexInput = document.getElementById('theme-hex-input');
    const rInput = document.getElementById('theme-r-input');
    const gInput = document.getElementById('theme-g-input');
    const bInput = document.getElementById('theme-b-input');
    const preview = document.getElementById('theme-color-preview');
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;
    if (rInput && document.activeElement !== rInput) rInput.value = r;
    if (gInput && document.activeElement !== gInput) gInput.value = g;
    if (bInput && document.activeElement !== bInput) bInput.value = b;
    if (preview) preview.style.background = hex;

    if (!this.themeStudioDragging) {
      const { h, s, v } = rgbToHsv(r, g, b);
      this.themeHue = h;
      this.positionThemeStudioHandles(h, s, v);
    }

    document.querySelectorAll('.theme-preset-swatches .theme-preset-swatch').forEach(el => {
      el.classList.toggle('selected', el.dataset.hex.toLowerCase() === hex.toLowerCase());
    });

    this.updateThemeContrastReadout();
  }

  // ===== Theme Studio: corner style, gradient accent, contrast, looks, code =====

  setThemeRadiusStyle(style, { persist = true } = {}) {
    document.body.classList.toggle('sharp-corners', style === 'sharp');
    document.body.classList.toggle('pill-corners', style === 'pill');

    const sharpToggle = document.getElementById('sharp-corners-toggle');
    if (sharpToggle) sharpToggle.checked = style === 'sharp';

    document.querySelectorAll('#theme-corner-style-group .theme-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.radius === style);
    });

    if (persist) {
      localStorage.setItem('themeRadiusStyle', style);
      localStorage.setItem('sharpCorners', style === 'sharp');
    }
  }

  setAccentGradient(enabled, { persist = true } = {}) {
    document.body.classList.toggle('accent-gradient', !!enabled);
    const toggle = document.getElementById('theme-gradient-toggle');
    if (toggle) toggle.checked = !!enabled;
    if (persist) localStorage.setItem('accentGradient', !!enabled);
  }

  // Relative luminance / contrast ratio per WCAG, used so users can see at a
  // glance whether white text on their chosen accent stays readable.
  updateThemeContrastReadout() {
    const el = document.getElementById('theme-contrast-readout');
    if (!el) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    const { r, g, b } = hexToRgb(accent);
    const luminance = ([r, g, b].map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }));
    const L = 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2];
    const ratio = (1 + 0.05) / (L + 0.05);
    const passesAA = ratio >= 4.5;
    el.innerHTML = `White text on this accent: <strong>${ratio.toFixed(2)}:1</strong> · <span class="${passesAA ? 'contrast-pass' : 'contrast-fail'}">${passesAA ? 'AA Pass' : 'AA Fail'}</span>`;
  }

  applyThemeLook(look) {
    this.setAccentColor(look.accent);
    this.setThemeRadiusStyle(look.radius);
    this.setAccentGradient(!!look.gradient);
  }

  getThemeCode() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    const radius = localStorage.getItem('themeRadiusStyle') || 'default';
    const gradient = localStorage.getItem('accentGradient') === 'true';
    return btoa(JSON.stringify({ accent, radius, gradient }));
  }

  applyThemeCode(code) {
    try {
      const data = JSON.parse(atob(code.trim()));
      if (!/^#[0-9a-f]{6}$/i.test(data.accent || '')) throw new Error('bad accent');
      this.applyThemeLook({
        accent: data.accent,
        radius: ['default', 'sharp', 'pill'].includes(data.radius) ? data.radius : 'default',
        gradient: !!data.gradient
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ===== Theme Studio: custom saved swatches =====

  getCustomThemeSwatches() {
    try {
      const raw = JSON.parse(localStorage.getItem('customThemeSwatches') || '[]');
      return Array.isArray(raw) ? raw.filter(hex => /^#[0-9a-f]{6}$/i.test(hex)) : [];
    } catch (e) {
      return [];
    }
  }

  renderCustomThemeSwatches() {
    const container = document.getElementById('theme-custom-swatches');
    const label = document.getElementById('theme-custom-label');
    if (!container) return;
    const swatches = this.getCustomThemeSwatches();
    if (label) label.classList.toggle('hidden', swatches.length === 0);

    container.innerHTML = swatches.map(hex => `
      <span class="theme-custom-swatch-wrap">
        <button type="button" class="theme-preset-swatch" data-hex="${hex}" style="--swatch-color:${hex}" aria-label="Saved color ${hex}"></button>
        <button type="button" class="theme-custom-swatch-remove" data-hex="${hex}" aria-label="Remove saved color ${hex}">&times;</button>
      </span>
    `).join('');

    const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    container.querySelectorAll('.theme-preset-swatch').forEach(el => {
      el.classList.toggle('selected', el.dataset.hex.toLowerCase() === currentAccent.toLowerCase());
      el.addEventListener('click', () => this.setAccentColor(el.dataset.hex));
    });
    container.querySelectorAll('.theme-custom-swatch-remove').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeCustomThemeSwatch(el.dataset.hex);
      });
    });
  }

  saveCustomThemeSwatch(hex) {
    const swatches = this.getCustomThemeSwatches();
    const normalized = hex.toLowerCase();
    if (!swatches.some(h => h.toLowerCase() === normalized)) {
      swatches.unshift(hex);
      if (swatches.length > 12) swatches.length = 12;
      localStorage.setItem('customThemeSwatches', JSON.stringify(swatches));
    }
    this.renderCustomThemeSwatches();
  }

  removeCustomThemeSwatch(hex) {
    const swatches = this.getCustomThemeSwatches().filter(h => h.toLowerCase() !== hex.toLowerCase());
    localStorage.setItem('customThemeSwatches', JSON.stringify(swatches));
    this.renderCustomThemeSwatches();
  }

  positionThemeStudioHandles(h, s, v) {
    const svSquare = document.getElementById('theme-sv-square');
    const svHandle = document.getElementById('theme-sv-handle');
    const hueSlider = document.getElementById('theme-hue-slider');
    if (svSquare && svHandle) {
      svHandle.style.left = `${s * 100}%`;
      svHandle.style.top = `${(1 - v) * 100}%`;
      svSquare.style.setProperty('--sv-hue', h);
    }
    if (hueSlider) {
      hueSlider.value = h;
      updateSliderFill(hueSlider);
    }
  }

  applyThemeStudioColor(h, s, v, { persist = true } = {}) {
    const { r, g, b } = hsvToRgb(h, s, v);
    const hex = rgbToHex(r, g, b);
    this.setAccentColor(hex, { persist });
  }

  setupThemeStudio() {
    const svSquare = document.getElementById('theme-sv-square');
    const svHandle = document.getElementById('theme-sv-handle');
    const hueSlider = document.getElementById('theme-hue-slider');
    const hexInput = document.getElementById('theme-hex-input');
    const rInput = document.getElementById('theme-r-input');
    const gInput = document.getElementById('theme-g-input');
    const bInput = document.getElementById('theme-b-input');
    const randomBtn = document.getElementById('theme-random-btn');
    if (!svSquare || !hueSlider) return;

    this.themeHue = 122;

    const currentSV = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
      const { r, g, b } = hexToRgb(accent);
      return rgbToHsv(r, g, b);
    };

    const pickFromSquare = (clientX, clientY) => {
      const rect = svSquare.getBoundingClientRect();
      const s = clamp01((clientX - rect.left) / rect.width);
      const v = clamp01(1 - (clientY - rect.top) / rect.height);
      svHandle.style.left = `${s * 100}%`;
      svHandle.style.top = `${(1 - v) * 100}%`;
      this.applyThemeStudioColor(this.themeHue, s, v);
    };

    svSquare.addEventListener('pointerdown', (e) => {
      this.themeStudioDragging = true;
      svSquare.setPointerCapture(e.pointerId);
      pickFromSquare(e.clientX, e.clientY);
    });
    svSquare.addEventListener('pointermove', (e) => {
      if (!this.themeStudioDragging) return;
      pickFromSquare(e.clientX, e.clientY);
    });
    ['pointerup', 'pointercancel'].forEach(evt => {
      svSquare.addEventListener(evt, () => { this.themeStudioDragging = false; });
    });

    hueSlider.addEventListener('input', (e) => {
      this.themeHue = parseFloat(e.target.value);
      svSquare.style.setProperty('--sv-hue', this.themeHue);
      updateSliderFill(hueSlider);
      const { s, v } = currentSV();
      this.applyThemeStudioColor(this.themeHue, s, v);
    });

    hexInput.addEventListener('change', (e) => {
      const value = e.target.value.trim();
      if (!/^#?[0-9a-f]{6}$/i.test(value)) {
        hexInput.value = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
        return;
      }
      this.setAccentColor(value.startsWith('#') ? value : `#${value}`);
    });

    const rgbInputChange = () => {
      const r = Math.min(255, Math.max(0, parseInt(rInput.value, 10) || 0));
      const g = Math.min(255, Math.max(0, parseInt(gInput.value, 10) || 0));
      const b = Math.min(255, Math.max(0, parseInt(bInput.value, 10) || 0));
      this.setAccentColor(rgbToHex(r, g, b));
    };
    [rInput, gInput, bInput].forEach(el => el.addEventListener('change', rgbInputChange));

    document.querySelectorAll('#theme-preset-swatches .theme-preset-swatch').forEach(el => {
      el.addEventListener('click', () => this.setAccentColor(el.dataset.hex));
    });

    this.renderCustomThemeSwatches();

    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        const h = Math.random() * 360;
        const s = 0.45 + Math.random() * 0.55;
        const v = 0.55 + Math.random() * 0.45;
        this.themeHue = h;
        this.positionThemeStudioHandles(h, s, v);
        this.applyThemeStudioColor(h, s, v);
      });
    }

    const savePresetBtn = document.getElementById('theme-save-preset-btn');
    if (savePresetBtn) {
      savePresetBtn.addEventListener('click', () => {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
        this.saveCustomThemeSwatch(accent);
        savePresetBtn.innerHTML = '<i class="fas fa-check"></i> Saved';
        setTimeout(() => { savePresetBtn.innerHTML = '<i class="fas fa-bookmark"></i> Save'; }, 1200);
      });
    }

    const shareBtn = document.getElementById('theme-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('accent', accent.replace('#', ''));
        url.searchParams.set('radius', localStorage.getItem('themeRadiusStyle') || 'default');
        url.searchParams.set('gradient', localStorage.getItem('accentGradient') === 'true' ? '1' : '0');
        const finish = () => {
          shareBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
          setTimeout(() => { shareBtn.innerHTML = '<i class="fas fa-link"></i> Share'; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url.toString()).then(finish, finish);
        } else {
          finish();
        }
      });
    }

    document.querySelectorAll('#theme-corner-style-group .theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setThemeRadiusStyle(btn.dataset.radius));
    });

    const gradientToggle = document.getElementById('theme-gradient-toggle');
    if (gradientToggle) {
      gradientToggle.addEventListener('change', (e) => this.setAccentGradient(e.target.checked));
    }

    document.querySelectorAll('#theme-look-presets .theme-look-card').forEach(card => {
      card.addEventListener('click', () => {
        try {
          this.applyThemeLook(JSON.parse(card.dataset.look));
        } catch (e) { /* malformed preset data, ignore */ }
      });
    });

    const codeInput = document.getElementById('theme-code-input');
    const codeCopyBtn = document.getElementById('theme-code-copy-btn');
    const codeApplyBtn = document.getElementById('theme-code-apply-btn');
    if (codeCopyBtn) {
      codeCopyBtn.addEventListener('click', () => {
        const code = this.getThemeCode();
        if (codeInput) codeInput.value = code;
        const finish = () => {
          codeCopyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
          setTimeout(() => { codeCopyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(finish, finish);
        } else {
          finish();
        }
      });
    }
    if (codeApplyBtn && codeInput) {
      codeApplyBtn.addEventListener('click', () => {
        const ok = this.applyThemeCode(codeInput.value);
        codeApplyBtn.innerHTML = ok ? '<i class="fas fa-check"></i> Applied' : '<i class="fas fa-xmark"></i> Invalid';
        setTimeout(() => { codeApplyBtn.innerHTML = '<i class="fas fa-check"></i> Apply'; }, 1200);
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.router = new Router();
  window.packLibrary = new PackLibrary();
  await window.packLibrary.ready;
  resolveInitialRoute();

  document.getElementById('footer-top-btn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  updateBirthdayCountdown();
});

function updateBirthdayCountdown() {
  const el = document.getElementById('birthday-countdown');
  if (!el) return;

  const now = new Date();
  const currentYear = now.getFullYear();
  let birthday = new Date(currentYear, 11, 26);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (startOfToday.getTime() === birthday.getTime()) {
    el.textContent = "It's my birthday today!";
    return;
  }
  if (startOfToday > birthday) {
    birthday = new Date(currentYear + 1, 11, 26);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.ceil((birthday - startOfToday) / msPerDay);
  el.textContent = `${days} day${days === 1 ? '' : 's'} to go`;
}

function clearNavActive() {
  document.querySelectorAll('.topnav-link, .mobile-nav-link').forEach(l => l.classList.remove('active'));
  if (window.mobileNav) window.mobileNav.onPage(null);
}

function show404() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-404').classList.add('active');
  clearNavActive();
  document.title = "Page Not Found · Pepe";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDownloadGate(token) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-download').classList.add('active');
  clearNavActive();
  document.title = 'Preparing Download · Pepe';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const progressGroup = document.getElementById('download-gate-progress-group');
  const errorGroup = document.getElementById('download-gate-error');
  const actions = document.getElementById('download-gate-actions');
  const title = document.getElementById('download-gate-title');
  const sub = document.getElementById('download-gate-sub');
  const fill = document.getElementById('download-gate-progress-fill');
  const pct = document.getElementById('download-gate-percent');
  const manualLink = document.getElementById('download-gate-manual-link');

  errorGroup.classList.add('hidden');
  actions.classList.add('hidden');
  progressGroup.classList.remove('hidden');
  title.textContent = 'Preparing your download…';
  sub.textContent = "Hang tight, your file will start downloading automatically.";
  fill.style.width = '0%';
  pct.textContent = '0%';

  if (isKnownBypassReferrer()) {
    progressGroup.classList.add('hidden');
    errorGroup.classList.remove('hidden');
    errorGroup.querySelector('p').textContent =
      "This download can't be completed through a link bypasser. Please open the pack page directly on Pepe's Portfolio and download it from there.";
    return;
  }

  const result = decodeDownloadToken(token);
  if (result.invalid || result.expired) {
    progressGroup.classList.add('hidden');
    errorGroup.classList.remove('hidden');
    errorGroup.querySelector('p').textContent = result.expired
      ? 'This download link has expired. Go back to the pack and download it again.'
      : 'This download link is invalid.';
    return;
  }

  manualLink.href = result.url;
  const duration = 2200;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min(100, ((now - start) / duration) * 100);
    fill.style.width = `${progress}%`;
    pct.textContent = `${Math.round(progress)}%`;
    if (progress < 100) {
      requestAnimationFrame(tick);
    } else {
      title.textContent = 'Your download has started!';
      sub.textContent = "If nothing happened, use the button below.";
      actions.classList.remove('hidden');

      const link = document.createElement('a');
      link.href = result.url;
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }
  requestAnimationFrame(tick);
}

function resolveInitialRoute() {
  let path = location.pathname.replace(/\/+$/, '') || '/';

  // Back-compat for old hash-based links (#library, #pack-20) shared before
  // the site switched to clean paths.
  if (path === '/' && location.hash) {
    const hash = location.hash.slice(1);
    if (hash.startsWith('pack-')) {
      path = `/pack/${hash.slice(5)}`;
    } else if (window.router.pages.includes(hash)) {
      path = `/${hash}`;
    }
  }

  const downloadMatch = path.match(/^\/download\/(.+)$/);
  if (downloadMatch) {
    showDownloadGate(downloadMatch[1]);
    return;
  }

  const userMatch = path.match(/^\/user\/(.+)$/);
  if (userMatch) {
    window.packLibrary.showUserProfile(decodeURIComponent(userMatch[1]), { push: false });
    history.replaceState({ page: 'user', id: decodeURIComponent(userMatch[1]) }, '', path);
    return;
  }

  const packMatch = path.match(/^\/pack\/(.+)$/);
  if (packMatch) {
    const identifier = decodeURIComponent(packMatch[1]);
    const numericId = /^\d+$/.test(identifier) ? parseInt(identifier, 10) : null;
    const lib = window.packLibrary;
    const find = () => lib.packs.find(p => lib.packSlug(p) === identifier || p.id === numericId);
    const open = (pack) => {
      window.router.show('library', { push: false });
      history.replaceState({ page: 'library' }, '', '/library');
      lib.showDetail(pack, { push: true });
    };
    const pack = find();
    if (pack) { open(pack); return; }
    // Not in packs.json: it may be a community pack that is still loading.
    window.router.show('library', { push: false });
    history.replaceState({ page: 'pack-loading' }, '', path);
    Promise.resolve(lib.communityReady).then(() => {
      if (location.pathname.replace(/\/+$/, '') !== path) return; // visitor moved on
      const late = find();
      if (late) { open(late); return; }
      show404();
      history.replaceState({ page: '404' }, '', path);
    });
    return;
  }

  let pageId = path === '/' ? 'home' : path.slice(1);

  if (path === '/' && localStorage.getItem('rememberLastPage') === 'true') {
    const lastPage = localStorage.getItem('lastVisitedPage');
    if (lastPage && window.router.pages.includes(lastPage)) pageId = lastPage;
  }

  if (window.router.pages.includes(pageId)) {
    window.router.show(pageId, { push: false });
    history.replaceState({ page: pageId }, '', pageId === 'home' ? '/' : `/${pageId}`);
    return;
  }

  show404();
  history.replaceState({ page: '404' }, '', path);
}

window.addEventListener('popstate', (e) => {
  const state = e.state;

  if (!state || state.page === 'pack-loading') {
    resolveInitialRoute();
    return;
  }

  if (state.page === '404') {
    show404();
    return;
  }

  if (state.page === 'pack') {
    window.router.show('library', { push: false });
    const pack = window.packLibrary.packs.find(p => p.id === state.id);
    if (pack) window.packLibrary.showDetail(pack, { push: false });
    return;
  }

  if (state.page === 'user') {
    window.packLibrary.showUserProfile(state.id, { push: false });
    return;
  }

  window.router.show(state.page, { push: false });
});
