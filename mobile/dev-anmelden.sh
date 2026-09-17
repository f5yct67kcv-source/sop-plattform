#!/bin/sh
# Entwicklungshilfe: meldet einmal an und legt die Sitzung ins gebaute
# App-Buendel, damit der Anmeldeschirm beim Testen nicht bei jedem Bau
# wieder kommt.
#
# WARUM ES DIESES SKRIPT GIBT: Eine Sitzung mit Verwaltungsrechten laeuft
# nach 30 Minuten ohne Serveranfrage ab (SITZUNG_BUERO_RUHE_MIN, ENT-293).
# Ein Bau-Durchgang dauert leicht laenger -- beim Testen stand darum vor
# jedem Durchgang die Anmeldemaske. Diese Frist wird NICHT angefasst: Sie
# gilt fuer alle und schuetzt fremde Personendaten. Stattdessen holt dieses
# Skript vor dem Start eine frische Sitzung.
#
# WAS ES NICHT TUT -- und warum das so bleibt:
#   - Es steht KEIN Passwort in dieser Datei und keines im Repository.
#     Name und Passwort kommen aus der Umgebung oder werden gefragt.
#   - Es aendert KEINE Anmeldelogik. Der Anmeldeschirm bleibt, wie er ist;
#     hier wird nur eine gueltige Sitzung vorab hinterlegt, genau so wie
#     nach einer Anmeldung von Hand.
#   - Es schreibt ausschliesslich nach ios/App/App/public/. Dieser Ordner
#     steht in mobile/ios/.gitignore und wird von "npx cap sync" bei jedem
#     Lauf neu geschrieben. Es kann darum weder ins Repository noch in
#     einen Store-Build geraten, der aus mobile/www/ entsteht.
#
# BENUTZUNG (im Ordner mobile/, nach "npx cap sync ios"):
#     ./dev-anmelden.sh
#
# Ohne Nachfragen, wenn diese beiden in der Umgebung stehen:
#     export GUARDOPS_USER=dein.anmeldename
#     export GUARDOPS_PW='dein-passwort'
#
# Andere Umgebung ansprechen:
#     export GUARDOPS_URL=https://andere-adresse.example
set -eu

ZIEL="ios/App/App/public/index.html"
ADRESSE="${GUARDOPS_URL:-https://cupi24.guardops.ch}"

if [ ! -f "$ZIEL" ]; then
  echo "Kein gebautes Buendel gefunden ($ZIEL)." >&2
  echo "Zuerst \"npx cap sync ios\" im Ordner mobile/ ausfuehren." >&2
  exit 1
fi

NAME="${GUARDOPS_USER:-}"
if [ -z "$NAME" ]; then
  printf 'Anmeldename: '
  read -r NAME
fi

PW="${GUARDOPS_PW:-}"
if [ -z "$PW" ]; then
  printf 'Passwort (bleibt unsichtbar): '
  stty -echo 2>/dev/null || true
  read -r PW
  stty echo 2>/dev/null || true
  printf '\n'
fi

# Anfrage und Antwort ueber python3 bauen bzw. lesen -- so bleibt ein
# Passwort mit Sonderzeichen unbeschaedigt, und eine Fehlermeldung des
# Servers wird als solche erkannt statt als Token missverstanden.
ANFRAGE=$(python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "password": sys.argv[2]}))' "$NAME" "$PW")
ANTWORT=$(printf '%s' "$ANFRAGE" | curl -fsS -X POST "$ADRESSE/api/login.php" \
  -H 'Content-Type: application/json' --data-binary @- ) || {
  echo "Anmeldung fehlgeschlagen: $ADRESSE nicht erreichbar." >&2
  exit 1
}

python3 - "$ZIEL" "$ANTWORT" <<'PY'
import json, re, sys

ziel, roh = sys.argv[1], sys.argv[2]
try:
    d = json.loads(roh)
except ValueError:
    sys.exit('Unverstaendliche Antwort vom Server:\n' + roh[:400])

if d.get('status') == 'zweifaktor':
    sys.exit('Fuer dieses Konto ist die Zwei-Faktor-Anmeldung an -- '
             'dieses Skript kann sie nicht bedienen. Einmal von Hand anmelden.')
if d.get('status') != 'ok' or not d.get('token'):
    sys.exit('Anmeldung abgelehnt: ' + str(d.get('message') or d))

nutzer = {'name': d.get('name'), 'ist_admin': d.get('ist_admin')}
# Dieselben Schluessel wie nach einer Anmeldung von Hand (app.html,
# index.html und dashboard.html teilen sie sich ueber dieselbe Herkunft).
block = (
    '<!-- dev-anmeldung: nur im lokalen Bau, siehe mobile/dev-anmelden.sh -->\n'
    '<script>try{localStorage.setItem("rv3_token",%s);'
    'localStorage.setItem("rv3_user",%s);}catch(e){}</script>\n'
) % (json.dumps(d['token']), json.dumps(json.dumps(nutzer)))

html = open(ziel, encoding='utf-8').read()
# Ein frueherer Block wird ersetzt, nicht gestapelt.
html = re.sub(r'<!-- dev-anmeldung:.*?</script>\n', '', html, flags=re.S)
# Direkt nach <head>: Die Seite liest den Token beim Auswerten ihres
# eigenen Skripts. Weiter unten waere zu spaet.
neu, anzahl = re.subn(r'(<head[^>]*>)', lambda m: m.group(1) + '\n' + block, html, count=1)
if not anzahl:
    sys.exit('Kein <head> in ' + ziel + ' gefunden -- nichts geaendert.')
open(ziel, 'w', encoding='utf-8').write(neu)
print('Sitzung fuer "%s" ins Buendel gelegt (%s).' % (nutzer['name'], ziel))
print('Gilt bis zur naechsten "npx cap sync" -- die schreibt den Ordner neu.')
PY
