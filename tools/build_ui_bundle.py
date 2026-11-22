#!/usr/bin/env python3
"""Builds the JSON UI bundles the customizer's HUD interpreter (customizer-ui.js) runs on.

    python tools/build_ui_bundle.py --samples path/to/bedrock-samples-*.zip

Writes into assets/ui/:
  vanilla.json          only the vanilla UI elements reachable from the HUD (hud.hud_content), per namespace,
                        plus the global variables and the nine-slice data of every texture they use
  pack-<id>@<ver>.json  every Pepe pack build that ships UI: its ui/*.json (read through __brarchive too),
                        its global variables, and the nine-slice data of its textures
  index.json            which pack bundles exist, per pack id, newest version first
  tex/...               every texture those bundles name (vanilla from the samples zip, Pepe ones from the packs)

The interpreter merges vanilla, then the Assets Pack, then the module packs, the way the game stacks resource packs,
so the preview runs the packs' real layout, variables, bindings and modifications instead of hand-placed copies.
"""
import argparse
import io
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_customizer import LFS_POINTER, load_json_lenient, version_key, version_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "ui"
TEX = OUT / "tex"
REF = re.compile(r"^@?([a-z0-9_]+)\.([A-Za-z0-9_]+)$")
TEX_STR = re.compile(r"^textures/[A-Za-z0-9_/\-. ]+$")
ROOTS = [("hud", "hud_content"), ("hud", "root_panel")]


def read_brar(data):
    """__brarchive container: header, 256-byte entries (name, offset, length), then the bodies."""
    _magic, count, _ver = struct.unpack("<QII", data[:16])
    off, body, out = 16, 16 + count * 256, {}
    for _ in range(count):
        n = data[off]
        name = data[off + 1:off + 1 + n].decode()
        o, ln = struct.unpack("<II", data[off + 248:off + 256])
        out[name] = data[body + o:body + o + ln]
        off += 256
    return out


def pack_files(z):
    """{path: bytes} of a pack zip, with __brarchive/<dir>.brarchive members unpacked into <dir>/<name>."""
    files = {}
    for n in z.namelist():
        if n.endswith("/"):
            continue
        data = z.read(n)
        if n.endswith(".brarchive"):
            folder = n[len("__brarchive/"):-len(".brarchive")] if n.startswith("__brarchive/") else n[:-10]
            try:
                for k, v in read_brar(data).items():
                    files[f"{folder}/{k}"] = v
            except Exception:
                pass
        else:
            files[n] = data
    root = min((p.rsplit("manifest.json", 1)[0] for p in files if p.endswith("manifest.json")), key=len, default="")
    return {p[len(root):]: v for p, v in files.items() if p.startswith(root)}


def split_key(key):
    name, _, base = key.partition("@")
    return name, base


def walk_strings(o, fn):
    if isinstance(o, dict):
        for k, v in o.items():
            fn(k)
            walk_strings(v, fn)
    elif isinstance(o, list):
        for v in o:
            walk_strings(v, fn)
    elif isinstance(o, str):
        fn(o)


def ui_docs(files, file_ns=None):
    """{namespace: {full_key: def}}, the global variables and {file: namespace} of a set of ui/*.json files.
    A pack file without a "namespace" merges into the vanilla file at the same path, as in the game (file_ns)."""
    spaces, glob, seen = {}, {}, {}
    for path, data in sorted(files.items()):
        if not (path.startswith("ui/") and path.endswith(".json")):
            continue
        try:
            doc = load_json_lenient(data)
        except Exception as e:
            print(f"  skipped {path}: {e}", file=sys.stderr)
            continue
        if not isinstance(doc, dict):
            continue
        if path.endswith("_global_variables.json"):
            glob.update(doc)
            continue
        if path.endswith("_ui_defs.json"):
            continue
        ns = doc.pop("namespace", None) or (file_ns or {}).get(path)
        if ns:
            seen[path] = ns
            spaces.setdefault(ns, {}).update(doc)
        else:
            print(f"  {path}: no namespace and no vanilla file to merge into", file=sys.stderr)
    return spaces, glob, seen


