/**
 * Videokarten für den Video-Screen und die Übersicht `/videos.html`. Eine
 * Quelle, damit beide dieselben Marken, Aktionen und Texte zeigen.
 */

// eslint-disable-next-line no-unused-vars
const VIDEO_MODUS_LABEL = { t2v: 'Text → Video', i2v: 'Bilder → Video', v2v: 'Fortsetzung', draft_enhance: 'Fertig gerendert' };

// eslint-disable-next-line no-unused-vars
function videoDollar(betrag) {
    return `${betrag.toFixed(2).replace('.', ',')} $`;
}

// eslint-disable-next-line no-unused-vars
function videoDauerText(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Fehlt ein Vorschaubild (ältere Bilder haben keins), das Original zeigen. */
// eslint-disable-next-line no-unused-vars
function videoMitRueckfall(img, fileName) {
    img.addEventListener('error', () => {
        const original = `/api/files/download/${encodeURIComponent(fileName)}`;
        if (fileName && !img.src.endsWith(original)) img.src = original;
    }, { once: true });
    return img;
}

/** Alle Videos, neueste zuerst. Leere Liste, wenn der Abruf scheitert. */
// eslint-disable-next-line no-unused-vars
async function ladeVideoListe() {
    const response = await fetch('/api/videos');
    if (response.status === 401) {
        window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
        return [];
    }
    if (!response.ok) return [];
    return (await response.json()).videos;
}

const videoKnopf = (text, klasse) =>
    Object.assign(document.createElement('button'), { type: 'button', textContent: text, className: `px-3 py-1.5 rounded-lg ${klasse}` });

/** Die kleinen Marken: Modus, Entwurf/Auflösung, Länge, Kosten. */
// eslint-disable-next-line no-unused-vars
function videoMarken(v, klein = false) {
    const marken = document.createElement('div');
    marken.className = `flex flex-wrap gap-1 ${klein ? 'text-[11px]' : 'text-xs'}`;
    const marke = (text, klasse) =>
        marken.appendChild(Object.assign(document.createElement('span'), { textContent: text, className: `px-1.5 py-0.5 rounded ${klasse}` }));
    if (!klein) marke(VIDEO_MODUS_LABEL[v.mode], 'bg-gray-100 text-gray-700');
    marke(v.draft ? (klein ? 'Entwurf' : 'Entwurf · hd') : v.resolution, v.draft ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800');
    if (v.seconds) marke(`${String(v.seconds).replace('.', ',')} s`, 'bg-gray-100 text-gray-700');
    if (!klein && v.aspectRatio !== 'auto') marke(v.aspectRatio, 'bg-gray-100 text-gray-700');
    if (!klein && v.cost !== undefined) marke(`${v.costEstimated ? '≈ ' : ''}${v.cost} Credits`, 'bg-gray-100 text-gray-700');
    if (!klein && !v.generateAudio) marke('ohne Ton', 'bg-gray-100 text-gray-700');
    return marken;
}

/**
 * Die volle Karte mit Player, Prompt, Keyframes und Aktionen.
 * `optionen` kommt aus `/api/videos/options` (Preise, Auflösungen, Modi);
 * `neuLaden` wird nach jeder Änderung aufgerufen, `fortsetzen(v)` nur, wo es
 * den Modus gibt.
 */
// eslint-disable-next-line no-unused-vars
function videoKarte(v, { optionen, neuLaden, fortsetzen } = {}) {
    const el = document.createElement('article');
    el.className = 'bg-white rounded-lg border border-gray-200 overflow-hidden';
    const medien = document.createElement('div');
    medien.className = 'bg-black aspect-video flex items-center justify-center';
    if (v.status === 'done' && v.url) {
        // `#t=0.1` lässt den Browser das erste Bild zeigen statt einer grauen Fläche.
        const player = Object.assign(document.createElement('video'), {
            src: `${v.url}#t=0.1`, poster: v.poster ?? '', controls: true, preload: 'metadata', className: 'w-full h-full',
        });
        player.playsInline = true;
        medien.appendChild(player);
    } else if (v.status === 'running') {
        medien.innerHTML = '<div class="flex flex-col items-center gap-3 text-white text-sm"><div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div><span data-laeuft></span></div>';
        medien.querySelector('[data-laeuft]').dataset.seit = v.startedAt;
        medien.querySelector('[data-laeuft]').textContent = `entsteht seit ${videoDauerText(Date.now() - v.startedAt)}`;
    } else {
        medien.innerHTML = '<p class="px-6 text-center text-sm text-red-300"></p>';
        medien.querySelector('p').textContent = v.error || 'Fehlgeschlagen.';
    }

    const info = document.createElement('div');
    info.className = 'p-3 space-y-2';
    info.appendChild(videoMarken(v));
    info.appendChild(Object.assign(document.createElement('p'), { textContent: v.prompt, className: 'text-sm text-gray-700 line-clamp-3', title: v.prompt }));

    if (v.keyframes?.length) {
        const reihe = document.createElement('div');
        reihe.className = 'flex flex-wrap gap-1';
        for (const k of v.keyframes) {
            const fig = document.createElement('figure');
            fig.className = 'relative';
            fig.appendChild(videoMitRueckfall(
                Object.assign(document.createElement('img'), { src: k.url, alt: '', className: 'w-10 h-10 object-cover rounded' }),
                k.source === 'library' ? k.image : null
            ));
            if (k.time !== undefined) {
                fig.appendChild(Object.assign(document.createElement('figcaption'), {
                    textContent: `${k.time}s`, className: 'absolute bottom-0 inset-x-0 text-center text-[10px] leading-4 bg-black/60 text-white font-mono',
                }));
            }
            reihe.appendChild(fig);
        }
        info.appendChild(reihe);
    }

    const aktionen = document.createElement('div');
    aktionen.className = 'flex flex-wrap items-center gap-2 pt-1 text-sm';
    if (v.canEnhance && optionen) {
        const res = document.createElement('select');
        res.className = 'p-1 text-sm border border-gray-300 rounded';
        const satz = optionen.prices[v.mode === 'draft_enhance' ? 't2v' : v.mode];
        for (const r of optionen.resolutions) {
            res.appendChild(Object.assign(document.createElement('option'), { value: r, textContent: `${r} · ≈ ${videoDollar(satz[r] * (v.seconds ?? 10))}` }));
        }
        res.value = 'fhd';
        const fertig = videoKnopf('Fertig rendern', 'bg-blue-600 text-white hover:bg-blue-700');
        fertig.addEventListener('click', async () => {
            fertig.disabled = true;
            const response = await fetch(`/api/videos/${v.id}/enhance`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution: res.value }),
            });
            const daten = await response.json().catch(() => ({}));
            if (!response.ok) showToast(daten.message || `Fehler ${response.status}`);
            else showToast('Wird fertig gerendert — dieselbe Aufnahme in voller Qualität');
            await neuLaden?.();
        });
        aktionen.append(res, fertig);
    }
    // Fortsetzen nur, wenn der Server den Modus anbietet (derzeit aus).
    if (v.status === 'done' && fortsetzen && optionen?.modes?.includes('v2v')) {
        const weiter = videoKnopf('Fortsetzen', 'border border-gray-300 hover:bg-gray-50');
        weiter.addEventListener('click', () => fortsetzen(v));
        aktionen.appendChild(weiter);
    }
    if (v.status === 'done') {
        aktionen.appendChild(Object.assign(document.createElement('a'), {
            href: `${v.url}?download=1`, textContent: 'Herunterladen', className: 'px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50',
        }));
    }
    if (v.status !== 'running') {
        const loeschen = videoKnopf('Löschen', 'border border-red-300 text-red-700 hover:bg-red-50');
        loeschen.addEventListener('click', async () => {
            if (!window.confirm('Dieses Video wirklich löschen? Das lässt sich nicht rückgängig machen.')) return;
            const response = await fetch(`/api/videos/${v.id}`, { method: 'DELETE' });
            if (!response.ok) showToast('Löschen ging nicht.');
            await neuLaden?.();
        });
        aktionen.appendChild(loeschen);
    }
    info.appendChild(aktionen);
    el.append(medien, info);
    return el;
}

/** Laufende Karten weiterzählen lassen, ohne sie neu zu bauen. */
// eslint-disable-next-line no-unused-vars
function videoLaufzeitenNachfuehren(behaelter) {
    behaelter.querySelectorAll('[data-laeuft]').forEach((el) => {
        el.textContent = `entsteht seit ${videoDauerText(Date.now() - Number(el.dataset.seit))}`;
    });
}
