<?php
// Ordnet einen diktierten oder getippten Text einem Bereich zu (ENT-032).
// Schreibt nichts -- das Ergebnis oeffnet nur den passenden bestehenden
// Dialog bzw. die Bearbeiten-Schublade, vorbefuellt wie zuvor bei den
// seitengebundenen Einzel-Diktaten.
//
// Deckt die Neuanlage aller drei Bereiche ab, und seit ENT-042 zusaetzlich
// die AENDERUNG eines bestehenden Mitarbeitenden -- fuer Kunde/Einsatz gibt
// es das bewusst weiterhin nicht (siehe ai.php). Seit ENT-692 sagt der
// Router ehrlich, wenn ein Anliegen (z.B. eine Offerte) nicht dazugehoert,
// statt es in einen der drei Bereiche zu zwingen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../ai.php';

$user = require_session();
require_recht($user, 'einsaetze_schreiben');
require_once __DIR__ . '/../mitarbeiter.php';   // ma_nur_menschen() (ENT-631)
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
    'SELECT name, vorname, nachname FROM mitarbeiter WHERE aktiv = 1 AND ' . ma_nur_menschen(db()) . ' ORDER BY name'
)->fetchAll();

$e = anthropic_route_diktat($text, $kunden, $mitarbeiter, $heute);
if ($e === null) {
    ki_fehler_melden();
}

// Auswertung ohne Netz und Datenbank in ai.php (ENT-692), damit jeder Zweig
// pruefbar ist: Bereich, "anderes"/"unklar", Platzhalter, Login-Namen.
[$code, $antwort] = ki_router_auswerten($e, array_column($mitarbeiter, 'name'));
json_response($antwort, $code);
