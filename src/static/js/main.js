// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getDetailInformation(imageName) {
    try {
        const response = await fetch(`/api/files/get/${imageName}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            document.querySelector('#msg').textContent = 'That image could not be generated';
            return {errorMsg: 'Image not found!'}
        }
        return await response.json();
    } catch (error) {
        document.querySelector('#msg').textContent = error;
        return {errorMsg: 'Image not found!'}
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getAllThumbnails(sorting) {
    try {
        const response = await fetch(`/api/thumbnails/all?sorting=${sorting}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error('That image could not be generated');
            return []
        }
        return await response.json();
    } catch (error) {
        console.error('That image could not be generated', error);
        return [];
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function deleteImage(imageName) {
    try {
        await fetch(`/api/files/${imageName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Failed deletion')
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getExportZip() {
    try {
        const response = await fetch(`/api/exchange/all`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        return await response.blob()
    } catch (error) {
        console.error('Failed download all')
        return undefined
    }
}


// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateImage() {
    const prompt = document.querySelector('#description').value;
    const size = document.querySelector('#size').value;
    const quality = document.querySelector('#quality').value;
    const model = document.querySelector('#model').value;
    const amount = document.querySelector('#amount').value;

    if (prompt === '') {
        document.querySelector('#msg').textContent = 'Please add some text';
        return [];
    }

    return generateImageRequest(prompt, model, size, amount, quality);
}

async function generateImageRequest(prompt, model, size, amount, quality) {
    try {
        const response = await fetch('/api/openai/generate-images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                description: prompt,
                languageModel: model,
                amount: parseInt(amount),
                size: size.toUpperCase(),
                quality: quality.toUpperCase(),
            }),
        });

        if (!response.ok) {
            document.querySelector('#msg').textContent = 'That image could not be generated';
            return []
        }
        const data = await response.json();
        return data.images.map(i => i.fileName);
    } catch (error) {
        document.querySelector('#msg').textContent = error;
        return [];
    }
}



