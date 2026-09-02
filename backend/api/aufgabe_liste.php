<?php
// Aufgabenkatalog eines Objekts samt Zuordnung zu den Kontrollpunkten
// (ENT-302).
//
// Beides in EINER Antwort, nicht in zwei Abfragen: Das Seitenfenster eines
// Kontrollpunkts braucht immer beides -- was es an Aufgaben gibt und welche
// an diesem Punkt haengen. Zwei Endpunkte hiessen zwei Anfragen fuer eine
// Maske.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$objektId = isset($_GET['objekt_id']) ? (int)$_GET['objekt_id'] : 0;
if ($objektId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 400);
}

$pdo = db();
// Ohne die Tabellen ist die Einrichtung noch nicht gelaufen. Das ist etwas
// anderes als "keine Aufgaben angelegt" und wird darum auch anders
// beantwortet -- die Oberflaeche kann sonst nicht sagen, was los ist.
if (!hat_tabelle($pdo, 'objekt_aufgabe') || !hat_tabelle($pdo, 'kontrollpunkt_aufgabe')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'aufgaben' => [], 'zuordnung' => []]);
}

$stmt = $pdo->prepare(
    'SELECT id, objekt_id, bezeichnung, information, aktiv
     FROM objekt_aufgabe WHERE objekt_id = ? AND aktiv = 1 ORDER BY bezeichnung, id'
);
$stmt->execute([$objektId]);
$aufgaben = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Zuordnung nur fuer Punkte DIESES Objekts -- ueber den Join, nicht ueber
// eine Liste von ids aus dem Browser.
$stmt = $pdo->prepare(
    'SELECT ka.kontrollpunkt_id, ka.aufgabe_id
     FROM kontrollpunkt_aufgabe ka
     JOIN kontrollpunkt k ON k.id = ka.kontrollpunkt_id
     JOIN objekt_aufgabe a ON a.id = ka.aufgabe_id AND a.aktiv = 1
     WHERE k.objekt_id = ?
     ORDER BY ka.reihenfolge, ka.id'
);
$stmt->execute([$objektId]);
$zuordnung = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $z) {
    $zuordnung[(string)(int)$z['kontrollpunkt_id']][] = (int)$z['aufgabe_id'];
}

json_response(['status' => 'ok', 'eingerichtet' => true,
    'aufgaben' => $aufgaben, 'zuordnung' => (object)$zuordnung]);
