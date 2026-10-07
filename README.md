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
| `flux-3-image` | BFL | Bounding Boxes: Elemente platzieren, Box für Box bearbeiten, bis 10 Referenzen, bis 4K |
| `flux-2-pro` | BFL | Standardwahl |
| `flux-2-flex` | BFL | mehr Kontrolle, langsamer |
| `flux-2-max` | BFL | stärkstes FLUX-Modell |
| `flux-2-klein-9b` | BFL | günstig, für Entwürfe |
| `flux-pro-1.1` | BFL | Vorgängergeneration |
| `flux-pro-1.1-ultra` | BFL | bis 4 Megapixel |
| `flux-kontext-pro` / `-max` | BFL | Bildbearbeitung mit einem Referenzbild |
| `gpt-image-2.5-flare` | OpenAI | Text im Bild, präzise Vorgaben, schnell, freie Größe |
| `gpt-image-2.5-sunburst` | OpenAI | höchste Bildqualität, stabil über Bearbeitungen, langsam |
| `gpt-image-2` | OpenAI | Vorgänger von 2.5, langsamer und je Stufe teurer |
| `gpt-image-1.5` / `gpt-image-1-mini` | OpenAI | günstiger, drei feste Größen |

### Prompt-Umschreiben

Jedes Modell trägt `promptRewrite` (auch in `GET /api/models`):

| Wert | Bedeutung | Modelle |
|---|---|---|
| `never` | Prompt kommt wörtlich an | OpenAI, `flux-2-klein-9b`, `flux-pro-1.1-ultra` |
| `optional` | nur mit `revisePrompt: true` (`prompt_upsampling`), **Standard aus** | übrige FLUX.2/FLUX.1 |
| `always` | nicht abschaltbar | `flux-3-image` |

Der Standard ist bewusst „wörtlich": Agenten schicken ausgearbeitete Prompts
und wollen sie nicht umgeschrieben sehen. Klein stand früher auf „kann
umschreiben", obwohl BFL dort kein Upsampling anbietet. FLUX 3 formuliert
jeden Prompt aus (Status `Reasoning`); verbindlich sind dort nur die Boxen.
Wer `revisePrompt` an ein Modell schickt, das es nicht anbietet, bekommt einen
Eintrag in `warnings`. GPT Image 2.5 liefert kein `revised_prompt` (am
07.10.2026 geprüft).

### FLUX 3 und Bounding Boxes

`POST /v1/flux-3-image` hat ein strenges Schema (`additionalProperties:
false`): `prompt`, `images` (1–10), `aspect_ratio`, `resolution`,
`safety_tolerance`, `grounding`. **Kein** `seed`, `width`/`height`,
`output_format` oder `prompt_upsampling` — jedes davon gibt 422. Das Bild kommt
als PNG und wird bei Bedarf in das gewählte Format umgerechnet.

Boxen sind kein eigener Parameter: Der Prompt ist der Szenen-Prompt, ein
Leerzeichen, dann das JSON-Array der Elemente. Die App nimmt beides getrennt
an (`prompt` + `layout`), prüft es (`src/common/layout.ts`) und setzt es erst
beim Absenden zusammen. In `data.json` steht deshalb die lesbare Szene als
`description` und das Layout als eigenes Feld.

| Feld | Erzeugen | Bearbeiten |
|---|---|---|
| `id` | `[a-z][a-z0-9_]*`, im Prompt als `<id>` | ebenso |
| `bbox` | `[top, left, bottom, right]`, 0–1000 | — |
| `from` | — | `"ref_image_0"` oder `null` (neu/ersetzen) |
| `src_bbox` | — | Box im Ausgangsbild oder `null` |
| `tgt_bbox` | — | Box im Ergebnis oder `null` (entfernen) |
| `desc` | wie das Element aussieht | wie es danach aussieht |

`sourceImage` (Dateiname) nimmt ein vorhandenes Bild als `ref_image_0` — in
voller Größe vom Server, bis 16 MP, und mit `aspect_ratio: auto`, damit der
Rahmen bleibt. `grounding` (Websuche vor dem Generieren) ist bei BFL
standardmäßig an, hier aus.

Die Qualitätsstufen werden zu Flächenstufen: `low`/`medium`/`high`/`max` =
`1k`/`1.5k`/`2k`/`4k`. Gemessen am 07.10.2026 (`3:4`):

