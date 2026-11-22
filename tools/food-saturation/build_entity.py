#!/usr/bin/env python3
"""Builds the player-entity version of Pepe's Food Saturation (AppleSkin-style preview above the hunger bar).

    python tools/food-saturation/build_entity.py

Like ArmorHUD / Elytra Pitch it is drawn by the player entity through a live_player_renderer:
  * Pepe's Assets Pack v1.10.0 (built here from v1.9.0) carries the core: shank geometry, animation, render
    controller, a texture atlas, and the molang that turns the held item into hunger / saturation points
  * Pepe's Food Saturation (the extension) carries only the HUD hook (ui/hud_screen.json) and the settings

The held item is read with query.is_item_name_any('slot.weapon.mainhand', 0, 'minecraft:<name>', ...), so
no numeric item IDs are involved and the display does not break when Minecraft renumbers items.

Output: dist/Pepe's_Assets_Pack_v1.10.0.mcpack and dist/Pepe's_Food_Saturation_v2.0.0.mcpack
"""
import json
import struct
import sys
import zipfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SRC_ASSETS = REPO / "packs" / "other" / "pepes-assets-pack" / "Pepe's_Assets_Pack_v1.9.0.mcpack"
DIST = HERE / "dist"

FS_VERSION = "2.0.0"
FS_PACK_UUID = "149a546e-773e-41fa-bc14-dfafde9d9ccd"
FS_MODULE_UUID = "0e38c5ae-d230-4268-96e6-6340cfc2877b"

foods = {k: tuple(v) for k, v in json.loads((HERE / "foods.json").read_text("utf8")).items()}

HUNGER_SLOTS = 5     # 10 points = 5 shanks (rabbit stew)
SAT_SLOTS = 8        # 14.4 = 7.2 shanks (golden carrot)
PITCH = 8            # vanilla's hunger bar draws a 9px shank every 8px
SAT_ROW_Y = 10       # the saturation row sits one row above the hunger row
UNITS_PER_PX = 1.04  # ArmorHUD's calibrated ratio between its pack-setting pixels and bone units
# Where the geometry origin is on screen (see the UI hook): centred, 309px below the bottom edge, so
# other packs' geometry that is drawn in this renderer lands off-screen. The default placement puts the right
# edge of the rows 102px right of the screen centre and the hunger row 51.5px above the bottom edge, which is
# where the vanilla hunger bar sits on a phone; the X/Y settings fine-tune it in game.
ORIGIN_BELOW_BOTTOM = 309
DEFAULT_RIGHT_EDGE_PX = 102
DEFAULT_HUNGER_ROW_PX = 51.5


# ---------- .brarchive helpers (same layout as the Glacier brarchive tool, mode=replace) ----------
MAGIC = 0x267052A0B125277D
NAME_MAX = 247


def brar_decode(b):
    _, count, _ = struct.unpack("<QII", b[:16])
    start = 16 + (1 + NAME_MAX + 8) * count
    out = {}
    for i in range(count):
        p = 16 + (1 + NAME_MAX + 8) * i
        n = b[p]
        name = b[p + 1:p + 1 + n].decode("utf8")
        off, ln = struct.unpack("<II", b[p + 1 + NAME_MAX:p + 1 + NAME_MAX + 8])
        out[name] = b[start + off:start + off + ln]
    return out


def brar_encode(files):
    out = struct.pack("<QII", MAGIC, len(files), 1)
    body = b""
    for name, data in files.items():
        raw = name.encode("utf8")
        out += bytes([len(raw)]) + raw.ljust(NAME_MAX, bytes(1)) + struct.pack("<II", len(body), len(data))
        body += data
    return out + body


