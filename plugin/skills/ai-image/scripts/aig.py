#!/usr/bin/env python3
"""CLI für den AI Image Generator auf https://ai.mrtimeey.com.

Bewusst ohne Abhängigkeiten (nur die Standardbibliothek), damit es überall
läuft, wo Python liegt.
"""
import argparse
import base64
import json
import mimetypes
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://ai.mrtimeey.com"
TOKEN_FILE = pathlib.Path.home() / ".config" / "ai-image-generator" / "token"


def base_url() -> str:
    return os.environ.get("AIG_URL", DEFAULT_URL).rstrip("/")


def token() -> str:
    value = os.environ.get("AIG_TOKEN")
    if value:
        return value.strip()
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    die(
        f"Kein Token. Einen API-Key unter {base_url()}/api-keys.html erzeugen und "
        f"nach {TOKEN_FILE} schreiben (chmod 600) oder AIG_TOKEN setzen."
    )


def die(message: str, code: int = 1):
    print(message, file=sys.stderr)
    raise SystemExit(code)


def request(method: str, path: str, payload=None, raw=False, timeout=300):
    url = f"{base_url()}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Authorization": f"Bearer {token()}", "Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read()
            return body if raw else json.loads(body or b"{}")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            detail = json.loads(body)
            message = detail.get("message") or detail.get("error") or body
        except json.JSONDecodeError:
            message = body[:400]
        # 401 heisst Token, 5xx heisst Dienst — die Unterscheidung ist der
        # ganze Grund, warum die API unter /api JSON statt eines Redirects
        # liefert.
        if error.code == 401:
            die(f"Nicht angemeldet (401): {message}", 2)
        if error.code == 403:
            die(f"Nicht erlaubt (403): {message}", 3)
        die(f"Fehler {error.code}: {message}", 4)
    except urllib.error.URLError as error:
        die(f"{base_url()} nicht erreichbar: {error.reason}", 5)


def download(path: str, target_dir: pathlib.Path, file_name: str) -> pathlib.Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / file_name
    target.write_bytes(request("GET", path, raw=True))
    return target


REWRITE_TEXT = {
    "never": "Prompt bleibt wörtlich",
    "optional": "Prompt bleibt wörtlich (--revise formuliert aus)",
    "always": "formuliert den Prompt IMMER aus",
}


def cmd_models(args):
    data = request("GET", "/api/models")
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return
    print(f"Standard: {data['defaultModel']}\n")
    for model in data["models"]:
        sizes = "vom Anbieter bestimmt" if model["sizes"] is None else "feste Kanten"
        print(f"{model['id']:20} {model['label']}")
        print(f"{'':20} {model['hint']}")
        print(
            f"{'':20} Kosten: {model['cost']} | Verhältnisse: {', '.join(model['ratios'])}"
            f" | Größe: {sizes}"
        )
        extras = []
        if model["qualities"]:
            extras.append(f"Qualität: {', '.join(model['qualities'])}")
        extras.append(f"max. {model['maxAmount']} Bilder")
        extras.append(f"Formate: {', '.join(model['formats'])}")
        umschreiben = model.get("promptRewrite") or ("optional" if model.get("supportsRevisePrompt") else "never")
        extras.append(REWRITE_TEXT[umschreiben])
        if model.get("supportsLayout"):
            extras.append("Layout (Bounding Boxes)")
        if model.get("supportsGrounding"):
            extras.append("Websuche (--grounding)")
        if model["supportsSeed"]:
            extras.append("Seed möglich")
        if model["maxInputImages"]:
            extras.append(f"bis {model['maxInputImages']} Referenzbild(er)")
        print(f"{'':20} {' | '.join(extras)}\n")


def as_data_url(path: str) -> str:
    """Referenzbild als data:-URL. Die API nimmt auch rohes base64, aber mit
    Praefix erkennt sie den Typ ohne Raten."""
    file = pathlib.Path(path).expanduser()
    if not file.is_file():
        die(f"Referenzbild nicht gefunden: {file}")
    mime = mimetypes.guess_type(file.name)[0] or "image/png"
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        die(f"{file.name}: nur PNG, JPEG und WebP sind erlaubt (erkannt: {mime})")
    return f"data:{mime};base64," + base64.b64encode(file.read_bytes()).decode()


