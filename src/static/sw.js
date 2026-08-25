/**
 * Bewusst schmal: gecacht werden **nur** die statischen Bausteine der
 * Oberflaeche. Alles unter /api und /auth geht immer ans Netz — eine
 * gecachte Antwort waere dort im besten Fall veraltet und im schlechtesten
 * eine fremde Sitzung.
 */
const CACHE = 'aig-shell-v10';

/**
 * Nur Bausteine, nie HTML. Eine Seite, die ohne Sitzung abgerufen wird,
 * antwortet mit einer Weiterleitung zur Anmeldung — die als App-Shell im
 * Cache zu haben, waere schlimmer als gar kein Cache. HTML kommt deshalb
 * ausschliesslich ueber die Laufzeit-Strategie hinein, und nur wenn der
 * Server sie wirklich ausgeliefert hat.
 */
const SHELL = [
    '/js/main.js',
    '/public/js/toast.js',
    '/public/js/nav.js',
    '/public/css/generated-tailwind.css',
    '/public/css/style.css',
    '/public/favicon_io/favicon.ico',
    '/public/favicon_io/android-chrome-192x192.png',
    '/public/favicon_io/android-chrome-512x512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        // Einzeln, damit eine fehlende Datei nicht die ganze Installation kippt.
        caches.open(CACHE).then((cache) =>
            Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    // Anmeldung, API und die Bilder selbst nie aus dem Cache bedienen.
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;
    if (url.pathname.startsWith('/thumbnails/') || url.pathname.startsWith('/big-thumbnails/')) return;

    /**
     * Netz zuerst, Cache als Rueckfalltuer. Andersherum saehe man nach jedem
     * Deployment die alte Oberflaeche — der haeufigste und aergerlichste
     * Fehler bei Service Workern.
     */
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/index.html')))
    );
});
