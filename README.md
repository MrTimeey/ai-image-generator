# ai-image-generator

Eigene Oberfläche und API für Bildgenerierung über
[Black Forest Labs FLUX](https://docs.bfl.ai/) und
[OpenAI GPT Image](https://developers.openai.com/api/docs/guides/image-generation).

<img src='./doc/title-image.png' width='500'>
Mit KI erstellt ∙ 18. September 2024 um 3:59 PM

## Modelle

Die Liste lebt in `src/controller/modelRegistry.ts` und ist über
`GET /api/models` abrufbar — Oberfläche und Skripte fragen sie dort ab, statt
eine eigene zu führen.

| Modell | Anbieter | Wofür |
|---|---|---|
| `flux-2-pro` | BFL | Standardwahl |
| `flux-2-flex` | BFL | mehr Kontrolle, langsamer |
| `flux-2-max` | BFL | stärkstes FLUX-Modell |
| `flux-2-klein-9b` | BFL | günstig, für Entwürfe |
| `flux-pro-1.1` | BFL | Vorgängergeneration |
| `flux-pro-1.1-ultra` | BFL | bis 4 Megapixel |
| `flux-kontext-pro` / `-max` | BFL | Bildbearbeitung mit einem Referenzbild |
| `gpt-image-2` | OpenAI | Text im Bild, präzise Vorgaben, freie Größe |
| `gpt-image-1.5` / `gpt-image-1-mini` | OpenAI | günstiger, drei feste Größen |

DALL·E ist am 12. Mai 2026 abgeschaltet worden; `dall-e-2` und `dall-e-3`
antworten mit 400 und sind entsprechend entfernt.

### Referenzbilder

`POST /api/generate` nimmt `inputImages: string[]` — base64, roh oder als
`data:image/png;base64,…`. Wie viele ein Modell auswertet, steht als
`maxInputImages` in `GET /api/models`:

| Modell | Referenzbilder | Weg |
|---|---|---|
| FLUX.2 (alle) | 4 | `input_image`, `input_image_2`, … |
| `flux-kontext-pro` / `-max` | 1 | `input_image` |
| OpenAI (alle) | 4 | `POST /v1/images/edits` statt `/generations` |
| `flux-pro-1.1`, `-ultra` | 0 | — |

`flux-pro-1.1` nimmt `input_image` zwar entgegen, ignoriert es aber und liefert
ein völlig neues Bild — deshalb steht dort 0.

PNG, JPEG und WebP bis 8 MB je Bild; der Typ wird an den Magic Bytes geprüft,
nicht am mitgelieferten `data:`-Präfix.

### Seitenverhältnis

Eine Auswahl für alle Anbieter (`21:9` … `9:21`), die `src/common/aspectRatio.ts`
pro Modell übersetzt:

- **`aspect_ratio`** — nur `flux-kontext-*` und `flux-pro-1.1-ultra`. Die
  Kantenlängen bestimmt dort der Anbieter.
- **`width`/`height`** — FLUX.2 (Vielfache von 16) und `flux-pro-1.1` (32). Die
  FLUX.2-Endpunkte nehmen `aspect_ratio` zwar an, **ignorieren es aber** und
  liefern 1024×1024.
- **`size`** — OpenAI. `gpt-image-2` nimmt freie Größen (Kanten als Vielfache
  von 16, max. 3840 px), die übrigen nur 1024×1024, 1536×1024, 1024×1536.

## API

Alles unter `/api` verlangt eine Anmeldung und antwortet bei fehlender mit
**401 JSON**, nie mit einer Weiterleitung. `GET /api/health` ist frei.

| Endpunkt | Zweck |
|---|---|
| `POST /api/generate` | Bild erzeugen |
| `GET /api/models` | Registry mit Verhältnissen, Stufen, Formaten |
| `GET /api/thumbnails/all?sorting=DESC` | vorhandene Bilder |
| `GET /api/files/get/:name` | Metadaten |
| `GET /api/files/download/:name` | Datei |
| `DELETE /api/files/:name` | löschen |
| `GET /api/credits` | Guthaben der Anbieter (`?refresh=1` umgeht den 60-s-Cache) |
| `GET /api/jobs/:id` | Stand eines Auftrags (siehe unten) |
| `GET /api/files/reference/:name` | mitgegebenes Referenzbild |
| `GET /api/skill/download` | Claude-Skill als ZIP |
| `GET/POST/DELETE /api/keys` | API-Keys (**nur mit Sitzung**) |
| `GET /api/health` | öffentlich |

`POST /api/openai/generate-images` und `POST /api/bfl/generate-images` bleiben
als Weiterleitung auf `/api/generate` bestehen, damit ältere Skripte
weiterlaufen.

```bash
curl -s https://ai.mrtimeey.com/api/generate \
  -H "Authorization: Bearer $AIG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"ein Leuchtturm, Aquarell","model":"flux-2-pro",
       "ratio":"16:9","quality":"medium","amount":1,"outputFormat":"png"}'
```

Mit Referenzbild:

```bash
curl -s https://ai.mrtimeey.com/api/generate \
  -H "Authorization: Bearer $AIG_TOKEN" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg img "data:image/png;base64,$(base64 -w0 vorlage.png)" \
        '{prompt:"mach den Hintergrund tiefblau", model:"flux-2-pro",
          ratio:"1:1", inputImages:[$img]}')"
```

Antwort:

```jsonc
{ "createdAt": "2026-08-24_22-51", "model": "flux-2-pro", "provider": "bfl",
  "width": 1888, "height": 1056,
  "images": [{ "id": "…", "fileName": "…png", "width": 1888, "height": 1056,
               "url": "/api/files/download/…png", "revisedPrompt": "…", "seed": 42 }],
  "errors": [] }
```

### Abgerissene Verbindungen

`POST /api/generate` nimmt optional eine selbst vergebene `requestId`
(8–64 Zeichen, `[A-Za-z0-9_-]`). Der Server führt den Auftrag unter dieser
Kennung, und `GET /api/jobs/:id` liefert `running`, `done` (mit demselben
Rumpf wie `/generate`) oder `error`.

Das ist kein Luxus: legt man die **installierte PWA in den Hintergrund**,
friert das System die JS-Ausführung ein und bricht den laufenden `fetch` ab.
Der Server erzeugt und speichert unbeirrt weiter — die Oberfläche meldete
vorher „Failed to fetch", obwohl das Bild fertig war. Jetzt fragt sie mit der
Kennung nach, sobald die Seite wieder sichtbar wird.

Aufträge liegen im Speicher (30 Minuten, höchstens 200). Ein Neustart des
Containers verliert sie; die Bilder stehen dann in der Übersicht.

### Referenzbilder in der Detailansicht

Mitgegebene Vorlagen werden auf 512 px verkleinert unter
`<baseFolder>/references/` abgelegt und in `data.json` als `referenceImages`
vermerkt. `/detail.html` zeigt sie neben dem Prompt — ohne die Vorlage ist
„mach den Hintergrund tiefblau" nicht zu deuten. `cleanDataStore` räumt
Vorlagen weg, auf die kein Eintrag mehr zeigt.

Der Export (`/api/exchange/all`) enthält sie **nicht**; nach einem Import
fehlen sie und die Detailansicht blendet den Block aus.

Aus der Detailansicht führt **„Als Referenz nutzen"** zurück in den Generator
(`/index.html?reference=<dateiname>`) und setzt das Bild dort als Vorlage.
Es wird beim Übernehmen auf 1536 px verkleinert — Anbieter rechnen die
Eingabefläche mit ab (BFL über `input_mp`), und ein Original in voller Größe
bringt als Vorlage nichts Sichtbares.

Solange eine Vorlage gesetzt ist, stehen nur Modelle zur Wahl, die sie auch
auswerten (`maxInputImages > 0`) — sonst könnte man `flux-pro-1.1` wählen, das
die Vorlage entgegennimmt und trotzdem ein völlig neues Bild erzeugt. Wird die
letzte Vorlage entfernt, sind wieder alle wählbar.

### Kontoseite

`/account.html` zeigt das BFL-Guthaben und verlinkt die Stellen, die man sonst
sucht: [BFL-Dashboard](https://dashboard.bfl.ai/),
[OpenAI-Abrechnung](https://platform.openai.com/settings/organization/billing/overview),
OpenAI-Verbrauch, Authentik-Konto. Dort steht auch der Abmelden-Knopf; in der
Navigationsleiste führt das Kürzel des Benutzers hin.

**OpenAI gibt den Kontostand über keine API heraus** —
`/v1/dashboard/billing/*` antwortet API-Keys mit 403. Mit einem Admin-Key
(`OPEN_AI_ADMIN_KEY`, Scope `api.usage.read`) zeigt die Seite immerhin die
Ausgaben des laufenden Monats über `/v1/organization/costs`.

### API-Keys

Unter `/api-keys.html` erzeugbar, gespeichert als SHA-256-Hash in
`api-keys.json` neben `data.json`. Der Klartext wird nur einmal angezeigt —
zusammen mit fertigen Befehlen zum Setzen der Variablen und zum Ablegen der
Token-Datei, den Schlüssel schon eingesetzt.

Jeder Schlüssel bekommt eine **Gültigkeit** (30/90 Tage, 1/2 Jahre oder
unbegrenzt). Ein abgelaufener Schlüssel wird abgewiesen wie ein unbekannter,
bleibt aber in der Liste stehen — sonst wäre nicht zu sehen, warum ein Skript
plötzlich 401 bekommt.

Ein Schlüssel kommt an alles außer `/api/keys` — neue Schlüssel entstehen
ausschließlich in der angemeldeten Oberfläche.

Mitgeben als `Authorization: Bearer <key>` oder `X-API-Key: <key>`:

```bash
export AIG_TOKEN='aig_…'
curl -s https://ai.mrtimeey.com/api/models -H "Authorization: Bearer $AIG_TOKEN"
```

### Claude-Skill

Das Repo ist zugleich ein **Plugin-Marketplace**: `.claude-plugin/marketplace.json`
im Wurzelverzeichnis, das Plugin unter `plugin/` mit dem Skill in
`plugin/skills/ai-image/` (SKILL.md plus `scripts/aig.py`, nur
Python-Standardbibliothek).

```
/plugin marketplace add MrTimeey/ai-image-generator
/plugin install ai-image@mrtimeey
```

Die laufende App bietet ihn zusätzlich unter `/skill.html` an — mit Erklärung
und als ZIP über `GET /api/skill/download`. Beim Packen wird die
Standardadresse im Skill auf `PUBLIC_BASE_URL` umgeschrieben, damit ein
Download von einer anderen Instanz nicht auf `ai.mrtimeey.com` zeigt.

Beim Entwickeln direkt einhängen:

```bash
ln -s "$PWD/plugin/skills/ai-image" ~/.claude/skills/ai-image
```

Manifeste prüfen:

```bash
claude plugin validate .claude-plugin/marketplace.json --strict
claude plugin validate plugin --strict
```

## Anmeldung über Authentik

Authorization-Code-Flow mit PKCE (`openid-client`), Sitzung als signiertes
Cookie. Routen: `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`.

Im Authentik-Provider einzustellen:

- confidential, `sub_mode: user_username`, Scopes `openid profile email`
- Redirect-URIs **typisiert**: `authorization` → `<PUBLIC_BASE_URL>/auth/callback`,
  `logout` → `<PUBLIC_BASE_URL>/`
- **`grant_types = ["authorization_code"]` explizit setzen.** Per API oder
  `ak shell` angelegte Provider bekommen `grant_types = []` und weisen dann
  jede Anmeldung mit `invalid_request` ab.

Ohne `AUTH_ENABLED=true` läuft die App ganz ohne Anmeldung — so ist der
Dev-Betrieb gedacht.

## Betrieb

`.env` aus `.env.example` erzeugen.

```shell
npm install
npm run dev      # nodemon
npm run serve    # ts-node
npm run lint     # eslint über die TS-Dateien + Inline-Skripte der Seiten
```

Für den Betrieb im Container zieht `docker compose up -d` das Image aus der
GitHub Registry. Lokal bauen geht mit `docker build -t ai-image-generator .`.

### Deployment

Ein Push auf `main` startet `.github/workflows/deploy.yml`: `tsc --noEmit` und
`npm run lint`, dann Build und Push nach
`ghcr.io/mrtimeey/ai-image-generator:latest`, dann ein Aufruf von
`https://webhook.mrtimeey.com/hooks/ai-image-generator` mit dem Token aus dem
Repository-Secret `WEBHOOK_SECRET`.

Der Server **baut nicht selbst** — er hat knapp 5 GB frei. `dockers_update.sh`
zieht per `git` nur `docker-compose.yml` und sich selbst nach (das Remote ist
deshalb HTTPS, damit der Container ohne SSH-Key auskommt) und holt das fertige
Image aus der Registry: `git reset --hard` auf den verfolgten Branch, `compose
build`, `down`/`up`, **Nginx-Reload** und eine Health-Prüfung — einmal am
Container und einmal durch den Proxy.

Der Nginx-Reload ist nicht optional: NPM löst Upstream-Namen beim Laden seiner
Konfiguration auf und behält die IP. Nach `down`/`up` zeigt er sonst ins Leere
und liefert 502, während von innen alles in Ordnung aussieht.

Von Hand:

```shell
~/coding/ai-image-generator/dockers_update.sh
```
