#!/bin/bash
# Holt den neuesten Stand, baut die Android-App und startet sie -- auf einem
# angeschlossenen Android-Telefon oder, wenn keines da ist, im Emulator.
# Das Gegenstueck zu aufs-handy.sh (iOS), ohne einen Klick in Android Studio
# (ENT-715).
#
#     ./aufs-android.sh              aktuellen Zweig verwenden
#     ./aufs-android.sh main         vorher auf main wechseln
#     ./aufs-android.sh main sauber  zusaetzlich die Bauteile von Gradle leeren
#
# EINMAL VORHER NOETIG (steht auch in 04-gate4-entwicklung/android-einrichtung.md
# im Projekt-Repository):
#   1. Android Studio installiert und einmal gestartet -- es bringt Java,
#      das SDK, adb und den Emulator mit.
#   2. Im Geraete-Manager von Android Studio ein virtuelles Geraet angelegt
#      (fuer den Emulator), ODER ein Telefon mit eingeschaltetem
#      USB-Debugging angeschlossen.
#   3. mobile/android/app/google-services.json aus der Firebase-Konsole
#      abgelegt. OHNE diese Datei baut das Skript NICHT -- Begruendung
#      unten bei Schritt 1b.
#
# Die Reihenfolge ist dieselbe wie bei iOS und aus demselben Grund fest:
# Wer das Buendel vergisst, baut die alte Oberflaeche -- der Bau gelingt,
# die Aenderung fehlt, und man sucht sie im falschen Code.
set -euo pipefail

ZWEIG="${1:-$(git rev-parse --abbrev-ref HEAD)}"
SAUBER="${2:-}"

cd "$(dirname "$0")"

# Was am Ende noch einmal gesagt werden muss -- dieselbe Lehre wie in
# aufs-handy.sh: Eine Warnung mitten in Hunderten Zeilen Gradle liest
# niemand.
WARNUNGEN=""
warnen() {
  echo "        $1"
  WARNUNGEN="${WARNUNGEN}${WARNUNGEN:+
}$1"
}

# ── Werkzeuge ─────────────────────────────────────────────────────────
# Android Studio legt SDK und Java an festen Orten ab, setzt aber keine
# Umgebungsvariablen. Gesucht wird darum zuerst dort, wo es sie hinlegt;
# was schon gesetzt ist, gewinnt.
sdk_finden() {
  for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
           "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
    [ -n "$d" ] && [ -x "$d/platform-tools/adb" ] && { echo "$d"; return 0; }
  done
  return 1
}
java_finden() {
  for d in "${JAVA_HOME:-}" \
           "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
           "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
           "/opt/android-studio/jbr"; do
    [ -n "$d" ] && [ -x "$d/bin/java" ] && { echo "$d"; return 0; }
  done
  return 1
}

# Wie aufs-handy.sh: nur sichern, was Git schon kennt -- nie eine
# unversionierte Datei wie google-services.json oder den Maps-Schluessel.
lokale_aenderungen_sichern() {
  [ -n "$(git status --porcelain --untracked-files=no)" ] || return 0
  git stash push -m "aufs-android $(date '+%d.%m. %H:%M')" >/dev/null
  echo "        Lokale Aenderungen liegen im Stash (zurueck mit: git stash pop)"
}

echo "── 1/5  Stand holen ($ZWEIG)"
SKRIPT_VORHER="$(cksum < "$0")"
lokale_aenderungen_sichern
git fetch origin "$ZWEIG"
git checkout "$ZWEIG"
git pull origin "$ZWEIG"
# Neustart, wenn der Pull dieses Skript geaendert hat -- Begruendung
# ausfuehrlich in aufs-handy.sh (bash liest ein Skript haeppchenweise und
# liefe sonst in der alten Fassung oder mitten in einer Zeile der neuen).
if [ "$(cksum < "$0")" != "$SKRIPT_VORHER" ] && [ "${AUFS_ANDROID_NEUSTART:-}" != "1" ]; then
  echo "        Das Skript selbst wurde erneuert -- Neustart mit der neuen Fassung"
  export AUFS_ANDROID_NEUSTART=1
  exec "$0" "$@"
