<?php
declare(strict_types=1);
// Liefert den Beleg EINES EIGENEN Speseneintrags aus (ENT-413).
//
// Getrennt von meine_spesen.php, weil dieser Endpunkt Binaerdaten statt
// JSON zurueckgibt -- gleiches Vorgehen wie ereignis_foto.php.
//
// Strikt auf die eigene Person begrenzt (mitarbeiter_id aus der Sitzung),
// darum in der NUR_EIGENE_DATEN-Liste von test_php.mjs. Die Verwaltung holt
// denselben Beleg ueber spesen_beleg.php, dort mit Rechtepruefung.
//
// WICHTIG zur Einbindung: Der Sitzungs-Token darf NICHT in die URL (er
// landet sonst in Server-Protokollen und im Browserverlauf, siehe
// test_php.mjs). Ein schlichtes <img src="..."> funktioniert deshalb nicht;
// die Oberflaeche holt den Beleg per fetch() samt Token und setzt ihn als
// Objekt-URL ein.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
$ich = (int)$user['id'];

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 422);
}

$pdo = db();
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'error', 'message' => 'nicht gefunden'], 404);
}

// mitarbeiter_id in der WHERE-Bedingung, nicht erst im Vergleich danach:
// Ein fremder Beleg wird gar nicht erst gelesen.
$stmt = $pdo->prepare('SELECT beleg, beleg_mime FROM spesen WHERE id = ? AND mitarbeiter_id = ?');
$stmt->execute([$id, $ich]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r || $r['beleg'] === null || $r['beleg_mime'] === null) {
    json_response(['status' => 'error', 'message' => 'Zu diesem Eintrag gibt es keinen Beleg'], 404);
}

spesen_beleg_kopfzeilen($r['beleg_mime'], strlen($r['beleg']), 'Beleg-' . $id);
echo $r['beleg'];
