#!/bin/bash
# Faehrt einen Lastlauf und haelt neben den Antwortzeiten fest, was die
# Datenbank dabei tut.
#
#   ./lauf.sh <name> <waechter> <cockpit> <portal>
#   DAUER=180 ./lauf.sh spitze 40 4 10
set -e
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAUER="${DAUER:-90}"
DB_NAME="${LAST_DB_NAME:-lasttest}"
DB="mariadb -u${LAST_DB_USER:-lasttest} -p${LAST_DB_PASS:-lasttest} -h127.0.0.1 $DB_NAME -N -B"

name="${1:?Name des Laufs fehlt}"; w="${2:-20}"; c="${3:-2}"; p="${4:-5}"

echo "════ $name: $w Waechter, $c Cockpit, $p Portal, ${DAUER}s ════"

# Nebenbeobachtung: wie viele Verbindungen stehen offen, wie lange laeuft
# die laengste Abfrage. Ohne das sieht man nur, DASS es langsam ist.
( for _ in $(seq 1 $((DAUER / 3))); do
    $DB -e "SELECT
      (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE db='$DB_NAME') AS verbindungen,
      (SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE db='$DB_NAME' AND command='Query') AS aktiv,
      (SELECT IFNULL(MAX(time),0) FROM information_schema.PROCESSLIST WHERE db='$DB_NAME' AND command='Query') AS laengste_s;" 2>/dev/null
    sleep 3
  done ) > "$HIER/db-$name.txt" &
beob=$!

node "$HIER/lastgenerator.mjs" "$w" "$c" "$p" "$DAUER" 1 > "$HIER/ergebnis-$name.json"
wait $beob 2>/dev/null || true

node -e "
  const r = require('$HIER/ergebnis-$name.json');
  console.log('  Anfragen:', r.gesamt.anfragen, ' pro Sekunde:', r.gesamt.pro_sekunde,
              ' Fehler:', r.gesamt.fehler + ' (' + r.gesamt.fehlerquote_prozent + '%)');
  console.log('  Antwortzeit  p50', r.gesamt.p50_ms + 'ms  p95', r.gesamt.p95_ms + 'ms  p99',
              r.gesamt.p99_ms + 'ms  max', r.gesamt.max_ms + 'ms');
  console.log('  uebertragen:', r.gesamt.uebertragen_mb, 'MB');
  for (const e of r.endpunkte) console.log('   ', e.endpunkt.padEnd(30), String(e.n).padStart(5),
    'p50', String(e.p50_ms).padStart(6) + 'ms', 'p95', String(e.p95_ms).padStart(6) + 'ms',
    'max', String(e.max_ms).padStart(6) + 'ms', e.kb_mittel + 'kB', e.fehler ? ('FEHLER:' + e.fehler) : '');
  if (r.fehlerarten.length) console.log('   Fehlerarten:', JSON.stringify(r.fehlerarten));
"
echo "  DB-Verbindungen (max):" $(awk '{print $1}' "$HIER/db-$name.txt" | sort -n | tail -1) \
     " aktive Abfragen (max):" $(awk '{print $2}' "$HIER/db-$name.txt" | sort -n | tail -1) \
     " laengste Abfrage:" $(awk '{print $3}' "$HIER/db-$name.txt" | sort -n | tail -1)s