fi

echo "── 1b/5 Werkzeuge und Firebase pruefen"
if ! SDK="$(sdk_finden)"; then
  echo ""
  echo "  Kein Android-SDK gefunden."
  echo "  Android Studio installieren und einmal starten -- der Einrichtungs-"
  echo "  assistent laedt das SDK nach ~/Library/Android/sdk. Liegt es woanders,"
  echo "  vor dem Aufruf ANDROID_HOME auf den Ordner setzen."
  exit 1
fi
export ANDROID_HOME="$SDK"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
echo "        SDK: $SDK"

if ! JH="$(java_finden)"; then
  echo ""
  echo "  Kein Java gefunden. Android Studio bringt eines mit; liegt es nicht"
  echo "  unter /Applications, vor dem Aufruf JAVA_HOME setzen."
  exit 1
fi
export JAVA_HOME="$JH"
# Capacitor 8 verlangt Java 21. Ein aelteres bricht erst tief im Bau mit
# "invalid source release: 21" ab -- darum hier vorher und mit Klartext.
JAVA_HAUPT="$("$JAVA_HOME/bin/java" -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)"
if [ -z "$JAVA_HAUPT" ] || [ "$JAVA_HAUPT" -lt 21 ]; then
  echo ""
  echo "  Java ${JAVA_HAUPT:-?} unter $JAVA_HOME -- gebraucht wird 21 oder neuer."
  echo "  Android Studio aktualisieren oder JAVA_HOME auf dessen jbr-Ordner setzen."
  exit 1
fi
echo "        Java $JAVA_HAUPT: $JAVA_HOME"

# google-services.json ist Pflicht, nicht Kuer.
#
# Ohne die Datei baut Android zwar -- aber die App STUERZT AB, sobald sie
# sich fuer Benachrichtigungen anmeldet (ENT-604). Das Push-Plugin ruft
# dann Firebase auf, Firebase ist nicht eingerichtet, und Capacitor
# wandelt den Fehler in einen Absturz um (Bridge.callPluginMethod:
# "throw new RuntimeException"). Die App fragt beim ersten Start nach der
# Erlaubnis; wer "Zulassen" tippt, sieht sie verschwinden.
#
# Ein Bau "ohne Push" waere darum kein halber Bau, sondern ein kaputter.
# Die Datei ist kein Geheimnis im engeren Sinn, gehoert aber zu einem
# Firebase-Projekt der Betreiberin und liegt darum nicht im Repository
# (.gitignore) -- dieselbe Ueberlegung wie beim Maps-Schluessel.
GS="mobile/android/app/google-services.json"
if [ ! -f "$GS" ]; then
  echo ""
  echo "  $GS fehlt."
  echo "  Ohne sie stuerzt die App ab, sobald sie Benachrichtigungen anmeldet."
  echo ""
  echo "  Firebase-Konsole > Projekt > Projekteinstellungen > Allgemein >"
  echo "  \"Meine Apps\" > Android-App mit dem Paketnamen"
  echo "      $(python3 -c "import json;print(json.load(open('mobile/capacitor.config.json'))['appId'])")"
  echo "  > google-services.json herunterladen und genau dort ablegen."
  exit 1
fi
# Stimmt der Paketname darin? Eine Datei aus einem anderen Projekt oder
# fuer eine andere App baut klaglos -- und das Geraet bekommt nie ein
# Token, ohne dass irgendwo ein Fehler steht.
if ! python3 - "$GS" <<'PY'
import json, sys
soll = json.load(open('mobile/capacitor.config.json'))['appId']
d = json.load(open(sys.argv[1]))
namen = [c.get('client_info', {}).get('android_client_info', {}).get('package_name')
         for c in d.get('client', [])]
