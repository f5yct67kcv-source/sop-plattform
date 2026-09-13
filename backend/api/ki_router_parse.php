<?php
// Ordnet einen diktierten oder getippten Text einem Bereich zu (ENT-032).
// Schreibt nichts -- das Ergebnis oeffnet nur den passenden bestehenden
// Dialog bzw. die Bearbeiten-Schublade, vorbefuellt wie zuvor bei den
// seitengebundenen Einzel-Diktaten.
//
// Deckt die Neuanlage aller drei Bereiche ab, und seit ENT-042 zusaetzlich
// die AENDERUNG eines bestehenden Mitarbeitenden -- fuer Kunde/Einsatz gibt
// es das bewusst weiterhin nicht (siehe ai.php).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../ai.php';

$user = require_session();
require_recht($user, 'einsaetze_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim((string)($input['text'] ?? ''));
if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Text erforderlich'], 400);
}
$heute = trim((string)($input['heute'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $heute)) {
    $heute = date('Y-m-d');
}

$kunden = db()->query('SELECT name FROM kunden ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
$mitarbeiter = db()->query(
    'SELECT name, vorname, nachname FROM mitarbeiter WHERE aktiv = 1 ORDER BY name'
)->fetchAll();

$e = anthropic_route_diktat($text, $kunden, $mitarbeiter, $heute);
if ($e === null) {
    ki_fehler_melden();
}

$bereich = (string)($e['bereich'] ?? '');
if (!in_array($bereich, ['mitarbeiter', 'kunde', 'einsatz'], true)) {
    json_response([
        'status' => 'error',
        'message' => 'Konnte keinem Bereich zugeordnet werden -- bitte im jeweiligen Bereich direkt diktieren.',
    ], 422);
}

// "aendern" gibt es nur bei Mitarbeitenden -- fuer Kunde und Einsatz bleibt
// es bei der Neuanlage, dafuer gab es auch vorher keinen eigenen Diktat-Weg.
$aktion = ($bereich === 'mitarbeiter' && ($e['aktion'] ?? 'neu') === 'aendern') ? 'aendern' : 'neu';

if ($aktion === 'aendern') {
    $aenderung = (array)($e['mitarbeiter_aenderung'] ?? []);
    $loginName = trim((string)($aenderung['mitarbeiter_login_name'] ?? ''));
    // Erkannten Login-Namen gegen die tatsaechliche Liste verifizieren -- die
    // KI soll nur zuordnen, nie einen neuen/falschen Namen erfinden.
    $bekannt = array_column($mitarbeiter, 'name');
    if ($loginName === '' || !in_array($loginName, $bekannt, true)) {
        json_response([
            'status' => 'error',
            'message' => 'Die gemeinte Person liess sich nicht eindeutig zuordnen -- bitte im Mitarbeitenden-Bereich direkt diktieren.',
        ], 422);
    }
    json_response([
        'status' => 'ok',
        'bereich' => $bereich,
        'aktion' => 'aendern',
        'mitarbeiter_login_name' => $loginName,
        'aenderungen' => (array)($aenderung['aenderungen'] ?? []),
    ]);
}

if ($bereich === 'mitarbeiter') {
    json_response(['status' => 'ok', 'bereich' => $bereich, 'aktion' => 'neu', 'felder' => (array)($e['mitarbeiter'] ?? [])]);
}
if ($bereich === 'kunde') {
    json_response(['status' => 'ok', 'bereich' => $bereich, 'aktion' => 'neu', 'felder' => (array)($e['kunde'] ?? [])]);
}

// bereich === 'einsatz': dieselbe Filterung wie frueher in ki_einsatz_parse.php --
// nur bekannte Login-Namen duerfen als Zuteilung in die Oberflaeche gelangen.
$roh = (array)($e['einsatz'] ?? []);
$felder = [];
foreach (['kunde_name', 'titel', 'strasse', 'ort', 'datum', 'von', 'bis', 'einsatzart', 'bemerkung'] as $f) {
    $wert = trim((string)($roh[$f] ?? ''));
    if ($wert !== '') {
        $felder[$f] = $wert;
    }
}
if (isset($roh['bedarf']) && (int)$roh['bedarf'] > 0) {
    $felder['bedarf'] = min(99, (int)$roh['bedarf']);
}
$bekannt = array_column($mitarbeiter, 'name');
$maNamen = array_values(array_intersect(
    array_map('strval', (array)($roh['mitarbeiter_login_namen'] ?? [])),
    $bekannt
));

json_response([
    'status' => 'ok',
    'bereich' => $bereich,
    'aktion' => 'neu',
    'felder' => $felder,
    'mitarbeiter_login_namen' => $maNamen,
]);
