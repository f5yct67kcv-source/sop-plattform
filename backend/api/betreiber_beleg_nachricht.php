<?php
// Antwort der Betreiberin im Faden zu einem Beleg (ENT-677).
//
// Die Gegenseite zu betreiber_beleg_nachricht_oeffentlich.php: Dort schreibt
// der Empfaenger ueber den Versandlink, hier antwortet die Betreiberin aus
// dem angemeldeten Bereich -- mit dem zweiten Faktor, wie ueberall auf
// dieser Ebene (ENT-521).
//
// DIE ANTWORT GEHT PER MAIL HINAUS, aber der Faden bleibt die massgebliche
// Stelle: Der Kunde hat kein Konto und schaut nicht von selbst nach. Ohne
// Mail waere der Rueckkanal ein Briefkasten, den niemand leert.
//
// DER VERSAND DARF DIE ANTWORT NIE SCHEITERN LASSEN -- gleiche Ueberlegung
// wie auf der oeffentlichen Seite: Geschrieben ist geschrieben. Was mit der
// Mail geschah, steht in der Antwort dieses Endpunkts, damit die Oberflaeche
// es sagen kann, statt es zu verschweigen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../mail_vorlage.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in   = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id   = (int)($in['id'] ?? 0);
$text = trim((string)($in['text'] ?? ''));
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}
if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Die Antwort ist leer.'], 400);
}

$pdo = betreiber_db();
if (!be_beleg_nachricht_tabelle_da($pdo)) {
    // Nicht eingerichtet ist etwas anderes als nicht erlaubt (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Der Rückkanal ist in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

$s = $pdo->prepare('SELECT id, art, nummer, status, kunde_id, versand_token FROM be_belege WHERE id = ?');
$s->execute([$id]);
$beleg = $s->fetch();
if (!$beleg) {
    json_response(['status' => 'error', 'message' => 'Beleg nicht gefunden'], 404);
}

$nid = be_beleg_nachricht_anlegen($pdo, $id, 'betreiber', (string)($ich['name'] ?? ''), $text);
if ($nid === 0) {
    json_response(['status' => 'error', 'message' => 'Die Antwort liess sich nicht ablegen.'], 500);
}

be_log($pdo, $ich, 'beleg', $id, 'nachricht', null, 'beantwortet');

// ── Die Mail an den Kunden ────────────────────────────────────────────
//
// Drei Dinge muessen stimmen, und jedes fehlende ist eine eigene Aussage --
// die Oberflaeche soll sagen koennen, WARUM keine Mail hinausging.
$lage = 'gesendet';
try {
    $kunde = null;
    if ($beleg['kunde_id']) {
        $k = $pdo->prepare('SELECT name, email, kontaktperson FROM be_kunden WHERE id = ?');
        $k->execute([(int)$beleg['kunde_id']]);
        $kunde = $k->fetch() ?: null;
    }
    $anEmail = trim((string)($kunde['email'] ?? ''));
    $basis   = basis_url();

    if (!smtp_konfiguriert())                    { $lage = 'kein_versand'; }
    elseif (empty($beleg['versand_token']))      { $lage = 'nie_versendet'; }
    elseif ($anEmail === ''
            || !filter_var($anEmail, FILTER_VALIDATE_EMAIL)) { $lage = 'keine_adresse'; }
    elseif ($basis === null)                     { $lage = 'keine_adresse_der_anlage'; }
    else {
        $link = rtrim($basis, '/') . '/api/betreiber_beleg_oeffentlich.php?token='
              . urlencode((string)$beleg['versand_token']);
        $bk    = $pdo->query('SELECT firma FROM be_briefkopf WHERE id = 1')->fetch();
        $firma = trim((string)($bk['firma'] ?? ''));
        $mail  = beleg_nachricht_mail_kunde($beleg, $firma,
            (string)($kunde['kontaktperson'] ?? ''), $text, $link, mail_signatur_zeilen());
        smtp_senden($anEmail, (string)($kunde['name'] ?? ''), $mail['betreff'],
            $mail['html'], $mail['text'], [], $mail['bilder']);
    }
} catch (Throwable $ex) {
    $lage = 'fehlgeschlagen';
}

json_response(['status' => 'ok', 'lage' => $lage,
    'nachrichten' => be_beleg_nachrichten($pdo, $id)]);