sys.exit(0 if soll in namen else 1)
PY
then
  echo ""
  echo "  $GS gehoert nicht zu dieser App."
  echo "  Gesucht war der Paketname aus capacitor.config.json; die Datei nennt"
  echo "  einen anderen. Die richtige in der Firebase-Konsole herunterladen."
  exit 1
fi
echo "        google-services.json passt zur App"

echo "── 2/5  Buendel erzeugen"
python3 mobile-buendel-erstellen.py

# Zwei Schluessel, wie bei iOS (siehe aufs-handy.sh):
#   mobile/.maps-key          die Browserkarte (JavaScript-API) -- derselbe
#                             wie bei iOS, und nur der Ersatz, falls die
#                             native Karte fehlt
#   mobile/.maps-android-key  die NATIVE Karte (ENT-609, Android: ENT-717).
#                             Ein eigener Schluessel, eingeschraenkt auf den
#                             Paketnamen und den Signatur-Fingerabdruck.
#
# Der native geht an ZWEI Stellen: ins Buendel (__MAPS_NATIV_KEY__, daran
# erkennt app.html, dass die native Karte eingerichtet ist) und ins
# AndroidManifest. Das zweite erledigt Gradle selbst aus derselben Datei
# (app/build.gradle, manifestPlaceholders) -- das Karten-SDK liest den
# Schluessel auf Android NUR dort, nicht aus dem Code.
#
# Das Buendel wird vorher gesichert und am Ende zurueckgesetzt, auch bei
# Abbruch -- Begruendung in aufs-handy.sh (OP-608): sonst stuende der
# Schluessel im Arbeitsbaum, und ein "git add -A" truege ihn ins Repository.
BUENDEL_DATEI="$PWD/mobile/www/index.html"
BUENDEL_KOPIE="$(mktemp)"
cp "$BUENDEL_DATEI" "$BUENDEL_KOPIE"
buendel_zuruecksetzen() {
  if [ -n "$BUENDEL_KOPIE" ] && [ -f "$BUENDEL_KOPIE" ]; then
    cp "$BUENDEL_KOPIE" "$BUENDEL_DATEI"
    rm -f "$BUENDEL_KOPIE"
    BUENDEL_KOPIE=""
  fi
}
trap buendel_zuruecksetzen EXIT INT TERM

# Gibt 0 zurueck, wenn der Schluessel eingesetzt wurde. Dieselbe Formpruefung
# wie in aufs-handy.sh: Ein Schluessel von Google beginnt mit AIza und ist
# laenger als 30 Zeichen. Das faengt Beispieltext aus einer Anleitung ab,
# keinen falschen echten Schluessel.
schluessel_einsetzen() {
  QUELLE="$1"; PLATZ="$2"; WAS="$3"
  K="$( [ -f "$QUELLE" ] && tr -d '[:space:]' < "$QUELLE" || true)"
  case "$K" in
    "")    warnen "KEINE $WAS: $QUELLE fehlt oder ist leer."; return 1 ;;
    AIza*) ;;
    *)     warnen "KEINE $WAS: $QUELLE enthaelt keinen Google-Schluessel (beginnt nicht mit AIza)."; return 1 ;;
  esac
  if [ "${#K}" -lt 30 ]; then warnen "KEINE $WAS: der Schluessel in $QUELLE ist zu kurz."; return 1; fi
  if sed --version >/dev/null 2>&1; then
    LC_ALL=C sed -i "s|$PLATZ|$K|g" "$BUENDEL_DATEI"
  else
    LC_ALL=C sed -i '' "s|$PLATZ|$K|g" "$BUENDEL_DATEI"
  fi
  echo "        $WAS: Schluessel eingesetzt"
}

