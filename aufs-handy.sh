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

# Angefangene Arbeit beiseitelegen, damit "git pull" durchkommt -- aber
# NUR, was Git schon kennt.
#
# Hier stand einmal "git stash push -u", also samt unversionierter Dateien.
# Das hat zweimal echten Schaden angerichtet: Es hat die Xcode-Team-
# Einstellung des Projektinhabers eingesammelt und spaeter seine frisch
# angelegte Datei mit dem Maps-Schluessel. Beide Male war die Datei in
# .gitignore eingetragen -- aber der Eintrag kam mit dem Stand, der gerade
# erst geholt werden sollte. VOR dem Pull war sie fuer Git schlicht eine
# unversionierte Datei.
#
# Daraus die Regel: Was Git nicht verwaltet, fasst dieses Skript nicht an.
# Wer eine Datei von Hand ins Arbeitsverzeichnis legt, darf sich darauf
# verlassen, dass sie dort bleibt. Bricht der Pull deshalb an einer neu
# hinzukommenden Datei ab, sagt das die Meldung von git deutlich genug --
# das ist ein Fall zum Hinsehen, kein Fall zum Wegraeumen.
lokale_aenderungen_sichern() {
  [ -n "$(git status --porcelain --untracked-files=no)" ] || return 0
  git stash push -m "aufs-handy $(date '+%d.%m. %H:%M')" >/dev/null
  echo "        Lokale Aenderungen liegen im Stash (zurueck mit: git stash pop)"
}

echo "── 1/5  Stand holen ($ZWEIG)"
# Der eigene Fingerabdruck VOR dem Holen -- siehe den Neustart unten.
# cksum statt sha256sum/shasum: Die beiden heissen auf macOS und Linux
# verschieden, cksum gibt es ueberall. Es geht hier nur um "gleich oder
# nicht", nicht um Faelschungssicherheit.
SKRIPT_VORHER="$(cksum < "$0")"
lokale_aenderungen_sichern
git fetch origin "$ZWEIG"
git checkout "$ZWEIG"
git pull origin "$ZWEIG"

# Sich selbst neu starten, wenn der Pull dieses Skript geaendert hat.
#
# ANLASS (2026-09-19, vom Projektinhaber am Geraet gemessen): Das Skript
# aktualisiert sich hier selbst -- aber bash fuehrt bereits die ALTE
# Fassung aus, die es beim Start geoeffnet hat. Eine Aenderung am Skript
# wirkte darum erst beim UEBERNAECHSTEN Lauf. Genau so ging das
# Zuruecksetzen des Buendels (OP-608) ins Leere: Der Lauf holte die
# Behebung und lief danach ohne sie weiter.
#
# Schlimmer als wirkungslos ist der zweite Teil: bash liest ein Skript
# haeppchenweise und merkt sich dabei die BYTE-Position. Wird die Datei
# unter ihm laenger oder kuerzer, liest es an der alten Position im neuen
# Text weiter -- mitten in einer Zeile. Was dann ausgefuehrt wird, steht
# so nirgends.
#
# Der Neustart passiert nur, wenn sich wirklich etwas geaendert hat, und
# nur einmal: AUFS_HANDY_NEUSTART verhindert eine Schleife, falls zwei
# Faelle zugleich zutreffen.
if [ "$(cksum < "$0")" != "$SKRIPT_VORHER" ] && [ "${AUFS_HANDY_NEUSTART:-}" != "1" ]; then
  echo "        Das Skript selbst wurde erneuert -- Neustart mit der neuen Fassung"
  export AUFS_HANDY_NEUSTART=1
  exec "$0" "$@"
fi

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
# Was am Ende noch einmal gesagt werden muss.
#
# Eine Warnung mitten im Bau liest niemand: Danach laufen Hunderte Zeilen
# von xcodebuild durch, und oben steht dann etwas Wichtiges, das niemand
# mehr sucht. Genau so ist der fehlende Maps-Schluessel untergegangen --
# der Projektinhaber hat eine App ohne Karte auf dem Telefon gehabt und
# nicht gewusst, warum. Darum wird jede solche Meldung hier gesammelt und
# ganz zum Schluss wiederholt, wo der Blick ohnehin hinfaellt.
WARNUNGEN=""
warnen() {
  echo "        $1"
  WARNUNGEN="${WARNUNGEN}${WARNUNGEN:+
}$1"
}

