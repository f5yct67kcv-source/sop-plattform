#!/bin/bash
# Holt den neuesten Stand, baut die App und startet sie auf dem
# angeschlossenen Android-Telefon -- Gegenstueck zu aufs-handy.sh (iPhone).
#
#     ./aufs-android.sh              aktuellen Zweig verwenden
#     ./aufs-android.sh main         vorher auf main wechseln
#     ./aufs-android.sh main sauber  zusaetzlich den Gradle-Bau leeren
#
# Einmalig vorher (siehe Ende dieser Datei, "EINRICHTEN"):
#   Android Studio installieren, am Telefon USB-Debugging einschalten.
#
# Die Reihenfolge ist dieselbe wie beim iPhone und aus demselben Grund
# fest: Wer das Buendel vergisst, baut die alte Oberflaeche -- der Bau
# gelingt, die Aenderung fehlt, und man sucht sie im falschen Code.
set -euo pipefail

ZWEIG="${1:-$(git rev-parse --abbrev-ref HEAD)}"
SAUBER="${2:-}"

cd "$(dirname "$0")"

# Jede Meldung, die man nicht verpassen darf, wird gesammelt und ganz am
# Schluss wiederholt -- mitten im Gradle-Text liest sie niemand (dieselbe
# Erfahrung wie beim fehlenden Maps-Schluessel in aufs-handy.sh).
WARNUNGEN=""
warnen() {
  echo "        $1"
  WARNUNGEN="${WARNUNGEN}${WARNUNGEN:+
}$1"
}

# Nur beiseitelegen, was Git schon kennt -- nie unversionierte Dateien.
# Begruendung bei lokale_aenderungen_sichern() in aufs-handy.sh: Dort hat
# "stash -u" zweimal eine von Hand abgelegte Schluesseldatei eingesammelt.
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

# Hat der Pull dieses Skript geaendert, mit der neuen Fassung neu starten.
# bash liest Skripte haeppchenweise; eine unter ihm geaenderte Datei wird
# sonst mitten in einer Zeile weitergelesen (siehe aufs-handy.sh).
if [ "$(cksum < "$0")" != "$SKRIPT_VORHER" ] && [ "${AUFS_ANDROID_NEUSTART:-}" != "1" ]; then
  echo "        Das Skript selbst wurde erneuert -- Neustart mit der neuen Fassung"
  export AUFS_ANDROID_NEUSTART=1
  exec "$0" "$@"
fi

echo "── 1b/5 Android-Werkzeuge suchen"
# Welches Java gebaut wird, entscheidet die FASSUNG, nicht der Fundort.
#
# ANLASS: Beim ersten Lauf am Mac des Projektinhabers brach Gradle mit
# "Unsupported class file major version 69" ab -- das ist Java 25. Das
# Skript hatte ein schon gesetztes JAVA_HOME unbesehen uebernommen. Die
# Meldung klingt nicht nach Java, und genau darum wird hier vorher
# geprueft statt nachher gerätselt.
#
# Die Grenzen kommen von der Gradle-Fassung im Wrapper
# (android/gradle/wrapper/gradle-wrapper.properties, 8.14): Sie laeuft mit
# Java 17 bis 24. Wer Gradle hebt, hebt auch JAVA_MAX.
JAVA_MIN=17
JAVA_MAX=24

# Hauptfassung eines Java-Ordners, z. B. 21 -- leer, wenn dort keines ist.
# "1.8.0_x" (Java 8) wird zu 8, "25.0.1" zu 25.
java_hauptversion() {
  [ -x "$1/bin/java" ] || { echo ""; return; }
  "$1/bin/java" -version 2>&1 | head -1 \
    | sed -n 's/.*version "\([0-9]*\)\.\{0,1\}\([0-9]*\).*/\1 \2/p' \
    | awk '{ print ($1 == 1 ? $2 : $1) }'
}

