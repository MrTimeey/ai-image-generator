/**
 * Die Navigation lag auf jeder Seite doppelt im HTML — einmal fuer den
 * Desktop, einmal fuer das Burger-Menue. Die beiden sind auseinandergelaufen
 * (mobil stand ein „Abmelden" auch dann, wenn es keine Anmeldung gab). Deshalb
 * hier eine Quelle fuer beide.
 */
(function () {
    const ENTRIES = [
        { href: '/index.html', label: 'Generator' },
        { href: '/overview.html?sorting=DESC', label: 'Übersicht', match: '/overview.html' },
        { href: '/exchange.html', label: 'Austausch' },
        { href: '/api-keys.html', label: 'API-Keys' },
    ];

    const current = window.location.pathname;

    const link = (entry, mobile) => {
        const a = document.createElement('a');
        a.href = entry.href;
        a.textContent = entry.label;
        a.title = entry.title ?? '';
        const active = (entry.match ?? entry.href) === current;
        if (entry.badge) {
            // Das Kuerzel als runde Marke — auf dem Desktop reicht es als
            // Einstieg ins Konto, im Burger-Menue steht Klartext daneben.
            a.textContent = mobile ? `${entry.label} (${entry.badge})` : entry.badge;
            a.className = mobile
                ? 'block py-2 text-white hover:text-gray-300'
                : 'h-8 w-8 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-sm font-semibold tracking-wide';
            if (active && !mobile) a.classList.add('ring-2', 'ring-white');
            if (active && mobile) a.classList.add('font-semibold', 'underline');
            return a;
        }
        a.className = mobile
            ? 'block py-2 text-white hover:text-gray-300'
            : 'hover:text-gray-300';
        if (active) a.classList.add('font-semibold', 'underline');
        return a;
    };

    const render = (user) => {
        const entries = [...ENTRIES];
        // Statt eines „Abmelden"-Links das Kuerzel: dahinter liegt die
        // Kontoseite mit Guthaben, den Dashboard-Links und dem Abmelden-Knopf.
        if (user) {
            entries.push({
                href: '/account.html',
                label: 'Konto',
                match: '/account.html',
                badge: user.username.slice(0, 2).toUpperCase(),
                title: `Angemeldet als ${user.username}`,
            });
        }
        for (const [id, mobile] of [['nav-desktop', false], ['nav-mobile', true]]) {
            const container = document.getElementById(id);
            if (!container) continue;
            container.replaceChildren(...entries.map((e) => link(e, mobile)));
        }
    };

    const burger = document.getElementById('burger-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (burger && mobileMenu) {
        burger.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
    }

    render(null);
    fetch('/auth/me')
        .then((response) => (response.ok ? response.json() : null))
        .then((me) => {
            if (me && me.authEnabled && me.authenticated) render(me);
        })
        .catch((error) => console.debug('Anmeldestatus nicht ermittelbar', error));
})();
