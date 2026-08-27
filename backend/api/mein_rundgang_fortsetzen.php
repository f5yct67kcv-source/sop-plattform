<?php
// Einen pausierten eigenen Rundgang fortsetzen (ENT-146). Die Dauer der
// gerade beendeten Pause wird zu pause_minuten aufaddiert (Projektinhaber-
// Entscheid 2026-08-27: ein kumulierter Zaehler statt einer eigenen Tabelle
// je Pause-Intervall). Der Status geht zurueck auf 'laeuft', wenn bereits ein
// Kontrollpunkt bestaetigt war (rohzeit_start gesetzt), sonst auf
// 'vorbereitet' -- die Rohzeit selbst beginnt weiterhin erst mit dem ersten
// bestaetigten Punkt (ENT-145), ein Pausieren vor Rundgang-Beginn aendert
// daran nichts.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$rundgangId = (int)($input['rundgang_id'] ?? 0);
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}

$pdo = db();

$r = $pdo->prepare('SELECT * FROM rundgang WHERE id = ? AND mitarbeiter_id = ?');
$r->execute([$rundgangId, (int)$user['id']]);
$rundgang = $r->fetch();
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang gehoert nicht zu dir'], 404);
}
if ($rundgang['status'] !== 'pausiert') {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang ist nicht pausiert'], 409);
}

$neuerStatus = $rundgang['rohzeit_start'] !== null ? 'laeuft' : 'vorbereitet';
$pdo->prepare(
    "UPDATE rundgang SET status = ?, pause_minuten = pause_minuten + GREATEST(0, TIMESTAMPDIFF(MINUTE, pausiert_seit, NOW())),
      pausiert_seit = NULL WHERE id = ?"
)->execute([$neuerStatus, $rundgangId]);

json_response(['status' => 'ok', 'rundgang_status' => $neuerStatus]);
