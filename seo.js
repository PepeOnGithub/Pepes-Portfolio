// Keeps <title>, description, canonical and Open Graph tags right while the visitor moves around the app
// (the first page load already carries the right ones: see tools/seo.py). Loaded before script.js.
(function () {
  const SITE = 'https://pepe.glacierclient.xyz';
  const NOUN = { packs: 'HUD Pack', addons: 'Addon', clients: 'Client', apps: 'In-game App', cosmetics: 'Cosmetic Pack', utility: 'Utility Pack', website: 'Tool', other: 'Pack' };
  const PAGES = {
    home: ['Pepe: Free Minecraft Bedrock HUD Packs, Addons & Clients', 'Free Minecraft Bedrock packs by Pepe: HUD and texture packs, addons, clients and a live HUD customizer. Creator of Glacier Client.', '/'],
    library: ['Minecraft Bedrock Pack Library: free HUD packs, addons & clients', 'Browse and download free Minecraft Bedrock packs: HUD and texture packs, addons (.mcaddon), clients and in-game apps, with ratings and a live customizer.', '/library'],
    customizer: ['Minecraft Bedrock HUD Customizer: move, resize and recolor your HUD', 'Customize your Minecraft Bedrock HUD live in the browser. Drag modules, change colors and sizes, then download the settings for the Assets Pack.', '/customizer'],
    projects: ['Projects by Pepe: Minecraft Bedrock packs, clients & tools', 'Everything Pepe has built for Minecraft Bedrock: packs, Glacier Client, tools and websites.', '/projects'],
    socials: ['Pepe on YouTube, Discord, X and GitHub', 'Follow Pepe, the Minecraft Bedrock pack creator behind Glacier Client, on YouTube, Discord, X, Instagram, TikTok and GitHub.', '/socials'],
    settings: ['Settings | Pepe', "Pepe's portfolio and Minecraft Bedrock pack library.", '/settings', true],
    stats: ['Stats | Pepe', "Pepe's portfolio and Minecraft Bedrock pack library.", '/stats', true],
    upload: ['Upload a pack | Pepe', "Pepe's portfolio and Minecraft Bedrock pack library.", '/upload', true],
    user: ['Profile | Pepe', "Pepe's portfolio and Minecraft Bedrock pack library.", null, true],
  };
  const meta = (sel, attr, key, val) => {
    let el = document.head.querySelector(sel);
    if (!el) { el = document.createElement(attr === 'href' ? 'link' : 'meta'); key.split('|').forEach((kv) => { const [k, v] = kv.split('='); if (v) el.setAttribute(k, v); }); document.head.append(el); }
    el.setAttribute(attr, val);
  };
  function apply(title, desc, path, { image, noindex } = {}) {
    document.title = title;
    const url = path ? SITE + path : location.href.split('#')[0];
    meta('meta[name="description"]', 'content', 'name=description', desc);
    meta('meta[name="robots"]', 'content', 'name=robots', noindex ? 'noindex, follow' : 'index, follow');
    meta('link[rel="canonical"]', 'href', 'rel=canonical', url);
    meta('meta[property="og:title"]', 'content', 'property=og:title', title);
    meta('meta[property="og:description"]', 'content', 'property=og:description', desc);
    meta('meta[property="og:url"]', 'content', 'property=og:url', url);
    if (image) { meta('meta[property="og:image"]', 'content', 'property=og:image', image); meta('meta[name="twitter:image"]', 'content', 'name=twitter:image', image); }
  }
  const CATS = {
    packs: ['Minecraft Bedrock HUD Packs & Texture Packs: free downloads', 'Minecraft Bedrock HUD and texture packs: clean, customizable HUDs, UI and resource packs.'],
    addons: ['Minecraft Bedrock Addons (.mcaddon): free downloads', 'Minecraft Bedrock addons (.mcaddon) that add new items, blocks and mechanics.'],
    clients: ['Minecraft Bedrock Clients: free downloads', 'Minecraft Bedrock clients with a better HUD, FPS counter and quality-of-life features.'],
    apps: ['In-game Apps for Minecraft Bedrock: calculator, clock, notes', 'Working apps you can open inside Minecraft Bedrock: calculator, clock, notes and more.'],
    cosmetics: ['Minecraft Bedrock Cosmetic Packs: halos, overlays, effects', 'Cosmetic packs for Minecraft Bedrock: halos, overlays and effects.'],
    utility: ['Minecraft Bedrock Utility Packs: free downloads', 'Utility resource packs for Minecraft Bedrock that make the game easier to read and use.'],
    website: ['Minecraft Bedrock Tools for Pack Creators', 'Web tools for Minecraft Bedrock pack creators.'],
  };
  window.seo = {
    category(cat) { const c = CATS[cat]; if (!c) return this.page('library'); apply(c[0], c[1], '/library/' + cat, { image: SITE + '/og/default.png' }); },
    page(id) { const p = PAGES[id] || PAGES.home; apply(p[0], p[1], p[2], { image: SITE + '/og/default.png', noindex: !!p[3] }); },
    pack(pack) {
      const slug = pack.slug || (pack.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const noun = NOUN[pack.category] || 'Pack';
      let title = `${pack.name} – Free Minecraft Bedrock ${noun} Download`;
      if (title.length > 62) title = `${pack.name} – Minecraft Bedrock ${noun}`;
      const tail = ` Free ${noun.toLowerCase()} for Minecraft Bedrock by ${pack.author || 'Pepe'}.`;
      let body = String(pack.description || '').replace(/\s+/g, ' ').trim();
      if (body.length > 158 - tail.length) body = body.slice(0, 158 - tail.length).replace(/\s+\S*$/, '') + '…';
      else if (body && !/[.!?]$/.test(body)) body += '.';
      apply(title, body + tail, '/pack/' + slug, { image: SITE + '/og/' + slug + '.png' });
    },
  };
})();
