<?php
declare(strict_types=1);
// Sammelimport von Kundenstammdaten aus einer CSV-Datei (ENT-066).
//
// Bewusst KEINE eigene Speicherlogik: Jede Zeile laeuft durch dasselbe
// kunden_eingabe_lesen() wie das Anlegen von Hand. Ein zweiter Weg in die
// Tabelle waere ein zweites Regelwerk, das irgendwann auseinanderlaeuft --
// und der Import ist genau die Stelle, an der Fehler nicht einzeln, sondern
// hundertfach entstehen.
//
// Die Datei selbst kommt nie hier an. Der Browser liest sie, ordnet die
// Spalten zu und schickt fertige Zeilen als JSON. Das spart Upload-Grenzen
// und Zwischendateien auf dem Server, und die Kundendaten liegen zu keinem
// Zeitpunkt unbeaufsichtigt im Dateisystem.
//
// Zwei Durchlaeufe, gleiche Pruefungen:
//   modus = 'pruefen'  -- rechnet alles durch, schreibt nichts
//   modus = 'anwenden' -- schreibt in einer einzigen Transaktion
// Der Trockenlauf muss dieselben Zahlen liefern wie der echte, sonst ist die
// Vorschau wertlos.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../kunden.php';

$user = require_session();
require_recht($user, 'kunden_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

const IMPORT_MAX_ZEILEN = 2000;

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$modus  = ($input['modus'] ?? 'pruefen') === 'anwenden' ? 'anwenden' : 'pruefen';
$zeilen = $input['zeilen'] ?? [];

if (!is_array($zeilen) || count($zeilen) === 0) {
    json_response(['status' => 'error', 'message' => 'keine Zeilen uebergeben'], 400);
}
if (count($zeilen) > IMPORT_MAX_ZEILEN) {
    json_response(['status' => 'error',
        'message' => 'hoechstens ' . IMPORT_MAX_ZEILEN . ' Zeilen je Durchgang'], 400);
}

// Vergleichsschluessel fuer die Dublettenpruefung: Name und PLZ, kleingeschrieben
// und ohne Mehrfach-Leerzeichen. Die Kundennummer taugt dafuer NICHT -- sie wird
// nach ENT-040 ausschliesslich vom System vergeben, eine mitgelieferte Nummer aus
// einem Vorsystem ist also nie dieselbe wie die hiesige.
$schluessel = function (string $name, string $plz): string {
    $n = mb_strtolower(trim(preg_replace('/\s+/u', ' ', $name) ?? ''), 'UTF-8');
    return $n . '|' . trim($plz);
};

$pdo = db();

// Bestand einmal laden statt je Zeile zu fragen: bei mehreren hundert Zeilen
// waeren das sonst ebenso viele Abfragen.
$bestand = [];
foreach ($pdo->query('SELECT name, plz FROM kunden')->fetchAll(PDO::FETCH_ASSOC) as $k) {
    $bestand[$schluessel((string)$k['name'], (string)$k['plz'])] = true;
}

$neu = [];            // die tatsaechlich anzulegenden Zeilen
$uebersprungen = [];  // Dubletten -- kein Fehler, sondern der Normalfall bei Nachimporten
$fehler = [];         // unvollstaendige Zeilen
$imLauf = [];         // Dubletten INNERHALB der Datei

foreach ($zeilen as $i => $roh) {
    // Zeilennummer aus Sicht des Anwenders: Kopfzeile ist 1, Daten ab 2.
    $nr = $i + 2;
    if (!is_array($roh)) {
        $fehler[] = ['zeile' => $nr, 'name' => '', 'grund' => 'unlesbare Zeile'];
        continue;
    }

    $gelesen = kunden_eingabe_lesen($roh);
    $s = $gelesen['spalten'];

    // Dieselben Pflichtfelder wie in kunden_create.php (ENT-044).
    if ($s['name'] === '') {
        $fehler[] = ['zeile' => $nr, 'name' => '', 'grund' => 'Name fehlt'];
        continue;
    }
    if ($s['plz'] === '' || $s['ort'] === '') {
        $fehler[] = ['zeile' => $nr, 'name' => $s['name'],
            'grund' => $s['plz'] === '' && $s['ort'] === '' ? 'PLZ und Ort fehlen'
                     : ($s['plz'] === '' ? 'PLZ fehlt' : 'Ort fehlt')];
        continue;
    }

    $key = $schluessel($s['name'], $s['plz']);
    if (isset($bestand[$key])) {
        $uebersprungen[] = ['zeile' => $nr, 'name' => $s['name'],
            'grund' => 'gibt es bereits'];
        continue;
    }
    if (isset($imLauf[$key])) {
        $uebersprungen[] = ['zeile' => $nr, 'name' => $s['name'],
            'grund' => 'steht in dieser Datei doppelt (zuerst in Zeile ' . $imLauf[$key] . ')'];
        continue;
    }
    $imLauf[$key] = $nr;
    $neu[] = ['zeile' => $nr, 'spalten' => $s];
}

$bericht = [
    'status'        => 'ok',
    'modus'         => $modus,
    'gelesen'       => count($zeilen),
    'neu'           => count($neu),
    'uebersprungen' => $uebersprungen,
    'fehler'        => $fehler,
    'vorschau'      => array_map(fn($z) => [
        'zeile' => $z['zeile'],
        'name'  => $z['spalten']['name'],
        'plz'   => $z['spalten']['plz'],
        'ort'   => $z['spalten']['ort'],
    ], array_slice($neu, 0, 20)),
];

if ($modus === 'pruefen' || count($neu) === 0) {
    $bericht['angelegt'] = 0;
    json_response($bericht);
}

// Alles oder nichts. Ein halb durchgelaufener Import waere schlimmer als
// keiner: Man wuesste nicht, ab welcher Zeile man neu ansetzen muss.
$pdo->beginTransaction();
try {
    $felder = array_keys($neu[0]['spalten']);
    $stmt = $pdo->prepare(
        'INSERT INTO kunden (kundennummer, ' . implode(', ', $felder) . ', aktiv) VALUES (?'
        . str_repeat(', ?', count($felder)) . ', 1)'
    );
    $nummern = [];
    foreach ($neu as $z) {
        // Innerhalb der Transaktion sieht jede Abfrage die vorherigen Inserts,
        // die Nummern laufen also fortlaufend weiter (ENT-040).
        $nummer = naechste_kundennummer($pdo);
        $stmt->execute(array_merge([$nummer], array_values($z['spalten'])));
        $nummern[] = $nummer;
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

$bericht['angelegt']    = count($neu);
$bericht['von_nummer']  = $nummern[0] ?? '';
$bericht['bis_nummer']  = $nummern[count($nummern) - 1] ?? '';
json_response($bericht);
