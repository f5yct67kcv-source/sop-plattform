<?php
// Wachbuch (ENT-480): die chronologische Chronik des Revierdienstes --
// Kontrollpunkt erfasst, Rundgang erledigt oder abgebrochen, Aufgabe
// beantwortet, Ereignis gemeldet, alles in EINER Zeitleiste.
//
// Reine Anzeige. Der Endpunkt liest, fuehrt zusammen und sortiert; er
// schreibt nichts und rechnet nichts. Die Zusammenfuehrung selbst steht in
// backend/rundgang.php (wachbuch_eintraege) und laeuft dort gegen eine
// wirkliche Datenbank in pruef_wachbuch.php -- hier bleibt nur der Weg
// hinein und hinaus.
//
// EINE Rechtepruefung fuer alle vier Quellen: Sie haengen samt und sonders
// am Bereich 'rundgaenge' ("Rundgaenge & Vorfallmeldungen"). Kaeme eine
// fuenfte Quelle mit einem anderen Recht dazu, saehe dieselbe Liste fuer
// zwei Personen verschieden aus, ohne es zu sagen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
require_recht($user, 'rundgaenge_lesen');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Ohne Zeitraum: der heutige Tag -- gleiche Regel wie rundgang_liste.php und
// rundgang_scan_liste.php. Eine Chronik ohne Eingrenzung waere bei
// wachsender Historie irgendwann alles auf einmal.
$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von)) { $von = $heute; }
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) { $bis = $von; }
// Verdrehte Eingabe still zu akzeptieren hiesse, eine leere Liste zu zeigen,
// die aussieht wie "nichts passiert". Getauscht ist die ehrlichere Antwort.
if ($bis < $von) { [$von, $bis] = [$bis, $von]; }

$objektId = isset($_GET['objekt_id']) && $_GET['objekt_id'] !== '' ? (int)$_GET['objekt_id'] : null;

// Der Art-Filter laeuft im SERVER, nicht im Browser. Waehlte ihn die
// Oberflaeche aus einer bereits gekappten Liste, zeigte sie "2 Ereignisse",
// wo 30 im Zeitraum liegen -- eine gefilterte Zahl, die wie die Gesamtzahl
// aussieht. Nur benannte Arten werden durchgelassen; alles andere faellt
// weg, statt als unbekannter Wert bis in die Abfrage zu laufen.
$arten = array_values(array_intersect(
    array_filter(explode(',', (string)($_GET['arten'] ?? ''))),
    ['scan', 'rundgang', 'aufgabe', 'ereignis']
));

$ergebnis = wachbuch_eintraege(db(), $von, $bis, $objektId, WACHBUCH_GRENZE, $arten);
json_response(['status' => 'ok', 'von' => $von, 'bis' => $bis] + $ergebnis);
