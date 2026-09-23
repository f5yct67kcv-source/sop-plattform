<?php
declare(strict_types=1);
// Die Entscheidung "abholen oder nicht" wirklich ausfuehren, nicht ihren
// Quelltext lesen (backend/support_sammeln.php).
//
// ANLASS, live gemessen am 2026-09-23: Eine Supportanfrage von einem
// Demo-Platz kam beim Betreiber nie an. Sie lag in der Datenbank des
// Platzes, weil betreiber_db() dort auf db() zurueckfaellt. Der Betreiber
// holt sie jetzt ab -- und WEN er dafuer abfragt, entscheidet be_holt_ab().
//
// WARUM DIESE FUNKTION FUER SICH GEPRUEFT WIRD: Sie ist die Stelle, an der
// die beiden Fehler moeglich sind, die man nicht sieht. Antwortet sie zu
// oft "ja", oeffnet der Betreiber Verbindungen ins Leere und die Liste
// haengt an jedem nicht erreichbaren Platz. Antwortet sie zu selten "ja",
// bleibt eine Anfrage unsichtbar -- genau der gemeldete Fehler.
$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// mandant_verbindung_bereit() und mandant_db() leben in betreiber.php und
// braeuchten die halbe Anlage. Gebraucht wird hier nur die erste --
// darum steht sie als Stellvertreter da, und zwar EHRLICH: Sie antwortet
// nach denselben Feldern wie das Original (Zugangsdaten vollstaendig ->
// bereit, keine -> standardverbindung, unvollstaendig -> unvollstaendig).
function mandant_verbindung_bereit(array $m): string {
    $felder = ['db_host', 'db_name', 'db_user', 'secret_name'];
    $gesetzt = array_filter($felder, fn($f) => trim((string)($m[$f] ?? '')) !== '');
    if (count($gesetzt) === 0)               { return 'standardverbindung'; }
    if (count($gesetzt) !== count($felder))  { return 'unvollstaendig'; }
    if (($m['secret_fehlt'] ?? false) === true) { return 'secret_fehlt'; }
    return 'bereit';
}

require __DIR__ . '/../backend/support_sammeln.php';

$vollstaendig = ['id' => 7, 'name' => 'Platz', 'db_host' => 'localhost',
                 'db_name' => 'platz_db', 'db_user' => 'u', 'secret_name' => 's'];

// ── Der gemeldete Fall: eigene Datenbank, also abholen ────────────────
pruef('eine eigene Datenbank wird abgeholt',
    be_holt_ab('stamm_db', $vollstaendig) === true);

// ── Die drei Faelle, in denen NICHT abgeholt wird ─────────────────────
//
// 1. Derselbe Name: Die Anfrage steht schon im Stamm. Abholen hiesse, sie
//    ein zweites Mal in dieselbe Liste zu legen.
pruef('dieselbe Datenbank wird nicht abgeholt',
    be_holt_ab('platz_db', $vollstaendig) === false);
// Gross- und Kleinschreibung: MySQL-Datenbanknamen unterscheiden sich je
// nach Server darin. Ein Unterschied nur in der Schreibweise waere derselbe
// Ort -- und ergaebe doppelte Zeilen.
pruef('dieselbe Datenbank auch in anderer Schreibweise nicht',
    be_holt_ab('Platz_DB', $vollstaendig) === false);

// 2. Keine eigenen Zugangsdaten: Der Mandant teilt sich die Datenbank mit
//    dem Stamm (heutiger Fall der Mandantin).
pruef('ohne eigene Zugangsdaten wird nicht abgeholt',
    be_holt_ab('stamm_db', ['id' => 1, 'name' => 'Betrieb']) === false);

// 3. Unvollstaendig oder ohne Secret: Da ist nichts zu holen, und der
//    Aufrufer meldet es als eigenen Befund statt als "keine Anfragen".
pruef('unvollstaendige Zugangsdaten werden nicht abgeholt',
    be_holt_ab('stamm_db', ['id' => 8, 'name' => 'Halb', 'db_host' => 'localhost',
                            'db_name' => 'x']) === false);
pruef('ohne Secret wird nicht abgeholt',
    be_holt_ab('stamm_db', $vollstaendig + ['secret_fehlt' => true]) === false);

// Ein leerer Datenbankname ist KEINE Einladung, alles abzuholen: Waere der
// Stammname unbekannt (leerer String) und der Mandantenname ebenfalls leer,
// duerfte daraus kein "ungleich, also abholen" werden.
pruef('ein leerer Datenbankname fuehrt nicht zum Abholen',
    be_holt_ab('', ['id' => 9, 'name' => 'Leer', 'db_host' => 'h',
                    'db_name' => '', 'db_user' => 'u', 'secret_name' => 's']) === false);

// ── Das Abzeichen zaehlt offene Freigaben, nicht Anlagen ──────────────
$lagen = [
    ['mandant_id' => 1, 'lage' => 'offen'],
    ['mandant_id' => 2, 'lage' => 'nie_freigegeben'],
    ['mandant_id' => 3, 'lage' => 'abgelaufen'],
    ['mandant_id' => 4, 'lage' => 'offen'],
    ['mandant_id' => 5, 'lage' => 'nicht_feststellbar'],
];
pruef('gezaehlt werden nur die offenen Freigaben', be_freigaben_offen($lagen) === 2);
// "Nicht feststellbar" zaehlt NICHT als offen -- sonst meldete ein
// Netzausfall dem Betreiber eine Tuer, die niemand geoeffnet hat.
pruef('nicht feststellbar zaehlt nicht als offen',
    be_freigaben_offen([['mandant_id' => 1, 'lage' => 'nicht_feststellbar']]) === 0);
pruef('ohne Lagen ist die Zahl 0', be_freigaben_offen([]) === 0);

echo count($bad) === 0 ? ($ok + count($bad)) . " bestanden\n" : "$ok bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit($bad ? 1 : 0);