def read_layout(source: str):
    """Liest ein Layout aus einer Datei oder von stdin ('-'): entweder die
    Liste der Elemente oder {"scene": ..., "elements": [...]}."""
    try:
        text = sys.stdin.read() if source == "-" else pathlib.Path(source).expanduser().read_text(encoding="utf-8")
    except OSError as error:
        die(f"Layout nicht lesbar: {error}")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        die(f"Layout ist kein gültiges JSON: {error}")
    if isinstance(data, list):
        return None, data
    if isinstance(data, dict) and isinstance(data.get("elements"), list):
        return data.get("scene"), data["elements"]
    die('Layout: erwartet [...] oder {"scene": ..., "elements": [...]}')


def cmd_gen(args):
    prompt = args.prompt
    layout = None
    if args.layout:
        scene, layout = read_layout(args.layout)
        # Die Szene aus der Datei gilt, wenn kein Prompt auf der Kommandozeile steht.
        prompt = prompt or scene
    if not prompt:
        die("Kein Prompt: als Argument angeben oder als \"scene\" in der Layout-Datei.")
    # Boxen kann nur FLUX 3 — dann ist es auch ohne --model gemeint.
    model = args.model or ("flux-3-image" if layout is not None or args.source else "flux-2-pro")
    payload = {"prompt": prompt, "model": model, "ratio": args.ratio, "amount": args.amount}
    if layout is not None:
        payload["layout"] = layout
    if args.source:
        payload["sourceImage"] = args.source
    if args.grounding:
        payload["grounding"] = True
    if args.image:
        payload["inputImages"] = [as_data_url(p) for p in args.image]
    if args.quality:
        payload["quality"] = args.quality
    if args.format:
        payload["outputFormat"] = args.format
    if args.seed is not None:
        payload["seed"] = args.seed
    if args.revise:
        payload["revisePrompt"] = True

    data = request("POST", "/api/generate", payload)
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(f"{data['model']} · {data['width']}x{data['height']}")
        for image in data["images"]:
            zusatz = []
            if image.get("seed") is not None:
                zusatz.append(f"seed {image['seed']}")
            if image.get("cost"):
                zusatz.append(format_cost(image["cost"]))
            print(f"  {image['fileName']}  {image['width']}x{image['height']}"
                  + (f"  [{', '.join(zusatz)}]" if zusatz else ""))
            if image.get("revisedPrompt") and image["revisedPrompt"] != prompt:
                print(f"    vom Modell ausformuliert: {image['revisedPrompt']}")
        for error in data.get("errors", []):
            print(f"  Teilfehler: {error}", file=sys.stderr)
        for warning in data.get("warnings", []):
            print(f"  Hinweis: {warning}", file=sys.stderr)

    if args.out:
        target_dir = pathlib.Path(args.out)
        for image in data["images"]:
            path = download(f"/api/files/download/{image['fileName']}", target_dir, image["fileName"])
            print(f"  gespeichert: {path}")


def cmd_list(args):
    """Blättert über den Cursor, bis genug beisammen ist."""
    from urllib.parse import urlencode

    gesammelt = []
    cursor = None
    while len(gesammelt) < args.limit:
        params = {"limit": min(args.limit - len(gesammelt), 500), "sorting": "DESC"}
        if args.query:
            params["q"] = args.query
        if args.model:
            params["model"] = args.model
        if args.ratio:
            params["ratio"] = args.ratio
        if args.favorite:
            params["favorite"] = "true"
        if cursor:
            params["cursor"] = cursor
        data = request("GET", "/api/images?" + urlencode(params))
        gesammelt.extend(data["images"])
        cursor = data.get("nextCursor")
        if not cursor:
            break

    if args.json:
        print(json.dumps(gesammelt, indent=2, ensure_ascii=False))
        return
    for image in gesammelt:
        # Prompt gekürzt daneben — beim Suchen will man ihn sehen, nicht raten.
        prompt = (image.get("prompt") or "").replace("\n", " ")[:60]
        print(f"{image['fileName']}  {image.get('model', ''):18} {prompt}")


def format_cost(cost) -> str:
    """Credits und Dollar bleiben getrennt — ein Kurs dazwischen wäre geraten."""
    if not cost or cost.get("amount") is None:
        return "unbekannt"
    betrag, einheit = cost["amount"], cost.get("unit")
    if einheit == "credits":
        return f"{betrag:g} Credits"
    if einheit == "usd":
        # Unter einem Cent sonst nur "0.00 $".
        return f"{betrag:.4f} $" if betrag < 0.01 else f"{betrag:.2f} $"
    return str(betrag)


