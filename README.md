# Pepe's Portfolio

A personal site with three tabs: Home (about), Socials, and a Library — a personal MCBE pack management system with automatic pack indexing. Projects live on Home as cards, not their own tab.

## 🧭 Site Structure

- **Home** — hero, bio, known/learning languages, and cards into Projects and the Library
- **Projects** *(reached via a card on Home)* — every brand, client, and tool in one place
- **Socials** — Discord, YouTube, GitHub, PayPal, MCPEDL, CurseForge
- **Library** — the pack browser documented below

## 🎨 Design Language

Custom color palette for optimal visual hierarchy:

- **Primary Accent**: `#489c49` (Green) — highlights, CTAs, active states
- **Light Gray**: `#424549` — light neutral backgrounds
- **Medium Gray**: `#36393e` — mid-tone neutrals
- **Dark Gray**: `#282b30` — dark backgrounds  
- **Darker Gray**: `#1e2124` — primary background

Features:
- Responsive sidebar + main content layout
- Smooth animations and transitions
- Dark mode (default) + Light mode
- Professional pack cards with metadata
- Smart search and category filtering
- Category counts and author attribution

## 📁 Folder Structure

```
├── index.html          # Main page
├── styles.css          # Design system
├── script.js           # Client-side app logic
├── generator.py        # Auto-index generator
├── packs.json          # Generated pack index (DO NOT EDIT)
├── README.md           # This file
└── packs/              # Your pack storage
    ├── packs/
    │   ├── my-texture-pack/
    │   │   └── pack.json          # Pack metadata
    │   └── another-pack/
    ├── clients/
    ├── addons/
    ├── website/
    └── other/
```

## 🚀 Workflow: Adding Packs

### Step 1: Create Pack Folder
Create a folder in `packs/[category]/`:
```
packs/packs/nyxora-texture-pack/
```

### Step 2: Add pack.json Metadata
Create `packs/packs/nyxora-texture-pack/pack.json`:

```json
{
  "name": "Nyxora Texture Pack",
  "description": "A vibrant texture pack overhauling terrain, mobs, and UI",
  "author": "Your Name",
  "version": "1.0.0",
  "thumbnail": "📦",
  "tags": ["texture", "pack", "mcbe"],
  "category": "packs",
  "license": "MIT"
}
```

**Supported Fields:**
- `name` — Pack display name
- `description` — Brief description
- `author` — Your name/username
- `version` — Version number (e.g., "1.0.0")
- `thumbnail` — Emoji or image URL (use emoji for simplicity)
- `tags` — Search keywords
- `category` — One of: `packs`, `clients`, `addons`, `website`, `other`
- `license` — License type (optional)

### Step 3: Add Pack Files
Put your pack files, configs, etc. inside the pack folder:
```
packs/packs/nyxora-texture-pack/
├── pack.json
├── README.md
├── textures/
└── license.txt
```

### Step 4: Run Generator
Generate the index:

```bash
python generator.py
```

This scans `packs/` and updates `packs.json`. It also:
- Calculates pack sizes
- Counts files
- Generates `sitemap.xml` for SEO
- Updates category counts

### Step 5: Deploy
Commit and push to GitHub:

```bash
git add -A
git commit -m "Add new design pack: Modern UI Kit"
git push origin main
```

Your site updates automatically with the new pack!

## 🎨 Banners

Every card and detail page shows the pack name as Minecraft-style splash
text over a banner image:

- Drop a **`pack_banner.png`** into a pack's folder to use it as that pack's
  own banner (falls back to `bg.png` if that's what's there).
- Otherwise, the sitewide default banner at **`assets/default-banner.png`**
  is used — add that file once and every pack without its own banner picks
  it up automatically.

The splash text uses "Gyroscope Mojang F" by Vyacheslav Kirnos
(CC BY-SA 3.0) — see `assets/fonts/license.txt`.

## 🗂️ Multiple Versions Per Pack

