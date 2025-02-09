document.getElementById('fileInput').addEventListener('change', function(event) {
    const fileLabel = document.querySelector('.custom-file-label');
    if (this.files.length > 0) {
        fileLabel.textContent = this.files[0].name; // Show uploaded file name
    } else {
        fileLabel.textContent = "Choose a Texture Pack (.zip)";
    }
});

document.getElementById('upload-form').addEventListener('submit', async function(event) {
    event.preventDefault();

    const fileInput = document.getElementById('fileInput');
    if (fileInput.files.length === 0) {
        alert('Please select a file.');
        return;
    }

    const file = fileInput.files[0];
    const jszip = new JSZip();
    const zip = await jszip.loadAsync(file);
    const bedrockZip = new JSZip();

    // Convert Java texture pack to Bedrock format
    await convertTexturePack(zip, bedrockZip);

    // Generate and add manifest.json
    const manifest = generateManifest();
    bedrockZip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // Create the .mcpack file
    const content = await bedrockZip.generateAsync({ type: 'blob' });
    const downloadLink = document.getElementById('download-link');
    const link = downloadLink.querySelector('a');
    link.href = URL.createObjectURL(content);
    link.download = 'ConvertedTexturePack.mcpack';
    downloadLink.style.display = 'block';
});

async function convertTexturePack(inputZip, outputZip) {
    const texturePathJava = 'assets/minecraft/textures/';
    const texturePathBedrock = 'textures/';

    inputZip.forEach(async (relativePath, file) => {
        if (!file.dir) {
            const content = await file.async('uint8array');
            let newPath = relativePath;

            // Convert paths from Java Edition to Bedrock Edition
            if (relativePath.startsWith(texturePathJava)) {
                newPath = relativePath.replace(texturePathJava, texturePathBedrock);
            }

            // Apply texture name mappings
            newPath = renameTextures(newPath);

            outputZip.file(newPath, content);
        }
    });
}

// **🔹 Texture Name Mapping Between Java and Bedrock**
function renameTextures(path) {
    const renameMap = {
        // ✅ Mobs
        'entity/creeper/creeper.png': 'textures/entity/creeper.png',
        'entity/zombie/zombie.png': 'textures/entity/zombie.png',
        'entity/skeleton/skeleton.png': 'textures/entity/skeleton.png',
        'entity/spider/spider.png': 'textures/entity/spider.png',
        'entity/enderman/enderman.png': 'textures/entity/enderman/enderman.png',
        'entity/villager/villager.png': 'textures/entity/villager/villager.png',
        'entity/iron_golem/iron_golem.png': 'textures/entity/iron_golem.png',

        // ✅ Blocks
        'block/stone.png': 'textures/blocks/stone.png',
        'block/dirt.png': 'textures/blocks/dirt.png',
        'block/grass_block_top.png': 'textures/blocks/grass_top.png',
        'block/grass_block_side.png': 'textures/blocks/grass_side.png',
        'block/oak_planks.png': 'textures/blocks/planks_oak.png',
        'block/cobblestone.png': 'textures/blocks/cobblestone.png',
        'block/diamond_ore.png': 'textures/blocks/diamond_ore.png',
        'block/diamond_block.png': 'textures/blocks/diamond_block.png',
        'block/obsidian.png': 'textures/blocks/obsidian.png',

        // ✅ Items
        'item/diamond_sword.png': 'textures/items/diamond_sword.png',
        'item/diamond_pickaxe.png': 'textures/items/diamond_pickaxe.png',
        'item/iron_sword.png': 'textures/items/iron_sword.png',
        'item/apple.png': 'textures/items/apple.png',
        'item/golden_apple.png': 'textures/items/golden_apple.png',
        'item/ender_pearl.png': 'textures/items/ender_pearl.png',
        'item/bow.png': 'textures/items/bow_standby.png',

        // ✅ UI Elements
        'gui/widgets.png': 'textures/ui/widgets.png',
        'gui/title/minecraft.png': 'textures/ui/title.png',
    };

    for (const [javaPath, bedrockPath] of Object.entries(renameMap)) {
        if (path.endsWith(javaPath)) {
            return bedrockPath;
        }
    }

    return path;
}

// **🔹 Generate a Bedrock manifest.json file**
function generateManifest() {
    return {
        format_version: 2,
        header: {
            description: 'Converted Java Texture Pack',
            name: 'Converted Texture Pack',
            uuid: generateUUID(),
            version: [1, 0, 0]
        },
        modules: [
            {
                description: 'Converted Java Texture Pack',
                type: 'resources',
                uuid: generateUUID(),
                version: [1, 0, 0]
            }
        ]
    };
}

// **🔹 Generate UUIDs for manifest.json**
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}