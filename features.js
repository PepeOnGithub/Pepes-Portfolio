// Quick search (Ctrl/Cmd+K, or "/") and the "How to install" guide. Both are built from the site's own
// data (library packs, pages) and open as dialogs; see the "Quick search" and "How to install" design boards.
(function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lib = () => window.packLibrary;
  const icon = (c) => `<i class="fas ${c}" aria-hidden="true"></i>`;

  /* ================= Quick search ================= */
  const PAGES = [
    ['home', 'Home', 'fa-house', 'home'], ['library', 'Library', 'fa-compass', 'library packs addons clients'],
    ['customizer', 'Customizer', 'fa-sliders', 'customize assets pack hud'], ['upload', 'Upload a pack', 'fa-cloud-arrow-up', 'upload share publish'],
    ['projects', 'Projects', 'fa-diagram-project', 'projects'], ['socials', 'Socials', 'fa-share-nodes', 'discord youtube github socials'],
    ['stats', 'Stats', 'fa-chart-simple', 'stats downloads numbers'], ['settings', 'Settings', 'fa-gear', 'settings theme dark light preferences'],
  ];
  const ACTIONS = [
    ['Switch theme (dark / light)', 'fa-circle-half-stroke', 'theme dark light mode', () => lib().toggleTheme()],
    ['Open messages', 'fa-paper-plane', 'messages dm chat inbox', () => { const b = document.getElementById('auth-dm-btn') || document.getElementById('top-dm-btn'); if (b) b.click(); }],
    ['Open notifications', 'fa-bell', 'notifications alerts bell', () => { const b = document.getElementById('notif-btn'); if (b) b.click(); }],
    ['Keyboard shortcuts', 'fa-keyboard', 'keyboard shortcuts keys help', () => window.shortcutsHelp && window.shortcutsHelp.open()],
  ];
  // recent searches (this device only)
  const recents = () => { try { const a = JSON.parse(localStorage.getItem('recentSearches') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const remember = (q) => { q = String(q || '').trim(); if (q.length < 2) return; try { localStorage.setItem('recentSearches', JSON.stringify([q, ...recents().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5))); } catch (e) { /* ignore */ } };
  const norm = (t) => (lib() ? lib().normalizeSearch(t) : String(t).toLowerCase());
  let root = null, input = null, list = null, items = [], sel = 0, lastFocus = null;

  function build() {
    root = document.createElement('div');
    root.className = 'qs-wrap'; root.hidden = true;
    root.innerHTML = `<div class="qs-scrim"></div>
      <div class="qs" role="dialog" aria-modal="true" aria-label="Quick search">
        <div class="qs-head">${icon('fa-magnifying-glass')}<input type="text" class="qs-input" placeholder="Search packs, pages, actions…" autocomplete="off" spellcheck="false" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="qs-list"><kbd>esc</kbd></div>
        <div class="qs-list" id="qs-list" role="listbox"></div>
        <div class="qs-foot"><span><b>↑ ↓</b> move</span><span><b>↵</b> open</span><span><b>esc</b> close</span><span class="qs-grow"></span><span class="qs-hint"><b>Ctrl K</b> anywhere</span></div>
      </div>`;
    document.body.append(root);
    input = root.querySelector('.qs-input'); list = root.querySelector('.qs-list');
    root.querySelector('.qs-scrim').addEventListener('pointerdown', close);
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
    });
    list.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-q]'); if (chip) { input.value = chip.dataset.q; render(); input.focus(); return; }
      if (e.target.closest('[data-clear-recents]')) { try { localStorage.removeItem('recentSearches'); } catch (err) { /* ignore */ } render(); return; }
      const li = e.target.closest('[data-i]'); if (li) choose(Number(li.dataset.i));
    });
    list.addEventListener('pointermove', (e) => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== sel) { sel = Number(li.dataset.i); paintSel(false); } });
  }

  function packRows(words) {
    const L = lib(); if (!L) return [];
    let packs = (L.packs || []).filter((p) => !p.discontinued || words.length);
    if (words.length) {
      packs = packs.filter((p) => { const h = norm([p.name, p.author, p.description, ...(p.tags || [])].join(' ')); return words.every((w) => h.includes(w)); });
      return packs.map((p) => [p, L.packScore(p, words)]).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
    }
    let ids = [];
    try { ids = JSON.parse(localStorage.getItem('recentlyViewedPacks') || '[]'); } catch (e) { /* ignore */ }
    return ids.map((id) => (L.packs || []).find((p) => p.id === id)).filter(Boolean).slice(0, 4);
  }

  function highlight(name, words) {
    let out = esc(name);
    for (const w of words) { if (w.length < 2) continue; out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); }
    return out;
  }

  function render() {
    const q = input.value.trim(), words = norm(q).split(' ').filter(Boolean);
    items = [];
    const sections = [];
    if (!words.length) {
      const rs = recents();
      if (rs.length) sections.push(['Recent searches', null, `<div class="qs-chips">${rs.map((r) => `<button type="button" class="qs-chip" data-q="${esc(r)}"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i>${esc(r)}</button>`).join('')}</div>`, '<button type="button" class="qs-clear" data-clear-recents>Clear</button>']);
      sections.push(['', [{ kind: 'surprise', html: `<span class="qs-ico qs-surprise">${icon('fa-dice')}</span><span class="qs-txt"><b>Surprise me</b><small>Open a random pack</small></span>` }]]);
    }
    const packs = packRows(words);
    if (packs.length) sections.push([words.length ? 'Packs' : 'Recently viewed', packs.map((p) => {
      const L = lib(), n = L.downloadsOf ? L.downloadsOf(p) : (p.downloads || 0);
      const v = ((p.versions && p.versions[0]) || p).version;
      const thumb = p.thumbnail && L.isImagePath(p.thumbnail) ? `<img src="${esc(p.thumbnail)}" alt="" loading="lazy">` : `<span>${esc((p.name || '?').charAt(0))}</span>`;
      return { kind: 'pack', pack: p, html: `<span class="qs-art">${thumb}</span><span class="qs-txt"><b>${highlight(p.name, words)}</b><small>${esc(L.capitalizeFirst(p.category))}${v ? ' · v' + esc(String(v).replace(/^v/i, '')) : ''}${n ? ' · ' + esc(L.formatCount(n)) + ' downloads' : ''}</small></span>` };
    })]);
    const pages = PAGES.filter(([, label, , kw]) => !words.length || words.every((w) => norm(label + ' ' + kw).includes(w)));
    if (pages.length) sections.push(['Go to', pages.slice(0, words.length ? 4 : 5).map(([id, label, ic]) => ({ kind: 'page', id, html: `<span class="qs-ico">${icon(ic)}</span><span class="qs-txt"><b>${highlight(label, words)}</b></span>` }))]);
    const acts = ACTIONS.filter(([label, , kw]) => !words.length || words.every((w) => norm(label + ' ' + kw).includes(w)));
    if (acts.length) sections.push(['Actions', acts.map(([label, ic, , run]) => ({ kind: 'action', run, html: `<span class="qs-ico">${icon(ic)}</span><span class="qs-txt"><b>${highlight(label, words)}</b></span>` }))]);
    if (words.length && !sections.length) { list.innerHTML = `<p class="qs-empty">Nothing matches “${esc(q)}”.</p>`; sel = 0; return; }
    if (words.length) sections.push(['Search', [{ kind: 'search', q, html: `<span class="qs-ico">${icon('fa-magnifying-glass')}</span><span class="qs-txt"><b>Search the library for “${esc(q)}”</b></span>` }]]);
    list.innerHTML = sections.map(([title, rows, raw, action]) => (title ? `<div class="qs-sec">${esc(title)}${action || ''}</div>` : '') + (raw || '') + (rows || []).map((r) => { const i = items.push(r) - 1; return `<div class="qs-row" role="option" id="qs-o${i}" data-i="${i}">${r.html}<span class="qs-enter">↵</span></div>`; }).join('')).join('');
    sel = 0; paintSel(false);
  }

  function paintSel(scroll) {
    list.querySelectorAll('.qs-row').forEach((r) => { const on = Number(r.dataset.i) === sel; r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on)); if (on) { input.setAttribute('aria-activedescendant', r.id); if (scroll) r.scrollIntoView({ block: 'nearest' }); } });
  }
  function move(d) { if (!items.length) return; sel = (sel + d + items.length) % items.length; paintSel(true); }

  function choose(i) {
    const it = items[i]; if (!it) return;
    const typed = input.value;
    close(true);
    const L = lib();
    if (it.kind === 'pack' || it.kind === 'search') remember(it.kind === 'search' ? it.q : typed);
    if (it.kind === 'surprise') {
      const pool = (L.packs || []).filter((p) => !p.pinned && !p.discontinued && p.category !== 'website');
      const p = pool[Math.floor(Math.random() * pool.length)];
      if (p) { window.router.show('library', { push: false }); L.showDetail(p); }
      return;
    }
    if (it.kind === 'pack') { window.router.show('library', { push: false }); L.showDetail(it.pack); }
    else if (it.kind === 'page') window.router.show(it.id);
    else if (it.kind === 'action') it.run();
    else if (it.kind === 'search') {
      window.router.show('library');
      const inp = document.getElementById('search-input');
      if (inp) { inp.value = it.q; L.currentFilter.search = it.q; L.applyFilters(); }
    }
  }

  function open() {
    if (!root) build();
    lastFocus = document.activeElement;
    root.hidden = false; document.body.classList.add('qs-open');
    input.value = ''; render(); input.focus();
  }
  function close(skipFocus) {
    if (!root || root.hidden) return;
    root.hidden = true; document.body.classList.remove('qs-open');
    if (!skipFocus && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
  }
  window.quickSearch = { open, close };

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); root && !root.hidden ? close() : open(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.body.classList.contains('cz-open')) { e.preventDefault(); open(); }
  });

  /* ================= How to install ================= */
  const DEVICES = {
    windows: ['Windows', [
      ['Download the file', 'Click Download. It saves a <b>.EXT</b> file to your Downloads folder.'],
      ['Open it', 'Double-click the file. Minecraft opens and says <b>Import started</b>, then <b>Successfully imported</b>.'],
      ['Turn it on', 'Settings → Global Resources → My Packs → pick the pack → <b>Activate</b>.'],
    ]],
    android: ['Android', [
      ['Download the file', 'Tap Download. It saves a <b>.EXT</b> file to your Downloads folder.'],
      ['Open it with Minecraft', 'Tap the downloaded file (from the notification or the Files app). Minecraft opens and says <b>Import started</b>, then <b>Successfully imported</b>.'],
      ['Turn it on', 'Settings → Global Resources → My Packs → tap the pack → <b>Activate</b>.'],
    ]],
    ios: ['iPhone / iPad', [
      ['Download the file', 'Tap Download and choose <b>Download</b>. The file lands in the Files app.'],
      ['Open it with Minecraft', 'Open Files → Downloads, tap the file, then <b>Share</b> → <b>Minecraft</b>. It says <b>Import started</b>, then <b>Successfully imported</b>.'],
      ['Turn it on', 'Settings → Global Resources → My Packs → tap the pack → <b>Activate</b>.'],
    ]],
  };
  const detect = () => { const ua = navigator.userAgent || ''; return /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : 'windows'; };
  let sheet = null, device = detect(), prevFocus = null;

  function installOpen() {
    const L = lib(), pack = L && L.currentPack; if (!pack) return;
    const latest = (pack.versions && pack.versions[0]) || pack;
    const file = latest.fileName || pack.fileName || '';
    const ext = /\.mcaddon$/i.test(file) ? 'mcaddon' : /\.mcpack$/i.test(file) ? 'mcpack' : (pack.category === 'addons' ? 'mcaddon' : 'mcpack');
    if (!sheet) {
      sheet = document.createElement('div'); sheet.className = 'ig-wrap'; sheet.hidden = true;
      document.body.append(sheet);
      sheet.addEventListener('click', (e) => {
        if (e.target.closest('[data-ig-close]') || e.target.classList.contains('ig-scrim')) installClose();
        const t = e.target.closest('[data-device]'); if (t) { device = t.dataset.device; installOpen(); }
        if (e.target.closest('[data-ig-download]')) { installClose(); const d = document.getElementById('detail-download'); if (d) d.click(); }
        const a = e.target.closest('[data-ig-assets]'); if (a) { installClose(); const ap = (lib().packs || []).find((p) => p.pinned); if (ap) lib().showDetail(ap); }
      });
      sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); installClose(); } });
    }
    const [, steps] = DEVICES[device];
    const needsAssets = pack.requiresAssets && !pack.pinned;
    sheet.innerHTML = `<div class="ig-scrim"></div>
      <div class="ig" role="dialog" aria-modal="true" aria-labelledby="ig-title">
        <div class="ig-grip" aria-hidden="true"></div>
        <div class="ig-head"><h2 id="ig-title">How to install</h2><button type="button" class="ig-x" data-ig-close aria-label="Close">${icon('fa-xmark')}</button></div>
        <p class="ig-sub">${esc(pack.name)} · for Minecraft: Bedrock</p>
        <div class="ig-tabs" role="tablist" aria-label="Device">${Object.entries(DEVICES).map(([k, [label]]) => `<button type="button" role="tab" data-device="${k}" aria-selected="${k === device}">${label}</button>`).join('')}</div>
        <ol class="ig-steps">${steps.map(([t, d], i) => `<li><span class="ig-n">${i + 1}</span><div><b>${t}</b><p>${d.replace(/\.EXT/g, '.' + ext)}</p></div></li>`).join('')}</ol>
        ${needsAssets ? `<div class="ig-warn">${icon('fa-triangle-exclamation')}<p><b>Needs the Assets Pack.</b> Install it first and keep it above this pack in the list. <button type="button" class="ig-link" data-ig-assets>Get Assets Pack</button></p></div>` : ''}
        <div class="ig-foot"><button type="button" class="ig-dl" data-ig-download>${icon('fa-download')} Download now</button></div>
      </div>`;
    if (sheet.hidden) { prevFocus = document.activeElement; sheet.hidden = false; document.body.classList.add('ig-open'); }
    const first = sheet.querySelector('[aria-selected="true"]'); if (first && document.activeElement === document.body) first.focus();
    sheet.querySelector('.ig-x').focus({ preventScroll: true });
  }
  function installClose() { if (!sheet || sheet.hidden) return; sheet.hidden = true; document.body.classList.remove('ig-open'); if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } } }
  document.addEventListener('click', (e) => { if (e.target.closest('#detail-install-btn')) { e.preventDefault(); installOpen(); } });
})();
