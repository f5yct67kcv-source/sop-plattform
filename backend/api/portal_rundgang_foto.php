<?php
// Kundenportal: der Fotobeleg eines Ersatzscans (ENT-455).
//
// GET ?scan_id=<n> -> das Bild, oder JSON mit Fehler.
//
// Das Gegenstueck zu rundgang_scan_foto.php. Dasselbe Bild, aber ein
// eigener Weg mit eigener Pruefung: Der Verwaltungsendpunkt fragt nur nach
// dem Recht `rundgaenge_lesen` und dann nach der Scan-Nummer -- fuer einen
// Kundenzugang waere das zu wenig, denn er darf nur die Belege SEINER
// Objekte sehen. Die Pruefung laeuft darum ueber dieselbe Regel wie die
// Detailansicht (kp_runde_sichtbar), nicht ueber eine zweite Fassung davon.
//
// Wie beim Verwaltungsweg gilt: Der Sitzungs-Token darf NICHT in die URL
// (er landet sonst in Server-Protokollen und im Browserverlauf, geprueft in
// test_php.mjs). Die Oberflaeche holt das Bild per fetch() samt Kopfzeile
// und setzt es als Objekt-URL ein.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$scanId = (int)($_GET['scan_id'] ?? 0);
if ($scanId <= 0) {
    json_response(['status' => 'error', 'message' => 'scan_id erforderlich'], 422);
}

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

// Eine Antwort fuer alle Faelle -- gibt es nicht, gehoert einem anderen
// Kunden, Runde laeuft noch, kein Foto vorhanden. Sonst waere der Endpunkt
// ein Auskunftsdienst darueber, welche Scan-Nummern es gibt.
$nichtAbrufbar = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Zu diesem Scan gibt es keinen abrufbaren Fotobeleg.'], 404);
};

if (!$objektIds) { $nichtAbrufbar(); }

$stmt = $pdo->prepare(
    'SELECT s.foto, s.foto_mime, r.objekt_id, r.status
       FROM rundgang_scan s
       JOIN rundgang r ON r.id = s.rundgang_id
      WHERE s.id = ?'
);
$stmt->execute([$scanId]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$row || $row['foto'] === null || $row['foto_mime'] === null) { $nichtAbrufbar(); }

$laeuft = in_array((string)$row['status'], RUNDGANG_OFFENE_STATUS, true);
if (!kp_runde_sichtbar((int)$row['objekt_id'], $objektIds, $laeuft)) { $nichtAbrufbar(); }

// Der Mimetyp stammt aus der Pruefung beim Speichern (erste Bytes, nicht die
// Angabe des Absenders) und ist auf JPEG/PNG begrenzt.
header('Content-Type: ' . $row['foto_mime']);
header('Content-Length: ' . strlen($row['foto']));
// Nicht im Zwischenspeicher ablegen: Das Bild haengt an einer Sitzung, und
// ein zwischengespeichertes Bild waere nach einer Sperre weiterhin abrufbar.
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
echo $row['foto'];
