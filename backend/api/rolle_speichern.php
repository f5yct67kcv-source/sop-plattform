<?php
declare(strict_types=1);
// Ein eigenes Profil anlegen oder aendern (ENT-440).
//
// Systemrollen kommen hier nicht durch -- die Sperre sitzt in
// rolle_speichern() im Rechtekern und nicht hier, damit sie fuer jeden Weg
// gilt und nicht nur fuer diesen Endpunkt.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'rechte_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$schluessel = isset($input['schluessel']) ? trim((string)$input['schluessel']) : '';
$titel      = (string)($input['titel'] ?? '');
$text       = trim((string)($input['text'] ?? ''));
$stufen     = is_array($input['stufen'] ?? null) ? $input['stufen'] : [];

$ergebnis = rolle_speichern(db(), $schluessel === '' ? null : $schluessel,
    $titel, $text, $stufen, $user);

if (isset($ergebnis['fehler'])) {
    json_response(['status' => 'error', 'message' => $ergebnis['fehler']], 400);
}
json_response(['status' => 'ok', 'schluessel' => $ergebnis['schluessel']]);
