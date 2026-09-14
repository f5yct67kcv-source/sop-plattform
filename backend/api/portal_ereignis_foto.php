<?php
// Kundenportal: das Foto einer Ereignismeldung (ENT-544).
//
// GET ?ereignis_id=<n> -> das Bild, oder JSON mit Fehler.
//
// Das Gegenstueck zu ereignis_foto.php, wie portal_rundgang_foto.php das
// Gegenstueck zu rundgang_scan_foto.php ist. Dasselbe Bild, aber ein eigener
// Weg mit eigener Pruefung: Der Verwaltungsendpunkt fragt nur nach dem Recht
// `rundgaenge_lesen` und dann nach der Nummer -- fuer einen Kundenzugang
// waere das zu wenig, er darf nur die Belege SEINER Objekte sehen.
//
// Die Pruefung laeuft ueber dieselbe Regel wie die Detailansicht
// (kp_runde_sichtbar), nicht ueber eine zweite Fassung davon. Sie haengt an
// der RUNDE, nicht am Objekt der Meldung: Eine Meldung ohne Runde zeigt das
// Portal nirgends (portal_rundgang_detail.php holt nur Meldungen zu einer
// Runde, portal_wachbuch.php setzt `nur_ereignisse_mit_runde`). Was es nicht
// zeigt, liefert es auch nicht aus -- sonst waere dieser Endpunkt der
// einzige Weg zu einem Inhalt, den die Oberflaeche bewusst zurueckhaelt.
//
// Wie ueberall gilt: Der Sitzungs-Token darf NICHT in die URL (er landet
// sonst in Server-Protokollen und im Browserverlauf, geprueft in
// test_php.mjs). Die Oberflaeche holt das Bild per fetch() samt Kopfzeile.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$ereignisId = (int)($_GET['ereignis_id'] ?? 0);
if ($ereignisId <= 0) {
    json_response(['status' => 'error', 'message' => 'ereignis_id erforderlich'], 422);
}

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

// EINE Antwort fuer alle Faelle -- gibt es nicht, gehoert einem anderen
// Kunden, Runde laeuft noch, ohne Runde erfasst, kein Foto vorhanden. Sonst
// waere der Endpunkt ein Auskunftsdienst darueber, welche Nummern es gibt.
$nichtAbrufbar = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Zu dieser Meldung gibt es kein abrufbares Foto.'], 404);
};

if (!$objektIds) { $nichtAbrufbar(); }
if (!hat_tabelle($pdo, 'ereignis_meldung')) { $nichtAbrufbar(); }

$stmt = $pdo->prepare(
    'SELECT em.foto, em.foto_mime, em.rundgang_id, r.objekt_id, r.status
       FROM ereignis_meldung em
       JOIN rundgang r ON r.id = em.rundgang_id
      WHERE em.id = ?'
);
$stmt->execute([$ereignisId]);
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
