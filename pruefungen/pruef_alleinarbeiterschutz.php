<?php
declare(strict_types=1);
// Alleinarbeiterschutz Mechanismus B, Stufe 1 (ENT-153, ENT-644):
// Ueberfaelligkeitserkennung + Push. Fuehrt den Rechenkern ECHT aus, gegen
// eine SQLite-Testdatenbank -- gleiches Muster wie pruef_rundgang.php und
// pruef_push.php.
//
// Was hier bewusst NICHT geprueft wird: die eigentliche Kryptografie/HTTP-
// Zustellung von push_zustellen() -- das deckt pruef_push.php bereits ab.
// Hier zaehlt, dass alleinarbeiterschutz.php den Zustellweg RICHTIG
// AUFRUFT (richtige Empfaenger, richtige Ueberfaelligkeit, kein Doppel-
// Push) -- deshalb wird push.php mit einem ECHTEN, frisch erzeugten
// VAPID-Schluessel eingerichtet (derselbe Kniff wie in pruef_push.php),
// damit push_konfiguriert() wahr ist und der volle Versandweg durchlaeuft.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// ── db.php wird in diesem Projekt nie fuer eine reine Rechenkern-Pruefung
// mitgeladen (echte DB-Verbindung noetig) -- hat_tabelle/hat_spalte/
// json_response werden wie in pruef_push.php/pruef_rundgang.php gegen die
// SQLite-Verbindung selbst nachgebaut.
$GLOBALS['pruefPdo'] = null;
function hat_tabelle(PDO $pdo, string $tabelle, bool $ohneGedaechtnis = false): bool
{
    try {
        $pdo->query("SELECT 1 FROM $tabelle LIMIT 1");
        return true;
    } catch (Throwable $e) {
        return false;
    }
}
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool
{
    if (!hat_tabelle($pdo, $tabelle)) { return false; }
    foreach ($pdo->query("PRAGMA table_info($tabelle)")->fetchAll(PDO::FETCH_ASSOC) as $z) {
        if ((string)$z['name'] === $spalte) { return true; }
    }
    return false;
}
function json_response($data, int $status = 200): void { throw new RuntimeException('unerwartet'); }

// ── rechte.php und push.php sind reine Funktionsbibliotheken ohne eigene
// require-Zeilen (siehe deren Dateikopf) -- genau darum lassen sie sich
// hier ohne Umbau mitladen.
require __DIR__ . '/../backend/rechte.php';

// Echten VAPID-Schluessel unterschieben, EXAKT wie pruef_push.php -- ein
// wertloser, nur zur Laufzeit erzeugter Schluessel, niemals im Repository.
$pk = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
openssl_pkey_export($pk, $pem);
$apk = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
openssl_pkey_export($apk, $apem);
$quellePush = (string)file_get_contents(__DIR__ . '/../backend/push.php');
$ersetzt = str_replace(
    ['__VAPID_PRIVATE_PEM_B64__', '__VAPID_KONTAKT__',
     '__APNS_KEY_P8_B64__', '__APNS_KEY_ID__', '__APNS_TEAM_ID__'],
    [base64_encode($pem), 'mailto:pruefung@example.invalid',
     base64_encode($apem), 'PRUEFKEYID01', 'PRUEFTEAMID9'],
    $quellePush
);
$tmp = tempnam(sys_get_temp_dir(), 'aas') . '.php';
file_put_contents($tmp, $ersetzt);
require $tmp;
@unlink($tmp);
pruef('KRITISCH: push.php gilt mit dem untergeschobenen Schluessel als eingerichtet',
    push_konfiguriert());

require __DIR__ . '/../backend/alleinarbeiterschutz.php';

