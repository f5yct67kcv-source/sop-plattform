<?php
// Offerte per E-Mail an den Kunden verschicken (ENT-192).
//
// Verschickt KEINE PDF-Anhaenge -- es gibt in diesem Projekt keine
// PDF-Bibliothek (siehe backend/mailer.php). Die Mail traegt stattdessen
// einen Link auf eine eigene, unangemeldete Seite (beleg_oeffentlich.php),
// auf der der Kunde die Offerte als Web-Ansicht sieht und annehmen oder
// ablehnen kann -- nachgebaut nach dem Vorbild, das der Projektinhaber in
// einem Fremdsystem gezeigt hat.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../belege.php';
require __DIR__ . '/../mailer.php';

$user = require_session();
require_recht($user, 'offerten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = db();
$beleg = beleg_lesen($pdo, $id);
if (!$beleg) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}
if (!$beleg['kunde_id']) {
    json_response(['status' => 'error', 'message' => 'Die Offerte hat noch keinen Kunden.'], 400);
}

$s = $pdo->prepare('SELECT name, email FROM kunden WHERE id = ?');
$s->execute([(int)$beleg['kunde_id']]);
$kunde = $s->fetch();
if (!$kunde) {
    json_response(['status' => 'error', 'message' => 'Der Kunde wurde nicht gefunden.'], 404);
}
$anEmail = trim((string)$kunde['email']);
if ($anEmail === '') {
    json_response(['status' => 'error',
        'message' => 'Für diesen Kunden ist keine Haupt-E-Mail hinterlegt.'], 400);
}

if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).'], 500);
}

// Der Token bleibt ueber mehrere Versendungen hinweg derselbe: Ein bereits
// verschickter Link soll gueltig bleiben, auch wenn spaeter eine Erinnerung
// nachgeschickt wird. Neu erzeugt wird er nur, wenn noch keiner besteht.
$token = $beleg['versand_token'];
if (!$token) {
    $token = bin2hex(random_bytes(32));
    $pdo->prepare('UPDATE belege SET versand_token = ? WHERE id = ?')->execute([$token, $id]);
}

$betrieb = $pdo->query("SELECT firma FROM betrieb WHERE id = 1")->fetch();
$firma = trim((string)($betrieb['firma'] ?? ''));

// Immer https, unabhaengig davon, wie der Dashboard-Aufruf selbst ankam
// (siehe HSTS-Kopfzeile in htaccess-hostpoint): ein Kundenlink mit
// Entscheidungs-Token soll nie unverschluesselt verschickt werden.
$host = (string)($_SERVER['HTTP_HOST'] ?? '');
$link = 'https://' . $host . '/api/beleg_oeffentlich.php?token=' . urlencode($token);

$titel = BELEG_ARTEN[$beleg['art']]['titel'] ?? 'Beleg';
$absenderName = $firma !== '' ? $firma : 'Ihr Ansprechpartner';
$betreff = "Neue $titel {$beleg['nummer']}" . ($firma !== '' ? " von $firma" : '');

// Annehmen/Ablehnen gibt es nur bei der Offerte (siehe beleg_oeffentlich.php)
// -- die Rechnung hat auf der Kundenseite keine Entscheidung, nur die Ansicht.
$ansehenText = $beleg['art'] === 'offerte'
    ? "Sie können die $titel hier ansehen und direkt beantworten:"
    : "Sie können die $titel hier ansehen:";

$text = "Guten Tag\n\n"
    . "$absenderName hat Ihnen eine neue $titel erstellt: {$beleg['nummer']}.\n\n"
    . "$ansehenText\n$link\n\n"
    . "Freundliche Grüsse\n$absenderName";

// Jedes textfuehrende Element bekommt sein EIGENES font-family (nicht nur
// der aeusserste Rahmen): Outlook Desktop (Word-Rendermotor) vererbt
// font-family in HTML-Mails nicht zuverlaessig an verschachtelte Elemente
// und faellt sonst auf eine Serifenschrift zurueck -- genau die
// uneinheitliche Schrift, die der Projektinhaber am 28.08.2026 bemaengelt
// hat. Der CTA-Knopf traegt jetzt denselben Blauton wie der primaere
// Aktions-Knopf im Dashboard (--accent, #2F5BD7), statt eines schwarzen
// Knopfs ohne Bezug zum Erscheinungsbild.
$schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
$html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
    . '<p style="' . $schrift . ';margin:0 0 16px">Guten Tag</p>'
    . '<p style="' . $schrift . ';margin:0 0 16px"><strong>' . htmlspecialchars($absenderName, ENT_QUOTES, 'UTF-8') . '</strong> hat Ihnen eine neue '
    . htmlspecialchars(mb_strtolower($titel), ENT_QUOTES, 'UTF-8') . ' erstellt: <strong>'
    . htmlspecialchars($beleg['nummer'], ENT_QUOTES, 'UTF-8') . '</strong>.</p>'
    . '<p style="' . $schrift . ';margin:28px 0">'
    . '<a href="' . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '" '
    . 'style="' . $schrift . ';background:#2F5BD7;color:#fff;padding:12px 24px;border-radius:8px;'
    . 'font-weight:700;text-decoration:none;display:inline-block">'
    . htmlspecialchars("$titel anschauen", ENT_QUOTES, 'UTF-8') . '</a></p>'
    . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">Funktioniert der Knopf nicht? Diesen Link in den Browser kopieren:<br>'
    . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '</p>'
    . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . htmlspecialchars($absenderName, ENT_QUOTES, 'UTF-8') . '</p>'
    . '</div>';

try {
    smtp_senden($anEmail, (string)$kunde['name'], $betreff, $html, $text);
} catch (Throwable $e) {
    json_response(['status' => 'error', 'message' => 'Versand fehlgeschlagen: ' . $e->getMessage()], 502);
}

// Eine bereits getroffene Kundenentscheidung wird durch einen erneuten
// Versand nicht zurueckgesetzt -- eine Erinnerungsmail an eine laengst
// angenommene Offerte soll den Status nicht auf "versendet" zuruecksetzen.
$alt = (string)$beleg['status'];
if (!in_array($alt, ['bestaetigt', 'abgelehnt'], true)) {
    $pdo->prepare('UPDATE belege SET status = ? WHERE id = ?')->execute(['versendet', $id]);
}

json_response(['status' => 'ok', 'link' => $link]);
