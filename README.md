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
| `GET /api/images` | Bestand mit Metadaten, Suche, Filter, Cursor |
| `GET /api/thumbnails/all?sorting=DESC` | nur Dateinamen — **veraltet**, siehe unten |
| `GET /api/files/get/:name` | Metadaten |
| `GET /api/files/download/:name` | Datei |
| `DELETE /api/files/:name` | löschen |
| `POST /api/files/delete` | mehrere auf einmal löschen |
| `PUT /api/files/:name/favorite` | markieren / Markierung aufheben |
| `POST /api/exchange/selection` | eine Auswahl als ZIP |
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

### Bestand abfragen

`GET /api/images` liefert Metadaten statt nur Dateinamen und ist die Grundlage
für Suche und Filter:

| Parameter | Wirkung |
|---|---|
| `q` | Volltext über Prompt, revidierten Prompt und Modell |
| `model`, `provider`, `ratio` | exakter Filter |
| `favorite=true` | nur Markierte |
| `sorting` | `ASC` / `DESC` (Standard) |
| `limit` | 1–500, Standard 100 |
| `cursor` | `nextCursor` der vorigen Antwort |

```jsonc
{ "images": [{ "fileName", "createdAt", "prompt", "revisedPrompt",
               "model", "provider", "ratio", "width", "height",
               "favorite", "hasReferences" }],
  "nextCursor": "…oder null", "total": 838 }
```

`GET /api/thumbnails/all` liefert weiterhin die volle Liste der Dateinamen und
bleibt für ältere Skripte bestehen — neue Aufrufe gehören an `/api/images`.

### Übersicht

Suche über die Prompts, Filter nach Modell, Verhältnis und Favoriten,
Nachladen beim Scrollen statt aller Bilder auf einmal. Im Auswahlmodus wählt
ein Klick auf die Kachel aus, Umschalt-Klick eine ganze Spanne; die Auswahl
lässt sich als ZIP laden oder in einem Zug löschen.

Mehrere Bilder gehen über **einen** Aufruf (`POST /api/files/delete`) statt
über viele einzelne — sonst würde `data.json` je Bild neu geschrieben.

Gelöschte Kacheln verschwinden **erst nach der Antwort des Servers**. Vorher
wurde die Kachel unbedingt entfernt und ein Fehler verschluckt: schlug das
Löschen fehl, war das Bild optisch weg und nach dem Neuladen wieder da.

### Speicherschicht

`data.json` bleibt die Wahrheit, wird aber **einmal beim Start gelesen** und im
Speicher gehalten; ein `Map` über den Dateinamen ersetzt die Linearsuche.
Vorher parste jeder Zugriff 1,2 MB neu — auch die Detailansicht eines
einzelnen Bildes.

Geschrieben wird **atomar** (tmp + rename). Ohne das hinterließ ein
Container-Stop mitten im Schreiben — also jedes Deployment während einer
Generierung — eine halbe Datei und damit den gesamten Bestand an Prompts.
Eine unlesbare `data.json` wird beim Start als `data.json.kaputt-<zeit>`
beiseitegelegt statt überschrieben, und die Anwendung startet mit leerem
Bestand weiter, statt in einer Neustartschleife zu enden.

`cleanDataStore` gleicht Bestand und Ordner ab und läuft **nur beim Start**.
Beim Löschen eines einzelnen Bildes wird gezielt dessen Eintrag entfernt —
sonst hätte das Aufräumen ein zeitgleich frisch erzeugtes, noch nicht
eingetragenes Bild mitgelöscht.

### Was ein Bild gekostet hat

Beide Anbieter liefern die Kosten mit, sie wurden bisher nur weggeworfen:

- **BFL** schickt `cost` in Credits schon in der Antwort auf das Absenden —
  nicht erst beim Abholen, deshalb wird der Wert bis zum fertigen Bild
  durchgereicht. Die ältere Generation (`flux-pro-1.1`) liefert dort `null`.
- **OpenAI** rechnet über Tokens ab und schlüsselt sie genau auf
  (`usage.input_tokens_details`, `usage.output_tokens_details`). Der Betrag ist
  damit gerechnet, nicht geschätzt. Die Preistabelle steht in
  `src/controller/modelRegistry.ts` (`OPENAI_PRICES_USD_PER_MILLION`, Stand
  25.08.2026) — die erste Stelle zum Nachsehen, wenn die Beträge von der
  Abrechnung abweichen. Bei `n > 1` gilt der Betrag für den ganzen Aufruf und
  wird gleichmäßig aufgeteilt; feiner gibt OpenAI es nicht her.

`DataImage` führt jetzt `seed`, `quality`, `outputFormat`, `cost`, `costUnit`
und `durationMs`. `GET /api/credits` liefert neben dem Guthaben der Anbieter
einen eigenen `spending`-Block: Summen je Monat und je Modell.

**Credits und Dollar bleiben getrennt** — einen Umrechnungskurs zwischen
BFL-Credits und Dollar zu erfinden hieße, eine Zahl zu zeigen, der man nicht
trauen kann.

Alles, was vor dieser Änderung entstand, führt keine Kosten; die Anbieter
liefern sie nicht rückwirkend. Die Anzeige weist das als „unbekannt" aus.

### Seed

Der Seed wurde schon immer ausgelesen und angezeigt — nur nie gespeichert.
Jetzt steht er in den Metadaten, die Detailansicht zeigt ihn, und „nochmal mit
diesem Seed" führt zurück in den Generator (`/index.html?prompt=…&model=…&ratio=…&seed=…`).

Gleicher Seed und gleicher Prompt ergeben **praktisch** dasselbe Bild — bei
einer Gegenprobe lagen zwei Läufe bei 0,2 % mittlerer Pixelabweichung, also
sichtbar identisch, aber nicht bitgenau. OpenAI kennt keinen Seed; dort ist das
Feld ausgeblendet.

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
