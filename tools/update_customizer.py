#!/usr/bin/env python3
"""Regenerates customizer-data.json for the Assets Pack customizer (customizer.html).

    python tools/update_customizer.py                 # latest Assets Pack listed in packs.json
    python tools/update_customizer.py --pack some.mcpack   # a specific build or folder (local testing)

The customizer builds its settings form from ui/_global_variables.json inside the Assets Pack, so every time the
Assets Pack gets a new version (and the deploy workflow runs this after generator.py) the form, the defaults and the
download link follow it - new variables show up without editing the website. Labels, groups and limits for known
variables come from customizer-meta.json; anything not listed there is labelled and grouped automatically.

Every variable also gets an "addedIn" entry: the pack version it first appeared in, found by comparing with the
previous customizer-data.json (variables seen before keep their version; the first run marks all as the current one).

If the pack is missing, is a Git LFS pointer, or cannot be read, the script warns and exits 0 without touching
customizer-data.json, so the last good data (and the deploy) survives.
"""
import argparse
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "customizer-data.json"
PACK_NAME = "Pepe's Assets Pack"
LFS_POINTER = b"version https://git-lfs.github.com/spec/"
TRAILING_COMMA = re.compile(r",(\s*[}\]])")


def warn(msg):
    print(f"WARNING: {msg}", file=sys.stderr)


def strip_jsonc(text):
    """Removes // and /* */ comments and trailing commas, leaving string contents untouched."""
    out, plain, i, n = [], [], 0, len(text)
    while i < n:
        if text[i] == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(TRAILING_COMMA.sub(r"\1", "".join(plain)))
            plain = []
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
        else:
            plain.append(text[i])
            i += 1
    out.append(TRAILING_COMMA.sub(r"\1", "".join(plain)))
    return "".join(out)


def load_json_lenient(raw):
    text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw
    return json.loads(strip_jsonc(text))


def find_entry(z, suffix):
    """Shallowest file inside the zip whose path ends with suffix (packs may wrap files in a folder)."""
    hits = [n for n in z.namelist() if ("/" + n.replace("\\", "/")).endswith("/" + suffix)]
    return min(hits, key=lambda n: (n.count("/"), n), default=None)


def version_text(value):
    if isinstance(value, (list, tuple)):
        return ".".join(str(v) for v in value)
    return str(value)


def read_pack(source):
    with source.open("rb") as f:
        if f.read(len(LFS_POINTER)) == LFS_POINTER:
            raise ValueError("it is a Git LFS pointer, not the pack (run git lfs pull)")
    with zipfile.ZipFile(source) as z:
        vars_name = find_entry(z, "ui/_global_variables.json")
        man_name = find_entry(z, "manifest.json")
        if vars_name is None:
            raise ValueError("no ui/_global_variables.json inside the pack")
        if man_name is None:
            raise ValueError("no manifest.json inside the pack")
        variables = load_json_lenient(z.read(vars_name))
        manifest = load_json_lenient(z.read(man_name))
    if not isinstance(variables, dict) or not variables:
        raise ValueError("ui/_global_variables.json has no variables")
    return variables, manifest