def reachable(spaces, roots):
    """Only the vanilla elements the HUD can reach: bases, child bases and element names held in variables."""
    by_name = {ns: {split_key(k)[0]: k for k in defs} for ns, defs in spaces.items()}
    keep = {ns: {} for ns in spaces}
    todo = list(roots)

    def enqueue(ns, name):
        if name in by_name.get(ns, {}) and by_name[ns][name] not in keep[ns]:
            todo.append((ns, name))

    while todo:
        ns, name = todo.pop()
        key = by_name.get(ns, {}).get(name)
        if key is None or key in keep[ns]:
            continue
        keep[ns][key] = spaces[ns][key]

        def visit(s, ns=ns):
            if "@" in s and not s.startswith("@"):
                base = s.split("@", 1)[1]
                b_ns, _, b_name = base.rpartition(".")
                enqueue(b_ns or ns, b_name)
            m = REF.match(s)
            if m:
                enqueue(m.group(1), m.group(2))

        visit(key)
        walk_strings(spaces[ns][key], visit)
    return {ns: d for ns, d in keep.items() if d}


def textures_in(obj):
    found = set()
    walk_strings(obj, lambda s: found.add(s) if TEX_STR.match(s) else None)
    return found


def copy_textures(paths, lookup, nine):
    """Copies each texture (png, else tga converted is skipped) and records its nine-slice json; returns copied count."""
    n = 0
    for p in sorted(paths):
        stem = p[:-4] if p.endswith(".png") else p
        png = lookup(stem + ".png")
        if png is not None:
            dest = TEX / (stem + ".png")
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.is_file() or dest.read_bytes() != png:
                dest.write_bytes(png)
            n += 1
        meta = lookup(stem + ".json")
        if meta is not None:
            try:
                nine[stem] = load_json_lenient(meta)
            except Exception:
                pass
    return n


def dump(path, obj):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if not path.is_file() or path.read_text(encoding="utf8") != text:
        path.write_text(text, encoding="utf8")
    return len(text)


def build_vanilla(samples):
    with zipfile.ZipFile(samples) as z:
        names = {n.split("resource_pack/", 1)[1]: n for n in z.namelist() if "resource_pack/" in n and not n.endswith("/")}
        files = {p: z.read(n) for p, n in names.items() if p.startswith("ui/") and p.endswith(".json")}
        spaces, glob, file_ns = ui_docs(files)
        keep = reachable(spaces, ROOTS)
        nine = {}
        lookup = lambda p: z.read(names[p]) if p in names else None  # noqa: E731
        count = copy_textures(textures_in(keep) | textures_in(glob) | EXTRA_TEXTURES, lookup, nine)
    size = dump(OUT / "vanilla.json", {"namespaces": keep, "globals": glob, "nineslice": nine, "files": file_ns})
    print(f"vanilla.json: {sum(len(d) for d in keep.values())} elements in {len(keep)} namespaces, "
          f"{count} textures, {size // 1024} KB")


# textures the bindings hand out at runtime (hotbar, hearts, hunger, armor, xp), not named in the JSON
EXTRA_TEXTURES = {
    "textures/ui/hotbar_start_cap", "textures/ui/hotbar_end_cap", "textures/ui/selected_hotbar_slot",
    *(f"textures/ui/hotbar_{i}" for i in range(9)),
    "textures/ui/heart", "textures/ui/heart_half", "textures/ui/heart_background", "textures/ui/hunger_full",
    "textures/ui/hunger_half", "textures/ui/hunger_background", "textures/ui/armor_full", "textures/ui/armor_half",
    "textures/ui/armor_empty", "textures/ui/experiencebarempty", "textures/ui/experiencebarfull",
    "textures/ui/experiencenub", "textures/ui/bubble", "textures/ui/hud_tip_text_background",
    "textures/ui/purpleBorder", "textures/ui/item_cell", "textures/ui/cross_hair",
}


