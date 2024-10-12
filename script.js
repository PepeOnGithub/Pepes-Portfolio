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

            Object.keys(zip.files).forEach(function(fileName) {
                let newFileName = fileName;

                if (fileName.startsWith('assets/minecraft/textures/block/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/block/', 'textures/blocks/');
                } else if (fileName.startsWith('assets/minecraft/textures/item/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/item/', 'textures/items/');
                } else if (fileName.startsWith('assets/minecraft/textures/entity/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/entity/', 'textures/entity/');
                } else if (fileName.startsWith('assets/minecraft/textures/painting/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/painting/', 'textures/painting/');
                } else if (fileName.startsWith('assets/minecraft/textures/particle/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/particle/', 'textures/particle/');
                } else if (fileName.startsWith('assets/minecraft/textures/mob_effect/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/mob_effect/', 'textures/ui/mob_effect/');
                } else if (fileName.startsWith('assets/minecraft/textures/map_icon/')) {
                    newFileName = fileName.replace('assets/minecraft/textures/map_icon/', 'textures/map/map_icons/');
                }

                if (fileName === 'pack.png') {
                    newFileName = 'pack_icon.png';
                }

                if (fileName === 'pack.mcmeta') {
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