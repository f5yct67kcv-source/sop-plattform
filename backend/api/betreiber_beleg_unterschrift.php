<?php
// Annahme einer Offerte oder eines Vertrags der Betreiberin am Link, mit
// Bestaetigungscode (ENT-688, Schritt 2).
//
// Bewusst OHNE Anmeldung -- aus demselben Grund wie
// betreiber_beleg_oeffentlich.php: Der Empfaenger hat kein Konto, der
// Versand-Token ersetzt die Anmeldung. Steht darum namentlich in
// OHNE_ANMELDUNG (test_php.mjs).
//
// Zwei Schritte, ein Endpunkt:
//   was=anfordern    Angaben pruefen, offene Unterschrift anlegen, Code per
//                    Mail an die angegebene Adresse
//   was=bestaetigen  Code pruefen; erst dann ist der Beleg angenommen
//
// Der ganze Ablauf steht in beleg_unterschrift_ablauf() (belege.php) --
// einmal fuer beide Seiten. Hier stehen nur Verbindung und Absender.
//
// NUR POST und JSON: Die Seite ruft ihn aus dem Unterschriftsdialog auf. Ein
// blosser Linkaufruf -- die Vorschau eines Mailprogramms -- bewirkt nichts.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../mail_vorlage.php';
require_once __DIR__ . '/../mailer.php';
// Das unterschriebene PDF und die Bestaetigungen (ENT-688, Schritt 3).
require_once __DIR__ . '/../belegpdf.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$in = json_decode(file_get_contents('php://input'), true) ?? [];
$was = (string)($in['was'] ?? '');
if (!in_array($was, ['anfordern', 'bestaetigen'], true)) {
    json_response(['status' => 'error', 'message' => 'Unvollständige Anfrage.'], 400);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    json_response(['status' => 'error', 'lage' => 'link', 'message' => 'Dieser Link ist nicht (mehr) gültig.'], 404);
}
$bk = hat_tabelle($pdo, 'be_briefkopf')
    ? ($pdo->query('SELECT firma FROM be_briefkopf WHERE id = 1')->fetch() ?: []) : [];

// Der Ausweis ist der versand_token -- hier an der Tuer geprueft, bevor
// irgendetwas gelesen oder verschickt wird.
$tokenPruef = $pdo->prepare('SELECT 1 FROM be_belege WHERE versand_token = ?');
$tokenPruef->execute([(string)($in['token'] ?? '')]);
if (!$tokenPruef->fetchColumn()) {
    json_response(['status' => 'error', 'lage' => 'link', 'message' => 'Dieser Link ist nicht (mehr) gültig.'], 404);
}

beleg_unterschrift_ablauf($was, $pdo, 'be_', $in, trim((string)($bk['firma'] ?? '')));
