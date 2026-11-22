"""Effect icon on suspicious stew items: a small icon in the top-right corner of a stew's slot (hotbar, inventory,
containers, crafting output, villager trades) showing which effect that stew gives.

Idea and hook points follow the Suspicious Stew Info pack by Dimzcraft (used with the author's permission); the
code here is written for this pack. The flower is the item's aux value: child = id_aux - id * 65536."""
from effects_ui import icons_for
from hover_ui import POTIONS, POTION_KIND, STEW_HUD


def _view(src, dst, cond=None):
    b = {"binding_type": "view", "source_property_name": src, "target_property_name": dst}
    if cond:
        b["binding_condition"] = cond
    return b


def template(stew_id):
    """the icon control (namespace hud); $item_collection_name / $binding_collection_type come from where it is used"""
    bag = {f"#pepe_stew_icon_{c}": icon.replace("textures/", "", 1) for c, (icon, *_rest) in STEW_HUD.items()}
    return {
        "type": "image", "allow_debug_missing_texture": False, "property_bag": bag,
        "$binding_collection_type|default": "collection",
        "bindings": [
            {"binding_type": "collection_details"},
            {"binding_name": "#item_id_aux", "binding_type": "$binding_collection_type",
             "binding_collection_name": "$item_collection_name"},
            _view("(#item_id_aux / 65536)", "#item_id"),
            _view("(#item_id_aux - (#item_id * 65536))", "#child_item_id", "always_when_visible"),
            _view("('textures/' + ('#pepe_stew_icon_' + #child_item_id))", "#texture", "always_when_visible"),
            _view(f"(#item_id = {stew_id})", "#visible")]}


def potion_template():
    """same corner icon for potions / splash / lingering: the first effect's icon, picked by aux value"""
    bag = {}
    for aux, (name, good, secs) in POTIONS.items():
        icons = icons_for(name) if good is not None else []
        if icons:
            bag[f"#pepe_potion_icon_{aux}"] = icons[0].replace("textures/", "", 1)
    is_potion = " or ".join(f"(#item_id = {i})" for i in (430, 571, 572))
    return {
        "type": "image", "allow_debug_missing_texture": False, "property_bag": bag,
        "$binding_collection_type|default": "collection",
        "bindings": [
            {"binding_type": "collection_details"},
            {"binding_name": "#item_id_aux", "binding_type": "$binding_collection_type",
             "binding_collection_name": "$item_collection_name"},
            _view("(#item_id_aux / 65536)", "#item_id"),
            _view("(#item_id_aux - (#item_id * 65536))", "#child_item_id", "always_when_visible"),
            _view("('textures/' + ('#pepe_potion_icon_' + #child_item_id))", "#texture", "always_when_visible"),
            _view(f"(({is_potion}) and (#child_item_id > 4))", "#visible")]}


def _insert(value):
    return {"modifications": [{"array_name": "controls", "operation": "insert_front", "value": value}]}


def _icon(layer, **extra):
    # customisation: set these in the Assets Pack's _global_variables.json
    d = {"$hide_food_stats_corner_icons|default": False, "$food_stats_corner_icon_size|default": [9, 9],
         "$food_stats_corner_icon_offset|default": [-1, 1],
         "size": "$food_stats_corner_icon_size", "anchor_from": "top_right", "anchor_to": "top_right",
         "offset": "$food_stats_corner_icon_offset", "layer": layer,
         "ignored": "$hide_food_stats_corner_icons"}
    if "ignored" in extra:      # keep the hook's own condition as well
        extra["ignored"] = f"({extra['ignored']} or $hide_food_stats_corner_icons)"
    d.update(extra)
    return [{"pepe_stew_icon@hud.pepe_stew_icon": dict(d)},
            {"pepe_potion_icon@hud.pepe_potion_icon": dict(d)}]


def hud_part(stew_id):
    """added to hud_screen.json (namespace hud): the template and the hotbar hook"""
    return {
        "pepe_stew_icon": template(stew_id),
        "pepe_potion_icon": potion_template(),
        "gui_hotbar_grid_item/hotbar_parent": _insert(
            _icon(4, **{"$item_collection_name": "$hotbar_collection_name"})),
    }


def ui_common_part():
    """container slots (chests, inventory grids)"""
    return {"container_item/item_cell/item": _insert(_icon(8))}


def inventory_part():
    """inventory screen: the crafting output; the plain inventory slots are covered by the ui_common hook"""
    return {
        "output_grid_3x3": {"$disable_pepe_stew_icon": False},
        "output_grid_2x2": {"$disable_pepe_stew_icon": False},
        "inventory_container_item/item_cell/item": {
            "$disable_pepe_stew_icon|default": True,
            **_insert(_icon(8, ignored="$disable_pepe_stew_icon"))},
    }


def trade_part():
    """villager trades"""
    return {
        "sell_item": {"$use_pepe_stew_icon": True},
        "single_item_grid/item_with_count/item_renderer": {
            "$use_pepe_stew_icon|default": False,
            **_insert(_icon(5, ignored="(not $use_pepe_stew_icon)",
                            **{"$item_collection_name": "sell_item", "$binding_collection_type": ""}))},
    }