// ── DIE TESTDATENBANK ──────────────────────────────────────────────────
function neue_pdo(): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, aktiv INTEGER)');
    $pdo->exec('CREATE TABLE mitarbeiter_rollen (id INTEGER PRIMARY KEY AUTOINCREMENT,
                mitarbeiter_id INT, rolle TEXT)');
    $pdo->exec('CREATE TABLE objekte (id INTEGER PRIMARY KEY, name TEXT)');
    $pdo->exec('CREATE TABLE rundgang_vorlage (id INTEGER PRIMARY KEY, objekt_id INT, name TEXT,
                erwartete_dauer_min INT)');
    $pdo->exec('CREATE TABLE rundgang (id INTEGER PRIMARY KEY AUTOINCREMENT, einsatz_id INT,
                mitarbeiter_id INT, objekt_id INT, rundgang_vorlage_id INT, status TEXT,
                rohzeit_start TEXT, pause_minuten INT DEFAULT 0, stufe1_gemeldet_um TEXT)');
    $pdo->exec('CREATE TABLE push_abo (id INTEGER PRIMARY KEY AUTOINCREMENT, mitarbeiter_id INT,
                kanal TEXT, endpunkt TEXT, abgemeldet_am TEXT, letzter_erfolg TEXT,
                letzter_fehler TEXT, letzter_fehler_am TEXT, fehler_zahl INTEGER DEFAULT 0,
                abmeldegrund TEXT)');
    $pdo->exec("INSERT INTO objekte VALUES (1,'Lagerhaus Nord')");
    return $pdo;
}

// ── ROLLE -> EMPFAENGER, OHNE ZWEITEN VERGABEWEG ────────────────────────
// rollen_definitionen() faellt ohne die Rollen-Tabellen auf system_rollen()
// zurueck -- genau der Zustand einer frisch eingerichteten Anlage. Die
// Waechterrolle traegt 'alarmempfaenger' (STUFE_LESEN), die Verwaltung
// AUSDRUECKLICH NICHT (siehe rechte.php-Kommentar an ROLLE_VERWALTUNG).
$pdoRollen = neue_pdo();
$rollen = alleinarbeiterschutz_alarmempfaenger_rollen($pdoRollen);
pruef('KRITISCH: genau die Waechterrolle traegt alarmempfaenger, aus dem Systemkatalog abgeleitet',
    $rollen === [ROLLE_WAECHTER]);

$pdoRollen->exec('INSERT INTO mitarbeiter VALUES (1,1),(2,1),(3,0),(4,1)');
$pdoRollen->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES
    (1,'waechter'), (2,'verwaltung'), (3,'waechter'), (4,'waechter'), (4,'planung')");
$empf = alleinarbeiterschutz_empfaenger_ids($pdoRollen);
sort($empf);
pruef('KRITISCH: nur Waechter mit alarmempfaenger werden erreicht, nicht die Verwaltung',
    $empf === [1, 4]);
pruef('KRITISCH: eine ausgetretene Person mit stehen gebliebener Rolle wird NICHT erreicht',
    !in_array(3, $empf, true));

// Gegenprobe: OHNE die mitarbeiter_rollen-Tabelle (Einrichtung nie
// gelaufen) darf NIEMAND erreicht werden -- kein zweiter Vergabeweg, der
// hier heimlich eine Liste erfindet.
$pdoOhneRollen = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
pruef('KRITISCH: ohne die Rollen-Tabelle keine Empfaenger, keine Ausnahme',
    alleinarbeiterschutz_empfaenger_ids($pdoOhneRollen) === []);

// ── PAUSE UND LAUFZEIT (reine Funktion, ohne PDO) ───────────────────────
pruef('KRITISCH: eine pausierte Runde liefert KEINE Laufzeit -- sie laeuft nicht ueber',
    alleinarbeiterschutz_laufzeit_min('2030-01-01 20:00:00', 0, 'pausiert', '2030-01-01 23:00:00') === null);
pruef('KRITISCH: eine noch nicht gestartete Runde (kein rohzeit_start) liefert nichts',
    alleinarbeiterschutz_laufzeit_min(null, 0, 'laeuft', '2030-01-01 23:00:00') === null);
pruef('KRITISCH: 120 Minuten Laufzeit ohne Pause ergeben 120',
    abs(alleinarbeiterschutz_laufzeit_min('2030-01-01 20:00:00', 0, 'laeuft', '2030-01-01 22:00:00') - 120.0) < 0.01);
pruef('KRITISCH: abgeschlossene Pausenminuten werden abgezogen (ENT-298/ENT-244)',
    abs(alleinarbeiterschutz_laufzeit_min('2030-01-01 20:00:00', 15, 'laeuft', '2030-01-01 22:00:00') - 105.0) < 0.01);