def cmd_get(args):
    data = request("GET", f"/api/files/get/{args.name}")
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return
    for key in ("filename", "createdAt", "model", "ratio", "width", "height",
                "quality", "outputFormat", "seed", "prompt", "revisedPrompt"):
        if data.get(key) not in (None, "", "unknown"):
            print(f"{key:14} {data[key]}")
    if data.get("cost"):
        print(f"{'cost':14} {format_cost(data['cost'])}")
    if data.get("durationMs"):
        print(f"{'duration':14} {data['durationMs'] / 1000:.1f} s")
    if data.get("editedFrom"):
        print(f"{'editedFrom':14} {data['editedFrom']}")
    if data.get("layout"):
        print(f"{'layout':14} {len(data['layout'])} Element(e) — `aig.py layout {data['filename']}`")
        for row in data["layout"]:
            box = row.get("bbox") or row.get("tgt_bbox")
            print(f"{'':14}   {row['id']:16} {box}  {row['desc'][:60]}")
    if data.get("seed") is not None:
        print(f"\nNochmal mit demselben Seed:")
        print(f"  aig.py gen {json.dumps(data.get('prompt', ''), ensure_ascii=False)} "
              f"--model {data.get('model')} --ratio {data.get('ratio')} --seed {data['seed']}")


def cmd_costs(args):
    """Was hier ausgegeben wurde — nicht zu verwechseln mit dem Restguthaben."""
    data = request("GET", "/api/credits")
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return

    print("Guthaben bei den Anbietern")
    for provider in data.get("providers", []):
        if provider["kind"] == "unavailable":
            print(f"  {provider['label']:20} — {provider.get('hint', 'nicht abrufbar')[:60]}")
        else:
            art = "Restguthaben" if provider["kind"] == "balance" else "Ausgaben (Monat)"
            print(f"  {provider['label']:20} {provider['value']:g} {provider['unit']}  ({art})")
            if provider.get("hint"):
                print(f"  {'':20} {provider['hint']}")

    spending = data.get("spending")
    if not spending or spending["total"]["images"] == 0:
        print("\nNoch keine eigenen Kosten aufgezeichnet.")
        return

    def zeile(bucket):
        teile = []
        if bucket["credits"]:
            teile.append(f"{bucket['credits']:g} Credits")
        if bucket["usd"]:
            teile.append(f"{bucket['usd']:.4f} $" if bucket["usd"] < 0.01 else f"{bucket['usd']:.2f} $")
        return " + ".join(teile) or "—"

    print("\nEigene Ausgaben nach Monat")
    for monat in spending["byMonth"]:
        print(f"  {monat['key']:10} {zeile(monat):24} {monat['images']} Bild(er)")
    print(f"  {'gesamt':10} {zeile(spending['total']):24} {spending['total']['images']} Bild(er)")

    print("\nNach Modell")
    for modell in spending["byModel"]:
        print(f"  {modell['key']:22} {zeile(modell):24} {modell['images']} Bild(er)")

    if spending["total"]["unknown"]:
        print(f"\n{spending['total']['unknown']} aeltere Bilder ohne Kostenangabe — "
              "die Anbieter liefern sie nicht rueckwirkend.")


def cmd_layout(args):
    """Das Layout eines Bildes als JSON — zum Wiederverwenden oder, mit
    --edit, als Ausgangspunkt einer Bearbeitung: jedes Element als
    behalten-Zeile, von der man nur die zu ändernden anpasst."""
    data = request("GET", f"/api/files/get/{args.name}")
    rows = data.get("layout") or []
    if not rows and not args.edit:
        die(f"{args.name} hat kein Layout. Für eine Bearbeitung ohne Layout: aig.py layout {args.name} --edit")
    if args.edit:
        elements = []
        for row in rows:
            box = row.get("bbox") or row.get("tgt_bbox")
            if box is None:
                continue  # war schon entfernt
            elements.append({"id": row["id"], "from": "ref_image_0", "src_bbox": box, "tgt_bbox": box,
                             "desc": row["desc"]})
        result = {"scene": "In <ref_image_0>, … Keep "
                           + ", ".join(f"<{e['id']}>" for e in elements) + " exactly unchanged.",
                  "elements": elements}
        print(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"\nWeiter mit: aig.py gen --model flux-3-image --source {args.name} --layout DATEI",
              file=sys.stderr)
        return
    print(json.dumps({"scene": data.get("prompt", ""), "elements": rows}, indent=2, ensure_ascii=False))


