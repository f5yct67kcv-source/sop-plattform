<?php
// Status eines Belegs der Betreiberin setzen (ENT-605).
//
// Bewusst OHNE erzwungene Reihenfolge, wie im Cockpit: Man kann eine Offerte
// auch direkt von "Entwurf" auf "Bestätigt" setzen, etwa wenn sie am Telefon
// zugesagt wurde. Eine Maschine, die einen Ablauf erzwingt, den das Geschaeft
// nicht kennt, wird umgangen -- und dann steht ueberall "versendet", weil es
// der einzige Weg war.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in  = json_decode(file_get_contents('php://input'), true) ?? [];
$id  = (int)($in['id'] ?? 0);
$neu = (string)($in['neuer_status'] ?? '');
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}
if (!beleg_status_gueltig($neu)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Status'], 400);
}

$pdo = betreiber_db();
$s = $pdo->prepare('SELECT status FROM be_belege WHERE id = ?');
$s->execute([$id]);
$alt = $s->fetchColumn();
if ($alt === false) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}

$pdo->prepare('UPDATE be_belege SET status = ? WHERE id = ?')->execute([$neu, $id]);

be_log($pdo, $ich, 'beleg', $id, 'status', (string)$alt, $neu);

json_response(['status' => 'ok', 'alter_status' => $alt, 'neuer_status' => $neu]);