| Stufe | Größe | Kosten | Dauer |
|---|---|---|---|
| `1k` | 880×1184 | 2,4 Credits | ≈ 21 s |
| `1.5k` | 1328×1760 | 3,5 Credits | ≈ 21 s |

BFLs Preisliste nennt für `1k` 0,048 $ — gemeldet wurde die Hälfte.
Bearbeitungen dauerten 41 s bzw. 147 s, Letzteres mit Lastabwurf: BFL meldet
dann `503 "… over capacity and temporarily shedding requests"`. Nur dieses
503 wird beim Absenden wiederholt (3/8/15 s Pause), jedes andere nicht, weil
der Auftrag schon abgerechnet sein könnte. Beim Pollen liefert BFL einen
gescheiterten Auftrag ebenfalls als 503 mit normalem Body; dort zählt der
`status` im Body.

FLUX 3 hält die Boxen exakt ein, formuliert die Beschreibungen aber aus und
benennt Textelemente intern um (`title_1` → `En_Text_1`). Bearbeitungen
lassen alles an seinem Platz, sind aber **nicht pixelgleich**: außerhalb der
geänderten Box wichen Farbton und Korn leicht ab.

Die Oberfläche dafür ist `/compose.html`: Boxen ziehen, beschreiben,
Szenen-Prompt mit `<id>`-Chips; `?edit=<datei>` bearbeitet ein Bild (sein
Layout wird zu behalten-Zeilen), `?from=<datei>` übernimmt ein Layout.

### Video (FLUX 3)

`/video.html` und `POST /api/videos` erzeugen Clips über `POST
/v1/flux-3-video`. Videos haben einen **eigenen Bestand**: Ordner
`<baseFolder>/videos/` mit `videos.json`, MP4s, Entwurfs-Bündeln
(`<id>.draft.bin`) und hochgeladenen Keyframes (`keyframes/`). Übersicht,
Export und `cleanDataStore` kennen nur Bilder und lassen den Unterordner in
Ruhe; die Kosten zählen trotzdem in `GET /api/credits` mit (Modell
`flux-3-video`).

| Feld | Bedeutung |
|---|---|
| `mode` | `t2v` (Text), `i2v` (Bilder als Keyframes); `v2v` (fortsetzen) ist gebaut, aber über `ENABLED_MODES` abgeschaltet → 400 `mode_disabled` |
| `prompt` | Pflicht |
| `keyframes` | `i2v`: 1–10 × `{image, time?}` — `image` ist ein Dateiname im Bestand oder base64; `time` die Sekunde. Alle oder keins mit Zeit, aufsteigend; ohne Zeit ab drei Bildern feste `duration` |
| `startVideo` | `v2v`: Id eines fertigen Videos |
| `duration` | 5–20 (v2v bis 15) oder `auto` |
| `aspectRatio` | `auto`, `21:9`, `2:1`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `9:21` |
| `draft` | Standard `true`: hd-Vorschau mit Bündel. `false` rendert direkt in `resolution` |
| `resolution` | `hd`, `fhd` (Standard), `qhd`, `uhd` — nur ohne Entwurf |
| `generateAudio` | Standard `true` |

Die Antwort ist **202** mit dem Eintrag (`status: running`); fertig wird es im
Hintergrund, abgeholt über `GET /api/videos/:id`. Der Eintrag wird mit der
Polling-URL gespeichert, bevor gepollt wird — ein Neustart (jedes Deployment)
verliert einen bezahlten Lauf deshalb nicht, `resumeVideos` holt ihn beim Start
nach. `POST /api/videos/:id/enhance {resolution}` rendert einen Entwurf über
`draft_enhance` fertig: dieselbe Aufnahme, das Bündel enthält Seed und Eingaben.
`GET /api/videos/:id/file` liefert das MP4 mit Range-Unterstützung
(`?download=1` als Anhang), `GET /api/videos/:id/poster` ein Standbild,
`DELETE /api/videos/:id` löscht Eintrag und Dateien.

