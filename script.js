// Page Router
class Router {
  constructor() {
    this.pages = ['home', 'projects', 'hub', 'socials', 'library'];
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

    document.getElementById('settings-toggle').addEventListener('click', () => this.openSettings());
    document.querySelector('.modal-close').addEventListener('click', () => this.closeSettings());
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target.id === 'settings-modal') this.closeSettings();
    });

    document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
      this.setDarkMode(e.target.checked);
    });

    document.getElementById('compact-view-toggle').addEventListener('change', (e) => {
      this.setCompactView(e.target.checked);
    });

    document.getElementById('back-to-browse').addEventListener('click', () => {
      if (history.state && history.state.page === 'pack') {
        history.back();
      } else {
        this.showBrowse();
      }
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
        name: 'Modern UI Kit',
        category: 'designs',
        description: 'A modern and clean UI component library perfect for web applications.',
        thumbnail: '',
        tags: ['ui', 'web', 'components'],
        version: '1.0.0',
        downloads: 234,
        size: '12.5 MB',
        author: 'You',
        createdAt: '2026-08-15',
        updatedAt: '2026-08-15',
        fileName: 'modern-ui-kit.zip',
        gameVersion: '1.0',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 2,
        name: 'Dark Theme Template',
        category: 'templates',
        description: 'Professional dark theme template with ready-to-use components.',
        thumbnail: '',
        tags: ['dark', 'theme', 'template'],
        version: '2.1.0',
        downloads: 567,
        size: '8.3 MB',
        author: 'You',
        createdAt: '2026-08-10',
        updatedAt: '2026-08-12',
        fileName: 'dark-theme.zip',
        gameVersion: '2.1',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 3,
        name: 'Icon Pack Pro',
        category: 'resources',
        description: 'Comprehensive icon collection with 500+ high-quality icons.',
        thumbnail: '',
        tags: ['icons', 'graphics', 'resources'],
        version: '3.2.1',
        downloads: 892,
        size: '15.7 MB',
        author: 'You',
        createdAt: '2026-07-20',
        updatedAt: '2026-08-01',
        fileName: 'icon-pack-pro.zip',
        gameVersion: '3.2',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 4,
        name: 'Typography System',
        category: 'designs',
        description: 'Complete typography system with font pairings and sizing scales.',
        thumbnail: '',
        tags: ['typography', 'fonts', 'design'],
        version: '1.5.0',
        downloads: 123,
        size: '4.2 MB',
        author: 'You',
        createdAt: '2026-06-05',
        updatedAt: '2026-06-05',
        fileName: 'typography-system.zip',
        gameVersion: '1.5',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 5,
        name: 'Color Palettes',
        category: 'resources',
        description: 'Curated collection of color palettes for various design needs.',
        thumbnail: '',
        tags: ['colors', 'palettes', 'design'],
        version: '2.0.0',
        downloads: 445,
        size: '1.8 MB',
        author: 'You',
        createdAt: '2026-05-18',
        updatedAt: '2026-05-18',
        fileName: 'color-palettes.zip',
        gameVersion: '2.0',
        downloadUrl: '#',
        previewUrl: '#'
      },
      {
        id: 6,
        name: 'Landing Page Template',
        category: 'templates',
        description: 'Responsive landing page template with conversion-optimized design.',
        thumbnail: '',
        tags: ['landing', 'web', 'template'],
        version: '1.2.3',
        downloads: 678,
        size: '9.1 MB',
        author: 'You',
        createdAt: '2026-04-22',
        updatedAt: '2026-04-30',
        fileName: 'landing-page.zip',
        gameVersion: '1.2',
        downloadUrl: '#',
        previewUrl: '#'
      }
    ];
  }

  updateCategoryCounts() {
    document.getElementById('count-all').textContent = this.packs.length;
    const categories = ['templates', 'designs', 'resources'];
    categories.forEach(cat => {
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
      filtered = filtered.filter(pack => pack.category === this.currentFilter.category);
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

    grid.innerHTML = this.filteredPacks.map(pack => this.createPackCard(pack)).join('');

    grid.querySelectorAll('.pack-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.packId, 10);
        const pack = this.packs.find(p => p.id === id);
        if (pack) this.showDetail(pack);
      });
    });
  }

  createPackCard(pack) {
    const letter = pack.name.charAt(0).toUpperCase();
    const hasImage = pack.thumbnail && pack.thumbnail.startsWith('http');

    return `
      <div class="pack-card" data-pack-id="${pack.id}">
        <div class="pack-thumbnail">
          ${hasImage ? `<img src="${pack.thumbnail}" alt="${this.escapeHtml(pack.name)}">` : `<span class="pack-letter">${letter}</span>`}
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
    const hasImage = pack.thumbnail && pack.thumbnail.startsWith('http');
    const letter = pack.name.charAt(0).toUpperCase();

    document.getElementById('detail-banner').innerHTML = hasImage
      ? `<img src="${pack.thumbnail}" alt="${this.escapeHtml(pack.name)}">`
      : `<span class="pack-letter">${letter}</span>`;
    document.getElementById('detail-thumb').innerHTML = hasImage
      ? `<img src="${pack.thumbnail}" alt="${this.escapeHtml(pack.name)}">`
      : `<span class="pack-letter">${letter}</span>`;

    document.getElementById('detail-name').textContent = pack.name;
    document.getElementById('detail-badge').textContent = this.capitalizeFirst(pack.category);
    document.getElementById('detail-author').textContent = `by ${pack.author || 'Unknown'}`;
    document.getElementById('detail-description').textContent = pack.description;

    document.getElementById('versions-sub').textContent = `Download releases of ${pack.name}.`;
    document.getElementById('detail-version').textContent = pack.version;
    document.getElementById('detail-date').textContent = this.formatDate(pack.createdAt);
    document.getElementById('detail-file').textContent = `${pack.fileName || 'download.zip'} · ${pack.size} · ${pack.downloads} downloads`;
    document.getElementById('detail-tags').innerHTML = `
      ${pack.gameVersion ? `<span>${this.escapeHtml(pack.gameVersion)}</span>` : ''}
      <span>${this.capitalizeFirst(pack.category)}</span>
    `;

    document.getElementById('detail-download').href = pack.downloadUrl;
    document.getElementById('detail-download-inline').href = pack.downloadUrl;

    document.getElementById('detail-avatar').textContent = (pack.author || 'U').charAt(0).toUpperCase();
    document.getElementById('detail-author-name').textContent = pack.author || 'Unknown';
    document.getElementById('detail-downloads').textContent = pack.downloads;
    document.getElementById('detail-made').textContent = this.formatDate(pack.createdAt);
    document.getElementById('detail-updated').textContent = this.formatDate(pack.updatedAt || pack.createdAt);

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
      darkModeToggle.checked = false;
      if (themeIcon) themeIcon.className = 'fas fa-sun';
      localStorage.setItem('darkMode', 'true');
    } else {
      document.body.classList.add('light-mode');
      darkModeToggle.checked = true;
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

  loadTheme() {
    const darkMode = localStorage.getItem('darkMode');
    const compactView = localStorage.getItem('compactView');

    if (darkMode === 'false') {
      this.setDarkMode(false);
    }

    if (compactView === 'true') {
      this.setCompactView(true);
    }
  }

  openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    document.getElementById('dark-mode-toggle').checked = document.body.classList.contains('light-mode');
    document.getElementById('compact-view-toggle').checked = document.body.classList.contains('compact-view');
  }

  closeSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
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
    window.router.show('home', { push: false });
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
