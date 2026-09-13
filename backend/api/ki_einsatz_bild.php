<?php
// Liest einen Einsatz aus einem hochgeladenen Bild heraus (ENT-032) --
// Screenshot einer Kunden-E-Mail, eines Auftragszettels o.ae. Schreibt
// nichts: das Ergebnis oeffnet den bekannten "Neuer Einsatz"-Dialog
// vorbefuellt, gespeichert wird erst nach Pruefung durch den Admin
// (Pruefschritt bleibt Pflicht, auch bei einem Bild -- ENT-015).
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
$bild = trim((string)($input['bild'] ?? ''));
$mimeType = trim((string)($input['mime'] ?? ''));
if ($bild === '') {
    json_response(['status' => 'error', 'message' => 'Bild erforderlich'], 400);
}
// Nur Formate, die das Modell tatsaechlich lesen kann -- ein falsches Format
// waere ein Aufruf, der von vornherein nicht klappen kann.
if (!in_array($mimeType, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], true)) {
    json_response(['status' => 'error', 'message' => 'Nur PNG, JPEG, WEBP oder GIF werden gelesen'], 400);
}
// Grob 6 MB Rohbild (~8 MB als Base64) -- genug fuer einen Screenshot, aber
// eine Grenze, damit ein zu grosses Bild nicht sinnlos lange haengt.
if (strlen($bild) > 8_000_000) {
    json_response(['status' => 'error', 'message' => 'Das Bild ist zu gross (höchstens ca. 6 MB)'], 413);
}
if (base64_decode($bild, true) === false) {
    json_response(['status' => 'error', 'message' => 'Bilddaten ungueltig'], 400);
}

$heute = trim((string)($input['heute'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $heute)) {
    $heute = date('Y-m-d');
}

$kunden = db()->query('SELECT name FROM kunden ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
$mitarbeiter = db()->query(
    'SELECT name, vorname, nachname FROM mitarbeiter WHERE aktiv = 1 ORDER BY name'
)->fetchAll();

$e = anthropic_extract_einsatz_bild($bild, $mimeType, $kunden, $mitarbeiter, $heute);
if ($e === null) {
    ki_fehler_melden();
}
if (!empty($e['unsicher']) && empty($e['kunde_name']) && empty($e['datum'])) {
    json_response([
        'status' => 'error',
        'message' => 'Im Bild liess sich kein Auftrag erkennen. Bitte die Felder von Hand eintragen.',
    ], 422);
}

$felder = [];
foreach (['kunde_name', 'titel', 'strasse', 'ort', 'datum', 'von', 'bis', 'einsatzart', 'bemerkung'] as $f) {
    $wert = trim((string)($e[$f] ?? ''));
    if ($wert !== '') {
        $felder[$f] = $wert;
    }
}
if (isset($e['bedarf']) && (int)$e['bedarf'] > 0) {
    $felder['bedarf'] = min(99, (int)$e['bedarf']);
}
$bekannt = array_column($mitarbeiter, 'name');
$maNamen = array_values(array_intersect(
    array_map('strval', (array)($e['mitarbeiter_login_namen'] ?? [])),
    $bekannt
));

json_response([
    'status' => 'ok',
    'felder' => $felder,
    'mitarbeiter_login_namen' => $maNamen,
    'unsicher' => !empty($e['unsicher']),
]);
