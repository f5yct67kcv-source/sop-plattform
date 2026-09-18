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

# ── Signier-Team ──────────────────────────────────────────────────────
# Ohne DEVELOPMENT_TEAM bricht der Bau ab ("Signing for App requires a
# development team"). Die Kennung gehoert zum Apple-Konto einer Person und
# steht nicht im Repository; sie landet in mobile/ios/lokal.xcconfig, die
# debug.xcconfig optional einbindet.
#
# Gesucht wird in vier Quellen, weil die Kennung je nach Vorgeschichte
# woanders liegt -- beim ersten Lauf typischerweise im Stash, wo die
# frueher in Xcode gesetzte Projektaenderung gelandet ist.
team_finden() {
  local t=""

  # 1. Schon eingerichtet.
  if [ -f mobile/ios/lokal.xcconfig ]; then
    t="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([A-Z0-9]\{8,\}\).*/\1/p' mobile/ios/lokal.xcconfig | head -1 || true)"
    [ -n "$t" ] && { echo "$t"; return; }
  fi

  # 2. Von Hand hinterlegt.
  if [ -f mobile/.team-id ]; then
    t="$(tr -dc 'A-Z0-9' < mobile/.team-id || true)"
    [ -n "$t" ] && { echo "$t"; return; }
  fi

  # 3. Aus einem Stash: Dort liegt die Einstellung, wenn sie frueher ueber
  #    Xcode ins Projekt geschrieben und spaeter weggeraeumt wurde.
  local s
  for s in $(git stash list --format='%gd' 2>/dev/null); do
    t="$(git stash show -p "$s" 2>/dev/null \
      | sed -n 's/^+.*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([A-Z0-9]\{8,\}\).*/\1/p' | head -1 || true)"
    [ -n "$t" ] && { echo "$t"; return; }
  done

  # 4. Aus einem installierten Bereitstellungsprofil. Zuverlaessiger als
  #    der Name des Zertifikats, in dem die Klammer nicht immer die
  #    Team-Kennung traegt.
  local p
  for p in "$HOME/Library/MobileDevice/Provisioning Profiles/"*.mobileprovision; do
    [ -f "$p" ] || continue
    t="$(security cms -D -i "$p" 2>/dev/null \
      | plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null || true)"
    [ -n "$t" ] && { echo "$t"; return; }
  done

  echo ""
}

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

echo "── 1b/5 Signier-Team pruefen"
# Nach dem Stash oben, damit eine gerade weggeraeumte Einstellung noch
# gefunden wird.
# Nicht nur "Datei da?": Eine vorhandene Datei ohne gueltige Kennung
# haette der Bau erst beim Signieren bemerkt. team_finden() liest sie als
# erste Quelle und geht weiter, wenn nichts Brauchbares drinsteht.
TEAM="$(team_finden)"
if [ -z "$TEAM" ]; then
  echo ""
  echo "  Kein Signier-Team gefunden. Ohne das kann Xcode die App nicht"
  echo "  signieren, und der Bau bricht ab."
  echo ""
  echo "  Die Kennung steht in Xcode unter:"
  echo "    Xcode > Settings > Accounts > Apple-ID auswaehlen > Team"
  echo "  Es sind zehn Zeichen, Grossbuchstaben und Ziffern."
  echo ""
  echo "  Danach einmalig ablegen (Kennung einsetzen) und neu starten:"
  echo "    echo 'DEVELOPMENT_TEAM = DEINEKENNUNG' > mobile/ios/lokal.xcconfig"
  exit 1
fi
if grep -q "DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*$TEAM" mobile/ios/lokal.xcconfig 2>/dev/null; then
  echo "        vorhanden"
else
  printf 'DEVELOPMENT_TEAM = %s\n' "$TEAM" > mobile/ios/lokal.xcconfig
  echo "        gefunden und in mobile/ios/lokal.xcconfig abgelegt"
fi

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
  # Der projekteigene Ordner, denselben setzt Schritt 5 per
  # -derivedDataPath. Xcodes globaler Ordner unter ~/Library kommt hier
  # nicht mehr vor: Dort liegen die Bauteile ALLER Projekte, und dieses
  # baut gar nicht mehr dorthin.
  rm -rf ios/DerivedData
fi

echo "── 4/5  iPhone suchen"
# Alles ab "== Simulators ==" wird abgeschnitten: Sonst gewinnt ein
# Simulator das Rennen, und die App landet wieder nicht auf dem Geraet.
GERAET="$(xcrun xctrace list devices 2>/dev/null \
  | sed -n '1,/== Simulators ==/p' \
  | grep -i "iPhone" | head -1 \
  | sed -E 's/.*\(([0-9A-Fa-f-]{25,})\).*/\1/' || true)"

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

# Vor dem Bauen nachsehen, ob Apples eigenes Werkzeug das Geraet auch
# kennt -- sonst laeuft ein mehrminuetiger Bau durch und scheitert erst
# beim Installieren.
if ! xcrun devicectl list devices 2>/dev/null | grep -q "$GERAET"; then
  echo ""
  echo "  Das iPhone taucht in der Liste, aber nicht bei devicectl auf."
  echo "  Meist fehlt die Freigabe auf dem Geraet selbst:"
  echo "    - iPhone entsperren und 'Diesem Computer vertrauen' bestaetigen"
  echo "    - Einstellungen > Datenschutz & Sicherheit > Entwicklermodus: ein"
  echo "      (danach startet das iPhone neu)"
  echo ""
  echo "  devicectl sieht derzeit:"
  xcrun devicectl list devices 2>&1 | sed 's/^/    /'
  exit 1
fi

echo "── 5/5  Bauen, installieren, starten"
# Bewusst NICHT "npx cap run ios": Dessen Hilfsprogramm native-run kennt
# angeschlossene iPhones nicht mehr, seit Apple den Weg zum Geraet auf
# CoreDevice umgestellt hat. Es listet dann nur noch Simulatoren und
# lehnt die echte Geraetekennung ab ("Invalid target ID"). Genau dort ist
# der erste Lauf gescheitert.
#
# Darum dieselben drei Schritte, die Xcode auch macht, direkt mit Apples
# eigenen Werkzeugen: bauen, installieren, starten.
DD="$PWD/ios/DerivedData"

# -allowProvisioningUpdates laesst Xcode ein fehlendes Bereitstellungs-
# profil selbst anlegen, statt den Bau abzubrechen.
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -destination "id=$GERAET" \
  -derivedDataPath "$DD" \
  -allowProvisioningUpdates \
  build

APP="$DD/Build/Products/Debug-iphoneos/App.app"
if [ ! -d "$APP" ]; then
  echo "  Der Bau hat keine App hinterlassen, erwartet unter:"
  echo "    $APP"
  exit 1
fi

# Die Kennung kommt aus capacitor.config.json und wird nicht hier
# abgeschrieben -- sonst gaebe es eine zweite Quelle, die beim naechsten
# Umbenennen stillschweigend falsch waere (siehe test_appkennung.mjs).
APPID="$(python3 -c "import json;print(json.load(open('capacitor.config.json'))['appId'])")"

echo "        installieren"
xcrun devicectl device install app --device "$GERAET" "$APP"
echo "        starten"
xcrun devicectl device process launch --device "$GERAET" "$APPID"

echo ""
echo "Fertig. Die App laeuft auf dem iPhone."
