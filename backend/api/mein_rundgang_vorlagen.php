<?php
// Aktive Kontrollrunden-Vorlagen des Objekts zum eigenen Einsatz, fuer die
// Auswahl beim Rundgang-Start (ENT-204). Nur aktive Vorlagen -- eine
// stillgelegte Runde soll nicht mehr antretbar sein, gleiches Prinzip wie
// inaktive Kontrollpunkte bei rundgang_kontrollpunkte_uebrig().
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$einsatzId = isset($_GET['einsatz_id']) ? (int)$_GET['einsatz_id'] : 0;
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id erforderlich'], 422);
}

$pdo = db();

// Nur die eigene Zuteilung -- mitarbeiter_id kommt aus der Sitzung, gleiches
// Prinzip wie mein_rundgang_starten.php.
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

$stmt = $pdo->prepare('SELECT id, name FROM rundgang_vorlage WHERE objekt_id = ? AND aktiv = 1 ORDER BY name, id');
$stmt->execute([$objektId]);
json_response(['status' => 'ok', 'vorlagen' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
