// Creator tools on the public site:
//   - Stats page, "My packs" view: downloads, views and ratings for the signed-in creator's packs.
//   - Creator profiles: bio, socials, featured videos and packs on /user/<name>.
//   - Pack pages: view counting and the creator's links next to the author.
// Data comes from the uploads worker (UPLOADS_API); ratings from the accounts worker.

// Library packs (packs.json) credited to the site owner. The site reserves
// "Pepe" names for the owner (Pepe, PepeOnMinecraft, PepeOnMCBE), so other
// people's packs in packs.json don't match.
const OWNER_AUTHOR = /^pepe/i;

class CreatorTools {
  constructor(library, uploads) {
    this.lib = library;
    this.up = uploads;
    this.days = 30;
    this.stats = null;
    this.creatorCache = new Map();
    this.bindStats();
    this.wrapProfile();
    this.wrapDetail();
  }

  esc(v) { return this.lib.escapeHtml(v == null ? '' : String(v)); }
  fmt(n) { return this.lib.formatCount(n || 0); }

  // ===== Stats page =====

  bindStats() {
    document.querySelectorAll('.st-switch-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchStats(btn.dataset.statsView));
    });
    document.querySelectorAll('.cs-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.days = Number(btn.dataset.days);
        document.querySelectorAll('.cs-range-btn').forEach(b => b.classList.toggle('active', b === btn));
        this.loadStats();
      });
    });
    document.getElementById('cs-export').addEventListener('click', () => this.exportCsv());
    document.getElementById('stats-creator-view').addEventListener('click', (e) => {
      const go = e.target.closest('[data-cs-goto]');
      if (!go) return;
      e.preventDefault();
      window.router.show('upload');
      if (go.dataset.csGoto === 'profile' && window.uploadsPage) window.uploadsPage.switchTab('profile');
    });
    document.getElementById('cs-table').addEventListener('click', (e) => {
      const open = e.target.closest('[data-cs-open]');
      if (!open) return;
      const pack = this.lib.packs.find(p => p.id === Number(open.dataset.csOpen));
      if (pack) { window.router.show('library', { push: false }); this.lib.showDetail(pack); }
    });
    // Signing in or out while looking at the creator stats.
    const renderAuthUI = this.lib.renderAuthUI.bind(this.lib);
    this.lib.renderAuthUI = (...args) => {
      const out = renderAuthUI(...args);
      this.stats = null;
      if (this.view === 'creator' && document.getElementById('page-stats').classList.contains('active')) this.loadStats();
      return out;
    };
  }

  switchStats(view) {
    this.view = view;
    document.querySelectorAll('.st-switch-btn').forEach(btn => {
      const on = btn.dataset.statsView === view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    document.getElementById('stats-library-view').classList.toggle('hidden', view !== 'library');
    document.getElementById('stats-creator-view').classList.toggle('hidden', view !== 'creator');
    const title = document.querySelector('#page-stats .page-title');
    const sub = document.querySelector('#page-stats .page-subtitle');
    if (view === 'creator') {
      title.textContent = 'Your stats';
      sub.textContent = 'Downloads, views and ratings for the packs you upload.';
      this.loadStats();
    } else {
      title.textContent = 'Library stats';
      sub.textContent = 'The numbers behind everything in the library.';
    }
  }

  setState(html) {
    document.getElementById('cs-state').innerHTML = html;
    document.getElementById('cs-state').classList.toggle('hidden', !html);
    document.getElementById('cs-main').classList.toggle('hidden', !!html);
  }

  async loadStats() {
    this.setState('<div class="cs-msg"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i><p>Loading your stats…</p></div>');
    try {
      const me = await this.up.api('/api/community/me');
      if (!me.user) {
        this.setState(`<div class="cs-msg"><i class="fas fa-chart-line" aria-hidden="true"></i><h3>Sign in to see your stats</h3>
          <p>Stats appear for the packs you upload.</p>
          <button type="button" class="up-btn up-btn-primary" id="cs-signin"><i class="fas fa-right-to-bracket" aria-hidden="true"></i> Sign in</button></div>`);
        document.getElementById('cs-signin').addEventListener('click', (e) => {
          e.stopPropagation();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          document.getElementById('auth-login-btn').click();
        });
        return;
      }
      const [stats, settings] = await Promise.all([
        this.up.api(`/api/community/creator/stats?days=${this.days}`),
        this.up.api('/api/community/creator')
      ]);
      this.stats = stats;
      this.settings = settings.settings;
      if (this.settings && this.settings.siteEarnings) await this.addLibraryPacks(stats);
      if (!stats.packs.length) {
        this.setState(`<div class="cs-msg"><i class="fas fa-box-open" aria-hidden="true"></i><h3>No packs yet</h3>
          <p>Upload a pack and its downloads, views and ratings show up here.</p>
          <a href="#" class="up-btn up-btn-primary" data-page="upload"><i class="fas fa-cloud-arrow-up" aria-hidden="true"></i> Upload a pack</a></div>`);
        const a = document.querySelector('#cs-state [data-page="upload"]');
        a.addEventListener('click', (e) => { e.preventDefault(); window.router.show('upload'); });
        return;
      }
      this.setState('');
      this.renderStats();
      this.loadRatings();
    } catch (e) {
      this.setState(`<div class="cs-msg"><i class="fas fa-plug-circle-xmark" aria-hidden="true"></i><h3>Couldn't load your stats</h3>
        <p>The upload service didn't answer.</p><button type="button" class="up-btn" id="cs-retry"><i class="fas fa-rotate-right" aria-hidden="true"></i> Try again</button></div>`);
      document.getElementById('cs-retry').addEventListener('click', () => this.loadStats());
    }
  }

  // For the site owner: their library packs show next to their uploads.
  // The library only counts all-time downloads (no daily numbers or views),
  // using the same counters as the library cards.
  async addLibraryPacks(stats) {
    await Promise.race([this.lib.ready, new Promise(r => setTimeout(r, 8000))]);
    const mine = (this.lib.packs || []).filter(p => !p.community && OWNER_AUTHOR.test(p.author || ''));
    const rows = await Promise.all(mine.map(async (pack) => {
      let total = this.lib.liveDownloadCounts.get(pack.id);
      if (total === undefined) {
        total = await ((pack.versions && pack.versions.length > 1)
          ? Promise.all(pack.versions.map(v => this.lib.fetchLiveDownloads(pack, v))).then(c => c.reduce((a, b) => a + b, 0))
          : this.lib.fetchLiveDownloads(pack));
        this.lib.liveDownloadCounts.set(pack.id, total);
      }
      return {
        id: pack.id, name: pack.name, slug: this.lib.packSlug(pack), status: 'approved', library: true, versions: [],
        downloads: null, views: null, prevDownloads: 0, prevViews: 0, totalDownloads: total || 0, totalViews: null
      };
    }));
    stats.packs.push(...rows);
    stats.totals.allTimeDownloads += rows.reduce((n, r) => n + r.totalDownloads, 0);
  }

  delta(cur, prev) {
    if (!prev) return cur ? { text: 'new', cls: 'up' } : { text: '–', cls: '' };
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return { text: '0%', cls: '' };
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, cls: pct > 0 ? 'up' : 'down' };
  }

  deltaHtml(cur, prev) {
    const d = this.delta(cur, prev);
    return `<span class="cs-delta ${d.cls}" title="Compared with the previous ${this.stats.days} days">${d.text}</span>`;
  }

  renderStats() {
    const s = this.stats;
    const t = s.totals;
    // No uploads yet (only library packs): the worker sends no daily series.
    if (!s.series.length) {
      s.series = Array.from({ length: s.days }, (_, i) => ({
        day: new Date(Date.now() - (s.days - 1 - i) * 86400000).toISOString().slice(0, 10), downloads: 0, views: 0
      }));
    }
    const conv = t.views ? Math.round((t.downloads / t.views) * 1000) / 10 : 0;
    const prevConv = t.prevViews ? (t.prevDownloads / t.prevViews) * 100 : 0;
    const cards = [
      ['Downloads', this.fmt(t.downloads), this.deltaHtml(t.downloads, t.prevDownloads), `last ${s.days} days`],
      ['Views', this.fmt(t.views), this.deltaHtml(t.views, t.prevViews), `last ${s.days} days`],
      ['Views to downloads', `${conv}%`, this.deltaHtml(conv, prevConv), 'visitors who download'],
      ['All-time downloads', this.fmt(t.allTimeDownloads), '', `${this.fmt(t.allTimeViews)} views`],
      ['Your rank', s.rank ? `#${s.rank}` : '–', '', s.rank ? `of ${s.creators} creators` : 'no downloads yet'],
      ['Rating', '…', '', 'average across packs']
    ];
    document.getElementById('cs-cards').innerHTML = cards.map(([label, value, delta, sub], i) => `
      <div class="cs-card" ${i === 5 ? 'id="cs-card-rating"' : ''}>
        <span class="cs-card-label">${label}</span>
        <span class="cs-card-value">${value}${delta ? ` ${delta}` : ''}</span>
        <span class="cs-card-sub">${sub}</span>
      </div>`).join('');

    const best = s.series.reduce((a, d) => (d.downloads > a.downloads ? d : a), { downloads: 0 });
    document.getElementById('cs-chart-sub').textContent = best.downloads
      ? `Best day: ${this.fmtDay(best.day)} with ${this.fmt(best.downloads)} downloads`
      : `Last ${s.days} days`;
    document.getElementById('cs-chart').innerHTML = this.chart(s.series);

    const sorted = [...s.packs].sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || b.totalDownloads - a.totalDownloads);
    const lib = s.packs.filter(p => p.library).length;
    const count = `${s.packs.length} pack${s.packs.length === 1 ? '' : 's'}${lib ? ` (${lib} from the library)` : ''}`;
    document.getElementById('cs-table-sub').textContent = `${count} · sorted by downloads in the last ${s.days} days, then all time`;
    document.getElementById('cs-table').innerHTML = `
      <div class="cs-row cs-row-head" role="row">
        <span role="columnheader">Pack</span><span role="columnheader">Downloads</span><span role="columnheader">Views</span>
        <span role="columnheader">Conversion</span><span role="columnheader">Rating</span><span role="columnheader">All time</span>
      </div>
      ${sorted.map(p => this.packRow(p)).join('')}`;

    this.renderEarn();
  }

  packRow(p) {
    if (p.library) {
      return `
      <div class="cs-row" role="row" data-slug="${this.esc(p.slug)}">
        <span class="cs-cell-name" role="cell">
          <button type="button" class="cs-link" data-cs-open="${p.id}">${this.esc(p.name)}</button> <span class="up-status">Library</span>
        </span>
        <span data-label="Downloads" role="cell">–</span>
        <span data-label="Views" role="cell">–</span>
        <span data-label="Conversion" role="cell">–</span>
        <span data-label="Rating" role="cell" class="cs-rating">…</span>
        <span data-label="All time" role="cell">${this.fmt(p.totalDownloads)} <small>dl</small></span>
      </div>`;
    }
    const conv = p.views ? `${Math.round((p.downloads / p.views) * 1000) / 10}%` : '–';
    const live = p.status === 'approved';
    const chip = { approved: '', pending: '<span class="up-status up-status-pending">Checking</span>', rejected: '<span class="up-status up-status-rejected">Not approved</span>' }[p.status] || '';
    const versions = p.versions.filter(v => v.status === 'approved' && v.downloads).map(v => `v${this.esc(v.version)}: ${this.fmt(v.downloads)}`).join(' · ');
    return `
      <div class="cs-row" role="row" data-slug="${this.esc(p.slug)}">
        <span class="cs-cell-name" role="cell">
          ${live ? `<button type="button" class="cs-link" data-cs-open="${p.id}">${this.esc(p.name)}</button>` : `<span>${this.esc(p.name)}</span>`} ${chip}
          ${versions ? `<small>${versions}</small>` : ''}
        </span>
        <span data-label="Downloads" role="cell"><b>${this.fmt(p.downloads)}</b> ${this.deltaHtml(p.downloads, p.prevDownloads)}</span>
        <span data-label="Views" role="cell">${this.fmt(p.views)} ${this.deltaHtml(p.views, p.prevViews)}</span>
        <span data-label="Conversion" role="cell">${conv}</span>
        <span data-label="Rating" role="cell" class="cs-rating">${live ? '…' : '–'}</span>
        <span data-label="All time" role="cell">${this.fmt(p.totalDownloads)} <small>dl</small> · ${this.fmt(p.totalViews)} <small>views</small></span>
      </div>`;
  }

  renderEarn() {
    const st = this.settings || {};
    const lv = !!st.linkvertiseId;
    const loot = !!st.hasLootToken;
    const box = document.getElementById('cs-earn');
    box.innerHTML = `
      <div class="stats-card-head"><div><h3>Earnings</h3><p>Ad revenue is paid by Linkvertise and LootLabs straight to your accounts. Check their dashboards for amounts.</p></div></div>
      <div class="cs-earn-grid">
        <div class="cs-earn-item ${lv ? 'on' : ''}"><i class="fas ${lv ? 'fa-circle-check' : 'fa-circle-xmark'}" aria-hidden="true"></i>
          <div><b>Linkvertise</b><span>${lv ? `Connected (user ${this.esc(st.linkvertiseId)}). Links are made for every download.` : 'Not connected'}</span></div></div>
        <div class="cs-earn-item ${loot ? 'on' : ''}"><i class="fas ${loot ? 'fa-circle-check' : 'fa-circle-xmark'}" aria-hidden="true"></i>
          <div><b>LootLabs</b><span>${loot ? (st.lootStatus === 'ok' ? 'Connected. A link is made for every live version.' : st.lootStatus && st.lootStatus.startsWith('failed') ? 'Token problem. Check it in Profile & earnings.' : 'Token saved. Links are made as versions go live.') : 'Not connected'}</span></div></div>
      </div>
      ${lv || loot ? '' : '<p class="cs-earn-warn">Until you connect an account, downloads of your packs go through the site\'s Linkvertise and LootLabs.</p>'}
      <div class="cs-actions"><a href="#" class="up-btn" data-cs-goto="profile"><i class="fas fa-gear" aria-hidden="true"></i> Manage earnings and profile</a></div>`;
  }

  async loadRatings() {
    const live = this.stats.packs.filter(p => p.status === 'approved');
    let total = 0;
    let weighted = 0;
    await Promise.all(live.map(async (p) => {
      let cell = null;
      try {
        const res = await fetch(`${API_BASE}/api/ratings/${encodeURIComponent(p.slug)}`);
        if (res.ok) {
          const d = await res.json();
          total += d.count || 0;
          weighted += (d.average || 0) * (d.count || 0);
          cell = d.count ? `<i class="fas fa-star" aria-hidden="true"></i> ${Number(d.average).toFixed(1)} <small>(${d.count})</small>` : '–';
        }
      } catch (e) { /* leave the dash */ }
      const row = [...document.querySelectorAll('#cs-table .cs-row')].find(r => r.dataset.slug === p.slug);
      if (row && row.querySelector('.cs-rating')) row.querySelector('.cs-rating').innerHTML = cell || '–';
    }));
    const card = document.querySelector('#cs-card-rating .cs-card-value');
    if (card) card.innerHTML = total ? `<i class="fas fa-star cs-star" aria-hidden="true"></i> ${(weighted / total).toFixed(2)}` : '–';
    const sub = document.querySelector('#cs-card-rating .cs-card-sub');
    if (sub) sub.textContent = total ? `${total} rating${total === 1 ? '' : 's'}` : 'no ratings yet';
  }

  fmtDay(day) {
    const d = new Date(`${day}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  chart(series) {
    const W = 720, H = 230, pad = { l: 40, r: 10, t: 12, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const peak = Math.max(1, ...series.map(d => Math.max(d.downloads, d.views)));
    const mag = Math.pow(10, Math.floor(Math.log10(peak)));
    const top = [1, 2, 5, 10].map(m => m * mag).find(v => v >= peak) || peak;
    const y = (v) => pad.t + ih - (v / top) * ih;
    const step = iw / series.length;
    const bw = Math.max(2, Math.min(28, step * 0.62));
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const v = Math.round(top * f);
      return `<line class="cs-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="cs-axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${this.fmt(v)}</text>`;
    }).join('');
    const bars = series.map((d, i) => {
      const x = pad.l + i * step + (step - bw) / 2;
      const h = Math.max(d.downloads ? 2 : 0, (d.downloads / top) * ih);
      return `<rect class="cs-bar" x="${x.toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${this.fmtDay(d.day)}: ${d.downloads} downloads, ${d.views} views</title></rect>`;
    }).join('');
    const pts = series.map((d, i) => `${(pad.l + i * step + step / 2).toFixed(1)},${y(d.views).toFixed(1)}`).join(' ');
    const dots = series.length <= 31 ? series.map((d, i) => d.views ? `<circle class="cs-dot" cx="${(pad.l + i * step + step / 2).toFixed(1)}" cy="${y(d.views).toFixed(1)}" r="2.5"/>` : '').join('') : '';
    const labelAt = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    const xl = labelAt.map((i, k) => `<text class="cs-axis" x="${(pad.l + i * step + step / 2).toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${this.fmtDay(series[i].day)}</text>`).join('');
    const total = series.reduce((n, d) => n + d.downloads, 0);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily downloads and views for the last ${series.length} days. ${total} downloads in total.">
      ${grid}${bars}<polyline class="cs-line" points="${pts}"/>${dots}${xl}</svg>`;
  }

  exportCsv() {
    const s = this.stats;
    if (!s) return;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      `Daily activity (last ${s.days} days)`, 'date,downloads,views',
      ...s.series.map(d => `${d.day},${d.downloads},${d.views}`),
      '',
      'Packs', `pack,status,downloads_last_${s.days}_days,views_last_${s.days}_days,all_time_downloads,all_time_views`,
      ...s.packs.map(p => `${q(p.name)},${p.library ? 'library' : p.status},${p.downloads ?? ''},${p.views ?? ''},${p.totalDownloads},${p.totalViews ?? ''}`)
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `my-pack-stats-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ===== Creator data (public) =====

  async creator(key) {
    const k = String(key);
    if (this.creatorCache.has(k)) return this.creatorCache.get(k);
    const job = fetch(`${UPLOADS_API}/api/community/creators/${encodeURIComponent(k)}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
    this.creatorCache.set(k, job);
    const data = await job;
    if (!data) this.creatorCache.delete(k);
    return data;
  }

  socialLabel(s) {
    const meta = window.SOCIAL_META[s.type] || window.SOCIAL_META.website;
    if (s.type === 'discord' && s.label) return `${s.label}${s.members ? ` · ${this.fmt(s.members)} members` : ''}`;
    if (s.type === 'website') { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch (e) { return meta[0]; } }
    return meta[0];
  }

  socialLink(s, { compact = false } = {}) {
    const meta = window.SOCIAL_META[s.type] || window.SOCIAL_META.website;
    const label = this.socialLabel(s);
    return `<a class="up-social up-social-${this.esc(s.type)}${compact ? ' up-social-compact' : ''}" href="${this.esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow ugc" ${compact ? `title="${this.esc(label)}" aria-label="${this.esc(label)}"` : ''}>
      <i class="${meta[1]}" aria-hidden="true"></i>${compact ? '' : `<span>${this.esc(label)}</span>`}</a>`;
  }

  // ===== Profile page =====

  wrapProfile() {
    const lib = this.lib;
    const original = lib.showUserProfile.bind(lib);
    lib.showUserProfile = async (userId, opts) => {
      const out = await original(userId, opts);
      await lib.ready;
      this.renderProfile(userId);
      return out;
    };
    document.getElementById('user-profile-videos').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-video]');
      if (!btn) return;
      const id = btn.dataset.video;
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
      frame.title = btn.dataset.title || 'Featured video';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      frame.allowFullscreen = true;
      frame.className = 'up-video-frame';
      btn.replaceWith(frame);
    });
  }

  async renderProfile(userId) {
    const bio = document.getElementById('user-profile-bio');
    const socials = document.getElementById('user-profile-socials');
    const videosBlock = document.getElementById('user-profile-videos-block');
    const videos = document.getElementById('user-profile-videos');
    const packsBlock = document.getElementById('user-profile-packs-block');
    const packsBox = document.getElementById('user-profile-packs');
    [bio, socials, videosBlock, packsBlock].forEach(el => el.classList.add('hidden'));

    const data = await this.creator(userId);
    // The page may have moved on while we waited.
    if (!data || !document.getElementById('page-user').classList.contains('active')) return;
    const c = data.creator;

    // Community creators aren't accounts-worker users, so take the name from here.
    if (c.username) {
      document.getElementById('user-profile-name-text').textContent = c.username;
      document.getElementById('user-profile-joined').textContent = '';
      document.getElementById('user-profile-stats').textContent = `${c.packCount} pack${c.packCount === 1 ? '' : 's'} · ${this.fmt(c.downloads)} downloads`;
    }

    if (c.bio) {
      bio.textContent = c.bio;
      bio.classList.remove('hidden');
    }
    const own = this.up.me && String(this.up.me.id) === String(c.id);
    const links = (c.socials || []).map(s => this.socialLink(s)).join('');
    const editLink = own ? '<button type="button" class="up-link-btn" data-edit-profile><i class="fas fa-pen" aria-hidden="true"></i> Edit creator profile</button>' : '';
    if (links || editLink) {
      socials.innerHTML = links + editLink;
      socials.classList.remove('hidden');
      const edit = socials.querySelector('[data-edit-profile]');
      if (edit) edit.addEventListener('click', () => { window.router.show('upload'); if (window.uploadsPage) window.uploadsPage.switchTab('profile'); });
    }
    if ((c.videos || []).length) {
      videos.innerHTML = c.videos.map(v => `
        <button type="button" class="up-video" data-video="${this.esc(v.id)}" data-title="${this.esc(v.title)}" aria-label="Play ${this.esc(v.title || 'video')}">
          <img src="https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
          <span class="up-video-play"><i class="fas fa-play" aria-hidden="true"></i></span>
          <span class="up-video-title">${this.esc(v.title || 'Video')}${v.author ? `<small>${this.esc(v.author)}</small>` : ''}</span>
        </button>`).join('');
      videosBlock.classList.remove('hidden');
    }
    if ((data.packs || []).length) {
      packsBox.innerHTML = data.packs.map(p => `
        <button type="button" class="up-profile-pack" data-open-pack="${p.id}">
          <span class="up-item-icon">${p.thumbnail ? `<img src="${this.esc(p.thumbnail)}" alt="" loading="lazy">` : `<span>${this.esc(p.name.charAt(0))}</span>`}</span>
          <span class="up-profile-pack-text">
            <b>${this.esc(p.name)}</b>
            <span>${this.esc(this.lib.capitalizeFirst(p.category))} · v${this.esc(p.version)} · ${this.fmt(p.downloads)} downloads</span>
          </span>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>`).join('');
      packsBlock.classList.remove('hidden');
      const stats = document.getElementById('user-profile-stats');
      if (stats && !/downloads/.test(stats.textContent)) stats.textContent = `${stats.textContent} · ${c.packCount} pack${c.packCount === 1 ? '' : 's'} · ${this.fmt(c.downloads)} downloads`;
    }
  }

  // ===== Pack page =====

  wrapDetail() {
    const lib = this.lib;
    const original = lib.showDetail.bind(lib);
    lib.showDetail = (pack, opts) => {
      const out = original(pack, opts);
      this.decorateDetail(pack);
      return out;
    };
    const nameEl = document.getElementById('detail-author-name');
    const openAuthor = () => {
      const pack = lib.currentPack;
      if (pack && pack.community && pack.authorId) lib.showUserProfile(pack.authorId);
    };
    nameEl.addEventListener('click', openAuthor);
    nameEl.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && nameEl.classList.contains('up-author-link')) { e.preventDefault(); openAuthor(); }
    });
  }

  async decorateDetail(pack) {
    const nameEl = document.getElementById('detail-author-name');
    const box = document.getElementById('detail-creator-links');
    const linked = !!(pack && pack.community && pack.authorId);
    nameEl.classList.toggle('up-author-link', linked);
    if (linked) { nameEl.setAttribute('role', 'link'); nameEl.tabIndex = 0; } else { nameEl.removeAttribute('role'); nameEl.removeAttribute('tabindex'); }
    box.classList.add('hidden');
    box.innerHTML = '';
    if (!linked) return;

    // One view per pack per browser session (the worker also counts once per visitor per day).
    try {
      const key = `upview:${pack.id}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        fetch(`${UPLOADS_API}/api/community/packs/${pack.id}/view`, { method: 'POST' }).catch(() => {});
      }
    } catch (e) { /* storage unavailable */ }

    const data = await this.creator(pack.authorId);
    if (!data || this.lib.currentPack !== pack) return;
    const socials = (data.creator.socials || []).slice(0, 5);
    if (!socials.length) return;
    box.innerHTML = socials.map(s => this.socialLink(s, { compact: true })).join('');
    box.classList.remove('hidden');
  }
}

(function bootCreatorTools() {
  const start = () => {
    if (!window.packLibrary || !window.uploadsPage) return false;
    window.creatorTools = new CreatorTools(window.packLibrary, window.uploadsPage);
    return true;
  };
  if (!start()) document.addEventListener('DOMContentLoaded', () => { if (!start()) setTimeout(start, 50); }, { once: true });
})();
