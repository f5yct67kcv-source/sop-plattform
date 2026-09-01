<?php
// Liefert das Foto einer Vorfallmeldung aus (ENT-297).
//
// Der erste Endpunkt des Systems, der Binärdaten statt JSON zurückgibt.
// Bisher gab es dafür gar keinen Weg -- die Ersatzscan-Fotos (ENT-182)
// werden seit Monaten erfasst, aber nirgends angezeigt, weil niemand sie
// ausliefern konnte. Dieser Endpunkt ist bewusst nur für Ereignisfotos
// gebaut; die Scan-Fotos wären ein eigener, gleich aufgebauter Schritt.
//
// WICHTIG zur Einbindung: Der Sitzungs-Token darf NICHT in die URL (er
// landet sonst in Server-Protokollen und im Browserverlauf -- eine
// ausdrücklich geprüfte Regel, siehe test_php.mjs). Ein schlichtes
// <img src="ereignis_foto.php?id=..."> funktioniert deshalb nicht: Der
// Browser schickt dabei keine eigenen Kopfzeilen mit. Die Oberfläche holt
// das Bild darum per fetch() samt Token und setzt es als Objekt-URL ein.
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

$pdo = db();
if (!hat_tabelle($pdo, 'ereignis_meldung')) {
    json_response(['status' => 'error', 'message' => 'nicht gefunden'], 404);
}

$stmt = $pdo->prepare('SELECT foto, foto_mime FROM ereignis_meldung WHERE id = ?');
$stmt->execute([$id]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r || $r['foto'] === null || $r['foto_mime'] === null) {
    json_response(['status' => 'error', 'message' => 'Zu dieser Meldung gibt es kein Foto'], 404);
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
