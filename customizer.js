/* Assets Pack customizer. The form is generated from the latest Assets Pack's _global_variables.json
   (customizer-data.json, refreshed by tools/update_customizer.py on every deploy), so new variables appear on their own.
   Labels / groups / limits for known variables come from customizer-meta.json; the rest is inferred from the name. */
(function () {
  'use strict';

  const STORE = 'czValues';          // only the variables the visitor changed, so unchanged ones follow new defaults
  const KNOWN = 'czKnownVars';       // variable names seen on the last visit, to point out new settings
  const COLLAPSE = 'czCollapsed';    // group titles the visitor folded closed
  const SUFFIXES = ['_mouse_controller_offset', '_touch_offset', '_offset', '_opacity', '_anchor'];
  const $ = (id) => document.getElementById(id);

  let data = null, meta = null;
  let packs = [];                    // customizer-packs.json: every pack with settings, each with its versions
  let active = null;                 // {pack, build}: the pack + version being edited
  let picked = {};                   // pack id -> chosen version (remembered)
  let settingMeta = {};              // manifest pack setting name -> its manifest entry (+ group)
  let defaults = {};                 // name -> default value (only the ones the form shows)
  let allDefaults = {};              // every name -> default value, hidden ones too (the preview still reads them)
  let values = {};                   // name -> current value
  let rows = [];                     // {name, row, label, labelText, text, dot, reset, group, sync}
  let cards = [];                    // {title, section, toggle, chev, body, descEl}
  let collapsedMap = {};             // group title -> true when folded closed (remembered)
  let onlyChanged = false;

  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(kid));
    return node;
  }

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const t = $('cz-toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }


  /* ---------- download gate (same Linkvertise step as the main site) ---------- */
  const GATE_PENDING = 'czPendingDownload';   // {p, v, t}: the pack + version waiting on the gate, set just before leaving for it
  const GATE_MAX_AGE_MS = 30 * 60 * 1000;
  const LINKVERTISE_USER_ID = 499358;         // same account as script.js

  // Linkvertise is the only gate here: script.js's LootLabs links are pre-built per pack and wrap the main site's /download page,
  // so they cannot return to this customizer. The return link is /customizer?unlock=1 on this site.
  function startDownloadGate(pack, build) {
    write(GATE_PENDING, { p: pack.id, v: build.version, t: Date.now() });
    const back = new URL('/customizer?unlock=1', location.origin);
    const random = Math.random() * 1000;
    location.href = `https://link-to.net/${LINKVERTISE_USER_ID}/${random}/dynamic/?r=${encodeURIComponent(btoa(back.href))}`;
  }

  // True only when this load is the gate coming back for the same pack + version the visitor asked for.
  // The query is read from window.czEntrySearch (captured by script.js before the router strips it), so it also works
  // when the customizer boots lazily inside index.html.
  function takeGateReturn() {
    const entry = window.czEntrySearch != null ? window.czEntrySearch : location.search;
    delete window.czEntrySearch;
    if (!new URLSearchParams(entry).has('unlock')) return false;
    history.replaceState(history.state, '', location.pathname + location.hash);
    const pending = read(GATE_PENDING, null);
    write(GATE_PENDING, null);
    return !!pending && Date.now() - pending.t < GATE_MAX_AGE_MS && pending.p === active.pack.id && pending.v === active.build.version;
  }

  /* ---------- custom checkbox / dropdown ---------- */
  function checkbox({ id, label, checked, disabled, onChange }) {
    const input = el('input', { type: 'checkbox', id, class: 'cz-cb-input', disabled: !!disabled });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    const tick = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const box = el('span', { class: 'cz-cb-box' }); box.innerHTML = tick;
    return { root: el('label', { class: 'cz-cb' + (disabled ? ' is-disabled' : ''), for: id }, input, box, el('span', { class: 'cz-cb-text', text: label })), input };
  }

  let openDropdown = null;
  function dropdown({ id, label, options, value, disabled, onChange }) {
    let current = value, active = -1, listEl = null, scrim = null, openedAt = 0, openW = 0, typed = '', typedTimer = 0;
    const btn = el('button', { type: 'button', class: 'cz-dd-btn', id, role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label || null, disabled: !!disabled });
    const text = el('span', { class: 'cz-dd-text' });
    btn.append(text, el('i', { class: 'fas fa-chevron-down cz-dd-chev', 'aria-hidden': 'true' }));
    const root = el('span', { class: 'cz-dd' }, btn);
    const labelOf = (v) => (options.find((o) => o.value === v) || { label: String(v) }).label;
    const paint = () => { text.textContent = labelOf(current); };
    paint();

    function close(focus) {
      if (!listEl) return;
      listEl.remove(); listEl = null; btn.setAttribute('aria-expanded', 'false');
      if (scrim) { scrim.remove(); scrim = null; }
      btn.removeAttribute('aria-activedescendant'); btn.removeAttribute('aria-controls');
      window.removeEventListener('scroll', onAway, true); window.removeEventListener('resize', onAway);
      document.removeEventListener('pointerdown', onOutside, true);
      if (openDropdown === self) openDropdown = null;
      if (focus) btn.focus();
    }
    // scrolling the list itself (wheel, touch, or scrollIntoView on arrow keys) must not close it
    // Phones fire scroll/resize on their own (address bar hiding, scrollIntoView, rotation settling):
    // those must not close the list. Only a real scroll of the page after it has settled does.
    const onAway = (e) => {
      if (!listEl) return;
      if (e && e.target instanceof Node && listEl.contains(e.target)) return;
      if (performance.now() - openedAt < 350) return;
      if (e && e.type === 'resize' && innerWidth === openW) return;
      if (sheetMode()) return;                       // a sheet stays until a choice, the backdrop or Escape
      close(false);
    };
    const sheetMode = () => !!listEl && listEl.classList.contains('cz-dd-sheet');
    const onOutside = (e) => { if (!listEl.contains(e.target) && !btn.contains(e.target)) close(false); };
    function highlight(i) {
      active = Math.max(0, Math.min(options.length - 1, i));
      [...listEl.children].forEach((li, n) => li.classList.toggle('active', n === active));
      const li = listEl.children[active];
      if (li.offsetTop < listEl.scrollTop) listEl.scrollTop = li.offsetTop - 4;
      else if (li.offsetTop + li.offsetHeight > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = li.offsetTop + li.offsetHeight - listEl.clientHeight + 4;
      btn.setAttribute('aria-activedescendant', listEl.children[active].id);
    }
    function choose(i) {
      current = options[i].value; paint(); close(true); onChange(current);
    }
    function open() {
      if (listEl) return;
      if (openDropdown) openDropdown.close(false);
      listEl = el('ul', { class: 'cz-dd-list', id: `${id}-list`, role: 'listbox', tabindex: '-1' }, options.map((o, i) => el('li', {
        role: 'option', id: `${id}-o${i}`, class: o.value === current ? 'sel' : '', 'aria-selected': String(o.value === current),
        onclick: () => choose(i), onmousemove: () => highlight(i),
      }, o.label)));
      openedAt = performance.now(); openW = innerWidth;
      const sheet = matchMedia('(pointer: coarse)').matches || innerWidth <= 768;
      if (sheet) {
        // Phones: a bottom sheet with a backdrop, like a native picker. Big targets, never off screen.
        listEl.classList.add('cz-dd-sheet');
        listEl.dataset.title = label || '';
        scrim = el('div', { class: 'cz-dd-scrim' });
        scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(true); });
        document.body.append(scrim, listEl);
      } else {
        const r = btn.getBoundingClientRect();
        Object.assign(listEl.style, { position: 'fixed', left: r.left + 'px', minWidth: r.width + 'px', zIndex: 9999 });
        document.body.append(listEl);
        const room = innerHeight - 16;
        listEl.style.maxHeight = Math.min(260, room) + 'px';
        const h = listEl.offsetHeight, below = innerHeight - r.bottom;
        listEl.style.top = (below < h + 8 && r.top > below ? Math.max(8, r.top - h - 4) : Math.min(r.bottom + 4, Math.max(8, innerHeight - h - 8))) + 'px';
        const lr = listEl.getBoundingClientRect();
        if (lr.right > innerWidth - 8) listEl.style.left = Math.max(8, innerWidth - 8 - lr.width) + 'px';
      }
      btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', `${id}-list`); openDropdown = self;
      highlight(Math.max(0, options.findIndex((o) => o.value === current)));
      window.addEventListener('scroll', onAway, true); window.addEventListener('resize', onAway);
      document.addEventListener('pointerdown', onOutside, true);
    }
    btn.addEventListener('click', () => (listEl ? close(true) : open()));
    btn.addEventListener('keydown', (e) => {
      const k = e.key;
      if (!listEl) { if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); open(); } return; }
      if (k === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (k === 'Home') { e.preventDefault(); highlight(0); }
      else if (k === 'End') { e.preventDefault(); highlight(options.length - 1); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
      else if (k === 'Escape') { e.preventDefault(); close(true); }
      else if (k === 'Tab') close(false);
      else if (k.length === 1) {            // type to jump
        clearTimeout(typedTimer); typed += k.toLowerCase(); typedTimer = setTimeout(() => { typed = ''; }, 600);
        const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed)); if (hit >= 0) highlight(hit);
      }
    });
    const self = {
      root, close, setValue: (v) => { current = v; paint(); }, getValue: () => current,
      setDisabled: (d) => { btn.disabled = !!d; if (d) close(false); },
    };
    return self;
  }

  /* ---------- naming ---------- */
  const bare = (name) => name.replace(/^\$/, '').replace(/\|default$/, '');
  const humanize = (s) => { const t = s.replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  function splitName(name) {
    let stem = bare(name), suffix = '', hide = false;
    if (stem.startsWith('hide_')) { hide = true; stem = stem.slice(5); }
    for (const s of SUFFIXES) if (stem.endsWith(s)) { suffix = s.slice(1); stem = stem.slice(0, -s.length); break; }
    return { stem, suffix, hide };
  }
  const isAdvanced = (name) => !isManifest() && !name.startsWith('$hide_') && (meta.advanced_patterns || []).some((p) => new RegExp(p).test(name));

  /* ---------- packs and versions ---------- */
  const plain = (s) => String(s || '').replace(/§./g, '').trim();
  const storeKey = (pack) => (pack.kind === 'variables' ? STORE : STORE + ':' + pack.id);
  const isManifest = () => active && active.pack.kind === 'settings';

  // Assets Pack variables the form leaves out: meta.hidden_patterns, and variables that moved to a pack with its own
  // settings once that pack's latest version is at or past meta.moved[].since
  const cmpVer = (a, b) => { const x = String(a).split('.'), y = String(b).split('.'); for (let i = 0; i < 3; i++) { const d = (+x[i] || 0) - (+y[i] || 0); if (d) return d; } return 0; };
  function isHidden(name, pack) {
    if (!pack || pack.kind !== 'variables') return false;
    if ((meta.hidden_patterns || []).some((p) => new RegExp(p, 'i').test(name))) return true;
    return (meta.moved || []).some((m) => {
      const other = packs.find((p) => p.id === m.pack);
      const latest = other && (other.latest || (other.versions[0] || {}).version);
      return !!latest && cmpVer(latest, m.since) >= 0 && new RegExp(m.pattern, 'i').test(name);
    });
  }

  function buildDefaults(build, pack) {
    const out = {};
    if (build.variables) Object.assign(out, build.variables);
    else for (const s of build.settings || []) if (s.name && 'default' in s) out[s.name] = s.default;
    if (pack) for (const k of Object.keys(out)) if (isHidden(k, pack)) delete out[k];
    return out;
  }

  function settingsIndex(build) {
    const idx = {}; let group = active.pack.name.replace(/^Pepe's /, '');
    for (const s of build.settings || []) {
      if (s.type === 'label') { group = plain(s.text).replace(/\(.*\)$/, '').trim() || group; continue; }
      if (s.name) idx[s.name] = { ...s, group };
    }
    return idx;
  }

  // values another pack's settings currently have, so the preview can draw every pack at once
  function otherValue(name) {
    for (const p of packs) {
      if (active && p === active.pack) continue;
      const build = p.versions.find((v) => v.version === picked[p.id]) || p.versions[0];
      const defs = buildDefaults(build);
      if (!(name in defs)) continue;
      const stored = read(storeKey(p), {});
      return name in stored ? stored[name] : defs[name];
    }
    return undefined;
  }

  function choosePack(id, version) {
    const pack = packs.find((p) => p.id === id) || packs[0];
    const build = pack.versions.find((v) => v.version === version) || pack.versions.find((v) => v.version === picked[pack.id])
      || pack.versions.find((v) => (pack.kind === 'variables' ? v.variables : v.settings)) || pack.versions[0];
    picked[pack.id] = build.version; write('czVersions', picked); write('czPack', pack.id);
    active = { pack, build };
    allDefaults = buildDefaults(build);
    defaults = buildDefaults(build, pack);
    settingMeta = build.settings ? settingsIndex(build) : {};
    values = Object.fromEntries(Object.entries(read(storeKey(pack), {})).filter(([k, v]) => isKnown(k) && typeof v === typeof defaults[k]));
    undoStack.length = 0; redoStack.length = 0; lastPush = { name: null, at: 0 }; updateUR();
    paintPicker();
    const info = $('cz-pack');
    const count = Object.keys(defaults).length;
    if (!count) {
      info.replaceChildren(el('b', { text: `${pack.name} v${build.version}` }),
        pack.id === 'pepes-armorhud' || /armor/i.test(pack.name) ? ' has no settings of its own: its options are in the Assets Pack.' : ' has no settings in this version.');
    } else {
      info.replaceChildren('Editing ', el('b', { text: `${pack.name} v${build.version}` }), ' · ' + count + ' settings');
    }
    $('cz-download').disabled = !count;
    render(); refreshState();
  }

  let packDd = null, verDd = null;
  function paintPicker() {
    const wrap = $('cz-picker');
    if (!wrap || !packs.length) return;
    const { pack, build } = active;
    packDd = dropdown({ id: 'cz-pick-pack', label: 'Pack', value: pack.id, options: packs.map((p) => ({ value: p.id, label: p.name })),
      onChange: (id) => choosePack(id) });
    verDd = dropdown({ id: 'cz-pick-ver', label: 'Version', value: build.version,
      options: pack.versions.map((v, i) => ({ value: v.version, label: 'v' + v.version + (i === 0 ? ' (latest)' : '') + ((pack.kind === 'variables' ? v.variables : v.settings) ? '' : ' · no settings') })),
      onChange: (v) => choosePack(pack.id, v) });
    wrap.replaceChildren(el('span', { class: 'cz-pick' }, el('span', { class: 'cz-pick-label', text: 'Pack' }), packDd.root),
      el('span', { class: 'cz-pick' }, el('span', { class: 'cz-pick-label', text: 'Version' }), verDd.root));
  }

  function describe(name) {
    if (isManifest()) {
      const s = settingMeta[name] || {};
      const [label, ...rest] = plain(s.text).split('|');
      return { title: s.group || active.pack.name, icon: 'fa-sliders', desc: '', label: label.trim() || name, hint: rest.join('|').trim(),
        hide: false, suffix: '', m: {}, stem: s.group || '' };
    }
    const { stem, suffix, hide } = splitName(name);
    const m = (meta.vars || {})[name] || {};
    const g = (meta.groups || {})[stem] || {};
    const title = g.title || humanize(stem);
    let label = m.label;
    if (!label) label = hide ? 'Show ' + stem.replace(/_/g, ' ') : (suffix ? humanize(suffix.replace(/_/g, ' ')) : humanize(stem));
    return { title, icon: g.icon || 'fa-sliders', desc: g.desc || '', label, hide, suffix, m, stem };
  }

  /* ---------- undo / redo and presets (Customizer tools design) ---------- */
  const undoStack = [], redoStack = [];
  let lastPush = { name: null, at: 0 };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function updateUR() {
    const u = document.getElementById('cz-undo'), r = document.getElementById('cz-redo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }
  // called before a change; edits to the same setting within 700 ms (a slider or a drag) count as one step
  function pushHistory(name) {
    const now = Date.now();
    if (name && lastPush.name === name && now - lastPush.at < 700) { lastPush.at = now; return; }
    undoStack.push(clone(values)); if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0; lastPush = { name, at: now }; updateUR();
  }
  function restore(v) {
    values = clone(v); write(storeKey(active.pack), values); rebuildInputs(); refreshState(); updateUR();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(clone(values)); lastPush = { name: null, at: 0 }; restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(clone(values)); lastPush = { name: null, at: 0 }; restore(redoStack.pop()); }

  const presetStore = () => read('czPresets', {});
  const presetsOf = () => presetStore()[storeKey(active.pack)] || [];
  const savePresets = (list) => { const all = presetStore(); all[storeKey(active.pack)] = list; write('czPresets', all); };
  const sameValues = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  function renderPresets() {
    const box = document.getElementById('cz-presets'); if (!box) return;
    const list = presetsOf();
    box.innerHTML = `<div class="cz-pr-title">Presets</div><div class="cz-pr-sub">Save your settings and switch between setups.</div>
      ${list.map((p, i) => { const use = sameValues(p.values, values); const n = Object.keys(p.values).length;
        return `<div class="cz-pr-row${use ? ' use' : ''}"><div class="cz-pr-text"><b>${p.name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</b><small>${n} change${n === 1 ? '' : 's'}${use ? ' · in use' : ''}</small></div>
          ${use ? '' : `<button type="button" class="cz-pr-apply" data-apply="${i}">Apply</button>`}<button type="button" class="cz-pr-del" data-del="${i}" aria-label="Delete ${p.name.replace(/"/g, '')}"><i class="fas fa-trash-can" aria-hidden="true"></i></button></div>`; }).join('')}
      ${list.length ? '' : '<p class="cz-pr-empty">No presets yet. Change some settings, then name and save them below.</p>'}
      <form class="cz-pr-new" autocomplete="off"><input type="text" maxlength="40" placeholder="Name this setup…" aria-label="Preset name"><button type="submit">Save</button></form>
      <button type="button" class="cz-pr-share" data-share><i class="fas fa-link" aria-hidden="true"></i> Copy share link</button>`;
  }
  function closePresets() { const b = document.getElementById('cz-presets'); if (b) b.hidden = true; const t = document.getElementById('cz-presets-btn'); if (t) t.setAttribute('aria-expanded', 'false'); }
  function togglePresets() {
    let box = document.getElementById('cz-presets');
    if (!box) {
      box = document.createElement('div'); box.id = 'cz-presets'; box.className = 'cz-presets'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Presets'); box.hidden = true;
      $('cz-main').append(box);
      box.addEventListener('click', (e) => {
        const a = e.target.closest('[data-apply]'); if (a) { const p = presetsOf()[Number(a.dataset.apply)]; if (p) { pushHistory(null); restore(p.values); toast(`Applied “${p.name}”`); renderPresets(); } return; }
        const d = e.target.closest('[data-del]'); if (d) { const l = presetsOf(); const [gone] = l.splice(Number(d.dataset.del), 1); savePresets(l); renderPresets(); toast(`Deleted “${gone.name}”`); return; }
        if (e.target.closest('[data-share]')) { syncHash(); navigator.clipboard.writeText(location.href).then(() => toast('Share link copied.'), () => toast('Copy this page address to share your settings.')); }
      });
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = box.querySelector('.cz-pr-new input').value.trim().slice(0, 40);
        if (!name) return;
        if (!Object.keys(values).length) { toast('Change some settings first, then save them.'); return; }
        const l = presetsOf().filter((p) => p.name.toLowerCase() !== name.toLowerCase()); l.push({ name, values: clone(values), at: Date.now() }); savePresets(l); renderPresets(); toast(`Saved “${name}”`);
      });
      document.addEventListener('pointerdown', (e) => { if (!box.hidden && !e.target.closest('#cz-presets, #cz-presets-btn')) closePresets(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); closePresets(); } }, true);
    }
    if (!box.hidden) { closePresets(); return; }
    renderPresets(); box.hidden = false; $('cz-presets-btn').setAttribute('aria-expanded', 'true');
    if (innerWidth > 768) { const r = $('cz-presets-btn').getBoundingClientRect(); box.style.top = r.bottom + 8 + 'px'; box.style.left = Math.max(8, Math.min(innerWidth - 368, r.right - 360)) + 'px'; } else { box.style.top = ''; box.style.left = ''; }
  }

  /* ---------- controls ---------- */
  function setValue(name, v, fromUi) {
    pushHistory(name);
    if (same(v, defaults[name])) delete values[name]; else values[name] = v;
    write(storeKey(active.pack), values);
    refreshState();
    if (!fromUi) rebuildInputs();
  }
  const current = (name) => (name in values ? values[name] : defaults[name]);

  function makeControl(name, info) {
    const val = current(name), def = defaults[name], m = { ...info.m };   // copy: never write into the shared meta
    const id = 'cz-' + bare(name).replace(/[^a-z0-9]+/gi, '-');
    let input, ctl;
    const s = settingMeta[name];

    if (s && s.type === 'dropdown') {
      const opts = (s.options || []).map((o) => ({ value: o.name, label: plain(o.text) || o.name }));
      const dd = dropdown({ id, label: info.label, options: opts, value: val, onChange: (v) => setValue(name, v, true) });
      return { ctl: el('span', { class: 'cz-ctl' }, dd.root), id, sync: () => dd.setValue(current(name)) };
    }
    if (s && s.type === 'slider') { m.min = s.min; m.max = s.max; m.step = s.step || 1; }

    if (typeof def === 'boolean') {
      // "$hide_x" is shown as "Show x", so ON means visible (the stored value is inverted)
      const shown = () => (info.hide ? !current(name) : !!current(name));
      input = el('input', { type: 'checkbox', id, role: 'switch' });
      input.checked = shown();
      input.addEventListener('change', () => setValue(name, info.hide ? !input.checked : input.checked, true));
      ctl = el('span', { class: 'cz-switch' }, input, el('span', { class: 'cz-track' }));
      return { ctl, id, sync: () => { input.checked = shown(); } };
    }

    if (typeof def === 'number') {
      const slider = info.suffix === 'opacity' || m.step;
      const min = m.min ?? (slider ? 0 : undefined), max = m.max ?? (slider ? 1 : undefined), step = m.step ?? (slider ? 0.05 : 'any');
      input = el('input', { type: slider ? 'range' : 'number', id, min, max, step });
      input.value = val;
      const out = el('span', { class: 'cz-val', text: String(val) });
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        if (Number.isNaN(n)) return;
        out.textContent = String(n); setValue(name, n, true);
      });
      ctl = el('span', { class: 'cz-ctl' }, input, slider ? out : null);
      return { ctl, id, sync: () => { input.value = current(name); out.textContent = String(current(name)); } };
    }

    if (Array.isArray(def) && def.length === 2 && def.every((n) => typeof n === 'number')) {
      const xs = ['x', 'y'].map((axis, i) => {
        const inp = el('input', { type: 'number', step: 'any', id: i ? null : id, 'aria-label': `${info.label} ${axis}` });
        inp.value = val[i];
        inp.addEventListener('input', () => {
          const next = [...current(name)]; const n = parseFloat(inp.value);
          if (Number.isNaN(n)) return;
          next[i] = n; setValue(name, next, true);
        });
        return { inp, wrap: el('span', { class: 'cz-axis' }, axis.toUpperCase(), inp) };
      });
      ctl = el('span', { class: 'cz-ctl' }, xs.map((x) => x.wrap));
      return { ctl, id, sync: () => xs.forEach((x, i) => { x.inp.value = current(name)[i]; }) };
    }

    if (typeof def === 'string' && (info.suffix === 'anchor' || (meta.anchors || []).includes(def))) {
      const opts = [...new Set([...(meta.anchors || []), def, val])].map((o) => ({ value: o, label: o.replace(/_/g, ' ') }));
      const dd = dropdown({ id, label: info.label, options: opts, value: val, onChange: (v) => setValue(name, v, true) });
      return { ctl: el('span', { class: 'cz-ctl' }, dd.root), id, sync: () => dd.setValue(current(name)) };
    }

    // anything else (strings, longer lists): edit as JSON text so every type round-trips
    input = el('input', { type: 'text', id });
    input.style.width = '150px';
    input.value = JSON.stringify(val);
    input.addEventListener('change', () => {
      try { setValue(name, JSON.parse(input.value), true); } catch (e) { input.value = JSON.stringify(current(name)); toast('That value is not valid JSON.'); }
    });
    return { ctl: el('span', { class: 'cz-ctl' }, input), id, sync: () => { input.value = JSON.stringify(current(name)); } };
  }

  /* ---------- render ---------- */
  function render() {
    const groups = new Map(), advanced = [];
    for (const name of Object.keys(defaults)) {
      const info = describe(name);
      if (isAdvanced(name)) { advanced.push([name, info]); continue; }
      if (!groups.has(info.title)) groups.set(info.title, { icon: info.icon, desc: info.desc, items: [], stems: new Set() });
      const g = groups.get(info.title);
      if (!g.desc && info.desc) g.desc = info.desc;
      g.items.push([name, info]); g.stems.add(info.stem);
    }
    // a card that mixes several modules (Debug HUD lines, Coordinates ...) needs the module name in every label
    for (const g of groups.values()) {
      if (g.stems.size < 2) continue;
      for (const [name, info] of g.items) {
        if ((meta.vars || {})[name]?.label) continue;
        const stem = info.stem.replace(/_/g, ' ');
        info.label = info.hide ? 'Show ' + stem : humanize(stem + (info.suffix ? ' ' + info.suffix.replace(/_/g, ' ') : ''));
      }
    }
    rows = []; cards = [];
    const root = $('cz-groups');
    root.replaceChildren();
    // pack settings keep the order the pack author gave them; Assets Pack variables are sorted by module
    const ordered = isManifest() ? [...groups] : [...groups].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [title, g] of ordered) root.append(card(title, g.icon, g.desc, g.items));
    const adv = $('cz-advanced-grid');
    adv.replaceChildren(...advanced.map(([name, info]) => row(name, info, 'Advanced')));
    $('cz-advanced').hidden = !advanced.length;
    root.append(el('p', { class: 'cz-empty', id: 'cz-empty', hidden: true, text: 'No settings match.' }));
    buildModuleList();
    if (popTitle) { if (cards.some((c) => c.title === popTitle)) openModule(popTitle); else closePop(); }
  }

  /* ---------- module popover + module list ---------- */
  // Every settings group is a "module". Its rows live in a hidden holder; opening a module moves its card into the
  // popover, closing moves it back, so each control (and its state) exists only once.
  let popTitle = null, popAnchor = null;
  const cardOf = (title) => cards.find((c) => c.title === title);
  const hotOf = (t) => (window.CzPreview && CzPreview.hotspot ? CzPreview.hotspot(t) : null);

  function openModule(title, anchorEl) {
    const c = cardOf(title);
    if (!c) return;
    if (popTitle && popTitle !== title) putBack();
    popTitle = title;
    if (anchorEl) popAnchor = anchorEl;
    $('cz-pop-title').textContent = title;
    const d = $('cz-pop-desc'); d.textContent = c.desc || ''; d.hidden = !c.desc;
    $('cz-pop-body').replaceChildren(c.section);
    $('cz-pop').hidden = false;
    $('cz-tip').hidden = true; write('czTipSeen', true);
    closePalette(); closeMenu();
    if (window.CzPreview) { CzPreview.select(title); setTimeout(() => placePop(hotOf(title) || popAnchor), 60); }
    placePop(popAnchor);
    refreshState();
  }
  function putBack() { const c = cardOf(popTitle); if (c) $('cz-groups').append(c.section); }
  function closePop() {
    if (!popTitle) return;
    putBack(); popTitle = null; popAnchor = null; $('cz-pop').hidden = true;
    if (window.CzPreview) CzPreview.select(null);
  }
  // beside the module's box (right, else left, else centred under the bar); phones get a bottom sheet from CSS
  function placePop(anchor) {
    const pop = $('cz-pop');
    if (pop.hidden) return;
    const dock = matchMedia('(max-width: 700px), (max-height: 500px)').matches;
    pop.classList.toggle('cz-pop-dock', dock);
    if (dock) { pop.style.left = pop.style.top = ''; return; }
    const bar = $('cz-toolbar').getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 14, m = 12, top0 = bar.bottom + 10;
    let left, top;
    if (anchor && anchor.isConnected) {
      const r = anchor.getBoundingClientRect();
      left = r.right + gap;
      if (left + pw > innerWidth - m) left = r.left - gap - pw;
      if (left < m) left = Math.min(Math.max(m, r.left + r.width / 2 - pw / 2), innerWidth - pw - m);
      top = Math.min(Math.max(top0, r.top), innerHeight - ph - m);
    } else { left = innerWidth - pw - 16; top = top0; }
    pop.style.left = Math.max(m, left) + 'px'; pop.style.top = Math.max(top0, top) + 'px';
  }

  function buildModuleList() {
    $('cz-mod-list').replaceChildren(...cards.map((c) => {
      const n = el('span', { class: 'cz-mod-n' });
      const btn = el('button', { type: 'button', class: 'cz-mod', onclick: () => openModule(c.title, hotOf(c.title)) },
        el('span', { class: 'cz-tile' }, el('i', { class: 'fas ' + c.icon, 'aria-hidden': 'true' })),
        el('span', { class: 'cz-mod-tx' }, el('b', { text: c.title }), el('small', { text: c.names.length + (c.names.length === 1 ? ' setting' : ' settings') })), n);
      const li = el('li', null, btn);
      c.li = li; c.count = n;
      return li;
    }));
  }

  function openPalette() {
    closeMenu();
    $('cz-palette').hidden = false; $('cz-modules-btn').setAttribute('aria-expanded', 'true');
    $('cz-search').focus();
  }
  function closePalette() { $('cz-palette').hidden = true; $('cz-modules-btn').setAttribute('aria-expanded', 'false'); }
  function openMenu() { closePalette(); $('cz-more').hidden = false; $('cz-more-btn').setAttribute('aria-expanded', 'true'); }
  function closeMenu() { $('cz-more').hidden = true; $('cz-more-btn').setAttribute('aria-expanded', 'false'); }

  // groupOf('$fpscounter_anchor') -> the module title the preview's hotspot opens
  function groupOf(name) {
    if (!defaults) return null;
    const key = name in defaults ? name : name + '|default' in defaults ? name + '|default' : null;
    if (!key || isAdvanced(key)) return null;
    return describe(key).title;
  }

  function card(title, icon, desc, items) {
    const body = el('div', { class: 'cz-rows' }, items.map(([name, info]) => row(name, info, title)));
    const section = el('section', { class: 'cz-card', 'data-title': title.toLowerCase() }, body);
    cards.push({ title, icon, desc, section, body, names: items.map(([n]) => n) });
    return section;
  }
  function resetModule(title) {
    const c = cardOf(title); if (!c) return;
    pushHistory(null);
    c.names.forEach((n) => { delete values[n]; }); write(storeKey(active.pack), values); rebuildInputs(); refreshState();
  }

  function row(name, info, group) {
    const made = makeControl(name, info);
    const dot = el('span', { class: 'cz-dot', title: 'Changed from the default', 'aria-label': 'changed' });
    const text = el('span', { class: 'cz-label-text', text: info.label });
    const reset = el('button', { type: 'button', class: 'cz-btn cz-mini cz-row-reset', title: 'Reset to default', 'aria-label': `Reset ${info.label} to default`,
      onclick: () => setValue(name, defaults[name], false) }, 'Reset');
    const r = el('div', { class: 'cz-row', title: name }, el('label', { class: 'cz-label', for: made.id }, dot, text), made.ctl, reset);
    rows.push({ name, row: r, label: info.label.toLowerCase(), labelText: info.label, text, dot, reset, group: group.toLowerCase(), sync: made.sync });
    return r;
  }

  function rebuildInputs() { rows.forEach((r) => r.sync()); }

  // shows `label` with the search term wrapped in <mark>; plain text when there is no match
  function markText(span, label, q) {
    const i = q ? label.toLowerCase().indexOf(q) : -1;
    if (i < 0) { span.textContent = label; return; }
    span.replaceChildren(label.slice(0, i), el('mark', { class: 'cz-hit', text: label.slice(i, i + q.length) }), label.slice(i + q.length));
  }

  function refreshState() {
    const changed = Object.keys(values).length;
    $('cz-changed').textContent = changed ? `${changed} changed` : 'No changes';
    $('cz-changed').classList.toggle('on', !!changed);
    if (window.CzPreview) CzPreview.update();
    syncHash();
    const q = $('cz-search').value.trim().toLowerCase(), only = onlyChanged;
    rows.forEach((r) => {
      const dirty = r.name in values;
      r.row.classList.toggle('cz-dirty', dirty);
      r.dot.style.display = dirty ? '' : 'none';          // changed-dot and per-setting reset show only when changed
      r.reset.style.display = dirty ? '' : 'none';
      markText(r.text, r.labelText, q);
      const hit = (!q || r.label.includes(q) || r.name.toLowerCase().includes(q) || r.group.includes(q)) && (!only || dirty);
      r.row.classList.toggle('cz-hidden', !hit);
    });
    // the module list shows the modules with a matching setting (or a matching name), with their changed counts
    cards.forEach((c) => {
      const n = c.names.filter((k) => k in values).length;
      if (c.count) { c.count.textContent = n ? n + ' changed' : ''; c.count.hidden = !n; }
      const named = !!q && c.title.toLowerCase().includes(q);
      if (named && !only) rows.forEach((r) => { if (r.group === c.title.toLowerCase()) r.row.classList.remove('cz-hidden'); });
      const hit = !q || named || rows.some((r) => r.group === c.title.toLowerCase() && !r.row.classList.contains('cz-hidden'));
      if (c.li) c.li.hidden = !hit || (only && !n);
    });
    const popReset = $('cz-pop-reset');
    if (popReset && popTitle) { const c = cardOf(popTitle); popReset.disabled = !c || !c.names.some((k) => k in values); }
    let visible = 0;
    document.querySelectorAll('.cz-card').forEach((c) => {
      const any = c.querySelector('.cz-row:not(.cz-hidden)');
      c.classList.toggle('cz-hidden', !any); if (any) visible += 1;
    });
    const empty = $('cz-empty'); if (empty) empty.hidden = visible > 0 || !!document.querySelector('#cz-advanced-grid .cz-row:not(.cz-hidden)');
  }

  /* ---------- import / export / download ---------- */
  const changedOnly = () => Object.fromEntries(Object.entries(values).filter(([k, v]) => k in defaults && !same(v, defaults[k])));

  function save(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* Shareable link: #s=<base64url of the changed settings as JSON>. Kept in sync as the visitor edits. */
  const b64 = {
    enc: (obj) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(obj)), (b) => String.fromCharCode(b)).join(''))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => {
      const std = s.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    },
  };

  function syncHash() {
    try {
      const diff = changedOnly(), parts = [];
      if (active && (active.pack !== packs[0] || active.build !== active.pack.versions[0])) parts.push('p=' + active.pack.id, 'v=' + active.build.version);
      if (Object.keys(diff).length) parts.push('s=' + b64.enc(diff));
      const next = parts.length ? '#' + parts.join('&') : '';
      if (location.hash !== next) history.replaceState(history.state, '', location.pathname + location.search + next);
    } catch (e) { /* sandboxed or file:// page: the link just stays as it is */ }
  }

  const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const isKnown = (k) => Object.prototype.hasOwnProperty.call(defaults, k);

  // Applies only keys that match a setting of the same type; anything else is ignored and counted.
  function applyImported(obj) {
    if (!isPlainObject(obj)) throw new Error('expected a JSON object of settings');
    let n = 0, ignored = 0;
    for (const [k, v] of Object.entries(obj)) {
      const ok = isKnown(k) && typeof v === typeof defaults[k] && Array.isArray(v) === Array.isArray(defaults[k]);
      if (!ok) { ignored += 1; continue; }
      if (same(v, defaults[k])) { delete values[k]; continue; }
      values[k] = v; n += 1;
    }
    write(storeKey(active.pack), values); rebuildInputs(); refreshState();
    const skipped = ignored ? `, ignored ${ignored} unknown or invalid key${ignored === 1 ? '' : 's'}` : '';
    toast(n ? `Imported ${n} setting${n === 1 ? '' : 's'}${skipped}.` : `Nothing to import (no matching settings differ from the defaults${skipped}).`, 5000);
  }

  async function onImport(ev) {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    try {
      if (/\.json$/i.test(file.name)) {
        let obj;
        try { obj = JSON.parse(await file.text()); } catch (e) { throw new Error('that file is not valid JSON'); }
        applyImported(obj); return;
      }
      if (typeof JSZip === 'undefined') throw new Error('the zip reader did not load, check your connection');
      let zip;
      try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error('that is not a .mcpack (zip) file'); }
      if (isManifest()) {
        const entry = zip.file(active.build.manifest || 'manifest.json') || zip.file('manifest.json');
        if (!entry) throw new Error('no manifest.json in that pack');
        const man = JSON.parse(await entry.async('string'));
        applyImported(Object.fromEntries((man.settings || []).filter((x) => x.name && 'default' in x).map((x) => [x.name, x.default])));
        return;
      }
      const entry = zip.file('ui/_global_variables.json');
      if (!entry) throw new Error('no ui/_global_variables.json in that pack');
      applyImported(JSON.parse(await entry.async('string')));
    } catch (e) { toast('Could not import: ' + e.message, 6000); }
  }

  async function download(gateCleared) {
    const { pack, build } = active;
    // the visitor finishes the Linkvertise step first; the build runs when the gate sends them back (see boot)
    if (gateCleared !== true) { startDownloadGate(pack, build); return; }
    const btn = $('cz-download'), idle = btn.innerHTML;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    btn.replaceChildren(el('i', { class: 'fas fa-spinner fa-spin', 'aria-hidden': 'true' }), ' Building pack…');
    try {
      let res;
      try { res = await fetch(build.downloadUrl); }
      catch (e) { throw new Error('network error, the pack could not be fetched'); }
      if (!res.ok) throw new Error('download failed, HTTP ' + res.status);
      let zip;
      try { zip = await JSZip.loadAsync(await res.arrayBuffer()); }
      catch (e) { throw new Error('the downloaded file is not a valid .mcpack'); }
      const diff = changedOnly();               // only touch what the visitor changed; everything else stays as shipped
      if (isManifest()) {
        // pack settings: the changed values become the new defaults, the player can still change them in game
        const path = build.manifest || 'manifest.json', entry = zip.file(path);
        if (!entry) throw new Error('the pack has no manifest.json');
        const man = JSON.parse(await entry.async('string'));
        for (const x of man.settings || []) if (x.name in diff) x.default = diff[x.name];
        zip.file(path, JSON.stringify(man, null, 4));
      } else {
        const entry = zip.file('ui/_global_variables.json');
        if (!entry) throw new Error('the pack has no ui/_global_variables.json');
        const vars = JSON.parse(await entry.async('string'));
        Object.assign(vars, diff);
        vars.$packversion = build.version;   // the version field always matches the pack that is built
        zip.file('ui/_global_variables.json', JSON.stringify(vars, null, 2));
      }
      const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      save(out, build.fileName.replace(/\.mcpack$/i, '') + '_Custom.mcpack');
      toast(`Downloaded your custom ${pack.name}.`);
    } catch (e) {
      toast("Couldn't build the pack (" + e.message + ').', 7000);
    } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = idle; }
  }

  /* ---------- boot ---------- */
  async function boot() {
    const info = $('cz-pack');
    try {
      const [d, m, p] = await Promise.all(['customizer-data.json', 'customizer-meta.json', 'customizer-packs.json'].map((u) => fetch(u, { cache: 'no-cache' })));
      if (!d.ok) throw new Error('customizer-data.json missing');
      data = await d.json(); meta = m.ok ? await m.json() : {};
      packs = p.ok ? ((await p.json()).packs || []) : [];
    } catch (e) {
      info.textContent = 'Could not load the settings (' + e.message + ').'; info.classList.add('cz-error'); return;
    }
    // without customizer-packs.json the customizer still works on the latest Assets Pack alone
    if (!packs.some((p) => p.kind === 'variables')) {
      packs.unshift({ id: 'pepes-assets-pack', name: data.assetsPack.name, kind: 'variables', versions: [{ ...data.assetsPack, variables: data.variables }] });
    }
    collapsedMap = read(COLLAPSE, {}) || {};
    picked = read('czVersions', {}) || {};
    // a version picked before a newer release follows the newest one again
    for (const p of packs) if (picked[p.id] && !p.versions.some((v) => v.version === picked[p.id])) delete picked[p.id];

    const known = read(KNOWN, null), names = Object.keys(data.variables);
    if (known) {
      const fresh = names.filter((n) => !known.includes(n));
      if (fresh.length) {
        const n = $('cz-notice'); n.hidden = false;
        n.textContent = `New in Assets Pack v${data.assetsPack.version}: ${fresh.slice(0, 6).map((f) => humanize(bare(f))).join(', ')}${fresh.length > 6 ? ' and ' + (fresh.length - 6) + ' more' : ''}.`;
      }
    }
    write(KNOWN, names);

    const hash = new URLSearchParams(location.hash.slice(1));
    choosePack(hash.get('p') || read('czPack', packs[0].id), hash.get('v') || undefined);
    const returnedFromGate = takeGateReturn();
    if (hash.get('s')) {
      try { applyImported(b64.dec(hash.get('s'))); }
      catch (e) { toast('That shared link is not valid, so it was ignored.', 6000); }
    }
    if (returnedFromGate) download(true);
    $('cz-toolbar').hidden = false;
    $('cz-tip').hidden = !!read('czTipSeen', false);
    $('cz-search').addEventListener('input', refreshState);
    $('cz-only-wrap').replaceWith(checkbox({ id: 'cz-only-changed', label: 'Only changed', checked: false, onChange: (v) => { onlyChanged = v; refreshState(); } }).root);
    $('cz-undo').addEventListener('click', undo); $('cz-redo').addEventListener('click', redo);
    $('cz-presets-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePresets(); });
    $('cz-reset').addEventListener('click', () => {
      const n = Object.keys(values).length;
      if (!n) { toast('Nothing to reset: every setting is already at its default.'); return; }
      if (!window.confirm(`Reset ${n} changed setting${n === 1 ? '' : 's'} of ${active.pack.name} to their defaults? This cannot be undone.`)) return;
      pushHistory(null);
      values = {}; write(storeKey(active.pack), values); rebuildInputs(); refreshState(); toast('All settings reset.');
    });
    $('cz-import').addEventListener('change', onImport);
    $('cz-export').addEventListener('click', () => {
      save(new Blob([JSON.stringify(changedOnly(), null, 2)], { type: 'application/json' }), active.pack.id + '-v' + active.build.version + '-settings.json');
    });
    $('cz-download').addEventListener('click', () => download());
    $('cz-pop-close').addEventListener('click', closePop);
    $('cz-pop-reset').addEventListener('click', () => popTitle && resetModule(popTitle));
    $('cz-modules-btn').addEventListener('click', () => ($('cz-palette').hidden ? openPalette() : closePalette()));
    $('cz-more-btn').addEventListener('click', () => ($('cz-more').hidden ? openMenu() : closeMenu()));
    $('cz-tooltip-btn').addEventListener('click', () => { const t = $('cz-tt-card'); t.hidden = !t.hidden; closeMenu(); });
    $('cz-more').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName === 'LABEL') { e.preventDefault(); $('cz-import').click(); } });
    $('cz-import').addEventListener('click', () => closeMenu());
    // clicks outside a floating panel close it (its own toggle button and open dropdown lists excluded)
    document.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (!$('cz-more').hidden && !t.closest('#cz-more, #cz-more-btn')) closeMenu();
      if (!$('cz-palette').hidden && !t.closest('#cz-palette, #cz-modules-btn, .cz-dd-list')) closePalette();
    });
    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('cz-open')) return;
      if ((e.ctrlKey || e.metaKey) && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return; }
      }
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        if (!$('cz-more').hidden) closeMenu(); else if (!$('cz-palette').hidden) closePalette(); else if (popTitle) closePop();
      } else if (e.key === '/' && !typing) { e.preventDefault(); openPalette(); }
    });
    window.addEventListener('resize', () => { if (popTitle) placePop(hotOf(popTitle) || popAnchor); });
    // landscape-only on phones: a fullscreen app can lock its orientation (Android Chrome); elsewhere the CSS rotate
    // prompt stays until the phone is turned
    const canLock = !!(screen.orientation && screen.orientation.lock) && !!$('cz-main').requestFullscreen;
    $('cz-rotate-btn').hidden = !canLock;
    $('cz-rotate-btn').addEventListener('click', async () => {
      try { await $('cz-main').requestFullscreen(); await screen.orientation.lock('landscape'); }
      catch (e) { toast('Your browser cannot rotate the page itself: turn your phone sideways.'); }
    });
    refreshState();
    if (window.CzPreview) {
      const value = (n) => (n in allDefaults ? (n in values ? values[n] : allDefaults[n]) : otherValue(n));
      CzPreview.init($('cz-preview'), {
        bar: $('cz-bar-preview'), app: $('cz-main'), tooltip: $('cz-tt-card'), groupOf, openModule,
        get: value, has: (n) => value(n) !== undefined, undo, hint: (m) => (window.toastAction ? window.toastAction(m, 'Undo', undo) : toast(m)), set: (n, v, fromUi) => { if (n in allDefaults) setValue(n, v, !!fromUi); }, names: () => Object.keys(data.variables), meta, dropdown, active: () => active.pack.id,
        // the version chosen for a pack, else its latest; used() tells whether the visitor opened that pack at all
        version: (id) => picked[id] || ((packs.find((p) => p.id === id) || {}).versions || [])[0]?.version || null,
        used: (id) => !!picked[id],
      });
    }
  }

  // The state the Loadout card (loadout-card.js) draws: every module with its anchor, offset and whether it is shown,
  // and which ones the visitor changed.
  window.CzCard = {
    snapshot() {
      if (!active || !defaults) return null;
      const val = (n) => (n in values ? values[n] : allDefaults[n]);
      const keyOf = (n) => (n in allDefaults ? n : (n + '|default' in allDefaults ? n + '|default' : null));
      const mods = [];
      for (const raw of Object.keys(allDefaults)) {
        const m = /^\$(.+?)_anchor(\|default)?$/.exec(raw);
        if (!m) continue;
        const stem = m[1];
        const offName = ['_offset', '_touch_offset', '_mouse_controller_offset'].map((s) => keyOf('$' + stem + s)).find(Boolean);
        const hideName = keyOf('$hide_' + stem);
        const names = Object.keys(allDefaults).filter((n) => n.replace(/^\$/, '').replace(/\|default$/, '').startsWith(stem) || n === hideName);
        const changed = Object.keys(values).some((n) => n === raw || n === hideName || n === offName || n.replace(/^\$/, '').startsWith(stem + '_'));
        mods.push({
          stem, title: groupOf(raw) || humanize(bare(stem)), anchor: String(val(raw)), offset: offName ? val(offName) : [0, 0],
          hidden: hideName ? !!val(hideName) : false, changed, count: names.length,
        });
      }
      const pack = active.pack;
      return { pack: plain(pack.name), version: active.build && active.build.version, mods, changedCount: Object.keys(changedOnly()).length, link: location.href };
    },
  };

  window.CzBoot = boot; // called by script.js the first time the Customizer tab opens
})();