Drop more than one pack file (`.mcpack`/`.mcaddon`/`.zip`/etc) into the same
pack folder and the generator lists every one on the detail page, newest
first, each with its own size/date/Download button. The version number is
read from the filename (`My_Pack_V1.6.0.mcpack`) or, if there isn't one,
from the file's own `manifest.json`.

## 💰 Linkvertise

Every Download button (sidebar and each version row) routes through
Linkvertise before handing over the real file — same setup as ClientLibrary.
Configure it in `script.js`:

```js
const LINKVERTISE_USER_ID = 499358;
function isMonetizationOn() { return true; }
```

## 👥 Community Uploads

Anyone signed in can upload packs on `/upload`. Each upload is reviewed
before it appears in the library. Downloads of a community pack go through
the **uploader's own** Linkvertise id and/or LootLabs link, so they keep 100%
of what it earns. Pepe's own packs keep using `LINKVERTISE_USER_ID`.

How it fits together:

- `worker/` is a second Cloudflare Worker (`pepes-portfolio-uploads`). It
  stores files in R2 and pack data in D1. It doesn't have its own accounts:
  it checks who is signed in by passing the visitor's session token to the
  existing `pepes-portfolio-api` worker's `/api/session`.
- `upload.js` and `css/upload.css` are the Upload page (new upload, My
  uploads, review queue), the Packs list on profiles, and uploader links.
- `script.js` merges approved community packs into the library
  (`loadCommunityPacks`) and credits the right account (`lvIdFor`).
- New packs, new versions, and edits to a live pack's name, icon, LootLabs
  link or video wait for review. Description, tags and Linkvertise id edits
  go live straight away.
