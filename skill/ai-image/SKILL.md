---
name: ai-image
description: Bilder mit dem eigenen AI Image Generator auf ai.mrtimeey.com erzeugen und verwalten - Modellwahl (FLUX.2, FLUX.1 Kontext, OpenAI gpt-image), Seitenverhältnis, Referenzbilder, Varianten, Download, Metadaten. Auslösen bei - Bild generieren, Bild erzeugen, Bild bearbeiten, Referenzbild, Vorlage, Illustration, Titelbild, Header-Bild, Poster, Icon-Motiv, KI-Bild, FLUX, gpt-image, ai.mrtimeey.com, aig.
---

# AI Image Generator

Bilder erzeugen über die eigene Instanz auf `https://ai.mrtimeey.com`. Die Bilder
liegen danach **auf dem Server**, in der Übersicht der Weboberfläche — lokal
landen sie nur, wenn `--out` mitgegeben wird.

Alles läuft über ein CLI:

```bash
python3 ~/.claude/skills/ai-image/scripts/aig.py <befehl>
```

## Ersteinrichtung (einmalig)

1. `https://ai.mrtimeey.com/api-keys.html` öffnen, Schlüssel erzeugen, Klartext
   kopieren — er wird **nur einmal** angezeigt.
2. Ablegen:
   ```bash
   mkdir -p ~/.config/ai-image-generator
   printf '%s' '<der Schlüssel>' > ~/.config/ai-image-generator/token
   chmod 600 ~/.config/ai-image-generator/token
   ```

Alternativ `AIG_TOKEN` setzen. `AIG_URL` überschreibt die Adresse (z. B.
`http://localhost:3000` im Dev-Betrieb).

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
| **Text im Bild**, Schrift, Beschriftung, Logo | `gpt-image-2` |
| Präzise Vorgaben, die eingehalten werden müssen | `gpt-image-2` |
| Druck, großes Format, 4 Megapixel | `flux-pro-1.1-ultra` |
| Vorhandenes Bild verändern | `flux-kontext-pro` / `flux-kontext-max` |
| Mehrere Vorlagen kombinieren | `flux-2-pro` (bis 4 Referenzbilder) |
| Billig und schnell bei OpenAI | `gpt-image-1-mini` |

FLUX ist stärker bei Bildwirkung und Stil, `gpt-image-2` bei Instruktionstreue
und allem, was lesbar sein muss. Wenn Schrift im Bild vorkommt, ist die Wahl
nicht offen — dann `gpt-image-2`.

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
Kontext-Modellen und `flux-pro-1.1-ultra` bestimmt der Anbieter die genauen
Kantenlängen selbst; das Verhältnis stimmt, die Pixelzahl ist nicht vorhersagbar.

## Qualität

`--quality low|medium|high`. Die Stufe bedeutet je nach Anbieter etwas anderes:

- **FLUX**: die Auflösung (rund 1, 2 bzw. 4 Megapixel). Die API kennt dort kein
  Qualitätsfeld.
- **OpenAI**: den Rechenaufwand **und** die Auflösung.

`low` ist für Entwürfe völlig ausreichend und deutlich billiger. `high` erst,
wenn das Bild wirklich verwendet wird.

## Prompts

- **Deutsch geht**, Englisch trifft bei FLUX oft genauer.
- Stil mitschreiben: „Aquarell", „Fotografie, 50 mm", „flache Vektorgrafik",
  „Ölgemälde". Ohne Stilangabe entscheidet das Modell.
- `--revise` lässt **BFL** den Prompt ausformulieren (`prompt_upsampling`). Das
  hilft bei kurzen, vagen Prompts und **schadet bei präzisen Vorgaben** — der
  umgeschriebene Prompt steht danach in den Metadaten. Standardmäßig aus.
  OpenAI-Modelle können das nicht.
- Gleicher `--seed` plus gleicher Prompt ergibt bei FLUX dasselbe Bild — nützlich,
  um eine Variante gezielt zu wiederholen. OpenAI kennt keinen Seed.

