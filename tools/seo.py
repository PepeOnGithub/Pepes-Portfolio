#!/usr/bin/env python3
"""Build-time SEO for the single-page site (run by the deploy workflow on _site/).

GitHub Pages serves a 404 status for every /pack/<slug> path (they are routes of the SPA, not files), so
search engines would never index a pack page. This writes a real HTML file per page, built from index.html:

  _site/pack/<slug>.html   one per library pack and per approved community pack, served with 200 at /pack/<slug>
  _site/<page>.html        library, projects, socials, customizer (+ noindex copies for settings, stats, upload)
  _site/og/<slug>.png      1200x630 link-preview image for every pack (Discord, X, WhatsApp, Google Discover)
  _site/sitemap.xml        every page and pack with lastmod and the pack image
  _site/robots.txt

Each page gets its own <title>, description, canonical, Open Graph / Twitter tags, JSON-LD (SoftwareApplication with
rating when there is one, BreadcrumbList) and a <noscript> block with the text and links, so the first byte of HTML
already says what the page is. The app then takes over exactly as before.

The download address is never written into any of it: downloads stay behind the site's download gate.
"""
import html
import json
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SITE = 'https://pepe.glacierclient.xyz'
UPLOADS_API = 'https://pepes-portfolio-uploads.pepeoncloudeflare.workers.dev'
ACCOUNTS_API = 'https://pepes-portfolio-api.pepeoncloudeflare.workers.dev'
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '_site')
SRC = Path(sys.argv[2] if len(sys.argv) > 2 else '.')

# what a visitor searching for this kind of thing types: "<noun> for Minecraft Bedrock"
CATS = {
    'packs': ('HUD & Texture Packs', 'HUD pack', 'Minecraft Bedrock HUD and texture packs: clean, customizable HUDs, UI and resource packs.'),
    'addons': ('Addons', 'addon', 'Minecraft Bedrock addons (.mcaddon) that add new items, blocks and mechanics.'),
    'clients': ('Clients', 'client', 'Minecraft Bedrock clients with a better HUD, FPS counter and quality-of-life features.'),
    'apps': ('In-game Apps', 'in-game app', 'Working apps you can open inside Minecraft Bedrock: calculator, clock, notes and more.'),
    'cosmetics': ('Cosmetics', 'cosmetic pack', 'Cosmetic packs for Minecraft Bedrock: halos, overlays and effects.'),
    'utility': ('Utility Packs', 'utility pack', 'Utility resource packs for Minecraft Bedrock that make the game easier to read and use.'),
    'website': ('Tools', 'tool', 'Web tools for Minecraft Bedrock pack creators.'),
    'other': ('Other', 'pack', 'More Minecraft Bedrock packs.'),
}
PAGES = {
    'library': ('Minecraft Bedrock Pack Library: free HUD packs, addons & clients',
                'Browse and download free Minecraft Bedrock packs: HUD and texture packs, addons (.mcaddon), clients and in-game apps. Updated regularly, with ratings, screenshots and a live customizer.'),
    'customizer': ('Minecraft Bedrock HUD Customizer: move, resize and recolor your HUD',
                   'Customize your Minecraft Bedrock HUD live in the browser. Drag modules, change colors and sizes, then download the settings for the Assets Pack.'),
    'projects': ('Projects by Pepe: Minecraft Bedrock packs, clients & tools', 'Everything Pepe has built for Minecraft Bedrock: packs, Glacier Client, tools and websites.'),
    'socials': ('Pepe on YouTube, Discord, X and GitHub', 'Follow Pepe, the Minecraft Bedrock pack creator behind Glacier Client, on YouTube, Discord, X, Instagram, TikTok and GitHub.'),
}
NOINDEX = {'settings': 'Settings', 'stats': 'Stats', 'upload': 'Upload a pack'}


def esc(t):
    return html.escape(str(t if t is not None else ''), quote=True)


def slug_of(p):
    if p.get('slug'):
        return p['slug']
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', (p.get('name') or f"pack-{p.get('id')}").lower()))


def fetch_json(url, timeout=12):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'pepe-site-seo-build'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:  # network trouble must never fail a deploy
        print(f'  (skipped {url}: {e})')
        return None


