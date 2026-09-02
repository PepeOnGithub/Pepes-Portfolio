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
import subprocess
import zipfile
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

# Fix emoji encoding on Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ===== LootLabs integration (optional, build-time only) =====
# The LootLabs content-locker API requires a secret API token, so it can
# never be called from client-side JS without exposing that token to every
# visitor. Instead, links are generated once here (at build time) and the
# resulting loot_url is cached into packs.json / lootlabs_cache.json.
#
# To enable: set LOOTLABS_API_TOKEN (from the LootLabs panel -> Advanced tab)
# and SITE_BASE_URL (e.g. "https://pepe.example.com") as environment
# variables before running this script. Without both set, LootLabs link
# generation is skipped entirely and existing behavior is unchanged.
LOOTLABS_API_TOKEN = os.environ.get('LOOTLABS_API_TOKEN')
SITE_BASE_URL = os.environ.get('SITE_BASE_URL', '').rstrip('/')
LOOTLABS_CACHE_FILE = 'lootlabs_cache.json'

# ===== Git LFS-tracked downloads =====
# .mcpack/.mcaddon files are tracked with Git LFS (see .gitattributes) to
# keep the repo's regular git history small. GitHub Pages does NOT serve LFS
# content correctly (a Pages URL to an LFS file returns the small pointer
# text, not the real bytes), so download links for these extensions point at
# GitHub's LFS media endpoint instead of a relative site path.
GITHUB_REPOSITORY = os.environ.get('GITHUB_REPOSITORY', 'PepeOnGithub/Pepes-Portfolio')
GITHUB_REF_NAME = os.environ.get('GITHUB_REF_NAME', 'main')
LFS_TRACKED_EXTENSIONS = {'.mcpack', '.mcaddon'}


def to_download_url(relative_path):
    """Relative site path -> either itself, or (for LFS-tracked extensions)
    an absolute media.githubusercontent.com URL."""
    if Path(relative_path).suffix.lower() not in LFS_TRACKED_EXTENSIONS:
        return relative_path
    encoded = '/'.join(urllib.parse.quote(seg) for seg in relative_path.split('/'))
    return f'https://media.githubusercontent.com/media/{GITHUB_REPOSITORY}/{GITHUB_REF_NAME}/{encoded}'


def load_lootlabs_cache(cache_path):
    if cache_path.exists():
        try:
            return json.loads(cache_path.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}


def save_lootlabs_cache(cache_path, cache):
    try:
        cache_path.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding='utf-8')
    except Exception as e:
        print(f"  Warning: could not write {cache_path}: {e}")


def make_download_gate_url(raw_url):
    """Build a /download/<token> gate URL matching encodeDownloadToken() in
    script.js (t: 0 = no expiry, since these are baked once at build time and
    may be clicked long after). Routes LootLabs' redirect through our own
    page instead of the raw file, same anti-bypass reasoning as the
    client-side Linkvertise wrapping."""
    import base64
    payload = json.dumps({'u': raw_url, 't': 0}, separators=(',', ':'))
    token = base64.urlsafe_b64encode(payload.encode('utf-8')).decode('ascii').rstrip('=')
    return f"{SITE_BASE_URL}/download/{token}"


