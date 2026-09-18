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
# Eine Apple-Team-Kennung hat IMMER genau zehn Zeichen, Grossbuchstaben
# und Ziffern. Das ist die eigentliche Pruefung -- und nicht "irgendwas
# Grossgeschriebenes": Eine frueher zu lasche Fassung liess den
# Platzhalter "DEINEKENNUNG" aus der Anleitung durchgehen, schrieb ihn in
# die Datei und meldete danach bei jedem Lauf zufrieden "vorhanden".
# Gescheitert ist es erst der Bau, mit "No Account for Team".
team_gueltig() {
  local t
  t="$(printf '%s' "${1:-}" | tr -dc 'A-Z0-9')"
  [ ${#t} -eq 10 ] && printf '%s' "$t"
}

# Den Wert hinter dem Gleichheitszeichen holen, ohne ihn schon zu
# beschneiden -- die Laengenpruefung kommt danach. Wer hier gleich zehn
# Zeichen herausschneidet, macht aus "DEINEKENNUNG" klaglos "DEINEKENNU".
team_aus_zeile() {
  sed -n 's/^[+[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([^;[:space:]]*\).*/\1/p' | head -1
}

team_finden() {
  local t=""

  # 1. Schon eingerichtet.
  if [ -f mobile/ios/lokal.xcconfig ]; then
    t="$(team_gueltig "$(team_aus_zeile < mobile/ios/lokal.xcconfig || true)")"
    [ -n "$t" ] && { echo "$t"; return; }
  fi

  # 2. Von Hand hinterlegt.
  if [ -f mobile/.team-id ]; then
    t="$(team_gueltig "$(cat mobile/.team-id || true)")"
    [ -n "$t" ] && { echo "$t"; return; }
  fi

  # 3. Aus einem Stash: Dort liegt die Einstellung, wenn sie frueher ueber
  #    Xcode ins Projekt geschrieben und spaeter weggeraeumt wurde.
  local s
  for s in $(git stash list --format='%gd' 2>/dev/null); do
    t="$(team_gueltig "$(git stash show -p "$s" 2>/dev/null | grep '^+' | team_aus_zeile || true)")"
    [ -n "$t" ] && { echo "$t"; return; }
  done

  # 4. Aus einem installierten Bereitstellungsprofil. Zuverlaessiger als
  #    der Name des Zertifikats, in dem die Klammer nicht immer die
  #    Team-Kennung traegt.
  local p
  for p in "$HOME/Library/MobileDevice/Provisioning Profiles/"*.mobileprovision; do
    [ -f "$p" ] || continue
    t="$(team_gueltig "$(security cms -D -i "$p" 2>/dev/null \
      | plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null || true)")"
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
  echo "  Es sind genau zehn Zeichen, Grossbuchstaben und Ziffern,"
  echo "  zum Beispiel in der Form A1B2C3D4E5."
  echo ""
  echo "  Danach einmal ablegen und neu starten. Die zehn Zeichen dabei"
  echo "  wirklich durch die eigenen ersetzen -- ein Platzhalter wird hier"
  echo "  nicht angenommen:"
  echo ""
  echo "    nano mobile/ios/lokal.xcconfig"
  echo ""
  echo "  In die leere Datei diese eine Zeile schreiben, dann Ctrl+O,"
  echo "  Enter, Ctrl+X:"
  echo "    DEVELOPMENT_TEAM = <die zehn Zeichen>"
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
maps_schluessel_einsetzen() {
  ZIEL="$1"
  QUELLE="${2:-mobile/.maps-key}"
  if [ ! -f "$QUELLE" ]; then
    # Frueher schwieg dieser Zweig. Die App landete dann mit dem Platzhalter
    # statt eines Schluessels auf dem Geraet, Google lehnte ihn ab, und in
    # der laufenden Runde stand statt der Karte eine graue Tafel --
    # gemeldet vom Projektinhaber. Ein uebersprungener Schritt darf nicht
    # wie ein gelungener aussehen (CLAUDE.md).
    echo "        KEINE Karte: $QUELLE fehlt."
    echo "        Die Rundgang-Karte bleibt auf dem Geraet leer, alles andere laeuft."
    echo "        Abhilfe: den Google-Maps-JS-Schluessel einmal ablegen --"
    echo "            printf '%s' 'DEIN_SCHLUESSEL' > $QUELLE"
    echo "        Git nimmt die Datei nie mit. Danach dieses Skript erneut laufen lassen."
    echo "        Der Schluessel muss ausserdem fuer die App freigegeben sein:"
    echo "        Capacitor laedt die Seite unter capacitor://localhost, nicht unter"
    echo "        der Web-Adresse -- eine reine Web-Freigabe reicht dafuer nicht."
    return 0
  fi
  KEY="$(tr -d '[:space:]' < "$QUELLE")"
  if [ -z "$KEY" ]; then
    echo "        KEINE Karte: $QUELLE ist leer."
    echo "        Die Rundgang-Karte bleibt auf dem Geraet leer, alles andere laeuft."
    return 0
  fi
  # LC_ALL=C, weil sed auf macOS sonst bei nicht-ASCII im Dateiinhalt
  # aussteigt ("illegal byte sequence"). Das leere Argument nach -i ist
  # die BSD-Schreibweise fuer "keine Sicherungskopie".
  if sed --version >/dev/null 2>&1; then
    LC_ALL=C sed -i "s|__MAPS_JS_KEY__|$KEY|g" "$ZIEL"
  else
    LC_ALL=C sed -i '' "s|__MAPS_JS_KEY__|$KEY|g" "$ZIEL"
  fi
  echo "        Maps-Schluessel eingesetzt"
}

maps_schluessel_einsetzen mobile/www/index.html

echo "── 3/5  Nach iOS uebertragen"
cd mobile

# ERST installieren, DANN uebertragen. Ohne das fehlt ein neu
# eingetragenes Plugin in node_modules, und "cap sync" schreibt
# Package.swift ohne es neu -- der Bau gelingt, das Plugin ist aber nicht
# dabei. Genau so fehlte das Push-Plugin auf dem Geraet: keine Frage nach
# der Erlaubnis, die App tauchte nicht einmal in den Mitteilungs-
# einstellungen auf. Nebenwirkung war ausserdem, dass die neu
# geschriebene Package.swift bei jedem Lauf als lokale Aenderung im Stash
# landete.
npm install --silent

npx cap sync ios

# Nachsehen, ob jedes native Plugin auch wirklich im Bau landet. Geprueft
# wird die Aussage, nicht ein Name: Jedes Paket unter node_modules/@capacitor/
# mit eigener Package.swift IST ein natives Plugin und muss in der
# Package.swift des Projekts auftauchen.
FEHLEND=""
for pfad in node_modules/@capacitor/*/; do
  [ -f "${pfad}Package.swift" ] || continue
  name="$(basename "$pfad")"
  grep -q "@capacitor/${name}" ios/App/CapApp-SPM/Package.swift || FEHLEND="$FEHLEND $name"
done
if [ -n "$FEHLEND" ]; then
  echo ""
  echo "  Diese Plugins fehlen im nativen Bau:$FEHLEND"
  echo "  Der Bau wuerde gelingen, die Funktion auf dem Geraet aber fehlen."
  echo "  Meist hilft: cd mobile && rm -rf node_modules && npm install"
  exit 1
fi
echo "        Plugins vollstaendig"

if [ "$SAUBER" = "sauber" ]; then
  echo "── 3b/5 Zwischenspeicher leeren"
  # Der projekteigene Ordner, denselben setzt Schritt 5 per
  # -derivedDataPath. Xcodes globaler Ordner unter ~/Library kommt hier
  # nicht mehr vor: Dort liegen die Bauteile ALLER Projekte, und dieses
  # baut gar nicht mehr dorthin.
  rm -rf ios/DerivedData
fi

echo "── 4/5  iPhone suchen"
# ACHTUNG, hier liegt eine Falle: Apples zwei Werkzeuge fuehren DASSELBE
# Geraet unter ZWEI verschiedenen Kennungen.
#
#   xctrace / xcodebuild : 00008130-000974693AF3803A  (UDID der Hardware)
#   devicectl            : F0778C89-7B3B-...-...      (CoreDevice-Kennung)
#
# Beide werden gebraucht, jede an ihrer Stelle. Wer die eine dem anderen
# Werkzeug gibt, bekommt "Invalid target ID" oder findet das Geraet
# scheinbar nicht -- obwohl es angeschlossen und freigegeben ist.

# Fuer xcodebuild. Alles ab "== Simulators ==" wird abgeschnitten, sonst
# gewinnt ein Simulator das Rennen und die App landet nicht auf dem Geraet.
UDID="$(xcrun xctrace list devices 2>/dev/null \
  | sed -n '1,/== Simulators ==/p' \
  | grep -i "iPhone" | head -1 \
  | sed -E 's/.*\(([0-9A-Fa-f-]{25,})\).*/\1/' || true)"

# Fuer devicectl. Die Kopfzeile der Tabelle traegt das Wort "Identifier"
# und wird darum ausgelassen; der Hostname enthaelt ebenfalls "iPhone",
# stoert aber nicht, weil nur das UUID-Muster gelesen wird.
DEVCTL="$(xcrun devicectl list devices 2>/dev/null \
  | grep -i "iPhone" | grep -v "Identifier" | head -1 \
  | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}' \
  | head -1 || true)"

# Ohne devicectl-Kennung geht gar nichts -- ueber sie laeuft das
# Installieren und das Starten. Die UDID ist dagegen KEINE Vorbedingung
# mehr: Sie dient nur dazu, gezielt fuer dieses eine Geraet zu bauen, und
# xcodebuild fuehrt seine Geraeteliste getrennt von devicectl. Genau das
# ist hier passiert -- devicectl sah das iPhone, xcodebuild nicht, und der
# Lauf brach mit "Unable to find a destination" ab, obwohl das Telefon
# angeschlossen war. Fehlt sie, wird allgemein fuer iOS gebaut; das
# Ergebnis landet ueber devicectl genauso auf dem Geraet.
if [ -z "$DEVCTL" ]; then
  echo ""
  echo "  Kein einsatzbereites iPhone gefunden."
  echo "    - devicectl sieht keines (Kabel, Sperre, Vertrauensfrage,"
  echo "      Entwicklermodus eingeschaltet?)"
  echo ""
  echo "  Was die beiden Werkzeuge melden:"
  xcrun xctrace list devices 2>/dev/null | sed -n '1,/== Simulators ==/p' | sed 's/^/    /'
  xcrun devicectl list devices 2>&1 | sed 's/^/    /'
  exit 1
fi
if [ -n "$UDID" ]; then
  echo "        gefunden (Bau: ${UDID}, Installation: ${DEVCTL})"
else
  echo "        gefunden (Installation: ${DEVCTL})"
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

# Workspace oder Projekt? Capacitor 8 bindet seine Plugins ueber den Swift
# Package Manager ein, und dann gibt es GAR KEIN App.xcworkspace -- das
# entsteht nur bei CocoaPods. Fest auf das Workspace zu zeigen, brach hier
# mit "does not exist" ab. Geprueft wird darum, was wirklich da liegt.
if [ -d ios/App/App.xcworkspace ]; then
  ZIEL=(-workspace ios/App/App.xcworkspace)
elif [ -d ios/App/App.xcodeproj ]; then
  ZIEL=(-project ios/App/App.xcodeproj)
else
  echo "  Weder App.xcworkspace noch App.xcodeproj unter ios/App/ gefunden."
  echo "  Lief 'npx cap sync ios' oben durch?"
  exit 1
fi

# Das Schema liegt bei Capacitor nicht im Repository, sondern entsteht,
# wenn das Projekt einmal in Xcode geoeffnet wurde (xcuserdata, bewusst
# nicht versioniert). Fehlt es, ist -target der Weg, der ohne Schema
# auskommt.
if xcodebuild -list "${ZIEL[@]}" 2>/dev/null | sed -n '/Schemes:/,$p' | grep -qw "App"; then
  WIE=(-scheme App)
else
  echo "        kein Schema vorhanden, baue ueber das Ziel"
  WIE=(-target App)
fi

# Fuer WELCHES Ziel gebaut wird.
#
# Am liebsten fuer genau dieses iPhone (-destination id=...): Dann baut
# Xcode nur die noetige Architektur und traegt das Geraet bei Bedarf gleich
# ins Bereitstellungsprofil ein.
#
# Nur sieht xcodebuild das Geraet nicht immer, auch wenn es dasteht --
# waehrend Xcode es nach einem iOS-Update noch vorbereitet, bei gesperrtem
# Bildschirm, ueber WLAN statt Kabel. devicectl sieht es in diesen Faellen
# laengst. Frueher brach der Lauf dann mit "Unable to find a destination
# matching ..." ab und listete hilflos alle Simulatoren auf.
#
# Darum wird gefragt statt angenommen: Bietet xcodebuild dieses Geraet an,
# wird es genommen; sonst wird allgemein fuer iOS gebaut. Installiert wird
# so oder so ueber devicectl, und dem ist die Herkunft des Bauwerks egal.
bau_ziel_waehlen() {
  GESUCHT="$1"; shift
  # ACHTUNG: -showdestinations gibt ZWEI Listen aus. Unter "Available
  # destinations" steht, womit gebaut werden kann; darunter folgt
  # "Ineligible destinations" -- Geraete, die xcodebuild zwar KENNT, aber
  # gerade nicht bedienen kann (wird vorbereitet, gesperrt, nicht
  # unterstuetzte iOS-Fassung). Wer beide Listen zusammen durchsucht,
  # findet das Geraet und baut trotzdem ins Leere. Genau so ist der
  # Ausweichweg beim ersten Versuch nicht angesprungen: gefunden in der
  # falschen Liste, danach derselbe Abbruch wie zuvor.
  # Darum alles ab "Ineligible" abschneiden -- dieselbe Vorsicht wie beim
  # Abschneiden der Simulatoren weiter oben.
  if [ -n "$GESUCHT" ] \
     && xcodebuild "$@" -showdestinations 2>/dev/null \
        | awk '/[Ii]neligible destinations/ { exit } { print }' \
        | grep -q "$GESUCHT"; then
    echo "id=$GESUCHT"
  else
    echo "generic/platform=iOS"
  fi
}

BAUZIEL="$(bau_ziel_waehlen "$UDID" "${ZIEL[@]}" "${WIE[@]}")"
if [ "$BAUZIEL" = "generic/platform=iOS" ]; then
  echo "        xcodebuild sieht dieses iPhone gerade nicht --"
  echo "        es wird allgemein fuer iOS gebaut und danach ueber devicectl"
  echo "        installiert. Haeufigster Grund: Xcode bereitet das Geraet nach"
  echo "        einem iOS-Update noch vor (Fenster \"Devices and Simulators\")."
fi

# -allowProvisioningUpdates laesst Xcode ein fehlendes Bereitstellungs-
# profil selbst anlegen, statt den Bau abzubrechen.
xcodebuild \
  "${ZIEL[@]}" \
  "${WIE[@]}" \
  -configuration Debug \
  -destination "$BAUZIEL" \
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
xcrun devicectl device install app --device "$DEVCTL" "$APP"
echo "        starten"
xcrun devicectl device process launch --device "$DEVCTL" "$APPID"

echo ""
echo "Fertig. Die App laeuft auf dem iPhone."
