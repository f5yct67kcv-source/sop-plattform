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
# Der erste Lauf fragt nach Name und Passwort und merkt sich beides:
# den Namen in ~/.guardops-dev-user, das Passwort im Schluesselbund des
# Macs. Jeder weitere Lauf geht ohne Nachfrage durch. Wieder loeschen:
#     ./dev-anmelden.sh vergessen
#
# Bewusst NICHT ueber "export GUARDOPS_PW=..." in der ~/.zshrc: Das waere
# ein Passwort im Klartext auf der Platte. Die beiden Variablen werden
# trotzdem gelesen, falls sie gesetzt sind -- fuer Ablaeufe ohne Terminal.
#
# Andere Umgebung ansprechen:
#     export GUARDOPS_URL=https://andere-adresse.example
set -eu

ZIEL="ios/App/App/public/index.html"
ADRESSE="${GUARDOPS_URL:-https://cupi24.guardops.ch}"
DIENST="guardops-dev"
MERKDATEI="$HOME/.guardops-dev-user"

# "./dev-anmelden.sh vergessen" loescht das Gemerkte wieder.
if [ "${1:-}" = "vergessen" ]; then
  rm -f "$MERKDATEI"
  if command -v security >/dev/null 2>&1; then
    security delete-generic-password -s "$DIENST" >/dev/null 2>&1 || true
  fi
  echo "Gemerkte Zugangsdaten geloescht."
  exit 0
fi

if [ ! -f "$ZIEL" ]; then
  echo "Kein gebautes Buendel gefunden ($ZIEL)." >&2
  echo "Zuerst \"npx cap sync ios\" im Ordner mobile/ ausfuehren." >&2
  exit 1
fi

# Reihenfolge: Umgebung, dann Gemerktes, dann fragen.
NAME="${GUARDOPS_USER:-}"
if [ -z "$NAME" ] && [ -f "$MERKDATEI" ]; then
  NAME=$(cat "$MERKDATEI")
fi
if [ -z "$NAME" ]; then
  printf 'Anmeldename: '
  read -r NAME
fi

# Das Passwort kommt aus dem Schluesselbund des Macs (security), nicht aus
# einer Datei. Eine Zeile "export GUARDOPS_PW=..." in der ~/.zshrc waere ein
# Passwort im Klartext auf der Platte -- der Schluesselbund ist genau dafuer
# da und schuetzt es wie jedes andere gespeicherte Passwort.
PW="${GUARDOPS_PW:-}"
NEU=0
if [ -z "$PW" ] && command -v security >/dev/null 2>&1; then
  PW=$(security find-generic-password -s "$DIENST" -a "$NAME" -w 2>/dev/null || true)
fi
if [ -z "$PW" ]; then
  printf 'Passwort fuer "%s" (bleibt unsichtbar): ' "$NAME"
  stty -echo 2>/dev/null || true
  read -r PW
  stty echo 2>/dev/null || true
  printf '\n'
  NEU=1
fi

# Sichtbar machen, mit welchem Namen angemeldet wird: Steht GUARDOPS_USER
# in der Umgebung, fragt das Skript nicht danach -- ein falscher Wert dort
# sah sonst aus wie ein falsches Passwort.
echo "Anmeldung als \"$NAME\" bei $ADRESSE ..."

# Anfrage und Antwort ueber python3 bauen bzw. lesen -- so bleibt ein
# Passwort mit Sonderzeichen unbeschaedigt, und eine Fehlermeldung des
# Servers wird als solche erkannt statt als Token missverstanden.
ANFRAGE=$(python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "password": sys.argv[2]}))' "$NAME" "$PW")

# Bewusst OHNE curl -f: Mit -f bricht curl bei 401/429 ab, bevor der Text
# der Antwort gelesen ist -- die Auskunft des Servers ("Name oder Passwort
# falsch", "Zu viele Fehlversuche, bitte X Minuten warten") ging dabei
# verloren und alles sah aus wie "Server nicht erreichbar". Der Statuscode
# haengt hinten dran und wird gleich wieder abgetrennt.
ROH=$(printf '%s' "$ANFRAGE" | curl -sS -X POST "$ADRESSE/api/login.php" \
  -H 'Content-Type: application/json' --data-binary @- -w '\n%{http_code}') || {
  echo "Anmeldung fehlgeschlagen: $ADRESSE ist nicht erreichbar." >&2
  exit 1
}
CODE=$(printf '%s' "$ROH" | tail -n 1)
ANTWORT=$(printf '%s' "$ROH" | sed '$d')

python3 - "$ZIEL" "$ANTWORT" "$CODE" <<'PY'
import json, re, sys

ziel, roh, code = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.loads(roh)
except ValueError:
    sys.exit('Unverstaendliche Antwort vom Server (HTTP %s):\n%s' % (code, roh[:400]))

if d.get('status') == 'zweifaktor':
    sys.exit('Fuer dieses Konto ist die Zwei-Faktor-Anmeldung an -- '
             'dieses Skript kann sie nicht bedienen. Einmal von Hand anmelden.')
if d.get('status') != 'ok' or not d.get('token'):
    grund = str(d.get('message') or d)
    hinweis = ''
    if code == '401':
        # Der Server sagt bewusst nicht, ob der Name oder das Passwort
        # falsch war (er verraet nicht, welche Namen es gibt).
        hinweis = ('\nDer Server war erreichbar und hat abgelehnt. Pruefe den '
                   'Anmeldenamen -- steht GUARDOPS_USER in der Umgebung, wird '
                   'der genommen, ohne zu fragen.')
    elif code == '429':
        hinweis = ('\nDas ist die Bremse gegen Passwort-Raten. Weitere Versuche '
                   'verlaengern die Sperre -- erst die Wartezeit abwarten.')
    sys.exit('Anmeldung abgelehnt (HTTP %s): %s%s' % (code, grund, hinweis))

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

# Erst JETZT merken -- vorher waere bei einem Tippfehler im Passwort ein
# falscher Wert im Schluesselbund gelandet, und der naechste Lauf haette
# ihn wortlos wiederverwendet.
# Scheitert das Merken, ist das kein Grund zum Abbruch: Die Sitzung liegt
# zu diesem Zeitpunkt bereits im Buendel, der Lauf war erfolgreich.
printf '%s' "$NAME" > "$MERKDATEI" 2>/dev/null || true
if [ "$NEU" = "1" ] && command -v security >/dev/null 2>&1; then
  if security add-generic-password -U -s "$DIENST" -a "$NAME" -w "$PW" 2>/dev/null; then
    echo "Passwort im Schluesselbund gemerkt -- der naechste Lauf fragt nicht mehr."
    echo "Wieder loeschen: ./dev-anmelden.sh vergessen"
  fi
fi
