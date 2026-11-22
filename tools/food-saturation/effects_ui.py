"""Effect icons under the crosshair while holding a suspicious stew or a potion (AsaBetter's enchant book viewer
idea: a row of icons for what the held item does). Same detection as the food box: a stack of nine cells over the
hotbar_items collection, an entry is visible when its slot is selected AND the item id (+ aux) matches."""
import re

from hover_ui import POTIONS, POTION_KIND, STEW_HUD

V = "textures/ui/"
P = "textures/pepe/common/"
# effect name (level stripped) -> icon texture. instant health/damage and saturation have no vanilla HUD icon,
# so AsaBetter's icons are shipped with the pack (assets/textures/pepe/common/effect_*.png).
ICON = {
    "Night Vision": V + "night_vision_effect", "Invisibility": V + "invisibility_effect",
    "Jump Boost": V + "jump_boost_effect", "Fire Resistance": V + "fire_resistance_effect",
    "Speed": V + "speed_effect", "Slowness": V + "slowness_effect", "Water Breathing": V + "water_breathing_effect",
    "Instant Health": P + "effect_instant_health", "Instant Damage": P + "effect_instant_damage",
    "Poison": V + "poison_effect", "Regeneration": V + "regeneration_effect", "Strength": V + "strength_effect",
    "Weakness": V + "weakness_effect", "Wither": V + "wither_effect", "Resistance": V + "resistance_effect",
    "Slow Falling": V + "slow_falling_effect", "Saturation": P + "effect_saturation",
    "Blindness": V + "blindness_effect", "Nausea": V + "nausea_effect",
    "Wind Charged": V + "wind_charged_effect", "Weaving": V + "weaving_effect",
    "Oozing": V + "oozing_effect", "Infested": V + "infested_effect",
}
ROMAN = re.compile(r"\s+(?:II|III|IV|V|VI)$")


def icons_for(text):
    """'Slowness IV + Resistance III' -> [slowness icon, resistance icon]; unknown effects have no icon"""
    out = []
    for part in text.split("+"):
        icon = ICON.get(ROMAN.sub("", part.strip()))
        if icon:
            out.append(icon)
    return out


def groups(stew_id, potion_ids):
    """{(text, colour, icons): [item id * 65536 + aux, ...]} - one entry per distinct label"""
    out = {}
    for child, (icon, name, when, good) in STEW_HUD.items():
        out.setdefault((name, good, (icon,)), []).append(stew_id * 65536 + child)
    for item_id, kind in potion_ids.items():
        for aux, (name, good, secs) in POTIONS.items():
            if good is None:
                continue
            out.setdefault((name, "a" if good else "c", tuple(icons_for(name))), []).append(item_id * 65536 + aux)
    return out


def build(stew_id, view, col, dbg=None):
    """-> (templates, cells_control). `view` and `col` come from build_asa so the bindings stay identical."""
    potion_ids = {430: 1, 571: 2, 572: 3}
    templates, entries = {}, []
    for k, ((name, colour, icons), item_ids) in enumerate(sorted(groups(stew_id, potion_ids).items(), key=str)):
        # exact match by STRING, like AsaBetter's '#asa_item_aux_id = '§z27918340''. Numeric = on these big ids is
        # fuzzy (id * 65536 + aux is ~40 million), which made every stew/potion variant match at once.
        match = " or ".join(f"(#pepe_aux = '§z{i}')" for i in item_ids)
        parts = []
        for n, icon in enumerate(icons):
            parts.append({f"ic{n}": {"type": "image", "layer": 2, "size": [12, 12], "texture": icon}})
        parts.append({"gap": {"type": "panel", "size": [3, 1]}})
        parts.append({"name": {"type": "label", "layer": 2, "shadow": True, "text": "§" + colour + name}})
        entry = {"type": "panel", "size": ["100%c", "100%c + 4px"],
                 "bindings": col + [
                     dict(view("('§z' + #item_id_aux)", "#pepe_aux"), binding_condition="always"),
                     dict(view(f"({match})", "#pepe_match"), binding_condition="always"),
                     dict(view("(#slot_selected and #pepe_match)", "#visible"), binding_condition="always")],
                 "controls": [{"box": {
                     "type": "image", "texture": "textures/ui/hud_tip_text_background", "alpha": "$food_stats_effects_opacity",
                     "size": ["100%c + 6px", "100%c + 4px"],
                     "controls": [{"row": {"type": "stack_panel", "orientation": "horizontal",
                                           "size": ["100%c", "100%cm"], "controls": parts}}]}}]}
        if dbg:
            entry["debug"] = dbg
        templates[f"pepe_fx_{k}"] = entry
        entries.append({f"e{k}@hud.pepe_fx_{k}": {}})
    templates["pepe_fx_cell"] = {"type": "panel", "size": ["100%cm", "100%cm"], "controls": entries}
    cells = {"pepe_fx_cells": {
        "type": "stack_panel", "orientation": "vertical", "size": ["100%cm", "100%c"],
        "anchor_from": "center", "anchor_to": "center", "layer": 4,
        # customisation: set these in the Assets Pack's _global_variables.json
        "$hide_food_stats_effects|default": False, "$food_stats_effects_opacity|default": 0.6,
        "$food_stats_effects_offset|default": [0, 16],
        "ignored": "$hide_food_stats_effects", "offset": "$food_stats_effects_offset",
        "collection_name": "hotbar_items",
        "controls": [{f"pepe_fx_cell_{i}@hud.pepe_fx_cell": {"collection_index": i}} for i in range(9)]}}
    return templates, cells
