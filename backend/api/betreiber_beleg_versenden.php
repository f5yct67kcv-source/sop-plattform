<?php
// Offerte der Betreiberin per E-Mail an den kuenftigen Mandanten (ENT-605).
//
// Gleicher Aufbau wie beleg_versenden.php im Cockpit, mit zwei
// Unterschieden, die aus der Ebene folgen:
//
//   1. Der Absendername kommt aus `be_briefkopf` und nicht aus `betrieb` --
//      die Tabelle `betrieb` gehoert einer Mandantin, und ihr Name hat auf
//      einer Offerte der Betreiberin nichts verloren.
//   2. Der Link zeigt auf betreiber_beleg_oeffentlich.php und damit auf
//      betreiber.guardops.ch. Die Adresse kommt aus dem Deploy (ENT-501,
//      basis_url()), nie aus dem Host-Kopf der Anfrage.
//
// Verschickt KEINE PDF-Anhaenge -- es gibt in diesem Projekt keine
// PDF-Bibliothek auf dem Server (siehe backend/mailer.php). Die Mail traegt
// einen Link auf eine unangemeldete Seite, auf der der Empfaenger die
// Offerte sieht und annehmen oder ablehnen kann.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    json_response(['status' => 'error',
        'message' => 'Der Offertenteil ist noch nicht eingerichtet.'], 503);
}

$beleg = beleg_lesen($pdo, $id, 'be_');
if (!$beleg) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}
if (!$beleg['kunde_id']) {
    json_response(['status' => 'error', 'message' => 'Die Offerte hat noch keinen Empfänger.'], 400);
}

$s = $pdo->prepare('SELECT name, email FROM be_kunden WHERE id = ?');
$s->execute([(int)$beleg['kunde_id']]);
$kunde = $s->fetch();
if (!$kunde) {
    json_response(['status' => 'error', 'message' => 'Der Empfänger wurde nicht gefunden.'], 404);
}
$anEmail = trim((string)$kunde['email']);
if ($anEmail === '') {
    json_response(['status' => 'error',
        'message' => 'Für diesen Empfänger ist keine Haupt-E-Mail hinterlegt.'], 400);
}
// Hier geprueft und nicht erst beim Versand: smtp_senden() weist eine
// unbrauchbare Adresse selbst ab, aber als Ausnahme -- und die kaeme in der
// Oberflaeche als "Unerwarteter Serverfehler" an. Das schickt jemanden auf
// die Suche nach dem falschen Fehler.
if (!filter_var($anEmail, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error',
        'message' => 'Die E-Mail-Adresse dieses Empfängers ist unbrauchbar («' . $anEmail
                   . '») — bitte zuerst unter Adressen berichtigen.'], 400);
}

if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).'], 500);
}

// Der Absender steht im Briefkopf. Ohne ihn wird NICHT verschickt: Eine
// Offerte, unter der keine Firma steht, ist kein Angebot, sondern eine
// Zumutung -- und der Empfaenger kennt die Betreiberin noch nicht.
$bk = $pdo->query('SELECT firma FROM be_briefkopf WHERE id = 1')->fetch();
$firma = trim((string)($bk['firma'] ?? ''));
if ($firma === '') {
    json_response(['status' => 'error',
        'message' => 'Im Briefkopf steht noch keine Firma. Sie erscheint als Absender '
                   . 'auf der Offerte und in der E-Mail — bitte zuerst unter '
                   . 'Briefkopf eintragen.'], 400);
}

// Der Token bleibt ueber mehrere Versendungen hinweg derselbe: Ein bereits
// verschickter Link soll gueltig bleiben, auch wenn spaeter eine Erinnerung
// nachgeschickt wird. Neu erzeugt wird er nur, wenn noch keiner besteht.
$token = $beleg['versand_token'];
if (!$token) {
    $token = bin2hex(random_bytes(32));
    $pdo->prepare('UPDATE be_belege SET versand_token = ? WHERE id = ?')->execute([$token, $id]);
}

// Die eigene Adresse kommt aus dem Deploy (ENT-501), nie aus der Anfrage.
// Im Betreiber-Buendel ist das https://betreiber.guardops.ch.
$basis = basis_url();
if ($basis === null) {
    json_response(['status' => 'error',
        'message' => 'Die Adresse dieser Anlage ist auf dem Server nicht hinterlegt — '
                   . 'ohne sie lässt sich kein Link erzeugen.'], 503);
}
$link = $basis . '/api/betreiber_beleg_oeffentlich.php?token=' . urlencode($token);

$titel   = BELEG_ARTEN[$beleg['art']]['titel'] ?? 'Beleg';
$betreff = "Neue $titel {$beleg['nummer']} von $firma";

$ansehenText = $beleg['art'] === 'offerte'
    ? "Sie können die $titel hier ansehen und direkt beantworten:"
    : "Sie können die $titel hier ansehen:";

$text = "Guten Tag\n\n"
    . "$firma hat Ihnen eine neue $titel erstellt: {$beleg['nummer']}.\n\n"
    . "$ansehenText\n$link\n\n"
    . "Freundliche Grüsse\n$firma";

// Jedes textfuehrende Element bekommt sein EIGENES font-family: Outlook
// Desktop vererbt font-family in HTML-Mails nicht zuverlaessig und faellt
// sonst auf eine Serifenschrift zurueck.
$schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
$e = static fn(string $w): string => htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
$html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
    . '<p style="' . $schrift . ';margin:0 0 16px">Guten Tag</p>'
    . '<p style="' . $schrift . ';margin:0 0 16px"><strong>' . $e($firma) . '</strong> hat Ihnen eine neue '
    . $e(mb_strtolower($titel)) . ' erstellt: <strong>' . $e((string)$beleg['nummer']) . '</strong>.</p>'
    . '<p style="' . $schrift . ';margin:28px 0">'
    . '<a href="' . $e($link) . '" '
    . 'style="' . $schrift . ';background:#2F5BD7;color:#fff;padding:12px 24px;border-radius:8px;'
    . 'font-weight:700;text-decoration:none;display:inline-block">'
    . $e("$titel anschauen") . '</a></p>'
    . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">Funktioniert der Knopf nicht? Diesen Link in den Browser kopieren:<br>'
    . $e($link) . '</p>'
    . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . $e($firma) . '</p>'
    . '</div>';

try {
    smtp_senden($anEmail, (string)$kunde['name'], $betreff, $html, $text);
} catch (Throwable $ex) {
    json_response(['status' => 'error', 'message' => 'Versand fehlgeschlagen: ' . $ex->getMessage()], 502);
}

// Eine bereits getroffene Entscheidung wird durch einen erneuten Versand
// nicht zurueckgesetzt -- eine Erinnerung an eine laengst angenommene
// Offerte soll den Status nicht auf "versendet" zuruecksetzen.
$alt = (string)$beleg['status'];
if (!in_array($alt, ['bestaetigt', 'abgelehnt'], true)) {
    $pdo->prepare('UPDATE be_belege SET status = ? WHERE id = ?')->execute(['versendet', $id]);
}

// Der Versand selbst ist der Eintrag, nicht der Statuswechsel: Wer nach einer
// Zusage ein zweites Mal erinnert, aendert keinen Status -- und genau das
// waere die Zeile, die man spaeter sucht. Die Adresse steht dabei, weil
// "verschickt" ohne Empfaenger nichts beantwortet.
be_log($pdo, $ich, 'beleg', $id, 'versendet', null, $anEmail);

json_response(['status' => 'ok', 'link' => $link]);
