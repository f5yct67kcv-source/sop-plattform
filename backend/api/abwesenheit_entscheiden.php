<?php
declare(strict_types=1);
// Einen Abwesenheitsantrag genehmigen oder ablehnen (ENT-255).
//
// require_recht statt require_verwaltung: Genehmigen ist Teil der
// Personalarbeit, kein Betriebseinstellungs-Vorgang (siehe rechte.php,
// Rolle "Personal" traegt bereits personal_schreiben).
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../ferien.php';

$user = require_session();
require_recht($user, 'personal_schreiben');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$status = trim((string)($in['status'] ?? ''));
$grund = trim((string)($in['ablehnung_grund'] ?? ''));

if (!in_array($status, ['genehmigt', 'abgelehnt'], true)) {
    json_response(['status' => 'error', 'message' => 'Status muss genehmigt oder abgelehnt sein'], 400);
}
if ($status === 'abgelehnt' && $grund === '') {
    json_response(['status' => 'error', 'message' => 'Eine Ablehnung braucht eine Begruendung'], 400);
}
if (mb_strlen($grund) > 500) { $grund = mb_substr($grund, 0, 500); }

$pdo = db();
$s = $pdo->prepare('SELECT id FROM abwesenheiten WHERE id = ?');
$s->execute([$id]);
if (!$s->fetch()) {
    json_response(['status' => 'error', 'message' => 'Antrag nicht gefunden'], 404);
}

// Erneutes Entscheiden ueberschreibt bewusst, statt eine eigene
// Korrektur-Historie zu verlangen -- dieselbe Handhabung wie an anderen
// Stellen im Werkzeug (z. B. beleg_status.php), keine neue Ausnahme.
$pdo->prepare(
    "UPDATE abwesenheiten SET status = ?, ablehnung_grund = ?,
     entschieden_von = ?, entschieden_am = NOW(), gesehen_am = NOW()
     WHERE id = ?"
)->execute([$status, $status === 'abgelehnt' ? $grund : null, (int)$user['id'], $id]);

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status]);