def keyframe_arg(value: str):
    """`bild.png`, `bild.png@3.5` oder ein Dateiname aus dem Bestand.
    Lokale Dateien gehen als data:-URL hinaus, alles andere als Name im Bestand."""
    pfad, _, zeit = value.rpartition("@") if "@" in value else (value, "", "")
    frame = {}
    if zeit:
        try:
            frame["time"] = float(zeit)
        except ValueError:
            die(f"--image {value}: hinter @ steht die Sekunde, z. B. bild.png@3.5")
    frame["image"] = as_data_url(pfad) if pathlib.Path(pfad).expanduser().is_file() else pfad
    return frame


def video_line(video) -> str:
    teile = [video["status"], video["mode"], "Entwurf" if video["draft"] else video["resolution"]]
    if video.get("seconds"):
        teile.append(f"{video['seconds']:g} s")
    if video.get("cost") is not None:
        teile.append(("≈ " if video.get("costEstimated") else "") + f"{video['cost']:g} Credits")
    return f"{video['id']}  {' · '.join(teile)}  {video['prompt'][:50]}"


def wait_for_video(video_id: str):
    """Ein Video braucht ein bis drei Minuten; der Server arbeitet im Hintergrund."""
    begonnen = time.time()
    while True:
        video = request("GET", f"/api/videos/{video_id}")
        if video["status"] != "running":
            if sys.stderr.isatty():
                print(file=sys.stderr)
            return video
        if sys.stderr.isatty():
            print(f"\r  entsteht seit {int(time.time() - begonnen)} s …", end="", file=sys.stderr, flush=True)
        time.sleep(5)


def finish_video(video, args):
    if args.json:
        print(json.dumps(video, indent=2, ensure_ascii=False))
    else:
        print(video_line(video))
    if video["status"] == "error":
        die(f"Fehlgeschlagen: {video.get('error')}", 4)
    if video.get("canEnhance") and not args.json:
        print(f"  Gefällt der Entwurf: aig.py enhance {video['id']} --resolution fhd")
    if getattr(args, "out", None) and video.get("url"):
        target = download(f"{video['url']}?download=1", pathlib.Path(args.out), f"{video['id']}.mp4")
        print(f"  gespeichert: {target}")


def cmd_video(args):
    payload = {"prompt": args.prompt, "aspectRatio": args.ratio, "generateAudio": not args.no_audio,
               "draft": args.final is None}
    payload["duration"] = "auto" if args.duration == "auto" else int(args.duration)
    if args.final:
        payload["resolution"] = args.final
    if args.image:
        payload["mode"] = "i2v"
        payload["keyframes"] = [keyframe_arg(value) for value in args.image]
    elif args.continue_video:
        payload["mode"] = "v2v"
        payload["startVideo"] = args.continue_video
    else:
        payload["mode"] = "t2v"
    video = request("POST", "/api/videos", payload)
    if args.no_wait:
        print(video_line(video))
        print(f"  Abholen: aig.py videos   (oder GET /api/videos/{video['id']})")
        return
    finish_video(wait_for_video(video["id"]), args)


def cmd_enhance(args):
    video = request("POST", f"/api/videos/{args.id}/enhance", {"resolution": args.resolution})
    if args.no_wait:
        print(video_line(video))
        return
    finish_video(wait_for_video(video["id"]), args)


def cmd_videos(args):
    data = request("GET", "/api/videos")["videos"][: args.limit]
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return
    for video in data:
        print(video_line(video))


