#!/usr/bin/env python3
"""Builds Pepe's Food Saturation from foods.json + item_ids.json into dist/.

    python tools/food-saturation/build.py

The display is added to vanilla's selected-item name popup (hud.item_name_text_root, the control
item_text_factory creates) with modifications (insert_front on item_text_control), so it reads:
[item icon] Item Name [hunger shanks] [saturation shanks]
Hunger and saturation are drawn as full/half shank icons (1 point = half a shank).

Writes dist/pack/ (brarchived) and dist/Pepe's_Food_Saturation_v<version>.mcpack.
item_ids.json is refreshed by tools/update_item_ids.py.
"""
import json
import struct
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = [1, 1, 0]
PACK_UUID = "149a546e-773e-41fa-bc14-dfafde9d9ccd"
MODULE_UUID = "0e38c5ae-d230-4268-96e6-6340cfc2877b"

foods = {k: tuple(v) for k, v in json.loads((HERE / "foods.json").read_text("utf8")).items()}
idfile = json.loads((HERE / "item_ids.json").read_text("utf8"))
ids = idfile["ids"]
missing = [n for n in foods if n not in ids]
if missing:
    sys.exit(f"item_ids.json is missing: {', '.join(missing)} (renamed or removed in {idfile['game_version']}?)")


COL = {"binding_name": "#item_id_aux", "binding_type": "collection", "binding_collection_name": "$hotbar_collection_name"}
SEL = {"binding_name": "#slot_selected", "binding_type": "collection", "binding_collection_name": "$hotbar_collection_name"}
DETAILS = {"binding_type": "collection_details", "binding_collection_name": "hotbar_items"}


def fmt(v):
    return str(int(v)) if float(v).is_integer() else str(v)


def view(expr, target):
    return {"binding_type": "view", "source_property_name": expr, "target_property_name": target}


# Every food ID gets a ready-made row of full/half shank images. The row for a hunger (or saturation)
# amount is shown when the selected slot holds one of the items with that amount. The ID check is the one
# HUD Features / AsaBetter use: #item_id_aux is the item ID * 65536 (+ aux).
#
# Size/cost optimizations:
#  * the name label exists once; only the small icon cell and the shank cell are repeated per hotbar slot
#  * shank images, spacers and the separator are shared templates referenced with @ (no repeated definitions)
#  * a row of full shanks is a single tiled image, not one control per shank
#  * shank rows are grouped by what they LOOK like (same number of full/half shanks), not by raw value, so
#    foods that draw the same bar share one row and one ID list
RANGE = {"suspicious_stew"}  # aux differs per stew effect, so it is matched by ID range instead
NO_ICON = "(not $foodsaturation_show_icon)"
NO_H = "(not $foodsaturation_show_hunger)"
NO_S = "(not $foodsaturation_show_saturation)"
TEX = "textures/pepe/common/"


def is_item(name):
    i = ids[name]
    if name in RANGE:
        return f"((#item_id_aux >= {i * 65536}) and (#item_id_aux < {(i + 1) * 65536}))"
    return f"(#item_id_aux = {i * 65536})"


ALL_FOOD = " or ".join(is_item(n) for n in foods)


