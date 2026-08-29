#!/usr/bin/env python3
"""
Pack Library Generator
Scans the packs/ directory and generates packs.json index.
Run this after adding new packs to update the library.
"""

import os
import json
import sys
from pathlib import Path
from datetime import datetime

# Fix emoji encoding on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def get_pack_metadata(pack_path):
    """Extract metadata from a pack directory."""
    pack_name = pack_path.name

    # Try to load pack.json if it exists
    pack_json_path = pack_path / 'pack.json'
    if pack_json_path.exists():
        try:
            with open(pack_json_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Could not read {pack_json_path}: {e}")

    # Generate default metadata
    return {
        'name': pack_name.replace('-', ' ').title(),
        'description': f'Pack: {pack_name}',
        'tags': [],
        'thumbnail': '📦',
        'author': 'You'
    }

def get_directory_size(path):
    """Calculate total size of directory."""
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            try:
                total_size += os.path.getsize(filepath)
            except (OSError, FileNotFoundError):
                pass

    # Convert to MB
    size_mb = total_size / (1024 * 1024)
    if size_mb < 1:
        return f"{total_size / 1024:.1f} KB"
    return f"{size_mb:.1f} MB"

def count_downloads(pack_path):
    """Count approximate downloads from metadata."""
    metadata_file = pack_path / '.metadata.json'
    if metadata_file.exists():
        try:
            with open(metadata_file, 'r') as f:
                data = json.load(f)
                return data.get('downloads', 0)
        except Exception:
            pass
    return 0

def generate_packs_json(packs_dir, output_file):
    """Scan packs directory and generate packs.json."""
    packs = []
    pack_id = 1

    categories = {}

    # Scan each category directory
    for category_path in sorted(packs_dir.iterdir()):
        if not category_path.is_dir() or category_path.name.startswith('.'):
            continue

        category = category_path.name
        categories[category] = []

        # Scan packs within the category
        for pack_path in sorted(category_path.iterdir()):
            if not pack_path.is_dir() or pack_path.name.startswith('.'):
                continue

            # Get metadata
            metadata = get_pack_metadata(pack_path)

            # Build pack entry
            pack_entry = {
                'id': pack_id,
                'name': metadata.get('name', pack_path.name.replace('-', ' ').title()),
                'category': category,
                'description': metadata.get('description', f'A {category} pack'),
                'thumbnail': metadata.get('thumbnail', '📦'),
                'tags': metadata.get('tags', [category]),
                'version': metadata.get('version', '1.0.0'),
                'downloads': count_downloads(pack_path),
                'size': get_directory_size(pack_path),
                'author': metadata.get('author', 'You'),
                'downloadUrl': f'packs/{category}/{pack_path.name}.zip',
                'previewUrl': f'packs/{category}/{pack_path.name}/'
            }

            packs.append(pack_entry)
            categories[category].append(pack_entry['name'])
            pack_id += 1

    # Write packs.json
    output = {
        'generated': datetime.now().isoformat(),
        'total_packs': len(packs),
        'categories': categories,
        'packs': packs
    }

    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"✅ Generated {output_file} with {len(packs)} packs")
        return True
    except Exception as e:
        print(f"❌ Error writing {output_file}: {e}")
        return False

def generate_sitemap(packs_json_path):
    """Generate sitemap.xml for SEO."""
    try:
        with open(packs_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        packs = data.get('packs', [])

        sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
        sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

        # Add homepage
        sitemap += '  <url>\n'
        sitemap += '    <loc>https://yoursite.com/</loc>\n'
        sitemap += f'    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>\n'
        sitemap += '    <priority>1.0</priority>\n'
        sitemap += '  </url>\n'

        # Add pack pages
        for pack in packs:
            sitemap += '  <url>\n'
            sitemap += f'    <loc>https://yoursite.com/#pack-{pack["id"]}</loc>\n'
            sitemap += f'    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>\n'
            sitemap += '    <priority>0.8</priority>\n'
            sitemap += '  </url>\n'

        sitemap += '</urlset>\n'

        sitemap_path = packs_json_path.parent / 'sitemap.xml'
        with open(sitemap_path, 'w', encoding='utf-8') as f:
            f.write(sitemap)
        print(f"✅ Generated sitemap.xml with {len(packs)} entries")
        return True
    except Exception as e:
        print(f"⚠️  Could not generate sitemap: {e}")
        return False

def main():
    """Main entry point."""
    script_dir = Path(__file__).parent
    packs_dir = script_dir / 'packs'
    packs_json = script_dir / 'packs.json'

    if not packs_dir.exists():
        print(f"❌ Packs directory not found: {packs_dir}")
        sys.exit(1)

    print("🔍 Scanning pack library...")
    if generate_packs_json(packs_dir, packs_json):
        generate_sitemap(packs_json)
        print("\n✨ Pack library updated successfully!")
    else:
        sys.exit(1)

if __name__ == '__main__':
    main()
