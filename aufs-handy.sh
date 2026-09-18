#!/bin/bash
# Holt den neuesten Stand, baut die App und startet sie auf dem
# angeschlossenen iPhone -- ohne einen einzigen Klick in Xcode.
#
#     ./aufs-handy.sh              aktuellen Zweig verwenden
#     ./aufs-handy.sh main         vorher auf main wechseln
#     ./aufs-handy.sh main sauber  zusaetzlich den Zwischenspeicher leeren
#
# "sauber" loescht die abgelegten Bauteile von Xcode (DerivedData). Das
# kostet mehrere Minuten und ist nur noetig, wenn eine Aenderung partout
# nicht auf dem Geraet ankommt. Verloren geht dabei nichts: Xcode legt den
# Ordner beim naechsten Bauen neu an.
#
# Warum ueberhaupt ein Skript: Zwischen "git pull" und der fertigen App
# liegen vier Schritte, die in dieser Reihenfolge laufen muessen. Wer das
# Buendel vergisst (Schritt 3), baut die alte Oberflaeche -- der Bau
# gelingt, die Aenderung fehlt, und man sucht sie im falschen Code.
set -euo pipefail

ZWEIG="${1:-$(git rev-parse --abbrev-ref HEAD)}"
SAUBER="${2:-}"

cd "$(dirname "$0")"

echo "── 1/5  Stand holen ($ZWEIG)"
# Angefangene Arbeit wird beiseitegelegt, nicht weggeworfen: Ohne das
# bricht "git pull" ab, sobald irgendetwas geaendert ist -- auch der
# Maps-Schluessel weiter unten zaehlt dazu. Zurueck kommt sie mit
# "git stash pop".
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "aufs-handy $(date '+%d.%m. %H:%M')" >/dev/null
  echo "        Lokale Aenderungen liegen im Stash (zurueck mit: git stash pop)"
fi
git fetch origin "$ZWEIG"
git checkout "$ZWEIG"
git pull origin "$ZWEIG"

echo "── 2/5  Buendel erzeugen"
# Muss NACH dem Pull laufen: cap sync kopiert nur, was hier entsteht.
python3 mobile-buendel-erstellen.py

# Der Maps-Schluessel gehoert nicht ins Repository (siehe Kopf von
# mobile-buendel-erstellen.py). Wer die Karte auf dem Geraet braucht, legt
# ihn einmal in mobile/.maps-key -- Git nimmt die Datei nie mit.
if [ -f mobile/.maps-key ]; then
  KEY="$(tr -d '[:space:]' < mobile/.maps-key)"
  # LC_ALL=C, weil sed auf macOS sonst bei nicht-ASCII im Dateiinhalt
  # aussteigt ("illegal byte sequence").
  LC_ALL=C sed -i '' "s|__MAPS_JS_KEY__|$KEY|g" mobile/www/index.html
  echo "        Maps-Schluessel eingesetzt"
fi

echo "── 3/5  Nach iOS uebertragen"
cd mobile
npx cap sync ios

if [ "$SAUBER" = "sauber" ]; then
  echo "── 3b/5 Zwischenspeicher leeren"
  rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
fi

echo "── 4/5  iPhone suchen"
# Alles ab "== Simulators ==" wird abgeschnitten: Sonst gewinnt ein
# Simulator das Rennen, und die App landet wieder nicht auf dem Geraet.
GERAET="$(xcrun xctrace list devices 2>/dev/null \
  | sed -n '1,/== Simulators ==/p' \
  | grep -i "iPhone" | head -1 \
  | sed -E 's/.*\(([0-9A-Fa-f-]{25,})\).*/\1/')"

if [ -z "$GERAET" ]; then
  echo ""
  echo "  Kein iPhone gefunden. Das hat fast immer einen dieser Gruende:"
  echo "    - Kabel steckt nicht, oder es ist ein reines Ladekabel"
  echo "    - iPhone ist gesperrt (entsperren und angesteckt lassen)"
  echo "    - 'Diesem Computer vertrauen?' wurde noch nicht bestaetigt"
  echo ""
  echo "  Angeschlossen ist laut System:"
  xcrun xctrace list devices 2>/dev/null | sed -n '1,/== Simulators ==/p' | sed 's/^/    /'
  exit 1
fi
echo "        $GERAET"

echo "── 5/5  Bauen, installieren, starten"
npx cap run ios --target "$GERAET"

echo ""
echo "Fertig. Die App laeuft auf dem iPhone."
