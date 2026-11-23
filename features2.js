// More features, each built from its design board ("Compare packs", "Lists, quick filters, updates, undo",
// "Share, shortcuts, search history, surprise me", "Pull to refresh, back to top", "Install the app, notification choices").
(function () {
  const lib = () => window.packLibrary;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const ico = (c) => `<i class="fas ${c}" aria-hidden="true"></i>`;
  const when = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 0)) : setTimeout(fn, 0));

  /* ===== 11 · a toast with an Undo action ===== */
  let toastEl = null, toastTimer = 0;
  window.toastAction = function (message, label, run) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = document.createElement('div');
    toastEl.className = 'tx'; toastEl.setAttribute('role', 'status');
    toastEl.innerHTML = `<span></span><button type="button">${esc(label)}</button>`;
    toastEl.firstChild.textContent = message;
    toastEl.querySelector('button').addEventListener('click', () => { const t = toastEl; toastEl = null; t.remove(); run(); });
    document.body.append(toastEl);
    toastTimer = setTimeout(() => { if (toastEl) { toastEl.classList.add('leaving'); const t = toastEl; setTimeout(() => t.remove(), 250); toastEl = null; } }, 6000);
  };

  /* ===== 2 · lists ===== */
  const Lists = {
    all() { return ls.get('packLists', []); },
    save(v) { ls.set('packLists', v); },
    has(id, packId) { const l = this.all().find((x) => x.id === id); return !!l && l.packs.includes(packId); },
    toggle(id, packId) { const a = this.all(); const l = a.find((x) => x.id === id); if (!l) return; l.packs = l.packs.includes(packId) ? l.packs.filter((p) => p !== packId) : [...l.packs, packId]; this.save(a); },
    create(name, packId) {
      const n = String(name || '').trim().slice(0, 40); if (!n) return null;
      const a = this.all(); const l = { id: 'l' + Date.now().toString(36), name: n, packs: packId != null ? [packId] : [] }; a.push(l); this.save(a); return l;
    },
  };
  window.packLists = Lists;

  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', popKey, true); } }
  const outside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-pop-anchor]')) closePop(); };
  const popKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  function place(anchor, width) {
    const r = anchor.getBoundingClientRect();
    const phone = innerWidth <= 768;
    if (phone) { pop.classList.add('pp-sheet'); return; }
    pop.style.width = width + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - width - 8, r.right - width)) + 'px';
    const below = innerHeight - r.bottom;
    pop.style.top = (below > 360 || r.top < 360 ? r.bottom + 8 : Math.max(8, r.top - pop.offsetHeight - 8)) + 'px';
  }
  function openPop(anchor, html, width, wire) {
    closePop();
    pop = document.createElement('div'); pop.className = 'pp'; pop.setAttribute('role', 'dialog');
    pop.innerHTML = html; document.body.append(pop);
    anchor.setAttribute('data-pop-anchor', '');
    place(anchor, width);
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', popKey, true);
    wire(pop);
    const f = pop.querySelector('input, button'); if (f && !(f.tagName === 'BUTTON' && innerWidth <= 768)) f.focus({ preventScroll: true });
  }

  function listPopover(anchor, packId) {
    const draw = () => {
      const lists = Lists.all();
      return `<div class="pp-title">${packId != null ? 'Save to list' : 'My lists'}</div>
        ${lists.map((l) => packId != null
          ? `<button type="button" class="pp-row" data-list="${l.id}" role="checkbox" aria-checked="${l.packs.includes(packId)}"><span class="pp-box">${ico('fa-check')}</span><span class="pp-name">${esc(l.name)}</span><span class="pp-count">${l.packs.length}</span></button>`
          : `<button type="button" class="pp-row" data-open-list="${l.id}"><span class="pp-name">${esc(l.name)}</span><span class="pp-count">${l.packs.length}</span></button>`).join('')}
        ${lists.length ? '' : '<p class="pp-empty">No lists yet. Make one for the packs you want to keep together.</p>'}
        <form class="pp-new" autocomplete="off"><input type="text" maxlength="40" placeholder="New list name…" aria-label="New list name"><button type="submit">Create</button></form>`;
    };
    openPop(anchor, draw(), 320, (el) => {
      const redraw = () => { el.innerHTML = draw(); };
      el.addEventListener('click', (e) => {
        const r = e.target.closest('[data-list]');
        if (r) { Lists.toggle(r.dataset.list, packId); redraw(); window.libQuick && window.libQuick.render(); return; }
        const o = e.target.closest('[data-open-list]');
        if (o) { closePop(); window.router.show('library', { push: false }); lib().quick = ''; lib().setQuick('list:' + o.dataset.openList); }
      });
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        const l = Lists.create(el.querySelector('.pp-new input').value, packId);
        if (l) { redraw(); window.libQuick && window.libQuick.render(); lib().showToast(packId != null ? `Saved to “${l.name}”` : `Created “${l.name}”`); }
      });
    });
  }

  /* ===== 3 · quick filters row ===== */
  const Quick = {
    render() {
      const L = lib(), box = document.getElementById('lib-quick'); if (!L || !box || !L.packs) return;
      const packs = L.packs.filter((p) => !p.discontinued || true);
      const n = (q) => packs.filter((p) => L.matchesQuick(p, q)).length;
      const upd = n('upd');
      const pill = (key, label, count, extra = '') => `<button type="button" class="lq${L.quick === key ? ' on' : ''}${extra}" data-quick="${key}" aria-pressed="${L.quick === key}">${label}${count != null ? ` <span class="lq-n">${count}</span>` : ''}</button>`;
      const lists = Lists.all();
      box.innerHTML = `${pill('', 'All', packs.length)}
        ${pill('fav', `<i class="fas fa-heart lq-heart" aria-hidden="true"></i>Favorites`, n('fav'))}
        ${pill('dl', `<i class="fas fa-check lq-check" aria-hidden="true"></i>Downloaded`, n('dl'))}
        ${pill('new', 'New this month', n('new'))}
        ${upd ? pill('upd', '<span class="lq-dot"></span>Updates', upd, ' lq-upd') : ''}
        <span class="lq-grow"></span>
        <button type="button" class="lq lq-lists${String(L.quick).startsWith('list:') ? ' on' : ''}" data-lists aria-haspopup="dialog">${String(L.quick).startsWith('list:') ? esc((lists.find((l) => l.id === L.quick.slice(5)) || { name: 'My lists' }).name) : 'My lists'} <i class="fas fa-chevron-down" aria-hidden="true"></i></button>`;
    },
  };
  window.libQuick = Quick;
  document.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) { const L = lib(); L.quick = ''; if (q.dataset.quick) L.setQuick(q.dataset.quick); else L.applyFilters(); return; }
    const m = e.target.closest('[data-lists]');
    if (m) { e.preventDefault(); listPopover(m, null); }
  });

  /* ===== 1 · compare ===== */
  const Compare = { ids: [], has(id) { return this.ids.includes(id); } };
  window.packCompare = Compare;
  let tray = null;
  function toggleCompare(id) {
    if (Compare.has(id)) Compare.ids = Compare.ids.filter((x) => x !== id);
    else if (Compare.ids.length >= 3) { lib().showToast('You can compare up to 3 packs.'); return; }
    else Compare.ids.push(id);
    paintCompare();
  }
  function paintCompare() {
    document.querySelectorAll('.pack-compare-btn').forEach((b) => { const on = Compare.has(Number(b.dataset.compareId)); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const d = document.getElementById('detail-compare-btn');
    const cur = lib() && lib().currentPack;
    if (d && cur) { const on = Compare.has(cur.id); d.setAttribute('aria-pressed', String(on)); d.querySelector('span').textContent = on ? 'In compare' : 'Add to compare'; d.classList.toggle('on', on); }
    if (!tray) {
      tray = document.createElement('div'); tray.className = 'cmp-tray'; tray.setAttribute('role', 'region'); tray.setAttribute('aria-label', 'Compare packs');
      document.body.append(tray);
      tray.addEventListener('click', (e) => {
        if (e.target.closest('[data-cmp-clear]')) { Compare.ids = []; paintCompare(); }
        else if (e.target.closest('[data-cmp-open]')) openCompare();
      });
    }
    const packs = Compare.ids.map((id) => lib().packs.find((p) => p.id === id)).filter(Boolean);
    tray.hidden = !packs.length;
    tray.innerHTML = `<span class="cmp-thumbs">${packs.map((p) => `<span class="cmp-th">${p.thumbnail && lib().isImagePath(p.thumbnail) ? `<img src="${esc(p.thumbnail)}" alt="">` : esc((p.name || '?').charAt(0))}</span>`).join('')}</span>
      <span class="cmp-text"><b>${packs.length} pack${packs.length === 1 ? '' : 's'}</b> selected to compare${packs.length < 2 ? ' (pick one more)' : ''}</span>
      <button type="button" class="cmp-clear" data-cmp-clear>Clear</button>
      <button type="button" class="cmp-go" data-cmp-open ${packs.length < 2 ? 'disabled' : ''}>Compare</button>`;
  }
  const bytes = (s) => { const m = /([\d.]+)\s*(B|KB|MB|GB)/i.exec(String(s || '')); return m ? parseFloat(m[1]) * { b: 1, kb: 1024, mb: 1048576, gb: 1073741824 }[m[2].toLowerCase()] : NaN; };
  const ago = (iso) => { const t = Date.parse(iso || ''); if (!t) return '–'; const d = Math.floor((Date.now() - t) / 86400000); if (d < 1) return 'today'; if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`; if (d < 365) { const m = Math.floor(d / 30); return `${m} month${m === 1 ? '' : 's'} ago`; } const y = Math.floor(d / 365); return `${y} year${y === 1 ? '' : 's'} ago`; };
  async function ratingOf(p) {
    try { const r = await fetch(`${API_BASE}/api/ratings/${encodeURIComponent(lib().packSlug(p))}`); if (!r.ok) return null; const d = await r.json(); return d && d.count ? d : null; } catch (e) { return null; }
  }
  async function openCompare() {
    const L = lib(); const packs = Compare.ids.map((id) => L.packs.find((p) => p.id === id)).filter(Boolean); if (packs.length < 2) return;
    const wrap = document.createElement('div'); wrap.className = 'cmp-wrap';
    const ratings = await Promise.all(packs.map(ratingOf));
    const sizes = packs.map((p) => bytes(((p.versions && p.versions[0]) || p).size || p.size));
    const minSize = Math.min(...sizes.filter((x) => !isNaN(x)));
    const dls = packs.map((p) => L.downloadsOf(p)); const maxDl = Math.max(...dls);
    const row = (label, cells) => `<span class="cmp-l">${label}</span>${cells.map((c) => `<span class="cmp-v">${c}</span>`).join('')}`;
    const cols = packs.length;
    wrap.innerHTML = `<div class="cmp-scrim"></div>
      <div class="cmp" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
        <div class="cmp-head"><h2 id="cmp-title">Compare packs</h2><button type="button" class="cmp-x" aria-label="Close">${ico('fa-xmark')}</button></div>
        <div class="cmp-scroll"><div class="cmp-grid" style="--cols:${cols}">
          <span></span>${packs.map((p) => `<div class="cmp-card">
            <span class="cmp-art">${p.thumbnail && L.isImagePath(p.thumbnail) ? `<img src="${esc(p.thumbnail)}" alt="">` : esc((p.name || '?').charAt(0))}</span>
            <div><b>${esc(p.name)}</b><small>by ${esc(p.author || 'Pepe')}</small></div>
            <div class="cmp-act"><button type="button" class="cmp-open" data-id="${p.id}">Open</button><button type="button" class="cmp-rm" data-rm="${p.id}" aria-label="Remove ${esc(p.name)} from comparison">×</button></div></div>`).join('')}
          ${row('Category', packs.map((p) => esc(L.capitalizeFirst(p.category))))}
          ${row('Latest version', packs.map((p) => `<span class="mono">v${esc(L.latestVersionOf(p) || '–')}</span>`))}
          ${row('Size', packs.map((p, i) => { const s = ((p.versions && p.versions[0]) || p).size || p.size || '–'; const best = !isNaN(sizes[i]) && sizes[i] === minSize && packs.length > 1; return `<span class="mono${best ? ' best' : ''}">${esc(s)}${best ? '<em>smallest</em>' : ''}</span>`; }))}
          ${row('Downloads', packs.map((p, i) => `<span class="mono${dls[i] === maxDl && maxDl > 0 ? ' best' : ''}">${dls[i].toLocaleString('en-US')}${dls[i] === maxDl && maxDl > 0 ? '<em>most</em>' : ''}</span>`))}
          ${row('Rating', ratings.map((r) => r ? `${Number(r.average || r.avg || 0).toFixed(1)} ★ <small>(${r.count})</small>` : '<span class="dim">No ratings</span>'))}
          ${row('Needs Assets Pack', packs.map((p) => p.pinned ? '<span class="dim">–</span>' : p.requiresAssets ? '<span class="bad">Yes</span>' : '<span class="best">No</span>'))}
          ${row('Last updated', packs.map((p) => ago(p.updatedAt || p.addedAt)))}
        </div></div></div>`;
    document.body.append(wrap); document.body.classList.add('ig-open');
    const close = () => { wrap.remove(); document.body.classList.remove('ig-open'); document.removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('.cmp-x') || e.target.classList.contains('cmp-scrim')) return close();
      const o = e.target.closest('.cmp-open'); if (o) { close(); const p = L.packs.find((x) => x.id === Number(o.dataset.id)); window.router.show('library', { push: false }); L.showDetail(p); }
      const r = e.target.closest('[data-rm]'); if (r) { Compare.ids = Compare.ids.filter((x) => x !== Number(r.dataset.rm)); paintCompare(); close(); if (Compare.ids.length >= 2) openCompare(); }
    });
    wrap.querySelector('.cmp-x').focus();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.pack-compare-btn');
    if (b) { e.preventDefault(); e.stopPropagation(); toggleCompare(Number(b.dataset.compareId)); return; }
    if (e.target.closest('#detail-compare-btn')) { const c = lib().currentPack; if (c) toggleCompare(c.id); }
  }, true);

  /* ===== detail page: bookmark + compare sync, and the share menu (5) ===== */
  function syncDetail() {
    const c = lib() && lib().currentPack; const b = document.getElementById('detail-list-btn');
    if (b && c) { const any = Lists.all().some((l) => l.packs.includes(c.id)); b.classList.toggle('active', any); b.querySelector('i').className = (any ? 'fas' : 'far') + ' fa-bookmark'; }
    paintCompare();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#detail-list-btn');
    if (b) { const c = lib().currentPack; if (c) listPopover(b, c.id); return; }
    const s = e.target.closest('#detail-share-btn');
    if (s) { e.preventDefault(); e.stopImmediatePropagation(); sharePopover(s); }
  }, true);

  function sharePopover(anchor) {
    const L = lib(), p = L.currentPack; if (!p) return;
    const link = `${location.origin}/pack/${L.packSlug(p)}`;
    const desc = String(p.description || '').replace(/\s+/g, ' ').trim(); const short = desc.length > 120 ? desc.slice(0, 117).trimEnd() + '…' : desc;
    const label = p.pinned ? 'Required pack' : { packs: 'HUD pack', clients: 'Client', addons: 'Addon', apps: 'App', cosmetics: 'Cosmetic', utility: 'Utility' }[p.category] || L.capitalizeFirst(p.category);
    const discord = `**${p.name}** · ${label}\n${short}\n${link}`;
    const md = `[${p.name}](${link})`;
    const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); L.showToast(msg); } catch (err) { prompt('Copy this:', text); } closePop(); };
    const canShare = !!navigator.share;
    openPop(anchor, `<div class="pp-menu" role="menu" aria-label="Share this pack">
        <button type="button" class="pp-opt on" data-share="link" role="menuitem"><span class="pp-ic" style="--c:#1f6b3a;--f:#c7f0bd">${ico('fa-link')}</span><span><b>Copy link</b><small>${esc(location.host)}/pack/…</small></span></button>
        <button type="button" class="pp-opt" data-share="md" role="menuitem"><span class="pp-ic mono" style="--c:#1f4b6b;--f:#c7e6ff">MD</span><span><b>Copy as Markdown</b><small>[${esc(p.name)}](link)</small></span></button>
        <button type="button" class="pp-opt" data-share="discord" role="menuitem"><span class="pp-ic" style="--c:#3b3f6b;--f:#d7d9ff">${ico('fa-comment')}</span><span><b>Copy for Discord</b><small>Name, short description and link</small></span></button>
        ${canShare ? `<button type="button" class="pp-opt" data-share="more" role="menuitem"><span class="pp-ic" style="--c:#4a4d52;--f:#e4e6e8">${ico('fa-arrow-up-from-bracket')}</span><span><b>More…</b><small>Your device's share sheet</small></span></button>` : ''}
      </div>
      <div class="pp-preview"><span>Discord preview</span>${esc(discord).replace(/\n/g, '<br>')}</div>`, 360, (el) => {
      el.addEventListener('click', (e) => {
        const o = e.target.closest('[data-share]'); if (!o) return;
        const k = o.dataset.share;
        if (k === 'link') copy(link, 'Link copied.'); else if (k === 'md') copy(md, 'Markdown copied.'); else if (k === 'discord') copy(discord, 'Copied for Discord.');
        else { closePop(); navigator.share({ title: p.name, text: short, url: link }).catch(() => {}); }
      });
    });
  }

  const wrapDetail = () => {
    const L = lib(); if (!L || L.__f2) return false; L.__f2 = true;
    const orig = L.showDetail.bind(L);
    L.showDetail = (pack, opts) => { const out = orig(pack, opts); setTimeout(syncDetail, 0); return out; };
    const reRender = L.render.bind(L);
    L.render = (...a) => { const out = reRender(...a); setTimeout(paintCompare, 0); return out; };
    return true;
  };

  /* ===== 6 · keyboard shortcuts ===== */
  let help = null;
  const kbd = (k) => `<kbd>${k}</kbd>`;
  function openHelp() {
    if (help) return closeHelp();
    help = document.createElement('div'); help.className = 'kb-wrap';
    help.innerHTML = `<div class="kb-scrim"></div><div class="kb" role="dialog" aria-modal="true" aria-labelledby="kb-title">
      <h2 id="kb-title">Keyboard shortcuts</h2>
      <h3>Search</h3>
      <div class="kb-row"><span>Quick search</span><span>${kbd('Ctrl')} ${kbd('K')}</span></div>
      <div class="kb-row"><span>Quick search (alternative)</span><span>${kbd('/')}</span></div>
      <h3>Go to</h3>
      <div class="kb-row"><span>Home · Library · Customizer · Settings</span><span>${kbd('G')} then ${kbd('H')} ${kbd('L')} ${kbd('C')} ${kbd('S')}</span></div>
      <h3>Anywhere</h3>
      <div class="kb-row"><span>Show this list</span><span>${kbd('?')}</span></div>
      <div class="kb-row"><span>Close a dialog</span><span>${kbd('Esc')}</span></div>
    </div>`;
    document.body.append(help);
    help.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('kb-scrim')) closeHelp(); });
  }
  function closeHelp() { if (help) { help.remove(); help = null; } }
  window.shortcutsHelp = { open: openHelp, close: closeHelp };
  let gAt = 0;
  document.addEventListener('keydown', (e) => {
    const t = e.target; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((t && t.tagName) || '') || (t && t.isContentEditable);
    if (e.key === 'Escape' && help) { e.stopPropagation(); closeHelp(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains('cz-open') || document.body.classList.contains('qs-open')) return;
    if (e.key === '?') { e.preventDefault(); openHelp(); return; }
    if (e.key.toLowerCase() === 'g') { gAt = Date.now(); return; }
    if (Date.now() - gAt < 1200) {
      const go = { h: 'home', l: 'library', c: 'customizer', s: 'settings' }[e.key.toLowerCase()];
      if (go) { e.preventDefault(); gAt = 0; window.router.show(go); }
    }
  }, true);

  /* ===== 15 · back to top ===== */
  function backToTop() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btt'; b.setAttribute('aria-label', 'Back to top');
    b.innerHTML = '<i class="fas fa-chevron-up" aria-hidden="true"></i>'; document.body.append(b);
    b.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
    let q = false;
    addEventListener('scroll', () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; b.classList.toggle('show', scrollY > 600 && !document.body.classList.contains('cz-open')); }); }, { passive: true });
  }

  /* ===== 14 · pull to refresh (phones) ===== */
  function pullToRefresh() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = '<span class="ptr-c"><i class="fas fa-rotate" aria-hidden="true"></i></span><span class="ptr-t">Pull to refresh</span>';
    document.body.append(ind);
    let y0 = null, dy = 0, busy = false;
    const active = () => { const pg = document.getElementById('page-library'); const bv = document.getElementById('browse-view'); return pg && pg.classList.contains('active') && bv && !bv.classList.contains('hidden') && scrollY <= 0; };
    const paint = (d, release) => { ind.style.transform = `translateY(${Math.min(d, 110)}px)`; ind.style.opacity = String(Math.min(1, d / 50)); ind.classList.toggle('go', release); ind.querySelector('.ptr-t').textContent = release ? 'Release to refresh' : 'Pull to refresh'; ind.querySelector('i').style.transform = `rotate(${Math.min(d, 110) * 3}deg)`; };
    document.addEventListener('touchstart', (e) => { if (!busy && active() && e.touches.length === 1) { y0 = e.touches[0].clientY; dy = 0; } else y0 = null; }, { passive: true });
    document.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = (e.touches[0].clientY - y0) * 0.5; if (dy > 0 && scrollY <= 0) { ind.classList.remove('anim'); paint(dy, dy >= 60); } else if (dy <= 0) { paint(0, false); } }, { passive: true });
    document.addEventListener('touchend', async () => {
      if (y0 == null) return; const go = dy >= 60; y0 = null;
      ind.classList.add('anim');
      if (!go) { paint(0, false); return; }
      busy = true; ind.classList.add('spin'); ind.querySelector('.ptr-t').textContent = 'Refreshing…'; ind.style.transform = 'translateY(70px)'; ind.style.opacity = '1';
      try { const L = lib(); const list = await L.loadCommunityPacks({ fresh: true }); L.mergeCommunityPacks(list); L.liveDownloadCounts.clear(); L.rankSettled = false; L.applyFilters(); L.showToast('Library refreshed'); } catch (e) { lib().showToast('Could not refresh. Check your connection.'); }
      ind.classList.remove('spin'); paint(0, false); busy = false;
    });
  }

  /* ===== 7 · install the app ===== */
  let deferred = null;
  function installCard() {
    const card = document.getElementById('st-install'); if (!card) return;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
    const show = () => { card.hidden = standalone || !(deferred || ios); };
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; show(); });
    window.addEventListener('appinstalled', () => { deferred = null; card.hidden = true; lib().showToast('Installed. Find Pepe on your home screen.'); });
    document.getElementById('st-install-btn').addEventListener('click', async () => {
      if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* ignore */ } deferred = null; show(); }
      else lib().showToast('Tap Share, then “Add to Home Screen”.');
    });
    show();
    // the Android app (APK); not offered on iPhones, which cannot install it, nor inside the app itself (a WebView)
    const inApp = /; wv\)|\bwv\b/i.test(navigator.userAgent) || standalone;
    const apk = document.getElementById('st-apk');
    if (apk) {
      apk.hidden = /iphone|ipad|ipod/i.test(navigator.userAgent) || inApp;
      document.getElementById('st-apk-how').addEventListener('click', () => { const n = document.getElementById('st-apk-note'); n.hidden = !n.hidden; });
    }
  }

  /* ===== Android app banner: once, on Android browsers (see the "V · Android app card" board) ===== */
  function apkBanner() {
    const ua = navigator.userAgent;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!/android/i.test(ua) || /; wv\)|\bwv\b/i.test(ua) || standalone) return;
    try { if (localStorage.getItem('apkBannerDismissed')) return; } catch (e) { /* show it once per visit */ }
    const dl = document.getElementById('st-apk-dl'); if (!dl) return;
    setTimeout(() => {
      if (document.body.classList.contains('cz-open')) return;
      const b = document.createElement('div');
      b.className = 'apk-banner'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Get the Pepe app');
      b.innerHTML = '<span class="apk-ico"><i class="fab fa-android" aria-hidden="true"></i></span><div class="apk-text"><b>Get the Pepe app</b><small>Faster, full screen, free</small></div><a class="apk-get" target="_blank" rel="noopener">Get</a><button type="button" class="apk-x" aria-label="Dismiss">×</button>';
      b.querySelector('.apk-get').href = dl.href;
      const close = () => { b.remove(); try { localStorage.setItem('apkBannerDismissed', '1'); } catch (e) { /* ignore */ } };
      b.querySelector('.apk-x').addEventListener('click', close);
      b.querySelector('.apk-get').addEventListener('click', () => setTimeout(close, 300));
      document.body.append(b);
    }, 5000);
  }

  /* ===== 10 · notification choices ===== */
  const KIND = { follow: 'follow', new_pack: 'new_pack', pack_approved: 'review', pack_rejected: 'review' };
  window.notifPrefs = {
    kindOf: (type) => KIND[type] || 'follow',
    get(k) { const p = ls.get('notifPrefs', {}); return p[k] !== false; },
    set(k, v) { const p = ls.get('notifPrefs', {}); p[k] = !!v; ls.set('notifPrefs', p); },
  };
  function notifSettings() {
    document.querySelectorAll('[data-notif-pref]').forEach((inp) => {
      const k = inp.dataset.notifPref; inp.checked = window.notifPrefs.get(k);
      inp.addEventListener('change', () => window.notifPrefs.set(k, inp.checked));
    });
  }

  when(() => {
    const tryWrap = () => { if (!wrapDetail()) setTimeout(tryWrap, 100); else { Quick.render(); paintCompare(); } };
    tryWrap(); backToTop(); pullToRefresh(); installCard(); notifSettings(); apkBanner();
  });
})();
