#!/usr/bin/env bash
# Setzt das GitHub-Secret DEMO_PLAETZE (ENT-600, siehe README, Abschnitt
# „Demo-Plätze"). Fragt die Werte ab, baut das JSON, kodiert es und schreibt
# es ins Environment „production" -- ohne dass jemand JSON von Hand tippt.
#
# WARUM ALS SKRIPT UND NICHT ALS ANLEITUNG: Das Secret trägt zehn Plätze mal
# vier Felder plus die gemeinsamen Werte. Von Hand zusammengesetzt ist ein
# Tippfehler darin wahrscheinlicher als richtig -- und er fällt erst im
# Deploy auf, wenn ein Platz auf eine Datenbank zeigt, die es nicht gibt.
# Was sich errechnen lässt (Datenbankname, Benutzer, Ordner), wird hier
# errechnet und nicht gefragt.
#
# NICHTS LANDET AUF DER PLATTE: Das JSON entsteht im Arbeitsspeicher und geht
# direkt an "gh secret set". Es gibt keine Datei, die man danach zu löschen
# vergessen könnte.
#
#     bash demo-plaetze-secret.sh
#
set -euo pipefail

REPO="f5yct67kcv-source/sop-plattform"
UMGEBUNG="production"
DB_HOST="itufeden.mysql.db.internal"
PLAETZE="demo1 demo2 demo3 demo4 demo5 demo6 demo7 demo8 demo9 demo10"

# base64 ohne Zeilenumbrüche. GNU kennt "-w0", die Fassung auf macOS nicht --
# darum die Umbrüche hinterher entfernen statt sie zu verbieten. Ein
# eingebetteter Umbruch zerreisst den Secret-Wert.
b64() { base64 | tr -d '\n'; }

frage() {  # frage <Variable> <Text> [Vorgabe]
  local __var="$1" __text="$2" __vorgabe="${3:-}" __eingabe
  if [ -n "$__vorgabe" ]; then
    read -r -p "$__text [$__vorgabe]: " __eingabe
    __eingabe="${__eingabe:-$__vorgabe}"
  else
    read -r -p "$__text: " __eingabe
  fi
  printf -v "$__var" '%s' "$__eingabe"
}

frage_still() {  # frage_still <Variable> <Text>
  local __var="$1" __text="$2" __eingabe
  read -r -s -p "$__text: " __eingabe
  echo
  printf -v "$__var" '%s' "$__eingabe"
}

echo
echo "── DEMO_PLAETZE setzen ──────────────────────────────────────────"
echo "Repository:  $REPO"
echo "Environment: $UMGEBUNG"
echo

# ── Voraussetzungen, bevor irgendetwas gefragt wird ──────────────────
# Zehn Fragen zu beantworten und dann am fehlenden Werkzeug zu scheitern,
# wäre die unfreundlichste Reihenfolge.
for werkzeug in gh python3 curl; do
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

# ── FTP-Zugang ───────────────────────────────────────────────────────
echo "FTP-Zugang auf den Ordner, in dem die zehn Plätze liegen:"
frage FTP_HOST "  Server"      "sl250.web.hostpoint.ch"
frage FTP_USER "  Benutzer"    "demos@guardops.ch"
frage_still FTP_PASS "  Passwort (wird nicht angezeigt)"
echo

# ── Nachsehen, ob der Zugang wirklich dorthin zeigt ──────────────────
#
# DIE WICHTIGSTE PRÜFUNG DIESES SKRIPTS. Zeigt der Zugang auf ein anderes
# Verzeichnis als den Elternordner der zehn Plätze, lädt der Deploy später
# erfolgreich an eine unbediente Stelle -- die Adressen bleiben bei 403,
# und der Lauf meldet nichts. Genau so ist es beim Portal-Umzug schon
# einmal gelaufen (ENT-580). Hier lässt es sich in zwei Sekunden messen,
# statt es zu glauben.
echo "Prüfe den Zugang ..."
if INHALT=$(curl -sS --ssl-reqd --max-time 25 --user "$FTP_USER:$FTP_PASS" \
            "ftp://$FTP_HOST/" 2>&1); then
  GEFUNDEN=""
  FEHLEND=""
  for platz in $PLAETZE; do
    if printf '%s' "$INHALT" | grep -qE "(^| )$platz\$|/$platz\$| $platz\$"; then
      GEFUNDEN="$GEFUNDEN $platz"
    else
      FEHLEND="$FEHLEND $platz"
    fi
  done
  if [ -z "$FEHLEND" ]; then
    echo "  Alle zehn Ordner gefunden. Der Zugang zeigt auf den richtigen Platz."
  else
    echo "  ACHTUNG: Diese Ordner fehlen dort:$FEHLEND"
    echo "  Der Zugang sieht:"
    printf '%s\n' "$INHALT" | sed 's/^/    /'
    echo
    echo "  Fehlt alles, zeigt der Zugang auf ein anderes Verzeichnis."
    frage WEITER "  Trotzdem weitermachen? (ja/nein)" "nein"
    [ "$WEITER" = "ja" ] || { echo "Abgebrochen. Nichts geändert."; exit 1; }
  fi
else
  echo "  Der Zugang liess sich nicht prüfen: $INHALT"
  echo "  Das kann am Passwort liegen, am Server oder an einer Sperre im Netz."
  frage WEITER "  Trotzdem weitermachen? (ja/nein)" "nein"
  [ "$WEITER" = "ja" ] || { echo "Abgebrochen. Nichts geändert."; exit 1; }
fi
echo

