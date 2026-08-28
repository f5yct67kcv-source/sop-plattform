<?php
// Rechnung als bezahlt markieren oder zurueknehmen (ENT-181).
//
// Einfache bezahlt/nicht-bezahlt-Markierung statt Teilzahlungen (Entscheid
// des Projektinhabers, 28.08.2026) -- "Offener Betrag" in der Liste ist
// damit entweder 0 oder der volle Rechnungsbetrag. Ein eigener Endpunkt statt
// eines Feldes in beleg_speichern.php, gleiches Muster wie beleg_status.php
// und beleg_archivieren.php: eine bewusste, einzelne Handlung, kein Feld, das
// beim routinemaessigen Speichern versehentlich mitwandert.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'offerten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$bezahlt = !empty($in['bezahlt']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = db();
$chk = $pdo->prepare('SELECT id FROM belege WHERE id = ?');
$chk->execute([$id]);
if (!$chk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}
$bezahltAm = $bezahlt ? date('Y-m-d') : null;
$pdo->prepare('UPDATE belege SET bezahlt = ?, bezahlt_am = ? WHERE id = ?')
    ->execute([$bezahlt, $bezahltAm, $id]);

json_response(['status' => 'ok', 'bezahlt' => $bezahlt, 'bezahlt_am' => $bezahltAm]);