def cmd_sheet(args):
    """Kontaktbogen eines Videos: Einzelbilder im festen Takt, mit Zeitstempel,
    als ein PNG. Ein Agent kann ein Video nicht abspielen — ohne den Bogen kann
    er einen Entwurf nicht beurteilen. Braucht ffmpeg lokal."""
    if not shutil.which("ffmpeg"):
        die("Für den Kontaktbogen braucht es ffmpeg (z. B. `sudo apt install ffmpeg`).")
    video = request("GET", f"/api/videos/{args.id}")
    if not video.get("url"):
        die(f"Video {args.id} ist nicht fertig ({video['status']}).")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        mp4 = download(f"{video['url']}?download=1", pathlib.Path(tmp), "video.mp4")
        sekunden = video.get("seconds") or 10
        # Gerundet, nicht aufgerundet: 8,04 s × 4 sind 32 Bilder, nicht 33 (sonst bleibt eine Zeile leer).
        bilder = max(1, round(sekunden * args.fps))
        spalten = 8 if bilder > 16 else 4
        zeilen = -(-bilder // spalten)
        ziel = out / f"{args.id}-bogen.png"
        filter_ = (f"fps={args.fps},scale={args.width}:-1,"
                   "drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=12:fontcolor=white:box=1:boxcolor=black@0.6,"
                   f"tile={spalten}x{zeilen}")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(mp4), "-vf", filter_,
                        "-frames:v", "1", str(ziel)], check=True)
    print(ziel)


def cmd_video_rm(args):
    for video_id in args.ids:
        request("DELETE", f"/api/videos/{video_id}")
        print(f"{video_id} gelöscht")


def cmd_download(args):
    path = download(f"/api/files/download/{args.name}", pathlib.Path(args.out), args.name)
    print(path)


def cmd_rm(args):
    """Löscht ein oder mehrere Bilder. Endgültig — es gibt keinen Papierkorb."""
    if len(args.names) == 1:
        request("DELETE", f"/api/files/{args.names[0]}")
        print(f"{args.names[0]} gelöscht")
        return
    data = request("POST", "/api/files/delete", {"fileNames": args.names})
    print(f"{data['deleted']} Bild(er) gelöscht")
    for uebersprungen in data.get("skipped", []):
        print(f"  nicht gefunden: {uebersprungen}", file=sys.stderr)


def cmd_favorite(args):
    request("PUT", f"/api/files/{args.name}/favorite", {"favorite": not args.off})
    print(f"{args.name} {'nicht mehr markiert' if args.off else 'als Favorit markiert'}")


