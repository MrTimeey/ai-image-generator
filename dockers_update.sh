#!/usr/bin/env sh
# Wird vom webhook-Container ausgefuehrt, wenn GitHub einen Push meldet.
# Arbeitsverzeichnis ist der Ordner, in dem diese Datei liegt — auf Host und
# im Container derselbe Pfad, damit die relativen Bind-Mounts der
# Compose-Datei korrekt aufloesen.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Aktualisiere AI Image Generator in $DIR"

# **Kein `git` hier.** Der webhook-Container bringt es nicht mit, und der
# Quellcode wird auf dem Server auch nicht gebraucht: das Image kommt fertig
# aus der GitHub Registry. Compose-Datei und `.env` liegen ohnehin schon hier.

# **Die Bind-Mount-Quellen selbst anlegen.** Fehlt eines der Verzeichnisse,
# erzeugt Docker es beim Start als root — die Bilder landeten dann in einem
# Ordner, in den spaetere Laeufe nicht mehr schreiben koennen.
mkdir -p ../ai-images/thumbnails ../ai-images/big-thumbnails

# Erst ziehen, dann tauschen — haelt die Auszeit kurz.
docker compose pull

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
#
# **Wiederholt pruefen, nicht einmal nach fester Wartezeit.** Gestartet wird
# ueber ts-node, das den Quellcode beim Start uebersetzt und dafuer je nach
# Last des Servers deutlich laenger als fuenf Sekunden braucht — ein einzelner
# Versuch meldet dann einen Fehlschlag, obwohl der Deploy in Ordnung ist.
HEALTH_OK=0
for _ in $(seq 1 20); do
  if docker exec aiImageGenerator node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>{console.log('health:',JSON.stringify(j));process.exit(j.status==='ok'?0:1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 3
done

if [ "$HEALTH_OK" = "1" ]; then
  echo "Deploy erfolgreich"
else
  echo "WARNUNG: Health-Endpunkt antwortet auch nach 60 s nicht wie erwartet"
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
