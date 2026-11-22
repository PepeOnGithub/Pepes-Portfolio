#!/usr/bin/env python3
"""Builds Pepe's Food Saturation as a pure JSON UI copy of AsaBetter's food display (no entity).

    python -I tools/food-saturation/build_asa.py

Layout (same structure as AsaBetter's food_saturation_hunger_preview):
  popup panel (hud_tip_text_background, alpha 0.6) + horizontal stack:
      [hunger icon] [hunger value labels...] [spacer] [saturation icon] [saturation value labels...]
  Labels are grouped by identical value; each label is visible while the held item is one of the foods that
  has that value. The check is an item-hold string, like AsaBetter's #asa_item_hold:
      (#pepe_item_hold = 'pepe<item_id * 65536 + aux>')
  with item IDs from item_ids.json (Minecraft 1.26.50) and amounts from foods.json.

The popup is a collection_panel over hotbar_items (factory: one popup row per hotbar slot). Only the selected
slot's row can be visible, so the row itself checks #slot_selected. Each row computes #pepe_item_hold from the
slot's #item_id_aux, and each label chains the same hold value, so no binding block is written twice in source.

Hook: hud_screen `hud_content` modification (insert_front), the same kind of hook the existing Food Saturation
builds use. The hud namespace must stay `hud` for this hook to apply; the new controls use the pepe_fs_ prefix.

Icons are AsaBetter's own hunger/saturation textures (copied from the AsaBetter extract at build time) placed
under textures/pepe/common/.

Output: dist/Food_Stats+_v3.0.0.mcpack (UI only; textures and settings live in Pepe's Assets Pack, build_assets.py) (ui.brarchive + manifest + pack_icon + icon textures).
"""
import json
import shutil
import struct
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import effects_ui
import stew_icons
from hover_ui import build_hover, build_glyph_page, hud_lines, GLYPH_PAGE, STEW_HUD  # noqa: E402
DIST = HERE / "dist"
PACK = DIST / "pack_asa"
OUT = DIST / ("Food_Stats+_DEBUG.mcpack" if "--debug" in sys.argv else "Food_Stats+_HOVERMIN.mcpack" if "--hovermin" in sys.argv else "Food_Stats+_v3.0.0.mcpack")

VERSION = "3.0.0"
PACK_UUID = "149a546e-773e-41fa-bc14-dfafde9d9ccd"
MODULE_UUID = "0e38c5ae-d230-4268-96e6-6340cfc2877b"

ASA_TEX = Path("C:/Users/User/ClientLibrary/ClientLibrary/1_19/AsaBetter/extracted_food_saturation/asa_textures/ui")
_C = HERE / "assets" / "textures" / "pepe" / "common"
ICON_FILES = {n: _C / n for n in ("effect_saturation.png", "effect_instant_health.png", "effect_instant_damage.png")}

# Foods whose aux value selects the effect; their IDs are checked per aux value (AsaBetter lists 16 of them).
AUX_VARIANTS = {"suspicious_stew": 16}


def load_inputs():
    foods = json.loads((HERE / "foods.json").read_text("utf8"))
    idfile = json.loads((HERE / "item_ids.json").read_text("utf8"))
    ids = idfile["ids"]
    missing = [n for n in foods if n not in ids]
    if missing:
        sys.exit(f"item_ids.json is missing: {', '.join(missing)} (renamed or removed in {idfile['game_version']}?)")
    for name, icon in ICON_FILES.items():
        if not icon.is_file():
            sys.exit(f"AsaBetter texture not found: {icon}")
    return foods, ids, idfile


def fmt(v):
    return str(int(v)) if float(v).is_integer() else str(v)


def hold_check(name_list, ids):
    """numeric #item_id_aux test (id * 65536 + aux), the form proven to work in game; aux foods use a range"""
    terms = []
    for n in name_list:
        i = ids[n]
        if n in AUX_VARIANTS:
            terms.append(f"((#item_id_aux >= {i * 65536}) and (#item_id_aux < {(i + 1) * 65536}))")
        else:
            terms.append(f"(#item_id_aux = {i * 65536})")
    return "(" + " or ".join(terms) + ")"


def value_groups(foods, idx):
    by_value = {}
    for name, amounts in foods.items():
        by_value.setdefault(fmt(amounts[idx]), []).append(name)
    return sorted(by_value.items(), key=lambda kv: float(kv[0]))


def view(src, dst):
    return {"binding_type": "view", "source_property_name": src, "target_property_name": dst}


COLLECTION = "hotbar_items"
SLOTS = range(1, 10)


