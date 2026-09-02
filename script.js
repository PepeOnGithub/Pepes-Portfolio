const CATEGORY_ORDER = ['packs', 'cosmetics', 'utility', 'clients', 'addons', 'website', 'other'];

const DEFAULT_BANNER_URL = 'assets/default-banner.png';
const API_BASE = 'https://pepes-portfolio-api.pepeoncloudeflare.workers.dev';
const LINKVERTISE_USER_ID = 499358;
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
  green: '#489c49',
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
}

// A boolean setting read straight from localStorage, defaulting when unset.
function getBoolSetting(key, defaultValue = false) {
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  return stored === 'true';
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
  const stored = localStorage.getItem(MONETIZATION_PROVIDER_KEY);
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

function getLinkvertiseUrl(targetUrl) {
  if (!LINKVERTISE_USER_ID) return targetUrl;
  try {
    const gateUrl = getDownloadGateUrl(targetUrl, { expiring: true });
    const encoded = encodeURIComponent(btoa(gateUrl));
    const random = Math.random() * 1000;
    return `https://link-to.net/${LINKVERTISE_USER_ID}/${random}/dynamic/?r=${encoded}`;
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
function getMonetizedUrl(targetUrl, lootUrl, forcedProvider) {
  if (!targetUrl || targetUrl === '#' || !isMonetizationOn()) return targetUrl;

  const provider = forcedProvider || getMonetizationProvider();
  if (provider === 'lootlabs' && lootUrl) return lootUrl;

  return getLinkvertiseUrl(targetUrl);
}

class Router {
  constructor() {
    this.pages = ['home', 'projects', 'socials', 'library', 'settings', 'stats'];
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

    document.querySelectorAll('.topnav-link, .mobile-nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageId);
    });

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

    if (window.packLibrary) {
      window.packLibrary.showBrowse({ push: false });
      if (pageId === 'stats') window.packLibrary.renderStatsPage();
    }

    if (push) {
      history.pushState({ page: pageId }, '', pageId === 'home' ? '/' : `/${pageId}`);
    }
    document.title = "Pepe's Portfolio";
  }

  updateSocialsStats() {
    // Update age (born December 26)
    const today = new Date();
    const birthDate = new Date(2006, 11, 26);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
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
      sort: localStorage.getItem('defaultSort') || 'relevance'
    };
    this.viewMode = localStorage.getItem('libraryViewMode') === 'list' ? 'list' : 'grid';
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
    this.renderClientsTimeline();
    this.syncCategorySidebar();
    this.syncSettingsCategorySidebar();
    this.applyFilters();
  }

  renderClientsTimeline() {
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
    }

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

    const emptyClearBtn = document.getElementById('empty-state-clear-btn');
    if (emptyClearBtn) {
      emptyClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        this.currentFilter.search = '';
        this.currentFilter.category = '';
        this.syncCategorySidebar();
        this.applyFilters();
        document.getElementById('search-clear').classList.add('hidden');
      });
    }

    // ===== Global keyboard shortcuts (Library page) =====
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (e.key === '/' && !typing) {
        const libraryPage = document.getElementById('page-library');
        if (libraryPage && !libraryPage.classList.contains('hidden')) {
          e.preventDefault();
          searchInput.focus();
        }
        return;
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

      const askEveryTime = localStorage.getItem('askProviderEveryTime') !== 'false';
      const needsAssets = this.currentPack.requiresAssets && !this.currentPack.pinned
        && localStorage.getItem('hideAssetsModal') !== 'true';

      if (!askEveryTime && !needsAssets) return; // let the plain <a href> navigate normally

      e.preventDefault();
      e.stopImmediatePropagation();

      this.pendingDownloadLink = link;

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
      const pack = this.currentPack;
      const versions = pack.versions;
      const multi = versions && versions.length > 1;
      const version = multi
        ? (link.id === 'detail-download' ? versions[this.selectedVersionIndex || 0] : versions[parseInt(link.dataset.versionIndex, 10)])
        : null;

      if (getBoolSetting('copyNameOnDownload') && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pack.name).catch(() => {});
      }

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
  }

  syncSettingsCategorySidebar() {
    const saved = localStorage.getItem('selectedSettingsCategory');
    const btn = saved && document.querySelector(`#page-settings .category-row[data-settings-category="${saved}"]`);
    if (btn) this.handleSettingsCategoryClick(btn);
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

    this.selectedProvider = getMonetizationProvider();
    document.querySelectorAll('#provider-choice-tabs .provider-tab').forEach(tab => {
      const selected = tab.dataset.value === this.selectedProvider;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });

    document.getElementById('download-provider-modal-overlay').classList.remove('hidden');
  }

  hideProviderModal() {
    document.getElementById('download-provider-modal-overlay').classList.add('hidden');
  }

  confirmProviderModal() {
    const provider = this.selectedProvider || 'linkvertise';
    this.hideProviderModal();

    const link = this.pendingDownloadLink;
    if (!link) return;

    const rawUrl = link.dataset.rawUrl;
    const lootUrl = link.dataset.lootUrl || null;
    link.href = getMonetizedUrl(rawUrl, lootUrl, provider);

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

  showAssetsModal(pack, link) {
    const assetsPack = this.getAssetsPack();
    if (!assetsPack) return;

    this.pendingDownloadLink = link;
    document.getElementById('assets-modal-pack-name').textContent = pack.name;

    const getBtn = document.getElementById('assets-modal-get');
    const latestVersion = (assetsPack.versions && assetsPack.versions[0]) || assetsPack;
    getBtn.href = getMonetizedUrl(latestVersion.downloadUrl || assetsPack.downloadUrl, latestVersion.lootUrl || assetsPack.lootUrl);
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
      localStorage.setItem('hideAssetsModal', 'true');
    }
    document.getElementById('assets-modal-overlay').classList.add('hidden');
    this.pendingDownloadLink = null;
  }

  async loadPacks() {
    try {
      const response = await fetch('packs.json');
      if (!response.ok) throw new Error(`packs.json request failed: ${response.status}`);
      const data = await response.json();
      this.packs = data.packs || [];
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
      { icon: 'fa-box-open', label: 'Total Packs', value: this.packs.length },
      { icon: 'fa-download', label: 'Total Downloads', value: this.formatCount(totalDownloads) },
      { icon: 'fa-bolt', label: 'Active', value: active.length },
      { icon: 'fa-ban', label: 'Discontinued', value: this.packs.length - active.length },
    ];
    document.getElementById('stats-summary-grid').innerHTML = summary.map(s => `
      <div class="stats-summary-card">
        <i class="fas ${s.icon}"></i>
        <p class="stats-summary-value">${s.value}</p>
        <p class="stats-summary-label">${s.label}</p>
      </div>
    `).join('');

    const maxCatCount = Math.max(1, ...CATEGORY_ORDER.map(cat => this.packs.filter(p => p.category === cat).length));
    document.getElementById('stats-category-list').innerHTML = CATEGORY_ORDER.map(cat => {
      const count = this.packs.filter(p => p.category === cat).length;
      const pct = Math.round((count / maxCatCount) * 100);
      return `
        <div class="stats-category-row">
          <span class="stats-category-name">${this.capitalizeFirst(cat)}</span>
          <div class="stats-category-bar-track"><div class="stats-category-bar-fill" style="width:${pct}%"></div></div>
          <span class="stats-category-count">${count}</span>
        </div>
      `;
    }).join('');

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
      spotlightCard('Most Downloaded', mostDownloaded) + spotlightCard('Newest Addition', newest);

    document.querySelectorAll('.stats-spotlight-card').forEach(card => {
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
    localStorage.setItem('favoritePacks', JSON.stringify([...this.favorites]));
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
    localStorage.setItem('collapsedSections', JSON.stringify([...this.collapsedSections]));
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
      const detailFav = document.getElementById('detail-favorite-btn');
      if (detailFav) detailFav.classList.toggle('active', this.favorites.has(packId));
    }
  }

  updateFavoritesCount() {
    const elem = document.getElementById('count-favorites');
    if (elem) elem.textContent = this.favorites.size;
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
    this.applyFilters();
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
    const category = row.dataset.category;
    this.currentFilter.category = category;
    localStorage.setItem('selectedCategory', category);

    document.querySelectorAll('#page-library .category-row').forEach(btn => btn.classList.remove('active'));
    row.classList.add('active');

    this.applyFilters();
  }

  syncCategorySidebar() {
    document.querySelectorAll('#page-library .category-row').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === this.currentFilter.category);
    });
  }

  handleSort(e) {
    this.currentFilter.sort = e.target.value;
    this.applyFilters();
  }

  applyFilters() {
    let filtered = [...this.packs];

    if (localStorage.getItem('showDiscontinued') === 'false') {
      filtered = filtered.filter(pack => !pack.discontinued);
    }

    if (this.currentFilter.search) {
      const search = this.currentFilter.search;
      filtered = filtered.filter(pack =>
        pack.name.toLowerCase().includes(search) ||
        pack.description.toLowerCase().includes(search) ||
        (pack.tags || []).some(tag => tag.toLowerCase().includes(search))
      );
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
        filtered.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'least-popular':
        filtered.sort((a, b) => a.downloads - b.downloads);
        break;
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        filtered.sort((a, b) => b.name.localeCompare(a.name));
        break;
      default:
        if (this.currentFilter.search) {
          filtered.sort((a, b) => a.name.localeCompare(b.name));
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
      const hasActiveFilters = !!this.currentFilter.search || !!this.currentFilter.category;
      if (this.packsLoadError) {
        emptyState.querySelector('h2').textContent = "Couldn't load packs";
        emptyState.querySelector('p').textContent = 'Please check your connection and refresh the page.';
        if (clearBtn) clearBtn.classList.add('hidden');
      } else {
        emptyState.querySelector('h2').textContent = 'No packs found';
        emptyState.querySelector('p').textContent = hasActiveFilters
          ? 'Try adjusting your search or filters'
          : 'Nothing in this category yet — check back soon';
        if (clearBtn) clearBtn.classList.toggle('hidden', !hasActiveFilters);
      }
      resultsText.textContent = '0 projects';
      return;
    }

    emptyState.style.display = 'none';
    const count = this.filteredPacks.length;
    resultsText.textContent = `${count} project${count !== 1 ? 's' : ''}`;

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

    if (this.currentFilter.category === '') {
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

    grid.querySelectorAll('.pack-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.packId, 10);
        const pack = this.packs.find(p => p.id === id);
        if (!pack) return;

        if (pack.category === 'website' && pack.externalUrl) {
          this.openExternal(pack.externalUrl);
        } else {
          this.showDetail(pack);
        }
      });
    });

    grid.querySelectorAll('.pack-favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.packId, 10);
        this.toggleFavorite(id);
      });
    });

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
      divider.addEventListener('click', () => this.toggleSectionCollapsed(divider));
    });

    this.fetchVisibleCardDownloadCounts();
  }

  // Card download counts come from packs.json's snapshot value (usually 0 -
  // it's only ever populated from a local .metadata.json that doesn't really
  // exist), so fetch each visible card's real count from the counter API,
  // once per pack per session.
  fetchVisibleCardDownloadCounts() {
    const cards = document.querySelectorAll('#packs-grid .downloads[data-pack-id]');
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

      totalPromise.then(count => {
        this.liveDownloadCounts.set(id, count);
        const liveEl = document.querySelector(`#packs-grid .downloads[data-pack-id="${id}"]`);
        if (liveEl) liveEl.textContent = this.formatCount(count);
      });
    });
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
    if (pack.pinned || pack.category !== 'packs') return '';
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
    localStorage.setItem('seenPackUpdates', JSON.stringify(seen));
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

  createPackCard(pack) {
    const hasImage = this.isImagePath(pack.thumbnail);
    const requiredBadge = pack.pinned
      ? `<span class="pinned-badge"><i class="fas fa-thumbtack"></i> Required</span>`
      : '';
    const assetsTag = this.assetsTag(pack);
    const mcVersionTag = this.mcVersionTag(pack);
    const comingSoonTag = this.comingSoonTag(pack);
    const favoriteBtn = this.favoriteButton(pack);
    const updatedBadge = this.updatedBadge(pack);

    if (this.viewMode === 'list') {
      const iconBadge = hasImage
        ? `<span class="pack-icon-badge"><img src="${pack.thumbnail}" alt="" loading="lazy" decoding="async"></span>`
        : `<span class="pack-icon-badge">${this.fallbackIconContent(pack)}</span>`;

      return `
        <div class="pack-card ${pack.pinned ? 'pack-card-pinned' : ''}" data-pack-id="${pack.id}">
          <div class="pack-thumbnail">
            ${iconBadge}
          </div>
          <div class="pack-content">
            <div class="pack-title-row">
              <span class="pack-name">${this.escapeHtml(pack.name)}</span>
              <span class="pack-badge">${this.capitalizeFirst(pack.category)}</span>
              ${mcVersionTag}
              ${assetsTag}
              ${comingSoonTag}
              ${requiredBadge}
              ${updatedBadge}
            </div>
            <p class="pack-description">${this.escapeHtml(pack.description)}</p>
            <div class="pack-footer">
              <span>by ${this.escapeHtml(pack.author || 'Unknown')}</span>
              <span class="downloads" data-pack-id="${pack.id}">${this.formatCount(this.liveDownloadCounts.get(pack.id) ?? pack.downloads)}</span>
            </div>
          </div>
          ${favoriteBtn}
        </div>
      `;
    }

    const hasBanner = this.isImagePath(pack.bannerUrl);
    const bannerSrc = hasBanner ? pack.bannerUrl : DEFAULT_BANNER_URL;

    const iconBadge = hasImage
      ? `<span class="pack-icon-badge"><img src="${pack.thumbnail}" alt="" loading="lazy" decoding="async"></span>`
      : (pack.faIcon ? `<span class="pack-icon-badge">${this.fallbackIconContent(pack)}</span>` : '');

    return `
      <div class="pack-card ${pack.pinned ? 'pack-card-pinned' : ''}" data-pack-id="${pack.id}">
        ${requiredBadge}
        <div class="pack-thumbnail">
          <img class="pack-thumbnail-bg" src="${bannerSrc}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">
          <span class="pack-splash-name"><span>${this.escapeHtml(pack.name)}</span></span>
          ${iconBadge}
          ${favoriteBtn}
        </div>
        <div class="pack-content">
          <div class="pack-title-row">
            <span class="pack-name">${this.escapeHtml(pack.name)}</span>
            <span class="pack-badge">${this.capitalizeFirst(pack.category)}</span>
            ${mcVersionTag}
            ${assetsTag}
            ${comingSoonTag}
            ${updatedBadge}
          </div>
          <p class="pack-description">${this.escapeHtml(pack.description)}</p>
          <div class="pack-footer">
            <span>by ${this.escapeHtml(pack.author || 'Unknown')}</span>
            <span class="downloads" data-pack-id="${pack.id}">${this.formatCount(this.liveDownloadCounts.get(pack.id) ?? pack.downloads)}</span>
          </div>
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
    localStorage.setItem('recentlyViewedPacks', JSON.stringify(ids.slice(0, 20)));
  }

  showDetail(pack, { push = true } = {}) {
    this.trackRecentlyViewed(pack);
    this.markPackUpdateSeen(pack);
    const hasImage = this.isImagePath(pack.thumbnail);
    const hasBanner = this.isImagePath(pack.bannerUrl);
    const bannerSrc = hasBanner ? pack.bannerUrl : DEFAULT_BANNER_URL;

    document.getElementById('detail-banner').innerHTML = `
      <img class="detail-banner-bg" src="${bannerSrc}" alt="" onerror="this.style.display='none'">
      <span class="detail-splash-name">${this.escapeHtml(pack.name)}</span>
    `;
    document.getElementById('detail-thumb').innerHTML = hasImage
      ? `<img src="${pack.thumbnail}" alt="${this.escapeHtml(pack.name)}">`
      : this.fallbackIconContent(pack);

    document.getElementById('detail-name').textContent = pack.name;
    document.getElementById('detail-badge').textContent = this.capitalizeFirst(pack.category);
    document.getElementById('detail-author').textContent = `by ${pack.author || 'Unknown'}`;
    document.getElementById('detail-description').textContent = pack.description;

    const showsAssetsState = !pack.discontinued && !pack.pinned && pack.category === 'packs';
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
      detailDownload.href = getMonetizedUrl(rawUrl, lootUrl);
      detailDownload.innerHTML = pack.discontinued
        ? `<i class="fas fa-download"></i> Download (Archived)`
        : `<i class="fas fa-download"></i> Download`;
    }
    this.applyLinkTargets();

    document.getElementById('detail-avatar').textContent = (pack.author || 'U').charAt(0).toUpperCase();
    document.getElementById('detail-author-name').textContent = pack.author || 'Unknown';
    document.getElementById('detail-made').textContent = this.formatDate(pack.createdAt);
    document.getElementById('detail-updated').textContent = this.formatDate(pack.updatedAt || pack.createdAt);

    this.currentPack = pack;
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
        ? `<img src="${p.thumbnail}" alt="" loading="lazy" decoding="async">`
        : this.fallbackIconContent(p);
      return `
        <button type="button" class="related-pack-card" data-pack-id="${p.id}">
          <span class="related-pack-icon">${iconContent}</span>
          <span class="related-pack-name">${this.escapeHtml(p.name)}</span>
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
    let id = localStorage.getItem('voterId');
    if (!id) {
      id = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('voterId', id);
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
    return localStorage.getItem('sessionToken');
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
    document.getElementById('email-auth-modal-title').textContent = isSignup ? 'Sign Up' : 'Login';
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
    document.getElementById('auth-pill-username').textContent = this.currentUser.username || this.currentUser.name || 'Account';

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
    document.getElementById('profile-avatar-url').value = '';
    document.getElementById('profile-banner-url').value = '';
    document.getElementById('profile-form-error').classList.add('hidden');
    document.getElementById('profile-modal-overlay').classList.remove('hidden');
  }

  closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.add('hidden');
  }

  async saveProfile() {
    const errorEl = document.getElementById('profile-form-error');
    errorEl.classList.add('hidden');

    const username = document.getElementById('profile-username').value.trim();
    const displayName = document.getElementById('profile-display-name').value.trim();
    const avatarUrl = document.getElementById('profile-avatar-url').value.trim();
    const bannerUrl = document.getElementById('profile-banner-url').value.trim();

    try {
      const res = await this.authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username || null,
          displayName: displayName || null,
          avatarUrl: avatarUrl || null,
          bannerUrl: bannerUrl || null,
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
    listEl.innerHTML = '<p class="comments-empty">Loading comments...</p>';
    document.getElementById('comments-signed-out-note').classList.toggle('hidden', !!this.currentUser);
    document.getElementById('comment-form').classList.toggle('hidden', !this.currentUser);

    try {
      const res = await fetch(`${API_BASE}/api/comments/${this.packSlug(pack)}`);
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
    listEl.innerHTML = comments.map((c) => {
      const isOwn = this.currentUser && this.currentUser.id === c.user.id;
      const avatar = c.user.avatarUrl || 'assets/pepe-profile.png';
      return `
        <div class="comment-item" data-comment-id="${c.id}">
          <img class="comment-avatar" src="${avatar}" alt="" loading="lazy" decoding="async">
          <div class="comment-body">
            <div class="comment-header">
              <span class="comment-author">${this.escapeHtml(c.user.name || 'Unknown')}</span>
              <span class="comment-time">${this.formatDate(c.createdAt)}</span>
              ${isOwn ? `<button type="button" class="comment-delete-btn" data-comment-id="${c.id}" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <p class="comment-text">${this.escapeHtml(c.text)}</p>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.comment-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteComment(btn.dataset.commentId));
    });
  }

  async submitComment() {
    if (!this.currentUser || !this.currentPack) return;
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text) return;

    const btn = document.getElementById('comment-submit-btn');
    btn.disabled = true;
    try {
      const res = await this.authFetch(`/api/comments/${this.packSlug(this.currentPack)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        input.value = '';
        this.loadComments(this.currentPack);
      }
    } finally {
      btn.disabled = false;
    }
  }

  async deleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;
    const res = await this.authFetch(`/api/comment/${commentId}`, { method: 'DELETE' });
    if (res.ok && this.currentPack) this.loadComments(this.currentPack);
  }

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  packSlug(pack) {
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
      <li role="option" data-index="${i}" class="${i === 0 ? 'selected' : ''}">${this.escapeHtml(pack.name)} v${this.escapeHtml(v.version || '1.0.0')}</li>
    `).join('');
    document.getElementById('version-select-label').textContent = `${pack.name} v${pack.versions[0].version || '1.0.0'}`;

    menu.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        this.selectPackVersion(pack, parseInt(li.dataset.index, 10));
        menu.classList.remove('open');
        document.getElementById('version-select-trigger').classList.remove('open');
      });
    });
  }

  selectPackVersion(pack, index) {
    const version = pack.versions[index];
    if (!version) return;
    this.selectedVersionIndex = index;

    document.getElementById('version-select-label').textContent = `${pack.name} v${version.version || '1.0.0'}`;
    document.querySelectorAll('#version-select-menu li').forEach(li => {
      li.classList.toggle('selected', parseInt(li.dataset.index, 10) === index);
    });

    const detailDownload = document.getElementById('detail-download');
    detailDownload.dataset.rawUrl = version.downloadUrl;
    detailDownload.dataset.lootUrl = version.lootUrl || '';
    detailDownload.href = getMonetizedUrl(version.downloadUrl, version.lootUrl);
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
      date: pack.createdAt
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
        <a href="${getMonetizedUrl(v.downloadUrl, v.lootUrl)}" class="btn-download version-download-btn" data-version-index="${i}" data-raw-url="${v.downloadUrl}" data-loot-url="${v.lootUrl || ''}">
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

  async incrementDownloads(pack, version) {
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

    this.setAccentColor(localStorage.getItem('accentColor') || 'green', { persist: false });

    document.getElementById('autoplay-showcase-toggle').checked = localStorage.getItem('autoplayShowcase') === 'true';
    // "Ask Every Time" should be default true. If it's never been set, or set to true, enable it. Only false explicitly disables it.
    const askProviderToggle = document.getElementById('ask-provider-toggle');
    askProviderToggle.checked = localStorage.getItem('askProviderEveryTime') !== 'false';
    this.updateMonetizationProviderDropdownState(askProviderToggle.checked);
  }

  syncDropdownSelection(dropdown, value) {
    if (!dropdown || !dropdown.menu) return;
    const option = dropdown.menu.querySelector(`li[data-value="${value}"]`);
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
    root.setProperty('--color-accent', accent);
    root.setProperty('--color-accent-dark', dark);
    root.setProperty('--color-accent-light', light);

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

    document.querySelectorAll('#theme-preset-swatches .theme-preset-swatch').forEach(el => {
      el.classList.toggle('selected', el.dataset.hex.toLowerCase() === hex.toLowerCase());
    });
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
    el.textContent = "It's my birthday today! 🎉";
    return;
  }
  if (startOfToday > birthday) {
    birthday = new Date(currentYear + 1, 11, 26);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.ceil((birthday - startOfToday) / msPerDay);
  el.textContent = `${days} day${days === 1 ? '' : 's'} to go 🎂`;
}

function show404() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-404').classList.add('active');
  document.title = "Page Not Found · Pepe";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDownloadGate(token) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-download').classList.add('active');
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

  const packMatch = path.match(/^\/pack\/(.+)$/);
  if (packMatch) {
    const identifier = decodeURIComponent(packMatch[1]);
    const numericId = /^\d+$/.test(identifier) ? parseInt(identifier, 10) : null;
    const pack = window.packLibrary.packs.find(p =>
      window.packLibrary.packSlug(p) === identifier || p.id === numericId
    );
    if (!pack) {
      show404();
      history.replaceState({ page: '404' }, '', path);
      return;
    }
    window.router.show('library', { push: false });
    history.replaceState({ page: 'library' }, '', '/library');
    window.packLibrary.showDetail(pack, { push: true });
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

  if (!state) {
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

  window.router.show(state.page, { push: false });
});
