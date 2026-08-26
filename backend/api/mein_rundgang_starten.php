<?php
// Startet einen Rundgang fuer den eigenen, zugeteilten Einsatz
// (ENT-132/ENT-145/ENT-180). Die Rohzeit beginnt NICHT hier, sondern erst
// mit dem ersten bestaetigten Kontrollpunkt -- siehe mein_rundgang_scan.php.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$einsatzId = (int)($input['einsatz_id'] ?? 0);
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id erforderlich'], 422);
}

$pdo = db();

// Nur die eigene Zuteilung -- mitarbeiter_id kommt aus der Sitzung, nie aus
// dem Rumpf (gleiches Prinzip wie meine_zusage.php).
$chk = $pdo->prepare(
    'SELECT e.objekt_id FROM einsaetze e
      JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     WHERE e.id = ? AND z.mitarbeiter_id = ?'
);
$chk->execute([$einsatzId, (int)$user['id']]);
$einsatz = $chk->fetch();
if (!$einsatz) {
    json_response(['status' => 'error', 'message' => 'Dieser Einsatz gehoert nicht zu dir'], 404);
}
$objektId = $einsatz['objekt_id'] !== null ? (int)$einsatz['objekt_id'] : 0;
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'Dieser Einsatz hat kein Objekt -- kein Rundgang moeglich'], 422);
}

// Kein zweiter offener Rundgang fuer denselben Einsatz gleichzeitig --
// mehrere Rundgaenge NACHEINANDER pro Schicht sind vorgesehen (z.B.
// stuendliche Kontrollen), aber nicht parallel.
$offen = $pdo->prepare(
    "SELECT id FROM rundgang WHERE einsatz_id = ? AND mitarbeiter_id = ? AND status IN ('vorbereitet','laeuft')"
);
$offen->execute([$einsatzId, (int)$user['id']]);
if ($offen->fetch()) {
    json_response(['status' => 'error', 'message' => 'Es laeuft bereits ein Rundgang fuer diesen Einsatz'], 409);
}

$ins = $pdo->prepare(
    "INSERT INTO rundgang (einsatz_id, mitarbeiter_id, objekt_id, status, vorbereitet_am)
     VALUES (?, ?, ?, 'vorbereitet', NOW())"
);
$ins->execute([$einsatzId, (int)$user['id'], $objektId]);
$rundgangId = (int)$pdo->lastInsertId();

$kontrollpunkte = rundgang_kontrollpunkte_uebrig($pdo, $rundgangId, $objektId);

json_response(['status' => 'ok', 'rundgang_id' => $rundgangId, 'kontrollpunkte' => $kontrollpunkte]);