maps_schluessel_einsetzen() {
  ZIEL="$1"
  QUELLE="${2:-mobile/.maps-key}"
  PLATZ="${3:-__MAPS_JS_KEY__}"
  if [ ! -f "$QUELLE" ]; then
    # Frueher schwieg dieser Zweig. Die App landete dann mit dem Platzhalter
    # statt eines Schluessels auf dem Geraet, Google lehnte ihn ab, und in
    # der laufenden Runde stand statt der Karte eine graue Tafel --
    # gemeldet vom Projektinhaber. Ein uebersprungener Schritt darf nicht
    # wie ein gelungener aussehen (CLAUDE.md).
    warnen "KEINE Karte: $QUELLE fehlt ($PLATZ steht noch im Buendel)."
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
    warnen "KEINE Karte: $QUELLE ist leer ($PLATZ steht noch im Buendel)."
    echo "        Die Rundgang-Karte bleibt auf dem Geraet leer, alles andere laeuft."
    return 0
  fi
  # Sieht das ueberhaupt nach einem Schluessel aus?
  #
  # Der Grund ist ein echter Vorfall: In der Anleitung stand eine fertige
  # Befehlszeile mit einem erfundenen Wert darin, und genau der landete
  # danach im Buendel ("DER_NEUE_SCHLUESSEL"). Google lehnte ihn ab, die
  # Karte blieb grau, und weder Skript noch App sagten warum -- fuer beide
  # war ja "ein Schluessel da". Dasselbe war vorher schon einmal mit der
  # Xcode-Team-Kennung passiert.
  #
  # Ein Schluessel von Google beginnt mit AIza und ist deutlich laenger als
  # 30 Zeichen. Das ist keine Echtheitspruefung -- ein falscher Schluessel
  # dieser Form kommt hier durch. Es faengt nur den Fall ab, in dem
  # offensichtlich gar kein Schluessel eingetragen wurde.
  case "$KEY" in
    AIza*) ;;
    *)
      warnen "KEINE Karte: $QUELLE enthaelt keinen Schluessel ($PLATZ steht noch im Buendel)."
      echo "        Gefunden: ${KEY%"${KEY#??????????}"}... -- ein Schluessel von Google"
      echo "        beginnt mit AIza. Sieht nach einem Platzhalter aus dem Text aus."
      echo "        Den echten Wert gibt es in der Google-Cloud-Konsole beim"
      echo "        Schluessel unter \"Schluessel anzeigen\"."
      return 0 ;;
  esac
  if [ "${#KEY}" -lt 30 ]; then
    warnen "KEINE Karte: der Schluessel in $QUELLE ist zu kurz ($PLATZ steht noch im Buendel)."
    return 0
  fi
  # LC_ALL=C, weil sed auf macOS sonst bei nicht-ASCII im Dateiinhalt
  # aussteigt ("illegal byte sequence"). Das leere Argument nach -i ist
  # die BSD-Schreibweise fuer "keine Sicherungskopie".
  if sed --version >/dev/null 2>&1; then
    LC_ALL=C sed -i "s|$PLATZ|$KEY|g" "$ZIEL"
  else
    LC_ALL=C sed -i '' "s|$PLATZ|$KEY|g" "$ZIEL"
  fi
  echo "        Maps-Schluessel eingesetzt ($PLATZ)"
}

