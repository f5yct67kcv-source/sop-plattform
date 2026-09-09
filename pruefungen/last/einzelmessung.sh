#!/bin/bash
# Was EIN Aufruf je Endpunkt kostet -- ohne Nebenlast, bei voller Datenmenge.
# Antwortzeit, Antwortgroesse und Anzahl Datenbankabfragen.
#
# Die Abfragezahl kommt aus dem Zaehler der Datenbank (Questions) vor und nach
# dem Aufruf. Sie ist die aussagekraeftigste Zahl der drei: Eine Antwortzeit
# haengt vom Rechner ab, die Zahl der Abfragen vom Bau des Endpunkts.
set -e
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${LAST_PORT:-8080}"
DB="mariadb -u${LAST_DB_USER:-lasttest} -p${LAST_DB_PASS:-lasttest} -h127.0.0.1 ${LAST_DB_NAME:-lasttest} -N -B"
T="tok-admin-lasttest-0001"
HEUTE=$(date +%F)
MONAT_VON=$(date +%Y-%m-01)
MONAT_BIS=$(date -d "+30 days" +%F)

messen() {  # $1 Beschriftung  $2 Pfad  $3 Token  $4 Methode  $5 Rumpf
  local beschriftung="$1" pfad="$2" token="${3:-$T}" methode="${4:-GET}" rumpf="$5"
  local q0 q1 code zeit groesse
  q0=$($DB -e "SHOW GLOBAL STATUS LIKE 'Questions'" | cut -f2)
  if [ "$methode" = "POST" ]; then
    read -r code zeit groesse <<<"$(curl -s -o /dev/null -X POST -d "$rumpf" \
      -H "Content-Type: application/json" -H "X-Auth-Token: $token" \
      -w "%{http_code} %{time_total} %{size_download}" "http://127.0.0.1:$PORT$pfad")"
  else
    read -r code zeit groesse <<<"$(curl -s -o /dev/null -H "X-Auth-Token: $token" \
      -w "%{http_code} %{time_total} %{size_download}" "http://127.0.0.1:$PORT$pfad")"
  fi
  q1=$($DB -e "SHOW GLOBAL STATUS LIKE 'Questions'" | cut -f2)
  printf "%-34s %5s  %8.0f ms  %11s B  %5s Abfragen\n" "$beschriftung" "$code" \
    "$(awk "BEGIN{print $zeit*1000}")" "$groesse" "$(( q1 - q0 - 1 ))"
}

RUNDE=$(php -r 'echo json_decode(file_get_contents(__DIR__."/runden.json"),true)[2] ?? 0;' 2>/dev/null || echo 0)

echo "── Sitzung ─────────────────────────────────────────────────────────"
messen "me.php (nur Sitzungspruefung)" "/backend/api/me.php"
echo
echo "── Waechter-App (Handy) ────────────────────────────────────────────"
messen "meine_schichten.php" "/backend/api/meine_schichten.php" "tok-ma-2"
messen "meine_mitteilungen.php" "/backend/api/meine_mitteilungen.php" "tok-ma-2"
messen "rapport_list.php (eigene)" "/backend/api/rapport_list.php" "tok-ma-2"
messen "mein_rundgang_position.php" "/backend/api/mein_rundgang_position.php" "tok-ma-2" POST \
  "{\"rundgang_id\":$RUNDE,\"positionen\":[{\"lat\":47.21,\"lng\":7.51,\"genauigkeit_m\":12,\"erfasst_am\":\"$(date +'%Y-%m-%d %H:%M:%S')\"}]}"
echo
echo "── Cockpit (Verwaltung) ────────────────────────────────────────────"
messen "dashboard_stats.php" "/backend/api/dashboard_stats.php"
messen "einsatz_list.php (1 Tag)" "/backend/api/einsatz_list.php?von=$HEUTE&bis=$HEUTE"
messen "einsatz_list.php (1 Monat)" "/backend/api/einsatz_list.php?von=$MONAT_VON&bis=$MONAT_BIS"
messen "objekt_list.php" "/backend/api/objekt_list.php"
messen "mitarbeiter_list.php" "/backend/api/mitarbeiter_list.php"
messen "kunden_list.php" "/backend/api/kunden_list.php"
messen "rundgang_liste.php (1 Tag)" "/backend/api/rundgang_liste.php?von=$HEUTE&bis=$HEUTE"
messen "rundgang_liste.php (1 Monat)" "/backend/api/rundgang_liste.php?von=$MONAT_VON&bis=$HEUTE"
messen "rapport_list.php (alle)" "/backend/api/rapport_list.php"
echo
echo "── Kundenportal ────────────────────────────────────────────────────"
messen "portal_einsaetze.php" "/backend/api/portal_einsaetze.php" "tok-portal-1"
messen "portal_rundgaenge.php" "/backend/api/portal_rundgaenge.php" "tok-portal-1"
echo
echo "── Statische Auslieferung ──────────────────────────────────────────"
for d in dashboard.html app.html portal.html index.html; do
  read -r code zeit groesse <<<"$(curl -s -o /dev/null -w "%{http_code} %{time_total} %{size_download}" "http://127.0.0.1:$PORT/$d")"
  printf "%-34s %5s  %8.0f ms  %11s B\n" "$d" "$code" "$(awk "BEGIN{print $zeit*1000}")" "$groesse"
done