def trim(text, n):
    text = re.sub(r'\s+', ' ', str(text or '')).strip()
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(' ', 1)[0].rstrip(',;:.-')
    return cut + '…'


def iso(s):
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%Y-%m-%d')
    except Exception:
        return None


def abs_url(u):
    if not u:
        return ''
    if u.startswith('http'):
        return u
    return f'{SITE}/{u.lstrip("/")}'


# ---------- head rewriting ----------
def set_tag(doc, pattern, new, after_head=True):
    """Replace the first tag matching pattern, or add `new` just before </head>."""
    if re.search(pattern, doc, flags=re.I):
        return re.sub(pattern, lambda m: new, doc, count=1, flags=re.I)
    return doc.replace('</head>', f'  {new}\n</head>', 1)


def head(doc, *, title, desc, path, image, kind='website', robots='index, follow', ld=None, lastmod=None):
    url = f'{SITE}{path}'
    doc = set_tag(doc, r'<title>.*?</title>', f'<title>{esc(title)}</title>')
    doc = set_tag(doc, r'<meta name="description"[^>]*>', f'<meta name="description" content="{esc(desc)}">')
    doc = set_tag(doc, r'<meta name="robots"[^>]*>', f'<meta name="robots" content="{robots}">')
    doc = re.sub(r'\s*<meta property="og:[^>]*>', '', doc)
    doc = re.sub(r'\s*<meta name="twitter:[^>]*>', '', doc)
    doc = re.sub(r'\s*<link rel="canonical"[^>]*>', '', doc)
    og = [
        f'<link rel="canonical" href="{esc(url)}">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        f'<meta property="og:type" content="{kind}">',
        f'<meta property="og:url" content="{esc(url)}">',
        '<meta property="og:site_name" content="Pepe\'s Portfolio">',
        '<meta property="og:locale" content="en_US">',
        f'<meta property="og:image" content="{esc(image)}">',
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(title)}">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        f'<meta name="twitter:image" content="{esc(image)}">',
    ]
    if lastmod:
        og.append(f'<meta property="article:modified_time" content="{esc(lastmod)}">')
    block = '\n  '.join(og)
    if ld:
        for item in ld:
            block += f'\n  <script type="application/ld+json">{json.dumps(item, ensure_ascii=False, separators=(",", ":"))}</script>'
    return doc.replace('</head>', f'  {block}\n</head>', 1)


def noscript(doc, inner):
    return re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + f'\n<noscript><div class="seo-static" style="padding:24px;max-width:900px;margin:0 auto;color:#fff;font-family:sans-serif">{inner}</div></noscript>', doc, count=1)


def breadcrumbs(items):
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': f'{SITE}{p}'} for i, (n, p) in enumerate(items)]}


