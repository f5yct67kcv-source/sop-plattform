<?php
// Das unterschriebene PDF MIT dem vollen Pruefprotokoll, fuer die eigene
// Seite (ENT-710).
//
// Der Kunde bekommt am Link (beleg_pdf.php) nur die Kundenfassung mit der
// Quittung. Pruefsumme, IP-Adresse und Browser sieht nur, wer angemeldet
// ist und Offerten lesen darf.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../belegpdf.php';

$user = require_session();
require_recht($user, 'offerten_lesen');

$id = (int)($_GET['id'] ?? 0);
$pdo = db();
$s = $pdo->prepare('SELECT id, art, nummer FROM belege WHERE id = ?');
$s->execute([$id]);
$b = $s->fetch(PDO::FETCH_ASSOC);
$pdf = $b ? beleg_pdf_intern($pdo, '', (int)$b['id']) : null;
if ($pdf === null) {
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    echo 'Zu diesem Beleg liegt keine Annahme vor.';
    exit;
}
$titel = (string)(BELEG_ARTEN[(string)$b['art']]['titel'] ?? 'Beleg');
$name = preg_replace('/[^A-Za-z0-9._-]/', '-', $titel . '-' . $b['nummer'] . '-angenommen-intern') . '.pdf';
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="' . $name . '"');
header('Content-Length: ' . strlen($pdf));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
echo $pdf;