def pack_builds():
    """(pack id, version, path) of every pack build that has UI files, from the pack folders listed in packs.json."""
    listed = json.loads((ROOT / "packs.json").read_text(encoding="utf8"))["packs"]
    for entry in listed:
        folder = ROOT / entry.get("previewUrl", "")
        if not entry.get("previewUrl") or not folder.is_dir() or entry.get("category") == "clients":
            continue
        for path in sorted(folder.rglob("*.mcpack")):
            with path.open("rb") as f:
                if f.read(len(LFS_POINTER)) == LFS_POINTER:
                    continue
            yield folder.name, entry.get("name", folder.name), path


def build_packs(samples=None):
    """Bundles every pack build with UI. Textures a module pack names but does not ship come from the newest Assets Pack
    (Pepe's shared textures) or, when --samples is given, from vanilla; every textures/pepe/ file of the newest Assets
    Pack is copied too, since bindings build some texture paths at runtime."""
    index = {}
    builds = list(pack_builds())
    assets = sorted((b for b in builds if b[0] == "pepes-assets-pack"), key=lambda b: version_key(b[2].stem), reverse=True)
    shared = {}
    for _pid, _name, path in assets[:1]:
        with zipfile.ZipFile(path) as z:
            shared = pack_files(z)
    vanilla = {}
    if samples:
        with zipfile.ZipFile(samples) as z:
            vanilla = {n.split("resource_pack/", 1)[1]: z.read(n) for n in z.namelist()
                       if "resource_pack/textures/" in n and n.endswith((".png", ".json"))}
    fallback = lambda p: shared.get(p) if p in shared else vanilla.get(p)  # noqa: E731
    pepe = {p[:-4] for p in shared if (p.startswith("textures/pepe/") or p.startswith("font/glyph_")) and p.endswith(".png")}
    copied = copy_textures(pepe, fallback, shared_nine := {})
    print(f"  shared Pepe textures: {copied}")
    file_ns = json.loads((OUT / "vanilla.json").read_text(encoding="utf8")).get("files", {})
    for pid, name, path in builds:
        try:
            with zipfile.ZipFile(path) as z:
                files = pack_files(z)
            manifest = load_json_lenient(files["manifest.json"])
        except Exception:
            continue
        spaces, glob, _ = ui_docs(files, file_ns)
        if not spaces and not glob:
            continue
        version = version_text((manifest.get("header") or {}).get("version", "0.0.0"))
        nine = {}
        own = lambda p, files=files: files.get(p) if p in files else fallback(p)  # noqa: E731
        count = copy_textures(textures_in(spaces) | textures_in(glob), own, nine)
        if pid == "pepes-assets-pack":
            nine.update(shared_nine)
        dump(OUT / f"pack-{pid}@{version}.json", {"id": pid, "name": name, "version": version,
                                                   "namespaces": spaces, "globals": glob, "nineslice": nine})
        index.setdefault(pid, {"name": name, "versions": []})["versions"].append(version)
        print(f"  {pid}@{version}: {sum(len(d) for d in spaces.values())} elements, {len(glob)} globals, {count} textures")
    for p in index.values():
        p["versions"] = sorted(set(p["versions"]), key=version_key, reverse=True)
    dump(OUT / "index.json", index)
    print(f"index.json: {len(index)} packs with UI")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", help="bedrock-samples zip (Mojang/bedrock-samples release); rebuilds vanilla.json")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.samples:
        build_vanilla(args.samples)
    elif not (OUT / "vanilla.json").is_file():
        sys.exit("assets/ui/vanilla.json is missing: run once with --samples <bedrock-samples zip>")
    build_packs(args.samples)


if __name__ == "__main__":
    main()
