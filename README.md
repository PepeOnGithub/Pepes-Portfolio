# Pepe's Portfolio

A personal site with four sections: Home (about), Projects, Socials, and a Library — a personal design pack management system with automatic pack indexing.

## 🧭 Site Structure

- **Home** — about, known/learning languages, socials, highlight cards
- **Projects** — links to tools and clients I've built
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
    ├── designs/
    │   ├── my-design-pack/
    │   │   └── pack.json          # Pack metadata
    │   └── another-design/
    ├── templates/
    └── resources/
```

## 🚀 Workflow: Adding Packs

### Step 1: Create Pack Folder
Create a folder in `packs/[category]/`:
```
packs/designs/modern-ui-kit/
```

### Step 2: Add pack.json Metadata
Create `packs/designs/modern-ui-kit/pack.json`:

```json
{
  "name": "Modern UI Kit",
  "description": "A modern and clean UI component library",
  "author": "Your Name",
  "version": "1.0.0",
  "thumbnail": "🎨",
  "tags": ["ui", "web", "components"],
  "category": "designs",
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
- `category` — One of: `designs`, `templates`, `resources`
- `license` — License type (optional)

### Step 3: Add Pack Files
Put your design files, components, etc. inside the pack folder:
```
packs/designs/modern-ui-kit/
├── pack.json
├── README.md
├── components/
├── assets/
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

## 🔍 Features

### Search
- Find packs by name, description, or tags
- Real-time filtering as you type

### Categories
- Filter by: Designs, Templates, Resources
- Shows pack count per category
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
- Designs: `🎨` `🖌️` `✏️` `📐`
- Templates: `🚀` `📄` `📋` `🎯`
- Resources: `✨` `📚` `🎭` `📦`

### Category Descriptions

- **designs** — UI kits, component libraries, design systems
- **templates** — Ready-to-use templates and starting points
- **resources** — Icons, fonts, colors, images, utilities

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
   - Create `.metadata.json` in pack folder to track:
   ```json
  {
    "downloads": 150,
    "last_updated": "2026-08-29"
  }
  ```

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
├── designs/
│   └── modern-ui-kit/
│       ├── pack.json
│       ├── README.md
│       ├── LICENSE
│       ├── components/
│       │   ├── buttons.css
│       │   ├── cards.css
│       │   └── typography.css
│       └── assets/
│           ├── icons/
│           └── images/
```

**pack.json:**
```json
{
  "name": "Modern UI Kit",
  "description": "Production-ready UI components with 50+ elements",
  "author": "Your Name",
  "version": "2.1.0",
  "thumbnail": "🎨",
  "tags": ["ui", "components", "css", "web"],
  "category": "designs"
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
