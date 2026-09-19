#!/usr/bin/env bash
# Setzt das GitHub-Secret MANDANT_SECRETS (OP-526): die Tafel, aus der
# mandant_secret() in backend/betreiber.php das Datenbank-Passwort eines
# Mandanten holt -- und seit ENT-600 auch der Deploy der Demo-Plätze.
#
# ERSETZT, ERGÄNZT NICHT. GitHub gibt ein Secret nie wieder her; ein
# bestehender Wert lässt sich nicht auslesen und darum auch nicht
# fortschreiben. Wer hier läuft, schreibt die GANZE Tafel neu -- jeder
# Mandant, der ein eigenes Datenbank-Passwort braucht, muss dabei sein.
# Darum fragt das Skript am Schluss ausdrücklich nach weiteren Einträgen
# und lässt niemanden stillschweigend hinausfallen.
#
# NICHTS LANDET AUF DER PLATTE: Das JSON entsteht im Arbeitsspeicher und
# geht direkt an "gh secret set".
#
#     bash mandant-secrets.sh
#
set -euo pipefail

REPO="f5yct67kcv-source/sop-plattform"
UMGEBUNG="production"
PLAETZE="demo1 demo2 demo3 demo4 demo5 demo6 demo7 demo8 demo9 demo10"

# base64 ohne Zeilenumbrüche, auch auf macOS (dort kennt base64 kein "-w0").
b64() { base64 | tr -d '\n'; }

frage() {
  local __var="$1" __text="$2" __vorgabe="${3:-}" __eingabe
  if [ -n "$__vorgabe" ]; then
    read -r -p "$__text [$__vorgabe]: " __eingabe
    __eingabe="${__eingabe:-$__vorgabe}"
  else
    read -r -p "$__text: " __eingabe
  fi
  printf -v "$__var" '%s' "$__eingabe"
}

# Passwörter werden nie angezeigt; bestätigt wird nur die Länge. Das fängt
# "leer geblieben" und "halb eingefügt", ohne etwas preiszugeben.
frage_still() {
  local __var="$1" __text="$2" __eingabe
  read -r -s -p "$__text: " __eingabe
  echo " (${#__eingabe} Zeichen)"
  printf -v "$__var" '%s' "$__eingabe"
}

echo
echo "── MANDANT_SECRETS setzen ───────────────────────────────────────"
echo "Repository:  $REPO"
echo "Environment: $UMGEBUNG"
echo
echo "ACHTUNG: Der bisherige Wert wird vollständig ersetzt. Jeder Mandant,"
echo "der ein eigenes Datenbank-Passwort braucht, muss hier vorkommen."
echo

for werkzeug in gh python3; do
  command -v "$werkzeug" >/dev/null 2>&1 || {
    echo "FEHLT: $werkzeug. Bitte installieren, dann erneut starten."
    exit 1
  }
done
gh auth status >/dev/null 2>&1 || {
  echo "Du bist in der GitHub-CLI nicht angemeldet. Einmalig:"
  echo
  echo "    gh auth login"
  echo
  exit 1
}

# ── Die Namen der zehn Plätze ────────────────────────────────────────
# Dieselbe Ableitung wie beim Schwesterskript: einer wird gefragt, die
# neun übrigen daraus gebildet und alle zehn zur Bestätigung angezeigt.
echo "Die Namen stehen im Betreiber-Bereich beim Mandanten im Feld"
echo "secret_name. Sie müssen mit denen in DEMO_PLAETZE übereinstimmen."
frage SN1 "  secret_name von demo1" "demo1"

if [ "${SN1%1}" != "$SN1" ]; then
  STAMM="${SN1%1}"
  EINZELN=0
  echo
  echo "Daraus ergeben sich:"
  for platz in $PLAETZE; do
    printf '  %-7s -> %s\n' "$platz" "$STAMM${platz#demo}"
  done
  frage PASST "Stimmt das? (ja/nein)" "ja"
  [ "$PASST" = "ja" ] || { echo "Dann brauche ich sie einzeln:"; EINZELN=1; }
else
  echo
  echo "Aus „$SN1“ laesst sich keine Reihe bilden (der Name endet nicht auf 1)."
  STAMM=""
  EINZELN=1
fi

