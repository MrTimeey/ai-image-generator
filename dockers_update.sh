#!/usr/bin/env sh
# Wird vom webhook-Container ausgefuehrt, wenn GitHub einen Push meldet.
# Arbeitsverzeichnis ist der Ordner, in dem diese Datei liegt — auf Host und
# im Container derselbe Pfad, damit die relativen Bind-Mounts der
# Compose-Datei korrekt aufloesen.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Aktualisiere AI Image Generator in $DIR"

# Das Image entsteht hier aus dem Quellcode (kein Registry-Push), also erst
# den neuen Stand holen.
git fetch --all --prune
git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)"

# **Die Bind-Mount-Quellen selbst anlegen.** Fehlt eines der Verzeichnisse,
# erzeugt Docker es beim Start als root — die Bilder landeten dann in einem
# Ordner, in den spaetere Laeufe nicht mehr schreiben koennen.
mkdir -p ../ai-images/thumbnails ../ai-images/big-thumbnails

docker compose build
docker compose down --remove-orphans || true
docker compose up -d --remove-orphans

# **Nginx Proxy Manager muss danach neu laden.** Er loest Upstream-Namen beim
# Laden seiner Konfiguration auf und behaelt die IP. Nach `down`/`up` hat der
# Container eine neue Adresse, und NPM zeigt ins Leere: die Seite liefert 502,
# waehrend von innen (`docker exec nginx-proxy-manager curl …`) alles in
# Ordnung ist. Das Reload ist sanft, andere Seiten laufen weiter.
echo "Lade Nginx Proxy Manager neu"
docker exec nginx-proxy-manager nginx -s reload || echo "WARNUNG: NPM-Reload fehlgeschlagen"

echo "Raeume ungenutzte Images auf"
docker image prune -f

# Ein Deploy, der stillschweigend ein kaputtes Image startet, ist schlimmer
# als einer, der meckert. `/api/health` ist bewusst ohne Anmeldung erreichbar,
# genau dafuer.
sleep 5
if docker exec aiImageGenerator node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>{console.log('health:',JSON.stringify(j));process.exit(j.status==='ok'?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"; then
  echo "Deploy erfolgreich"
else
  echo "WARNUNG: Health-Endpunkt antwortet nicht wie erwartet"
  docker compose logs --tail 40 ai-image-generator
  exit 1
fi

# Durch den Proxy pruefen, nicht am Container: nur dieser Weg faellt auf, wenn
# NPM noch auf die alte Adresse zeigt.
STATUS="$(docker exec nginx-proxy-manager curl -sS -o /dev/null -w '%{http_code}' \
  https://ai.mrtimeey.com/api/health || echo 000)"
if [ "$STATUS" = "200" ]; then
  echo "Durch den Proxy erreichbar"
else
  echo "WARNUNG: Der Proxy liefert $STATUS statt 200"
fi
