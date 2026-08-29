#!/usr/bin/env python3
"""
Pack Library Generator
Scans the packs/ directory and generates packs.json index.
Run this after adding new packs to update the library.
"""

import os
import json
import re
import sys
import zipfile
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
        'author': 'Pepe'
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

# Files that are never treated as the "link file" for a website pack
KNOWN_FILES = {
    'pack.json', 'icon.png', 'bg.png', '.metadata.json',
    'readme.md', 'license', 'license.txt'
}

ASSET_EXTENSIONS = ('.zip', '.mcpack', '.mcaddon', '.mcworld', '.mctemplate')
VERSION_IN_FILENAME = re.compile(r'[Vv](\d+(?:\.\d+)*)')

def version_key(filename):
    """Extract a sortable version tuple from a filename; unversioned files sort as 1.0.0."""
    m = VERSION_IN_FILENAME.search(filename)
    if not m:
        return (1, 0, 0)
    parts = [int(p) for p in m.group(1).split('.')]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])

def read_version_from_archive(path):
    """Fallback for files with no version in their filename: read it from
    the pack's own manifest.json inside the archive."""
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            manifest_name = 'manifest.json'
            if manifest_name not in names:
                # nested .mcaddon structure
                for n in names:
                    if n.endswith('manifest.json'):
                        manifest_name = n
                        break
                else:
                    return None
            with zf.open(manifest_name) as f:
                manifest = json.load(f)
            v = manifest.get('header', {}).get('version')
            if isinstance(v, str):
                return v
            if isinstance(v, list):
                return '.'.join(str(x) for x in v)
    except Exception:
        pass
    return None

def format_size(num_bytes):
    if num_bytes >= 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.1f} MB"
    return f"{num_bytes / 1024:.1f} KB"

def find_asset_files(pack_path):
    """
    Find every downloadable pack file (.mcpack/.mcaddon/.zip/etc) in a pack
    folder, sorted newest version first. Supports multiple versions of the
    same pack living side by side in one folder.
    """
    files = [
        entry for entry in pack_path.iterdir()
        if entry.is_file() and entry.suffix.lower() in ASSET_EXTENSIONS
    ]
    files.sort(key=lambda e: version_key(e.name), reverse=True)
    return files

def find_link_file(pack_path):
    """
    For website packs: find a file whose name IS the link, e.g. a file
    literally named 'glacierclient.xyz' with no content. Returns the
    domain string (filename) or None if no such file exists.
    """
    for entry in pack_path.iterdir():
        if not entry.is_file():
            continue
        if entry.name.lower() in KNOWN_FILES:
            continue
        if entry.name.startswith('.'):
            continue
        # A link file has a dot (domain.tld) but isn't a recognized asset type
        if '.' in entry.name and entry.suffix.lower() not in (
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
            '.zip', '.json', '.md', '.txt', '.css', '.js', '.ico'
        ):
            return entry.name
    return None

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

            # icon.png / bg.png override the thumbnail/banner if present
            thumbnail = metadata.get('thumbnail', '📦')
            icon_path = pack_path / 'icon.png'
            if icon_path.exists():
                thumbnail = f'packs/{category}/{pack_path.name}/icon.png'

            banner_url = None
            bg_path = pack_path / 'bg.png'
            if bg_path.exists():
                banner_url = f'packs/{category}/{pack_path.name}/bg.png'

            # Prefer real pack file(s) (.mcpack/.mcaddon/etc) if present, so
            # downloads point at actual importable files and sizes are accurate.
            # Multiple versions can live side by side in one pack folder.
            asset_files = find_asset_files(pack_path)

            versions = []
            for f in asset_files:
                stat = f.stat()
                m = VERSION_IN_FILENAME.search(f.name)
                v_label = m.group(1) if m else (read_version_from_archive(f) or metadata.get('version', '1.0.0'))
                versions.append({
                    'version': v_label,
                    'fileName': f.name,
                    'size': format_size(stat.st_size),
                    'downloadUrl': f'packs/{category}/{pack_path.name}/{f.name}',
                    'date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d')
                })

            if versions:
                latest = versions[0]
                download_url = latest['downloadUrl']
                size_str = latest['size']
                file_name = latest['fileName']
                version_str = latest['version']
            else:
                download_url = f'packs/{category}/{pack_path.name}.zip'
                size_str = get_directory_size(pack_path)
                file_name = metadata.get('fileName')
                version_str = metadata.get('version', '1.0.0')

            # Build pack entry
            pack_entry = {
                'id': pack_id,
                'name': metadata.get('name', pack_path.name.replace('-', ' ').title()),
                'category': category,
                'description': metadata.get('description', f'A {category} pack'),
                'thumbnail': thumbnail,
                'tags': metadata.get('tags', [category]),
                'version': version_str,
                'downloads': count_downloads(pack_path),
                'size': size_str,
                'author': metadata.get('author', 'Pepe'),
                'downloadUrl': download_url,
                'previewUrl': f'packs/{category}/{pack_path.name}/'
            }

            if file_name:
                pack_entry['fileName'] = file_name

            if len(versions) > 1:
                pack_entry['versions'] = versions

            if banner_url:
                pack_entry['bannerUrl'] = banner_url

            if metadata.get('pinned'):
                pack_entry['pinned'] = True

            if metadata.get('notice'):
                pack_entry['notice'] = metadata['notice']

            # Website packs: a file named like a domain (e.g. "glacierclient.xyz",
            # empty content) supplies the external link
            if category == 'website':
                link_file = find_link_file(pack_path)
                if link_file:
                    pack_entry['externalUrl'] = f'https://{link_file}'
                    pack_entry['fileName'] = link_file

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