def fetch_lootlabs_link(title, target_url):
    """Call the LootLabs content-locker API for target_url. Returns the
    loot_url, or None if LootLabs isn't configured or the request fails.
    Pure network call - no cache access, so it's safe to run from a thread pool."""
    if not LOOTLABS_API_TOKEN:
        return None
    try:
        params = {
            'api_token': LOOTLABS_API_TOKEN,
            'title': title[:30],
            'url': target_url,
            'tier_id': '1',
            'number_of_tasks': '3',
            'theme': '1',
        }
        query = urllib.parse.urlencode(params)
        req_url = f'https://creators.lootlabs.gg/api/public/content_locker?{query}'
        with urllib.request.urlopen(req_url, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        # LootLabs may return the message as a dict or a list containing a dict.
        msg = data.get('message')
        if isinstance(msg, dict):
            loot_url = msg.get('loot_url')
        elif isinstance(msg, list) and len(msg) > 0 and isinstance(msg[0], dict):
            loot_url = msg[0].get('loot_url')
        else:
            loot_url = None
        if loot_url:
            return loot_url
        print(f"  Warning: LootLabs did not return a loot_url for '{title}': {data}")
    except Exception as e:
        print(f"  Warning: LootLabs link creation failed for '{title}': {e}")
    return None


def resolve_lootlabs_links(requests, cache, max_workers=8):
    """requests: list of (title, target_url) tuples. Fetches every url not
    already cached, in parallel (these are independent, latency-bound HTTP
    calls, so doing them one at a time serially is the slow part of a build
    with many packs/versions), and fills the results into `cache` in place."""
    to_fetch = {}
    for title, url in requests:
        if url not in cache and url not in to_fetch:
            to_fetch[url] = title
    if not to_fetch:
        return

    print(f"  Fetching {len(to_fetch)} LootLabs link(s), {max_workers} at a time...")
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {
            executor.submit(fetch_lootlabs_link, title, url): url
            for url, title in to_fetch.items()
        }
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            loot_url = future.result()
            if loot_url:
                cache[url] = loot_url

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

# Keyword -> tag lookup used to derive extra, descriptive tags from a pack's
# own name/description text (in addition to its category tag), so the
# library's tag filter has something more useful to filter on than "packs" /
# "addons" / etc.
KEYWORD_TAGS = [
    ('pvp', 'PvP'),
    ('crosshair', 'HUD'),
    ('hud', 'HUD'),
    ('damage indicator', 'Combat'),
    ('armor', 'Combat'),
    ('shader', 'Shaders'),
    ('shiny', 'Visual'),
    ('glow', 'Visual'),
    ('overlay', 'Visual'),
    ('animated', 'Animated'),
    ('texture', 'Textures'),
    ('sound', 'Audio'),
    ('music', 'Audio'),
    ('gui', 'UI'),
    ('inventory', 'UI'),
    ('hotbar', 'UI'),
    ('block', 'Building'),
    ('mob', 'Mobs'),
    ('entity', 'Mobs'),
    ('particle', 'Effects'),
    ('effect', 'Effects'),
    ('realistic', 'Realistic'),
    ('cape', 'Cosmetic'),
    ('skin', 'Cosmetic'),
    ('crop', 'Farming'),
    ('farm', 'Farming'),
    ('xp', 'Utility'),
    ('experience', 'Utility'),
    ('bundle', 'Utility'),
    ('magnet', 'Utility'),
    ('client', 'Client'),
]


def derive_tags(name, description, base_tags):
    """Merge a pack's explicit tags with extra tags inferred from keywords
    found in its own name/description, capped to keep the filter list tidy."""
    text = f'{name} {description}'.lower()
    tags = list(dict.fromkeys(base_tags))  # preserve order, dedupe
    for keyword, tag in KEYWORD_TAGS:
        if keyword in text and tag not in tags:
            tags.append(tag)
    return tags[:6]


_GIT_DATE_CACHE = None


def _load_git_dates(repo_root):
    """Scan git history once and map each tracked file path (posix, relative
    to repo root) to its first-commit and most-recent-commit ISO date."""
    global _GIT_DATE_CACHE
    if _GIT_DATE_CACHE is not None:
        return _GIT_DATE_CACHE

    first_seen = {}
    last_seen = {}
    try:
        result = subprocess.run(
            ['git', 'log', '--name-only', '--format=\x01%aI'],
            cwd=repo_root, capture_output=True, text=True, check=True
        )
        output = result.stdout
    except Exception as e:
        print(f"Warning: could not read git history for pack dates: {e}")
        _GIT_DATE_CACHE = ({}, {})
        return _GIT_DATE_CACHE

    current_date = None
    for line in output.splitlines():
        if line.startswith('\x01'):
            current_date = line[1:]
            continue
        path = line.strip()
        if not path or current_date is None:
            continue
        # git log lists commits newest-first, so the first time we see a path
        # is its most recent touch, and the last time is its original add.
        if path not in last_seen:
            last_seen[path] = current_date
        first_seen[path] = current_date

    _GIT_DATE_CACHE = (first_seen, last_seen)
    return _GIT_DATE_CACHE


def get_pack_dates(pack_path, repo_root):
    """Return (added_at, updated_at) ISO date strings for a pack folder,
    based on when its files first/last appeared in git history."""
    first_seen, last_seen = _load_git_dates(repo_root)
    prefix = pack_path.relative_to(repo_root).as_posix() + '/'
    added_candidates = [d for p, d in first_seen.items() if p.startswith(prefix)]
    updated_candidates = [d for p, d in last_seen.items() if p.startswith(prefix)]
    added_at = min(added_candidates) if added_candidates else None
    updated_at = max(updated_candidates) if updated_candidates else None
    return added_at, updated_at


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
    'pack.json', 'icon.png', 'bg.png', 'pack_banner.png', '.metadata.json',
    'readme.md', 'license', 'license.txt',
    'icon.webp', 'bg.webp', 'pack_banner.webp'
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

def find_extension_files(pack_path):
    """
    Find every extension file (files with [Extension] in the name) in a pack
    folder. Extensions are optional add-ons for a pack, sorted by version.
    """
    files = [
        entry for entry in pack_path.iterdir()
        if entry.is_file() and '[Extension]' in entry.name and entry.suffix.lower() in ASSET_EXTENSIONS
    ]
    files.sort(key=lambda e: version_key(e.name), reverse=True)
    return files

def clean_extension_name(filename):
    """Extract clean extension name from filename like 'Glacier_Freelook_[Extension].mcpack'."""
    name = filename.rsplit('.', 1)[0]  # Remove extension
    name = name.replace('[Extension]', '').replace('_', ' ').replace('-', ' ')
    name = ' '.join(n.strip() for n in name.split() if n.strip())
    return name.strip()

def extract_extension_version(filename, filepath=None):
    """Extract version from extension filename or mcpack manifest."""
    import re
    # Look for patterns like V6, v5, V4, etc.
    match = re.search(r'[Vv](\d+(?:\.\d+)*)', filename)
    if match:
        return match.group(1)

    # Fallback: read version from manifest in the mcpack
    if filepath and filepath.suffix.lower() in {'.mcpack', '.mcaddon'}:
        try:
            with zipfile.ZipFile(filepath, 'r') as zf:
                for name in zf.namelist():
                    if name.endswith('manifest.json'):
                        with zf.open(name) as f:
                            manifest = json.load(f)
                        # Try to get version from header or modules
                        version = manifest.get('header', {}).get('version')
                        if version:
                            if isinstance(version, (list, tuple)):
                                return str(version[0]) if version else None
                            return str(version)
                        break
        except Exception:
            pass

    return None

def extract_icon_from_mcpack(mcpack_path, output_path):
    """Extract pack.png or icon.png from an mcpack file to the output path."""
    try:
        with zipfile.ZipFile(mcpack_path, 'r') as zf:
            # Look for pack.png or icon.png in the pack
            for name in zf.namelist():
                if name.endswith(('pack.png', 'icon.png')):
                    # Extract to output path with name icon.png
                    with zf.open(name) as source, open(output_path, 'wb') as target:
                        target.write(source.read())
                    return True
    except Exception as e:
        pass
    return False

MAX_DIMENSIONS = {'icon': 128, 'banner': 960}

def optimize_image(src_path):
    """Produce a resized/compressed .webp alongside src_path (icon capped at
    128px, banner capped at 960px wide, never upscaled). Returns the new
    file's Path on success, or None if Pillow is unavailable or it fails."""
    if not HAS_PILLOW:
        return None
    kind = 'icon' if src_path.stem == 'icon' else 'banner'
    max_dim = MAX_DIMENSIONS[kind]
    webp_path = src_path.with_suffix('.webp')
    try:
        with Image.open(src_path) as img:
            img = img.convert('RGBA') if img.mode in ('P', 'LA') else img.convert('RGB') if img.mode not in ('RGB', 'RGBA') else img
            width, height = img.size
            longest = max(width, height) if kind == 'icon' else width
            if longest > max_dim:
                scale = max_dim / longest
                img = img.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)
            img.save(webp_path, 'WEBP', quality=80, method=6)
        return webp_path
    except Exception as e:
        print(f"WARNING: could not optimize image '{src_path}': {e}")
        return None

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

    lootlabs_enabled = bool(LOOTLABS_API_TOKEN and SITE_BASE_URL)
    lootlabs_cache_path = packs_dir.parent / LOOTLABS_CACHE_FILE
    lootlabs_cache = load_lootlabs_cache(lootlabs_cache_path) if lootlabs_enabled else {}
    if LOOTLABS_API_TOKEN and not SITE_BASE_URL:
        print("  Warning: LOOTLABS_API_TOKEN is set but SITE_BASE_URL is not - skipping LootLabs link generation.")

    # LootLabs API calls are collected here during the scan and resolved all
    # at once afterward (in parallel), instead of blocking on each one serially.
    lootlabs_requests = []              # (title, gate_url)
    lootlabs_assignments = []           # (container_dict, gate_url) to fill in once resolved
    lootlabs_top_level_copies = []      # (pack_entry, versions) - copy versions[0]'s lootUrl up

    # Scan each category directory
    seen_pack_dirs = {}  # pack folder name (lowercased) -> category it was first seen in
    for category_path in sorted(packs_dir.iterdir()):
        if not category_path.is_dir() or category_path.name.startswith('.'):
            continue

        category = category_path.name
        categories[category] = []

        # Scan packs within the category
        for pack_path in sorted(category_path.iterdir()):
            if not pack_path.is_dir() or pack_path.name.startswith('.'):
                continue

            dir_key = pack_path.name.lower()
            if dir_key in seen_pack_dirs:
                print(f"WARNING: pack folder '{pack_path.name}' appears in both "
                      f"'{seen_pack_dirs[dir_key]}' and '{category}' - it will be listed twice. "
                      f"Move or remove the duplicate.")
            else:
                seen_pack_dirs[dir_key] = category

            # Get metadata
            metadata = get_pack_metadata(pack_path)

            # icon.png / pack_banner.png (or bg.png) override the thumbnail/banner if present
            thumbnail = metadata.get('thumbnail', '📦')
            thumbnail_webp = None
            icon_path = pack_path / 'icon.png'
            if icon_path.exists():
                thumbnail = f'packs/{category}/{pack_path.name}/icon.png'
            else:
                # Try to extract icon from the first mcpack file
                asset_files_for_icon = find_asset_files(pack_path)
                if asset_files_for_icon:
                    if extract_icon_from_mcpack(asset_files_for_icon[0], icon_path):
                        thumbnail = f'packs/{category}/{pack_path.name}/icon.png'

            if icon_path.exists():
                webp_path = optimize_image(icon_path)
                if webp_path:
                    thumbnail_webp = f'packs/{category}/{pack_path.name}/{webp_path.name}'

            banner_url = None
            banner_url_webp = None
            for banner_name in ('pack_banner.png', 'bg.png'):
                banner_path = pack_path / banner_name
                if banner_path.exists():
                    banner_url = f'packs/{category}/{pack_path.name}/{banner_name}'
                    webp_path = optimize_image(banner_path)
                    if webp_path:
                        banner_url_webp = f'packs/{category}/{pack_path.name}/{webp_path.name}'
                    break

            # Prefer real pack file(s) (.mcpack/.mcaddon/etc) if present, so
            # downloads point at actual importable files and sizes are accurate.
            # Multiple versions can live side by side in one pack folder.
            asset_files = find_asset_files(pack_path)
            extension_files = find_extension_files(pack_path)

            changelogs = metadata.get('changelogs') or {}

            versions = []
            for f in asset_files:
                stat = f.stat()
                m = VERSION_IN_FILENAME.search(f.name)
                v_label = m.group(1) if m else (read_version_from_archive(f) or metadata.get('version', '1.0.0'))
                version_entry = {
                    'version': v_label,
                    'fileName': f.name,
                    'size': format_size(stat.st_size),
                    'downloadUrl': to_download_url(f'packs/{category}/{pack_path.name}/{f.name}'),
                    'date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d')
                }
                if v_label in changelogs:
                    version_entry['changelog'] = changelogs[v_label]
                versions.append(version_entry)

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

            if thumbnail_webp:
                pack_entry['thumbnailWebp'] = thumbnail_webp

            pack_entry['tags'] = derive_tags(
                pack_entry['name'], pack_entry['description'], metadata.get('tags', [category])
            )

            added_at, updated_at = get_pack_dates(pack_path, packs_dir.parent)
            if added_at:
                pack_entry['addedAt'] = added_at
            if updated_at:
                pack_entry['updatedAt'] = updated_at

            if file_name:
                pack_entry['fileName'] = file_name

            if len(versions) > 1:
                pack_entry['versions'] = versions

            # Add extensions if present
            extensions = []
            # Try to infer default version from pack folder name
            pack_folder_version = None
            if 'v6' in pack_path.name.lower():
                pack_folder_version = '6'
            elif 'v5' in pack_path.name.lower():
                pack_folder_version = '5'
            elif 'v4' in pack_path.name.lower():
                pack_folder_version = '4'

            for ext_file in extension_files:
                stat = ext_file.stat()
                ext_version = extract_extension_version(ext_file.name, ext_file) or pack_folder_version
                # If still no version and extensions are unversioned, default to v4
                if not ext_version and not pack_folder_version:
                    ext_version = '4'
                extensions.append({
                    'name': clean_extension_name(ext_file.name),
                    'fileName': ext_file.name,
                    'size': format_size(stat.st_size),
                    'downloadUrl': to_download_url(f'packs/{category}/{pack_path.name}/{ext_file.name}'),
                    'version': ext_version or 'Latest'
                })
            if extensions:
                pack_entry['extensions'] = extensions

            if banner_url:
                pack_entry['bannerUrl'] = banner_url
            if banner_url_webp:
                pack_entry['bannerUrlWebp'] = banner_url_webp

            if metadata.get('pinned'):
                pack_entry['pinned'] = True

            if metadata.get('notice'):
                pack_entry['notice'] = metadata['notice']

            if metadata.get('requiresAssets'):
                pack_entry['requiresAssets'] = True

            if metadata.get('showcaseUrl'):
                pack_entry['showcaseUrl'] = metadata['showcaseUrl']

            if metadata.get('mcVersion'):
                pack_entry['mcVersion'] = metadata['mcVersion']

            if metadata.get('timelineOrder') is not None:
                pack_entry['timelineOrder'] = metadata['timelineOrder']

            if metadata.get('faIcon'):
                pack_entry['faIcon'] = metadata['faIcon']

            if metadata.get('comingSoon') and not versions:
                pack_entry['comingSoon'] = True

            if metadata.get('discontinued'):
                pack_entry['discontinued'] = True

            if metadata.get('comingSoon') and not versions:
                pack_entry['downloadUrl'] = None
                pack_entry['size'] = 'N/A'
            elif lootlabs_enabled and category != 'website':
                for v in versions:
                    gate_url = make_download_gate_url(v['downloadUrl'])
                    lootlabs_requests.append((pack_entry['name'], gate_url))
                    lootlabs_assignments.append((v, gate_url))
                if versions:
                    lootlabs_top_level_copies.append((pack_entry, versions))
                elif pack_entry.get('downloadUrl'):
                    gate_url = make_download_gate_url(pack_entry['downloadUrl'])
                    lootlabs_requests.append((pack_entry['name'], gate_url))
                    lootlabs_assignments.append((pack_entry, gate_url))

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

    if lootlabs_enabled:
        resolve_lootlabs_links(lootlabs_requests, lootlabs_cache)

        for container, gate_url in lootlabs_assignments:
            loot_url = lootlabs_cache.get(gate_url)
            if loot_url:
                container['lootUrl'] = loot_url

        for pack_entry, versions in lootlabs_top_level_copies:
            pack_entry['lootUrl'] = versions[0].get('lootUrl')

        save_lootlabs_cache(lootlabs_cache_path, lootlabs_cache)

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
        base = SITE_BASE_URL or 'https://pepe.glacierclient.xyz'

        sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
        sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

        # Add homepage
        sitemap += '  <url>\n'
        sitemap += f'    <loc>{base}/</loc>\n'
        sitemap += f'    <lastmod>{datetime.now().strftime("%Y-%m-%d")}</lastmod>\n'
        sitemap += '    <priority>1.0</priority>\n'
        sitemap += '  </url>\n'

        # Add pack pages (clean /pack/<slug> URLs, matching packSlug() in script.js)
        for pack in packs:
            slug = re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', pack['name'].lower())) or f'pack-{pack["id"]}'
            sitemap += '  <url>\n'
            sitemap += f'    <loc>{base}/pack/{slug}</loc>\n'
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
