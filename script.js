const CATEGORY_ORDER = ['packs', 'clients', 'addons', 'website', 'other'];

// Default banner shown behind the pack name (Minecraft splash-text style)
// whenever a pack doesn't have its own bg.png banner.
const DEFAULT_BANNER_URL = 'assets/default-banner.png';

// Free, no-auth counter API — lets download counts persist and increment
// globally without running any server or Cloudflare Worker of our own.
// https://jasoncameron.dev/abacus/
const COUNTER_NAMESPACE = 'pepes-portfolio-pack-downloads';

// Linkvertise monetization, same setup as ClientLibrary
const LINKVERTISE_USER_ID = 499358;
function isMonetizationOn() { return true; }

function getMonetizedUrl(targetUrl) {
  if (!targetUrl || targetUrl === '#' || !isMonetizationOn() || !LINKVERTISE_USER_ID) return targetUrl;
  try {
    const encoded = encodeURIComponent(btoa(targetUrl));
    const random = Math.random() * 1000;
    return `https://link-to.net/${LINKVERTISE_USER_ID}/${random}/dynamic/?r=${encoded}`;
  } catch (e) {
    return targetUrl;
  }
}

// Page Router
class Router {
  constructor() {
    this.pages = ['home', 'projects', 'socials', 'library', 'settings'];
    this.setupNav();
  }

  setupNav() {
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.show(el.dataset.page);
      });
    });
  }

  show(pageId, { push = true } = {}) {
    if (!this.pages.includes(pageId)) return;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`).classList.add('active');

    document.querySelectorAll('.topnav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageId);
    });

    document.getElementById('main-content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (window.packLibrary) {
      window.packLibrary.showBrowse({ push: false });
    }

    if (push) {
      history.pushState({ page: pageId }, '', `#${pageId}`);
    }
    document.title = 'Pepe';
  }
}

// Custom Dropdown
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
    this.label.textContent = text;
    this.menu.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.value === value);
    });
    this.close();
    if (this.onSelect) this.onSelect(value);
  }
}

// Pack Library Application
class PackLibrary {
  constructor() {
    this.packs = [];
    this.filteredPacks = [];
    this.currentFilter = {
      search: '',
      category: '',
      sort: 'relevance'
    };
    this.ready = this.init();
  }

  async init() {
    this.setupEventListeners();
    this.loadTheme();
    this.sortDropdown = new CustomDropdown('sort-dropdown', (value) => {
      this.currentFilter.sort = value;
      this.applyFilters();
    });
    await this.loadPacks();
    this.updateCategoryCounts();
    this.applyFilters();
  }

