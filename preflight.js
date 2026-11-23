// Pre-flight check for the upload page (see the "II · Pre-flight check" design board).
// Opens the chosen .mcpack in the browser (nothing is uploaded), checks the manifest, the JSON UI files
// and the textures they point to, and shows the result before the user fills in the details.
(function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  let zipLoading = null;
  const loadZip = () => {
    if (window.JSZip) return Promise.resolve();
    if (!zipLoading) zipLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = JSZIP; s.onload = res; s.onerror = () => { zipLoading = null; rej(new Error('The zip reader did not load, check your connection.')); }; document.head.append(s); });
    return zipLoading;
  };

  // Minecraft's JSON UI files may hold // and /* */ comments; remove them but keep every newline so line numbers stay true.
  function stripComments(src) {
    let out = '', i = 0, str = false;
    while (i < src.length) {
      const c = src[i], n = src[i + 1];
      if (str) { out += c; if (c === '\\') { out += n || ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
      if (c === '"') { str = true; out += c; i++; continue; }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
      out += c; i++;
    }
    return out.replace(/^﻿/, '');
  }
  function parseJson(text) {
    const clean = stripComments(text);
    try { return { ok: true, value: JSON.parse(clean) }; } catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const line = m ? clean.slice(0, +m[1]).split('\n').length : null;
      return { ok: false, line, message: e.message.replace(/ in JSON at position \d+.*$/, '').replace(/^JSON\.parse: /, '') };
    }
  }

  async function analyse(file) {
    const checks = [], tree = { rows: [] };
    const add = (state, title, sub) => checks.push({ state, title, sub });
    const out = { checks, tree: tree.rows, manifest: null, name: '', version: '', description: '', blocking: false };
    if (file.size > 50 * 1024 * 1024) add('fail', 'File is too big', `${fmt(file.size)}, the limit is 50 MB.`);
    await loadZip();
    let zip;
    try { zip = await JSZip.loadAsync(file); } catch (e) {
      add('fail', 'This is not a readable pack', 'The file is not a valid zip archive. Export it again from your editor or zip the pack folder.');
      out.blocking = true; return out;
    }
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/(^|\/)(__MACOSX\/|\.DS_Store|Thumbs\.db)/.test(n));
    // .mcaddon holds several packs in sub-folders; .mcpack has the manifest at the root, or one folder down
    const manifests = names.filter((n) => /(^|\/)manifest\.json$/.test(n)).sort((a, b) => a.split('/').length - b.split('/').length);
    if (!manifests.length) {
      add('fail', 'manifest.json not found', 'Every pack needs a manifest.json in its root folder. Minecraft will not import the file without it.');
      out.blocking = true; return out;
    }
    const base = manifests[0].replace(/manifest\.json$/, '');
    const inPack = names.filter((n) => n.startsWith(base));
    const rel = (n) => n.slice(base.length);
    const mt = parseJson(await zip.file(manifests[0]).async('string'));
    if (!mt.ok) {
      add('fail', 'manifest.json has a syntax error', `${mt.message}${mt.line ? ` (line ${mt.line})` : ''}. Open it in a JSON validator and fix the error.`);
      out.blocking = true;
    } else {
      const m = mt.value || {}, h = m.header || {}, mods = Array.isArray(m.modules) ? m.modules : [];
      out.manifest = m;
      const missing = [];
      if (m.format_version == null) missing.push('format_version');
      if (!h.uuid) missing.push('header.uuid');
      if (!Array.isArray(h.version)) missing.push('header.version');
      if (!mods.length) missing.push('modules');
      if (missing.length) { add('fail', 'Manifest is missing required parts', `Add: ${missing.join(', ')}.`); out.blocking = true; }
      else add('ok', 'Manifest is valid', `format_version ${m.format_version}, header and ${mods.length} module${mods.length === 1 ? '' : 's'} found${manifests.length > 1 ? `. This file holds ${manifests.length} packs, checking the first.` : '.'}`);
      const ids = [h.uuid, ...mods.map((x) => x && x.uuid)].filter(Boolean);
      if (!missing.includes('header.uuid')) {
        if (new Set(ids).size !== ids.length) add('warn', 'Header and module share a UUID', 'Each of them needs its own UUID or Minecraft may refuse to import the pack.');
        else add('ok', 'UUIDs are unique', 'Header and module UUIDs all differ.');
      }
      if (Array.isArray(h.version)) {
        const v = h.version.join('.');
        const eng = Array.isArray(h.min_engine_version) ? ` · min_engine_version ${h.min_engine_version.join('.')}` : '';
        add(h.version.length === 3 && h.version.every((x) => Number.isInteger(x)) ? 'ok' : 'warn', 'Version looks right', `${v}${eng}`);
        out.version = v;
      }
      const loc = (t) => (typeof t === 'string' && t && !/^[\w.]+$/.test(t.split(' ')[0]) ? t : (typeof t === 'string' && /\s/.test(t) ? t : ''));
      out.name = loc(h.name); out.description = loc(h.description);
    }

    // JSON UI files
    const uiFiles = inPack.filter((n) => /^ui\/.+\.json$/i.test(rel(n)));
    const bad = [], textures = new Set(), unresolved = new Set();
    const have = new Set(names.map((n) => n.replace(/\.(png|tga|jpg|jpeg)$/i, '').toLowerCase()));
    let replacesHud = false;
    const status = new Map();
    for (const n of uiFiles) {
      const text = await zip.file(n).async('string');
      const r = parseJson(text);
      if (!r.ok) { bad.push({ n: rel(n), ...r }); status.set(n, ['bad', r.line ? `syntax error, line ${r.line}` : 'syntax error']); continue; }
      status.set(n, ['ok', 'ok']);
      const re = /"texture"\s*:\s*"([^"]+)"/g; let t;
      while ((t = re.exec(text))) { if (/^textures\//.test(t[1])) { textures.add(t[1]); if (!have.has((base + t[1]).toLowerCase()) && !have.has(t[1].toLowerCase())) unresolved.add(t[1]); } }
      if (/(^|\/)hud_screen\.json$/i.test(n) && r.value && typeof r.value === 'object' && 'hud_screen' in r.value && !/"modifications"\s*:/.test(text)) {
        replacesHud = true; status.set(n, ['warn', 'replaces whole screen']);
      }
    }
    if (uiFiles.length) {
      if (bad.length) add('fail', `${bad.length} UI file${bad.length === 1 ? '' : 's'} will not load`, bad.slice(0, 3).map((b) => `${b.n}${b.line ? ` line ${b.line}` : ''}: ${b.message}`).join(' · '));
      else add('ok', `All ${uiFiles.length} JSON UI files parse`, 'No trailing commas, stray characters or broken strings.');
      if (textures.size) add(unresolved.size ? 'warn' : 'ok', unresolved.size ? `${unresolved.size} texture${unresolved.size === 1 ? '' : 's'} not found` : 'Every texture a file points to exists', unresolved.size ? `Missing: ${[...unresolved].slice(0, 3).join(', ')}${unresolved.size > 3 ? '…' : ''}` : `${textures.size} of ${textures.size} references resolved.`);
      if (replacesHud) add('warn', 'hud_screen.json replaces the whole screen', 'Other HUD packs lose their changes when this one is active. Use "modifications" on the existing screen so packs can stack.');
    }
    if (bad.length) out.blocking = true;
    const icon = inPack.some((n) => /^pack_icon\.(png|jpg|jpeg)$/i.test(rel(n)));
    add(icon ? 'ok' : 'warn', icon ? 'Pack icon found' : 'Pack icon is missing', icon ? 'pack_icon.png is in the root folder.' : 'Add pack_icon.png (256 x 256 recommended) in the pack root. Without it the pack shows a blank square in Minecraft. You can also choose an icon on this page.');
    if (file.size <= 50 * 1024 * 1024) add('ok', 'Size is fine', `${fmt(file.size)}, limit 50 MB.`);

    // file tree: root files, then the folders with counts, with UI files listed
    const row = (indent, icon, name, meta, cls) => ({ indent, icon, name, meta, cls: cls || '' });
    tree.rows.push(row(0, '▾', file.name, fmt(file.size)));
    const rootFiles = inPack.filter((n) => !rel(n).includes('/'));
    for (const n of rootFiles.slice(0, 6)) {
      const nm = rel(n);
      tree.rows.push(row(1, nm.endsWith('.png') ? '▣' : '▤', nm, nm === 'manifest.json' ? (mt.ok ? 'valid' : 'error') : '', nm === 'manifest.json' && !mt.ok ? 'fail' : ''));
    }
    if (!icon) tree.rows.push(row(1, '▣', 'pack_icon.png', 'missing', 'warn'));
    const dirs = new Map();
    for (const n of inPack) { const r = rel(n); if (r.includes('/')) { const d = r.split('/')[0]; dirs.set(d, (dirs.get(d) || 0) + 1); } }
    for (const [d, c] of [...dirs.entries()].sort((a, b) => (a[0] === 'ui' ? -1 : b[0] === 'ui' ? 1 : a[0].localeCompare(b[0]))).slice(0, 8)) {
      tree.rows.push(row(1, d === 'ui' ? '▾' : '▸', `${d}/`, `${c} file${c === 1 ? '' : 's'}`));
      if (d === 'ui') for (const n of uiFiles.slice(0, 7)) {
        const [st, msg] = status.get(n) || ['ok', ''];
        tree.rows.push(row(2, '{}', rel(n).slice(3), msg, st === 'bad' ? 'fail' : st === 'warn' ? 'warn' : ''));
      }
      if (d === 'ui' && uiFiles.length > 7) tree.rows.push(row(2, '', `+ ${uiFiles.length - 7} more`, ''));
    }
    // worst first, like the board
    const rank = { fail: 0, warn: 1, ok: 2 };
    checks.sort((a, b) => rank[a.state] - rank[b.state]);
    out.blocking = out.blocking || checks.some((c) => c.state === 'fail');
    return out;
  }

  // Shows the dialog; resolves { go: true, info } to continue or { go: false } to pick another file.
  function show(file, info) {
    return new Promise((resolve) => {
      const n = (s) => info.checks.filter((c) => c.state === s).length;
      const mark = { ok: '✓', warn: '!', fail: '×' };
      const root = document.createElement('div');
      root.className = 'pf-wrap';
      const filled = [info.name && 'name', info.version && 'version'].filter(Boolean);
      root.innerHTML = `<div class="pf-scrim"></div>
        <div class="pf" role="dialog" aria-modal="true" aria-labelledby="pf-title">
          <div class="pf-head"><div><span class="pf-eyebrow">PRE-FLIGHT CHECK</span><h2 id="pf-title">We checked your file before anyone else does</h2></div><button type="button" class="pf-x" aria-label="Close" data-pf="again">×</button></div>
          <div class="pf-sum">
            <span class="pf-chip ok">${n('ok')} passed</span>${n('warn') ? `<span class="pf-chip warn">${n('warn')} warning${n('warn') === 1 ? '' : 's'}</span>` : ''}${n('fail') ? `<span class="pf-chip fail">${n('fail')} to fix before upload</span>` : ''}
            <span class="pf-note">Checked in your browser. The file has not been uploaded yet.</span>
          </div>
          <div class="pf-body">
            <div class="pf-tree"><div class="pf-tree-h">What is inside</div>${info.tree.map((r) => `<div class="pf-row ${r.cls}" style="padding-left:${12 + r.indent * 18}px"><span class="pf-ic">${esc(r.icon)}</span><span class="pf-nm">${esc(r.name)}</span><span class="pf-mt">${esc(r.meta)}</span></div>`).join('')}</div>
            <div class="pf-checks">${info.checks.map((c) => `<div class="pf-check ${c.state}"><span class="pf-mk">${mark[c.state]}</span><div><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></div></div>`).join('')}</div>
          </div>
          <div class="pf-foot"><span class="pf-fill">${info.blocking ? 'Fix the problems above, then choose the file again.' : filled.length ? `Name${filled.length > 1 ? ' and version are' : ' is'} filled in from your manifest.` : ''}</span>
            <button type="button" class="pf-btn" data-pf="again">Choose another file</button>
            <button type="button" class="pf-btn pf-go" data-pf="go" ${info.blocking ? 'disabled' : ''}>Continue</button></div>
        </div>`;
      const prev = document.activeElement;
      const done = (go) => { document.removeEventListener('keydown', onKey); root.remove(); document.documentElement.classList.remove('pf-open'); if (prev && prev.focus) prev.focus(); resolve({ go, info }); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      root.addEventListener('click', (e) => { const b = e.target.closest('[data-pf]'); if (b && !b.disabled) done(b.dataset.pf === 'go'); if (e.target.classList.contains('pf-scrim')) done(false); });
      document.addEventListener('keydown', onKey);
      document.body.append(root); document.documentElement.classList.add('pf-open');
      (root.querySelector('.pf-go:not([disabled])') || root.querySelector('.pf-btn')).focus();
    });
  }

  window.packPreflight = {
    async run(file) {
      let info;
      try { info = await analyse(file); } catch (e) { return { go: true, info: null, error: e.message }; }
      return show(file, info);
    },
    analyse, stripComments
  };
})();