Das Standbild zieht **ffmpeg** (seit dem Video-Ausbau im Image, `apk add
ffmpeg`) bei 0,1 s aus dem Video, für ältere Videos beim ersten Abruf. Ohne
Standbild zeigten Raster und iPhone nur schwarze Flächen. `/videos.html` ist
die Übersicht (Raster, Vorschau beim Darüberfahren, Klick öffnet Player und
Aktionen); `/video.html` zeigt unten nur Laufendes und das neueste Ergebnis.

Gemessen am 07.10.2026:

- `cost` kommt **nicht** beim Absenden (dort `null`), sondern beim Abholen auf
  oberster Ebene: 5 s Entwurf = 30 Credits, 6 s = 36, 6 s fertig in hd = 102 —
  genau die Preisliste.
- Das Ergebnis enthält `sample` (MP4, H.264 + AAC, faststart), `prompt`
  (unverändert zurück), `seed` und beim Entwurf `draft_cache` — eine URL, die
  verfällt; das Bündel (0,6–4,8 MB) wird deshalb sofort gespeichert. Eine
  Laufzeit meldet BFL nicht; sie wird aus dem `mvhd`-Atom der MP4 gelesen.
- Dauer: Entwurf 56–97 s, Fertigrendern 92 s.
- `keyframes` als `[[0, …], [4.5, …]]` setzt die Bilder exakt: Anfang und
  Ende stimmten im Test.
- Ein Fortsetzungs-Entwurf (5 s, Listenpreis 60 Credits) wurde bei 610 Credits
  Restguthaben mit „Insufficient credits" abgelehnt — ungeklärt, vermutlich
  hält BFL dort vorab mehr zurück. Deshalb ist `v2v` in `ENABLED_MODES`
  (`videoService.ts`) vorerst aus; zum Einschalten dort ergänzen und einmal
  echt testen.

DALL·E ist am 12. Mai 2026 abgeschaltet worden; `dall-e-2` und `dall-e-3`
antworten mit 400 und sind entsprechend entfernt.

### Auflösung und Wallpaper

Die Qualitätsstufe bestimmt die Auflösung. `max` reizt aus, was das Modell
hergibt — angeboten wird sie nur, wo das spürbar mehr ist als `high`:

| Modell | `high` (16:9) | `max` (16:9) | Grenze |
|---|---|---|---|
| `gpt-image-2`, GPT Image 2.5 | 2672×1504 | **3840×2160** | 8.294.400 Pixel, Kante ≤ 3840 |
| FLUX.2 (alle) | 2672×1504 | — | 4.194.304 Pixel |
| `flux-3-image` | `2k` ≈ 4 MP | `4k` ≈ 16 MP | Kanten vom Anbieter, laut BFL ≈ 0,61 $ bei `4k` |
| `flux-pro-1.1-ultra` | — | — | 4 MP, Kanten vom Anbieter |

**Für Wallpaper in 4K:** die OpenAI-Modelle mit freier Größe (exakt 3840×2160) oder `flux-3-image` mit `max`
(Kanten bestimmt BFL). FLUX.2 endet
bei 4 Megapixeln; dort wäre eine `max`-Stufe nur fünf Prozent über `high` und
damit ein Versprechen, das sie nicht hält.

Bei FLUX.2 zählt die **Fläche**, nicht die einzelne Kante: 3040×1360 wird
angenommen, 3072×1728 nicht (am 25.08.2026 nachgemessen). Deshalb hat `edge`
neben `max` auch `maxPixels`.

Ein 4K-Bild kostet rund **0,40 $** gegenüber gut einem Cent bei `low` — die
Oberfläche weist beim Umschalten darauf hin.

**GPT Image 2.5** (Flare und Sunburst) kennt in der API selbst die Stufen
`xhigh` und `max` — dort ändern sie nur den Rechenaufwand, nicht die
Auflösung (am 07.10.2026 gemessen). Die App legt das auf ihre eine Leiter:
`xhigh` ist so groß wie `high`, rechnet aber länger; `max` ist 4K **und**
höchster Aufwand. Bei `gpt-image-2` geht `max` als API-Stufe `high` hinaus,
weil die API dort kein `max` kennt.

| Flare, 1024×1024 | `low` | `high` | `xhigh` | `max` |
|---|---|---|---|---|
| Bild-Tokens | 196 | 1.756 | 3.122 | 7.024 |
| Dauer | 10 s | 22 s | 34 s | 66 s |

