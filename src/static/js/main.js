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
    if (response.status === 401) {
        // Kann passieren, wenn die Seite aus dem Cache kam und die Sitzung
        // inzwischen abgelaufen ist. Dann gehoert der Nutzer zur Anmeldung,
        // nicht vor eine Fehlermeldung.
        window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
        throw new Error('Anmeldung nötig');
    }
    if (!response.ok) throw new Error(`Modellliste nicht ladbar (Fehler ${response.status})`);
    return await response.json();
}

/**
 * Ein Aufruf für alle Anbieter. Früher entschied das Frontend anhand des
 * Modellnamens, an welchen der beiden Endpunkte es schickt — und welches
 * Größen-Vokabular es mitgab.
 *
 * Der Auftrag bekommt eine selbst vergebene Kennung. Reißt die Verbindung ab,
 * lässt sich das Ergebnis darüber nachholen: in der installierten PWA friert
 * das System die Ausführung ein, sobald sie in den Hintergrund geht, und
 * bricht den laufenden Aufruf ab — der Server erzeugt und speichert aber
 * weiter.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateImage(request) {
    const msg = document.querySelector('#msg');
    msg.textContent = '';

    const requestId = neueAuftragsKennung();
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, requestId }),
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
        return bilderAus(data, msg);
    } catch (error) {
        // Netzwerkfehler heißt hier fast nie „ist schiefgegangen", sondern
        // „wir haben die Antwort verpasst".
        console.debug('Aufruf abgerissen, hole das Ergebnis nach', error);
        return await ergebnisNachholen(requestId, msg);
    }
}

function neueAuftragsKennung() {
    if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    // Ältere Browser und unsichere Kontexte (http) haben randomUUID nicht.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Wie `setTimeout`, bricht aber ab, sobald die Seite wieder sichtbar wird.
 * Im Hintergrund drosseln Browser die Zeitgeber stark; ohne das hier wartete
 * man nach der Rückkehr noch minutenlang auf eine Antwort, die längst bereit
 * liegt.
 */
function warte(ms) {
    return new Promise((resolve) => {
        const fertig = () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', beiSichtbar);
            resolve();
        };
        const beiSichtbar = () => {
            if (document.visibilityState === 'visible') fertig();
        };
        const timer = setTimeout(fertig, ms);
        document.addEventListener('visibilitychange', beiSichtbar);
    });
}

function bilderAus(data, msg) {
    if (Array.isArray(data.errors) && data.errors.length > 0) {
        showToast(`${data.errors.length} von ${data.errors.length + data.images.length} Bildern fehlgeschlagen`);
    }
    if (msg) msg.textContent = '';
    return data.images.map((i) => i.fileName);
}

/**
 * Nach einem abgerissenen Aufruf so lange nachfragen, bis der Auftrag fertig
 * ist. Großzügig bemessen: FLUX.2 [max] in hoher Auflösung braucht schon mal
 * über eine Minute, und das Nachfragen kostet nichts.
 */
async function ergebnisNachholen(requestId, msg) {
    const frist = Date.now() + 4 * 60 * 1000;
    let wartezeit = 1000;

    if (msg) msg.textContent = 'Verbindung unterbrochen — das Bild wird trotzdem fertig, einen Moment…';

    while (Date.now() < frist) {
        await warte(wartezeit);
        wartezeit = Math.min(5000, Math.round(wartezeit * 1.4));
        try {
            const response = await fetch(`/api/jobs/${requestId}`);
            if (response.status === 404) {
                // Auftrag unbekannt: der Server hat ihn nie gesehen (der erste
                // Aufruf kam gar nicht an) oder wurde neu gestartet.
                break;
            }
            if (!response.ok) continue;
            const data = await response.json();
            if (data.status === 'running') continue;
            if (data.status === 'error') {
                const text = data.message || data.error || 'Die Bildgenerierung ist fehlgeschlagen.';
                if (msg) msg.textContent = text;
                showToast(text);
                return [];
            }
            if (data.status === 'done') return bilderAus(data, msg);
        } catch {
            // Weiter versuchen — meist ist gerade das Netz weg.
        }
    }

    const text = 'Die Verbindung ist abgerissen. Sieh in der Übersicht nach, ob das Bild fertig wurde.';
    if (msg) msg.textContent = text;
    showToast(text);
    return [];
}