# Den ersten passenden Java-Ordner aus den Kandidaten nennen. Android
# Studios eigenes Java zuerst (dafuer ist es da), ein gesetztes JAVA_HOME
# danach, dann was macOS sonst kennt.
java_waehlen() {
  local k v
  for k in "$@"; do
    [ -n "$k" ] || continue
    v="$(java_hauptversion "$k")"
    [ -n "$v" ] || continue
    if [ "$v" -ge "$JAVA_MIN" ] && [ "$v" -le "$JAVA_MAX" ]; then
      echo "$k"; return
    fi
  done
  echo ""
}

JAVA_KANDIDATEN=(
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  "${JAVA_HOME:-}"
)
if [ -x /usr/libexec/java_home ]; then
  for v in 21 17 24 23 22; do
    JAVA_KANDIDATEN+=("$(/usr/libexec/java_home -v "$v" 2>/dev/null || true)")
  done
fi
for k in /Library/Java/JavaVirtualMachines/*/Contents/Home; do
  JAVA_KANDIDATEN+=("$k")
done
GEWAEHLT="$(java_waehlen "${JAVA_KANDIDATEN[@]}")"

if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  echo ""
  echo "  Kein Android-SDK unter ~/Library/Android/sdk."
  echo "  Android Studio einmal oeffnen und den Einrichtungs-Assistenten"
  echo "  durchlaufen lassen -- er laedt das SDK. Danach erneut starten."
  exit 1
fi
if [ -z "$GEWAEHLT" ]; then
  echo ""
  echo "  Kein passendes Java gefunden (gebraucht: $JAVA_MIN bis $JAVA_MAX)."
  for k in "${JAVA_KANDIDATEN[@]}"; do
    v="$(java_hauptversion "$k")"
    [ -n "$v" ] && echo "    gefunden, aber Java $v: $k"
  done
  echo ""
  echo "  Abhilfe: Java 21 dazu installieren -- es ersetzt nichts, das"
  echo "  vorhandene bleibt, wie es ist:"
  echo "      brew install --cask temurin@21"
  echo "  (ohne Homebrew: adoptium.net, \"Temurin 21\", macOS-Paket)"
  echo "  Danach dieses Skript erneut starten."
  exit 1
fi
if [ "${JAVA_HOME:-}" != "$GEWAEHLT" ] && [ -n "${JAVA_HOME:-}" ]; then
  echo "        JAVA_HOME zeigt auf Java $(java_hauptversion "$JAVA_HOME") -- fuer diesen Bau"
  echo "        wird stattdessen Java $(java_hauptversion "$GEWAEHLT") genommen (nur hier, sonst unveraendert)"
fi
export JAVA_HOME="$GEWAEHLT"
echo "        Java $(java_hauptversion "$JAVA_HOME"): $JAVA_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"
if [ ! -x "$ADB" ]; then
  echo ""
  echo "  adb fehlt ($ADB)."
  echo "  In Android Studio: Settings > Languages & Frameworks > Android SDK >"
  echo "  SDK Tools > \"Android SDK Platform-Tools\" anhaken."
  exit 1
fi
echo "        Java und SDK vorhanden"

echo "── 2/5  Buendel erzeugen"
python3 mobile-buendel-erstellen.py

# Schluessel aus einer Datei, die Git nie mitnimmt, ins Buendel setzen.
# Gleiche Pruefungen wie in aufs-handy.sh (AIza..., Mindestlaenge) --
# jede davon geht auf einen Platzhalter zurueck, der wirklich im Buendel
# gelandet ist. test_deploy.mjs fuehrt diese Funktion in beiden Skripten
# aus.
maps_schluessel_einsetzen() {
  ZIEL="$1"
  QUELLE="${2:-mobile/.maps-key}"
  PLATZ="${3:-__MAPS_JS_KEY__}"
  KEY=""
  [ -f "$QUELLE" ] && KEY="$(tr -d '[:space:]' < "$QUELLE")"
  GRUND=""
  if [ ! -f "$QUELLE" ]; then GRUND="$QUELLE fehlt"
  elif [ -z "$KEY" ]; then GRUND="$QUELLE ist leer"
  else
    case "$KEY" in
      AIza*) [ "${#KEY}" -ge 30 ] || GRUND="der Schluessel in $QUELLE ist zu kurz" ;;
      *) GRUND="$QUELLE enthaelt keinen Schluessel (ein Schluessel von Google beginnt mit AIza)" ;;
    esac
  fi
  if [ -n "$GRUND" ]; then
    warnen "KEINE Karte: $GRUND ($PLATZ steht noch im Buendel)."
    echo "        Die Rundgang-Karte bleibt auf dem Telefon leer, alles andere laeuft."
    echo "        Abhilfe: den Schluessel einmal ablegen, Git nimmt die Datei nie mit:"
    echo "            printf '%s' 'DEIN_SCHLUESSEL' > $QUELLE"
    return 0
  fi
  if sed --version >/dev/null 2>&1; then
    LC_ALL=C sed -i "s|$PLATZ|$KEY|g" "$ZIEL"
  else
    LC_ALL=C sed -i '' "s|$PLATZ|$KEY|g" "$ZIEL"
  fi
  echo "        Maps-Schluessel eingesetzt ($PLATZ)"
}

# Das versionierte Buendel nach dem Lauf zuruecksetzen, auch bei Abbruch
# (OP-608): Sonst steht ein echter Schluessel im Arbeitsbaum, und
# test_php.mjs ist rot, bis jemand die Datei von Hand zuruecksetzt.
BUENDEL_DATEI="$PWD/mobile/www/index.html"
BUENDEL_KOPIE=""
buendel_sichern() {
  BUENDEL_KOPIE="$(mktemp)"
  cp "$BUENDEL_DATEI" "$BUENDEL_KOPIE"
}
buendel_zuruecksetzen() {
  if [ -n "$BUENDEL_KOPIE" ] && [ -f "$BUENDEL_KOPIE" ]; then
    cp "$BUENDEL_KOPIE" "$BUENDEL_DATEI"
    rm -f "$BUENDEL_KOPIE"
    BUENDEL_KOPIE=""
  fi
}
buendel_sichern
trap buendel_zuruecksetzen EXIT INT TERM

maps_schluessel_einsetzen mobile/www/index.html

# Der Schluessel fuer die native Karte. Auf Android liest das Kartenplugin
# ihn aus dem MANIFEST (app/build.gradle setzt ihn dort aus
# mobile/.maps-android-key ein), nicht aus dem JavaScript. app.html fragt
# aber vor dem Aufbau, ob unter __MAPS_IOS_KEY__ ein tauglicher Schluessel
# steht (rgKarteNativMoeglich), und baut sonst gar keine native Karte.
# Darum kommt derselbe Android-Schluessel auch dort hinein -- der Name des
# Platzhalters ist iOS-gepraegt, die Frage dahinter ist "gibt es einen
# nativen Schluessel".
maps_schluessel_einsetzen mobile/www/index.html mobile/.maps-android-key __MAPS_IOS_KEY__
if [ ! -s mobile/.maps-android-key ]; then
  echo "        Der Android-Schluessel gehoert zum \"Maps SDK for Android\" und wird"
  echo "        in der Google-Cloud-Konsole auf Android-Apps eingeschraenkt:"
  echo "            Paketname  ch.guardops.mitarbeiter"
  SHA1="$("$JAVA_HOME/bin/keytool" -list -v -keystore "$HOME/.android/debug.keystore" \
    -alias androiddebugkey -storepass android 2>/dev/null | sed -n 's/^[[:space:]]*SHA1:[[:space:]]*//p' | head -1 || true)"
  if [ -n "$SHA1" ]; then
    echo "            SHA-1      $SHA1   (dieser Mac, Testbau)"
  else
    echo "            SHA-1      erscheint hier nach dem ersten Bau"
  fi
