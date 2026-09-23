<?php
// Offerte der Betreiberin per E-Mail an den kuenftigen Mandanten (ENT-605).
//
// Gleicher Aufbau wie beleg_versenden.php im Cockpit, mit drei
// Unterschieden, die aus der Ebene folgen:
//
//   1. Der Absendername kommt aus `be_briefkopf` und nicht aus `betrieb` --
//      die Tabelle `betrieb` gehoert einer Mandantin, und ihr Name hat auf
//      einer Offerte der Betreiberin nichts verloren.
//   2. Der Link zeigt auf betreiber_beleg_oeffentlich.php und damit auf
//      betreiber.guardops.ch. Die Adresse kommt aus dem Deploy (ENT-501,
//      basis_url()), nie aus dem Host-Kopf der Anfrage.
//   3. Die Mail traegt die gemeinsame Gestaltung aus mail_vorlage.php
//      (ENT-674) -- dieselbe wie die Demo-Mail, samt Signatur und Logo der
//      Betreiberin. Im Cockpit zeichnet eine Mandantin, und deren Briefkopf
//      in dieser Vorlage ist eine eigene Frage (OP-675).
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
// Die gemeinsame Mailgestaltung. belege.php bindet sie selbst ein; hier
// steht sie, weil mail_signatur_zeilen() aus mailer.php und die Vorlage
// zusammengehoeren.
require_once __DIR__ . '/../mail_vorlage.php';

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

// `kontaktperson` fuer die Anrede (ENT-674). Sie darf fehlen -- dann
// gruesst die Mail ohne Namen, statt mit einem halben.
$s = $pdo->prepare('SELECT name, email, kontaktperson FROM be_kunden WHERE id = ?');
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

// ── Fassung (ENT-688) ─────────────────────────────────────────────────
//
// Was der Empfaenger ab jetzt am Link sieht, wird als Abbild festgehalten.
// Hat sich seit der letzten Fassung nichts geaendert, ist dieser Versand
// eine Erinnerung und legt keine neue an.
//
// EIN ANGENOMMENER BELEG BEKOMMT KEINE NEUE FASSUNG: Er ist gesperrt, und
// was angenommen wurde, bleibt, was der Link zeigt. Aendern liesse sich
// ohnehin nur noch die Anschrift im Adressbestand -- und die gehoert dann
// auf einen neuen Beleg, nicht unter eine geleistete Unterschrift.
$fassungDa = beleg_fassung_tabelle_da($pdo, 'be_');
$gesperrt  = beleg_gesperrt($beleg);
$abbild    = $fassungDa ? beleg_abbild_lesen($pdo, $id, 'be_', be_beleg_absender($pdo)) : null;
$naechste  = ($abbild !== null) ? beleg_fassung_naechste($pdo, $id, $abbild, 'be_')
                                : ['nummer' => 1, 'neu' => false];
if ($gesperrt) { $naechste['neu'] = false; }

// FREIGABE (ENT-688, Punkt 7): Eine neue Fassung einer Offerte oder eines
// Vertrags geht nur mit der ausdruecklichen Erklaerung "Ich gebe diese
// Fassung verbindlich frei" hinaus. Geprueft HIER, nicht nur im Dialog --
// sonst stuende im Protokoll eine Freigabe, die niemand abgegeben hat. Eine
// Erinnerung ohne neue Fassung braucht keine: Freigegeben ist schon, was
// der Link zeigt.
$freigabe = !empty($in['freigabe']);
if ($naechste['neu'] && beleg_unterschreibbar((string)$beleg['art']) && !$freigabe) {
    json_response(['status' => 'error', 'freigabe_noetig' => true,
        'message' => 'Bitte bestätigen, dass Sie diese Fassung verbindlich freigeben.'], 400);
}
$fassungNr = $naechste['neu'] ? (int)$naechste['nummer']
           : max(1, (int)(beleg_letzte_fassung($pdo, $id, 'be_')['nummer'] ?? 1));

// Betreff, Text, HTML und die Bilder der Signatur kommen aus einer Hand
// (ENT-674): beleg_mail() in belege.php baut sie aus derselben Vorlage wie
// die Demo-Mail -- Rahmen, Werteblock, Knopf, Signatur mit eingebettetem
// Logo, Dunkelmodus. Hier steht bewusst KEIN HTML mehr: Zwei Gestaltungen
// nebeneinander waren der Befund, der zu ENT-674 gefuehrt hat.
//
// Die Signaturzeilen kommen aus dem Deploy und nicht aus dem Repository
// (Vertraulichkeitsregel). Sind keine hinterlegt, zeichnet die Firma aus
// dem Briefkopf -- das entscheidet beleg_mail().
$mail = beleg_mail($beleg, $firma, $link,
    (string)($kunde['kontaktperson'] ?? ''), mail_signatur_zeilen(), $fassungNr);

try {
    smtp_senden($anEmail, (string)$kunde['name'], $mail['betreff'],
                $mail['html'], $mail['text'], [], $mail['bilder']);
} catch (Throwable $ex) {
    json_response(['status' => 'error', 'message' => 'Versand fehlgeschlagen: ' . $ex->getMessage()], 502);
}

// Die Fassung erst NACH dem Versand: Scheitert die Mail, gibt es auch keine
// Fassung, die als "versendet" dastuende, ohne dass sie jemand bekam.
if ($naechste['neu'] && $abbild !== null) {
    beleg_fassung_anlegen($pdo, $id, $abbild, 'versand', (string)($ich['name'] ?? ''), 'be_', $freigabe,
        isset($ich['id']) ? (int)$ich['id'] : null);
    be_log($pdo, $ich, 'beleg', $id, 'fassung', null, 'Fassung ' . $fassungNr);
}

// Eine bereits getroffene Entscheidung wird durch einen erneuten Versand
// nicht zurueckgesetzt -- eine Erinnerung an eine laengst angenommene
// Offerte soll den Status nicht auf "versendet" zuruecksetzen.
//
// AUSNAHME: eine NEUE Fassung nach einer Ablehnung (ENT-688). Wer nach einem
// Nein nachbessert, legt dem Empfaenger ein neues Dokument vor, und ueber
// das hat er noch nicht entschieden. Die alte Ablehnung bleibt im Logbuch
// und an der alten Fassung stehen.
$alt = (string)$beleg['status'];
if ($naechste['neu'] && !$gesperrt && !empty($beleg['entscheidung_am'])) {
    $pdo->prepare('UPDATE be_belege SET status = ?, entscheidung_am = NULL, entscheidung_ip = NULL'
        . (hat_spalte($pdo, 'be_belege', 'entscheidung_fassung') ? ', entscheidung_fassung = NULL' : '')
        . ' WHERE id = ?')->execute(['versendet', $id]);
    be_log($pdo, $ich, 'beleg', $id, 'status', $alt, 'versendet');
} elseif (!in_array($alt, ['bestaetigt', 'abgelehnt'], true)) {
    $pdo->prepare('UPDATE be_belege SET status = ? WHERE id = ?')->execute(['versendet', $id]);
}

// Der Versand selbst ist der Eintrag, nicht der Statuswechsel: Wer nach einer
// Zusage ein zweites Mal erinnert, aendert keinen Status -- und genau das
// waere die Zeile, die man spaeter sucht. Die Adresse steht dabei, weil
// "verschickt" ohne Empfaenger nichts beantwortet.
be_log($pdo, $ich, 'beleg', $id, 'versendet', null, $anEmail);

json_response(['status' => 'ok', 'link' => $link, 'fassung' => $fassungNr,
    'neue_fassung' => (bool)$naechste['neu']]);
