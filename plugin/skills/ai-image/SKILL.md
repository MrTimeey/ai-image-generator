---
name: ai-image
description: Bilder mit dem eigenen AI Image Generator auf ai.mrtimeey.com erzeugen und verwalten - Modellwahl (FLUX 3, FLUX.2, FLUX.1 Kontext, OpenAI gpt-image), Komposition mit Bounding Boxes (Elemente gezielt platzieren, ein Bild Element für Element bearbeiten - ersetzen, verschieben, entfernen), Seitenverhältnis, Referenzbilder, Varianten, Download, Metadaten; Videos mit Ton (Text, Bilder als Keyframes mit Zeitpunkten, Fortsetzung; Entwurf und Fertigrendern); Prompts bleiben standardmäßig wörtlich. Auslösen bei - Bild generieren, Video erzeugen, Clip, Animation, Bild animieren, Keyframes, Bild erzeugen, Bild bearbeiten, Referenzbild, Vorlage, Illustration, Titelbild, Header-Bild, Poster, Cover, Layout, Komposition, Bounding Box, Element platzieren, Icon-Motiv, KI-Bild, FLUX, FLUX 3, gpt-image, ai.mrtimeey.com, aig.
---

# AI Image Generator

Bilder erzeugen über die eigene Instanz auf `https://ai.mrtimeey.com`. Die Bilder
liegen danach **auf dem Server**, in der Übersicht der Weboberfläche — lokal
landen sie nur, wenn `--out` mitgegeben wird.

Alles läuft über ein CLI. Wo es liegt, hängt vom Installationsweg ab — als
Plugin unter `${CLAUDE_PLUGIN_ROOT}/skills/ai-image/scripts/aig.py`, von Hand
entpackt unter `~/.claude/skills/ai-image/scripts/aig.py`. Dieser Aufruf
findet beides:

```bash
AIG=$(find ~/.claude -path '*ai-image*/scripts/aig.py' | head -1)
python3 "$AIG" <befehl>
```

In den Beispielen unten steht `aig.py` für genau diesen Pfad. Wer es oft
braucht, legt sich einen Alias an:

```bash
alias aig="python3 $(find ~/.claude -path '*ai-image*/scripts/aig.py' | head -1)"
```

### Alle Befehle

| Befehl | Zweck |
|---|---|
| `models` | verfügbare Modelle mit Verhältnissen, Stufen, Grenzen |
| `gen "<prompt>"` | Bild erzeugen |
| `list` | Bestand durchsuchen und filtern |
| `get <datei>` | Metadaten eines Bildes |
| `layout <datei> [--edit]` | Bounding Boxes eines Bildes als JSON — zum Wiederverwenden oder Bearbeiten |
| `download <datei>` | Bild herunterladen |
| **`rm <datei> [...]`** | **Bild(er) löschen — auch mehrere auf einmal** |
| `favorite <datei>` | markieren (`--off` hebt auf) |
| `costs` | Guthaben und bisherige Ausgaben |
| `video "<prompt>"` | Video erzeugen (Text, `--image` als Keyframes, `--continue`) — Standard: Entwurf |
| `enhance <id>` | Video-Entwurf fertig rendern — dieselbe Aufnahme |
| `videos` / `video-rm <id>` | Videos auflisten / löschen |

## Prompt bleibt wörtlich

**Standardmäßig kommt dein Prompt wörtlich beim Modell an.** Kein Modell
formuliert ihn um, solange du nicht `--revise` setzt — und das solltest du bei
ausgearbeiteten Prompts nicht tun: es hilft nur bei kurzen, vagen Ideen und
verwässert präzise Vorgaben.

`aig.py models` sagt je Modell, wie es damit umgeht:

