<?php
// Liefert das Foto einer Fahrzeugübernahme aus (ENT-346).
//
// Gleicher Aufbau wie ereignis_foto.php: Der Sitzungs-Token darf NICHT in
// die URL (Server-Protokolle, Browserverlauf -- geprüft in test_php.mjs),
// darum holt die Oberfläche das Bild per fetch() samt Token und setzt es
// als Objekt-URL ein, statt es direkt als <img src> einzubinden.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'betrieb');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 422);
}

$pdo = db();
if (!hat_tabelle($pdo, 'fahrzeug_uebernahme')) {
    json_response(['status' => 'error', 'message' => 'nicht gefunden'], 404);
}

$stmt = $pdo->prepare('SELECT foto, foto_mime FROM fahrzeug_uebernahme WHERE id = ?');
$stmt->execute([$id]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r || $r['foto'] === null || $r['foto_mime'] === null) {
    json_response(['status' => 'error', 'message' => 'Zu dieser Übernahme gibt es kein Foto'], 404);
}

// Der Mimetyp stammt aus der Prüfung beim Speichern (erste Bytes, nicht die
// Angabe des Absenders, siehe fz_foto_mime()/ersatzscan_foto_mime()) und ist
// auf JPEG/PNG begrenzt -- er kann hier ohne weitere Prüfung als Kopfzeile
// gesetzt werden.
header('Content-Type: ' . $r['foto_mime']);
header('Content-Length: ' . strlen($r['foto']));
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
echo $r['foto'];