if schluessel_einsetzen mobile/.maps-key __MAPS_JS_KEY__ "Browserkarte"; then
  # Android laedt die Seite unter https://localhost (server.androidScheme
  # in capacitor.config.json). Ist der Schluessel nur fuer die Web-Adresse
  # freigegeben, lehnt Google ihn dort vermutlich ab -- am Geraet noch
  # nicht gesehen, darum als Hinweis und nicht als Abbruch.
  echo "        Bleibt die Browserkarte grau: den Schluessel in der Google-Cloud-Konsole"
  echo "        zusaetzlich fuer https://localhost/* freigeben."
fi
NATIV_KARTE=0
if schluessel_einsetzen mobile/.maps-android-key __MAPS_NATIV_KEY__ "native Karte"; then
  NATIV_KARTE=1
else
  echo "        Die Runde zeigt dann die Browserkarte -- sofern die eingerichtet ist."
fi

echo "── 3/5  Nach Android uebertragen"
cd mobile
# Erst installieren, dann uebertragen -- sonst fehlt ein neu eingetragenes
# Plugin im nativen Projekt (dieselbe Falle wie bei iOS, siehe aufs-handy.sh).
npm install --silent
# Die Kartenschicht fuer die native Karte zusammenfassen -- dieselbe wie bei
# iOS (Begruendung im Kopf von karte-nativ-eingang.js).
npx --no-install esbuild karte-nativ-eingang.js \
  --bundle --format=iife --global-name=KarteNativ \
  --outfile=www/karte-nativ.js --log-level=warning
npx cap sync android
buendel_zuruecksetzen
echo "        Buendel zurueckgesetzt (Schluessel nur noch im Android-Bau)"

