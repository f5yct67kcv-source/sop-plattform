<?php
// Rundgang-Rapport als PDF per E-Mail verschicken (ENT-322).
//
// Das PDF entsteht im BROWSER, nicht hier: Es gibt in diesem Projekt keine
// PDF-Bibliothek in PHP (siehe Kommentarkopf von beleg_versenden.php, ENT-192)
// und keinen Build-Schritt, der eine nachziehen koennte. Das Dashboard
// erzeugt es mit der schon vorhandenen html2pdf.js (ENT-206) und schickt es
// hier hoch; dieser Endpunkt haengt es an die Nachricht.
//
// Anders als beim Offert-Versand traegt die Mail KEINEN Link auf eine
// unangemeldete Seite. Ein Revierrapport nennt Mitarbeitende mit Namen und
// Uhrzeiten; ein Link, den jeder oeffnen kann, der ihn weiterleitet
// bekommt, waere fuer diesen Inhalt die falsche Bauart.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../rundgang.php';
require __DIR__ . '/../mailer.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

// Groesse: Ein Rapport ohne Karte liegt bei wenigen hundert Kilobyte.
// 8 MB ist grosszuegig und begrenzt zugleich, was sich ueber diesen Weg
// verschicken laesst -- der Anhang ist der einzige Teil der Nachricht, den
// nicht der Server selbst formuliert.
const RAPPORT_PDF_MAX = 8 * 1024 * 1024;

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$rundgangId = (int)($in['rundgang_id'] ?? 0);
$empfaenger = trim((string)($in['empfaenger'] ?? ''));
$pdfRoh = (string)($in['pdf'] ?? '');

if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}
if ($empfaenger === '' || !filter_var($empfaenger, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error', 'message' => 'Bitte eine gültige E-Mail-Adresse angeben.'], 422);
}

// strict: true -- eine Zeichenkette, die nur so AUSSIEHT wie Base64, wird
// abgewiesen statt stillschweigend zu Muell dekodiert.
$pdf = base64_decode($pdfRoh, true);
if ($pdf === false || $pdf === '') {
    json_response(['status' => 'error', 'message' => 'Der Rapport konnte nicht gelesen werden.'], 422);
}
if (strlen($pdf) > RAPPORT_PDF_MAX) {
    json_response(['status' => 'error', 'message' => 'Der Rapport ist zu gross für den Versand.'], 422);
}
// Magic Bytes statt einer gemeldeten Dateiendung -- gleiches Prinzip wie
// ersatzscan_foto_mime() in rundgang.php: Was der Client behauptet, laesst
// sich frei setzen; was in der Datei steht, nicht.
if (!str_starts_with($pdf, '%PDF-')) {
    json_response(['status' => 'error', 'message' => 'Die hochgeladene Datei ist kein PDF.'], 422);
}

$pdo = db();
$stmt = $pdo->prepare(
    'SELECT r.id, r.status, r.rohzeit_start, r.rohzeit_ende, r.pause_minuten,
            e.datum, e.kunde_name, o.name AS objekt_name,
            (SELECT MAX(s.erfasst_am) FROM rundgang_scan s WHERE s.rundgang_id = r.id) AS letzter_scan
       FROM rundgang r
       JOIN einsaetze e ON e.id = r.einsatz_id
       JOIN objekte o ON o.id = r.objekt_id
      WHERE r.id = ?'
);
$stmt->execute([$rundgangId]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r) {
    json_response(['status' => 'error', 'message' => 'Rundgang nicht gefunden'], 404);
}

if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).'], 500);
}

// Betreff und Text formuliert der SERVER aus den Rundgangdaten, nicht der
// Aufrufer. Sonst waere dieser Endpunkt ein Weg, ueber die Firmenadresse
// beliebige Nachrichten zu verschicken.
$betrieb = $pdo->query('SELECT firma FROM betrieb WHERE id = 1')->fetch();
$firma = trim((string)($betrieb['firma'] ?? ''));
$absenderName = $firma !== '' ? $firma : 'Ihr Ansprechpartner';

$datumDe = date('d.m.Y', strtotime((string)$r['datum']));
$dauer = rundgang_dauer($r['rohzeit_start'], $r['rohzeit_ende'], $r['letzter_scan'],
    (int)$r['pause_minuten'], (string)$r['status']);
$dauerText = $dauer['sekunden'] === null
    ? 'noch nicht abgeschlossen'
    : sprintf('%d:%02d Stunden', intdiv($dauer['sekunden'], 3600), intdiv($dauer['sekunden'], 60) % 60);

$betreff = 'Rundgang-Rapport ' . $r['objekt_name'] . ' vom ' . $datumDe;
$dateiname = 'Rapport-' . preg_replace('/[^A-Za-z0-9]+/', '-', (string)$r['objekt_name'])
    . '-' . date('Y-m-d', strtotime((string)$r['datum'])) . '.pdf';

$text = "Guten Tag\n\n"
    . "Im Anhang finden Sie den Rapport zum Rundgang vom $datumDe.\n\n"
    . "Objekt: {$r['objekt_name']}\n"
    . "Dauer: $dauerText\n\n"
    . "Freundliche Grüsse\n$absenderName";

// Jedes textfuehrende Element bekommt sein eigenes font-family -- Outlook
// Desktop vererbt es in HTML-Mails nicht zuverlaessig (Begruendung siehe
// beleg_versenden.php, ENT-192).
$schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
$e = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
    . '<p style="' . $schrift . ';margin:0 0 16px">Guten Tag</p>'
    . '<p style="' . $schrift . ';margin:0 0 16px">Im Anhang finden Sie den Rapport zum Rundgang vom <strong>'
    . $e($datumDe) . '</strong>.</p>'
    . '<table style="' . $schrift . ';border-collapse:collapse;margin:0 0 20px">'
    . '<tr><td style="' . $schrift . ';color:#6B7280;padding:2px 16px 2px 0">Objekt</td>'
    . '<td style="' . $schrift . '">' . $e((string)$r['objekt_name']) . '</td></tr>'
    . '<tr><td style="' . $schrift . ';color:#6B7280;padding:2px 16px 2px 0">Dauer</td>'
    . '<td style="' . $schrift . '">' . $e($dauerText) . '</td></tr>'
    . '</table>'
    . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . $e($absenderName) . '</p>'
    . '</div>';

try {
    smtp_senden($empfaenger, '', $betreff, $html, $text,
        [['name' => $dateiname, 'mime' => 'application/pdf', 'inhalt' => $pdf]]);
} catch (Throwable $ex) {
    json_response(['status' => 'error', 'message' => 'Versand fehlgeschlagen: ' . $ex->getMessage()], 502);
}

json_response(['status' => 'ok', 'empfaenger' => $empfaenger, 'dateiname' => $dateiname]);
