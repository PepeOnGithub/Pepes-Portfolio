document.getElementById('convertBtn').addEventListener('click', () => {
    const javaPackInput = document.getElementById('javaPack');
    if (!javaPackInput.files.length) {
        alert('Please select a Java pack ZIP file.');
        return;
    }

    const javaPackFile = javaPackInput.files[0];
    const reader = new FileReader();
    reader.readAsArrayBuffer(javaPackFile);
    reader.onload = (event) => {
        const arrayBuffer = event.target.result;
        JSZip.loadAsync(arrayBuffer).then((zip) => {
            convertPack(zip);
        });
    };
});

function convertPack(zip) {
    const bedrockPackZip = new JSZip();
    const totalFiles = Object.keys(zip.files).length;
    let convertedFilesCount = 0;

    zip.forEach((relativePath, zipEntry) => {
        if (zipEntry.name.endsWith('.png')) {
            zipEntry.async('blob').then((content) => {
                const newPath = relativePath.replace('assets/minecraft/textures/', '');
                bedrockPackZip.file(newPath, content);
                updateProgress(++convertedFilesCount / totalFiles * 100);
            });
        }
    });

    bedrockPackZip.generateAsync({ type: 'blob' }).then((blob) => {
        const url = URL.createObjectURL(blob);
        const downloadLink = document.getElementById('downloadLink');
        downloadLink.href = url;
        downloadLink.style.display = 'inline-block';
        addConvertedFile(downloadLink.download);
    });
}

function updateProgress(progress) {
    const progressBar = document.querySelector('.progress');
    progressBar.style.width = progress + '%';
}

function addConvertedFile(fileName) {
    const listItem = document.createElement('li');
    listItem.textContent = fileName;
    document.getElementById('convertedFilesList').appendChild(listItem);
}

document.getElementById('javaPack').addEventListener('change', (event) => {
    const fileName = event.target.files[0].name;
    const label = event.target.previousElementSibling;
    label.textContent = `Selected file: ${fileName}`;
});