declare -a NAMEN=()
for platz in $PLAETZE; do
  if [ "$EINZELN" = "1" ]; then
    if [ "$platz" = "demo1" ]; then SN="$SN1"; else
      frage SN "  secret_name von $platz" "${STAMM:+$STAMM${platz#demo}}"
    fi
  else
    SN="$STAMM${platz#demo}"
  fi
  NAMEN+=("$SN")
done
echo

# ── Die Passwörter ───────────────────────────────────────────────────
echo "Jetzt die Datenbank-Passwörter. Sie werden nicht angezeigt."
echo "Das Passwort gehört zum Datenbank-Benutzer des jeweiligen Platzes"
echo "(itufeden_demo1 und so weiter), nicht zu einem Konto in der Software."
echo
declare -a WERTE=()
i=0
for platz in $PLAETZE; do
  frage_still PW "  $platz (Eintrag „${NAMEN[$i]}“)"
  if [ -z "$PW" ]; then
    # Leer ist hier kein gueltiger Wert: Ein Eintrag ohne Passwort sieht in
    # der Tafel aus wie ein vorhandener und scheitert erst beim Verbinden.
    echo "    Leer geht nicht -- ohne Passwort kommt der Platz nicht an seine Datenbank."
    echo "    Abgebrochen. Nichts geändert."
    exit 1
  fi
  WERTE+=("$PW")
  i=$((i + 1))
done
echo

# ── Weitere Mandanten ────────────────────────────────────────────────
#
# DER PUNKT, AN DEM DIESES SKRIPT SCHADEN ANRICHTEN KÖNNTE. Die Tafel wird
# ersetzt; ein Mandant, der hier fehlt, verliert seinen Eintrag und damit
# den Zugang zu seiner Datenbank. Darum wird ausdrücklich gefragt und nicht
# stillschweigend angenommen, dass es nur die zehn Plätze gibt.
echo "Gibt es ausser den zehn Plätzen weitere Mandanten mit eigenem"
echo "Datenbank-Passwort in dieser Tafel? (im Betreiber-Bereich erkennbar"
echo "an einem ausgefüllten Feld „Name des Secrets“)"
frage WEITERE "  Weitere Einträge erfassen? (ja/nein)" "nein"
while [ "$WEITERE" = "ja" ]; do
  frage NAME "  Name des Secrets (leer = fertig)"
  [ -z "$NAME" ] && break
  frage_still PW "  Passwort dazu"
  [ -z "$PW" ] && { echo "    Leer geht nicht. Eintrag übersprungen."; continue; }
  NAMEN+=("$NAME")
  WERTE+=("$PW")
  frage WEITERE "  Noch einer? (ja/nein)" "nein"
done
echo

# ── Tafel bauen, kodieren, setzen ────────────────────────────────────
#
# python3 baut das JSON und bekommt die Werte über eine Datei auf der
# Standardeingabe, nicht über die Kommandozeile: Was in der Kommandozeile
# steht, kann jeder Prozess auf dem Rechner mitlesen. Namen und Werte
# werden mit einem Nullbyte getrennt -- das einzige Zeichen, das in einem
# Passwort nicht vorkommen kann.
B64=$(
  {
    j=0
    while [ $j -lt ${#NAMEN[@]} ]; do
      printf '%s\0%s\0' "${NAMEN[$j]}" "${WERTE[$j]}"
      j=$((j + 1))
    done
  } | python3 -c '
import json, sys
roh = sys.stdin.buffer.read().split(b"\0")
# Das letzte Stueck ist leer (jedes Paar endet mit einem Nullbyte).
if roh and roh[-1] == b"": roh.pop()
d = {roh[i].decode(): roh[i+1].decode() for i in range(0, len(roh), 2)}
print(json.dumps(d, ensure_ascii=False))
' | b64
)

echo "Setze das Secret ..."
printf '%s' "$B64" | gh secret set MANDANT_SECRETS --repo "$REPO" --env "$UMGEBUNG"

echo
echo "Fertig. MANDANT_SECRETS steht im Environment $UMGEBUNG,"
echo "mit ${#NAMEN[@]} Einträgen."
echo
echo "Wirksam wird es erst beim nächsten Deploy: Die Tafel wird beim"
echo "Ausliefern in die Dateien eingesetzt, nicht zur Laufzeit gelesen."
