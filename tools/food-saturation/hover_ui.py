#!/usr/bin/env python3
"""Item hover-text patch for Pepe's Food Saturation (pure JSON UI, no entity).

Same mechanism as stable.mcpack (Item ID Viewer) - ui/ui_common.json patches
highlight_slot_panel/highlight/hover_text:
  * property_bag  "#pepe_fs:<item id>" -> the extra tooltip lines for that food
  * a view binding builds #hover_text = vanilla name + "\\n" + ('#pepe_fs:' + (#id_aux / 65536)); for items
    without an entry the property resolves to "" and the "- suffix" removes the added newline again.
The hover renderer only draws text, so the shanks are font glyphs (private-use page glyph_E5.png) inside that text.

    python -I tools/food-saturation/hover_ui.py [scratch_output.json]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOVER_FILE = "ui/ui_common.json"
HOVER_KEY = "highlight_slot_panel/highlight/hover_text"
GLYPH_PAGE = "font/glyph_E5.png"
S = "§"

# private-use characters on glyph_E5: hunger full/half, saturation full/half
H_FULL, H_HALF, S_FULL, S_HALF = "", "", "", ""


def fmt(v):
    return str(int(v)) if float(v).is_integer() else str(v)


def shanks(value, full_ch, half_ch):
    """half shank first (rows fill from the right like the vanilla bar), then full shanks"""
    full = int(value // 2)
    half = (value - 2 * full) > 0.01
    return (half_ch if half else "") + full_ch * full


def row(hunger, saturation):
    """one horizontal row: saturation shanks + number | hunger shanks + number"""
    return (f"{S}e{shanks(saturation, S_FULL, S_HALF)} {S}f{fmt(saturation)}"
            f" {S}f|{S}r "
            f"{S}6{shanks(hunger, H_FULL, H_HALF)} {S}f{fmt(hunger)}")


# extra tooltip info (hover only). Eat time is 1.6s for everything except these; effects are limited to the
# well-known ones (green = good, red = bad)
EAT_TIME = {"dried_kelp": "0.8", "honey_bottle": "2.0"}
EFFECTS = {
    "golden_apple": f"{S}aRegeneration II 0:05, Absorption I 2:00",
    "enchanted_golden_apple": f"{S}aRegeneration, Absorption, Resistance, Fire Resistance",
    "rotten_flesh": f"{S}cHunger 0:30 (80%)",
    "chicken": f"{S}cHunger 0:30 (30%)",
    "pufferfish": f"{S}cHunger, Nausea, Poison",
    "spider_eye": f"{S}cPoison 0:05",
    "poisonous_potato": f"{S}cPoison (60%)",
    "honey_bottle": f"{S}aCures Poison",
    "chorus_fruit": f"{S}dTeleports you randomly",
}


# suspicious stew flowers by aux value, copied from the data in Glacier's hover text (good = green, bad = red)
STEW = {
    0: f"\n{S}aNight Vision (0:05)\n{S}7Poppy, Torchflower",
    1: f"\n{S}aJump Boost (0:05)\n{S}7Cornflower",
    2: f"\n{S}cWeakness (0:07)\n{S}7Tulips",
    3: f"\n{S}cBlindness (0:07)\n{S}7Azure Bluet, Open Eyeblossom",
    4: f"\n{S}cPoison (0:11)\n{S}7Lily of the Valley",
    5: f"\n{S}aSaturation (0:03)\n{S}7Blue Orchid, Dandelion",
    6: f"\n{S}aSaturation (0:03)\n{S}7Blue Orchid, Dandelion",
    7: f"\n{S}aFire Resistance (0:03)\n{S}7Allium",
    8: f"\n{S}aRegeneration (0:07)\n{S}7Oxeye Daisy",
    9: f"\n{S}cWither (0:07)\n{S}7Wither Rose",
    10: f"\n{S}aNight Vision (0:05)\n{S}7Poppy, Torchflower",
    11: f"\n{S}cBlindness (0:07)\n{S}7Azure Bluet, Open Eyeblossom",
    12: f"\n{S}cNausea (0:07)\n{S}7Closed Eyeblossom",
}


# potions by aux value (Bedrock data values, from the minecraft.wiki Potion page - one source, so unverified in game).
# (effect text, good?, drink seconds); splash = 0.75x, lingering = 0.25x. None = no effect / instant
POTIONS = {
    0: ("Water Bottle", None, None), 1: ("Mundane", None, None), 2: ("Mundane", None, None),
    3: ("Thick", None, None), 4: ("Awkward", None, None),
    5: ("Night Vision", True, 180), 6: ("Night Vision", True, 480),
    7: ("Invisibility", True, 180), 8: ("Invisibility", True, 480),
    9: ("Jump Boost", True, 180), 10: ("Jump Boost", True, 480), 11: ("Jump Boost II", True, 90),
    12: ("Fire Resistance", True, 180), 13: ("Fire Resistance", True, 480),
    14: ("Speed", True, 180), 15: ("Speed", True, 480), 16: ("Speed II", True, 90),
    17: ("Slowness", False, 90), 18: ("Slowness", False, 240),
    19: ("Water Breathing", True, 180), 20: ("Water Breathing", True, 480),
    21: ("Instant Health", True, 0), 22: ("Instant Health II", True, 0),
    23: ("Instant Damage", False, 0), 24: ("Instant Damage II", False, 0),
    25: ("Poison", False, 45), 26: ("Poison", False, 120), 27: ("Poison II", False, 22),
    28: ("Regeneration", True, 45), 29: ("Regeneration", True, 120), 30: ("Regeneration II", True, 22),
    31: ("Strength", True, 180), 32: ("Strength", True, 480), 33: ("Strength II", True, 90),
    34: ("Weakness", False, 90), 35: ("Weakness", False, 240),
    36: ("Wither II", False, 40),
    37: ("Slowness IV + Resistance III", True, 20), 38: ("Slowness IV + Resistance III", True, 40),
    39: ("Slowness VI + Resistance IV", True, 20),
    40: ("Slow Falling", True, 90), 41: ("Slow Falling", True, 240),
    42: ("Slowness IV", False, 20),
    43: ("Wind Charged", True, 180), 44: ("Weaving", True, 180), 45: ("Oozing", True, 180),
    46: ("Infested", True, 180),
}
POTION_ITEMS = {430: 1, 571: 0.75, 572: 0.25}      # potion, splash_potion, lingering_potion (1.26.50 ids)
POTION_KIND = {430: 1, 571: 2, 572: 3}
MILK_ID, OMINOUS_ID = 364, 605


def _mss(sec):
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def potion_text(aux, scale):
    name, good, secs = POTIONS[aux]
    if good is None:
        return f"\n{S}7{name}"
    colour = "a" if good else "c"
    when = "instant" if secs == 0 else _mss(secs * scale)
    return f"\n{S}{colour}{name} ({when})"


# suspicious stew rows for the HUD box: aux -> (effect icon texture, name, time, colour code). Vanilla effect icons
# (textures/ui/*_effect) except saturation, which is AsaBetter's icon shipped with this pack.
_V = "textures/ui/"
_SAT = "textures/pepe/common/effect_saturation"
STEW_HUD = {
    0: (_V + "night_vision_effect", "Night Vision", "0:05", "a"),
    1: (_V + "jump_boost_effect", "Jump Boost", "0:05", "a"),
    2: (_V + "weakness_effect", "Weakness", "0:07", "c"),
    3: (_V + "blindness_effect", "Blindness", "0:07", "c"),
    4: (_V + "poison_effect", "Poison", "0:11", "c"),
    5: (_SAT, "Saturation", "0:03", "a"),
    6: (_SAT, "Saturation", "0:03", "a"),
    7: (_V + "fire_resistance_effect", "Fire Resistance", "0:03", "a"),
    8: (_V + "regeneration_effect", "Regeneration", "0:07", "a"),
    9: (_V + "wither_effect", "Wither", "0:07", "c"),
    10: (_V + "night_vision_effect", "Night Vision", "0:05", "a"),
    11: (_V + "blindness_effect", "Blindness", "0:07", "c"),
    12: (_V + "nausea_effect", "Nausea", "0:07", "c"),
}


def extra(name):
    eat = f"{S}fEat {EAT_TIME.get(name, '1.6')}s"
    return eat + (f"  {EFFECTS[name]}" if name in EFFECTS else "")


def lines(name, hunger, saturation):
    return f"\n{S}7minecraft:{name}\n" + row(hunger, saturation) + "\n" + extra(name)


def hud_lines(hunger, saturation):
    """HUD version: the same single row, without the item id line"""
    return row(hunger, saturation)


def build_hover(foods, ids, minimal=False):
    """foods {name: (hunger, saturation)}, ids {name: numeric id} -> ui_common.json content.

    Structure follows the Suspicious Stew Info pack's hover text (used with the author's permission): the vanilla
    text stays in #hover_text_binding, the keys are built in small view bindings as plain strings WITHOUT the '#',
    and only the last expression prefixes '#', which is what makes the property lookup resolve (a name with no entry
    then adds nothing, instead of the "0" my inline lookups produced).

    Every part has an on/off flag read from the Assets Pack's _global_variables.json (with defaults here): the flag is
    the digit after the key prefix, so an item whose part is switched off looks up a key that does not exist."""
    missing = [n for n in foods if n not in ids]
    if missing:
        raise ValueError(f"item_ids is missing: {', '.join(sorted(missing))}")
    bag = {}
    for n, (h, s) in foods.items():
        bag[f"#pepe_fid_1{ids[n]}"] = f"\n{S}7minecraft:{n}"             # item id line
        bag[f"#pepe_food_1{ids[n]}"] = f"\n{row(h, s)}"                   # hunger / saturation row
        bag[f"#pepe_fxl_1{ids[n]}"] = f"\n{extra(n)}"                      # eat time + effects
    bag[f"#pepe_fxl_1{MILK_ID}"] = f"\n{S}aClears all effects"
    bag[f"#pepe_fxl_1{OMINOUS_ID}"] = f"\n{S}cGives Bad Omen"
    # suspicious stew: the flower is the aux value (child = id_aux - id * 65536); key = 'pepe_stew_' + flag + child
    for child, text in STEW.items():
        bag[f"#pepe_stew_11{child}"] = text
    # potions / splash / lingering: key = 'pepe_potion_' + flag + kind (1/2/3, 0 = not a potion) + aux
    for item_id, scale in POTION_ITEMS.items():
        for aux in POTIONS:
            bag[f"#pepe_potion_1{POTION_KIND[item_id]}{aux}"] = potion_text(aux, scale)
    stew_id = ids["suspicious_stew"]
    kinds = " + ".join(f"((#item_id = {i}) * {k})" for i, k in POTION_KIND.items())
    flag = lambda var: f"((not ${var}) * 1)"
    names = ("fid", "food", "fxl", "stew", "potion")
    parts = "".join(f" + ('#' + #pepe_{n}_key)" for n in names)
    if minimal:
        parts = " + ('#' + #pepe_fid_key) + ('#' + #pepe_food_key) + ('#' + #pepe_fxl_key)"
    return {
        # same companion overrides stable.mcpack ships so only this hover text is drawn
        "highlight_slot_panel/highlight": {"bindings": []},
        "highlight_slot_panel/white_border": {"bindings": []},
        "slot_selected": {"ignored": True},
        "inventory_icon_panel/hover_text": {"ignored": True},
        "selected_item_details/item_panel_image": {"ignored": True},
        HOVER_KEY: {
            # customisation: set these in the Assets Pack's _global_variables.json
            "$hide_hover_item_id|default": False,
            "$hide_food_stats_hover|default": False,
            "$hide_food_stats_hover_effects|default": False,
            "$hide_suspicious_stew_info|default": False,
            "property_bag": bag,
            "bindings": [
                {"binding_type": "collection_details"},
                {"binding_name": "$hover_text_binding_name", "binding_name_override": "#hover_text_binding",
                 "binding_type": "collection", "binding_collection_name": "$item_collection_name"},
                {"binding_name": "#item_id_aux", "binding_type": "collection",
                 "binding_collection_name": "$item_collection_name"},
                {"binding_type": "view", "source_property_name": "(#item_id_aux / 65536)",
                 "target_property_name": "#item_id", "binding_condition": "always_when_visible"},
                {"binding_type": "view", "source_property_name": "(#item_id_aux - (#item_id * 65536))",
                 "target_property_name": "#child_item_id", "binding_condition": "always_when_visible"},
                {"binding_type": "view",
                 "source_property_name": f"('pepe_fid_' + {flag('hide_hover_item_id')} + #item_id)",
                 "target_property_name": "#pepe_fid_key", "binding_condition": "always_when_visible"},
                {"binding_type": "view",
                 "source_property_name": f"('pepe_food_' + {flag('hide_food_stats_hover')} + #item_id)",
                 "target_property_name": "#pepe_food_key", "binding_condition": "always_when_visible"},
                {"binding_type": "view",
                 "source_property_name": f"('pepe_fxl_' + {flag('hide_food_stats_hover_effects')} + #item_id)",
                 "target_property_name": "#pepe_fxl_key", "binding_condition": "always_when_visible"},
                {"binding_type": "view",
                 "source_property_name": f"('pepe_stew_' + {flag('hide_suspicious_stew_info')} "
                                         f"+ ((#item_id = {stew_id}) * 1) + #child_item_id)",
                 "target_property_name": "#pepe_stew_key", "binding_condition": "always_when_visible"},
                {"binding_type": "view",
                 "source_property_name": f"('pepe_potion_' + {flag('hide_food_stats_hover_effects')} "
                                         f"+ ({kinds}) + #child_item_id)",
                 "target_property_name": "#pepe_potion_key", "binding_condition": "always_when_visible"},
                {"binding_type": "view",
                 "source_property_name": f"(#hover_text_binding{parts})",
                 "target_property_name": "#hover_text"},
                {"binding_type": "view", "source_property_name": "(not (#item_id_aux = -1))",
                 "target_property_name": "#visible"}]}}


def build_glyph_page(tex_dir):
    """256x256 glyph page, 16x16 cells: the four shank textures native 9x9 in cells 0..3"""
    from PIL import Image
    page = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    for i, name in enumerate(["food_hunger", "food_hunger_half", "food_saturation", "food_saturation_half"]):
        # native 9x9 at the bottom-left of the 16x16 cell, so it renders at text size instead of 2x
        img = Image.open(Path(tex_dir) / f"{name}.png").convert("RGBA")
        page.paste(img, (i * 16, 4))
    return page


if __name__ == "__main__":
    foods = {k: tuple(v) for k, v in json.loads((HERE / "foods.json").read_text("utf8")).items()}
    ids = json.loads((HERE / "item_ids.json").read_text("utf8"))["ids"]
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("hover_ui_scratch.json")
    out.write_text(json.dumps(build_hover(foods, ids), ensure_ascii=False, indent=2), "utf8")
    json.loads(out.read_text("utf8"))
    print(f"wrote {out}")