# ---------- link-preview images ----------
def og_image(out, name, noun, icon_path, size='', author='Pepe'):
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageFilter
    except Exception:
        return False
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), '#1e2124')
    px = img.load()
    for y in range(H):  # soft diagonal-ish gradient
        for x in range(0, W, 4):
            t = (x / W * .6 + y / H * .4)
            c = (int(27 + 11 * t), int(42 - 6 * t), int(33 - 2 * t))
            for k in range(4):
                if x + k < W:
                    px[x + k, y] = c
    d = ImageDraw.Draw(img)
    font_path = SRC / 'assets' / 'fonts' / 'gyroscope-mojang-f.otf'

    def font(sz, bold=False):
        for p in ['/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] + ([str(font_path)] if font_path.exists() else []):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                continue
        return ImageFont.load_default(sz)
    # icon
    ix, iy, isz = 72, 86, 200
    d.rounded_rectangle((ix - 6, iy - 6, ix + isz + 6, iy + isz + 6), 44, outline='#86d177', width=5, fill='#23262a')
    drew = False
    if icon_path and Path(icon_path).exists():
        try:
            ic = Image.open(icon_path).convert('RGBA').resize((isz, isz), Image.NEAREST)
            m = Image.new('L', (isz, isz), 0)
            ImageDraw.Draw(m).rounded_rectangle((0, 0, isz, isz), 38, fill=255)
            img.paste(ic, (ix, iy), m)
            drew = True
        except Exception:
            pass
    if not drew:
        f = font(110)
        ch = (name.replace("Pepe's ", '')[:1] or 'P').upper()
        d.text((ix + isz / 2, iy + isz / 2), ch, font=f, fill='#86d177', anchor='mm')
    # the circle logo, as in the site's default banner
    logo = SRC / 'assets' / 'pepe-profile.png'
    if logo.exists():
        try:
            L = Image.open(logo).convert('RGBA').resize((220, 220), Image.LANCZOS)
            m = Image.new('L', (220, 220), 0)
            ImageDraw.Draw(m).ellipse((0, 0, 219, 219), fill=255)
            glow = Image.new('RGBA', (300, 300), (72, 156, 73, 0))
            ImageDraw.Draw(glow).ellipse((20, 20, 280, 280), fill=(72, 156, 73, 90))
            gb = glow.filter(ImageFilter.GaussianBlur(28))
            img.paste(gb.convert('RGB'), (890, 70), gb.split()[3])
            img.paste(L, (930, 110), m)
        except Exception:
            pass
    # name, wrapped to 2 lines
    f = font(60)
    words, lines, cur = name.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) > 540 and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)
    y = 96
    for ln in lines[:2]:
        d.text((330, y), ln, font=f, fill='#ffffff')
        y += 78
    f2 = font(30)
    d.text((330, y + 10), f'Free {noun} for Minecraft Bedrock', font=f2, fill='#b4b8bd')
    # pills
    px_ = 72
    for label, fg, bg in ([(size, '#c7f0bd', '#24412d')] if size else []) + [('Free download', '#c7f0bd', '#24412d'), (f'by {author}', '#d4d7da', '#2b2e33')]:
        w = d.textlength(label, font=f2) + 44
        d.rounded_rectangle((px_, 392, px_ + w, 392 + 56), 28, fill=bg)
        d.text((px_ + 22, 392 + 28), label, font=f2, fill=fg, anchor='lm')
        px_ += w + 14
    d.rectangle((0, H - 88, W, H), fill='#161819')
    d.text((72, H - 44), 'pepe.glacierclient.xyz', font=font(34), fill='#ffffff', anchor='lm')
    d.text((W - 72, H - 44), 'Packs · Addons · Clients · Customizer', font=font(26), fill='#86d177', anchor='rm')
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)
    return True