## Referenzbilder

`--image PFAD`, mehrfach angebbar. Wie viele ein Modell auswertet, steht in
`aig.py models` (`maxInputImages`):

| Modell | Referenzbilder |
|---|---|
| `flux-2-pro` / `-flex` / `-max` / `-klein-9b` | bis 4 |
| `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini` | bis 4 |
| `flux-kontext-pro` / `-max` | 1 |
| `flux-pro-1.1`, `flux-pro-1.1-ultra` | **keine** |

Der Prompt beschreibt dann die **Änderung**, nicht das ganze Bild: „mach den
Hintergrund tiefblau", nicht „ein roter Würfel vor blauem Hintergrund". FLUX.2
rechnet jedes Referenzbild extra ab — vier Vorlagen kosten spürbar mehr als eine.

Erlaubt sind PNG, JPEG und WebP bis 8 MB je Bild.

```bash
python3 ~/.claude/skills/ai-image/scripts/aig.py gen "mach den Hintergrund tiefblau" \
  --model flux-2-pro --image ./vorlage.png --out .
```

## Rezepte

Ein Bild, gleich lokal:

```bash
python3 ~/.claude/skills/ai-image/scripts/aig.py gen \
  "ein Leuchtturm bei Sonnenuntergang, Aquarell" \
  --model flux-2-pro --ratio 16:9 --quality medium --out ./bilder
```

Vier Varianten zur Auswahl, günstig:

```bash
python3 ~/.claude/skills/ai-image/scripts/aig.py gen "…" \
  --model flux-2-klein-9b --amount 4 --quality low --out ./entwuerfe
```

Titelbild mit Schrift:

```bash
python3 ~/.claude/skills/ai-image/scripts/aig.py gen \
  "Blog-Header, Schriftzug 'Release Notes' in klarer Groteske, minimalistisch" \
  --model gpt-image-2 --ratio 16:9 --quality high --out .
```

Nachsehen, was zuletzt erzeugt wurde, und eins davon holen:

```bash
python3 ~/.claude/skills/ai-image/scripts/aig.py list --limit 10
python3 ~/.claude/skills/ai-image/scripts/aig.py get <dateiname>
python3 ~/.claude/skills/ai-image/scripts/aig.py download <dateiname> --out .
```

`--json` gibt bei jedem Befehl die Rohantwort aus — für eigene Skripte.

## Direkt per curl

Das CLI ist nur eine Hülle um die API:

```bash
curl -s https://ai.mrtimeey.com/api/generate \
  -H "Authorization: Bearer $AIG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"prompt":"…","model":"flux-2-pro","ratio":"16:9","quality":"medium"}'
```

Unter `/api` antwortet die App bei fehlender Anmeldung mit **401 JSON**, nie mit
einer Weiterleitung — ein `401` heißt also immer Token, ein `5xx` immer Dienst.
`GET /api/health` geht ohne Schlüssel.

## Guthaben

`https://ai.mrtimeey.com/account.html` zeigt das BFL-Guthaben und verlinkt die
Aufladeseiten. Per API:

```bash
curl -s https://ai.mrtimeey.com/api/credits -H "Authorization: Bearer $AIG_TOKEN"
```

BFL liefert echte Credits. **OpenAI gibt den Kontostand über keine API heraus** —
dort steht bestenfalls der Verbrauch des Monats, und auch das nur mit einem
hinterlegten Admin-Key.

## Was der Skill nicht macht

- **Kosten:** jedes Bild kostet echtes Geld bei BFL bzw. OpenAI. Bei größeren
  Serien vorher fragen, nicht einfach vierzig Varianten erzeugen.
- **`rm` ist endgültig** — Bild und Metadaten sind weg, es gibt keinen Papierkorb.
  Nur löschen, wenn ausdrücklich darum gebeten wurde.
- Bildbearbeitung mit Maske (Inpaint, Outpaint, Erase) ist nicht eingebunden —
  nur ganze Referenzbilder.