pruef('Eine Pause darf die Laufzeit nicht unter Null druecken',
    alleinarbeiterschutz_laufzeit_min('2030-01-01 20:00:00', 999, 'laeuft', '2030-01-01 20:05:00') === 0.0);

// ── UEBERFAELLIGKEIT: DER GESAMTE RECHENWEG GEGEN ECHTE SQLITE-ZEILEN ───
$pdo = neue_pdo();
$pdo->exec("INSERT INTO rundgang_vorlage VALUES (1,1,'Nachtrunde',60), (2,1,'Oeffnungsrunde',NULL)");
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id, status, rohzeit_start, pause_minuten) VALUES
    (1, 900, 1, 1, 1, 'laeuft', '2030-03-01 22:00:00', 0),
    (2, 901, 2, 1, 1, 'laeuft', '2030-03-01 22:05:00', 0),
    (3, 902, 3, 1, 1, 'pausiert', '2030-03-01 22:00:00', 0),
    (4, 903, 4, 1, 2, 'laeuft', '2030-03-01 22:00:00', 0),
    (5, 904, 1, 1, 1, 'laeuft', '2030-03-01 21:00:00', 20)");
// Runde 1: 70 Min Rundenlaufzeit gegen 60 Min Sollzeit -- genau 10 Min
// druebe: DIE Karenzgrenze selbst, muss ueberfaellig sein ("um 10 Minuten
// ueberschreitet" -- >= und nicht nur >, siehe ENT-644 Punkt 3).
$jetzt = '2030-03-01 23:10:00';
// Runde 2: dieselbe Sollzeit, aber erst 65 Min (5 Min spaeter gestartet) --
// noch innerhalb der Karenz.
// Runde 3: pausiert, gleiche Zeiten wie Runde 1 -- darf NICHT auftauchen.
// Runde 4: keine Sollzeit an der Vorlage (Oeffnungsrunde) -- nicht pruefbar.
// Runde 5: 130 Min Rohzeit minus 20 Min Pause = 110 Min effektiv bei 60 Min
// Soll -- deutlich ueberfaellig, mit Pause richtig herausgerechnet.

$fund = alleinarbeiterschutz_ueberfaellige_runden($pdo, $jetzt);
pruef('KRITISCH: genau am Laufen und ueber der Sollzeit + Karenz meldet sich', $fund['geprueft'] === 4);
$ids = array_map(fn($z) => (int)$z['id'], $fund['ueberfaellig']);
sort($ids);
pruef('KRITISCH: genau Runde 1 (exakt an der Grenze) und Runde 5 (Pause richtig herausgerechnet) gelten als ueberfaellig',
    $ids === [1, 5]);
pruef('KRITISCH: die pausierte Runde 3 gilt NIE als ueberfaellig, obwohl ihre Rohzeit lang genug waere',
    !in_array(3, $ids, true));
pruef('KRITISCH: Runde 4 ohne Sollzeit an der Vorlage wird NICHT geprueft, nicht mit 0 gleichgesetzt',
    !in_array(4, $ids, true) && $fund['ohne_sollzeit'] === 1);
pruef('Runde 2 (65 von 60 Minuten, aber noch innerhalb der 10 Minuten Karenz) ist NICHT ueberfaellig',
    !in_array(2, $ids, true));

// Gegenprobe an der Grenze selbst: eine Minute VOR der Karenzgrenze darf
// Runde 1 nicht mehr treffen.
$fundVorGrenze = alleinarbeiterschutz_ueberfaellige_runden($pdo, '2030-03-01 23:09:00');
pruef('KRITISCH: eine Minute vor der Karenzgrenze ist Runde 1 noch nicht ueberfaellig',
    !in_array(1, array_map(fn($z) => (int)$z['id'], $fundVorGrenze['ueberfaellig']), true));

// ── DER VOLLE LAUF: ERKENNUNG + VERSAND + KEIN DOPPEL-PUSH ─────────────
$pdoLauf = neue_pdo();
$pdoLauf->exec("INSERT INTO rundgang_vorlage VALUES (1,1,'Nachtrunde',60)");
$pdoLauf->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id, status, rohzeit_start, pause_minuten) VALUES
    (1, 900, 5, 1, 1, 'laeuft', '2030-04-01 22:00:00', 0)");
