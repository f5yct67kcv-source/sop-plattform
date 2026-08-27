<?php
// Einen eigenen Rundgang endgueltig abbrechen (ENT-146). Anders als Pausieren
// nicht mehr fortsetzbar. Verlangt zwingend einen Grund aus einer der vier
// festen Kategorien (RUNDGANG_ABBRUCH_GRUENDE), optional ergaenzt durch
// Freitext -- das UX-Sicherheitsmuster (Beenden -> Dialog -> zweiter,
// expliziter Klick) liegt in app.html, nicht hier; der Server verlangt aber
// unabhaengig davon denselben Pflichtgrund, sonst waere die Sperre nur eine
// Oberflaechen-Hoeflichkeit. Bereits erfasste Kontrollpunkt-Scans bleiben
// unangetastet (ENT-146 Punkt 3).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$rundgangId = (int)($input['rundgang_id'] ?? 0);
$grund = (string)($input['grund'] ?? '');
$freitext = trim((string)($input['freitext'] ?? ''));
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}
if (!array_key_exists($grund, RUNDGANG_ABBRUCH_GRUENDE)) {
    json_response(['status' => 'error', 'message' => 'Grund erforderlich'], 422);
}

$pdo = db();

$r = $pdo->prepare('SELECT * FROM rundgang WHERE id = ? AND mitarbeiter_id = ?');
$r->execute([$rundgangId, (int)$user['id']]);
$rundgang = $r->fetch();
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang gehoert nicht zu dir'], 404);
}
if (in_array($rundgang['status'], ['abgeschlossen', 'abgebrochen'], true)) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang ist bereits beendet'], 409);
}

// War er gerade pausiert, zaehlt die laufende Pause noch zur Summe -- sonst
// wuerde die letzte, angebrochene Pause unter den Tisch fallen.
$pdo->prepare(
    "UPDATE rundgang SET status = 'abgebrochen',
      pause_minuten = pause_minuten + CASE WHEN pausiert_seit IS NOT NULL
        THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, pausiert_seit, NOW())) ELSE 0 END,
      pausiert_seit = NULL, abbruch_grund = ?, abbruch_freitext = ?, abgebrochen_am = NOW()
     WHERE id = ?"
)->execute([$grund, $freitext !== '' ? $freitext : null, $rundgangId]);

json_response(['status' => 'ok']);
