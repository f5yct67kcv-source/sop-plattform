#!/bin/bash
# Baut die App fuer den App Store und laedt sie zu App Store Connect hoch
# -- ohne einen Klick in Xcode (ENT-732).
#
#     ./store-hochladen.sh            Versionsnummer aus dem Projekt (z. B. 1.0)
#     ./store-hochladen.sh 1.0.1      mit neuer Versionsnummer
#
# Danach erscheint der Build nach etwa 10 bis 30 Minuten in App Store
# Connect unter TestFlight. Zur Pruefung eingereicht wird er dort von Hand
# -- das Skript reicht nichts ein und gibt nichts frei.
#
# VORAUSSETZUNGEN, einmal pro Mac:
#   - Xcode, angemeldet mit der Apple-ID des Teams der pzu consulting gmbh
#     (Xcode > Settings > Accounts). Das Hochladen laeuft ueber genau diese
#     Anmeldung; einen eigenen API-Schluessel braucht es nicht.
#   - mobile/.maps-key und mobile/.maps-ios-key, wie fuer aufs-handy.sh.
#     Fehlt einer, bricht der Lauf ab -- eine App ohne Karte geht nicht in
#     den Store.
#
# WARUM ES aufs-handy.sh AUFRUFT, statt die Schritte selbst zu tun:
# Holen, Signier-Team, Buendel, Schluessel und Plugins stehen dort samt
# allem, was dabei schon schiefgegangen ist. Ein zweites Skript mit
# denselben Schritten liefe auseinander, und die seltener benutzte Kopie
# -- diese hier -- haette die Fehler, die die andere laengst nicht mehr
# hat. Hier steht nur, was der Store zusaetzlich braucht.
set -euo pipefail
cd "$(dirname "$0")"

VERSION_ARG="${1:-}"

# Versionsnummer, wie Apple sie annimmt: eine bis drei Zahlen mit Punkt.
# Als Funktion, damit test_deploy.mjs sie ohne Mac pruefen kann.
version_gueltig() {
  printf '%s' "${1:-}" | grep -Eq '^[0-9]+(\.[0-9]+){0,2}$'
}

# Die Buildnummer. Apple verlangt, dass sie innerhalb einer Version bei
# jedem Hochladen STEIGT; eine doppelte wird beim Hochladen abgewiesen.
# Statt sie im Projekt hochzuzaehlen (eine versionierte Aenderung nach
# jedem Lauf, die vergessen oder doppelt vergeben wird), ist sie die
# Uhrzeit in UTC: JJJJMMTT.HHMM. Die steigt von selbst, auch wenn zwei
# Macs hochladen, und sagt nebenbei, wann gebaut wurde.
buildnummer() {
  date -u '+%Y%m%d.%H%M'
}

echo "── Store 1/4  Vorbedingungen"
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "  Kein xcodebuild gefunden. Der Store-Bau geht nur auf einem Mac mit Xcode."
  exit 1
fi
# In den Store geht nur, was auf main liegt. Ein Zweig waere ein Stand,
# den es auf der Website nicht gibt -- die App spraeche mit einem Server,
# der etwas anderes erwartet.
# Und nur ein sauberer Stand: aufs-handy.sh legt lokale Aenderungen in den
# Stash und baut ohne sie. Fuers eigene Telefon ist das richtig, fuer den
# Store waere es eine Ueberraschung.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "  Es gibt lokale Aenderungen. In den Store geht nur ein sauberer Stand von main."
  git status --short --untracked-files=no | sed 's/^/    /'
  exit 1
fi
if [ -n "$VERSION_ARG" ] && ! version_gueltig "$VERSION_ARG"; then
  echo "  \"$VERSION_ARG\" ist keine Versionsnummer, wie Apple sie annimmt (z. B. 1.0.1)."
  exit 1
fi

echo "── Store 2/4  Vorbereiten (ueber aufs-handy.sh, streng)"
AUFS_HANDY_NUR_VORBEREITEN=1 ./aufs-handy.sh main

TEAM="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([A-Z0-9]\{10\}\).*/\1/p' \
  mobile/ios/lokal.xcconfig | head -1)"
if [ -z "$TEAM" ]; then
  echo "  Keine Team-Kennung in mobile/ios/lokal.xcconfig -- aufs-handy.sh haette sie anlegen muessen."
  exit 1
fi

VERSION="$VERSION_ARG"
if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p' \
    mobile/ios/App/App.xcodeproj/project.pbxproj | head -1)"
fi
BUILD="$(buildnummer)"
echo "        Version ${VERSION}, Build ${BUILD}, Team ${TEAM}"

echo "── Store 3/4  Archivieren"
cd mobile
AUSGABE="$PWD/build/store-${BUILD}"
mkdir -p "$AUSGABE"

if [ -d ios/App/App.xcworkspace ]; then
  ZIEL=(-workspace ios/App/App.xcworkspace)
else
  ZIEL=(-project ios/App/App.xcodeproj)
fi
if xcodebuild -list "${ZIEL[@]}" 2>/dev/null | sed -n '/Schemes:/,$p' | grep -qw "App"; then
  WIE=(-scheme App)
else
  # Ein Archiv braucht ein Schema. Es entsteht, wenn das Projekt einmal in
  # Xcode geoeffnet wurde (xcuserdata, nicht versioniert).
  echo "  Kein Schema \"App\" gefunden. Einmal mit Xcode oeffnen und wieder schliessen:"
  echo "      open mobile/ios/App/App.xcodeproj"
  exit 1
fi

# CAPACITOR_DEBUG=false: debug.xcconfig gilt fuer Debug UND Release und
# schaltet die Fehlersuche ein. In der Store-Fassung hat sie nichts zu
# suchen.
xcodebuild archive \
  "${ZIEL[@]}" "${WIE[@]}" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$AUSGABE/GuardOpS.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  CAPACITOR_DEBUG=false

echo "── Store 4/4  Hochladen zu App Store Connect"
# destination=upload: Xcode laedt direkt hoch, statt eine .ipa abzulegen.
# Signiert wird automatisch, wie im Projekt eingestellt; dabei schreibt
# Xcode auch aps-environment auf "production" um (siehe App.entitlements).
cat > "$AUSGABE/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${TEAM}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$AUSGABE/GuardOpS.xcarchive" \
  -exportOptionsPlist "$AUSGABE/ExportOptions.plist" \
  -exportPath "$AUSGABE/export" \
  -allowProvisioningUpdates

echo ""
echo "  Hochgeladen: GuardOpS ${VERSION} (${BUILD})."
echo "  In 10 bis 30 Minuten steht der Build in App Store Connect unter TestFlight."
echo "  Zur Pruefung einreichen dort von Hand."
