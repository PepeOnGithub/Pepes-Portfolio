# 📦 Pack Library

A personal design pack and resource management system built with a custom green-themed design language.

## 🎨 Design Language

This site uses a sophisticated color palette designed for optimal visual hierarchy and accessibility:

**Color Palette:**
- **Primary Accent**: `#489c49` (Green) - Used for highlights, CTAs, and active states
- **Light Gray**: `#424549` - Light neutral backgrounds
- **Medium Gray**: `#36393e` - Mid-tone neutrals
- **Dark Gray**: `#282b30` - Dark backgrounds
- **Darker Gray**: `#1e2124` - Primary background

The design system includes:
- Carefully crafted spacing scale
- Typography system with semantic sizing
- Shadow hierarchy for depth
- Smooth transitions and animations
- Responsive grid layouts
- Dark and light mode support

## 📁 Folder Structure

```
packs/
├── templates/       # Website templates and layouts
├── designs/         # Design files and components
├── resources/       # Icons, fonts, and other resources
└── README.md
```

## 🚀 Quick Start

1. **Add Your Packs**: Create folders and files in the `packs/` directory
2. **Update Pack Index**: Create/update the packs data
3. **Deploy**: Push to GitHub and your site updates automatically

## 📦 Adding Packs

### Manual Method (Simple)

Create a folder in `packs/[category]/[pack-name]/` with your pack files.

### Automated Method (Recommended)

Create a `packs.json` file in the root with your pack metadata:

```json
{
  "packs": [
    {
      "id": 1,
      "name": "Modern UI Kit",
      "category": "designs",
      "description": "A modern and clean UI component library",
      "thumbnail": "🎨",
      "tags": ["ui", "web", "components"],
      "version": "1.0.0",
      "size": "12.5 MB",
      "downloadUrl": "packs/designs/modern-ui-kit.zip",
      "previewUrl": "packs/designs/modern-ui-kit/"
    }
  ]
}
```

## 🔍 Features

- **Smart Search**: Search by name, description, or tags
- **Category Filtering**: Filter packs by type
- **Sorting Options**: Sort by name, date added, or popularity
- **Theme Toggle**: Dark/Light mode support
- **Responsive Design**: Works on all devices
- **Settings Panel**: Customize your experience

## 🎯 Workflow

1. **Create your pack** locally
2. **Add folder to** `packs/[category]/`
3. **Update pack metadata** in code or JSON
4. **Commit and push** to GitHub
5. **Site automatically** reflects new packs

## 💻 Customization

### Change Colors
Edit the CSS variables in `styles.css`:

```css
:root {
  --color-accent: #489c49;        /* Green */
  --color-accent-dark: #3a7a3b;   /* Dark Green */
  --color-accent-light: #5fb35f;  /* Light Green */
  /* ... etc */
}
```

### Add New Pack Categories
Update the filter dropdown in `index.html` and add corresponding cases in `script.js`.

### Customize Pack Card Display
Modify the `createPackCard()` method in `script.js` to add/remove fields.

## 📝 Notes

- Use emoji or image URLs for pack thumbnails
- Keep pack sizes reasonable
- Use meaningful tags for better discoverability
- Update version numbers when releasing new packs
- Add preview URLs so users can see what they're getting

## 🔗 Links

- GitHub: [Your Repo URL]
- Live Site: [Your Domain]

## 📄 License

All packs and resources are personal/proprietary unless otherwise stated.

---

Built with 💚 using a custom design language