def listed_entry():
    try:
        packs = json.loads((ROOT / "packs.json").read_text(encoding="utf8"))["packs"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        warn(f"packs.json unreadable ({e})")
        return None
    entry = next((p for p in packs if p.get("name") == PACK_NAME), None)
    if entry is None:
        warn(f"{PACK_NAME} is not listed in packs.json")
    return entry


def pick_source(args, entry):
    if args.pack:
        path = Path(args.pack)
        if path.is_dir():
            packs = sorted(path.rglob("*.mcpack"), key=lambda f: f.stat().st_mtime, reverse=True)
            return packs[0] if packs else None
        return path
    if entry is None:
        return None
    folder = ROOT / entry.get("previewUrl", "")
    exact = folder / entry["fileName"]
    if exact.is_file() or not folder.is_dir():
        return exact
    nested = [p for p in folder.rglob("*.mcpack") if p.name == entry["fileName"]]
    return nested[0] if nested else exact


def load_previous():
    try:
        return json.loads(OUT.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return None


def added_in(variables, version, previous):
    prev = previous or {}
    prev_vars = prev.get("variables") or {}
    prev_added = prev.get("addedIn") or {}
    prev_version = (prev.get("assetsPack") or {}).get("version") or version
    return {
        key: prev_added.get(key, prev_version) if key in prev_vars else version
        for key in variables
    }


PACKS_OUT = ROOT / "customizer-packs.json"
MEDIA = "https://media.githubusercontent.com/media/PepeOnGithub/Pepes-Portfolio/main/"


def version_key(v):
    return [int(p) if p.isdigit() else 0 for p in re.split(r"[.\-]", v)]


def scan_versions(folder):
    """Every readable .mcpack in a pack folder: {version: {fileName, downloadUrl, variables?, settings?}}."""
    found = {}
    for path in sorted(folder.rglob("*.mcpack")):
        try:
            with path.open("rb") as f:
                if f.read(len(LFS_POINTER)) == LFS_POINTER:
                    continue
            with zipfile.ZipFile(path) as z:
                man_name = find_entry(z, "manifest.json")
                if man_name is None:
                    continue
                manifest = load_json_lenient(z.read(man_name))
                vars_name = find_entry(z, "ui/_global_variables.json")
                variables = load_json_lenient(z.read(vars_name)) if vars_name else None
        except Exception:
            continue                    # unreadable or non-Pepe builds (obfuscated manifests) carry no settings anyway
        version = version_text((manifest.get("header") or {}).get("version", "0.0.0"))
        settings = [s for s in manifest.get("settings") or [] if isinstance(s, dict)]
        rel = path.relative_to(ROOT).as_posix()
        found[version] = {
            "version": version,
            "fileName": path.name,
            "manifest": man_name,
            "downloadUrl": MEDIA + quote(rel),
            **({"variables": dict(sorted(variables.items()))} if isinstance(variables, dict) and variables else {}),
            **({"settings": settings} if settings else {}),
        }
    return found


def build_packs():
    """customizer-packs.json: every pack whose builds carry settings (Assets Pack variables or manifest pack settings),
    with each version, so the customizer can switch between packs and versions."""
    try:
        listed = json.loads((ROOT / "packs.json").read_text(encoding="utf8"))["packs"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        warn(f"packs.json unreadable ({e}); {PACKS_OUT.name} left as it was")
        return
    out = []
    for entry in listed:
        folder = ROOT / entry.get("previewUrl", "")
        if not entry.get("previewUrl") or not folder.is_dir():
            continue
        versions = scan_versions(folder)
        is_assets = entry.get("name") == PACK_NAME
        if not any(("variables" in v) if is_assets else ("settings" in v) for v in versions.values()):
            continue
        slug = folder.name
        out.append({
            "id": slug,
            "name": entry.get("name", slug),
            "kind": "variables" if is_assets else "settings",
            "latest": entry.get("version"),
            "versions": sorted(versions.values(), key=lambda v: version_key(v["version"]), reverse=True),
        })
    out.sort(key=lambda p: (p["kind"] != "variables", p["name"].lower()))
    text = json.dumps({"packs": out}, indent=1, ensure_ascii=False) + "\n"
    if not PACKS_OUT.is_file() or PACKS_OUT.read_text(encoding="utf8") != text:
        PACKS_OUT.write_text(text, encoding="utf8")
    print(f"{PACKS_OUT.name}: " + ", ".join(f"{p['name']} ({len(p['versions'])} versions)" for p in out))


def keep(reason):
    warn(f"{reason}; {OUT.name} left as it was")
    sys.exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", help="read variables from this .mcpack (or folder of them) instead of the one packs.json lists")
    args = ap.parse_args()

    if not args.pack:
        build_packs()
    previous = load_previous()
    entry = listed_entry()
    source = pick_source(args, entry)
    if source is None or not source.is_file():
        keep(f"Assets Pack file not found ({source or 'nothing listed in packs.json'})")
    try:
        variables, manifest = read_pack(source)
    except Exception as e:
        keep(f"could not read {source.name}: {e}")

    header = manifest.get("header") or {}
    version = version_text(header.get("version", "unknown"))
    download = (entry or {}).get("downloadUrl") or ((previous or {}).get("assetsPack") or {}).get("downloadUrl", "")
    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "assetsPack": {
            "name": header.get("name", PACK_NAME),
            "version": version,
            "fileName": source.name,
            "downloadUrl": download,
        },
        "variables": dict(sorted(variables.items())),
        "addedIn": dict(sorted(added_in(variables, version, previous).items())),
    }

    unchanged = previous is not None and (
        {k: v for k, v in previous.items() if k != "generated"} == {k: v for k, v in data.items() if k != "generated"}
    )
    if not unchanged:
        OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    seen = (previous or {}).get("variables") or {}
    new = sum(1 for k in data["variables"] if k not in seen)
    state = "unchanged" if unchanged else "written"
    print(f"{OUT.name}: Assets Pack v{version}, {len(variables)} variables ({new} new), {state}")


if __name__ == "__main__":
    main()