# Jedes Capacitor-Plugin mit Android-Teil muss im Gradle-Projekt stehen --
# geprueft wird die Aussage, nicht ein Name (wie bei iOS).
FEHLEND=""
for pfad in node_modules/@capacitor/*/; do
  [ -f "${pfad}android/build.gradle" ] || continue
  name="$(basename "$pfad")"
  grep -q "capacitor-${name}" android/capacitor.settings.gradle || FEHLEND="$FEHLEND $name"
done
if [ -n "$FEHLEND" ]; then
  echo ""
  echo "  Diese Plugins fehlen im Android-Bau:$FEHLEND"
  echo "  Meist hilft: cd mobile && rm -rf node_modules && npm install"
  exit 1
fi
echo "        Plugins vollstaendig"

echo "── 4/5  Geraet suchen"
# Ein angeschlossenes Telefon geht vor dem Emulator: Nur dort stimmen
# Ortung, Vibration und Benachrichtigungen wirklich (der Emulator hat
# keinen GPS-Empfaenger, er spielt nur Positionen ab).
#
# "adb devices" fuehrt jedes Geraet mit Zustand. "device" heisst bereit;
# "unauthorized" heisst angeschlossen, aber die Frage "USB-Debugging
# zulassen?" am Telefon ist noch nicht beantwortet -- das ist ein eigener
# Fall mit eigenem Handgriff, kein "nichts gefunden".
"$ADB" start-server >/dev/null 2>&1 || true
LISTE="$("$ADB" devices | awk 'NR>1 && NF>=2 {print $1"\t"$2}')"
TELEFON="$(printf '%s\n' "$LISTE" | awk -F'\t' '$2=="device" && $1 !~ /^emulator-/ {print $1; exit}')"
GESPERRT="$(printf '%s\n' "$LISTE" | awk -F'\t' '$2=="unauthorized" {print $1; exit}')"
EMU="$(printf '%s\n' "$LISTE" | awk -F'\t' '$2=="device" && $1 ~ /^emulator-/ {print $1; exit}')"

if [ -n "$TELEFON" ]; then
  ZIEL="$TELEFON"; echo "        Telefon: $ZIEL"
elif [ -n "$GESPERRT" ]; then
  echo ""
  echo "  Ein Telefon ist angeschlossen, hat USB-Debugging aber noch nicht zugelassen."
  echo "  Am Telefon die Frage \"USB-Debugging zulassen?\" mit \"Zulassen\" beantworten,"
  echo "  dann dieses Skript erneut starten."
  exit 1
elif [ -n "$EMU" ]; then
  ZIEL="$EMU"; echo "        Emulator laeuft bereits: $ZIEL"
else
  if [ ! -x "$EMULATOR" ]; then
    echo ""
    echo "  Kein Telefon angeschlossen und kein Emulator installiert."
    echo "  Android Studio > SDK Manager > SDK Tools > \"Android Emulator\" anhaken."
    exit 1
  fi
  # Neuere Fassungen schreiben "INFO | ..."-Zeilen dazwischen; ein
  # AVD-Name enthaelt nie ein Leerzeichen.
  AVD="$("$EMULATOR" -list-avds 2>/dev/null | grep -v ' ' | head -1 || true)"
  if [ -z "$AVD" ]; then
    echo ""
    echo "  Kein Telefon angeschlossen und kein virtuelles Geraet angelegt."
    echo "  Android Studio > Device Manager > \"+\" > ein Pixel mit aktuellem Android."
    exit 1
  fi
  echo "        Emulator \"$AVD\" starten"
  nohup "$EMULATOR" -avd "$AVD" >/dev/null 2>&1 &
  "$ADB" wait-for-device
  # "wait-for-device" kehrt zurueck, sobald adb das Geraet sieht -- lange
  # bevor Android fertig gestartet ist. Ein Installieren in dieser Luecke
  # scheitert mit "Can't find service: package".
  for _ in $(seq 1 120); do
    [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
    sleep 2
  done
  ZIEL="$("$ADB" devices | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1; exit}')"
  [ -n "$ZIEL" ] || { echo "  Der Emulator ist nicht rechtzeitig hochgefahren."; exit 1; }
  echo "        Emulator bereit: $ZIEL"
fi

echo "── 5/5  Bauen, installieren, starten"
cd android
if [ "$SAUBER" = "sauber" ]; then ./gradlew clean --quiet; fi
./gradlew assembleDebug --quiet
APK="app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "  Der Bau meldet Erfolg, aber $APK fehlt."; exit 1; }
APPID="$(python3 -c "import json;print(json.load(open('../capacitor.config.json'))['appId'])")"
echo "        installieren"
"$ADB" -s "$ZIEL" install -r "$APK" >/dev/null
echo "        starten"
"$ADB" -s "$ZIEL" shell am start -n "$APPID/.MainActivity" >/dev/null

# Der Fingerabdruck, auf den der native Schluessel eingeschraenkt werden
# muss. Er gehoert zum Signierschluessel DIESES Rechners (Gradle legt ihn
# beim ersten Bau unter ~/.android an) -- ein anderer Mac, und spaeter die
# Signatur von Google Play, haben je einen eigenen. Steht er nicht in der
# Google-Cloud-Konsole, bleibt die native Karte grau, ohne Fehlermeldung
# in der App. Darum wird er hier bei jedem Lauf genannt.
DEBUG_KS="$HOME/.android/debug.keystore"
if [ "$NATIV_KARTE" = "1" ] && [ -f "$DEBUG_KS" ]; then
  SHA1="$("$JAVA_HOME/bin/keytool" -list -v -keystore "$DEBUG_KS" -alias androiddebugkey \
          -storepass android 2>/dev/null | sed -nE 's/^[[:space:]]*SHA1:[[:space:]]*//p' | head -1 || true)"
  if [ -n "$SHA1" ]; then
    echo "        Fingerabdruck fuer die Einschraenkung des Android-Schluessels:"
    echo "            $APPID  $SHA1"
  fi
fi

echo ""
echo "Fertig. Die App laeuft auf $ZIEL."
if [ -n "$WARNUNGEN" ]; then
  echo ""
  echo "  ABER -- das fehlt in dieser Fassung:"
  printf '%s\n' "$WARNUNGEN" | sed 's/^/    /'
fi