# Das Buendel VOR dem ersten Schluessel absichern (OP-608).
#
# mobile/www/index.html ist versioniert -- anders als die Kopien unter
# mobile/ios/.../public/ und mobile/android/.../public/, die in
# .gitignore stehen. Gleich werden zwei echte Google-Schluessel
# hineingeschrieben. Bliebe die Datei so liegen, stuende der Schluessel
# danach im Arbeitsbaum: Ein "git add -A" traegt ihn ins Repository, und
# test_php.mjs vergleicht die Datei Zeichen fuer Zeichen mit app.html --
# die Regression waere nach jedem Geraetelauf rot.
#
# Darum wird sie am Ende des Laufs zurueckgesetzt, und zwar per trap:
# auch dann, wenn der Bau dazwischen abbricht oder jemand Strg-C drueckt.
# Was zurueckgesetzt wird, ist nur die Schluessel-Ersetzung --
# mobile-buendel-erstellen.py hat die Datei kurz davor ohnehin frisch aus
# app.html erzeugt.
# Zurueckgesetzt wird aus einer KOPIE, die hier entsteht -- nicht per
# "git checkout" und nicht durch erneutes Erzeugen. Beides waere ungenau:
# Ein checkout verwuerfe auch eine berechtigte Neuerzeugung (etwa wenn
# app.html geaendert wurde), ein zweiter Lauf des Erzeugers braeuchte
# ihn erst recht. Die Kopie gibt genau den Stand zurueck, der vor der
# Ersetzung da war, und sonst nichts.
#
# Seit ENT-696 sind es zwei Dateien: Der Software-Stand wird auch in
# mobile/www/dashboard.html eingesetzt (Cockpit in der Huelle), und auch
# sie ist versioniert und wird von test_php.mjs mit dem Original
# verglichen. Darum sichert und setzt diese Stelle beide zurueck.
BUENDEL_DATEIEN=("$PWD/mobile/www/index.html" "$PWD/mobile/www/dashboard.html")
BUENDEL_KOPIEN=""
buendel_sichern() {
  BUENDEL_KOPIEN="$(mktemp -d)"
  local i
  for i in "${!BUENDEL_DATEIEN[@]}"; do
    cp "${BUENDEL_DATEIEN[$i]}" "$BUENDEL_KOPIEN/$i"
  done
}
buendel_zuruecksetzen() {
  if [ -n "$BUENDEL_KOPIEN" ] && [ -d "$BUENDEL_KOPIEN" ]; then
    local i
    for i in "${!BUENDEL_DATEIEN[@]}"; do
      [ -f "$BUENDEL_KOPIEN/$i" ] && cp "$BUENDEL_KOPIEN/$i" "${BUENDEL_DATEIEN[$i]}"
    done
    rm -rf "$BUENDEL_KOPIEN"
    BUENDEL_KOPIEN=""
  fi
}
buendel_sichern
trap buendel_zuruecksetzen EXIT INT TERM

# Software-Stand (ENT-696). Dasselbe, was der Web-Deploy in dashboard.html
# und app.html einsetzt -- hier fuer die App, die nicht ueber den Deploy
# laeuft. Datum des Commits in Zuercher Zeit und seine Kurzkennung.
#
# "+ lokal geaendert", wenn der Arbeitsbaum ungesicherte Aenderungen
# traegt: Dann baut dieser Lauf etwas, das es in keinem Commit gibt, und
# die Kennung allein wuerde das Gegenteil behaupten. Ausgenommen sind die
# Ordner, die der Bau selbst beschreibt (mobile/www, mobile/ios,
# mobile/android) -- sonst truege JEDER Bau den Zusatz, auch ein sauberer.
# Neue, noch nie hinzugefuegte Dateien zaehlen nicht: Was nirgends
# eingebunden ist, landet auch nicht in der App.
stand_einsetzen() {
  local datum kurz stand f
  datum="$(TZ=Europe/Zurich git log -1 --date=format-local:%Y-%m-%d --format=%cd)"
  kurz="$(git rev-parse --short=7 HEAD)"
  stand="$datum · $kurz"
  if [ -n "$(git status --porcelain --untracked-files=no -- . \
        ':(exclude)mobile/www' ':(exclude)mobile/ios' ':(exclude)mobile/android')" ]; then
    stand="$stand + lokal geändert"
  fi
  # "-i.standalt" statt "-i" / "-i ''": Das einzige Muster, das GNU- und
  # BSD-sed (macOS) gleich verstehen.
  for f in "$@"; do
    LC_ALL=C sed -i.standalt "s|%%APP_STAND%%|$stand|g" "$f"
    rm -f "$f.standalt"
  done
  echo "        Stand: $stand"
}
stand_einsetzen mobile/www/index.html mobile/www/dashboard.html

