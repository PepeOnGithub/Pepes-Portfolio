/* HUD preview for the Assets Pack customizer, drawn with real textures: vanilla Bedrock textures (assets/mc/ui__*,
   items__*, blocks__*) and the Assets Pack's own digit / compass textures (assets/mc/pepe__*).
   Every Pepe module is laid out from its pack's hud_screen.json (box sizes, anchors, label offsets, textures); the parts
   the game draws with the player entity (digits, compass tape) use the same textures at the placement the pack aims for.
   It reads settings through api.get(name), so it follows every change live. Modules without a drawing here still appear
   as labelled boxes at their anchor / offset, so newly added Assets Pack variables show up without changes. */
(function () {
  'use strict';

  const T = (name) => `assets/mc/${name}`;
  const ASPECT = { pc: [427, 240], mobile: [667, 300] };       // stage proportions (PC 16:9, phone landscape)
  const ANCHOR = { top_left: [0, 0], top_middle: [0.5, 0], top_right: [1, 0], left_middle: [0, 0.5], center: [0.5, 0.5],
    right_middle: [1, 0.5], bottom_left: [0, 1], bottom_middle: [0.5, 1], bottom_right: [1, 1] };
  const STORE = 'czPreview';

  // what can be held; hunger / saturation as in the game, effect for stews and potions
  const ITEMS = [
    { id: 'apple', name: 'Apple', icon: 'items__apple.png', hunger: 4, sat: 2.4, eat: '1.6' },
    { id: 'golden_apple', name: 'Golden Apple', icon: 'items__apple_golden.png', hunger: 4, sat: 9.6, eat: '1.6', fx: ['a', 'Regeneration II 0:05, Absorption I 2:00'] },
    { id: 'cooked_beef', name: 'Steak', icon: 'items__beef_cooked.png', hunger: 8, sat: 12.8, eat: '1.6' },
    { id: 'bread', name: 'Bread', icon: 'items__bread.png', hunger: 5, sat: 6, eat: '1.6' },
    { id: 'stew', name: 'Suspicious Stew', icon: 'items__suspicious_stew.png', hunger: 6, sat: 7.2, eat: '1.6',
      effect: { icon: 'ui__night_vision_effect.png', name: 'Night Vision', col: '#55ff55', time: '0:05', ing: 'Poppy, Torchflower' } },
    { id: 'potion', name: 'Potion of Swiftness', icon: 'items__potion_bottle_drinkable.png',
      effect: { icon: 'ui__speed_effect.png', name: 'Speed', col: '#55ff55', time: '3:00' } },
    { id: 'sword', name: 'Diamond Sword', icon: 'items__diamond_sword.png' },
  ];
  const HOTBAR = ['sword', 'apple', 'golden_apple', 'cooked_beef', 'bread', 'stew', 'potion', 'bucket_milk', 'compass'];
  const EXTRA = { bucket_milk: 'items__bucket_milk.png', compass: 'items__compass_item.png' };
  const GLYPHS = '0123456789/%';                                // pepe__ah_digits.png: 12 glyphs, 6x8 each
  const PLAYER = [12, 64, -30];                                 // sample player position feeding every coordinate readout
  const DEATH = [-37, 70, 10];                                  // sample death position for Death coordinates

  let api, root, stage, screen, ttEl, platform = 'pc', held = 'apple', yaw = 0, gui = 3;
  // the Mobile view shows the PC variant of the HUD (desktop flags, mouse offsets, no touch controls); only the stage shape differs
  const PC_VARIANT = true;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  if (saved.platform in ASPECT) platform = saved.platform;
  if (ITEMS.some((i) => i.id === saved.held)) held = saved.held;
  if (typeof saved.yaw === 'number') yaw = saved.yaw;
  if ([1, 2, 3].includes(saved.gui)) gui = saved.gui;

  const get = (name, fallback) => (api.has(name) ? api.get(name) : fallback);
  // the pack picked in the customizer; modules of that pack get a pulsing outline (mark) so the preview follows it
  const sel = () => (api && api.active ? api.active() : null);
  const mark = (node, pack) => { if (pack && sel() === pack) node.classList.add('cz-own'); return node; };
  const humanize = (s) => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  const f2 = (n) => String(n);

  function div(cls, css, ...kids) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (css) Object.assign(d.style, css);
    for (const k of kids.flat()) if (k != null) d.append(k.nodeType ? k : document.createTextNode(k));
    return d;
  }
  const imgCache = new Map();                                   // url -> preloaded Image, so re-renders reuse decoded bitmaps
  function img(file, w, h, css) {
    const src = T(file);
    if (!imgCache.has(src)) { const p = new Image(); p.src = src; imgCache.set(src, p); }
    const i = document.createElement('img');
    i.decoding = 'sync'; i.src = src;              // sync: live digits swapped every 400ms must never flash blank
    i.width = w; i.height = h; i.alt = ''; i.draggable = false; i.className = 'cz-px';
    if (css) Object.assign(i.style, css);
    return i;
  }
  const abs = (node, x, y) => { node.style.position = 'absolute'; node.style.left = x + 'px'; node.style.top = y + 'px'; return node; };
  const sprite = (file, x, y, w, h) => abs(img(file, w, h), x, y);
  const text = (str, x, y, css) => abs(div('cz-t', css, str), x, y);
  function place(node, anchor, off) {
    const [ax, ay] = ANCHOR[anchor] || ANCHOR.top_left;
    const [ox, oy] = off || [0, 0];
    node.style.position = 'absolute';
    node.style.left = ax * 100 + '%'; node.style.top = ay * 100 + '%';
    node.style.transform = `translate(calc(${-ax * 100}% + ${ox}px), calc(${-ay * 100}% + ${oy}px))`;
    return node;
  }
  // box with the hud_tip_text_background nine-slice; alpha only applies to the background, like the game
  function tip(alpha, w, h, ...kids) {
    const b = div('cz-tip' + (w == null ? '' : ' cz-tipfix'), { width: w == null ? 'max-content' : w + 'px', height: h == null ? 'auto' : h + 'px' }, ...kids);
    b.style.setProperty('--a', alpha);
    return b;
  }
  const black = (alpha, ...kids) => { const b = div('cz-black', null, ...kids); b.style.setProperty('--a', alpha); return b; };
  // glyph digits from the Assets Pack (6x8 per glyph)
  function digits(str, x, y, scale) {
    const row = div('cz-dg', { height: 8 * (scale || 1) + 'px' });
    for (const ch of str) {
      const i = GLYPHS.indexOf(ch);
      if (i < 0) { row.append(div(null, { width: ch === '-' ? '4px' : '3px', height: '8px', position: 'relative' },
        ch === '-' ? div(null, { position: 'absolute', left: '0', top: '4px', width: '3px', height: '1px', background: '#fff' }) : null)); continue; }
      row.append(div('cz-g', { backgroundImage: `url(${T('pepe__ah_digits.png')})`, backgroundPosition: `-${i * 6}px 0` }));
    }
    return x == null ? row : abs(row, x, y);
  }
  function shanks(value, kind) {
    const full = Math.floor(value / 2), half = value - full * 2 > 0.01;
    const row = div('cz-shanks');
    if (half) row.append(img(`pepe__food_${kind}_half.png`, 9, 9));
    for (let i = 0; i < full; i += 1) row.append(img(`pepe__food_${kind}.png`, 9, 9));
    return row;
  }
  const foodRow = (it) => div('cz-foodrow', null,
    shanks(it.sat, 'saturation'), div('cz-num', null, f2(it.sat)), div('cz-sep', null, '|'), shanks(it.hunger, 'hunger'), div('cz-num', null, f2(it.hunger)));
  const heldItem = () => ITEMS.find((i) => i.id === held) || ITEMS[0];
  // item durability bar as in the game: 13px wide at the remaining fraction, colour from hue 0 (empty, red) to 1/3 (full, green)
  const durColor = (f) => {
    const h = Math.max(0, Math.min(1, f)) / 3, k = (n) => { const x = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(x, 4 - x, 1)); };
    return `rgb(${Math.round(k(5) * 255)},${Math.round(k(3) * 255)},${Math.round(k(1) * 255)})`;
  };
  const durBar = (f, x, y) => [
    abs(div(null, { width: '13px', height: '2px', background: '#000' }), x, y),
    abs(div(null, { width: Math.max(1, Math.round(13 * f)) + 'px', height: '1px', background: durColor(f) }), x, y)];

  /* ---------- scene + vanilla HUD ---------- */
  function drawScene(w, h) {
    screen.append(div('cz-sky', null), div('cz-ground', { top: Math.round(h * 0.56) + 'px' }));
  }

  function drawVanillaHud(w, h) {
    const bar = place(div('cz-bar', { width: '182px', height: '22px' }), 'bottom_middle', [0, 0]);
    bar.append(img('ui__hotbar_start_cap.png', 1, 22, { left: 0 }));
    for (let i = 0; i < 9; i += 1) bar.append(img(`ui__hotbar_${i}.png`, 20, 22, { left: 1 + i * 20 + 'px' }));
    bar.append(img('ui__hotbar_end_cap.png', 1, 22, { left: '181px' }));
    const selIdx = Math.max(0, HOTBAR.indexOf(held));
    const iconSize = get('$food_stats_corner_icon_size', [9, 9]);
    const iconOff = get('$food_stats_corner_icon_offset', [-1, 1]);
    HOTBAR.forEach((id, i) => {
      const it = ITEMS.find((x) => x.id === id);
      bar.append(img(it ? it.icon : EXTRA[id], 16, 16, { left: 3 + i * 20 + 'px', top: '3px' }));
      if (it && it.effect && !get('$hide_food_stats_corner_icons', false)) {
        const [sw, sh] = Array.isArray(iconSize) ? iconSize : [9, 9];
        bar.append(img(it.effect.icon, sw, sh, { left: 1 + i * 20 + 20 - sw + (iconOff[0] || 0) + 'px', top: (iconOff[1] || 0) + 'px', zIndex: 3 }));
      }
    });
    bar.append(img('ui__selected_hotbar_slot.png', 24, 24, { left: selIdx * 20 - 1 + 'px', top: '-1px', zIndex: 2 }));
    screen.append(bar);

    // XP bar 182x5 sits 2px above the hotbar (bottom edge 24px up); the green fill is clipped to 42.3% (77px)
    const xp = place(div('cz-xp', { width: '182px', height: '5px' }), 'bottom_middle', [0, -24]);
    const xpFill = div(null, { position: 'absolute', left: '0', top: '0', width: '77px', height: '5px', overflow: 'hidden' },
      img('ui__experiencebarfull.png', 182, 5, { position: 'absolute', left: 0, top: 0 }));
    xp.append(img('ui__experiencebarempty.png', 182, 5), xpFill);
    screen.append(xp, place(div('cz-lvl', null, '30'), 'bottom_middle', [0, -29]));

    const cx = w / 2;
    const row = (n, y, side, bg, fg, half) => {
      for (let i = 0; i < 10; i += 1) {
        const x = side === 'l' ? cx - 91 + i * 8 : cx + 91 - 9 - i * 8;
        const wrap = div('cz-abs', { left: x + 'px', bottom: y + 'px', width: '9px', height: '9px' });
        wrap.append(img(bg, 9, 9));
        if (i < n) wrap.append(img(fg, 9, 9, { position: 'absolute', left: 0, top: 0 }));
        else if (half && i === n) wrap.append(img(half, 9, 9, { position: 'absolute', left: 0, top: 0 }));
        screen.append(wrap);
      }
    };
    // icon rows: 9px icons on an 8px step, bottoms 30px (hearts/hunger) and 40px (armor) above the screen bottom
    row(10, 30, 'l', 'ui__heart_background.png', 'ui__heart.png');
    row(8, 40, 'l', 'ui__armor_empty.png', 'ui__armor_full.png');
    row(8, 30, 'r', 'ui__hunger_background.png', 'ui__hunger_full.png', 'ui__hunger_half.png');
    screen.append(place(div('cz-cross', null, div('cz-ch-h'), div('cz-ch-v')), 'center'));
  }

  function drawItemPopup() {
    const it = heldItem();
    const stack = place(div('cz-popup'), 'bottom_middle', [0, -61]);
    stack.append(div('cz-name', null, it.name));
    if (it.hunger != null && !get('$hide_food_stats_box', false)) {
      const off = get('$food_stats_box_offset', [0, 0]);
      const box = tip(get('$food_stats_box_opacity', 0.6), null, null, foodRow(it));
      box.style.marginTop = '3px'; box.style.transform = `translate(${off[0] || 0}px, ${off[1] || 0}px)`;
      stack.append(box);
    }
    screen.append(stack);
    if (it.effect && !get('$hide_food_stats_effects', false)) {
      const e = it.effect, off = get('$food_stats_effects_offset', [0, 16]);
      const box = tip(get('$food_stats_effects_opacity', 0.6), null, null, div('cz-fxrow', null, img(e.icon, 12, 12), div('cz-fxname', { color: e.col }, e.name)));
      screen.append(place(box, 'center', off));
    }
  }

  /* ---------- Pepe modules, laid out from each pack's hud_screen.json ---------- */
  // each returns {node, anchorDefault} ; placement (anchor / offset / opacity / hide) is applied by the caller
  // live readouts: the FPS and speed boxes redraw only their own digit nodes (data-live) from tickLive()
  const live = { fps: 120, speed: 8.52 };
  const lv = (name, css, ...kids) => { const d = div(null, css, ...kids); d.dataset.live = name; return d; };
  const fpsGlyphs = (fps) => {
    const d = [Math.floor(fps / 100), Math.floor((fps % 100) / 10), fps % 10];
    return d.map((v, i) => (i === 0 && fps < 100 ? null : img(`pepe__num_${i + 1}_${v}.png`, 36 * 1.12, 7 * 1.12, { position: 'absolute', left: '26px', top: '5px' })))
      .filter(Boolean);
  };
  const speedGlyphs = (spd) => [...spd.toFixed(2)].map((ch) => img(ch === '.' ? 'pepe__sp_pt.png' : `pepe__sp_${ch}.png`, 6, 8));
  function tickLive() {
    // Skip work while the tab is hidden or the customizer page isn't shown.
    if (!screen || document.hidden || !screen.isConnected || !screen.offsetParent || blocked()) return;
    live.fps = Math.min(144, Math.max(60, live.fps + Math.round((Math.random() - 0.5) * 12)));
    live.speed = Math.min(25, Math.max(0, live.speed + (Math.random() - 0.5) * 0.8));
    screen.querySelectorAll('[data-live="fps"]').forEach((n) => n.replaceChildren(...fpsGlyphs(live.fps)));
    screen.querySelectorAll('[data-live="speed"]').forEach((n) => n.replaceChildren(...speedGlyphs(live.speed)));
  }

  // ArmorHUD sample: the four netherite pieces as [slot, texture, durability fraction], their max durability, and the
  // pieces the pack's show_* settings keep (reversed on reverse). Shared by the v1 (entity) and v2 (manifest) drawings.
  const ARMOR_MAX = { helmet: 407, chest: 592, legs: 555, boots: 481 };
  function armorParts(s) {
    const parts = [['helmet', 'items__netherite_helmet.png', 0.92], ['chest', 'items__netherite_chestplate.png', 0.71],
      ['legs', 'items__netherite_leggings.png', 0.48], ['boots', 'items__netherite_boots.png', 0.16]]
      .filter(([k]) => s('show_' + k, true));
    return s('reverse', false) ? parts.reverse() : parts;
  }

  const MODULES = {
    // DirectionHUD: 138x16 box. The pack's north face is a 128x12 window of the 192x14 compass tape at uv (20,1)
    // (192 texels = 360 degrees, yaw 0 = south); uv_anim scrolls it by (90 + yaw) / 360 of the texture width.
    // Texels map 1:1 to world units (26.6 units wide, 2.5 tall), so one scale k is used on both axes.
    directionhud: (o) => {
      const k = 136 / 128, u0 = (20 + 192 * ((90 + yaw) / 360)) % 192;
      const h = 12 * k;
      const tape = div(null, { position: 'absolute', left: '1px', top: (16 - h) / 2 + 'px', width: 128 * k + 'px', height: h + 'px', imageRendering: 'pixelated',
        backgroundImage: `url(${T('pepe__directionhud.png')})`, backgroundRepeat: 'repeat-x',
        backgroundSize: `${192 * k}px ${14 * k}px`, backgroundPosition: `${-u0 * k}px ${-1 * k}px` });
      return tip(o.alpha, 138, 16, tape);
    },
    // FPS counter: 50x18 box, the label "Fps:" at x=2 and three digits (textures numbers/1_d, 2_d, 3_d layered, 36x7 each)
    fpscounter: (o) => {
      const nodes = [text('Fps:', 2, 4), lv('fps', { position: 'absolute', left: '0px', top: '0px', width: '50px', height: '18px' }, fpsGlyphs(live.fps))];
      return tip(o.alpha, 50, 18, ...nodes);
    },
    // Force / Death coordinates: 55x35 box, labels X: Y: Z: (stack, offset [2,0] left_middle) and the numbers on the right
    forcecoords: (o) => coordsBox(o, PLAYER),
    deathcoords: (o) => coordsBox(o, DEATH),
    // Level calculator: xp bottle, "points/needed", " | ", level; box 21px tall
    // Pack: hud_tip_text_background at alpha 0.6, 21px tall, 3px side padding; row of bottle (14px, 2.5px down), 2px gap,
    // points/needed in §z green, " | " and the level in white (labels are 9px rows centred in the 21px box)
    level_calculator: () => {
      const row = div(null, { display: 'flex', alignItems: 'flex-start', height: '21px', width: 'max-content' },
        img('items__experience_bottle.png', 14, 14, { marginTop: '6px', flex: 'none' }),
        div(null, { width: '2px', flex: 'none' }),
        div('cz-t', { color: '#80ff20', marginTop: '7.5px' }, '47/112'),
        div('cz-t', { color: '#fff', marginTop: '7.5px' }, ' | '),
        div('cz-t', { color: '#fff', marginTop: '7.5px' }, '30'));
      const box = tip(0.6, null, 21, row);
      box.style.paddingLeft = '3px'; box.style.paddingRight = '3px';
      return box;
    },
    // Clock and compass: three 15x15 item icons (compass, clock, recovery compass) in a 16px tall box, 2px gaps
    clockcompass: (o) => {
      const icon = (file, x, atlas) => abs(div(null, { width: '15px', height: '15px', backgroundImage: `url(${T(file)})`, backgroundRepeat: 'no-repeat',
        backgroundSize: atlas ? '15px auto' : '15px 15px', backgroundPosition: '0 0', imageRendering: 'pixelated' }), x, 0.5);
      const inner = div(null, { position: 'relative', width: '49px', height: '16px' },
        icon('items__compass_item.png', 0), icon('items__clock_item.png', 17), icon('items__recovery_compass_atlas.png', 34, true));
      const box = tip(o.alpha, null, 16, inner);
      box.style.paddingLeft = '2px'; box.style.paddingRight = '2px';
      return box;
    },
    // Speedometer: 56x14 box; digits sp_0..9 (6x8), point, unit texture (24x8, "m/s"); leading zeros hidden
    speedometer: (o) => {
      const row = div(null, { display: 'flex', alignItems: 'flex-end', height: '8px', position: 'absolute', left: '0', right: '0', top: '3px', justifyContent: 'center', gap: '0' });
      row.append(lv('speed', { display: 'flex', alignItems: 'flex-end' }, speedGlyphs(live.speed)), div(null, { width: '3px' }), img('pepe__u_ms.png', 24, 8));
      return tip(o.alpha, 56, 14, row);
    },
    // Inventory HUD: 162x54, 9 columns of 18x18 cells (slot texture 17x17 + 12x12 item), the three inventory rows.
    // Cells are [item, stack count, durability fraction]; the sample fills a few slots with real icons, counts and damaged tools
    inventoryhud: () => {
      const grid = div(null, { position: 'relative', width: '162px', height: '54px' });
      const cells = [
        ['items__netherite_sword.png', 1, 0.62], null, ['items__apple.png', 12], ['items__arrow.png', 47], null, ['items__ender_pearl.png', 16], ['items__stick.png', 3], null, ['items__apple_golden.png', 2],
        ['items__bread.png', 20], null, ['items__iron_pickaxe.png', 1, 0.3], ['items__beef_cooked.png', 8], null, null, ['items__stick.png', 64], ['items__arrow.png', 9], null,
        null, ['items__apple.png', 5], ['items__ender_pearl.png', 1], null, ['items__netherite_sword.png', 1, 0.9], null, ['items__bread.png', 1], ['items__apple_golden.png', 3], null,
      ];
      cells.forEach((cell, k) => {
        const x = (k % 9) * 18, y = Math.floor(k / 9) * 18;
        grid.append(sprite('pepe__slot.png', x, y, 17, 17));
        if (!cell) return;
        const [file, count, dur] = cell;
        grid.append(sprite(file, x + 2, y + 2, 12, 12));
        if (dur != null) grid.append(...durBar(dur, x + 2, y + 14));
        if (count > 1) grid.append(div('cz-t', { position: 'absolute', right: (162 - x - 16) + 'px', top: (y + 9) + 'px', textShadow: '1px 1px 0 #3f3f3f' }, String(count)));
      });
      return grid;
    },
    // Armor HUD v1 (Assets Pack entity pepe_armorhud, read from the pack's render controllers and pre_animation):
    // slot cell 22px framed / 16px bare, pitch = cell + pepe:ah_spacing, stack centred on the anchor, helmet first
    // (boots first when reversed); bar 13x2 fill in a 14x3 frame under the icon (fill colour from the gradient or the
    // chosen colour); digits follow pepe:ah_text (percent / remaining / rem/max) and sit beside the slot, scaled by
    // pepe:ah_text_size; warning icon at the slot's top-left corner once the piece is at or under pepe:ah_warn_pct
    armorhud: ({ alpha }) => {
      const s = (k, d) => get('pepe:ah_' + k, d);
      const framed = s('frame', 'hotbar') !== 'none', half = framed ? 11 : 8, pitch = half * 2 + s('spacing', 2);
      const hz = s('layout', 'vertical') === 'horizontal', left = s('screen_side', 'right') === 'left';
      const ts = s('text_size', 100) / 100, textMode = s('text', 'percent');
      const sideV = s('text_side_v', 'auto'), textLeft = sideV === 'left' || (sideV === 'auto' && !left);
      const above = s('text_side_h', 'below') === 'above';
      const warnPct = s('warn', true) ? s('warn_pct', 20) : -1, warnStyle = s('warn_style', 'both');
      const parts = armorParts(s);
      const stack = div(null, { position: 'relative', width: '0', height: '0' });
      if (!parts.length) return stack;
      const ao = (parts.length - 1) / 2;                                   // sample has no empty pieces, so every align centres
      const BAR = { green: [0.3, 1, 0.3], yellow: [1, 0.9, 0.3], red: [1, 0.3, 0.3], aqua: [0.3, 0.9, 1], white: [1, 1, 1] };
      const barRGB = (f) => {
        const c = s('bar_color', 'gradient');
        const rgb = BAR[c] || [f > 0.5 ? 2 * (1 - f) : 1, f > 0.5 ? 1 : 2 * f, 0];
        return rgb.map((v) => Math.round(v * 255)).join(',');
      };
      const textCol = (f) => (f > 0.66 ? '#55ff55' : f > 0.33 ? '#ffff55' : f > 0.15 ? '#ffaa00' : '#ff5555');
      parts.forEach(([k, file, f], i) => {
        const pos = (i - ao) * pitch, max = ARMOR_MAX[k], rem = Math.round(max * f);
        const pc = Math.max(rem > 0 ? 1 : 0, Math.round(100 * f));
        const warn = warnPct >= 0 && pc <= warnPct;
        const slot = div(null, { position: 'absolute', left: (hz ? pos : 0) + 'px', top: (hz ? 0 : pos) + 'px', width: '0', height: '0' });
        if (warn && warnStyle !== 'icon') slot.classList.add('cz-blink');
        if (framed) slot.append(s('frame', 'hotbar') === 'box'
          ? abs(black(alpha, div(null, { width: '22px', height: '22px' })), -11, -11)
          : sprite('ui__hotbar_0.png', -10, -11, 20, 22));
        slot.append(sprite(file, -8, -8, 16, 16));
        if (s('bar', true) && !(s('hide_full', false) && rem >= max)) {
          slot.append(abs(div(null, { width: '14px', height: '3px', background: '#0a0a0a' }), -7, 6.5),
            abs(div(null, { width: Math.max(1, Math.round(13 * f)) + 'px', height: '2px', background: `rgb(${barRGB(f)})` }), -6.5, 7));
        }
        if (textMode !== 'off') {
          const str = textMode === 'percent' ? pc + '%' : textMode === 'remaining' ? String(rem) : `${rem}/${max}`;
          const label = div('cz-t', { color: s('text_color', 'durability') === 'durability' ? textCol(f) : '#fff', lineHeight: '1',
            fontSize: ts + 'em', whiteSpace: 'nowrap', textShadow: s('text_shadow', true) ? '1px 1px 0 #3f3f3f' : 'none' }, str);
          const ax = hz ? 0 : textLeft ? -half - 2 : half + 2;
          const ay = hz ? (above ? -(half + 2 + 3.5 * ts) : half + 2 + 3.5 * ts) : 0;
          label.style.transform = hz ? 'translate(-50%,-50%)' : textLeft ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
          slot.append(abs(label, ax, ay));
        }
        if (warn && warnStyle !== 'blink') slot.append(abs(div('cz-t', { width: '12px', height: '12px', color: '#ff5555', fontSize: '8px', lineHeight: '12px', textAlign: 'center' }, '!'), -14, -14));
        stack.append(slot);
      });
      stack.style.scale = String(s('size', 100) / 100);
      return stack;
    },
  };

  // labels are a stack_panel at left_middle (offset 2,0): three 9px rows centred in the 35px box; numbers right-aligned in the 94x17 renderer
  function coordsBox(o, pos) {
    const nodes = [];
    ['X:', 'Y:', 'Z:'].forEach((lbl, i) => nodes.push(text(lbl, 2, 4 + i * 9)));
    pos.forEach((v, i) => {
      const d = digits(String(v)); d.style.position = 'absolute'; d.style.top = 4 + i * 9 + 'px'; d.style.right = '3px'; nodes.push(d);
    });
    return tip(o.alpha, 55, 35, ...nodes);
  }

  const major = (id) => parseInt(String((api.version && api.version(id)) || '0'), 10) || 0;
  const MC = { white: '#fff', green: '#55ff55', red: '#ff5555', yellow: '#ffff55', aqua: '#55ffff', gold: '#ffaa00', orange: '#ff8c1a',
    purple: '#aa00aa', blue: '#5555ff', gray: '#aaaaaa', black: '#000' };

  // ArmorHUD v2+: drawn from the pack's own manifest settings (pepe:ah_*), not the Assets Pack variables
  function drawArmorHudV2() {
    const s = (k, d) => get('pepe:ah_' + k, d);
    if (!s('enabled', true)) return;
    const MAX = ARMOR_MAX;
    const parts = armorParts(s);
    if (!parts.length) return;
    const horiz = s('layout', 'vertical') === 'horizontal', gap = s('spacing', 2), cell = 20;
    const left = s('screen_side', 'right') === 'left';
    const textMode = s('text', 'percent'), tSide = s('text_side_v', 'auto'), below = s('text_side_h', 'below') === 'below';
    const textLeft = tSide === 'auto' ? !left : tSide === 'left';
    const warnAt = s('warn', true) ? s('warn_pct', 20) / 100 : -1;
    const wrap = div(null, { display: 'flex', flexDirection: horiz ? 'row' : 'column', gap: gap + 'px',
      alignItems: { start: 'flex-start', end: 'flex-end', center: 'center' }[s('align', 'center')] || 'center' });
    for (const [k, file, f] of parts) {
      const frame = s('frame', 'hotbar');
      const slot = div(null, { position: 'relative', width: cell + 'px', height: cell + 'px', flex: 'none' });
      if (frame === 'hotbar') slot.append(sprite('ui__hotbar_0.png', 0, -1, 20, 22));
      else if (frame === 'box') slot.append(abs(black(0.55, div(null, { width: cell + 'px', height: cell + 'px' })), 0, 0));
      slot.append(sprite(file, 2, 2, 16, 16));
      if (s('bar', true) && !(s('hide_full', false) && f >= 1)) {
        const bars = durBar(f, 3, 16);
        if (s('bar_color', 'gradient') !== 'gradient') bars[1].style.background = MC[s('bar_color')] || '#fff';
        slot.append(...bars);
      }
      if (f <= warnAt && s('warn_style', 'both') !== 'blink') slot.append(abs(div('cz-t', { color: '#ff5555', fontSize: '8px' }, '!'), 15, 0));
      if (f <= warnAt && s('warn_style', 'both') !== 'icon') slot.classList.add('cz-blink');
      let label = null;
      if (textMode !== 'off') {
        const rem = Math.round(MAX[k] * f);
        const str = textMode === 'percent' ? Math.round(f * 100) + '%' : textMode === 'remaining' ? String(rem) : `${rem}/${MAX[k]}`;
        label = div('cz-t', { color: s('text_color', 'durability') === 'durability' ? durColor(f) : '#fff', fontSize: (s('text_size', 100) / 100) + 'em',
          textShadow: s('text_shadow', true) ? '1px 1px 0 #3f3f3f' : 'none', whiteSpace: 'nowrap', lineHeight: '1' }, str);
      }
      const item = div(null, { display: 'flex', alignItems: 'center', gap: '2px', flexDirection: horiz ? (below ? 'column' : 'column-reverse') : (textLeft ? 'row-reverse' : 'row') }, slot, label);
      wrap.append(item);
    }
    wrap.style.transformOrigin = left ? 'left center' : 'right center';
    const box = div(null, null, wrap);
    box.style.scale = String(s('size', 100) / 100);
    box.title = 'ArmorHUD v' + api.version('pepes-armorhud');
    screen.append(mark(place(box, left ? 'left_middle' : 'right_middle', [(left ? 4 : -4) + s('x', 0), s('y', 0)]), 'pepes-armorhud'));
  }

  // Elytra Pitch: "[ 40° ]" under the crosshair, coloured, with the elytra indicator icon
  function drawElytraPitch() {
    const s = (k, d) => get('pepe:' + k, d);
    // picking the Elytra Pitch pack always shows it, even if its own toggle is off
    const selected = sel() === 'pepes-elytra-pitch';
    if (!selected && (!(api.used && api.used('pepes-elytra-pitch')) || !s('elytra_pitch', true))) return;
    const pitch = s('ep_invert', false) ? 12 : -12, glide = true;
    let str = (s('ep_sign', true) && pitch > 0 ? '+' : '') + pitch + (s('ep_degree', true) ? '°' : '');
    if (s('ep_brackets', true)) str = `[ ${str} ]`;
    const indCol = MC[s(glide ? 'elytra_ind_glide' : 'elytra_ind_idle', glide ? 'green' : 'red')];
    let col = s('elytra_pitch_color', 'white');
    col = col === 'indicator' ? indCol : col === 'auto' ? (Math.abs(pitch) < 30 ? MC.green : MC.yellow) : MC[col] || '#fff';
    const row = div(null, { display: 'flex', alignItems: 'center', gap: '3px', flexDirection: s('elytra_pitch_icon_pos', 'right') === 'left' ? 'row-reverse' : 'row' },
      div('cz-t', { color: col, textShadow: '1px 1px 0 #3f3f3f' }, str));
    if (s('ep_icon', true)) {
      const ic = img('items__elytra.png', 12, 12);
      if (s('elytra_indicator', true)) ic.style.filter = `drop-shadow(0 0 2px ${indCol})`;
      row.append(ic);
    }
    row.style.scale = String(s('elytra_pitch_size', 100) / 100);
    screen.append(mark(place(row, 'center', [s('elytra_pitch_x', 0), 14 + s('elytra_pitch_y', 0)]), 'pepes-elytra-pitch'));
  }

  // Totem Pop Counter: a sample Steve (1.5x the 8x12 player skin layout, 48px tall) with the nametag and the pop counter
  // above it, laid out from the pack's pepe:tp_* settings. The sample sits 16 blocks away, so Max Distance below 16 hides it.
  const RGB = { black: '#000000', gray: '#808080', red: '#aa0000', blue: '#0000aa', green: '#00aa00', purple: '#aa00aa' };
  const withAlpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function drawTotem(w, h) {
    if (sel() !== 'pepes-totem-pop-counter') return;
    const s = (k, d) => get('pepe:tp_' + k, d);
    const cx = Math.round(w * 0.62), feet = Math.round(h * 0.56) + 30, top = feet - 48;
    const SHIRT = '#2fb8b8', PANTS = '#2c3f8f', SKIN = '#c8956c';
    const box = (x, y, bw, bh, col) => abs(div(null, { width: bw + 'px', height: bh + 'px', background: col }), x, y);
    const figure = div(null, { position: 'absolute', left: cx - 12 + 'px', top: top + 'px', width: '24px', height: '48px' });
    figure.append(abs(div(null, { width: '24px', height: '4px', borderRadius: '50%', background: 'rgba(0,0,0,.3)' }), 0, 44),
      box(6, 0, 12, 12, SKIN), box(6, 0, 12, 3, '#3b2614'), box(8, 6, 2, 2, '#2b1d13'), box(14, 6, 2, 2, '#2b1d13'),
      box(6, 12, 12, 18, SHIRT), box(0, 12, 6, 18, SHIRT), box(18, 12, 6, 18, SHIRT), box(0, 30, 6, 6, SKIN), box(18, 30, 6, 6, SKIN),
      box(6, 30, 6, 18, PANTS), box(12, 30, 6, 18, PANTS));
    screen.append(mark(figure, 'pepes-totem-pop-counter'));
    screen.append(abs(div('cz-t', { background: 'rgba(0,0,0,.25)', padding: '1px 2px', whiteSpace: 'nowrap', transform: 'translateX(-50%)' }, 'Steve'), cx, top - 14));
    if (!s('enabled', true) || s('dist', 64) < 16) return;
    const pops = 3, size = s('size', 50) / 50;                      // 50 is the default: an 8px font, icon 10px
    const color = s('color', 'white') === 'auto' ? (pops <= 2 ? MC.green : pops <= 5 ? MC.yellow : MC.red) : MC[s('color', 'white')] || '#fff';
    const label = div('cz-t', { color, textShadow: '1px 1px 0 #3f3f3f', whiteSpace: 'nowrap', lineHeight: '1', fontSize: 8 * size + 'px' },
      s('brackets', false) ? `[${pops}]` : String(pops));
    const icon = s('icon', true) ? img('items__totem.png', Math.round(10 * size), Math.round(10 * size)) : null;
    const bg = s('bg', true);
    const row = div(null, { display: 'flex', alignItems: 'center', gap: '2px', padding: bg ? '1px 3px' : '0',
      background: bg ? withAlpha(RGB[s('bgcolor', 'black')] || RGB.black, 0.45) : 'none' },
      ...(s('iconside', 'left') === 'right' ? [label, icon] : [icon, label]));
    row.style.position = 'absolute';
    row.style.left = cx + 'px';
    row.style.top = top - 16 - (s('height', 5) - 5) + 'px';
    row.style.transform = `translate(calc(-50% + ${s('x', 0)}px), -100%)`;
    screen.append(mark(row, 'pepes-totem-pop-counter'));
  }

  const PLACEMENT = {                          // default anchor / offset when the variables are missing (from each pack's hud_screen.json)
    directionhud: { anchor: 'top_middle', offset: [0, 4] }, fpscounter: { anchor: 'top_right', offset: [-1, 1] },
    forcecoords: { anchor: 'top_right', offset: [-1, 1] }, deathcoords: { anchor: 'top_right', offset: [-1, 1] },
    level_calculator: { anchor: 'bottom_right', offset: [-1, -1] }, clockcompass: { anchor: 'bottom_left', offset: [1, -1] },
    speedometer: { anchor: 'top_middle', offset: [0, 25] }, inventoryhud: { anchor: 'bottom_right' },
  };

  function drawModules(w, h) {
    const names = api.names();
    const stems = new Map();
    for (const n of names) {
      const m = /^\$(.+)_(anchor)(\|default)?$/.exec(n);
      if (m) stems.set(m[1], n);
    }
    const handled = new Set(['food_stats_box', 'food_stats_effects', 'food_stats_corner_icon', 'food_stats_corner_icons']);
    const sample = (api.meta.preview || {}).samples || {};
    for (const [stem, anchorVar] of stems) {
      if (handled.has(stem)) continue;
      if (stem === 'armorhud' && major('pepes-armorhud') >= 2) continue;   // v2 reads its own pack settings (drawn below)
      if (get('$hide_' + stem, false) === true) continue;
      const touch = '$' + stem + '_touch_offset', mouse = '$' + stem + '_mouse_controller_offset', plain = '$' + stem + '_offset';
      const def = (PLACEMENT[stem] || {}).offset || [0, 0];
      let off = def;
      if (!PC_VARIANT && platform === 'mobile' && api.has(touch)) off = get(touch, def);
      else if (api.has(mouse)) off = get(mouse, def);
      else if (api.has(plain)) off = get(plain, def);
      else if (api.has(touch)) off = get(touch, def);
      let anchor = get(anchorVar, (PLACEMENT[stem] || {}).anchor || 'top_left');
      if (!ANCHOR[anchor]) anchor = 'top_left';
      const alpha = get('$' + stem + '_opacity', 0.65);
      const o = Array.isArray(off) ? off : def;
      let node;
      if (MODULES[stem]) node = MODULES[stem]({ alpha });
      else {
        node = tip(alpha, null, null, div('cz-chip-t', null, sample[stem] || humanize(stem)));
        node.classList.add('cz-chip');
      }
      node.title = humanize(stem);
      // Armor HUD is positioned by the player entity (its offset is not in GUI pixels), so it sits at the screen edge
      const sideL = stem === 'armorhud' && get('pepe:ah_screen_side', 'right') === 'left';   // v1 uses the entity's side / x / y
      screen.append(mark(stem === 'armorhud' ? place(node, sideL ? 'left_middle' : 'right_middle', [(sideL ? 4 : -4) + get('pepe:ah_x', 0), get('pepe:ah_y', 0)]) : place(node, anchor, o),
        stem === 'armorhud' ? 'pepes-armorhud' : 'pepes-assets-pack'));
      if (stem === 'level_calculator') {          // the pack also puts the level percentage at the right end of the xp bar (182px wide, centred)
        const pct = div('cz-t cz-xpct', null, '42.3%');
        screen.append(place(pct, 'bottom_right', [91 - w / 2, -22]));   // right edge at centre + 91, text box level with the bar's middle
      }
    }

    if (major('pepes-armorhud') >= 2) drawArmorHudV2();
    drawElytraPitch();

    // vanilla coordinates stack (Pepe's Better Coordinates): black boxes, alpha 0.65, text + 6px wide, 2px tall
    // same expressions as the pack's coords_template bindings (chunk = x / 16 - (x < 0), in-chunk shown only below 16)
    const [px, py, pz] = PLAYER;
    const chunk = (v) => Math.floor(v / 16);
    const inChunk = (v) => v - chunk(v) * 16;
    const [cx, cy, cz] = [chunk(px), chunk(py), chunk(pz)];
    const lines = [];
    if (!get('$hide_vanilla_coordinates', false)) lines.push(`Position: ${px}, ${py}, ${pz}`);
    if (!get('$hide_chunk_coordinatea', false)) lines.push(`Chunk: ${inChunk(px)}, ${inChunk(py)}, ${inChunk(pz)} in ${cx}, ${cy}, ${cz}`);
    if (!get('$hide_nether_coordinates', false)) lines.push(`Nether: ${px / 8}, ${py / 8}, ${pz / 8}`);
    if (!get('$hide_nether_to_overworld_coordinates', false)) lines.push(`Nether -> Overworld: ${px * 8}, ${py * 8}, ${pz * 8}`);
    if (lines.length) screen.append(place(div('cz-coordstack', null, lines.map((l) => black(0.65, div('cz-t', null, l)))), 'top_left', [0, 0]));

    if (get('$debughud', false)) drawDebugHud();
  }

  // Pepe's Debug HUD (F3): a top_left column of game-info lines and a top_right column of platform lines, in the pack's order.
  // Each row is a 9px text line in a gray box (textures/pepe/common/gray, alpha 0.65) with 2px side padding; $hide_<row> hides it
  function drawDebugHud() {
    const mob = platform === 'mobile';
    const ids = { sword: 267, apple: 260, golden_apple: 322, cooked_beef: 364, bread: 297, stew: 282, potion: 373, bucket_milk: 335, compass: 345 };
    const id = ids[held] || 0, aux = id * 65536;      // sample held item: Item ID is the id, Aux ID is id * 65536 + aux
    const column = (rows, anchor) => {
      const box = div(null, { display: 'flex', flexDirection: 'column', alignItems: anchor === 'top_right' ? 'flex-end' : 'flex-start' });
      for (const [key, str] of rows) {
        if (get('$hide_' + key, false) === true) continue;
        box.append(div('cz-t', { background: 'rgba(128,128,128,0.65)', padding: '0 2px', color: '#fff' }, str));
      }
      return place(box, anchor, [0, 0]);
    };
    screen.append(column([
      ['world_type', 'World Type: World/3rd Party Server'],
      ['world_name', "World Name: Pepe's World"],
      ['day_counter', 'Days Played: 37'],
      ['moon_phase', 'Moon Phase: Waxing Crescent'],
      ['gamemode', 'Game Mode: Survival'],
      ['xp_level', 'XP Level: 30'],
      ['item_aux_id', 'Aux ID: ' + aux],
      ['item_id', 'Item ID: ' + id],
    ], 'top_left'));
    screen.append(column([
      ['assetspack_version', 'Assets Pack v1.9.0'],
      ['version', 'Minecraft (minecraft/vanilla/release)'],
      ['os_type', mob ? 'Operating system: Android' : 'Operating system: Windows'],
      ['graphics', mob ? 'Graphics: GLSL [OpenGL ES]' : 'Graphics: RenderDragon [Direct3D11+]'],
      ['platform', mob ? 'Input: Touch' : 'Input: Keyboard & Mouse'],
      ['ui_type', mob ? 'UI Type: Pocket' : 'UI Type: Classic'],
    ], 'top_right'));
  }

  function drawPlatformChrome() {
    if (PC_VARIANT || platform !== 'mobile') return;
    // Bedrock touch layout on a landscape phone: d-pad bottom-left, jump and sneak bottom-right with emote above them,
    // chat top-right, pause top-middle, and the ... inventory button just right of the hotbar. Arrow / jump / sneak icons
    // are the vanilla 22px textures drawn 1:1; chat, emote and ... have no texture in assets/mc, so they are small inline SVG.
    const ctl = (file, anchor, x, y) => screen.append(place(img(file, 22, 22, { opacity: 0.85 }), anchor, [x, y]));
    const touch = (cls, size, anchor, x, y, ...kids) => screen.append(place(div('cz-touch ' + cls, { width: size + 'px', height: size + 'px' }, ...kids), anchor, [x, y]));
    const svg = (body, vb) => { const d = div('cz-touch-svg'); d.innerHTML = `<svg viewBox="${vb || '0 0 16 16'}" aria-hidden="true">${body}</svg>`; return d; };
    // d-pad: 66px round pad at (12, 12) from the bottom-left corner; 22px arrows form the cross inside it
    touch('cz-touch-pad', 66, 'bottom_left', 12, -12);
    ctl('gui__controls__up.png', 'bottom_left', 34, -56);
    ctl('gui__controls__left.png', 'bottom_left', 12, -34);
    ctl('gui__controls__right.png', 'bottom_left', 56, -34);
    ctl('gui__controls__down.png', 'bottom_left', 34, -12);
    touch('cz-touch-pad', 40, 'bottom_right', -10, -10, img('gui__controls__jump.png', 22, 22, { opacity: 0.85 }));
    touch('cz-touch-pad', 32, 'bottom_right', -56, -12, img('gui__controls__sneak.png', 22, 22, { opacity: 0.85 }));
    touch('', 26, 'bottom_right', -16, -54, svg('<circle cx="8" cy="8" r="6"/><circle cx="6" cy="6.5" r=".8" fill="#fff"/><circle cx="10" cy="6.5" r=".8" fill="#fff"/><path d="M5.5 9.5q2.5 2 5 0"/>'));
    touch('', 24, 'top_right', -8, 4, svg('<path d="M2.5 3h11v8h-6l-3 2.5V11h-2z"/>'));
    touch('', 22, 'top_middle', 0, 4, img('ui__pause_icon.png', 6, 8, { opacity: 0.85 }));
    screen.append(place(div('cz-touch cz-touch-inv', { width: '20px', height: '22px' },
      svg('<rect x="4" y="10" width="2" height="2" fill="#fff"/><rect x="9" y="10" width="2" height="2" fill="#fff"/><rect x="14" y="10" width="2" height="2" fill="#fff"/>', '0 0 20 22')),
      'bottom_middle', [103, 0]));
  }

  /* ---------- tooltip card ---------- */
  function drawTooltip() {
    const it = heldItem();
    ttEl.replaceChildren();
    const box = div('cz-tt');
    box.append(div('cz-tt-name', null, it.name));
    // Food Stats+ adds the id / shanks lines only to food items (hover_ui.py: the pepe_fid / pepe_food keys)
    if (it.hunger != null && !get('$hide_hover_item_id', false)) box.append(div('cz-tt-id', null, 'minecraft:' + (it.id === 'stew' ? 'suspicious_stew' : it.id)));
    if (it.hunger != null && !get('$hide_food_stats_hover', false)) box.append(foodRow(it));
    if (!get('$hide_food_stats_hover_effects', false)) {
      if (it.hunger != null) box.append(div('cz-tt-eat', null, 'Eat ' + it.eat + 's' + (it.fx ? '  ' : ''), it.fx ? div('cz-tt-fx', { color: '#55ff55' }, it.fx[1]) : null));
      if (it.id === 'potion') box.append(div('cz-tt-fx', { color: '#55ff55' }, 'Speed (3:00)'));
    }
    if (it.id === 'stew' && !get('$hide_suspicious_stew_info', false)) {
      box.append(div('cz-tt-fx', { color: '#55ff55' }, 'Night Vision (0:05)'), div('cz-tt-id', null, 'Poppy, Torchflower'));
    }
    ttEl.append(box);
  }

  /* ---------- JSON UI engine (customizer-ui.js) ---------- */
  // The HUD runs from the game's own files: vanilla hud_screen.json with every Pepe pack stacked on it, the customizer
  // settings as their $variables. Only what the game draws in code (hearts, hotbar items, the player-entity readouts)
  // comes from the hooks below. Without the bundles (old browser, offline) the hand-drawn layout above is used.
  const UI_SKIP = new Set(['pepes-better-hover-text']);        // not part of the Assets Pack line-up the customizer edits
  // numeric item ids the packs compare against (1.26.60: apple moved from 882 to 886), and the sample hotbar / inventory icons
  const NUM = { sword: 1, apple: 886, golden_apple: 258, cooked_beef: 274, bread: 261, stew: 602, potion: 430, bucket_milk: 1, compass: 394 };
  const INV = [
    ['items__netherite_sword.png', 1, 0.62], null, ['items__apple.png', 12], ['items__arrow.png', 47], null, ['items__ender_pearl.png', 16], ['items__stick.png', 3], null, ['items__apple_golden.png', 2],
    ['items__bread.png', 20], null, ['items__iron_pickaxe.png', 1, 0.3], ['items__beef_cooked.png', 8], null, null, ['items__stick.png', 64], ['items__arrow.png', 9], null,
    null, ['items__apple.png', 5], ['items__ender_pearl.png', 1], null, ['items__netherite_sword.png', 1, 0.9], null, ['items__bread.png', 1], ['items__apple_golden.png', 3], null,
  ];
  let uiIndex = null, uiProg = null, uiKey = '', uiLoading = '', uiTex = null;

  function uiPacks() {
    if (!uiIndex) return null;
    const ver = (id) => {
      const have = (uiIndex[id] || {}).versions || [];
      const want = api.version && api.version(id);
      return have.includes(want) ? want : have[0];
    };
    const list = [['pepes-assets-pack', ver('pepes-assets-pack')]];
    for (const id of Object.keys(uiIndex)) if (id !== 'pepes-assets-pack' && !UI_SKIP.has(id)) list.push([id, ver(id)]);
    return list.filter(([, v]) => v);
  }
  // (re)builds the program when a picked pack version changes; renders the classic way meanwhile
  function ensureUi() {
    if (!window.CzUI) return false;
    if (!uiIndex) {
      if (uiLoading !== 'index') {
        uiLoading = 'index';
        fetch('assets/ui/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => { uiIndex = j || {}; uiLoading = ''; scheduleRender(); })
          .catch(() => { uiIndex = {}; uiLoading = ''; });
      }
      return false;
    }
    const packs = uiPacks(), key = JSON.stringify(packs);
    if (!packs || !packs.length) return false;
    if (key !== uiKey && uiLoading !== key) {
      uiLoading = key;
      CzUI.program(packs).then((p) => { if (uiLoading !== key) return; uiProg = p; uiKey = key; uiLoading = ''; scheduleRender(); })
        .catch(() => { uiLoading = ''; });
    }
    return !!uiProg;
  }

  // customizer settings become the packs' global $variables; platform flags pick the desktop or pocket layouts
  function uiVars() {
    const pc = PC_VARIANT || platform === 'pc';
    // the game shows the item-name background (hud_tip_text_background) for the held item name
    const v = { '$desktop_screen': pc, '$pocket_screen': !pc, '$education_edition': false, '$mouse': pc, '$touch': !pc, '$gamepad': false, '$show_text_background': true };
    for (const n of api.names()) v[n.replace(/\|default$/, '')] = api.get(n);
    return v;
  }

  function uiData() {
    const mobile = !PC_VARIANT && platform === 'mobile', it = heldItem();
    const G = {
      '#hud_visible': true, '#hud_alpha': 1, '#hud_propagate_alpha': false, '#hud_visible_centered': !mobile, '#hud_visible_centered_touch': mobile,
      '#hud_visible_not_centered': false, '#hud_visible_centered_gui_elements': true, '#hotbar_visible': true, '#hotbar_with_xp_bar': true,
      '#hotbar_no_xp_bar': false, '#hotbar_with_locator_bar': false, '#show_survival_ui': true, '#is_armor_visible': true, '#is_spectator_mode': false,
      '#exp_progress': 1 - 0.423, '#level_number': '30', '#level_number_visible': true, '#hotbar_grid_dimensions': [9, 1],
      '#item_text': it.name, '#item_name_text_offset': [0, -19], '#interact_visible': false, '#hud_text_background_alpha': 0.5,
      '#player_position_text': `Position: ${PLAYER.join(', ')}`, '#player_position_visible': true, '#paper_doll_visible': false,
      '#editor_chat_layout_active': false, '#inventory_touch_button': mobile, '#hotbar_elipses_right_visible': mobile, '#gamertag': '',
      '#number_of_days_played_text': 'Day 37', '#number_of_days_played_visible': false, '#status_effects_visible': false,
    };
    const slot = (icon, count, dur, id, extra) => Object.assign({ icon, '#item_id_aux': id * 65536, '#item_id': id, '#inventory_stack_count': count > 1 ? String(count) : '',
      '#stack_count_visible': count > 1, '#item_durability_visible': dur != null, '#item_durability_current_amount': dur != null ? Math.round(dur * 1561) : 0,
      '#item_durability_total_amount': dur != null ? 1561 : 0, '#item_storage_visible': false, '#hotbar_hint_visible': false, '#item_renderer_data': '', '#slot_selected': false }, extra);
    const hotbar = HOTBAR.map((id) => {
      const item = ITEMS.find((x) => x.id === id);
      return slot(item ? item.icon : EXTRA[id], id === 'apple' ? 12 : 1, id === 'sword' ? 0.82 : null, NUM[id] || 1, { '#slot_selected': id === held });
    });
    const inventory = INV.map((c) => (c ? slot(c[0], c[1], c[2], 1) : slot(null, 0, null, 0)));
    const colls = { hotbar_items: [...hotbar, ...inventory], inventory_items: [...hotbar, ...inventory] };
    return {
      global: (n) => G[n],
      collection: (c) => colls[c] || [],
      item: (c, i, n) => { const row = (colls[c] || colls.hotbar_items)[i]; return row ? row[n] : undefined; },
      factory: (n) => (n === 'item_text_factory' && it ? ['item_text'] : []),
    };
  }

  // engine-drawn parts: hooks get the custom control and its element; `own(node, name)` moves the element onto the
  // module box that owns an off-screen player-entity renderer, where the game draws that entity's readout
  function uiHooks(data) {
    const U = (t) => 'assets/ui/tex/textures/ui/' + t + '.png';
    const pic = (src, x, y, w, h) => {
      const i = document.createElement('img');
      i.src = src; i.width = w; i.height = h; i.alt = ''; i.draggable = false; i.className = 'cz-px';
      Object.assign(i.style, { position: 'absolute', left: x + 'px', top: y + 'px' });
      return i;
    };
    const own = (node, el, name) => {
      let p = node.parent; while (p && p.name !== name) p = p.parent;
      if (!p) return false;
      Object.assign(el.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px', zIndex: String(Math.round(p.z) + 1) });
      return p;
    };
    const screenLevel = (fn) => () => { fn(); return false; };
    return {
      'renderer:hotbar_slots_renderer': (n, el) => { for (let i = 0; i < 9; i += 1) el.append(pic(U('hotbar_' + i), i * 20, 0, 20, 22)); },
      'renderer:inventory_item_renderer': (n, el) => {
        const row = data.collection(n.coll || 'hotbar_items')[n.ci];
        if (!row || !row.icon) return false;
        el.append(img(row.icon, n.w, n.h, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }));
      },
      'renderer:progress_bar_renderer': (n, el) => {
        const row = data.collection(n.coll || 'hotbar_items')[n.ci];
        if (!row || !row['#item_durability_visible'] || !/dura/.test(n.name)) return false;
        const f = row['#item_durability_current_amount'] / row['#item_durability_total_amount'];
        el.append(...durBar(f, 0, 0));
      },
      'renderer:heart_renderer': (n, el) => { for (let i = 0; i < 10; i += 1) el.append(pic(U('heart_background'), 1 + i * 8, 1, 9, 9), pic(U('heart'), 1 + i * 8, 1, 9, 9)); },
      'renderer:armor_renderer': (n, el) => { for (let i = 0; i < 10; i += 1) el.append(pic(U(i < 8 ? 'armor_full' : 'armor_empty'), 1 + i * 8, -9, 9, 9)); },
      'renderer:hunger_renderer': (n, el) => { for (let i = 0; i < 10; i += 1) el.append(pic(U('hunger_background'), -9 - i * 8, 1, 9, 9), pic(U('hunger_full'), -9 - i * 8, 1, 9, 9)); },
      // FPS counter: three layered digit textures at x 26 in the 50x18 box
      fpscounter_renderer: (n, el) => { if (!own(n, el, 'fpscounter_bg_panel')) return false; el.append(lv('fps', { position: 'absolute', inset: '0' }, fpsGlyphs(live.fps))); },
      // DirectionHUD: the compass tape scrolled by yaw inside the 138x16 box
      pepe_directionhud_renderer: (n, el) => {
        const p = own(n, el, 'pepe_directionhud'); if (!p) return false;
        const k = (p.w - 2) / 128, u0 = (20 + 192 * ((90 + yaw) / 360)) % 192, h = 12 * k;
        el.append(div(null, { position: 'absolute', left: '1px', top: (p.h - h) / 2 + 'px', width: 128 * k + 'px', height: h + 'px', imageRendering: 'pixelated',
          backgroundImage: `url(${T('pepe__directionhud.png')})`, backgroundRepeat: 'repeat-x', backgroundSize: `${192 * k}px ${14 * k}px`, backgroundPosition: `${-u0 * k}px ${-1 * k}px` }));
      },
      // Speedometer: digits and the m/s unit centred in the box
      speedometer: (n, el) => {
        if (!own(n, el, 'speedometer_background')) return false;
        const row = div(null, { display: 'flex', alignItems: 'flex-end', height: '8px', position: 'absolute', left: '0', right: '0', top: '3px', justifyContent: 'center' });
        row.append(lv('speed', { display: 'flex', alignItems: 'flex-end' }, speedGlyphs(live.speed)), div(null, { width: '3px' }), img('pepe__u_ms.png', 24, 8));
        el.append(row);
      },
      // Force / Death coordinates: numbers right-aligned beside the pack's X: Y: Z: labels
      forcecoords_renderer: (n, el) => { const p = own(n, el, 'forcecoords_bg_panel'); if (!p) return false; coordDigits(el, p, PLAYER); },
      deathcoords_renderer: (n, el) => { const p = own(n, el, 'deathcoords_bg_panel'); if (!p) return false; coordDigits(el, p, DEATH); },
      // ArmorHUD and Elytra Pitch read pack settings in their entities: drawn at screen level from those settings
      armorhud_live_renderer: screenLevel(() => {
        if (major('pepes-armorhud') >= 2) { drawArmorHudV2(); return; }
        if (get('$hide_armorhud', false)) return;
        screen.append(mark(place(MODULES.armorhud({ alpha: 0.65 }), 'right_middle', [-6, 0]), 'pepes-armorhud'));
      }),
      armorhud_live_renderer_l: () => false,
      pepe_elytra_pitch_live_renderer: screenLevel(drawElytraPitch),
      'renderer:hud_player_renderer': () => false,
      'renderer:paper_doll_renderer': () => false,
      'renderer:live_player_renderer': () => false,
    };
  }
  function coordDigits(el, p, pos) {
    const rows = 3, top = (p.h - rows * 9) / 2;
    pos.forEach((v, i) => { const d = digits(String(v)); Object.assign(d.style, { position: 'absolute', top: top + i * 9 + 'px', right: '3px' }); el.append(d); });
  }

  let lastUi = null;
  function drawUi(w, h) {
    const layer = div('czu-layer', { position: 'absolute', left: 0, top: 0, width: w + 'px', height: h + 'px' });
    screen.append(layer);
    const data = uiData();
    const r = CzUI.run(uiProg, { width: w, height: h, vars: uiVars(), data, hooks: uiHooks(data), texCache: uiTex });
    if (!r) return false;
    r.draw(layer);
    lastUi = r;
    if (api.groupOf) drawHotspots(r.tree, w, h);
    return true;
  }

  /* ---------- drag a module to move it ----------
     Press a module and drag: its offset variable follows the pointer in whole GUI pixels (what the game uses), with
     snapping to other modules' edges, a live X/Y readout and a ghost where it started. Esc cancels; with the module
     focused, arrow keys nudge 1 px (Shift 5). Without a move it is still a click that opens the settings. */
  let zoomNow = 1, dragState = null, suppressClick = false, refocus = null;
  const hotRects = new Map();
  const hotOf = (g) => (root ? root.querySelector(`.czu-hit[aria-label="Edit ${g.replace(/"/g, '')}"]`) : null);
  const OFFSET_RE = /^\$(.+?)_(mouse_controller_offset|touch_offset|offset)(\|default)?$/;
  // the offset variable the preview currently reads for a settings group (same order as drawModules)
  function offsetVarFor(g) {
    const found = {};
    for (const n of api.names()) {
      const m = OFFSET_RE.exec(n);
      if (!m || api.groupOf(n) !== g) continue;
      found[m[2]] = n.replace(/\|default$/, '');
    }
    const order = (!PC_VARIANT && platform === 'mobile') ? ['touch_offset', 'mouse_controller_offset', 'offset'] : ['mouse_controller_offset', 'offset', 'touch_offset'];
    for (const k of order) if (found[k]) return found[k];
    return null;
  }
  const cur = (v) => { const a = get(v, [0, 0]); return Array.isArray(a) ? [Number(a[0]) || 0, Number(a[1]) || 0] : [0, 0]; };
  function snapTo(g, nx, ny, d) {
    const me = hotRects.get(g), res = { x: nx, y: ny, gx: null, gy: null };
    if (!me) return res;
    const w = me.x1 - me.x0, h = me.y1 - me.y0;
    const mx = me.x0 + (nx - d.start[0]), my = me.y0 + (ny - d.start[1]);
    let bx = 3, by = 3;
    for (const [og, r] of hotRects) {
      if (og === g) continue;
      for (const t of [r.x0, r.x1, (r.x0 + r.x1) / 2]) for (const e of [mx, mx + w, mx + w / 2]) {
        const dd = t - e; if (Math.abs(dd) < Math.abs(bx)) { bx = dd; res.gx = t; }
      }
      for (const t of [r.y0, r.y1, (r.y0 + r.y1) / 2]) for (const e of [my, my + h, my + h / 2]) {
        const dd = t - e; if (Math.abs(dd) < Math.abs(by)) { by = dd; res.gy = t; }
      }
    }
    if (Math.abs(bx) < 3 && res.gx !== null) res.x = nx + Math.round(bx); else res.gx = null;
    if (Math.abs(by) < 3 && res.gy !== null) res.y = ny + Math.round(by); else res.gy = null;
    return res;
  }
  function startDrag(e, g, open) {
    const v = offsetVarFor(g);
    if (!v || e.button > 0) return;
    dragState = { g, v, sx: e.clientX, sy: e.clientY, start: cur(v), now: cur(v), moved: false, rect0: hotRects.get(g) ? { ...hotRects.get(g) } : null, gx: null, gy: null, open };
    dragState.pointerId = e.pointerId;   // captured once it actually moves, so a plain press is still a click on the button
  }
  function moveDrag(e) {
    const d = dragState; if (!d) return;
    const px = e.clientX - d.sx, py = e.clientY - d.sy;
    if (!d.moved && Math.hypot(px, py) < 5) return;
    d.moved = true;
    try { screen.setPointerCapture(d.pointerId); } catch (err) { /* ignore */ }
    let nx = Math.round(d.start[0] + px / zoomNow), ny = Math.round(d.start[1] + py / zoomNow);
    if (!e.altKey) { const s = snapTo(d.g, nx, ny, d); nx = s.x; ny = s.y; d.gx = s.gx; d.gy = s.gy; } else { d.gx = d.gy = null; }
    d.now = [nx, ny];
    api.set(d.v, [nx, ny], true);
  }
  function endModuleDrag(commit) {
    const d = dragState; if (!d) return;
    dragState = null;
    if (d.moved) {
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
      api.set(d.v, commit ? d.now : d.start, false);   // final value, and the form's fields catch up
      refocus = d.g;
    }
    scheduleRender();
  }
  function nudge(e, g) {
    const v = offsetVarFor(g);
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!v || !k) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1, o = cur(v);
    refocus = g;
    api.set(v, [o[0] + k[0] * step, o[1] + k[1] * step], false);
  }
  function drawDragOverlay(w, h) {
    const d = dragState; if (!d || !d.moved) return;
    const add = (cls, css, text) => { const n = div(cls, css, text); screen.append(n); return n; };
    if (d.rect0) add('czu-ghost', { left: d.rect0.x0 + 'px', top: d.rect0.y0 + 'px', width: d.rect0.x1 - d.rect0.x0 + 'px', height: d.rect0.y1 - d.rect0.y0 + 'px' });
    if (d.gx !== null) add('czu-guide czu-guide-v', { left: d.gx + 'px', top: 0, height: h + 'px' });
    if (d.gy !== null) add('czu-guide czu-guide-h', { top: d.gy + 'px', left: 0, width: w + 'px' });
    const r = hotRects.get(d.g);
    if (r) {
      const y = Math.min(h - 6, r.y1 + 3);
      const tag = add('czu-readout', { left: Math.max(0, r.x0) + 'px', top: y + 'px', transform: `scale(${1 / zoomNow})` }, `X ${d.now[0]}  Y ${d.now[1]}${d.gx !== null || d.gy !== null ? '  snapped' : ''}`);
      tag.setAttribute('aria-hidden', 'true');
    }
  }

  // One button per settings group over the outermost on-screen control whose anchor, offset, alpha or visibility comes
  // from one of that group's variables: clicking it opens the group's settings (api.openModule).
  let selectedGroup = null;
  function drawHotspots(tree, w, h) {
    const hot = div('czu-hot', { position: 'absolute', left: 0, top: 0, width: w + 'px', height: h + 'px' });
    // per group: the union of the on-screen boxes of every control that uses one of its variables (a module of several
    // lines, like Coordinates, is one target)
    const seen = new Map();
    (function walk(n) {
      if (!n || n.hidden) return;
      const onScreen = n.w > 1 && n.h > 1 && n.x < w && n.y < h && n.x + n.w > 0 && n.y + n.h > 0 && n.w * n.h < w * h * 0.5;
      if (n.uses && n.uses.size && onScreen) {
        const gs = new Set([...n.uses].map((v) => api.groupOf(v)).filter(Boolean));
        for (const g of gs) {
          const r = seen.get(g) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
          r.x0 = Math.min(r.x0, n.x); r.y0 = Math.min(r.y0, n.y); r.x1 = Math.max(r.x1, n.x + n.w); r.y1 = Math.max(r.y1, n.y + n.h);
          seen.set(g, r);
        }
      }
      (n.kids || []).forEach(walk);
    })(tree);
    hotRects.clear();
    for (const [g, r] of seen) hotRects.set(g, r);
    // smaller targets go last so they stay clickable where boxes overlap
    const order = [...seen].sort((a, b) => (b[1].x1 - b[1].x0) * (b[1].y1 - b[1].y0) - (a[1].x1 - a[1].x0) * (a[1].y1 - a[1].y0));
    for (const [g, r] of order) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'czu-hit' + (g === selectedGroup ? ' on' : '');
      b.setAttribute('aria-label', 'Edit ' + g); b.title = g;
      const x = Math.max(0, r.x0), y = Math.max(0, r.y0);
      Object.assign(b.style, { left: x + 'px', top: y + 'px', width: Math.min(w, r.x1) - x + 'px', height: Math.min(h, r.y1) - y + 'px' });
      const movable = !!(api.set && offsetVarFor(g));
      if (movable) { b.classList.add('czu-drag'); b.setAttribute('aria-description', 'Drag to move, arrow keys nudge'); }
      const open = () => { selectedGroup = g; api.openModule(g, hotOf(g) || b); scheduleRender(); };
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (movable) startDrag(e, g, open); });
      b.addEventListener('click', () => { if (suppressClick || dragState) return; open(); });
      if (movable) b.addEventListener('keydown', (e) => nudge(e, g));
      hot.append(b);
      if (refocus === g) { refocus = null; requestAnimationFrame(() => b.isConnected && b.focus({ preventScroll: true })); }
    }
    screen.append(hot);
    drawDragOverlay(w, h);
  }
  const select = (g) => { selectedGroup = g; scheduleRender(); };

  /* ---------- render ---------- */
  // Bedrock GUI scale: one GUI pixel is `gui` screen pixels, so the GUI canvas is the stage size divided by `gui`.
  // The HUD is laid out against that canvas (more fits at 1x, less at 3x) and the whole canvas is then zoomed by the
  // whole number `gui`, so every texture stays pixel-crisp. The canvas always covers the stage, normal or fullscreen.
  let fsOn = false;                                  // preview is in fullscreen (native API or fallback)
  let canvasKey = '', canvasW = 0, canvasH = 0;
  // sets the stage height (normal mode keeps the platform's aspect) and the canvas size; true when the layout must redo
  function fit() {
    if (api.bar) {
      // full-screen editor: the largest box of the platform's screen ratio (16:9 PC, phone landscape) that fits the host
      const host = stage.parentElement, ar = ASPECT[platform][0] / ASPECT[platform][1];
      const hw = host.clientWidth, hh = host.clientHeight;
      const sw = Math.min(hw, hh * ar);
      stage.style.width = Math.floor(sw) + 'px'; stage.style.height = Math.floor(sw / ar) + 'px';
    } else if (!fsOn) stage.style.height = Math.round(stage.clientWidth * ASPECT[platform][1] / ASPECT[platform][0]) + 'px';
    else stage.style.height = '';
    // the stage stands for a 1080p screen: GUI scale 3 (the game's default) gives a 240 px tall canvas, 2 gives 300, 1 gives 360,
    // so a bigger scale shows fewer GUI pixels and the HUD grows, as in the game; the canvas is then zoomed to fill the stage
    const lines = { 1: 360, 2: 300, 3: 240 }[gui] || 240;
    const zoom = stage.clientHeight / lines;
    zoomNow = zoom;
    canvasW = stage.clientWidth / zoom; canvasH = lines;
    screen.style.transform = `scale(${zoom})`;
    const key = [platform, gui, canvasW.toFixed(2), canvasH.toFixed(2)].join('|');
    if (key === canvasKey) return false;
    canvasKey = key;
    return true;
  }
  function resize() {
    // hidden tab: the ResizeObserver redraws once it is shown. The full-screen editor sizes the stage from its host,
    // so a stage that is still 0 wide must not stop it (that left the preview blank when the host was laid out late).
    if (!stage) return;
    if (api && api.bar ? !stage.parentElement.clientWidth : !stage.clientWidth) return;
    if (fit()) render();
  }

  // phones held upright see the rotate prompt (customizer.css): nothing is drawn behind it
  const portraitMq = matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 1100px)');
  const blocked = () => !!api && !!api.bar && portraitMq.matches;
  function render() {
    ensureUi();                                      // starts loading the JSON UI program even while the stage is hidden
    if (!screen || !stage || !stage.clientWidth || blocked()) return;
    fit();
    const w = canvasW, h = canvasH;
    screen.style.width = w + 'px'; screen.style.height = h + 'px';
    screen.replaceChildren();
    drawScene(w, h);
    if (ensureUi() && drawUi(w, h)) {
      drawTotem(w, h);
    } else {
      drawModules(w, h);
      drawTotem(w, h);
      drawVanillaHud(w, h);
      drawItemPopup();
    }
    drawPlatformChrome();
    drawTooltip();
  }

  // Coalesce bursts of input events (slider drags, typing, pack switches) into one render per animation frame.
  // No change check here: the drawing reads settings of every pack, so a comparison of names() alone would miss some.
  // A timer backs the frame up: background tabs never run animation frames, so a load finishing there would never draw.
  let frame = 0, frameTimer = 0;
  function scheduleRender() {
    if (!screen || frame) return;
    const run = () => { cancelAnimationFrame(frame); clearTimeout(frameTimer); frame = 0; render(); };
    frame = requestAnimationFrame(run);
    frameTimer = setTimeout(run, 150);
  }

  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ platform, held, yaw, gui })); } catch (e) { /* ignore */ } };

  function init(rootEl, apiIn) {
    api = apiIn; root = rootEl;
    // a texture's size can change the layout; textures arrive in bursts, so they share one redraw per 80ms
    let texTimer = 0;
    if (window.CzUI) uiTex = new CzUI.TexCache(() => { clearTimeout(texTimer); texTimer = setTimeout(scheduleRender, 80); });
    const seg = div('cz-seg', null);
    seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', 'Platform');
    const btns = [['pc', 'fa-computer', 'PC'], ['mobile', 'fa-mobile-screen', 'Mobile']].map(([id, ico, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cz-seg-btn'; b.setAttribute('role', 'radio');
      b.innerHTML = `<i class="fas ${ico}" aria-hidden="true"></i> ${label}`;
      b.addEventListener('click', () => { platform = id; persist(); sync(); render(); });
      seg.append(b); return [id, b];
    });
    const sync = () => btns.forEach(([id, b]) => { b.setAttribute('aria-checked', String(id === platform)); b.classList.toggle('on', id === platform); });
    sync();
    const dd = api.dropdown({ id: 'cz-held', label: 'Held item', options: ITEMS.map((i) => ({ value: i.id, label: i.name })), value: held,
      onChange: (v) => { held = v; persist(); render(); } });
    const gseg = div('cz-seg', null);
    gseg.setAttribute('role', 'radiogroup'); gseg.setAttribute('aria-label', 'GUI scale');
    const gbtns = [1, 2, 3].map((n) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cz-seg-btn'; b.setAttribute('role', 'radio'); b.textContent = n + 'x';
      b.addEventListener('click', () => { gui = n; persist(); gsync(); render(); });
      gseg.append(b); return [n, b];
    });
    const gsync = () => gbtns.forEach(([n, b]) => { b.setAttribute('aria-checked', String(n === gui)); b.classList.toggle('on', n === gui); });
    gsync();
    // Fullscreen: native API on the preview root; .cz-pv-fs-fallback (fixed inset 0) when the API is missing or refused (iOS)
    const fsBtn = document.createElement('button');
    fsBtn.type = 'button'; fsBtn.className = 'cz-seg-btn'; fsBtn.setAttribute('aria-pressed', 'false');
    fsBtn.innerHTML = '<i class="fas fa-expand" aria-hidden="true"></i> Fullscreen';
    const fsSet = (on) => {
      fsOn = on;
      root.classList.toggle('cz-pv-fs', on);
      root.classList.toggle('cz-pv-fs-fallback', on && document.fullscreenElement !== root);
      fsBtn.innerHTML = `<i class="fas ${on ? 'fa-compress' : 'fa-expand'}" aria-hidden="true"></i> Fullscreen`;
      fsBtn.setAttribute('aria-pressed', String(on));
      resize();
    };
    fsBtn.addEventListener('click', () => {
      if (!fsOn) { fsSet(true); if (root.requestFullscreen) root.requestFullscreen().catch(() => {}); }
      else if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
      else fsSet(false);
    });
    if (!api.bar) {
      document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement === root) fsSet(true); else if (fsOn) fsSet(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fsOn && !document.fullscreenElement) fsSet(false); });
    }
    // full-screen editor (api.bar given): the stage fills the page, the controls sit in the page's top bar and the
    // Fullscreen button only asks the browser to hide its own chrome
    const full = !!api.bar;
    if (full) {
      fsOn = true;
      const app = api.app || root;
      const paintFs = () => {
        const on = document.fullscreenElement === app;
        fsBtn.innerHTML = `<i class="fas ${on ? 'fa-compress' : 'fa-expand'}" aria-hidden="true"></i>`;
        fsBtn.setAttribute('aria-pressed', String(on)); fsBtn.setAttribute('aria-label', on ? 'Exit browser fullscreen' : 'Browser fullscreen');
        fsBtn.title = fsBtn.getAttribute('aria-label');
      };
      fsBtn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else if (app.requestFullscreen) app.requestFullscreen().catch(() => {});
      }, true);
      document.addEventListener('fullscreenchange', () => { paintFs(); resize(); });
      paintFs();
      if (!app.requestFullscreen) fsBtn.hidden = true;
    }
    const head = full
      ? div('cz-pv-head', null, seg, gseg, div('cz-pv-held', null, div('cz-pv-lbl', null, 'Holding'), dd.root), fsBtn)
      : div('cz-pv-head', null, seg, div('cz-pv-held', null, div('cz-pv-lbl', null, 'Holding'), dd.root), div('cz-pv-scale', null, div('cz-pv-lbl', null, 'GUI scale'), gseg), div('cz-seg', null, fsBtn));
    const yawIn = document.createElement('input');
    yawIn.type = 'range'; yawIn.min = -180; yawIn.max = 180; yawIn.step = 5; yawIn.value = yaw; yawIn.className = 'cz-yaw'; yawIn.setAttribute('aria-label', 'Facing direction');
    yawIn.addEventListener('input', () => { yaw = Number(yawIn.value); persist(); render(); });
    const yawRow = div('cz-pv-yaw', null, div('cz-pv-lbl', null, 'Facing'), yawIn);
    stage = div('cz-pv-stage'); screen = div('cz-screen'); stage.append(screen);
    screen.style.imageRendering = 'pixelated';
    // drag across the screen to turn (0.5 degrees per pixel), wrapped to -180..180 like the slider
    screen.addEventListener('pointermove', moveDrag);
    screen.addEventListener('pointerup', () => endModuleDrag(true));
    screen.addEventListener('pointercancel', () => endModuleDrag(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dragState) { e.stopPropagation(); endModuleDrag(false); } }, true);
    let drag = null;
    stage.style.touchAction = 'none'; stage.style.cursor = 'ew-resize';
    stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw }; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      yaw = ((Math.round(drag.yaw + (e.clientX - drag.x) * 0.5) + 540) % 360) - 180;
      yawIn.value = yaw; render();
    });
    const endDrag = () => { if (drag) { drag = null; persist(); } };
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
    ttEl = div('cz-pv-tt');
    if (full) {
      api.bar.append(head);
      root.append(stage);
      if (api.tooltip) api.tooltip.append(ttEl);
    } else {
      root.append(head, stage, yawRow, div('cz-pv-cap', null, 'Hover tooltip'), ttEl,
        div('cz-hint', null, 'Drawn with game textures; the Pepe modules follow their packs\' layouts. Modules the preview does not know yet still appear as labelled boxes at their anchor and offset.'));
    }
    if (full) portraitMq.addEventListener('change', () => { canvasKey = ''; scheduleRender(); });
    if ('ResizeObserver' in window) { const ro = new ResizeObserver(resize); ro.observe(stage); if (full) ro.observe(root); }
    else window.addEventListener('resize', resize);
    const style = document.createElement('style');
    style.textContent = '.cz-own{outline:1px solid rgba(85,255,85,.6);outline-offset:2px;animation:cz-own-pulse 2s ease-in-out infinite}' +
      '@keyframes cz-own-pulse{50%{outline-color:rgba(85,255,85,0)}}';
    document.head.append(style);
    render();
    setInterval(tickLive, 400);
  }

  // hotspot(g): the on-screen box of a settings group, so a popover opened from the module list can sit beside it
  const hotspot = (g) => (screen ? [...screen.querySelectorAll('.czu-hit')].find((b) => b.getAttribute('aria-label') === 'Edit ' + g) || null : null);
  window.CzPreview = { init, update: scheduleRender, ui: () => lastUi, select, hotspot };
})();