fi

echo "── 3/5  Nach Android uebertragen"
cd mobile
# Erst installieren, dann uebertragen -- sonst fehlt ein neues Plugin im
# Bau, ohne dass es jemand merkt (siehe aufs-handy.sh, Push-Plugin).
npm install --silent

echo "        Kartenschicht zusammenfassen"
if ! npx --no-install esbuild karte-nativ-eingang.js \
     --bundle --format=iife --global-name=KarteNativ \
     --outfile=www/karte-nativ.js --log-level=warning; then
  echo ""
  echo "  Die Kartenschicht liess sich nicht zusammenfassen."
  echo "  Meist hilft: cd mobile && rm -rf node_modules && npm install"
  exit 1
fi

npx cap sync android
buendel_zuruecksetzen
echo "        Buendel zurueckgesetzt (Schluessel nur noch im Android-Bau)"

# Push ist auf Android vorerst bewusst NICHT dabei (capacitor.config.json,
# android.includePlugins): Ohne Firebase-Datei stuerzte die App beim Start
# ab. Kommt mit dem FCM-Schritt (ENT-604, zweiter Bauabschnitt).
warnen "Push ist in der Android-App noch nicht eingebaut (folgt mit Firebase)."

cd android
if [ "$SAUBER" = "sauber" ]; then
  echo "── 3b/5 Gradle-Bau leeren"
  ./gradlew clean -q