def build_ui(foods, ids):
    """Glacier / AsaBetter style: a stack of nine cells over the hotbar_items collection (one per slot,
    collection_index). Inside each cell sits one entry per distinct (hunger, saturation) pair; an entry is
    visible when  slot selected AND item id matches  (#slot_selected and (#item_id_aux = id * 65536 ...)),
    and its label is plain static text, so there are no lookups at all.
    The stack is inserted into the vanilla item name stack (item_name_text_root), under the item name."""
    col = [{"binding_name": "#item_id_aux", "binding_type": "collection", "binding_collection_name": COLLECTION,
            "binding_condition": "always"},
           {"binding_name": "#slot_selected", "binding_type": "collection", "binding_collection_name": COLLECTION,
            "binding_condition": "always"}]
    dbg = "red" if "--debug" in sys.argv else None

    by_pair = {}
    for n, (hunger, saturation) in foods.items():
        by_pair.setdefault((hunger, saturation), []).append(n)

    templates, entries = {}, []
    for k, ((hunger, saturation), names) in enumerate(sorted(by_pair.items())):
        match = " or ".join(
            f"((#item_id_aux >= {ids[n] * 65536}) and (#item_id_aux < {(ids[n] + 1) * 65536}))"
            if n in AUX_VARIANTS else f"(#item_id_aux = {ids[n] * 65536})" for n in names)
        box = {"type": "image", "texture": "textures/ui/hud_tip_text_background",
               # same fade animations the vanilla item name uses, so the box leaves with the popup
               "alpha": "@hud.pepe_fs_alpha_in",
               "size": ["100%c + 6px", "100%c + 6px"],
               "controls": [{"pepe_fs_text": {"type": "label", "layer": 2, "shadow": True,
                                              "alpha": "@hud.pepe_fs_text_in",
                                              "text": "§r" + hud_lines(hunger, saturation),
                                              "text_alignment": "center"}}]}
        # the wrapper owns visibility and adds 3px above and 3px below the box (6px taller than the box, box centred)
        entry = {"type": "panel", "size": ["100%", "100%c + 6px"],
                 "bindings": col + [
                     # two steps like AsaBetter's detect bindings (match, then match AND selected): the long OR
                     # inside one AND expression leaked for groups with 3+ foods
                     dict(view(f"({match})", "#pepe_match"), binding_condition="always"),
                     dict(view("(#slot_selected and #pepe_match)", "#visible"), binding_condition="always")],
                 "controls": [{"pepe_fs_box": box}]}
        if dbg:
            entry["debug"] = dbg; box["debug"] = "blue"
        templates[f"pepe_fs_food_{k}"] = entry
        entries.append({f"f{k}@hud.pepe_fs_food_{k}": {}})

    # holding a suspicious stew: one extra row per flower (aux value) with the effect icon + name + time, under the
    # food row. Exact item match (id * 65536 + aux), same two-step visibility as the food entries.
    stew_base = ids["suspicious_stew"] * 65536
    for child, (icon, name, when, good) in STEW_HUD.items():
        row = {"type": "stack_panel", "orientation": "horizontal", "size": ["100%c", "100%cm"], "controls": [
            {"pepe_fs_icon": {"type": "image", "layer": 2, "size": [12, 12],
                              "alpha": "@hud.pepe_fs_text_in", "texture": icon}},
            {"pepe_fs_gap": {"type": "panel", "size": [3, 1]}},
            {"pepe_fs_effect": {"type": "label", "layer": 2, "shadow": True, "alpha": "@hud.pepe_fs_text_in",
                                "text": "§" + good + name + " " + when, "text_alignment": "center"}}]}
        sbox = {"type": "image", "texture": "textures/ui/hud_tip_text_background", "alpha": "@hud.pepe_fs_alpha_in",
                "size": ["100%c + 6px", "100%c + 6px"], "controls": [row]}
        sentry = {"type": "panel", "size": ["100%", "100%c + 6px"],
                  "bindings": col + [
                      dict(view("('§z' + #item_id_aux)", "#pepe_aux"), binding_condition="always"),
                      dict(view(f"(#pepe_aux = '§z{stew_base + child}')", "#pepe_match"), binding_condition="always"),
                      dict(view("(#slot_selected and #pepe_match)", "#visible"), binding_condition="always")],
                  "controls": [{"pepe_fs_box": sbox}]}
        templates[f"pepe_fs_stew_{child}"] = sentry
        entries.append({f"s{child}@hud.pepe_fs_stew_{child}": {}})

    templates["pepe_fs_cell"] = {"type": "stack_panel", "orientation": "vertical", "size": ["100%", "100%cm"],
                                 "controls": entries}
    cells = {"pepe_fs_cells": {
        # a stack (collection_index cells only work under a stack/grid) as wide as the item name (100%sm = widest
        # sibling). Anchors don't move stack children, so each cell is a panel as wide as the stack ("100%") and
        # the box inside it is centred by default, which centres box and name on the same line
        "type": "stack_panel", "orientation": "vertical", "size": ["100%sm", "100%c"],
        # customisation: set these in the Assets Pack's _global_variables.json
        "$hide_food_stats_box|default": False, "$food_stats_box_opacity|default": 0.6,
        "$food_stats_box_offset|default": [0, 0],
        "ignored": "$hide_food_stats_box", "offset": "$food_stats_box_offset",
        "collection_name": COLLECTION,
        "controls": [{f"pepe_fs_cell_{i}@hud.pepe_fs_cell": {"collection_index": i}} for i in range(9)]}}

    fx_templates, fx_cells = effects_ui.build(ids["suspicious_stew"], view, col, dbg)
    templates.update(fx_templates)

    return {
        "namespace": "hud",
        # vanilla item_name_text_root > item_text_aligner is a vertical stack [name, interact_padding, survival_buffer];
        # inserting right after the name pushes the name up and keeps our row above the survival buffer
        # (the gap vanilla leaves for armor / hearts)
        "item_name_text_root/item_text_aligner": {"modifications": [{
            "array_name": "controls", "operation": "insert_after", "control_name": "item_text_control",
            "value": [cells]}]},
        # effect icons under the crosshair while holding a suspicious stew or a potion (AsaBetter-style viewer)
        "hud_content": {"modifications": [{
            "array_name": "controls", "operation": "insert_front", "value": [fx_cells]}]},
        # same shape as the vanilla item name fades (wait $wait_duration, then 2s out); the vanilla label's own
        # fade is what destroys the popup, so these only carry the timing
        "pepe_fs_alpha_in": {"anim_type": "alpha", "duration": 0, "from": 0, "to": "$food_stats_box_opacity", "next": "@hud.pepe_fs_alpha_stay"},
        "pepe_fs_alpha_stay": {"anim_type": "wait", "duration": "$wait_duration", "next": "@hud.pepe_fs_alpha_out"},
        "pepe_fs_alpha_out": {"anim_type": "alpha", "easing": "in_expo", "duration": 2, "from": "$food_stats_box_opacity", "to": 0},
        "pepe_fs_text_in": {"anim_type": "alpha", "duration": 0, "from": 0, "to": 1, "next": "@hud.pepe_fs_text_stay"},
        "pepe_fs_text_stay": {"anim_type": "wait", "duration": "$wait_duration", "next": "@hud.pepe_fs_text_out"},
        "pepe_fs_text_out": {"anim_type": "alpha", "easing": "in_expo", "duration": 2, "from": 1, "to": 0},
        **stew_icons.hud_part(ids["suspicious_stew"]),
        **templates,
    }