$pdoLauf->exec('INSERT INTO mitarbeiter VALUES (5,1), (9,1)');
$pdoLauf->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (9,'waechter')");
$pdoLauf->exec("INSERT INTO push_abo (mitarbeiter_id, kanal, endpunkt) VALUES
    (9, 'webpush', 'https://push.example.invalid/pruef-a'),
    (9, 'webpush', 'https://push.example.invalid/pruef-b')");

$erstesJetzt = '2030-04-01 23:20:00'; // 80 Min Laufzeit, 60 Min Soll -> ueberfaellig
$bilanz1 = alleinarbeiterschutz_stufe1_pruefen($pdoLauf, $erstesJetzt);
pruef('KRITISCH: als eingerichtet erkannt', $bilanz1['eingerichtet'] === true);
pruef('KRITISCH: genau eine ueberfaellige Runde erkannt', $bilanz1['ueberfaellig'] === 1);
pruef('KRITISCH: genau eine Meldung ausgeloest', $bilanz1['gemeldet'] === 1);
pruef('KRITISCH: genau ein Alarmempfaenger ermittelt (der Waechter, nicht die Verwaltung/Testperson 5)',
    $bilanz1['empfaenger'] === 1);
pruef('KRITISCH: fuer jedes seiner zwei Geraete wird ein Zustellversuch gezaehlt',
    $bilanz1['geraete'] === 2);
$z = $pdoLauf->query('SELECT stufe1_gemeldet_um FROM rundgang WHERE id = 1')->fetch();
pruef('KRITISCH: die Runde traegt danach einen Meldezeitpunkt', $z['stufe1_gemeldet_um'] === $erstesJetzt);

// Gegenprobe "kein Doppel-Push": derselbe Zeitgeber-Lauf, spaeter, DARF
// dieselbe Runde nicht ein zweites Mal melden.
$bilanz2 = alleinarbeiterschutz_stufe1_pruefen($pdoLauf, '2030-04-01 23:35:00');
pruef('KRITISCH: derselbe Zeitgeber-Lauf spaeter meldet NICHTS mehr fuer dieselbe Runde',
    $bilanz2['ueberfaellig'] === 0 && $bilanz2['gemeldet'] === 0);

// ── KEIN STILLER RUECKFALL, WENN DIE EINRICHTUNG NICHT GELAUFEN IST ────
$pdoNackt = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$bilanzNackt = alleinarbeiterschutz_stufe1_pruefen($pdoNackt, '2030-04-01 23:35:00');
pruef('KRITISCH: ganz ohne Tabellen gilt es ausdruecklich als NICHT eingerichtet',
    $bilanzNackt['eingerichtet'] === false);
pruef('KRITISCH: und NICHT als "0 ueberfaellig" -- das saehe wie "alles in Ordnung" aus',
    isset($bilanzNackt['meldung']) && $bilanzNackt['meldung'] !== '');

$pdoOhneSpalte = neue_pdo();
$pdoOhneSpalte->exec('ALTER TABLE rundgang RENAME COLUMN stufe1_gemeldet_um TO stufe1_gemeldet_um_alt');
pruef('KRITISCH: fehlt nur die neue Spalte (Migration nicht gelaufen), gilt es ebenfalls als nicht eingerichtet',
    alleinarbeiterschutz_stufe1_pruefen($pdoOhneSpalte, '2030-04-01 23:35:00')['eingerichtet'] === false);

// ── GEGENPROBE: FEHLER IM RECHENKERN DARF DEN MITTEILUNGS-VERSAND NICHT
//    AUFHALTEN (Architektur-Vorgabe Punkt 5, eigenes try/catch in
//    push_versand.php). Geprueft wird die REALE try/catch-Klammer aus der
//    echten Datei -- extrahiert ueber Klammerzaehlung, nicht abgeschrieben,
//    damit eine spaetere Umformulierung die Pruefung nicht wortgleich
//    mitnimmt, sondern nur eine echte strukturelle Aenderung.
$quelleVersand = (string)file_get_contents(__DIR__ . '/../backend/api/push_versand.php');
$anker = strpos($quelleVersand, '$alleinarbeiterschutzBilanz = alleinarbeiterschutz_stufe1_pruefen');
pruef('KRITISCH: push_versand.php ruft alleinarbeiterschutz_stufe1_pruefen() tatsaechlich auf',
    $anker !== false);

/* Findet den try{}catch(Throwable...){}-Block, der $anker WIRKLICH
 * umschliesst -- nicht nur irgendeinen vorangehenden. push_versand.php hat
 * bereits einen fremden try/catch davor (Support-Nachlauf, ENT-538); der
 * naheliegende "strrpos nach 'try {' davor" faende DESSEN Klammer, auch
 * wenn der eigene try/catch entfernt wuerde, und liesse die Gegenprobe
 * unbemerkt durchgehen -- genau die Falle, vor der CLAUDE.md warnt. Darum
 * werden ALLE 'try {'-Fundstellen der Reihe nach durchprobiert und deren
 * Spanne per Klammerzaehlung bestimmt; nur ein Treffer, dessen Spanne
 * $anker tatsaechlich UMSCHLIESST, zaehlt. */
function pruef_umschliessender_catch(string $quelle, int $anker): ?string
{
    $von = 0;
    while (($tryStart = strpos($quelle, 'try {', $von)) !== false && $tryStart < $anker) {
        $pos = $tryStart + strlen('try {');
        $tiefe = 1;
        while ($tiefe > 0 && $pos < strlen($quelle)) {
            if ($quelle[$pos] === '{') { $tiefe++; }
            if ($quelle[$pos] === '}') { $tiefe--; }
            $pos++;
        }
        $tryEnde = $pos;
        if ($anker >= $tryStart && $anker < $tryEnde) {
            return substr($quelle, $tryEnde, 400);
        }
        $von = $tryStart + 1;
    }
    return null;
}
$stueckDanach = pruef_umschliessender_catch($quelleVersand, $anker !== false ? $anker : 0);
pruef('KRITISCH: der Aufruf steht innerhalb eines try-Blocks, der ihn WIRKLICH umschliesst '
    . '(nicht nur eines vorangehenden, fremden try/catch)', $stueckDanach !== null);
if ($stueckDanach !== null) {
    pruef('KRITISCH: direkt danach folgt ein catch (Throwable...)',
        (bool)preg_match('/^\s*catch\s*\(\s*Throwable/', $stueckDanach));
}

// ── DIE ANTWORT TRAEGT DAS FELD IN ALLEN DREI RUECKGABEPFADEN ──────────
// Nicht der Wortlaut wird geprueft, sondern dass jede der drei
// json_response(...)-Antworten den Schluessel 'alleinarbeiterschutz' als
// eigenen Array-Eintrag traegt -- ueber Klammerzaehlung je Fundstelle
// extrahiert, nicht per Text-Ausschnitt geraten.
function pruef_json_response_auszuege(string $quelle): array
{
    $auszuege = [];
    $von = 0;
    while (($p = strpos($quelle, 'json_response([', $von)) !== false) {
        $start = $p + strlen('json_response(');
        $tiefe = 0;
        $pos = $start;
        do {
            if ($quelle[$pos] === '[') { $tiefe++; }
            if ($quelle[$pos] === ']') { $tiefe--; }
            $pos++;
        } while ($tiefe > 0 && $pos < strlen($quelle));
        $auszuege[] = substr($quelle, $start, $pos - $start);
        $von = $pos;
    }
    return $auszuege;
}
// Nur die Antwortpfade NACH dem Support-/Alleinarbeiterschutz-Block sind
// gemeint (die beiden Zeitgeber-Fehlerantworten ganz am Anfang der Datei
// kennen $supportNachlauf noch gar nicht -- am Vorkommen von 'support'
// unterschieden, nicht an ihrer Position im Text).
$antworten = array_values(array_filter(
    pruef_json_response_auszuege($quelleVersand),
    fn($a) => str_contains($a, "'support'")
));
pruef('KRITISCH: push_versand.php hat genau drei Rueckgabepfade nach der Einrichtungspruefung '
    . '(Tabellen fehlen, nicht konfiguriert, regulaer)',
    count($antworten) === 3);
foreach ($antworten as $i => $a) {
    pruef("KRITISCH: Antwortpfad " . ($i + 1) . " traegt 'alleinarbeiterschutz'",
        str_contains($a, "'alleinarbeiterschutz'"));
}

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
