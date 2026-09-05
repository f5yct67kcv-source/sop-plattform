<?php
declare(strict_types=1);
// Einen eingereichten Spesenbeleg freigeben oder ablehnen (ENT-413).
//
// require_recht('personal_schreiben') aus demselben Grund wie in
// spesen_list.php und abwesenheit_entscheiden.php: Der Entscheid betrifft
// den Anspruch einer einzelnen Person, das ist Personalarbeit -- und der
// Rechtekatalog bleibt bewusst grob (rechte.php).
//
// Was hier NICHT passiert: Es wird kein Betrag berechnet, nichts an einen
// Lohnlauf uebergeben und nichts als bezahlt vermerkt. Eine Freigabe sagt
// "der Beleg ist anerkannt", nicht "das Geld ist geflossen" -- zwei
// verschiedene Aussagen, und die zweite hat noch niemand entschieden.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
require_recht($user, 'personal_schreiben');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$status = trim((string)($in['status'] ?? ''));
$grund = trim((string)($in['ablehnung_grund'] ?? ''));
if (mb_strlen($grund) > 500) { $grund = mb_substr($grund, 0, 500); }

$pdo = db();
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'error', 'message' => 'Der Spesenbereich ist noch nicht eingerichtet'], 404);
}

// Entschieden wird in backend/spesen.php -- diese Datei uebersetzt nur
// zwischen HTTP und Regel. Jede Absage nennt ihren Grund beim Namen.
$ergebnis = spesen_entscheiden($pdo, (int)$user['id'], $id, $status, $grund);
if ($ergebnis !== 'ok') {
    $texte = [
        'status_unbekannt'  => ['Status muss freigegeben oder abgelehnt sein', 400],
        'grund_fehlt'       => ['Eine Ablehnung braucht eine Begründung', 400],
        'nicht_gefunden'    => ['Beleg nicht gefunden', 404],
        'nicht_eingereicht' => ['Dieser Beleg ist noch nicht eingereicht.', 409],
    ];
    [$text, $code] = $texte[$ergebnis] ?? ['Das ist so nicht möglich.', 400];
    json_response(['status' => 'error', 'grund' => $ergebnis, 'message' => $text], $code);
}

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status]);