def layout(value):
    """(full shanks, half shank?) - full shank per 2 points, half for any remainder (0.2 still shows half)."""
    full = int(value // 2)
    return full, (value - 2 * full) > 0.01


def groups(idx, prefix, kind, ign):
    by_layout = {}
    for n, v in foods.items():
        by_layout.setdefault(layout(v[idx]), []).append(n)
    out = []
    for (full, half), names in sorted(by_layout.items()):
        cond = " or ".join(is_item(n) for n in names)
        tag = f"{full}{'h' if half else ''}"
        # a row of full shanks is ONE tiled image; the half shank sits at the left end because the row is
        # right-aligned and fills from the right, exactly like vanilla's hunger bar
        half_img = [{f"{prefix}{tag}_h@hud.pepe_fs_{kind}_half": {}}] if half else []
        full_img = [{f"{prefix}{tag}_f@hud.pepe_fs_{kind}_full": {"size": [9 * full, 9], "tiled": "x"}}] if full else []
        out.append({f"{prefix}{tag}": {
            "type": "stack_panel", "orientation": "horizontal", "size": ["100%c", "100%c"], "visible": False,
            "ignored": ign,
            "bindings": [COL, SEL, view(f"(#slot_selected and ({cond}))", "#visible")],
            "controls": half_img + full_img}})
    return out


# Saturation first, then hunger; each row is introduced by "| S:" / "| H:".
sat_groups = groups(1, "s", "sat", NO_S)
hunger_groups = groups(0, "h", "hunger", NO_H)

# AppleSkin-style: while the selected hotbar slot holds food, a persistent preview of what it restores sits
# right above the vanilla hunger bar (right-aligned, filled from the right like the bar itself):
#     saturation row (yellow shanks)
#     hunger row (white shanks)
#     [vanilla hunger bar]
# It is added to hud_content with `modifications` (insert_front), is not tied to the item-name popup (so it
# can't vanish with it), and is hidden together with the survival HUD.
#
# Built like HUD Features' selected-item tooltips: a collection_panel over hotbar_items with a `factory`
# (property_bag #collection_length = 9) generating one row per hotbar slot; a row shows itself only while its
# slot is selected. Containers that hold hidden slots use "%cm" (biggest VISIBLE child, Bedrock wiki), never "%c".
HOTBAR = {"$hotbar_collection_name": "hotbar_items", "collection_name": "$hotbar_collection_name"}
COL_H = {"binding_name": "#item_id_aux", "binding_type": "collection", "binding_collection_name": "$hotbar_collection_name"}
SEL_H = {"binding_name": "#slot_selected", "binding_type": "collection", "binding_collection_name": "$hotbar_collection_name"}
SHOW_FOOD = view(f"(#slot_selected and ({ALL_FOOD}))", "#visible")


def host(name, template, offset_var, ign):
    return {name: {
        "type": "collection_panel", "size": ["100%cm", "100%cm"], **HOTBAR,
        # the host's bottom-right corner is pinned to a point right of the hotbar centre, so rows grow leftwards
        "anchor_from": "bottom_middle", "anchor_to": "bottom_right", "offset": offset_var, "layer": 5,
        "$foodsaturation_hunger_offset|default": [102, -47], "$foodsaturation_saturation_offset|default": [102, -57],
        "$foodsaturation_show|default": True, "$foodsaturation_show_hunger|default": True,
        "$foodsaturation_show_saturation|default": True,
        "ignored": ign,
        "factory": {"name": name + "_factory", "control_name": "hud." + template},
        "property_bag": {"#collection_length": 9},
        "bindings": [{"binding_name": "#collection_length"},
                     {"binding_name": "#show_survival_ui", "binding_name_override": "#visible"}]}}


def row(groups_):
    return {"type": "stack_panel", "orientation": "horizontal", "size": ["100%c", "100%c"],
            "bindings": [COL_H, SEL_H, SHOW_FOOD], "controls": groups_}


ui = {
    "namespace": "hud",

    "hud_content": {"modifications": [{
        "array_name": "controls", "operation": "insert_front",
        "value": [host("pepe_fs_saturation", "pepe_fs_saturation_row", "$foodsaturation_saturation_offset",
                       "((not $foodsaturation_show) or (not $foodsaturation_show_saturation))"),
                  host("pepe_fs_hunger", "pepe_fs_hunger_row", "$foodsaturation_hunger_offset",
                       "((not $foodsaturation_show) or (not $foodsaturation_show_hunger))")]}]},

    "pepe_fs_saturation_row": row(sat_groups),
    "pepe_fs_hunger_row": row(hunger_groups),

    # shared images
    "pepe_fs_hunger_full": {"type": "image", "layer": 4, "texture": TEX + "food_hunger", "size": [9, 9]},
    "pepe_fs_hunger_half": {"type": "image", "layer": 4, "texture": TEX + "food_hunger_half", "size": [9, 9]},
    "pepe_fs_sat_full": {"type": "image", "layer": 4, "texture": TEX + "food_saturation", "size": [9, 9]},
    "pepe_fs_sat_half": {"type": "image", "layer": 4, "texture": TEX + "food_saturation_half", "size": [9, 9]},
}

ver = ".".join(map(str, VERSION))
manifest = {"format_version": 3, "header": {
    "name": f"Pepe's Food Saturation v{ver}",
    "description": f"AppleSkin-style preview of the hunger and saturation a held food restores, above the hunger bar. Item IDs match Minecraft {idfile['game_version']}. "
                   "§cNote: needs Pepe's Assets Pack 1.10.0+, keep this pack above it.",
    "uuid": PACK_UUID, "version": ver, "min_engine_version": "1.21.0", "pack_optimization_version": "0.1.0"},
    "modules": [{"type": "resources", "uuid": MODULE_UUID, "version": ver}],
    "metadata": {"authors": ["Pepe"]}}


def brarchive(files):
    """Encodes {name: bytes} as a .brarchive (same layout as the Glacier brarchive tool, mode=replace)."""
    name_max = 247
    out = struct.pack("<QII", 0x267052A0B125277D, len(files), 1)
    body = b""
    for name, data in files.items():
        raw = name.encode("utf8")
        out += bytes([len(raw)]) + raw.ljust(name_max, bytes(1)) + struct.pack("<II", len(body), len(data))
        body += data
    return out + body


def minify(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf8")


pack = HERE / "dist" / "pack"
if pack.exists():
    for f in sorted(pack.rglob("*"), reverse=True):
        f.unlink() if f.is_file() else f.rmdir()
(pack / "__brarchive").mkdir(parents=True, exist_ok=True)
(pack / "__brarchive" / "ui.brarchive").write_bytes(brarchive({"hud_screen.json": minify(ui)}))
(pack / "manifest.json").write_bytes(minify(manifest))
(pack / "pack_icon.png").write_bytes((HERE / "pack_icon.png").read_bytes())
out = HERE / "dist" / f"Pepe's_Food_Saturation_v{ver}.mcpack"
for old in (HERE / "dist").glob("Pepe's_Food_Saturation_v*.mcpack"):
    old.unlink()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(pack.rglob("*")):
        if f.is_file():
            z.write(f, f.relative_to(pack).as_posix())
print(f"Built {out.name} ({len(foods)} foods, IDs for {idfile['game_version']} {idfile['channel']}, brarchived)")