def main():
    parser = argparse.ArgumentParser(description="AI Image Generator von der Kommandozeile.")
    parser.add_argument("--json", action="store_true", help="Rohantwort als JSON ausgeben")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("models", help="verfügbare Modelle mit ihren Möglichkeiten")

    gen = sub.add_parser("gen", help="Bild erzeugen")
    gen.add_argument("prompt", nargs="?", help="bei --layout mit \"scene\" entbehrlich")
    gen.add_argument("--model", help="Standard: flux-2-pro, mit --layout/--source flux-3-image")
    gen.add_argument("--ratio", default="1:1")
    gen.add_argument("--amount", type=int, default=1)
    gen.add_argument("--quality", choices=["low", "medium", "high", "xhigh", "max"],
                     help="max = größtmögliche Auflösung des Modells (nur wo angeboten, deutlich teurer); "
                          "xhigh = gleiche Größe wie high, mehr Rechenaufwand (nur GPT Image 2.5)")
    gen.add_argument("--format", choices=["png", "jpeg", "webp"])
    gen.add_argument("--seed", type=int)
    gen.add_argument("--revise", action="store_true", help="Prompt vom Anbieter ausformulieren lassen")
    gen.add_argument("--image", action="append", metavar="PFAD",
                     help="Referenzbild; mehrfach angebbar (siehe 'models' für das Maximum je Modell)")
    gen.add_argument("--out", help="Verzeichnis, in das die Bilder geladen werden")
    gen.add_argument("--layout", metavar="DATEI",
                     help="Bounding Boxes (nur FLUX 3) als JSON-Datei, '-' für stdin: "
                          "[{id, bbox, desc}, …] oder {\"scene\": …, \"elements\": […]}")
    gen.add_argument("--source", metavar="DATEINAME",
                     help="ein schon erzeugtes Bild als ref_image_0 bearbeiten (volle Größe, Rahmen bleibt)")
    gen.add_argument("--grounding", action="store_true",
                     help="FLUX 3 recherchiert vorher im Web (für echte Dinge); Standard aus")

    listing = sub.add_parser("list", help="vorhandene Bilder, neueste zuerst")
    listing.add_argument("--limit", type=int, default=20)
    listing.add_argument("--query", "-q", help="Volltext im Prompt")
    listing.add_argument("--model", help="nur dieses Modell")
    listing.add_argument("--ratio", help="nur dieses Seitenverhältnis")
    listing.add_argument("--favorite", action="store_true", help="nur Favoriten")

    get = sub.add_parser("get", help="Metadaten eines Bildes")
    get.add_argument("name")

    lay = sub.add_parser("layout", help="Layout (Bounding Boxes) eines Bildes als JSON")
    lay.add_argument("name")
    lay.add_argument("--edit", action="store_true",
                     help="als behalten-Zeilen für eine Bearbeitung mit --source")

    vid = sub.add_parser("video", help="Video erzeugen (FLUX 3): Text, Bilder oder Fortsetzung; Standard: Entwurf")
    vid.add_argument("prompt")
    vid.add_argument("--image", action="append", metavar="BILD[@SEK]",
                     help="Keyframe: lokale Datei oder Dateiname im Bestand, optional mit Sekunde "
                          "(bild.png@4.5). Mehrfach angebbar, bis 10. Ohne Sekunden: eins = Anfang, "
                          "zwei = Anfang und Ende, mehr = gleichmäßig verteilt (dann --duration nötig)")
    vid.add_argument("--continue", dest="continue_video", metavar="VIDEO_ID",
                     help="dieses Video fortsetzen (bis 15 s, eigener Preis)")
    vid.add_argument("--duration", default="auto", help="5–20 Sekunden (Fortsetzung bis 15) oder auto")
    vid.add_argument("--ratio", default="auto", choices=["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16", "9:21"])
    vid.add_argument("--final", choices=["hd", "fhd", "qhd", "uhd"],
                     help="ohne Entwurf direkt in dieser Auflösung (teurer, jeder Fehlversuch kostet voll)")
    vid.add_argument("--no-audio", action="store_true", help="ohne Ton")
    vid.add_argument("--no-wait", action="store_true", help="nicht auf das Ergebnis warten")
    vid.add_argument("--out", help="Verzeichnis, in das das Video geladen wird")

    enh = sub.add_parser("enhance", help="einen Video-Entwurf fertig rendern — dieselbe Aufnahme")
    enh.add_argument("id")
    enh.add_argument("--resolution", default="fhd", choices=["hd", "fhd", "qhd", "uhd"])
    enh.add_argument("--no-wait", action="store_true")
    enh.add_argument("--out")

    vids = sub.add_parser("videos", help="vorhandene Videos, neueste zuerst")
    vids.add_argument("--limit", type=int, default=20)

    sht = sub.add_parser("sheet", help="Kontaktbogen eines Videos (Einzelbilder mit Zeitstempel) — zum Beurteilen")
    sht.add_argument("id")
    sht.add_argument("--fps", type=float, default=4, help="Bilder je Sekunde (Standard 4)")
    sht.add_argument("--width", type=int, default=200, help="Breite je Bild in Pixeln")
    sht.add_argument("--out", default=".")

    vrm = sub.add_parser("video-rm", help="Video(s) löschen (endgültig)")
    vrm.add_argument("ids", nargs="+", metavar="VIDEO_ID")

    sub.add_parser("costs", help="Guthaben und was hier bereits ausgegeben wurde")

    dl = sub.add_parser("download", help="Bild herunterladen")
    dl.add_argument("name")
    dl.add_argument("--out", default=".")

    rm = sub.add_parser("rm", help="Bild(er) löschen (endgültig)")
    rm.add_argument("names", nargs="+", metavar="DATEINAME")

    fav = sub.add_parser("favorite", help="Bild als Favorit markieren")
    fav.add_argument("name")
    fav.add_argument("--off", action="store_true", help="Markierung aufheben")

    args = parser.parse_args()
    {"models": cmd_models, "gen": cmd_gen, "list": cmd_list, "get": cmd_get, "layout": cmd_layout,
     "costs": cmd_costs, "download": cmd_download, "rm": cmd_rm,
     "favorite": cmd_favorite, "video": cmd_video, "enhance": cmd_enhance, "videos": cmd_videos,
     "video-rm": cmd_video_rm, "sheet": cmd_sheet}[args.command](args)


if __name__ == "__main__":
    main()
