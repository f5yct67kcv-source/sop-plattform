<?php
// Einen laufenden oder noch nicht begonnenen eigenen Rundgang pausieren
// (ENT-146). Temporaer -- ein pausierter Rundgang laesst sich ueber
// mein_rundgang_fortsetzen.php wieder aufnehmen, im Unterschied zum
// endgueltigen Abbruch (mein_rundgang_abbrechen.php).
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

// Nur der eigene Rundgang -- mitarbeiter_id kommt aus der Sitzung, gleiches
// Prinzip wie die uebrigen mein_rundgang_*.php-Endpunkte.
$r = $pdo->prepare('SELECT * FROM rundgang WHERE id = ? AND mitarbeiter_id = ?');
$r->execute([$rundgangId, (int)$user['id']]);
$rundgang = $r->fetch();
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang gehoert nicht zu dir'], 404);
}
if (!in_array($rundgang['status'], ['vorbereitet', 'laeuft'], true)) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang laesst sich jetzt nicht pausieren'], 409);
}

$pdo->prepare("UPDATE rundgang SET status = 'pausiert', pausiert_seit = NOW() WHERE id = ?")
    ->execute([$rundgangId]);

json_response(['status' => 'ok']);
