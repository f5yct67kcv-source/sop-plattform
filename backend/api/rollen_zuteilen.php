<?php
declare(strict_types=1);
// Profile einer Person zuteilen -- von der zentralen Seite aus (ENT-440).
//
// EIGENER Endpunkt und nicht mitarbeiter_update.php: Jener verlangt
// 'personal_schreiben', weil er die ganze Personalakte schreibt. Die
// Zuteilung braucht das nicht -- wer Rollen vergibt, muss darum nicht auch
// Geburtsdaten aendern duerfen. Umgekehrt gilt weiterhin: Wer die Akte
// schreiben darf, vergibt damit noch keine Rollen (Pruefung dort).
//
// Der Aussperrschutz sitzt in rechte_setzen() und laesst sich hier nicht
// uebergehen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'rechte_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$zielId = (int)($input['mitarbeiter_id'] ?? 0);
$rollen = is_array($input['rollen'] ?? null) ? array_map('strval', $input['rollen']) : null;
if ($zielId <= 0 || $rollen === null) {
    json_response(['status' => 'error', 'message' => 'mitarbeiter_id und rollen erforderlich'], 400);
}

$da = db()->prepare('SELECT id FROM mitarbeiter WHERE id = ?');
$da->execute([$zielId]);
if (!$da->fetch()) {
    json_response(['status' => 'error', 'message' => 'Diese Person gibt es nicht.'], 404);
}

$fehler = rechte_setzen(db(), $zielId, $rollen, $user);
if ($fehler) {
    json_response(['status' => 'error', 'message' => $fehler], 400);
}
json_response(['status' => 'ok']);