maps_schluessel_einsetzen mobile/www/index.html

# Der zweite Schluessel, fuer die NATIVE Karte (ENT-609). Bewusst ein
# anderer: Dieser ist auf die Bundle-ID und das Maps-SDK eingeschraenkt,
# der obige auf die Web-Adresse und die JavaScript-API. In der App wird
# der native gebraucht -- eine Website-Einschraenkung kann dort nach
# Googles eigener Dokumentation gar nicht greifen, weil die WebView beim
# Laden aus dem Buendel keinen Referrer mitschickt.
maps_schluessel_einsetzen mobile/www/index.html mobile/.maps-ios-key __MAPS_IOS_KEY__

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

# Die Kartenschicht des Plugins zu EINER Datei zusammenfassen (ENT-609).
#
# Muss nach npm install laufen (die Quelle liegt in node_modules) und vor
# cap sync (das Ergebnis gehoert ins Buendel, das dort kopiert wird).
#
# Warum ueberhaupt: app.html ist eine einzelne Datei ohne Buendler und
# spricht Plugins sonst ueber window.Capacitor.Plugins an. Fuer die Karte
# genuegt das nicht -- siehe Kopf von karte-nativ-eingang.js.
echo "        Kartenschicht zusammenfassen"
if ! npx --no-install esbuild karte-nativ-eingang.js \
     --bundle --format=iife --global-name=KarteNativ \
     --outfile=www/karte-nativ.js --log-level=warning; then
  echo ""
  echo "  Die Kartenschicht liess sich nicht zusammenfassen."
  echo "  Ohne sie bleibt die Karte in der Runde leer, alles andere laeuft."
  echo "  Meist hilft: cd mobile && rm -rf node_modules && npm install"
  exit 1
fi

npx cap sync ios

# Der Schluessel ist jetzt in den (ignorierten) Kopien unter ios/ --
# im versionierten Buendel wird er nicht mehr gebraucht (OP-608). Der
# trap oben bleibt trotzdem stehen: Er faengt die Abbrueche VOR dieser
# Zeile ab.
buendel_zuruecksetzen
echo "        Buendel zurueckgesetzt (Schluessel nur noch im iOS-Bau)"

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

# Fuer devicectl.
#
# Die Tabelle fuehrt eine Spalte "State", und die ist nicht nebensaechlich:
# "connected" heisst erreichbar, "available (paired)" heisst nur bekannt --
# das Telefon war schon einmal da. Wer den Unterschied uebergeht, bekommt
# eine Kennung, die spaeter beim Installieren an
# "CoreDeviceService was unable to locate a device" scheitert. Genau so
# gemeldet vom Projektinhaber: Der Bau lief durch, und erst das
# Installieren fiel um.
#
# Darum wird das verbundene Geraet bevorzugt und der Zustand mitgefuehrt,
# statt ihn wegzuwerfen. Als Funktion, damit sich das ohne angeschlossenes
# iPhone pruefen laesst.
geraet_waehlen() {
  awk '
    /Identifier/ { next }
    {
      pos = 0
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/) { pos = i }
      }
      if (pos == 0) { next }
      # Zwischen Kennung und Modell (letzte Spalte) steht der Zustand.
      zustand = ""
      for (i = pos + 1; i < NF; i++) { zustand = zustand (zustand == "" ? "" : " ") $i }
      if (zustand == "") { zustand = "unbekannt" }
      if (zustand ~ /connected/ && verbunden == "") { verbunden = $pos; vz = zustand }
      if (ersatz == "") { ersatz = $pos; ez = zustand }
    }
    END {
      if (verbunden != "") { print verbunden "\t" vz }
      else if (ersatz != "") { print ersatz "\t" ez }
    }'
}

