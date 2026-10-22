# Node 24: sharp und die aktuellen SDKs setzen mindestens 22 voraus, und der
# dynamische Import von openid-client (ESM) laeuft hier zuverlaessig.
#
# Drei Stufen statt einer: Frueher lief alles in einem Abbild mit `npm ci`
# samt devDependencies, gestartet ueber `npm run serve` -> ts-node, das den
# Quellcode bei jedem Start uebersetzte. Jetzt uebersetzt tsc einmal beim
# Bauen, und im Betrieb liegen nur die Produktionsabhaengigkeiten und das
# fertige JavaScript — ohne TypeScript, ts-node, eslint, vitest und npm.

# ---------------------------------------------------------------------------
# Stufe 1: Uebersetzen.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS bau
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./

# tsconfig.json steht auf `noEmit` (Typpruefung in der CI, ts-node lokal);
# hier wird ausdruecklich ausgegeben. **Nach /app/build, mit src als Wurzel**:
# Die Laufzeitstufe legt das JavaScript wieder nach /app/src, neben
# src/static. Der Code findet static/ und plugin/ ueber __dirname — liefe er
# aus /app/dist, zeigten diese Pfade und die Bind-Mounts der Compose-Datei
# (/app/src/static/thumbnails …) ins Leere.
#
# Die Tests fehlen im Kontext (.dockerignore) und werden nicht mit uebersetzt;
# sie laufen in der CI.
RUN npx tsc --noEmit false --rootDir src --outDir build

# ---------------------------------------------------------------------------
# Stufe 2: Abhaengigkeiten fuer den BETRIEB, ohne devDependencies.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS abhaengigkeiten
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Stufe 3: Laufzeit.
# ---------------------------------------------------------------------------
FROM node:24-alpine

# ffmpeg zieht aus jedem Video ein Standbild — ohne das zeigen Raster und
# iPhone nur schwarze Flaechen, bis man auf Play drueckt.
RUN apk add --no-cache ffmpeg

# npm, npx und corepack braucht im Betrieb niemand: gestartet wird `node`
# direkt, und dockers_update.sh prueft mit `node -e`. Mitgeliefert braechten
# sie nur ihren eigenen Abhaengigkeitsbaum samt dessen Sicherheitsluecken.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app
COPY --from=abhaengigkeiten /app/node_modules ./node_modules
COPY package.json ./
# Der Skill wird als ZIP ausgeliefert (src/routes/skill.ts liest plugin/).
COPY plugin ./plugin
COPY src/static ./src/static
COPY --from=bau /app/build ./src

EXPOSE 3000
# --enable-source-maps: Stacktraces im Log nennen die Zeilen der .ts-Dateien,
# wie frueher unter ts-node.
CMD ["node", "--enable-source-maps", "src/main.js"]
