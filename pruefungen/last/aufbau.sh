#!/bin/bash
# Baut die Lasttest-Umgebung auf: Wegwerfdatenbank, echtes Schema, echte
# Einrichtung, PHP-Server auf einer Arbeitskopie.
#
# NIE gegen Produktion oder Staging laufen lassen -- die Datenbank, die hier
# benutzt wird, wird geloescht und neu angelegt.
set -e

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$HIER/../.." && pwd)"
ARBEIT="$HIER/arbeitskopie"

DB_NAME="${LAST_DB_NAME:-lasttest}"
DB_USER="${LAST_DB_USER:-lasttest}"
DB_PASS="${LAST_DB_PASS:-lasttest}"
PORT="${LAST_PORT:-8080}"
ARBEITER="${LAST_ARBEITER:-16}"

if [ "$DB_NAME" = "rapport" ] || [ "$DB_NAME" = "produktion" ]; then
  echo "Abbruch: '$DB_NAME' sieht nach einer echten Datenbank aus." >&2
  exit 1
fi

DB="mariadb -u$DB_USER -p$DB_PASS -h127.0.0.1 $DB_NAME"

echo "── Arbeitskopie anlegen ────────────────────────────────────────────"
rm -rf "$ARBEIT"
mkdir -p "$ARBEIT"
# Nur, was der Server braucht. Die Arbeitskopie traegt Zugangsdaten und
# gehoert darum nicht ins Repository (siehe .gitignore in diesem Ordner).
for teil in backend index.html dashboard.html app.html portal.html; do
  cp -r "$WURZEL/$teil" "$ARBEIT/"
done
sed -i "s/__DB_HOST__/127.0.0.1/; s/__DB_NAME__/$DB_NAME/; s/__DB_USER__/$DB_USER/; s/__DB_PASS__/$DB_PASS/; s/__APP_ENV__/staging/" \
  "$ARBEIT/backend/db.php"

echo "── Datenbank neu anlegen ───────────────────────────────────────────"
mariadb -uroot -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4;
  CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
  GRANT ALL ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1'; FLUSH PRIVILEGES;"

echo "── Grundschema und Planungsschema (Teil A) ─────────────────────────"
$DB < "$ARBEIT/backend/schema.sql"
# Teil B ist der Nachtrag fuer eine bestehende alte Installation -- bei einer
# Neuanlage gilt ausschliesslich Teil A.
sed -n "1,$(($(grep -n 'TEIL B -- nur ausfuehren' "$ARBEIT/backend/schema_planung.sql" | cut -d: -f1) - 3))p" \
  "$ARBEIT/backend/schema_planung.sql" | $DB

echo "── Verwaltungszugang und Sitzung ───────────────────────────────────"
php -r '
$pdo = new PDO("mysql:host=127.0.0.1;dbname='"$DB_NAME"';charset=utf8mb4","'"$DB_USER"'","'"$DB_PASS"'");
$pdo->prepare("INSERT INTO mitarbeiter (id,name,password_hash,ist_admin,aktiv,vorname,nachname) VALUES (1,?,?,1,1,?,?)")
    ->execute(["chef", password_hash(bin2hex(random_bytes(12)), PASSWORD_DEFAULT), "Test", "Verwaltung"]);
$pdo->prepare("INSERT INTO sessions (token,mitarbeiter_id,erstellt_am) VALUES (?,1,NOW())")
    ->execute(["tok-admin-lasttest-0001"]);
'

echo "── PHP-Server starten (Port $PORT, $ARBEITER Arbeitsprozesse) ──────"
pkill -f "php -S 127.0.0.1:$PORT" 2>/dev/null || true
sleep 1
PHP_CLI_SERVER_WORKERS=$ARBEITER setsid nohup php -d opcache.enable=1 -d memory_limit=256M \
  -S 127.0.0.1:$PORT -t "$ARBEIT" > "$HIER/php-server.log" 2>&1 < /dev/null &
sleep 2

echo "── Einrichtung laufen lassen (legt die uebrigen Tabellen an) ───────"
curl -s -X POST "http://127.0.0.1:$PORT/backend/api/planung_einrichten.php" \
  -H "X-Auth-Token: tok-admin-lasttest-0001" -o "$HIER/einrichtung.json" \
  -w "  HTTP %{http_code}\n"
php -r '$d=json_decode(file_get_contents("'"$HIER"'/einrichtung.json"),true);
  printf("  %s -- angelegt: %d, Fehler: %d\n", $d["status"]??"?", count($d["getan"]??[]), count($d["fehler"]??[]));'
echo "  Tabellen: $($DB -N -B -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME'")"
echo
echo "Bereit. Weiter mit:  php $HIER/erzeuge_daten.php"