fi

echo "── 4/5  Telefon suchen"
"$ADB" start-server >/dev/null 2>&1 || true
GERAETE="$("$ADB" devices | sed '1d' | grep -v '^[[:space:]]*$' || true)"
BEREIT="$(printf '%s\n' "$GERAETE" | awk '$2=="device"{print $1}' | head -1)"
if [ -z "$BEREIT" ]; then
  echo ""
  if printf '%s\n' "$GERAETE" | grep -q 'unauthorized'; then
    echo "  Das Telefon ist angeschlossen, hat diesem Mac aber noch nicht vertraut."
    echo "  Am Telefon die Frage \"USB-Debugging zulassen?\" bestaetigen"
    echo "  (\"Von diesem Computer immer zulassen\" anhaken) und neu starten."
  else
    echo "  Kein Android-Telefon gefunden."
    echo "  Per USB anschliessen und am Telefon USB-Debugging einschalten"
    echo "  (siehe EINRICHTEN am Ende dieser Datei)."
  fi
  exit 1
fi
echo "        gefunden: $("$ADB" -s "$BEREIT" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"

echo "── 5/5  Bauen und starten"
ANDROID_SERIAL="$BEREIT" ./gradlew installDebug -q
"$ADB" -s "$BEREIT" shell am start -n ch.guardops.mitarbeiter/.MainActivity >/dev/null
echo "        Die App laeuft auf dem Telefon."

if [ -n "$WARNUNGEN" ]; then
  echo ""
  echo "  Bitte beachten:"
  printf '%s\n' "$WARNUNGEN" | sed 's/^/    - /'
fi

# ── EINRICHTEN (einmalig) ─────────────────────────────────────────────
#
# Mac:
#   1. Android Studio installieren: developer.android.com/studio
#   2. Einmal oeffnen, "Standard"-Einrichtung durchlaufen lassen (laedt SDK
#      und Platform-Tools). Ein Projekt muss dafuer nicht geoeffnet werden.
#
# Telefon:
#   1. Einstellungen > Telefoninfo > 7x auf "Build-Nummer" tippen
#      (bei Samsung: Telefoninfo > Softwareinformationen > Buildnummer).
#   2. Einstellungen > System > Entwickleroptionen > "USB-Debugging" an.
#   3. Per USB an den Mac, Frage "USB-Debugging zulassen?" bestaetigen.
#
# Danach reicht:  ./aufs-android.sh main