- LootLabs: My uploads → LootLabs setup shows a destination link
  (`/download/<token>` around the worker's `/dl/<id>`), which always points
  at the newest approved version.

### Creator tools

Signed-in creators manage everything from the **Upload** page, under
**Profile & earnings**:

- **Earnings:** enter your Linkvertise user id and/or your LootLabs API
  token once. The token is encrypted in the worker and never shown again.
  Every download of your packs is then routed through your own accounts, and
  the worker creates a LootLabs link for every live version (same settings as
  Pepe's packs in `generator.py`). Creators never paste links.
- **Public profile:** a short bio, up to 8 links (Discord, YouTube, X, TikTok,
  Twitch, Instagram, GitHub, Patreon, Ko-fi, MCPEDL, Bluesky, website, at most
  2 per platform), and up to 3 featured YouTube videos. These show on the
  creator's profile page and a few links appear on each of their pack pages.
  Discord invites are checked live (server name, size, expired or
  age-restricted), and YouTube videos are checked to exist.
- **Stats** (Stats page, **My packs**): downloads, views, views-to-downloads,
  all-time totals, daily chart for 7/30/90 days, per-version counts, average
  rating, rank among creators and a CSV export. Each visitor counts once per
  pack per day, and the owner's and reviewers' own downloads don't count.
- **Automatic review of profiles:** bios, links and videos go through the
  same AI reviewer. Anything that breaks the rules is removed and the creator
  sees why.

### AI reviewer (how decisions are made)

Everything in `worker/src/` is automatic. The site owner doesn't have to
review anything.

1. `scan.js` opens every archive (nested archives too, `.brarchive` included)
   and applies hard rules. Any of these rejects the upload immediately with
   the reason: program files (by name or by content), a file called
   `content.zipe` (the hidden-script marker from the Glacier security alert),
   scripts inside resource packs, archives hidden under other names, path
   tricks, scripts that use eval, network, webhooks, Node.js APIs or
   shorteners, encrypted packs, and impersonation of protected names.
2. `ai.js` sends the pack to **Gemini Flash-Lite** (`GEMINI_MODEL`). It gets
   the details, file list, manifests, scripts, text, the icon, and the
   teaching material in `knowledge.js`: the security alert, what normal
   Bedrock packs look like, the decision policy and worked examples.
3. If that approves with at least 70% confidence, a second pass runs on
   **Gemini Flash** (`GEMINI_MODEL_STRICT`), told to think like an attacker.
   Both must approve, otherwise the pack is rejected with a reason the
   creator can read.
4. `AI_AUTO_APPROVE` and `AI_AUTO_REJECT` (both `"1"` by default) let the AI
   publish or reject on its own. Set them to `"0"` to have the AI only advise.
5. If Gemini is unreachable, the upload waits and a cron job (every 10
   minutes) retries it. The Review tab shows the decisions and lets you
   override any of them.

Tune strictness in `worker/src/knowledge.js`. Keep examples consistent with
the policy.

### Setup for creator tools

Beyond the first-time setup below, set one more secret:

```powershell
cd worker
npx wrangler secret put TOKEN_KEY
```

Use a long random string and never change it afterwards, or saved LootLabs
tokens become unreadable. Migrate an existing database once with
`migrations/0003_creators.sql`, then run `npm run db:remote` to create the new
tables.

### First-time setup (needs your Cloudflare login)

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 create pepes-portfolio-uploads
```

Put the printed `database_id` into `worker/wrangler.toml`. R2 has to be
turned on in the Cloudflare dashboard first, and Cloudflare asks for a
payment method to do that. The free allowance is 10 GB of storage. Then:

```powershell
npx wrangler r2 bucket create pepes-portfolio-uploads
npm run db:remote
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
```

After that, pushes that change `worker/` deploy it automatically through
`.github/workflows/deploy-worker.yml`. That workflow uses the repo secrets
`CLOUDFLARE_API_TOKEN`, which needs Workers Scripts, D1 and R2 edit access,
and `GEMINI_API_KEY`, which it copies into the worker on every deploy.

A database created before the AI reviewer existed needs
`npx wrangler d1 execute pepes-portfolio-uploads --remote --file=migrations/0002_ai_review.sql`
once.

To review uploads, open `/upload` while signed in, copy the account id at
the bottom, put it in `ADMIN_IDS` in `worker/wrangler.toml` and deploy
again. A **Review** tab appears.

### Testing locally

```powershell
cd worker
npm run db:local
npm run dev
```

`worker/.dev.vars` turns on test logins: in the site's browser console run
`localStorage.uploadsApi = 'http://127.0.0.1:8787'` and
`localStorage.sessionToken = 'dev:dev-admin:pepe'`, then open `/upload`.
Remove both keys afterwards. To test the AI locally, pass the key on the
command line, because wrangler may ignore it in `.dev.vars`:
`npx wrangler dev --port 8787 --var GEMINI_API_KEY:<key>`.

## 🌐 Website Category (Special Behavior)

Packs in the `website` category skip the detail page entirely — clicking
the card opens the site directly (in a new tab, unless "Open Links in
New Tab" is off in Settings).

To add one, no `pack.json` is required. Just create a folder with:

```
packs/website/glacier-client/
├── glacierclient.xyz     ← empty file; the filename IS the link
├── icon.png               ← card thumbnail
└── bg.png                 ← optional banner (unused since there's no detail page)
```

The generator treats any file in the folder that isn't `pack.json`,
`icon.png`, `bg.png`, or a known doc file (README/LICENSE) as the link
file — its filename becomes `https://<filename>`. Run `python generator.py`
afterward to pick it up. You can still add a `pack.json` alongside these
files for a custom name/description/tags; otherwise the folder name is
used.

## 🔍 Features

### Search
- Find packs by name, description, or tags
- Real-time filtering as you type

### Categories
- Filter by: Packs, Clients, Addons, Website, Other
- Shows pack count per category
- The "All" view groups results by category with a divider line and label
- One-click filtering

### Sorting
- **Name (A-Z)** — alphabetical
- **Recently Added** — newest first
- **Most Downloads** — most popular

### Theme
- Dark mode (default) for late-night browsing
- Light mode for daytime
- Settings panel for preferences

### Metadata Display
- Pack name and description
- Author attribution
- Download count
- Pack size
- Version number
- Tags/keywords

## 📝 Pack Metadata Reference

### Thumbnail Options

**Use Emoji (Recommended):**
```json
"thumbnail": "🎨"
```

**Use Image URL:**
```json
"thumbnail": "https://example.com/image.png"
```

**Available Emoji for Common Types:**
- Packs: `📦` `🎨` `🖌️`
- Clients: `🛡️` `⚙️` `🧊`
- Addons: `✨` `🧩` `🔮`
- Website: `🌐` `💻` `🔗`
- Other: `📄` `🎭` `🚀`

### Category Descriptions

- **packs** — Texture/resource packs
- **clients** — MCBE client builds and configs
- **addons** — Behavior pack addons and mods
- **website** — Site source code and web tools
- **other** — Everything else (capes, misc tools, resources)

## 🔄 Generator Script

The `generator.py` script automates index management:

```bash
# Scan and update index
python generator.py

# Check for missing metadata
python generator.py --validate
```

**What it does:**
1. Scans `packs/` directory
2. Reads `pack.json` from each folder
3. Calculates directory sizes
4. Updates `packs.json` with all metadata
5. Generates `sitemap.xml` for search engines
6. Reports any issues or missing data

**Use Cases:**
- After adding new packs
- Before deploying to production
- In CI/CD pipeline for automation

## 🎯 Best Practices

1. **Naming Convention**
   - Use kebab-case for folder names: `modern-ui-kit` ✅ not `Modern UI Kit`
   - Use meaningful names that describe the pack

2. **Metadata Quality**
   - Write clear, concise descriptions (2-3 sentences)
   - Include relevant tags for discoverability
   - Use emoji thumbnails for consistency

3. **Pack Organization**
   - Keep related files together in the pack folder
   - Include a `README.md` with usage instructions
   - Add `LICENSE` file for legal clarity

4. **Versioning**
   - Use semantic versioning: `MAJOR.MINOR.PATCH`
   - Increment when adding features or fixes
   - Use `1.0.0` for initial release

5. **Downloads Tracking**
   - `.metadata.json` in a pack folder sets the *starting* count picked up by the generator:
   ```json
  {
    "downloads": 150,
    "last_updated": "2026-08-29"
  }
  ```
   - From there, downloads count up live in the browser — no server or
     Cloudflare Worker needed. Every click on a pack's Download button
     calls a free public counter ([abacus](https://jasoncameron.dev/abacus/)),
     which persists and increments the count globally. The pack detail
     page fetches the current live count on load and falls back to the
     static seed number above until the first real click happens.

## 🌐 Deployment

### GitHub Pages
1. Push to GitHub repository
2. Enable GitHub Pages in repo settings
3. Site auto-deploys to your domain

### Custom Domain
Add your domain in `CNAME` file (already configured)

### CI/CD
Add to your workflow to auto-generate index:

```yaml
- name: Update Pack Index
  run: python generator.py
```

## 📊 Analytics

After deploying, you can track:
- Total packs available
- Downloads per pack
- Popular categories
- User searches

The generator creates `sitemap.xml` for search engine indexing.

## 🛠️ Customization

### Change Colors
Edit `styles.css` CSS variables:

```css
:root {
  --color-accent: #489c49;      /* Your brand color */
  --color-bg-primary: #1e2124;  /* Background */
}
```

### Modify Layout
- Sidebar width: `--sidebar-width: 280px`
- Grid columns: `grid-template-columns`
- Spacing: `--spacing-*` variables

### Add Fields
Edit `script.js` `createPackCard()` method to display additional metadata.

## 📖 Example: Full Pack Setup

```
packs/
├── packs/
│   └── nyxora-texture-pack/
│       ├── pack.json
│       ├── README.md
│       ├── LICENSE
│       └── textures/
│           ├── blocks/
│           └── ui/
```

**pack.json:**
```json
{
  "name": "Nyxora Texture Pack",
  "description": "A vibrant texture pack overhauling terrain, mobs, and UI",
  "author": "Your Name",
  "version": "2.1.0",
  "thumbnail": "📦",
  "tags": ["texture", "pack", "mcbe"],
  "category": "packs"
}
```

## ❓ FAQ

**Q: Can I have nested categories?**
A: No, but you can use tags for more detailed organization.

**Q: How often should I run the generator?**
A: After adding/removing packs, or set it up in CI/CD to run automatically.

**Q: Can I customize the pack card display?**
A: Yes! Edit the `createPackCard()` method in `script.js`.

**Q: How do I track pack downloads?**
A: Add `.metadata.json` file in each pack folder.

## 📞 Support

For issues or questions:
1. Check the pack.json format matches the template
2. Ensure generator.py ran successfully
3. Verify packs.json was updated

## 📄 License

Pack Library generator is MIT licensed.  
Individual packs have their own licenses (specified in pack.json).

---

**Built with 💚** using a custom design language

## Assets Pack customizer

`customizer.html` lets visitors change the settings in Pepe's Assets Pack (`ui/_global_variables.json`) and download their own build.
The form is generated from the latest Assets Pack, so it updates itself:

- `tools/update_customizer.py` reads the variables out of the Assets Pack listed in `packs.json` and writes `customizer-data.json`
  (the deploy workflow runs it after `generator.py`; run it by hand after adding a new Assets Pack version).
- `customizer-meta.json` is optional: it gives friendly labels, groups and limits to known variables. Variables that are not listed
  there still appear, labelled and grouped from their names (`hide_*` = a Show toggle, `*_opacity` = slider, `*_offset` = X/Y, `*_anchor` = dropdown).
- Only the settings a visitor changed are written into the download; everything else stays as shipped, and their saved choices
  are kept per browser, so new defaults in a later Assets Pack still apply to what they did not touch.

The customizer also draws a live HUD preview (`customizer-preview.js`) in PC and Mobile layouts. It runs the game's own UI files
through a JSON UI interpreter (`customizer-ui.js`): the vanilla HUD from Mojang's `bedrock-samples` with every Pepe pack stacked on
top, the customizer settings as the packs' `$variables`. It handles element merging, `modifications` and `element/child` patches,
inheritance, variables with `|default`, `variables`/`requires`, factories, grids over collections, global / collection / view
bindings (with JSON UI's string operators and `('#k' + #id)` property-bag lookups), sizes in every unit, anchors, stack panels,
nine-slice / uv / clipped / tinted images, labels with `§` formatting and glyph-page characters. What the game draws in code
(hearts, hunger, hotbar items, the player-entity readouts such as FPS digits and the compass tape) comes from hooks in the preview.

The customizer is a full-screen editor: the HUD fills the page at the platform's screen ratio, and clicking a module on it opens that module's settings in a popover (a side or bottom sheet on phones). The interpreter records which `$variables` place or show each control (`node.uses`), and the preview turns those into click targets per settings group. Every module, including ones with nothing on screen, is also listed under Modules (`/`). On phones and tablets the editor is landscape-only: held upright they show a rotate prompt (with a fullscreen + `screen.orientation.lock` button where supported) and nothing is rendered behind it.

Performance notes for `customizer-ui.js`: resolved elements and tokenized expressions are memoised, variable scopes inherit by prototype, `substitute` copies only what a `$variable` changes, `source_control_name` lookups use a preorder name index, and layout skips a subtree whose sizing inputs match its last pass. A full HUD render (about 3,200 controls) takes about 110 ms, down from about 1.1 s, with identical output.

- `tools/build_ui_bundle.py --samples <bedrock-samples zip>` rebuilds `assets/ui/vanilla.json` (only the HUD's reachable elements)
  and its textures; run it again when a new Minecraft version changes the HUD. Without `--samples` it only rebuilds the pack
  bundles (`assets/ui/pack-<id>@<version>.json`) and their textures from `packs/`, which the deploy workflow does every time.
- The sample hotbar compares numeric item ids (`NUM` in `customizer-preview.js`); update them if a game update renumbers items.
- If the bundles cannot load, the preview falls back to the older hand-drawn layout.