| Angabe | Bedeutung |
|---|---|
| Prompt bleibt wörtlich | Gar kein Umschreiben (OpenAI, `flux-2-klein-9b`, `flux-pro-1.1-ultra`) |
| Prompt bleibt wörtlich (--revise formuliert aus) | Nur mit `--revise` (übrige FLUX.2/FLUX.1-Modelle) |
| **formuliert den Prompt IMMER aus** | **FLUX 3** — nicht abschaltbar |

**FLUX 3 ist die Ausnahme.** Es denkt vor jedem Bild nach und schreibt
Szene und Element-Beschreibungen aus; das Ergebnis steht danach als
`revisedPrompt` in den Metadaten. Verbindlich bleiben dort nur die **Boxen**:
Lage und Größe jedes Elements übernimmt FLUX 3 exakt (siehe
[Komposition mit FLUX 3](#komposition-mit-flux-3)). Wer also genaue
Vorstellungen von Anordnung und Bildaufbau hat, legt sie bei FLUX 3 als Layout
fest — und wer jedes Wort durchsetzen will, nimmt ein anderes Modell.

## Ersteinrichtung (einmalig)

1. `https://ai.mrtimeey.com/api-keys.html` öffnen, Namen und Gültigkeit wählen
   (30/90 Tage, 1/2 Jahre oder unbegrenzt), Schlüssel erzeugen.
2. Die Seite zeigt den Klartext **nur einmal** — dafür samt fertiger Befehle
   zum Kopieren, mit dem Schlüssel schon eingesetzt:
   ```bash
   mkdir -p ~/.config/ai-image-generator
   printf '%s' '<der Schlüssel>' > ~/.config/ai-image-generator/token
   chmod 600 ~/.config/ai-image-generator/token
   ```

Alternativ `AIG_TOKEN` setzen. `AIG_URL` überschreibt die Adresse (z. B.
`http://localhost:3000` im Dev-Betrieb).

**Ein abgelaufener Schlüssel meldet sich wie ein falscher**: Exit-Code 2 und
„Nicht angemeldet (401)". Die Liste auf `/api-keys.html` zeigt abgelaufene
Einträge rot markiert — dort zuerst nachsehen, bevor man anderswo sucht.

Der Schlüssel gilt **nicht** für `/api/keys` — neue Schlüssel entstehen nur in
der angemeldeten Oberfläche. Das ist Absicht: ein durchgesickerter Schlüssel
soll sich nicht selbst vermehren können.

## Modell wählen

**Die Liste nie aus dem Kopf zitieren** — `aig.py models` fragt die Instanz und
liefert für jedes Modell die möglichen Seitenverhältnisse, Qualitätsstufen und
Formate. Was hier steht, ist die Entscheidungshilfe dahinter:

| Situation | Modell |
|---|---|
| Normalfall, gutes Bild ohne Nachdenken | `flux-2-pro` |
| Viele Entwürfe, Varianten durchprobieren | `flux-2-klein-9b` (am günstigsten) |
| `[pro]` trifft das Motiv nicht | `flux-2-max` |
| Sehr detailreiche oder ungewöhnliche Szene | `flux-2-flex` (langsamer) |
| **Bildaufbau steht fest**: was wo im Bild sitzt, wie groß | `flux-3-image` mit `--layout` |
| Poster, Cover, Plakat mit **mehreren Textblöcken an festen Stellen** | `flux-3-image` mit `--layout`, eine Box je Textzeile |
| Vorhandenes Bild gezielt ändern: ein Element ersetzen, verschieben, entfernen — der Rest bleibt | `flux-3-image` mit `--source` und `--layout` |
| **Text im Bild**, Schrift, Beschriftung, Logo | `gpt-image-2.5-flare` |
| Präzise Vorgaben, die eingehalten werden müssen | `gpt-image-2.5-flare` |
| Fertiges Bild bei OpenAI, Person oder Produkt über mehrere Bearbeitungen gleich halten | `gpt-image-2.5-sunburst` (langsam) |
| Druck, großes Format, 4 Megapixel | `flux-pro-1.1-ultra` |
| Vorhandenes Bild verändern | `flux-kontext-pro` / `flux-kontext-max` |
| Mehrere Vorlagen kombinieren | `flux-2-pro` (bis 4), `flux-3-image` (bis 10), GPT Image 2.5 (bis 16) |
| Billig und schnell bei OpenAI | `gpt-image-1-mini` |

FLUX ist stärker bei Bildwirkung und Stil, GPT Image bei Instruktionstreue
und allem, was lesbar sein muss. Wenn Schrift im Bild vorkommt, ist die Wahl
nicht offen — dann `gpt-image-2.5-flare`. Flare ist schneller als
`gpt-image-2` und je Stufe deutlich günstiger; `gpt-image-2` braucht es nur
noch zum Vergleich. Einzige Alternative bei Schrift: `flux-3-image`, wenn
mehrere Textblöcke **an bestimmten Stellen** stehen müssen — dort bekommt jede
Zeile ihre eigene Box (am 07.10.2026 sauber gesetzt: „RUN FAST" exakt in der
Titelbox).

FLUX 3 ist die neueste FLUX-Generation, aber nicht der neue Standard: es
formuliert jeden Prompt aus und kennt keinen Seed. Ohne Layout ist
`flux-2-pro` meist die bessere Wahl.

## Seitenverhältnis

Ein einziges Feld für alle Anbieter; die App rechnet es pro Modell um.

| Zweck | Verhältnis |
|---|---|
| Titelbild, Blogpost-Header, Präsentation | `16:9` |
| Breites Banner, Hero | `21:9` |
| Foto-Anmutung quer | `3:2` |
| Social-Post, Avatar, Kachel | `1:1` |
| Buchcover, Poster, Flyer | `2:3` |
| Handy-Hintergrund, Story | `9:16` |

`gpt-image-1.5` und `gpt-image-1-mini` können **nur** `3:2`, `1:1`, `2:3` — bei
allem anderen lehnt die API mit einer klaren Meldung ab. Bei den
Kontext-Modellen, `flux-pro-1.1-ultra` und `flux-3-image` bestimmt der Anbieter
die genauen Kantenlängen selbst; das Verhältnis stimmt, die Pixelzahl ist nicht
vorhersagbar. Bearbeitet FLUX 3 ein Bild (`--source`), behält es dessen Rahmen —
`--ratio` spielt dann keine Rolle.

## Qualität

`--quality low|medium|high`. Die Stufe bedeutet je nach Anbieter etwas anderes:

- **FLUX**: die Auflösung (rund 1, 2 bzw. 4 Megapixel). Die API kennt dort kein
  Qualitätsfeld.
- **OpenAI**: den Rechenaufwand **und** die Auflösung.
- **FLUX 3**: die Flächenstufe `low` = `1k` (≈ 1 MP), `medium` = `1.5k`
  (≈ 2,3 MP), `high` = `2k` (≈ 4 MP), `max` = `4k` (≈ 16 MP). Gemessen am
  07.10.2026: `1k` kostet 2,4 Credits, `1.5k` 3,5 Credits — BFLs Preisliste
  nennt für `1k` das Doppelte, maßgeblich ist, was `cost` meldet. `4k` laut
  BFL rund **0,61 $**, also nur fürs fertige Bild.
- **GPT Image 2.5** hat zusätzlich `xhigh`: gleiche Größe wie `high`, aber mehr
  Rechenaufwand (rund doppelt so teuer). Für das fertige Bild, wenn `high`
  noch nicht reicht.

`low` ist für Entwürfe völlig ausreichend und deutlich billiger. `high` erst,
wenn das Bild wirklich verwendet wird.

**Für Wallpaper und große Bildschirme:** `--model gpt-image-2.5-flare --quality max`
liefert bei 16:9 echte **3840×2160** mit dem höchsten Rechenaufwand. Nur die
OpenAI-Modelle mit freier Größe können das — FLUX.2 endet bei 4 Megapixeln
(2672×1504), deshalb gibt es die Stufe dort nicht. Ein 4K-Bild kostet rund
**0,40 $**, also nicht beiläufig verwenden.

Einen Upscale gibt es nicht; wer größer will, erzeugt gleich größer.

## Prompts

- **Deutsch geht**, Englisch trifft bei FLUX oft genauer.
- Stil mitschreiben: „Aquarell", „Fotografie, 50 mm", „flache Vektorgrafik",
  „Ölgemälde". Ohne Stilangabe entscheidet das Modell.
- `--revise` lässt **BFL** den Prompt ausformulieren (`prompt_upsampling`). Das
  hilft bei kurzen, vagen Prompts und **schadet bei präzisen Vorgaben** — der
  umgeschriebene Prompt steht danach in den Metadaten. Standardmäßig aus, und
  so soll es bleiben (siehe [Prompt bleibt wörtlich](#prompt-bleibt-wörtlich)).
  OpenAI-Modelle und `flux-2-klein-9b` können das nicht, FLUX 3 tut es immer.
- Gleicher `--seed` plus gleicher Prompt ergibt bei FLUX **praktisch** dasselbe
  Bild — sichtbar identisch, aber nicht bitgenau. Nützlich, um eine Variante
  gezielt zu wiederholen und dann nur eine Kleinigkeit am Prompt zu ändern.
  OpenAI kennt keinen Seed.

## Referenzbilder

`--image PFAD`, mehrfach angebbar. Wie viele ein Modell auswertet, steht in
`aig.py models` (`maxInputImages`):

| Modell | Referenzbilder |
|---|---|
| `flux-3-image` | bis 10 (ein `--source`-Bild zählt mit) |
| `flux-2-pro` / `-flex` / `-max` / `-klein-9b` | bis 4 |
| `gpt-image-2.5-flare` / `-sunburst` | bis 16 |
| `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini` | bis 4 |
| `flux-kontext-pro` / `-max` | 1 |
| `flux-pro-1.1`, `flux-pro-1.1-ultra` | **keine** |

Der Prompt beschreibt dann die **Änderung**, nicht das ganze Bild: „mach den
Hintergrund tiefblau", nicht „ein roter Würfel vor blauem Hintergrund". FLUX.2
rechnet jedes Referenzbild extra ab — vier Vorlagen kosten spürbar mehr als eine.

Erlaubt sind PNG, JPEG und WebP bis 8 MB je Bild.

In der Weboberfläche geht es auch ohne Umweg über die Festplatte: In der
Detailansicht eines Bildes führt **„Als Referenz nutzen"** zurück in den
Generator, mit dem Bild schon als Vorlage. Solange eine gesetzt ist, stehen
dort nur Modelle zur Wahl, die Vorlagen auswerten.

```bash
aig.py gen "mach den Hintergrund tiefblau" \
  --model flux-2-pro --image ./vorlage.png --out .
```

## Komposition mit FLUX 3

FLUX 3 nimmt zum Prompt ein **Layout**: je Element eine Box und eine
Beschreibung. Der Prompt ist dann der **Szenen-Prompt** — ein Satz für das ganze
Bild, der jedes Element als `<id>` nennt. In der Weboberfläche ist das die Seite
**Komposition** (Boxen ziehen statt Zahlen tippen); das CLI nimmt eine JSON-Datei.

```json
{
  "scene": "Minimalist risograph poster on a flat chartreuse background: the headline <title_1> above a running figure <runner_1>.",
  "elements": [
    {"id": "title_1",  "bbox": [50, 89, 202, 907],  "desc": "Bold black sans-serif text reading \"RUN FAST\"."},
    {"id": "runner_1", "bbox": [317, 278, 944, 717], "desc": "A black silhouette of a runner mid-stride, facing left."}
  ]
}
```

```bash
aig.py gen --ratio 3:4 --layout poster.json --out .   # --layout wählt flux-3-image
```

Regeln, die FLUX 3 braucht:

- **`bbox` ist `[top, left, bottom, right]`** — erst die Senkrechte! Ganze Zahlen
  von 0 bis 1000, von oben links, unabhängig von Größe und Seitenverhältnis.
  `[0, 0, 500, 500]` ist das linke obere Viertel.
- **ids** klein mit Nummer (`dome_1`, `crowd_2`) und im Szenen-Prompt als
  `<id>` genannt. Fehlt eine Nennung, meldet `gen` einen Hinweis — ernst nehmen.
- **Jede Textzeile eine eigene Box**, der Wortlaut in Anführungszeichen im
  `desc`: `text reading "Sauna"`.
- **Boxen sind keine Maske**: Lage und Größe stimmen, ein Element darf leicht
  überstehen.
- **Seitenverhältnis passend zu den Boxen** wählen — das Raster dehnt sich mit.
- `--grounding` schaltet eine Websuche vor dem Generieren ein (für echte Logos,
  Bauwerke, aktuelle Plakate). Standard aus: nur dein Prompt zählt, und es geht
  schneller.

Was FLUX 3 daraus macht (gemessen am 07.10.2026): die **Boxen bleiben exakt**,
die Beschreibungen formuliert es aus, Textelemente benennt es intern um
(`title_1` → `En_Text_1`) und ergänzt mitunter eigene Zeilen, etwa einen
Hintergrund. Das alles steht in `revisedPrompt`; das gespeicherte Layout bleibt
deins.

### Ein Bild Element für Element bearbeiten

`--source <dateiname>` nimmt ein schon erzeugtes Bild als `<ref_image_0>` — in
voller Größe vom Server, der Rahmen bleibt. Jede Zeile sagt dann, woher ein
Element kommt und wohin es soll:

| Zeile | `from` | `src_bbox` | `tgt_bbox` |
|---|---|---|---|
| behalten | `"ref_image_0"` | wo es steht | dieselbe Box |
| verschieben | `"ref_image_0"` | wo es steht | neue Box |
| ersetzen / neu | `null` | `null` | Zielbox; `desc` = wie es danach aussieht |
| entfernen | `"ref_image_0"` | wo es steht | `null` |

Ist das Bild selbst mit Layout entstanden, liefert `layout --edit` alle Elemente
schon als behalten-Zeilen; man ändert nur die, die sich ändern sollen:

```bash
aig.py layout <dateiname> --edit > edit.json     # behalten-Zeilen + Satzgerüst
# edit.json anpassen: Zeile auf ersetzen/verschieben/entfernen, "scene" ausformulieren
aig.py gen --model flux-3-image --source <dateiname> --layout edit.json --out .
```

Der Szenen-Prompt ist eine Anweisung: „In <ref_image_0>, replace <title_1> with
…, move <runner_1> to the left. Keep <background_1> exactly unchanged."
Hat das Bild kein Layout, legt man die Boxen um die zu ändernden Elemente
selbst fest (Koordinaten am besten in der Weboberfläche ablesen: Detailansicht →
**„In Komposition bearbeiten"**).

Erwartung richtig setzen: Am 07.10.2026 blieb bei einer Bearbeitung alles an
seinem Platz, aber **nicht pixelgleich** — außerhalb der geänderten Box
wichen Farbton und Korn leicht ab (im Mittel 19 von 765, bei 7 % der Pixel
deutlich). Für Retusche, bei der jedes Pixel bleiben muss, taugt es nicht.

## Video mit FLUX 3

Kurze Clips (5–20 s, Fortsetzungen bis 15 s) mit Ton — Geräusche, Musik,
Sprache. In der Weboberfläche ist das die Seite **Video**; Videos stehen dort in
einer eigenen Liste, nicht in der Bildübersicht.

```bash
aig.py video "a fox running through dawn mist, birdsong" --ratio 16:9 --duration 6 --out .
```

**Drei Wege:**

| Weg | CLI | Was rein muss |
|---|---|---|
| Text → Video | `video "<prompt>"` | nur der Prompt |
| Bilder → Video | `video "<prompt>" --image A --image B …` | 1–10 Bilder (lokale Datei oder Dateiname im Bestand) |
| Fortsetzen | `video "<prompt>" --continue <video-id>` | ein fertiges Video (auch ein Entwurf) |

**Keyframes:** Ohne Zeitangabe ist ein Bild der Anfang, zwei sind Anfang und
Ende, weitere verteilen sich gleichmäßig — ab drei Bildern dann mit fester
`--duration`. Mit `@Sekunde` steht jedes Bild genau dort:
`--image start.png@0 --image mitte.png@3.5 --image ende.png@8`. Entweder alle
mit Zeit oder keins; aufsteigend; bei `--duration auto` endet das Video beim
letzten Bild. Der Prompt beschreibt, **was zwischen den Bildern passiert**
(Bewegung, Kamera, Ton), nicht die Bilder selbst.

Stark ist die Kombination mit der Komposition: Original als Anfang, die
Bearbeitung als Ende — das Video läuft vom einen zum anderen. Am 07.10.2026
wurde so aus „RUN FAST" Buchstabe für Buchstabe „GO SLOW". In der Detailansicht
eines bearbeiteten Bildes führt **„Original → dieses Bild als Video"** direkt dorthin.

**Erst Entwurf, dann fertig.** Ohne `--final` entsteht ein Entwurf: hd, schnell,
ein Drittel des Preises. Gefällt er, rendert `aig.py enhance <id> --resolution fhd`
**genau diese Aufnahme** in voller Qualität (dasselbe Seed, nichts neu
interpretiert). `--final fhd` überspringt den Entwurf — jeder Fehlversuch kostet
dann voll.

**Kosten je Sekunde** (BFL-Preisliste, 07.10.2026; gemeldet wird beim Abholen):

| | Entwurf | hd | fhd | qhd | uhd |
|---|---|---|---|---|---|
| Text/Bilder → Video | 0,06 $ | 0,17 $ | 0,29 $ | 0,40 $ | 0,80 $ |
| Fortsetzen | 0,12 $ | 0,41 $ | 0,53 $ | 0,65 $ | 0,95 $ |

Ein 10-s-Video in fhd kostet also rund 2,90 $ — vorher fragen, bevor du mehrere
fertig renderst. Gemessen: 6-s-Entwurf 36 Credits in 56 s, fertig in hd 102
Credits in 92 s, Fortsetzen 5 s Entwurf 60 Credits in 93 s.

**„Insufficient credits" (402) heißt: Konto leer — auch wenn `aig.py costs`
noch Guthaben zeigt.** BFLs Schnittstelle meldete am 07.10.2026 rund 550
Credits mehr als das Dashboard und lehnte bei 60 Credits laut Dashboard schon
alles ab. Dann nicht wiederholen, sondern Tim Bescheid sagen.

**„Protected Content" (Inhaltsprüfung):** Ein Intro, in dem eine Raubkatze
*brüllt*, wird abgelehnt — vermutlich wegen des berühmten brüllenden Löwen im
Filmintro. Ohne „roar" (z. B. „opens its jaws wide", Ton „deep hiss") ging
dasselbe Motiv durch.

**Gesprochenes** in Anführungszeichen in den Prompt, dann sagt es jemand.
Mehrere Einstellungen: „SHOT ONE: … HARD CUT. SHOT TWO: …". `--no-audio` für stumm.
Der Prompt kam im Test unverändert zurück.

`video` wartet, bis das Video fertig ist (meist ein bis zwei Minuten);
`--no-wait` gibt sofort die Id zurück, `aig.py videos` zeigt den Stand. Läuft
beim Neustart des Dienstes noch ein Video, holt der Server es danach selbst ab.

## Rezepte

Ein Bild, gleich lokal:

```bash
aig.py gen \
  "ein Leuchtturm bei Sonnenuntergang, Aquarell" \
  --model flux-2-pro --ratio 16:9 --quality medium --out ./bilder
```

Vier Varianten zur Auswahl, günstig:

```bash
aig.py gen "…" \
  --model flux-2-klein-9b --amount 4 --quality low --out ./entwuerfe
```

Titelbild mit Schrift:

```bash
aig.py gen \
  "Blog-Header, Schriftzug 'Release Notes' in klarer Groteske, minimalistisch" \
  --model gpt-image-2.5-flare --ratio 16:9 --quality high --out .
```

Nachsehen, was zuletzt erzeugt wurde, und eins davon holen. `list` zeigt zu
jedem Bild Modell und Prompt — man muss also nicht erst jedes einzeln abfragen:

```bash
aig.py list --limit 10
aig.py get <dateiname>
aig.py download <dateiname> --out .
```

**Ein bestimmtes Bild wiederfinden** — der Bestand ist vierstellig, Blättern
lohnt nicht:

```bash
aig.py list -q leuchtturm                 # Volltext im Prompt
aig.py list --model flux-2-pro --limit 50 # nur ein Modell
aig.py list --ratio 16:9 --favorite       # kombinierbar
```

**Aufräumen.** `rm` nimmt mehrere Namen auf einmal:

```bash
aig.py rm bild-a.png bild-b.png bild-c.png
```

**Räum hinter dir auf.** Wer vier Varianten erzeugt und eine davon verwendet,
löscht die anderen drei — jedes Bild belegt Platz, und ein Bestand voller
verworfener Zwischenschritte macht das Wiederfinden schwer. Für die eigenen,
in dieser Sitzung erzeugten Bilder braucht es dafür keine Rückfrage.

**Fremde Bilder sind etwas anderes.** Alles, was schon vorher da war, wird nur
auf ausdrückliche Anweisung gelöscht. `rm` ist endgültig, es gibt keinen
Papierkorb — vor einem Sammellöschen also erst mit `list` ansehen, was die
Auswahl trifft.

Markieren geht mit `aig.py favorite <datei>` (bzw. `--off`).

`--json` gibt bei jedem Befehl die Rohantwort aus — für eigene Skripte.

## Direkt per curl

Das CLI ist nur eine Hülle um die API:

```bash
curl -s https://ai.mrtimeey.com/api/generate \
  -H "Authorization: Bearer $AIG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"…","model":"flux-2-pro","ratio":"16:9","quality":"medium"}'
```

Mit Layout (nur FLUX 3) kommen `layout` und optional `grounding` und
`sourceImage` (Dateiname eines vorhandenen Bildes) dazu; `prompt` ist dann der
Szenen-Prompt. Die Antwort führt `warnings` mit — Hinweise, die den Lauf nicht
verhindert haben:

```bash
curl -s https://ai.mrtimeey.com/api/generate \
  -H "Authorization: Bearer $AIG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"A dome <dome_1> rises from a twilight bay.","model":"flux-3-image","ratio":"3:4",
       "layout":[{"id":"dome_1","bbox":[250,150,650,850],"desc":"a parabolic dome of pale concrete"}]}'
```

Aufräumen geht genauso über die API — ein Tool kann seine eigenen Werke also
ohne Umweg über das CLI wieder loswerden:

```bash
# ein einzelnes Bild
curl -s -X DELETE "$AIG_URL/api/files/<dateiname>" \
  -H "Authorization: Bearer $AIG_TOKEN"

# mehrere in einem Aufruf — schont data.json, das sonst je Bild neu geschrieben wird
curl -s "$AIG_URL/api/files/delete" -H "Authorization: Bearer $AIG_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fileNames":["a.png","b.png"]}'
```

Unter `/api` antwortet die App bei fehlender Anmeldung mit **401 JSON**, nie mit
einer Weiterleitung — ein `401` heißt also immer Token, ein `5xx` immer Dienst.
`GET /api/health` geht ohne Schlüssel.

## Kosten und Guthaben

```bash
aig.py costs
```

zeigt beides: das **Restguthaben** bei den Anbietern und die **eigenen
Ausgaben** je Monat und Modell, aufsummiert aus dem, was die Anbieter je
Auftrag gemeldet haben.

BFL rechnet in Credits, OpenAI in Dollar — beides bleibt getrennt, ein
Umrechnungskurs wäre geraten. **OpenAI gibt den Kontostand über keine API
heraus**; dort steht bestenfalls der Monatsverbrauch, und auch das nur mit
hinterlegtem Admin-Key.

Jedes einzelne Bild führt seine Kosten mit — `aig.py gen` zeigt sie direkt nach
dem Erzeugen an, `aig.py get <datei>` später. Was vor dieser Änderung entstand,
führt keine; rückwirkend liefern die Anbieter sie nicht.

### Ein Bild gezielt wiederholen

`aig.py get <datei>` gibt am Ende einen fertigen Befehl aus, der Prompt, Modell,
Verhältnis und Seed übernimmt. So ändert man eine Kleinigkeit am Prompt und
behält den Rest.

## Wenn die Verbindung abreißt

Dauert eine Generierung lange, kann der Aufruf sterben (Netzwechsel, oder die
PWA wandert in den Hintergrund). Der Server macht trotzdem weiter. Wer direkt
gegen die API geht, gibt deshalb eine eigene `requestId` mit und fragt danach
`GET /api/jobs/<id>` ab:

```bash
ID=$(openssl rand -hex 12)
curl -s "$AIG_URL/api/generate" -H "Authorization: Bearer $AIG_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"prompt\":\"…\",\"model\":\"flux-2-pro\",\"requestId\":\"$ID\"}"
# falls der Aufruf abbricht:
curl -s "$AIG_URL/api/jobs/$ID" -H "Authorization: Bearer $AIG_TOKEN"
```

Das CLI wartet einfach ab (`gen` blockiert bis zum Ergebnis) — dort ist das
nur bei sehr wackligen Verbindungen ein Thema. FLUX 3 braucht meist 20–45 s,
bei Andrang bei BFL auch über zwei Minuten: der Server wiederholt das Absenden
dann selbst, solange BFL ausdrücklich „over capacity" meldet.

## Beim Entwickeln

Im Repo (nicht über die API):

```bash
npm test           # vitest über die reine Logik
npm run lint       # TS-Dateien und die Inline-Skripte der Seiten
```

## Was der Skill nicht macht

- **Kosten:** jedes Bild kostet echtes Geld bei BFL bzw. OpenAI. Bei größeren
  Serien vorher fragen, nicht einfach vierzig Varianten erzeugen.
- **`rm` ist endgültig** — Bild und Metadaten sind weg, es gibt keinen
  Papierkorb. Eigene Zwischenergebnisse aufzuräumen ist erwünscht; alles, was
  vorher schon da war, nur auf ausdrückliche Anweisung.
- Bildbearbeitung mit Maske (Inpaint, Outpaint, Erase) gibt es nicht. Am
  nächsten kommt FLUX 3 mit Boxen (`--source` + `--layout`) — gezielt, aber
  nicht pixelgleich. Die mitgegebenen Vorlagen sind später in der
  Detailansicht des Bildes zu sehen.
- Einen Upscale gibt es nicht; wer größer will, erzeugt gleich größer.
- Videos bearbeiten (Video Edit) gibt es nicht — nur neu erzeugen oder fortsetzen.
