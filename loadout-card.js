// Loadout card: draws the visitor's customized HUD as a 1200 x 630 image they can save, copy or share
// (see the "III · Loadout card" design board). The picture is drawn here from the customizer's own state
// (window.CzCard.snapshot), so nothing is uploaded and the link in the card reopens the exact settings.
(function () {
  const W = 1200, H = 630;
  const ANCHORS = { top_left: [0, 0], top_middle: [.5, 0], top_right: [1, 0], left_middle: [0, .5], center: [.5, .5], right_middle: [1, .5], bottom_left: [0, 1], bottom_middle: [.5, 1], bottom_right: [1, 1] };
  const FONT = 'Inter, system-ui, sans-serif';
  const opts = { scene: true, hidden: true };
  let root = null, cv = null, snap = null, statusT = 0;

  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };

  function draw() {
    snap = window.CzCard && window.CzCard.snapshot();
    if (!snap) return;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1b2a21'); g.addColorStop(.55, '#1e2124'); g.addColorStop(1, '#26211b');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // header: monogram, pack name, who
    c.fillStyle = '#23262a'; rr(c, 48, 44, 84, 84, 20); c.fill(); c.strokeStyle = '#86d177'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#86d177'; c.font = `700 40px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((snap.pack.replace(/^pepe'?s\s+/i, '')[0] || 'P').toUpperCase(), 90, 88);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff'; c.font = `600 40px ${FONT}`;
    c.fillText(clip(c, snap.pack, opts.scene ? 560 : 1000), 152, 84);
    c.fillStyle = '#b4b8bd'; c.font = `400 20px ${FONT}`;
    c.fillText(`my setup · ${snap.changedCount} setting${snap.changedCount === 1 ? '' : 's'} changed${snap.version ? ` · v${snap.version}` : ''}`, 152, 118);

    // the HUD map: where every module sits on the screen, the changed ones named
    const sx = 700, sy = 44, sw = 452, sh = 254;
    if (opts.scene) {
      const sky = c.createLinearGradient(0, sy, 0, sy + sh); sky.addColorStop(0, '#5b86b3'); sky.addColorStop(.58, '#8fb6d8'); sky.addColorStop(.58, '#5d8a3c'); sky.addColorStop(1, '#46702d');
      c.save(); rr(c, sx, sy, sw, sh, 18); c.clip(); c.fillStyle = sky; c.fillRect(sx, sy, sw, sh);
      const k = sw / 427; // the game's GUI is about 427 units wide at the default scale
      const place = (m) => {
        const [ax, ay] = ANCHORS[m.anchor] || [0, 0];
        const off = Array.isArray(m.offset) ? m.offset : [0, 0];
        return [sx + ax * sw + (+off[0] || 0) * k, sy + ay * sh + (+off[1] || 0) * k, ax, ay];
      };
      const vis = snap.mods.filter((m) => !m.hidden);
      for (const m of vis.filter((m) => !m.changed)) { const [x, y] = place(m); c.fillStyle = 'rgba(0,0,0,.34)'; rr(c, clamp(x - 9, sx + 3, sx + sw - 21), clamp(y - 4, sy + 3, sy + sh - 11), 18, 8, 3); c.fill(); }
      c.font = `600 13px ${FONT}`;
      for (const m of vis.filter((m) => m.changed)) {
        const [x0, y0, ax, ay] = place(m); const w = c.measureText(m.title).width + 18, h = 24;
        const x = clamp(x0 - ax * w, sx + 4, sx + sw - w - 4), y = clamp(y0 - ay * h, sy + 4, sy + sh - h - 4);
        c.fillStyle = 'rgba(31,107,58,.95)'; rr(c, x, y, w, h, 7); c.fill(); c.strokeStyle = '#86d177'; c.lineWidth = 1.5; c.stroke();
        c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(m.title, x + 9, y + h / 2 + 1); c.textBaseline = 'alphabetic';
      }
      // hotbar and crosshair so it reads as a Minecraft screen
      c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(sx + sw / 2 - 91, sy + sh - 22, 182, 20); c.strokeStyle = '#8b8b8b'; c.lineWidth = 2; c.strokeRect(sx + sw / 2 - 91, sy + sh - 22, 182, 20);
      c.fillStyle = 'rgba(255,255,255,.8)'; c.fillRect(sx + sw / 2 - 1, sy + sh / 2 - 7, 2, 14); c.fillRect(sx + sw / 2 - 7, sy + sh / 2 - 1, 14, 2);
      c.restore(); c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1; rr(c, sx + .5, sy + .5, sw - 1, sh - 1, 18); c.stroke();
    }

    // chips: the modules the visitor changed, green when shown, grey when hidden
    const list = snap.mods.filter((m) => m.changed && (opts.hidden || !m.hidden)).slice(0, 10);
    c.font = `600 22px ${FONT}`;
    let x = 48, y = opts.scene ? 330 : 190; const maxX = 1152;
    c.fillStyle = '#b4b8bd'; c.font = `500 18px ${FONT}`; c.fillText(list.length ? 'YOUR CHANGES' : 'NO CHANGES YET', 48, y - 18);
    c.font = `600 22px ${FONT}`;
    for (const m of list) {
      const w = c.measureText(m.title).width + 56;
      if (x + w > maxX) { x = 48; y += 62; }
      c.fillStyle = m.hidden ? '#2b2e33' : '#24412d'; rr(c, x, y, w, 46, 23); c.fill();
      c.fillStyle = m.hidden ? '#4a4d52' : '#86d177'; c.beginPath(); c.arc(x + 22, y + 23, 5, 0, 7); c.fill();
      c.fillStyle = m.hidden ? '#7b7f85' : '#c7f0bd'; c.textBaseline = 'middle'; c.fillText(m.title, x + 38, y + 24); c.textBaseline = 'alphabetic';
      x += w + 12;
    }
    const shown = snap.mods.filter((m) => !m.hidden).length, hid = snap.mods.length - shown;
    c.fillStyle = '#b4b8bd'; c.font = `400 20px ${FONT}`; c.fillText(`${shown} modules shown · ${hid} hidden · ${snap.mods.filter((m) => m.changed).length} moved or tweaked`, 48, H - 86);
    // footer
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(0, H - 64, W, 64);
    c.fillStyle = '#fff'; c.font = `600 22px ${FONT}`; c.fillText('pepe.glacierclient.xyz', 48, H - 24);
    c.textAlign = 'right'; c.fillStyle = '#86d177'; c.fillText('Build yours in the Customizer', W - 48, H - 24); c.textAlign = 'left';
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clip = (c, t, max) => { if (c.measureText(t).width <= max) return t; while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };

  const blob = () => new Promise((res) => cv.toBlob(res, 'image/png'));
  function say(msg) { const s = root.querySelector('.lc-status'); s.textContent = msg; clearTimeout(statusT); statusT = setTimeout(() => { s.textContent = ''; }, 2600); }

  function open() {
    if (!window.CzCard || !window.CzCard.snapshot()) return;
    if (!root) build();
    root.hidden = false; document.documentElement.classList.add('lc-open'); draw();
    root.querySelector('.lc-primary').focus();
  }
  function close() { if (root) { root.hidden = true; document.documentElement.classList.remove('lc-open'); } const b = document.getElementById('cz-more-btn'); if (b) b.focus(); }

  function build() {
    root = document.createElement('div'); root.className = 'lc-wrap'; root.hidden = true;
    const sw = (id, label, on) => `<label class="lc-sw"><span>${label}</span><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i aria-hidden="true"></i></label>`;
    root.innerHTML = `<div class="lc-scrim"></div>
      <div class="lc" role="dialog" aria-modal="true" aria-labelledby="lc-title">
        <div class="lc-main">
          <div class="lc-eyebrow">SHARE</div><h2 id="lc-title">Your loadout, as a card</h2>
          <canvas width="${W}" height="${H}" class="lc-canvas" role="img" aria-label="Preview of your loadout card"></canvas>
          <p class="lc-note">The image is 1200 x 630, the size Discord, X and WhatsApp show as a preview.</p>
        </div>
        <div class="lc-side">
          <button type="button" class="lc-btn lc-primary" data-lc="save"><i class="fas fa-download" aria-hidden="true"></i> Download image</button>
          <button type="button" class="lc-btn" data-lc="copy"><i class="fas fa-image" aria-hidden="true"></i> Copy image</button>
          <button type="button" class="lc-btn" data-lc="link"><i class="fas fa-link" aria-hidden="true"></i> Copy link to this setup</button>
          <p class="lc-info">Anyone who opens the link lands in the Customizer with your exact settings loaded. To use them they download the pack from its page.</p>
          <div class="lc-opt">Show on the card</div>
          ${sw('lc-scene', 'HUD layout map', true)}${sw('lc-hid', 'Hidden modules', true)}
          <div class="lc-status" role="status" aria-live="polite"></div>
          <button type="button" class="lc-btn lc-close" data-lc="close">Close</button>
        </div>
      </div>`;
    document.body.append(root); cv = root.querySelector('canvas');
    root.querySelector('.lc-scrim').addEventListener('click', close);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    root.querySelector('#lc-scene').addEventListener('change', (e) => { opts.scene = e.target.checked; draw(); });
    root.querySelector('#lc-hid').addEventListener('change', (e) => { opts.hidden = e.target.checked; draw(); });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lc]'); if (!b) return;
      const act = b.dataset.lc;
      if (act === 'close') close();
      if (act === 'save') {
        const f = await blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(f);
        a.download = `${(snap.pack || 'loadout').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-loadout.png`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); say('Image saved.');
      }
      if (act === 'copy') {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]); say('Image copied. Paste it into Discord or a post.'); }
        catch (err) { say('This browser cannot copy images, use Download instead.'); }
      }
      if (act === 'link') {
        try { await navigator.clipboard.writeText(location.href); say('Link copied.'); } catch (err) { say('Copy it from the address bar.'); }
      }
    });
  }
  const hook = () => { const b = document.getElementById('cz-card-btn'); if (b) b.addEventListener('click', () => { const m = document.getElementById('cz-more'); if (m) m.hidden = true; open(); }); };
  hook();
  window.CzLoadoutCard = { open, close };
})();