Zum Vergleich: `gpt-image-2` mit `high` kostet 7.024 Tokens und brauchte
135 s. Sunburst kostet je Stufe dasselbe wie Flare, ist aber zwei- bis
dreimal so langsam. In 4K (3840×2160) mit `max` sind es 13.342 Tokens, rund
0,40 $.

Ein Upscale gibt es nicht: BFL bietet dafür keinen Endpunkt an (nur für
Video), und alle Varianten antworten mit 404. Wer größer will, erzeugt gleich
größer — das liefert ohnehin bessere Ergebnisse als nachträgliches
Vergrößern.

### Referenzbilder

`POST /api/generate` nimmt `inputImages: string[]` — base64, roh oder als
`data:image/png;base64,…`. Wie viele ein Modell auswertet, steht als
`maxInputImages` in `GET /api/models`:

| Modell | Referenzbilder | Weg |
|---|---|---|
| `flux-3-image` | 10 | `images: [...]`, im Prompt `<ref_image_0>` … |
| FLUX.2 (alle) | 4 | `input_image`, `input_image_2`, … |
| `flux-kontext-pro` / `-max` | 1 | `input_image` |
| GPT Image 2.5 | 16 | `POST /v1/images/edits` statt `/generations` |
| übrige OpenAI-Modelle | 4 | `POST /v1/images/edits` statt `/generations` |
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
- **`aspect_ratio` + `resolution`** — `flux-3-image`. Bei `sourceImage` geht
  `auto` hinaus, eingetragen wird das tatsächlich gelieferte Verhältnis.
- **`width`/`height`** — FLUX.2 (Vielfache von 16) und `flux-pro-1.1` (32). Die
  FLUX.2-Endpunkte nehmen `aspect_ratio` zwar an, **ignorieren es aber** und
  liefern 1024×1024.