def main():
    template = (ROOT / 'index.html').read_text(encoding='utf-8')
    data = json.loads((SRC / 'packs.json').read_text(encoding='utf-8'))
    packs = [dict(p, _src='library') for p in data['packs']]
    print(f'library packs: {len(packs)}')
    comm = fetch_json(f'{UPLOADS_API}/api/community/packs')
    if comm and comm.get('packs'):
        packs += [dict(p, _src='community') for p in comm['packs']]
        print(f'community packs: {len(comm["packs"])}')
    seen, urls = set(), []

    # ---- pack pages ----
    for p in packs:
        slug = slug_of(p)
        if not slug or slug in seen or p.get('discontinued') and False:
            continue
        seen.add(slug)
        cat = p.get('category') or 'packs'
        label, noun, _ = CATS.get(cat, CATS['packs'])
        name = re.sub(r'§.', '', p.get('name') or slug)
        author = p.get('author') or 'Pepe'
        tnoun = {'HUD pack': 'HUD Pack', 'in-game app': 'In-game App'}.get(noun, noun.title())
        title = f'{name} – Free Minecraft Bedrock {tnoun} Download'
        if len(title) > 62:
            title = f'{name} – Minecraft Bedrock {tnoun}'
        if len(title) > 62:
            title = trim(name, 55) + ' | Minecraft Bedrock'
        tail = f' Free {noun} for Minecraft Bedrock by {author}.'
        body = trim(p.get('description'), 158 - len(tail))
        if body and body[-1] not in '.!?…':
            body += '.'
        desc = (body + tail).strip()
        icon_rel = p.get('thumbnail') or ''
        local_icon = SRC / icon_rel if icon_rel and not icon_rel.startswith('http') else None
        icon_tmp = None
        if icon_rel.startswith('http'):
            try:
                icon_tmp = ROOT / 'og' / f'.{slug}.icon'
                icon_tmp.parent.mkdir(parents=True, exist_ok=True)
                req = urllib.request.Request(icon_rel, headers={'User-Agent': 'pepe-site-seo-build'})
                with urllib.request.urlopen(req, timeout=10) as r:
                    icon_tmp.write_bytes(r.read(2_000_000))
                local_icon = icon_tmp
            except Exception:
                local_icon = None
        og_path = ROOT / 'og' / f'{slug}.png'
        has_og = og_image(og_path, name, noun, local_icon, p.get('size') or '', author)
        if icon_tmp and icon_tmp.exists():
            icon_tmp.unlink()
        image = f'{SITE}/og/{slug}.png' if has_og else abs_url(icon_rel) or f'{SITE}/assets/pepe-profile.png'
        modified = iso(p.get('updatedAt')) or iso(p.get('addedAt'))
        path = f'/pack/{slug}'
        app = {
            '@context': 'https://schema.org', '@type': 'SoftwareApplication', 'name': name, 'description': trim(p.get('description'), 500),
            'url': f'{SITE}{path}', 'image': image, 'applicationCategory': 'GameApplication',
            'operatingSystem': 'Minecraft Bedrock Edition (Windows, Android, iOS, Xbox, Switch)',
            'inLanguage': 'en', 'isAccessibleForFree': True,
            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD', 'availability': 'https://schema.org/InStock'},
            'author': {'@type': 'Person', 'name': author},
        }
        if p.get('version'):
            app['softwareVersion'] = str(p['version'])
        if p.get('size'):
            app['fileSize'] = str(p['size'])
        if iso(p.get('addedAt')):
            app['datePublished'] = iso(p['addedAt'])
        if modified:
            app['dateModified'] = modified
        if p.get('tags'):
            app['keywords'] = ', '.join(t for t in p['tags'] if t)
        rating = fetch_json(f'{ACCOUNTS_API}/api/ratings/{slug}', timeout=6) if p.get('_src') in ('library', 'community') else None
        if rating and rating.get('count') and rating.get('average'):
            app['aggregateRating'] = {'@type': 'AggregateRating', 'ratingValue': round(float(rating['average']), 1), 'ratingCount': int(rating['count']), 'bestRating': 5, 'worstRating': 1}
        crumbs = breadcrumbs([('Home', '/'), ('Library', '/library'), (name, path)])
        doc = head(template, title=title, desc=desc, path=path, image=image, kind='article', ld=[app, crumbs], lastmod=modified)
        text = (f'<h1>{esc(name)}</h1><p>{esc(trim(p.get("description"), 600))}</p>'
                f'<p>Free {esc(noun)} for Minecraft Bedrock Edition by {esc(author)}. Version {esc(p.get("version") or "")} {esc(p.get("size") or "")}.</p>'
                f'<p><a href="/library">Browse all packs</a> · <a href="/customizer">HUD customizer</a> · <a href="/">Home</a></p>')
        doc = noscript(doc, text + '<p>JavaScript is needed to download this pack.</p>')
        out = ROOT / 'pack' / f'{slug}.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(doc, encoding='utf-8')
        urls.append((path, modified, '0.8', image))

    # ---- section pages ----
    listing = ''.join(f'<li><a href="/pack/{esc(slug_of(p))}">{esc(p.get("name"))}</a>: {esc(trim(p.get("description"), 90))}</li>' for p in packs)
    cat_blocks = ''
    for key, (label, noun, blurb) in CATS.items():
        items = [p for p in packs if (p.get('category') or 'packs') == key]
        if items:
            cat_blocks += f'<h2>{esc(label)}</h2><p>{esc(blurb)}</p><ul>' + ''.join(f'<li><a href="/pack/{esc(slug_of(p))}">{esc(p.get("name"))}</a></li>' for p in items) + '</ul>'
    default_og = f'{SITE}/og/default.png'
    banner = SRC / 'assets' / 'og-banner.png'  # the designed 3D-logo banner (see the "Embed banner" design board)
    (ROOT / 'og').mkdir(parents=True, exist_ok=True)
    if banner.exists():
        shutil.copyfile(banner, ROOT / 'og' / 'default.png')
    else:
        og_image(ROOT / 'og' / 'default.png', "Pepe's Pack Library", 'packs, addons & clients', SRC / 'assets' / 'pepe-profile.png')
    for pid, (title, desc) in PAGES.items():
        path = f'/{pid}'
        ld = [breadcrumbs([('Home', '/'), (title.split(':')[0], path)])]
        if pid == 'library':
            ld.append({'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': title, 'url': f'{SITE}{path}', 'mainEntity': {
                '@type': 'ItemList', 'numberOfItems': len(packs), 'itemListElement': [
                    {'@type': 'ListItem', 'position': i + 1, 'url': f'{SITE}/pack/{slug_of(p)}', 'name': p.get('name')} for i, p in enumerate(packs[:100])]}})
        doc = head(template, title=title, desc=desc, path=path, image=default_og, ld=ld)
        inner = f'<h1>{esc(title)}</h1><p>{esc(desc)}</p>' + (cat_blocks if pid in ('library', 'projects') else '')
        (ROOT / f'{pid}.html').write_text(noscript(doc, inner), encoding='utf-8')
        urls.append((path, None, '0.9' if pid in ('library', 'customizer') else '0.5', ''))
    for pid, label in NOINDEX.items():
        doc = head(template, title=f'{label} | Pepe', desc='Pepe\'s portfolio and Minecraft Bedrock pack library.', path=f'/{pid}', image=default_og, robots='noindex, follow')
        (ROOT / f'{pid}.html').write_text(doc, encoding='utf-8')

    # ---- home: keep index.html's own tags, add the link list and WebSite data ----
    home_ld = [{
        '@context': 'https://schema.org', '@type': 'WebSite', 'name': "Pepe's Portfolio", 'url': f'{SITE}/', 'inLanguage': 'en',
        'description': 'Free Minecraft Bedrock packs, addons, clients and a live HUD customizer by Pepe.',
        'potentialAction': {'@type': 'SearchAction', 'target': {'@type': 'EntryPoint', 'urlTemplate': f'{SITE}/library?q={{search_term_string}}'}, 'query-input': 'required name=search_term_string'},
    }, {
        '@context': 'https://schema.org', '@type': 'Organization', 'name': 'Glacier Client', 'url': 'https://glacierclient.xyz', 'founder': {'@type': 'Person', 'name': 'Pepe'},
        'logo': f'{SITE}/assets/glacier-icon.png',
    }]
    home = head(template, title="Pepe: Free Minecraft Bedrock HUD Packs, Addons & Clients",
                desc="Free Minecraft Bedrock packs by Pepe: HUD and texture packs, addons, clients and a live HUD customizer. Creator of Glacier Client.",
                path='/', image=default_og, ld=home_ld)
    home = noscript(home, "<h1>Pepe: Minecraft Bedrock packs, addons & clients</h1><p>Free packs, addons and clients for Minecraft Bedrock, and a live HUD customizer.</p>"
                          f'<ul>{listing}</ul>')
    (ROOT / 'index.html').write_text(home, encoding='utf-8')
    urls.insert(0, ('/', None, '1.0', default_og))

    # ---- sitemap + robots ----
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    rows = []
    for path, mod, pr, img in urls:
        rows.append('  <url>\n    <loc>%s%s</loc>\n    <lastmod>%s</lastmod>\n    <priority>%s</priority>\n%s  </url>' % (
            SITE, path if path != '/' else '/', mod or today, pr, f'    <image:image><image:loc>{esc(img)}</image:loc></image:image>\n' if img else ''))
    (ROOT / 'sitemap.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + '\n'.join(rows) + '\n</urlset>\n', encoding='utf-8')
    (ROOT / 'robots.txt').write_text(
        'User-agent: *\nAllow: /\n# the download gate and account pages are not content\nDisallow: /download/\nDisallow: /settings\nDisallow: /upload\n\n'
        f'Sitemap: {SITE}/sitemap.xml\n', encoding='utf-8')
    print(f'wrote {len(seen)} pack pages, {len(PAGES)} section pages, sitemap with {len(urls)} urls')


if __name__ == '__main__':
    main()
