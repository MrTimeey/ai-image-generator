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

### API-Keys

Unter `/api-keys.html` erzeugbar, gespeichert als SHA-256-Hash in
`api-keys.json` neben `data.json`. Der Klartext wird nur einmal angezeigt.
Ein Schlüssel kommt an alles außer `/api/keys` — neue Schlüssel entstehen
ausschließlich in der angemeldeten Oberfläche.

Mitgeben als `Authorization: Bearer <key>` oder `X-API-Key: <key>`.

### Skill

`skill/ai-image/` enthält einen Claude-Code-Skill samt CLI (`scripts/aig.py`,
nur Standardbibliothek). Einbinden:

```bash
ln -s "$PWD/skill/ai-image" ~/.claude/skills/ai-image
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
docker compose up -d --force-recreate --build
```

Nach jedem `compose down`/`up` auf dem Server den Proxy neu laden, sonst zeigt
er auf die alte Container-IP:

```shell
docker exec nginx-proxy-manager nginx -s reload
```