def brarchive(files):
    """{name: bytes} -> .brarchive (same layout the Glacier brarchive tool writes, mode=replace)."""
    name_max = 247
    out = struct.pack("<QII", 0x267052A0B125277D, len(files), 1)
    body = b""
    for name, data in files.items():
        raw = name.encode("utf8")
        out += bytes([len(raw)]) + raw.ljust(name_max, bytes(1)) + struct.pack("<II", len(body), len(data))
        body += data
    return out + body


def minify(obj):
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    json.loads(text)  # strict JSON round-trip
    if "//" in text or "/*" in text:
        sys.exit("comment-like text leaked into hud_screen.json")
    return text.encode("utf8")


def main():
    foods, ids, idfile = load_inputs()
    ui = build_ui(foods, ids)
    ui_bytes = minify(ui)

    manifest = {"format_version": 3, "header": {
        "name": f"Food Stats+ §7v{VERSION}§r",
        "description": "Shows what a food restores: hunger and saturation shanks under the item name and in item tooltips, "
                       "plus effect icons for suspicious stews and potions. Made by Pepe.",
        "uuid": PACK_UUID, "version": [int(x) for x in VERSION.split(".")],
        "min_engine_version": "1.21.0", "pack_optimization_version": "0.1.0"},
        "modules": [{"type": "resources", "uuid": MODULE_UUID, "version": [int(x) for x in VERSION.split(".")]}],
        "metadata": {"authors": ["Pepe"]}}

    if PACK.exists():
        shutil.rmtree(PACK)
    (PACK / "__brarchive").mkdir(parents=True)
    (PACK / "__brarchive" / "ui.brarchive").write_bytes(brarchive({
        "hud_screen.json": ui_bytes,
        "ui_common.json": minify({**build_hover({k: tuple(v) for k, v in foods.items()}, ids,
                                                 minimal="--hovermin" in sys.argv), **stew_icons.ui_common_part()}),
        "inventory_screen.json": minify(stew_icons.inventory_part()),
        "trade_2_screen.json": minify(stew_icons.trade_part())}))
    (PACK / "manifest.json").write_bytes(minify(manifest))
    (PACK / "pack_icon.png").write_bytes((HERE / "pack_icon.png").read_bytes())

    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(PACK.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(PACK).as_posix())

    print(f"Built {OUT.name}: {OUT.stat().st_size} bytes, {len(foods)} foods, "
          f"hud_screen.json {len(ui_bytes)} bytes, IDs for {idfile['game_version']}")


if __name__ == "__main__":
    main()