def minify(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf8")


# ---------- the molang that turns the held item into points ----------
def tier_sum(idx):
    """sum over value tiers: is_item_name_any(slot, 0, names...) * value  (the foods of a tier share one call)"""
    tiers = {}
    for name, vals in foods.items():
        tiers.setdefault(vals[idx], []).append(f"'minecraft:{name}'")
    parts = [f"(query.is_item_name_any('slot.weapon.mainhand', 0, {', '.join(sorted(names))}) * {v})"
             for v, names in sorted(tiers.items())]
    return " + ".join(parts)


PRE_SCRIPT = (
    "v.pepe_fs_on = t.pepe_ok ? ((query.is_in_ui && !variable.is_paperdoll && query.is_local_player && query.is_alive "
    "&& !query.is_spectator && query.is_pack_setting_enabled('pepe:fs_enabled')) ? 1 : 0) : 0; "
    f"v.pepe_fs_hp = (v.pepe_fs_on && query.is_pack_setting_enabled('pepe:fs_hunger')) ? ({tier_sum(0)}) : 0; "
    f"v.pepe_fs_sp = (v.pepe_fs_on && query.is_pack_setting_enabled('pepe:fs_saturation')) ? ({tier_sum(1)}) : 0;"
)

# ---------- geometry ----------
def cube(x, y, u, v):
    face = lambda uv, size: {"uv": uv, "uv_size": size}
    zero = {"uv": [0, 0], "uv_size": [0, 0]}
    return {"origin": [x, y, 0.5], "size": [9, 9, 0],
            "uv": {"north": face([u, v], [9, 9]), "east": zero, "south": zero, "west": zero, "up": zero, "down": zero}}


def geometry():
    # same upright-fix bone chain ArmorHUD uses (animated while gliding by animation.player.pepe_glide_tilt)
    bones = [
        {"name": "pepe_glide_twistfix", "pivot": [0, 24.2, 0]},
        {"name": "pepe_glide_pitchfix", "parent": "pepe_glide_twistfix", "pivot": [0, 24.2, 0]},
        {"name": "pepe_fs_frame", "parent": "pepe_glide_pitchfix", "pivot": [0, 0, 0]},
        {"name": "pepe_fs_pos", "parent": "pepe_fs_frame", "pivot": [0, 0, 0]},
    ]
    # atlas (18x18): [hunger full | hunger half] / [saturation full | saturation half]
    for i in range(1, HUNGER_SLOTS + 1):
        x = -9 - PITCH * (i - 1)
        bones.append({"name": f"pepe_fs_hf{i}", "parent": "pepe_fs_pos", "pivot": [0, 0, 0], "cubes": [cube(x, -4.5, 0, 0)]})
        bones.append({"name": f"pepe_fs_hh{i}", "parent": "pepe_fs_pos", "pivot": [0, 0, 0], "cubes": [cube(x, -4.5, 9, 0)]})
    for i in range(1, SAT_SLOTS + 1):
        x = -9 - PITCH * (i - 1)
        y = -4.5 + SAT_ROW_Y
        bones.append({"name": f"pepe_fs_sf{i}", "parent": "pepe_fs_pos", "pivot": [0, 0, 0], "cubes": [cube(x, y, 0, 9)]})
        bones.append({"name": f"pepe_fs_sh{i}", "parent": "pepe_fs_pos", "pivot": [0, 0, 0], "cubes": [cube(x, y, 9, 9)]})
    return {"format_version": "1.12.0", "minecraft:geometry": [
        {"description": {"identifier": "geometry.pepe_fs", "texture_width": 18, "texture_height": 18}, "bones": bones}]}


# ---------- animation ----------
def animation():
    pos_x = f"{DEFAULT_RIGHT_EDGE_PX * UNITS_PER_PX:.2f} + {UNITS_PER_PX} * query.get_pack_setting('pepe:fs_x')"
    pos_y = (f"{(ORIGIN_BELOW_BOTTOM + DEFAULT_HUNGER_ROW_PX) * UNITS_PER_PX:.2f} + {UNITS_PER_PX} * "
             "query.get_pack_setting('pepe:fs_y')")
    bones = {"pepe_fs_pos": {"position": [pos_x, pos_y, 0], "scale": "query.get_pack_setting('pepe:fs_size') / 100"}}
    for i in range(1, HUNGER_SLOTS + 1):
        bones[f"pepe_fs_hf{i}"] = {"scale": f"v.pepe_fs_hp >= {2 * i} ? 1 : 0"}
        bones[f"pepe_fs_hh{i}"] = {"scale": f"v.pepe_fs_hp == {2 * i - 1} ? 1 : 0"}
    for i in range(1, SAT_SLOTS + 1):
        bones[f"pepe_fs_sf{i}"] = {"scale": f"v.pepe_fs_sp >= {2 * i} ? 1 : 0"}
        bones[f"pepe_fs_sh{i}"] = {"scale": f"(v.pepe_fs_sp > {2 * i - 2} && v.pepe_fs_sp < {2 * i}) ? 1 : 0"}
    return {"format_version": "1.8.0", "animations": {"animation.player.pepe_fs": {"loop": True, "bones": bones}}}


def render_controllers():
    return {"format_version": "1.8.0", "render_controllers": {"controller.render.pepe_fs": {
        "geometry": "Geometry.pepe_fs",
        "materials": [{"*": "Material.pepe_pitch"}],
        "textures": ["Texture.pepe_fs"],
        "ignore_lighting": True, "light_color_multiplier": 1.3,
        "is_hurt_color": {}, "on_fire_color": {},
        "uv_anim": {"offset": [0, 0], "scale": [1, 1]}}}}


# ---------- texture atlas ----------
def atlas():
    src = HERE / "assets" / "textures" / "pepe" / "common"
    hunger = Image.open(src / "food_hunger.png").convert("RGBA")
    sat = Image.open(src / "food_saturation.png").convert("RGBA")

    hunger_half = hunger.copy()          # cut from the front (like vanilla's half shank): the bone side stays
    px = hunger_half.load()
    for x in range(0, 4):
        for y in range(9):
            px[x, y] = (0, 0, 0, 0)

    sat_half = sat.copy()                # filled from the back: the front part is grey
    px = sat_half.load()
    for x in range(0, 5):
        for y in range(9):
            r, g, b, a = px[x, y]
            if a:
                grey = 70 + int(0.299 * r + 0.587 * g + 0.114 * b) // 4
                px[x, y] = (grey, grey, grey, a)

    sheet = Image.new("RGBA", (18, 18), (0, 0, 0, 0))
    sheet.paste(hunger, (0, 0))
    sheet.paste(hunger_half, (9, 0))
    sheet.paste(sat, (0, 9))
    sheet.paste(sat_half, (9, 9))
    import io
    buf = io.BytesIO()
    sheet.save(buf, "PNG", optimize=True)
    return buf.getvalue()


# ---------- Assets Pack v1.10.0 ----------
def build_assets():
    zin = zipfile.ZipFile(SRC_ASSETS)
    files = {i.filename: zin.read(i.filename) for i in zin.infolist()}

    def amend(archive, add=None, edit=None):
        entries = brar_decode(files[archive])
        if edit:
            for name, fn in edit.items():
                entries[name] = fn(entries[name])
        for name, data in (add or {}).items():
            entries[name] = data
        files[archive] = brar_encode(entries)

    def edit_entity(raw):
        e = json.loads(raw.decode("utf8"))
        d = e["minecraft:client_entity"]["description"]
        d["textures"]["pepe_fs"] = "textures/pepe/food/shanks"
        d["geometry"]["pepe_fs"] = "geometry.pepe_fs"
        d["animations"]["pepe_fs"] = "animation.player.pepe_fs"
        d["scripts"]["initialize"] += ["v.pepe_fs_on = 0.0; v.pepe_fs_hp = 0.0; v.pepe_fs_sp = 0.0;"]
        # runs right after the other pepe_* HUD variables, once t.pepe_ok exists
        d["scripts"]["pre_animation"].append(PRE_SCRIPT)
        d["scripts"]["animate"].append({"pepe_fs": "v.pepe_fs_on"})
        d["render_controllers"].append(
            {"controller.render.pepe_fs": "query.is_in_ui && !variable.is_paperdoll && query.is_local_player "
                                          "&& (v.pepe_fs_on ?? 0) && ((v.pepe_fs_hp ?? 0) > 0 || (v.pepe_fs_sp ?? 0) > 0)"})
        return minify(e)

    amend("__brarchive/entity.brarchive", edit={"player.entity.json": edit_entity})
    amend("__brarchive/animations.brarchive", add={"pepe_food.animation.json": minify(animation())})
    amend("__brarchive/models/entity.brarchive", add={"pepe_food.geo.json": minify(geometry())})
    amend("__brarchive/render_controllers.brarchive", add={"pepe_food.render_controllers.json": minify(render_controllers())})
    files["textures/pepe/food/shanks.png"] = atlas()

    manifest = json.loads(files["manifest.json"].decode("utf8"))
    manifest["header"]["name"] = "Pepe's Assets Pack v1.10.0"
    manifest["header"]["version"] = "1.10.0"
    manifest["modules"][0]["version"] = "1.10.0"
    manifest["header"]["description"] += "\nThe Food Saturation core (shank geometry, animation, held-item tables) is included here; its HUD hook and settings are in Pepe's Food Saturation."
    files["manifest.json"] = json.dumps(manifest, indent=4, ensure_ascii=False).encode("utf8")

    out = DIST / "Pepe's_Assets_Pack_v1.10.0.mcpack"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    return out


# ---------- Food Saturation extension ----------
def build_extension():
    ui = {
        "hud_content": {"modifications": [{"array_name": "controls", "operation": "insert_front",
                                           "value": [{"pepe_fs_live@hud.pepe_fs_live": {}}]}]},
        "pepe_fs_live": {
            "type": "custom", "renderer": "hud_player_renderer", "size": [0, 0],
            "anchor_from": "bottom_middle", "anchor_to": "bottom_middle",
            "controls": [{"pepe_fs_live_renderer@hud.pepe_fs_live_renderer": {}}]},
        "pepe_fs_live_renderer": {
            "type": "custom", "renderer": "live_player_renderer", "layer": 2, "size": [18, 18],
            "anchor_from": "bottom_middle", "anchor_to": "bottom_middle", "offset": [0, ORIGIN_BELOW_BOTTOM - 9]},
    }

    def slider(text, name, lo, hi, default, step=1):
        return {"type": "slider", "text": text, "name": name, "min": lo, "max": hi, "step": step, "default": default}

    manifest = {"format_version": 3, "header": {
        "name": f"Pepe's Food Saturation v{FS_VERSION}",
        "description": "AppleSkin-style preview: while you hold food, the hunger and saturation it restores are shown above "
                       "the hunger bar as full/half shanks. §cNote: Pepe's Assets Pack 1.10.0+ is required, keep this pack above it.",
        "uuid": FS_PACK_UUID, "version": FS_VERSION, "min_engine_version": "1.26.0", "pack_optimization_version": "0.1.0"},
        "modules": [{"type": "resources", "uuid": FS_MODULE_UUID, "version": FS_VERSION}],
        "metadata": {"authors": ["Pepe"]},
        "settings": [
            {"type": "label", "text": "§l§bFood Saturation §r§7(needs Pepe's Assets Pack 1.10.0+)§r"},
            {"type": "toggle", "text": "§bFood Saturation §r| §7Show what the food in your hand restores.§r",
             "name": "pepe:fs_enabled", "default": True},
            {"type": "toggle", "text": "§bHunger §r| §7Show the hunger shanks (white).§r",
             "name": "pepe:fs_hunger", "default": True},
            {"type": "toggle", "text": "§bSaturation §r| §7Show the saturation shanks (yellow), one row above hunger.§r",
             "name": "pepe:fs_saturation", "default": True},
            {"type": "label", "text": "§l§bPosition§r"},
            slider("§fX Offset §r| §7-=Left  0=Default  +=Right§r", "pepe:fs_x", -600, 600, 0),
            slider("§fY Offset §r| §7-=Down  0=Default  +=Up§r", "pepe:fs_y", -400, 400, 0),
            slider("§fSize §r| §750=Tiny  100=Default  300=Huge §r(percent)", "pepe:fs_size", 50, 300, 100, 5),
        ]}

    pack = DIST / "pack_ext"
    if pack.exists():
        for f in sorted(pack.rglob("*"), reverse=True):
            f.unlink() if f.is_file() else f.rmdir()
    (pack / "__brarchive").mkdir(parents=True)
    (pack / "__brarchive" / "ui.brarchive").write_bytes(brar_encode({"hud_screen.json": minify(ui)}))
    (pack / "manifest.json").write_bytes(minify(manifest))
    (pack / "pack_icon.png").write_bytes((HERE / "pack_icon.png").read_bytes())
    out = DIST / f"Pepe's_Food_Saturation_v{FS_VERSION}.mcpack"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(pack.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(pack).as_posix())
    return out


if __name__ == "__main__":
    DIST.mkdir(exist_ok=True)
    a = build_assets()
    e = build_extension()
    print(f"Built {a.name} and {e.name}")
    print("molang held-item script:", len(PRE_SCRIPT), "chars")