# ── Die gemeinsamen Werte ────────────────────────────────────────────
echo "Gemeinsame Werte aller zehn Plätze:"
frage MAPS  "  Google-Maps-Schlüssel (der bestehende Demo-Schlüssel)"
frage KI    "  Anthropic-API-Schlüssel"
frage TMAIL "  Testadresse -- JEDE Mail aus der Demo geht dorthin"
echo
echo "Postfach, über das die Demo verschickt:"
frage SMTP_HOST   "  SMTP-Server"
frage SMTP_PORT   "  Port"                       "587"
frage SMTP_VERSCH "  Verschlüsselung (tls/ssl)"  "tls"
frage SMTP_USER   "  Benutzer"
frage_still SMTP_PASS "  Passwort (wird nicht angezeigt)"
frage SMTP_ABS    "  Absenderadresse"            "$SMTP_USER"
frage SMTP_ABSN   "  Absendername"               "GuardOpS Demo"
echo

# ── Die secret_name-Werte ────────────────────────────────────────────
#
# Gefragt wird EINER, die übrigen neun werden daraus gebildet: Die Namen
# folgen erfahrungsgemäss demselben Muster, und zehn einzeln abzutippen ist
# zehnmal Gelegenheit für einen Dreher. Angezeigt werden sie trotzdem alle
# -- bestätigt wird, was dasteht, nicht was gemeint war.
echo "Unter welchem Namen steht das Datenbank-Passwort eines Platzes im"
echo "Secret MANDANT_SECRETS? (steht im Betreiber-Bereich beim Mandanten"
echo "demo1 im Feld secret_name)"
frage SN1 "  secret_name von demo1" "demo1"

# Die Nummer wird HINTEN getauscht, nicht an der ersten "1" im Namen: Bei
# einem Namen wie "m1_demo1" traefe eine Ersetzung der ersten "1" die
# falsche Stelle und machte aus demo2 ein "m2_demo1". Endet der Name nicht
# auf "1", laesst sich nichts ableiten -- dann wird gefragt statt geraten.
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
  echo "Darum einzeln:"
  STAMM=""
  EINZELN=1
fi

declare -a SECRET_NAMEN=()
for platz in $PLAETZE; do
  if [ "$EINZELN" = "1" ]; then
    if [ "$platz" = "demo1" ]; then SN="$SN1"; else
      frage SN "  secret_name von $platz" "${STAMM:+$STAMM${platz#demo}}"
    fi
  else
    SN="$STAMM${platz#demo}"
  fi
  SECRET_NAMEN+=("$SN")
done
echo

# ── JSON bauen, kodieren, setzen ─────────────────────────────────────
#
# Gebaut von python3 und nicht von Hand zusammengeklebt: Ein Passwort darf
# Anführungszeichen, Gegenschrägstriche und Umlaute enthalten, und genau
# daran zerbricht selbstgeschriebenes JSON.
B64=$(
  FTP_HOST="$FTP_HOST" FTP_USER="$FTP_USER" FTP_PASS="$FTP_PASS" \
  MAPS="$MAPS" KI="$KI" TMAIL="$TMAIL" \
  SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_VERSCH="$SMTP_VERSCH" \
  SMTP_USER="$SMTP_USER" SMTP_PASS="$SMTP_PASS" SMTP_ABS="$SMTP_ABS" \
  SMTP_ABSN="$SMTP_ABSN" DB_HOST="$DB_HOST" \
  PLAETZE="$PLAETZE" SECRET_NAMEN="${SECRET_NAMEN[*]}" \
  python3 -c '
import json, os
plaetze = os.environ["PLAETZE"].split()
namen   = os.environ["SECRET_NAMEN"].split()
u = lambda k: os.environ[k]
d = {
  "gemeinsam": {
    "ftp_host": u("FTP_HOST"), "ftp_user": u("FTP_USER"),
    "ftp_passwort": u("FTP_PASS"),
    "maps_js_key": u("MAPS"), "anthropic_api_key": u("KI"),
    "testmail": u("TMAIL"),
    "smtp_host": u("SMTP_HOST"), "smtp_port": u("SMTP_PORT"),
    "smtp_verschluesselung": u("SMTP_VERSCH"),
    "smtp_user": u("SMTP_USER"), "smtp_passwort": u("SMTP_PASS"),
    "smtp_absender": u("SMTP_ABS"), "smtp_absender_name": u("SMTP_ABSN"),
    # Push bleibt leer: push_konfiguriert() meldet dann "nicht
    # eingerichtet", statt mit einem falschen Schluessel zu signieren.
    "vapid_private_pem_b64": "", "vapid_kontakt": "",
    "push_cron_schluessel": "",
  },
  "plaetze": {
    p: {"db_host": u("DB_HOST"), "db_name": "itufeden_" + p,
        "db_user": "itufeden_" + p, "secret_name": n}
    for p, n in zip(plaetze, namen)
  },
}
print(json.dumps(d, ensure_ascii=False))
' | b64
)

echo "Setze das Secret ..."
printf '%s' "$B64" | gh secret set DEMO_PLAETZE --repo "$REPO" --env "$UMGEBUNG"

echo
echo "Fertig. DEMO_PLAETZE steht im Environment $UMGEBUNG."
echo "Enthalten: zehn Plätze, je eigene Datenbank, ein gemeinsamer FTP-Zugang."
echo
echo "Noch nicht erledigt (siehe README, Abschnitt „Demo-Plätze\"):"
echo "  - MANDANT_SECRETS um die Passwörter von demo6 bis demo10 ergänzen"
echo "  - im Betreiber-Bereich die Mandantenzeilen für demo6 bis demo10 anlegen"
echo "  - dort die Schema-Prüfung laufen lassen"
