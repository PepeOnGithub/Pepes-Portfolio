#!/usr/bin/env python3
"""Builds Pepe's Assets Pack v1.10.0: v1.9.0 plus everything Food Stats+ needs that is not UI.

    python -I tools/food-saturation/build_assets.py

Added to the Assets Pack (the shared pack all of Pepe's packs sit on):
  * textures  - the four shank textures, the effect icons Minecraft has no HUD icon for (saturation, instant health,
                instant damage) and font/glyph_E5.png, the font page with the shank glyphs used in text
  * settings  - Food Stats+ variables in ui/_global_variables.json (hide / opacity / offset ...), same naming style as
                the other packs; Food Stats+ reads them with built-in defaults, so editing here is optional
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from hover_ui import GLYPH_PAGE, build_glyph_page  # noqa: E402

REPO = HERE.parent.parent
SRC = REPO / "packs" / "other" / "pepes-assets-pack" / "Pepe's_Assets_Pack_v1.9.0.mcpack"
OUT = HERE / "dist" / "Pepe's_Assets_Pack_v1.10.0.mcpack"
VERSION = "1.10.0"
TEX = HERE / "assets" / "textures" / "pepe" / "common"

TEXTURES = ["food_hunger.png", "food_hunger_half.png", "food_saturation.png", "food_saturation_half.png",
            "effect_saturation.png", "effect_instant_health.png", "effect_instant_damage.png"]

# Food Stats+ settings. Existing variables from older packs that Food Stats+ also honours:
#   $hide_hover_item_id (the minecraft:<id> line in tooltips), $hide_suspicious_stew_info (stew flower info)
VARIABLES = {
    "$hide_food_stats_box": False,            # the hunger / saturation box under the item name
    "$food_stats_box_opacity": 0.6,
    "$food_stats_box_offset": [0, 0],
    "$hide_food_stats_effects": False,        # stew / potion effect box under the crosshair
    "$food_stats_effects_opacity": 0.6,
    "$food_stats_effects_offset": [0, 16],
    "$hide_food_stats_corner_icons": False,   # effect icon on stew / potion slots
    "$food_stats_corner_icon_size": [9, 9],
    "$food_stats_corner_icon_offset": [-1, 1],
    "$hide_food_stats_hover": False,          # hunger / saturation row in tooltips
    "$hide_food_stats_hover_effects": False,  # eat time, food / potion effects in tooltips
}


def main():
    zin = zipfile.ZipFile(SRC)
    manifest = json.loads(zin.read("manifest.json"))
    manifest["header"]["name"] = f"Pepe's Assets Pack v{VERSION}"
    manifest["header"]["version"] = VERSION
    manifest["modules"][0]["version"] = VERSION
    desc = manifest["header"]["description"]
    if "Food Stats+" not in desc:
        manifest["header"]["description"] = desc + (
            "\n\n§aFood Stats+:§f its textures, shank font and settings are included here.")
    variables = json.loads(zin.read("ui/_global_variables.json"))
    for k, v in VARIABLES.items():
        variables.setdefault(k, v)

    OUT.parent.mkdir(exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    tmp = HERE / "dist" / "_glyph_tmp.png"
    build_glyph_page(TEX).save(tmp)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if info.filename in ("manifest.json", "ui/_global_variables.json") or info.is_dir():
                continue
            zout.writestr(info.filename, zin.read(info.filename))
        zout.writestr("manifest.json", json.dumps(manifest, indent=4, ensure_ascii=False))
        zout.writestr("ui/_global_variables.json", json.dumps(variables, indent=2, ensure_ascii=False))
        for name in TEXTURES:
            zout.write(TEX / name, f"textures/pepe/common/{name}")
        zout.write(tmp, GLYPH_PAGE)
    tmp.unlink()
    print(f"Built {OUT.name}: {OUT.stat().st_size} bytes, +{len(TEXTURES)} textures, glyph page, "
          f"+{len(VARIABLES)} variables")


if __name__ == "__main__":
    main()
