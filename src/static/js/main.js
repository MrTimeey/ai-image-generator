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
async function loadModels() {
    const response = await fetch('/api/models', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Modellliste nicht ladbar');
    return await response.json();
}

/**
 * Ein Aufruf fuer alle Anbieter. Frueher entschied das Frontend anhand des
 * Modellnamens, an welchen der beiden Endpunkte es schickt — und welches
 * Groessen-Vokabular es mitgab.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateImage(request) {
    const msg = document.querySelector('#msg');
    msg.textContent = '';
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            // Die Meldung des Anbieters durchreichen statt sie durch einen
            // Einheitssatz zu ersetzen.
            const text = data.message || data.error || `Fehler ${response.status}`;
            msg.textContent = text;
            showToast(text);
            return [];
        }
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            showToast(`${data.errors.length} von ${data.errors.length + data.images.length} Bildern fehlgeschlagen`);
        }
        return data.images.map(i => i.fileName);
    } catch (error) {
        msg.textContent = String(error);
        showToast(String(error));
        return [];
    }
}
