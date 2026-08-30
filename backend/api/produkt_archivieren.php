<?php
// Produkt archivieren oder zurueckholen (ENT-181). Kein Loeschen -- bereits
// erfasste Positionen verweisen per produkt_id darauf, und auch wenn dieser
// Verweis ins Leere zeigen darf (ON DELETE SET NULL), waere die Auswertung
// "wie oft haben wir das offeriert" danach still um diese Faelle aermer.
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
$aktiv = !empty($in['aktiv']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = db();
$chk = $pdo->prepare('SELECT id FROM produkte WHERE id = ?');
$chk->execute([$id]);
if (!$chk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Leistung nicht gefunden'], 404);
}
$pdo->prepare('UPDATE produkte SET aktiv = ? WHERE id = ?')->execute([$aktiv, $id]);

json_response(['status' => 'ok', 'aktiv' => $aktiv]);