  setupEventListeners() {
    document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e));

    document.querySelectorAll('.category-row').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleCategoryClick(e));
    });

    document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());

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

    document.getElementById('back-to-browse').addEventListener('click', () => {
      if (history.state && history.state.page === 'pack') {
        history.back();
      } else {
        this.showBrowse();
      }
    });

    document.getElementById('detail-download').addEventListener('click', (e) => {
      // A placeholder "#" href would otherwise navigate the fragment and
      // confuse the pack/page router — only real download URLs proceed.
      const href = e.currentTarget.getAttribute('href');
      if (!href || href === '#') e.preventDefault();

      if (!this.currentPack) return;
      const pack = this.currentPack;
      this.incrementDownloads(pack).then(count => {
        pack.downloads = count;
        if (this.currentPack === pack) this.updateDownloadsDisplay(pack, count);
      });
    });
  }

  async loadPacks() {
    try {
      const response = await fetch('packs.json', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        this.packs = data.packs || [];
      } else {
        this.packs = this.getDefaultPacks();
      }
      if (this.packs.length === 0) {
        this.packs = this.getDefaultPacks();
      }
      this.filteredPacks = [...this.packs];
      return this.packs;
    } catch (error) {
      console.error('Error loading packs:', error);
      this.packs = this.getDefaultPacks();
      this.filteredPacks = [...this.packs];
    }
  }

  getDefaultPacks() {
    return [
      {
        id: 1,
        name: 'Nyxora Texture Pack',
        category: 'packs',
        description: 'A vibrant texture pack overhauling terrain, mobs, and UI for MCBE.',
        thumbnail: '',
        tags: ['texture', 'pack', 'mcbe'],
        version: '1.0.0',
        downloads: 234,
        size: '12.5 MB',
        author: 'Pepe',
        createdAt: '2026-08-15',
        updatedAt: '2026-08-15',
        fileName: 'nyxora-texture-pack.zip',
        gameVersion: '1.21',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 2,
        name: 'Glacier Client',
        category: 'clients',
        description: 'Performance-driven MCBE client build with custom UI and modules.',
        thumbnail: '',
        tags: ['client', 'mcbe', 'performance'],
        version: '2.1.0',
        downloads: 567,
        size: '8.3 MB',
        author: 'Pepe',
        createdAt: '2026-08-10',
        updatedAt: '2026-08-12',
        fileName: 'glacier-client.zip',
        gameVersion: '1.21',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 3,
        name: "Elecro Blob's Wizardry",
        category: 'addons',
        description: 'Adds spellcasting, wands, and wizard mobs to Minecraft Bedrock.',
        thumbnail: '',
        tags: ['addon', 'magic', 'mobs'],
        version: '3.2.1',
        downloads: 892,
        size: '15.7 MB',
        author: 'Pepe',
        createdAt: '2026-07-20',
        updatedAt: '2026-08-01',
        fileName: 'elecro-blobs-wizardry.zip',
        gameVersion: '1.20',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 4,
        name: 'Flarial Config Pack',
        category: 'clients',
        description: 'Preset Flarial proxy configuration with tuned modules and HUD.',
        thumbnail: '',
        tags: ['flarial', 'config', 'client'],
        version: '1.5.0',
        downloads: 123,
        size: '4.2 MB',
        author: 'Pepe',
        createdAt: '2026-06-05',
        updatedAt: '2026-06-05',
        fileName: 'flarial-config-pack.zip',
        gameVersion: '1.21',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 5,
        name: 'Aurora Resource Pack',
        category: 'packs',
        description: 'Soft-toned resource pack with custom skies, particles, and menus.',
        thumbnail: '',
        tags: ['resource', 'pack', 'visual'],
        version: '2.0.0',
        downloads: 445,
        size: '1.8 MB',
        author: 'Pepe',
        createdAt: '2026-05-18',
        updatedAt: '2026-05-18',
        fileName: 'aurora-resource-pack.zip',
        gameVersion: '1.20',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 6,
        name: 'Cape Collection',
        category: 'other',
        description: 'A bundle of custom capes made with the Cape Generator tool.',
        thumbnail: '',
        tags: ['cape', 'cosmetic', 'misc'],
        version: '1.2.3',
        downloads: 678,
        size: '9.1 MB',
        author: 'Pepe',
        createdAt: '2026-04-22',
        updatedAt: '2026-04-30',
        fileName: 'cape-collection.zip',
        gameVersion: '1.21',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 7,
        name: 'Glacier Client Web',
        category: 'website',
        description: 'The Glacier Client landing site and download page.',
        thumbnail: '',
        tags: ['website', 'glacier'],
        version: '1.0.0',
        downloads: 156,
        size: '2.4 MB',
        author: 'Pepe',
        createdAt: '2026-03-10',
        updatedAt: '2026-03-15',
        fileName: 'glacierclient.xyz',
        gameVersion: 'N/A',
        downloadUrl: '#',
        previewUrl: '#',
        externalUrl: 'https://glacierclient.xyz'
      }
    ];
  }

  updateCategoryCounts() {
    document.getElementById('count-all').textContent = this.packs.length;
    CATEGORY_ORDER.forEach(cat => {
      const count = this.packs.filter(p => p.category === cat).length;
      const elem = document.getElementById(`count-${cat}`);
      if (elem) elem.textContent = count;
    });
  }

  handleSearch(e) {
    this.currentFilter.search = e.target.value.toLowerCase();
    this.applyFilters();
  }

  handleCategoryClick(e) {
    const row = e.currentTarget;
    const category = row.dataset.category;
    this.currentFilter.category = category;

    document.querySelectorAll('.category-row').forEach(btn => btn.classList.remove('active'));
    row.classList.add('active');

    this.applyFilters();
  }

  handleSort(e) {
    this.currentFilter.sort = e.target.value;
    this.applyFilters();
  }

  applyFilters() {
    let filtered = [...this.packs];

    if (this.currentFilter.search) {
      const search = this.currentFilter.search;
      filtered = filtered.filter(pack =>
        pack.name.toLowerCase().includes(search) ||
        pack.description.toLowerCase().includes(search) ||
        (pack.tags || []).some(tag => tag.toLowerCase().includes(search))
      );
    }

    if (this.currentFilter.category) {
      // Pinned packs (e.g. required dependencies) show in every category,
      // not just their own, since they're relevant no matter what you're browsing.
      filtered = filtered.filter(pack =>
        pack.category === this.currentFilter.category || pack.pinned
      );
    }

    switch (this.currentFilter.sort) {
      case 'recent':
        filtered.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        break;
      case 'popular':
        filtered.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        // relevance: keep as-is when no search, else sort by name
        if (this.currentFilter.search) {
          filtered.sort((a, b) => a.name.localeCompare(b.name));
        }
    }

    // Pinned packs (e.g. required dependencies) always float to the top
    // of their group, regardless of sort order.
    filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    this.filteredPacks = filtered;
    this.render();
  }

  render() {
    const grid = document.getElementById('packs-grid');
    const emptyState = document.getElementById('empty-state');
    const resultsText = document.getElementById('results-text');
    const endMarker = document.getElementById('end-marker');

    if (this.filteredPacks.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'block';
      endMarker.style.display = 'none';
      resultsText.textContent = '0 projects';
      return;
    }

    emptyState.style.display = 'none';
    endMarker.style.display = 'block';
    const count = this.filteredPacks.length;
    resultsText.textContent = `${count} project${count !== 1 ? 's' : ''}`;

    if (this.currentFilter.category === '') {
      grid.innerHTML = CATEGORY_ORDER
        .map(cat => {
          const packsInCat = this.filteredPacks.filter(p => p.category === cat);
          if (packsInCat.length === 0) return '';
          return this.createCategoryDivider(cat) + packsInCat.map(pack => this.createPackCard(pack)).join('');
        })
        .join('');
    } else {
      grid.innerHTML = this.filteredPacks.map(pack => this.createPackCard(pack)).join('');
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
    return `
      <div class="category-section-divider">
        <span></span><p>${this.capitalizeFirst(category)}</p><span></span>
      </div>
    `;
  }

  isImagePath(value) {
    return !!value && (value.startsWith('http') || value.includes('/'));
  }

  createPackCard(pack) {
    const hasImage = this.isImagePath(pack.thumbnail);
    const hasBanner = this.isImagePath(pack.bannerUrl);
    const bannerSrc = hasBanner ? pack.bannerUrl : DEFAULT_BANNER_URL;

    const iconBadge = hasImage
      ? `<span class="pack-icon-badge"><img src="${pack.thumbnail}" alt=""></span>`
      : '';

    return `
      <div class="pack-card ${pack.pinned ? 'pack-card-pinned' : ''}" data-pack-id="${pack.id}">
        ${pack.pinned ? '<span class="pinned-badge"><i class="fas fa-thumbtack"></i> Required</span>' : ''}
        <div class="pack-thumbnail">
          <img class="pack-thumbnail-bg" src="${bannerSrc}" alt="" onerror="this.style.display='none'">
          <span class="pack-splash-name">${this.escapeHtml(pack.name)}</span>
          ${iconBadge}
        </div>
        <div class="pack-content">
          <div class="pack-title-row">
            <span class="pack-name">${this.escapeHtml(pack.name)}</span>
            <span class="pack-badge">${this.capitalizeFirst(pack.category)}</span>
          </div>
          <p class="pack-description">${this.escapeHtml(pack.description)}</p>
          <div class="pack-footer">
            <span>by ${this.escapeHtml(pack.author || 'Unknown')}</span>
            <span class="downloads">${pack.downloads}</span>
          </div>
        </div>
      </div>
    `;
  }

  showDetail(pack, { push = true } = {}) {
    const hasImage = this.isImagePath(pack.thumbnail);
    const hasBanner = this.isImagePath(pack.bannerUrl);
    const letter = pack.name.charAt(0).toUpperCase();
    const bannerSrc = hasBanner ? pack.bannerUrl : DEFAULT_BANNER_URL;

    document.getElementById('detail-banner').innerHTML = `
      <img class="detail-banner-bg" src="${bannerSrc}" alt="" onerror="this.style.display='none'">
      <span class="detail-splash-name">${this.escapeHtml(pack.name)}</span>
    `;
    document.getElementById('detail-thumb').innerHTML = hasImage
      ? `<img src="${pack.thumbnail}" alt="${this.escapeHtml(pack.name)}">`
      : `<span class="pack-letter">${letter}</span>`;

    document.getElementById('detail-name').textContent = pack.name;
    document.getElementById('detail-badge').textContent = this.capitalizeFirst(pack.category);
    document.getElementById('detail-author').textContent = `by ${pack.author || 'Unknown'}`;
    document.getElementById('detail-description').textContent = pack.description;

    this.renderNotice(pack);

    document.getElementById('versions-sub').textContent = `Download releases of ${pack.name}.`;
    this.renderVersionsList(pack);

    const latestVersion = (pack.versions && pack.versions[0]) || pack;
    document.getElementById('detail-download').href = getMonetizedUrl(latestVersion.downloadUrl || pack.downloadUrl);
    this.applyLinkTargets();

    document.getElementById('detail-avatar').textContent = (pack.author || 'U').charAt(0).toUpperCase();
    document.getElementById('detail-author-name').textContent = pack.author || 'Unknown';
    document.getElementById('detail-made').textContent = this.formatDate(pack.createdAt);
    document.getElementById('detail-updated').textContent = this.formatDate(pack.updatedAt || pack.createdAt);

    this.currentPack = pack;
    this.updateDownloadsDisplay(pack, pack.downloads);
    this.fetchLiveDownloads(pack).then(count => {
      if (this.currentPack === pack) this.updateDownloadsDisplay(pack, count);
    });

    document.getElementById('browse-view').classList.add('hidden');
    document.getElementById('detail-view').classList.remove('hidden');
    window.scrollTo(0, 0);

    if (push) {
      history.pushState({ page: 'pack', id: pack.id }, '', `#pack-${pack.id}`);
    }
    document.title = `${pack.name} · Pepe`;
  }

  showBrowse({ push = true } = {}) {
    document.getElementById('detail-view').classList.add('hidden');
    document.getElementById('browse-view').classList.remove('hidden');

    if (push) {
      history.pushState({ page: 'library' }, '', '#library');
    }
    document.title = 'Pepe';
  }

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  counterKey(pack) {
    const base = (pack.fileName || pack.name || `pack-${pack.id}`)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${base}-${pack.id}`;
  }

  updateDownloadsDisplay(pack, count) {
    const downloadsEl = document.getElementById('detail-downloads');
    if (downloadsEl) downloadsEl.textContent = count;
    document.querySelectorAll('.version-downloads').forEach(el => {
      el.textContent = `${count} downloads`;
    });
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

  renderVersionsList(pack) {
    const list = document.getElementById('versions-list');
    const versions = (pack.versions && pack.versions.length ? pack.versions : [{
      version: pack.version,
      fileName: pack.fileName,
      size: pack.size,
      downloadUrl: pack.downloadUrl,
      date: pack.createdAt
    }]);

    list.innerHTML = versions.map((v, i) => `
      <div class="version-row">
        <div class="version-info">
          <div class="version-top">
            <span class="version-number">${this.escapeHtml(v.version || '1.0.0')}</span>
            <span class="version-date">${this.formatDate(v.date)}</span>
          </div>
          <p class="version-file">${this.escapeHtml(v.fileName || 'download.zip')} &middot; ${this.escapeHtml(v.size || '')} &middot; <span class="version-downloads">${pack.downloads} downloads</span></p>
          <div class="version-tags">
            ${pack.gameVersion && pack.gameVersion !== 'N/A' ? `<span>${this.escapeHtml(pack.gameVersion)}</span>` : ''}
            <span>${this.capitalizeFirst(pack.category)}</span>
            ${i === 0 && versions.length > 1 ? '<span class="latest-tag">Latest</span>' : ''}
          </div>
        </div>
        <a href="${getMonetizedUrl(v.downloadUrl)}" class="btn-download version-download-btn" data-version-index="${i}">
          <i class="fas fa-download"></i> Download
        </a>
      </div>
    `).join('');

    list.querySelectorAll('.version-download-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const href = btn.getAttribute('href');
        if (!href || href === '#') btn.removeAttribute('href');
        this.incrementDownloads(pack).then(count => {
          pack.downloads = count;
          this.updateDownloadsDisplay(pack, count);
        });
      });
    });

    this.applyLinkTargets();
  }

  async fetchLiveDownloads(pack) {
    try {
      const key = this.counterKey(pack);
      const res = await fetch(`https://abacus.jasoncameron.dev/get/${COUNTER_NAMESPACE}/${key}`);
      if (!res.ok) return pack.downloads;
      const data = await res.json();
      return typeof data.value === 'number' ? data.value : pack.downloads;
    } catch (error) {
      return pack.downloads;
    }
  }

  async incrementDownloads(pack) {
    try {
      const key = this.counterKey(pack);
      const res = await fetch(`https://abacus.jasoncameron.dev/hit/${COUNTER_NAMESPACE}/${key}`);
      if (!res.ok) return pack.downloads + 1;
      const data = await res.json();
      return typeof data.value === 'number' ? data.value : pack.downloads + 1;
    } catch (error) {
      return pack.downloads + 1;
    }
  }

  capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
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
    if (isCompact) {
      document.body.classList.add('compact-view');
      localStorage.setItem('compactView', 'true');
    } else {
      document.body.classList.remove('compact-view');
      localStorage.setItem('compactView', 'false');
    }
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
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.router = new Router();
  window.packLibrary = new PackLibrary();
  await window.packLibrary.ready;
  resolveInitialRoute();
});

function resolveInitialRoute() {
  const hash = location.hash.slice(1);

  if (hash.startsWith('pack-')) {
    const id = parseInt(hash.slice(5), 10);
    const pack = window.packLibrary.packs.find(p => p.id === id);
    window.router.show('library', { push: false });
    if (pack) {
      history.replaceState({ page: 'library' }, '', '#library');
      window.packLibrary.showDetail(pack, { push: true });
    } else {
      history.replaceState({ page: 'library' }, '', '#library');
    }
    return;
  }

  if (hash && window.router.pages.includes(hash)) {
    window.router.show(hash, { push: false });
    history.replaceState({ page: hash }, '', `#${hash}`);
    return;
  }

  history.replaceState({ page: 'home' }, '', location.pathname + location.search);
}

window.addEventListener('popstate', (e) => {
  const state = e.state;

  if (!state) {
    // No usable state (e.g. a browser-native fragment navigation) —
    // fall back to inferring the page from the current URL hash instead
    // of forcing a jump to Home.
    resolveInitialRoute();
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

window.addEventListener('hashchange', () => {
  if (window.packLibrary && window.packLibrary.packs.length) {
    resolveInitialRoute();
  }
});