- **`size`** — OpenAI. `gpt-image-2` und GPT Image 2.5 nehmen freie Größen (Kanten als Vielfache
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
| `POST /api/files/delete` | mehrere auf einmal löschen (ein Aufruf statt vieler) |
| `PUT /api/files/:name/favorite` | markieren / Markierung aufheben |
| `POST /api/exchange/selection` | eine Auswahl als ZIP |
| `GET /api/credits` | Guthaben der Anbieter (`?refresh=1` umgeht den 60-s-Cache) |
| `GET /api/jobs/:id` | Stand eines Auftrags (siehe unten) |
| `GET /api/files/reference/:name` | mitgegebenes Referenzbild |
| `GET /api/skill/download` | Claude-Skill als ZIP |
| `GET/POST/DELETE /api/keys` | API-Keys (**nur mit Sitzung**) |
| `GET/POST /api/videos` | Videos auflisten / erzeugen (202, im Hintergrund) |
| `GET/DELETE /api/videos/:id` | Stand bzw. löschen; `…/file` liefert das MP4, `…/poster` das Standbild |
| `POST /api/videos/:id/enhance` | Entwurf fertig rendern |
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

Mit Bounding Boxes (nur `flux-3-image`); `prompt` ist der Szenen-Prompt:

```bash
curl -s https://ai.mrtimeey.com/api/generate \
  -H "Authorization: Bearer $AIG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"A poster: the headline <title_1> above a runner <runner_1>.",
       "model":"flux-3-image","ratio":"3:4","quality":"low","grounding":false,
       "layout":[{"id":"title_1","bbox":[50,89,202,907],"desc":"Bold black text reading \"RUN FAST\"."},
                 {"id":"runner_1","bbox":[317,278,944,717],"desc":"A black runner silhouette."}]}'
```

Antwort:

```jsonc
{ "createdAt": "2026-08-24_22-51", "model": "flux-2-pro", "provider": "bfl",
  "width": 1888, "height": 1056,
  "images": [{ "id": "…", "fileName": "…png", "width": 1888, "height": 1056,
               "url": "/api/files/download/…png", "revisedPrompt": "…", "seed": 42 }],
  "errors": [], "warnings": [] }
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

**Auf dem Handy** startet langes Drücken auf eine Kachel den Auswahlmodus —
Umschalt-Klick gibt es dort nicht. Der `click`, den der Browser nach dem
`touchend` nachschiebt, wird unterdrückt: sonst hätte er die eben gewählte
Kachel sofort wieder abgewählt.

Der Favoritenstern erscheint mit Mauszeiger nur beim Überfahren der Kachel;
gesetzt bleibt er immer stehen. Auf Touch-Geräten gibt es kein Hover — dort
steht er dauerhaft, sonst führte kein Weg zu ihm. Geregelt über
`@media (hover: hover)`, nicht über die Bildschirmbreite: ein iPad im
Querformat ist breit und hat trotzdem keinen Mauszeiger.

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

Der Seed steht in den Metadaten und die Detailansicht zeigt ihn — als
Aufzeichnung, nicht als Bedienelement. Die Oberfläche nimmt **keinen** Seed
entgegen; wer einen Lauf gezielt wiederholen will, nimmt
`aig.py gen "…" --model … --ratio … --seed <wert>` oder `POST /api/generate`.

Der Grund: gleicher Seed und gleicher Prompt ergeben nur **praktisch** dasselbe
Bild — bei einer Gegenprobe lagen zwei Läufe bei 0,2 % mittlerer
Pixelabweichung, also sichtbar identisch, aber nicht bitgenau. Ein Feld, das
Reproduzierbarkeit verspricht, die es nicht gibt, trägt sich nicht. OpenAI
kennt ohnehin keinen Seed.

Das Formular lässt sich weiter über `/index.html?prompt=…&model=…&ratio=…`
vorbelegen — gedacht für von Hand gebaute Links.

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
npm run dev        # nodemon
npm run serve      # ts-node
npm run lint       # eslint über die TS-Dateien + Inline-Skripte der Seiten
npm test           # vitest, einmalig
npm run test:watch # vitest, mitlaufend
```

### Tests

**vitest**, `src/**/*.test.ts`, in der CI-Stufe `check` neben `tsc` und
`lint`. Geprüft wird bewusst nur die reine Logik ohne Dateizugriff und Netz —
dort ist der Nutzen am größten und der Aufwand am kleinsten:

| Datei | worum es geht |
|---|---|
| `aspectRatio.test.ts` | Kantenrasterung, Grenzen, feste Größen — war laut den Kommentaren schon einmal falsch |
| `fileUtils.test.ts` | `safeImageName` als Schutz vor Path Traversal, vollständig |
| `imageQuery.test.ts` | Reihenfolge, Suche, Filter, Blättern; der Store ist ersetzt |
| `jobStore.test.ts` | Lebenslauf eines Auftrags, TTL und Obergrenze |
| `modelRegistry.test.ts` | Registry in sich stimmig, Kostenrechnung gegen gemessene Werte |
| `legacy.test.ts` | Übersetzung alter Aufrufe — bricht sonst, ohne dass es auffällt |
| `apiKeyStore.test.ts` | Ablauf eines Schlüssels, inklusive der Grenze |

Gegengeprüft, dass sie etwas taugen: die Pfadprüfung entschärft und die
Kantenrasterung verbogen — beides fällt sofort auf.

Die Tests bringen ihre eigene Minimalkonfiguration mit (`test.env` in
`vitest.config.mjs`). `appConfig` prüft beim Laden, ob ein Anbieter-Schlüssel
gesetzt ist, und Module wie `fileUtils` ziehen es mit — lokal kam das
unbemerkt aus der `.env`, in der CI gibt es keine. Wer das prüfen will,
schiebt die `.env` kurz beiseite und lässt `npm test` laufen.

Für den Betrieb im Container zieht `docker compose up -d` das Image aus der
GitHub Registry. Lokal bauen geht mit `docker build -t ai-image-generator .`.

### Deployment

Ein Push auf `main` startet `.github/workflows/deploy.yml`: `tsc --noEmit` und
`npm run lint`, dann Build und Push nach
`ghcr.io/mrtimeey/ai-image-generator:latest`, dann ein Aufruf von
`https://webhook.mrtimeey.com/hooks/ai-image-generator` mit dem Token aus dem
Repository-Secret `WEBHOOK_SECRET`.

Der Server **baut nicht selbst** — auf dem Altserver hatte er knapp 5 GB frei.
(Seit dem Umzug am 04./05.09.2026 ist der Platz kein Argument mehr: 18 GB RAM
plus 8 GB Swap, 1-TB-SSD zu 17 % belegt.) `dockers_update.sh`
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
