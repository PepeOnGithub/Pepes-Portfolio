export const fileMappings = {
    "acacia_log": "log_acacia",
    "birch_log": "log_birch",
    "dark_oak_log": "log_big_oak",
    "jungle_log": "log_jungle",
    "oak_log": "log_oak",
    "spruce_log": "log_spruce",
    "warped_stem": "log_warped",
    "crimson_stem": "log_crimson",
    "acacia_planks": "planks_acacia",
    "birch_planks": "planks_birch",
    "dark_oak_planks": "planks_big_oak",
    "jungle_planks": "planks_jungle",
    "oak_planks": "planks_oak",
    "spruce_planks": "planks_spruce",
    "wooden_axe": "wood_axe",
    "wooden_pickaxe": "wood_pickaxe",
    "wooden_shovel": "wood_shovel",
    "wooden_sword": "wood_sword",
    "wooden_hoe": "wood_hoe",
    "golden_axe": "gold_axe",
    "golden_pickaxe": "gold_pickaxe",
    "golden_shovel": "gold_shovel",
    "golden_sword": "gold_sword",
    "golden_hoe": "gold_hoe",
    "gold_block": "block_gold",
    "dirt_path": "grass_path",
    "mushroom_block": "huge_mushroom_block",
    "stone_slab_top": "double_stone_slab_top",
    "grass_side": "grass_side_carried",
    "fishing_rod_uncast": "fishing_rod",
    "fishing_rod_cast": "fishing_rod_cast",
    "nether_star": "star",
    "saddle": "horse_saddle",
    "fire_charge": "fireball",
    "leather_helmet": "leather_cap",
    "leather_chestplate": "leather_tunic",
    "leather_leggings": "leather_pants",
    "leather_boots": "leather_boots",
    "zombie_pigman": "zombified_piglin",
    "wolf": "dog",
    "snowman": "snow_golem",
    "wither_skeleton": "wither_skeleton",
    "elder_guardian": "guardian_elder",
    "horse/armor": "horse/armor/horse_armor"
};

function convertPack() {
    const fileInput = document.getElementById('javaPack');
    const file = fileInput.files[0];

    if (!file) {
        document.getElementById('output').innerText = 'Please select a Java texture pack (.zip)';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const zip = new JSZip();
        zip.loadAsync(e.target.result).then(function(zip) {
            const convertedZip = new JSZip();
            let packName = file.name.replace('.zip', '');
            let packDescription = '';

            const assetPath = findAssetsFolder(zip.files);
            if (!assetPath) {
                document.getElementById('output').innerText = 'Assets folder not found in the pack.';
                return;
            }

            Object.keys(zip.files).forEach(function(fileName) {
                if (!fileName.startsWith(assetPath)) return;
                let newFileName = fileName.replace(assetPath, '');

                if (newFileName.startsWith('textures/block/')) {
                    newFileName = newFileName.replace('textures/block/', 'textures/blocks/');
                } else if (newFileName.startsWith('textures/item/')) {
                    newFileName = newFileName.replace('textures/item/', 'textures/items/');
                } else if (newFileName.startsWith('textures/entity/')) {
                    newFileName = newFileName.replace('textures/entity/', 'textures/entity/');
                } else if (newFileName.startsWith('textures/painting/')) {
                    newFileName = newFileName.replace('textures/painting/', 'textures/painting/');
                } else if (newFileName.startsWith('textures/particle/')) {
                    newFileName = newFileName.replace('textures/particle/', 'textures/particle/');
                } else if (newFileName.startsWith('textures/mob_effect/')) {
                    newFileName = newFileName.replace('textures/mob_effect/', 'textures/ui/mob_effect/');
                } else if (newFileName.startsWith('textures/map_icon/')) {
                    newFileName = newFileName.replace('textures/map_icon/', 'textures/map/map_icons/');
                }

                if (fileMappings.hasOwnProperty(newFileName.split('/').pop().split('.')[0])) {
                    const fileBaseName = newFileName.split('/').pop().split('.')[0];
                    newFileName = newFileName.replace(fileBaseName, fileMappings[fileBaseName]);
                }

                if (newFileName === 'pack.png') {
                    newFileName = 'pack_icon.png';
                }

                if (newFileName === 'pack.mcmeta') {
                    zip.files[fileName].async('text').then(function(content) {
                        const mcmeta = JSON.parse(content);
                        packDescription = mcmeta.pack.description || 'Converted Java Texture Pack';
                        packName = mcmeta.pack.pack_format || packName;

                        const manifest = createManifest(packName, packDescription);
                        convertedZip.file('manifest.json', manifest);
                    });
                    return;
                }

                zip.files[fileName].async('blob').then(function(content) {
                    convertedZip.file(newFileName, content);
                });
            });

            convertedZip.generateAsync({type: 'blob'}).then(function(content) {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = `${file.name.replace('.zip', '')}.mcpack`;
                link.click();
            });

            document.getElementById('output').innerText = 'Conversion successful!';
        });
    };
    reader.readAsArrayBuffer(file);
}

function findAssetsFolder(files) {
    const possiblePaths = Object.keys(files).filter(path => path.endsWith('assets/minecraft/'));
    if (possiblePaths.length === 0) return null;
    return possiblePaths[0].split('assets/minecraft/')[0] + 'assets/minecraft/';
}

function createManifest(name, description) {
    const manifestTemplate = {
        format_version: 2,
        header: {
            description: description,
            name: name,
            uuid: generateUUID(),
            version: [1, 0, 0]
        },
        modules: [
            {
                description: description,
                type: 'resources',
                uuid: generateUUID(),
                version: [1, 0, 0]
            }
        ]
    };
    return JSON.stringify(manifestTemplate, null, 2);
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}