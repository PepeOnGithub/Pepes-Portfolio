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
    this.setState('<div class="sk-stack" role="status" aria-label="Loading your stats"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px"><span class="sk" style="height:96px;border-radius:16px"></span><span class="sk" style="height:96px;border-radius:16px"></span><span class="sk" style="height:96px;border-radius:16px"></span><span class="sk" style="height:96px;border-radius:16px"></span></div><span class="sk" style="height:220px;border-radius:16px"></span></div>');
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
    const rows = (await this.ownerLibraryPacks()).map(p => ({
      id: p.id, name: p.name, slug: this.lib.packSlug(p), status: 'approved', library: true, versions: [],
      downloads: null, views: null, prevDownloads: 0, prevViews: 0, totalDownloads: p.downloads, totalViews: null
    }));
    stats.packs.push(...rows);
    stats.totals.allTimeDownloads += rows.reduce((n, r) => n + r.totalDownloads, 0);
  }

  // The site owner's packs from packs.json, each with its all-time download
  // total from the same counters as the library cards.
  async ownerLibraryPacks() {
    await Promise.race([this.lib.ready, new Promise(r => setTimeout(r, 8000))]);
    const mine = (this.lib.packs || []).filter(p => !p.community && OWNER_AUTHOR.test(p.author || ''));
    return Promise.all(mine.map(async (pack) => {
      let total = this.lib.liveDownloadCounts.get(pack.id);
      if (total === undefined) {
        total = await ((pack.versions && pack.versions.length > 1)
          ? Promise.all(pack.versions.map(v => this.lib.fetchLiveDownloads(pack, v))).then(c => c.reduce((a, b) => a + b, 0))
          : this.lib.fetchLiveDownloads(pack));
        this.lib.liveDownloadCounts.set(pack.id, total);
      }
      return { ...pack, downloads: total || 0 };
    }));
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
    const cards = [
      ['Downloads', this.fmt(t.downloads), this.deltaHtml(t.downloads, t.prevDownloads), `last ${s.days} days`],
      ['Views', this.fmt(t.views), this.deltaHtml(t.views, t.prevViews), `last ${s.days} days`],
      ['All-time downloads', this.fmt(t.allTimeDownloads), '', `${this.fmt(t.allTimeViews)} views`],
      ['Your rank', s.rank ? `#${s.rank}` : '–', '', s.rank ? `of ${s.creators} creators` : 'no downloads yet'],
      ['Rating', '…', '', 'average across packs']
    ];
    document.getElementById('cs-cards').innerHTML = cards.map(([label, value, delta, sub], i) => `
      <div class="cs-card" ${i === 4 ? 'id="cs-card-rating"' : ''}>
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

    this.renderInsights();
    this.renderEarn();
  }

  // "Insights": the download rate against the site median, which weekdays people download on,
  // and a health score per pack with the specific things to fix (see the "Creator Insights" board).
  renderInsights() {
    const s = this.stats, t = s.totals, box = document.getElementById('cs-insights');
    if (!box) return;
    const own = s.packs.filter(p => !p.library && p.health);
    if (!own.length) { box.innerHTML = ''; return; }
    const rate = t.views ? t.downloads / t.views : 0;
    const prevRate = t.prevViews ? t.prevDownloads / t.prevViews : 0;
    const med = s.medianRate;
    const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}`;
    const dRate = t.prevViews ? Math.round((rate - prevRate) * 1000) / 10 : null;
    const scale = Math.max(0.2, Math.ceil(Math.max(rate, med || 0) * 10 + 1) / 10);
    // weekday heat map: the last five weeks, one column per week (Monday first)
    const wd = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
    const byDay = new Map(s.series.map(d => [d.day, d.downloads]));
    const last = new Date(`${s.series[s.series.length - 1].day}T00:00:00Z`);
    const monday = new Date(last.getTime() - wd(last.toISOString().slice(0, 10)) * 86400000 - 28 * 86400000);
    const cells = [];
    for (let w = 0; w < 5; w++) for (let d = 0; d < 7; d++) {
      const day = new Date(monday.getTime() + (w * 7 + d) * 86400000).toISOString().slice(0, 10);
      cells.push({ day, d, n: byDay.has(day) ? byDay.get(day) : null });
    }
    const peak = Math.max(1, ...cells.map(c => c.n || 0));
    const lvl = (n) => (n === null ? 'x' : n === 0 ? 0 : Math.min(4, Math.ceil((n / peak) * 4)));
    const totalsByWd = Array(7).fill(0);
    s.series.forEach(d => { totalsByWd[wd(d.day)] += d.downloads; });
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const bestWd = totalsByWd.some(Boolean) ? totalsByWd.indexOf(Math.max(...totalsByWd)) : -1;
    const grid = names.map((n, d) => `<span class="ins-wd">${n.slice(0, 3)}</span>${[0, 1, 2, 3, 4].map(w => {
      const c = cells[w * 7 + d];
      return `<span class="ins-cell l${lvl(c.n)}" title="${this.fmtDay(c.day)}: ${c.n === null ? 'no data' : `${c.n} downloads`}"></span>`;
    }).join('')}`).join('');
    const tip = bestWd >= 4 ? 'Publish updates on Friday so they land before the weekend peak.'
      : bestWd >= 0 ? `Most downloads land on ${names[bestWd]}s. Publish updates the day before.` : '';

    const earning = !!(this.settings && (this.settings.linkvertiseId || this.settings.hasLootToken));
    const coach = own.map(p => {
      const h = p.health, items = [];
      const add = (ok, good, bad, pts, soft) => items.push({ ok: ok ? 'ok' : (soft ? 'warn' : 'fail'), t: ok ? good : bad, pts: ok ? pts : 0, max: pts });
      add(h.video, 'Video added', 'No video', 20, true);
      add(h.words >= 80, 'Full description', `Description is ${h.words} word${h.words === 1 ? '' : 's'}, aim for 80+`, 20, h.words >= 30);
      add(h.icon, 'Has an icon', 'No icon', 10, false);
      add(h.tags >= 3, `${h.tags} tags`, h.tags ? `Only ${h.tags} tag${h.tags === 1 ? '' : 's'}, add 3+` : 'No tags', 10, h.tags > 0);
      add(h.versions && h.changelogs >= h.versions, 'Changelog on every version', 'A version has no changelog', 10, true);
      add(earning, 'Earning link set', 'No earning link set', 10, false);
      const pRate = p.views >= 10 ? p.downloads / p.views : null;
      const conv = pRate === null ? 10 : Math.min(20, Math.round(20 * (pRate / (med || 0.1))));
      const score = Math.min(100, items.reduce((n, i) => n + i.pts, 0) + conv);
      const tier = score >= 80 ? ['Healthy', 'g'] : score >= 50 ? ['Needs work', 'a'] : ['Hard to find', 'r'];
      return { p, score, tier, items, rate: p.views ? p.downloads / p.views : null };
    }).sort((a, b) => a.score - b.score);
    const mark = { ok: '✓', warn: '!', fail: '×' };
    box.innerHTML = `
      <div class="ins-top">
        <div class="ins-card ins-rate">
          <span class="ins-label">Download rate</span>
          <div class="ins-big"><b>${pct(rate)}<small>%</small></b>${dRate === null ? '' : `<span class="ins-pill ${dRate >= 0 ? 'up' : 'down'}">${dRate >= 0 ? '+' : ''}${dRate} pts</span>`}</div>
          <p>of people who open a pack of yours download it</p>
          <div class="ins-meter" aria-hidden="true"><i style="width:${Math.min(100, rate / scale * 100)}%"></i>${med ? `<u style="left:${Math.min(100, med / scale * 100)}%"></u>` : ''}</div>
          <div class="ins-meter-l"><span>0%</span>${med ? `<span>site median ${pct(med)}%</span>` : '<span>not enough data for a site median yet</span>'}<span>${Math.round(scale * 100)}%</span></div>
          <div class="ins-two"><div><b>${this.fmt(t.views)}</b><span>Pack views</span></div><div><b>${this.fmt(t.downloads)}</b><span>Downloads</span></div></div>
        </div>
        <div class="ins-card ins-heat">
          <div class="ins-head"><div><h3>When people download</h3><p>Last 5 weeks, darker green is more downloads</p></div>${bestWd >= 0 ? `<span class="ins-pill up">Best day: ${names[bestWd]}</span>` : ''}</div>
          <div class="ins-grid">${grid}</div>
          <div class="ins-legend">Less ${[0, 1, 2, 3, 4].map(l => `<i class="ins-cell l${l}"></i>`).join('')} More<span>${tip}</span></div>
        </div>
      </div>
      <div class="ins-head ins-coach-head"><h3>Pack health</h3><p>Score = how complete the page is, plus its download rate</p></div>
      <div class="ins-coach">${coach.map(c => `
        <div class="ins-pack">
          <span class="ins-ring ${c.tier[1]}" style="--p:${c.score * 3.6}deg"><b>${c.score}</b></span>
          <div class="ins-pack-body">
            <div><b>${this.esc(c.p.name)}</b><span class="ins-tier ${c.tier[1]}">${c.tier[0]}</span></div>
            <ul>${c.items.map(i => `<li class="${i.ok}"><i aria-hidden="true">${mark[i.ok]}</i>${this.esc(i.t)}</li>`).join('')}</ul>
          </div>
          <div class="ins-pack-rate"><b>${c.rate === null ? '–' : `${pct(c.rate)}%`}</b><span>views to downloads</span></div>
        </div>`).join('')}</div>`;
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
          <div><b>LootLabs</b><span>${loot ? (st.lootStatus === 'ok' ? 'Connected. A link is made for every live version.' : st.lootStatus && st.lootStatus.startsWith('failed') ? 'Token problem. Check it on the Earnings tab.' : 'Token saved. Links are made as versions go live.') : 'Not connected'}</span></div></div>
      </div>
      ${lv || loot ? '' : '<p class="cs-earn-warn">Until you connect an account, downloads of your packs go through the site\'s Linkvertise and LootLabs.</p>'}
      <div class="cs-actions"><a href="#" class="up-btn" data-cs-goto="profile"><i class="fas fa-gear" aria-hidden="true"></i> Manage earnings</a></div>`;
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
      // Packs, videos and bio start loading at once instead of after the account
      // and its comments, and the sections show skeletons until they arrive.
      const page = document.getElementById('page-user');
      page.classList.add('up-sections-loading');
      this.creator(userId);
      try {
        const out = await original(userId, opts);
        await lib.ready;
        await lib.communityReady; // their community packs
        await this.renderProfile(userId);
        return out;
      } finally {
        page.classList.remove('up-sections-loading');
      }
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
    if (!document.getElementById('page-user').classList.contains('active')) return;
    // The account shown (accounts worker), or null for a creator without one.
    const account = this.lib.viewedProfile;
    // The site owner's profile also lists their library packs.
    const library = account && account.isAuthor ? await this.ownerLibraryPacks() : [];
    if (!data && !library.length) return;
    const c = data ? data.creator : { packCount: 0, downloads: 0, socials: [], videos: [] };

    // Creators who aren't accounts-worker users: take the name from here.
    if (!account && c.username) {
      document.getElementById('user-profile-name-text').textContent = c.username;
      document.getElementById('user-profile-joined').textContent = '';
      document.getElementById('user-profile-stats').textContent = '';
    }

    if (c.bio) {
      bio.textContent = c.bio;
      bio.classList.remove('hidden');
    }
    const own = !!c.id && this.up.me && String(this.up.me.id) === String(c.id);
    const links = (c.socials || []).map(s => this.socialLink(s)).join('');
    const editLink = own ? '<button type="button" class="up-link-btn" data-edit-profile><i class="fas fa-pen" aria-hidden="true"></i> Edit profile</button>' : '';
    if (links || editLink) {
      socials.innerHTML = links + editLink;
      socials.classList.remove('hidden');
      const edit = socials.querySelector('[data-edit-profile]');
      if (edit) edit.addEventListener('click', () => this.lib.openProfileModal());
    }
    const packs = [...((data && data.packs) || []), ...library];

    // Videos: the ones they chose to feature, plus each pack's own showcase video.
    const ytId = (url) => { const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/); return m ? m[1] : ''; };
    const seen = new Set((c.videos || []).map(v => v.id));
    const fromPacks = [];
    for (const p of packs) {
      const id = ytId(p.showcaseUrl);
      if (id && !seen.has(id)) { seen.add(id); fromPacks.push({ id, title: p.name, author: 'Showcase' }); }
    }
    const allVideos = [...(c.videos || []), ...fromPacks];
    if (allVideos.length) {
      videos.innerHTML = allVideos.map(v => `
        <button type="button" class="up-video" data-video="${this.esc(v.id)}" data-title="${this.esc(v.title)}" aria-label="Play ${this.esc(v.title || 'video')}">
          <img src="https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async">
          <span class="up-video-play"><i class="fas fa-play" aria-hidden="true"></i></span>
          <span class="up-video-title">${this.esc(v.title || 'Video')}${v.author ? `<small>${this.esc(v.author)}</small>` : ''}</span>
        </button>`).join('');
      videosBlock.classList.remove('hidden');
    }
    if (packs.length) {
      packsBox.innerHTML = packs.map(p => `
        <button type="button" class="up-profile-pack" data-open-pack="${p.id}">
          <span class="up-item-icon">${p.thumbnail ? `<img src="${this.esc(p.thumbnail)}" alt="" loading="lazy">` : `<span>${this.esc(p.name.charAt(0))}</span>`}</span>
          <span class="up-profile-pack-text">
            <b>${this.esc(p.name)}</b>
            <span>${this.esc(this.lib.capitalizeFirst(p.category))}${p.version ? ` · v${this.esc(p.version)}` : ''} · ${this.fmt(p.downloads)} downloads</span>
          </span>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </button>`).join('');
      packsBlock.classList.remove('hidden');
      const downloads = c.downloads + library.reduce((n, p) => n + (p.downloads || 0), 0);
      const summary = `${packs.length} pack${packs.length === 1 ? '' : 's'} · ${this.fmt(downloads)} downloads`;
      const stats = document.getElementById('user-profile-stats');
      stats.textContent = stats.textContent ? `${stats.textContent} · ${summary}` : summary;
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
    const renderAuth = lib.renderAuthUI.bind(lib);
    lib.renderAuthUI = (...a) => { const out = renderAuth(...a); this.syncOwnerActions(); return out; };
    const nameEl = document.getElementById('detail-author-name');
    const openAuthor = () => {
      const pack = lib.currentPack;
      if (pack && pack.community && pack.authorId) lib.showUserProfile(pack.authorId);
    };
    document.getElementById('detail-update-pack').addEventListener('click', () => {
      if (lib.currentPack) this.up.editPack(lib.currentPack.id, 'version');
    });
    document.getElementById('detail-edit-pack').addEventListener('click', () => {
      if (lib.currentPack) this.up.editPack(lib.currentPack.id, 'edit');
    });
    nameEl.addEventListener('click', openAuthor);
    nameEl.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && nameEl.classList.contains('up-author-link')) { e.preventDefault(); openAuthor(); }
    });
  }

  // Update / Edit buttons on your own pack page. Sign-in can finish after the page loaded.
  syncOwnerActions() {
    const pack = this.lib.currentPack;
    const me = this.lib.currentUser;
    const mine = !!(pack && pack.community && pack.authorId && me && String(me.id) === String(pack.authorId));
    document.getElementById('detail-owner-actions').classList.toggle('hidden', !mine);
  }

  async decorateDetail(pack) {
    const nameEl = document.getElementById('detail-author-name');
    const box = document.getElementById('detail-creator-links');
    const linked = !!(pack && pack.community && pack.authorId);
    nameEl.classList.toggle('up-author-link', linked);
    if (linked) { nameEl.setAttribute('role', 'link'); nameEl.tabIndex = 0; } else { nameEl.removeAttribute('role'); nameEl.removeAttribute('tabindex'); }
    box.classList.add('hidden');
    box.innerHTML = '';
    this.syncOwnerActions();
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
    if (data.creator.verified && !nameEl.querySelector('.author-badge')) {
      const title = data.creator.owner ? 'Verified: this is the site owner' : 'Verified creator';
      nameEl.insertAdjacentHTML('beforeend', `<span class="author-badge" title="${title}"><i class="fas fa-check" aria-hidden="true"></i></span>`);
    }
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
