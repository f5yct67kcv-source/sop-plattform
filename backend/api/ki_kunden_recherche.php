<?php
// Ermittelt Kundenstammdaten aus einem kurzen Satz und ergaenzt fehlende
// Angaben per Internetrecherche (ENT-019). Schreibt nichts in die Datenbank --
// das Ergebnis fuellt nur das Anlegen-Formular vor.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../ai.php';
require __DIR__ . '/../kunden.php'; // plz_ort_trennen()

$user = require_session();
require_recht($user, 'kunden_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

// Die Suche laeuft deutlich laenger als eine reine Feldextraktion.
set_time_limit(150);

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim((string)($input['text'] ?? ''));
if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Text erforderlich'], 400);
}

$ergebnis = anthropic_recherche_kunde($text);
if ($ergebnis === null) {
    json_response(['status' => 'error', 'message' => 'Recherche nicht verfuegbar oder ohne Ergebnis'], 502);
}

$felder = [];
foreach (['name', 'strasse', 'hausnummer', 'plz', 'ort', 'telefon', 'email', 'webseite', 'uid'] as $f) {
    $wert = trim((string)($ergebnis[$f] ?? ''));
    if ($wert !== '') {
        $felder[$f] = $wert;
    }
}

// Notnagel, falls das Modell PLZ und Ort trotz der Feldbeschreibung zusammen
// liefert -- lieber hier sauber trennen als eine "4652 Winznau"-Zeile im
// reinen Ortsfeld stehen lassen (ENT-044).
$recherchiert = array_map('strval', (array)($ergebnis['recherchiert'] ?? []));
if (isset($felder['ort']) && !isset($felder['plz'])) {
    [$plz, $ort] = plz_ort_trennen($felder['ort']);
    if ($plz !== '') {
        $felder['plz'] = $plz;
        $felder['ort'] = $ort;
        // Die PLZ stammt dann aus derselben Quelle wie der Ort und muss
        // genauso gelb gekennzeichnet werden.
        if (in_array('ort', $recherchiert, true)) { $recherchiert[] = 'plz'; }
    }
}

// Nur Quellen mit http(s) durchlassen -- der Wert geht als Link in die Oberflaeche.
$quellen = [];
foreach ((array)($ergebnis['quellen'] ?? []) as $q) {
    $q = trim((string)$q);
    if (preg_match('~^https?://~i', $q)) {
        $quellen[] = $q;
    }
}

json_response([
    'status' => 'ok',
    'felder' => $felder,
    'recherchiert' => array_values(array_intersect($recherchiert, array_keys($felder))),
    'quellen' => array_slice($quellen, 0, 3),
]);