GERAET="$(xcrun devicectl list devices 2>/dev/null | grep -i "iPhone" | geraet_waehlen || true)"
DEVCTL="${GERAET%%	*}"
ZUSTAND="${GERAET#*	}"
[ "$ZUSTAND" = "$DEVCTL" ] && ZUSTAND=""

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
case "$ZUSTAND" in
  *connected*) echo "        Zustand: ${ZUSTAND}" ;;
  "")          echo "        Zustand: unbekannt -- das Installieren kann scheitern" ;;
  *)           echo "        Zustand: ${ZUSTAND} -- NICHT verbunden."
               echo "        Das iPhone ist bekannt, aber gerade nicht erreichbar."
               echo "        Der Bau laeuft trotzdem; scheitert das Installieren,"
               echo "        liegt es daran: Kabel einstecken, Bildschirm entsperren"
               echo "        und die Frage \"Diesem Computer vertrauen?\" bestaetigen." ;;
esac

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
if ! xcrun devicectl device install app --device "$DEVCTL" "$APP"; then
  echo ""
  echo "  Die App ist gebaut, aber nicht auf dem Telefon gelandet."
  echo "  devicectl kommt an dieses Geraet gerade nicht heran"
  [ -n "$ZUSTAND" ] && echo "  (zuletzt gemeldeter Zustand: ${ZUSTAND})"
  echo ""
  echo "  Der Reihe nach durchgehen:"
  echo "    1. Kabel direkt am Mac, nicht ueber einen Hub"
  echo "    2. Bildschirm entsperren -- ein gesperrtes iPhone nimmt nichts an"
  echo "    3. \"Diesem Computer vertrauen?\" bestaetigen, falls die Frage kommt"
  echo "    4. Einstellungen > Datenschutz & Sicherheit > Entwicklermodus: ein"
  echo "    5. Xcode: Window > Devices and Simulators -- steht dort"
  echo "       \"Preparing iPhone for development\", erst abwarten"
  echo ""
  echo "  Was devicectl gerade sieht:"
  xcrun devicectl list devices 2>&1 | sed 's/^/    /'
  echo ""
  echo "  Der Bau bleibt erhalten. Danach genuegt ein erneuter Lauf."
  exit 1
fi
echo "        starten"
if ! xcrun devicectl device process launch --device "$DEVCTL" "$APPID"; then
  echo ""
  echo "  Die App ist installiert, laesst sich aber nicht starten."
  echo "  Fast immer ist es dasselbe: Ein selbst signiertes Programm muss auf"
  echo "  dem Geraet einmal ausdruecklich freigegeben werden. iOS meldet das"
  echo "  als \"invalid code signature, inadequate entitlements or its profile"
  echo "  has not been explicitly trusted\" -- gemeint ist meist das Letzte."
  echo ""
  echo "  Am iPhone:"
  echo "    Einstellungen > Allgemein > VPN & Geraeteverwaltung"
  echo "    > unter \"Entwickler-App\" den eigenen Eintrag > Vertrauen"
  echo ""
  echo "  Danach die App vom Homescreen starten. Dieses Skript muss dafuer"
  echo "  NICHT noch einmal laufen -- sie liegt schon auf dem Geraet."
  echo ""
  echo "  Die Frage kommt auch dann wieder, wenn sich die Berechtigungen der"
  echo "  App geaendert haben: Fuer iOS ist sie dann nicht mehr dieselbe."
  exit 1
fi

echo ""
echo "Fertig. Die App laeuft auf dem iPhone."
if [ -n "$WARNUNGEN" ]; then
  echo ""
  echo "  ABER -- das fehlt in dieser Fassung:"
  printf '%s\n' "$WARNUNGEN" | sed 's/^/    /'
  echo ""
  echo "  Alles andere laeuft. Wer das behebt, laesst dieses Skript einfach"
  echo "  noch einmal laufen."
fi
