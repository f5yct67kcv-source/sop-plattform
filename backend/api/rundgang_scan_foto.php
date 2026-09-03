<?php
// Liefert das Foto eines Ersatzscans aus (ENT-329).
//
// Gleich gebaut wie ereignis_foto.php (ENT-297) -- dort steht im
// Kommentarkopf ausdrücklich: „die Scan-Fotos wären ein eigener, gleich
// aufgebauter Schritt". Das ist dieser Schritt. Die Fotos werden seit
// ENT-182 erfasst und lagen seither in der Datenbank, ohne dass irgendeine
// Ansicht sie zeigen konnte.
//
// WICHTIG zur Einbindung: Der Sitzungs-Token darf NICHT in die URL (er
// landet sonst in Server-Protokollen und im Browserverlauf -- eine
// ausdrücklich geprüfte Regel, siehe test_php.mjs). Ein schlichtes
// <img src="rundgang_scan_foto.php?id=..."> funktioniert deshalb nicht.
// Die Oberfläche holt das Bild per fetch() samt Token und setzt es als
// Objekt-URL ein.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 422);
}

$stmt = db()->prepare('SELECT foto, foto_mime FROM rundgang_scan WHERE id = ?');
$stmt->execute([$id]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r || $r['foto'] === null || $r['foto_mime'] === null) {
    json_response(['status' => 'error', 'message' => 'Zu diesem Scan gibt es kein Foto'], 404);
}

// Der Mimetyp stammt aus der Prüfung beim Speichern (erste Bytes, nicht die
// Angabe des Absenders) und ist auf JPEG/PNG begrenzt -- er kann hier ohne
// weitere Prüfung als Kopfzeile gesetzt werden.
header('Content-Type: ' . $r['foto_mime']);
header('Content-Length: ' . strlen($r['foto']));
// Nicht im Zwischenspeicher ablegen: Das Bild hängt an einer Sitzung mit
// Rechteprüfung, und ein zwischengespeichertes Bild wäre nach einem
// Rechteentzug weiterhin abrufbar.
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
echo $r['foto'];
