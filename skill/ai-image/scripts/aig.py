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
import sys
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
        if model["supportsRevisePrompt"]:
            extras.append("kann den Prompt umschreiben")
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


def cmd_gen(args):
    payload = {"prompt": args.prompt, "model": args.model, "ratio": args.ratio, "amount": args.amount}
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
            print(f"  {image['fileName']}  {image['width']}x{image['height']}")
            if image.get("revisedPrompt") and image["revisedPrompt"] != args.prompt:
                print(f"    umgeschrieben: {image['revisedPrompt']}")
        for error in data.get("errors", []):
            print(f"  Teilfehler: {error}", file=sys.stderr)

    if args.out:
        target_dir = pathlib.Path(args.out)
        for image in data["images"]:
            path = download(f"/api/files/download/{image['fileName']}", target_dir, image["fileName"])
            print(f"  gespeichert: {path}")


def cmd_list(args):
    names = request("GET", "/api/thumbnails/all?sorting=DESC")
    names = names[: args.limit]
    if args.json:
        print(json.dumps(names, indent=2))
        return
    for name in names:
        print(name)


def cmd_get(args):
    data = request("GET", f"/api/files/get/{args.name}")
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return
    for key in ("filename", "createdAt", "model", "ratio", "width", "height", "prompt", "revisedPrompt"):
        if data.get(key) not in (None, "", "unknown"):
            print(f"{key:14} {data[key]}")


def cmd_download(args):
    path = download(f"/api/files/download/{args.name}", pathlib.Path(args.out), args.name)
    print(path)


def cmd_rm(args):
    request("DELETE", f"/api/files/{args.name}")
    print(f"{args.name} gelöscht")


def main():
    parser = argparse.ArgumentParser(description="AI Image Generator von der Kommandozeile.")
    parser.add_argument("--json", action="store_true", help="Rohantwort als JSON ausgeben")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("models", help="verfügbare Modelle mit ihren Möglichkeiten")

    gen = sub.add_parser("gen", help="Bild erzeugen")
    gen.add_argument("prompt")
    gen.add_argument("--model", default="flux-2-pro")
    gen.add_argument("--ratio", default="1:1")
    gen.add_argument("--amount", type=int, default=1)
    gen.add_argument("--quality", choices=["low", "medium", "high"])
    gen.add_argument("--format", choices=["png", "jpeg", "webp"])
    gen.add_argument("--seed", type=int)
    gen.add_argument("--revise", action="store_true", help="Prompt vom Anbieter ausformulieren lassen")
    gen.add_argument("--image", action="append", metavar="PFAD",
                     help="Referenzbild; mehrfach angebbar (siehe 'models' für das Maximum je Modell)")
    gen.add_argument("--out", help="Verzeichnis, in das die Bilder geladen werden")

    listing = sub.add_parser("list", help="vorhandene Bilder, neueste zuerst")
    listing.add_argument("--limit", type=int, default=20)

    get = sub.add_parser("get", help="Metadaten eines Bildes")
    get.add_argument("name")

    dl = sub.add_parser("download", help="Bild herunterladen")
    dl.add_argument("name")
    dl.add_argument("--out", default=".")

    rm = sub.add_parser("rm", help="Bild löschen (endgültig)")
    rm.add_argument("name")

    args = parser.parse_args()
    {"models": cmd_models, "gen": cmd_gen, "list": cmd_list,
     "get": cmd_get, "download": cmd_download, "rm": cmd_rm}[args.command](args)


if __name__ == "__main__":
    main()
