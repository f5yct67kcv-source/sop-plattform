<?php
// Annahme einer Offerte am Kundenlink, mit Bestaetigungscode (ENT-688,
// Schritt 2) -- die Cockpit-Seite zu betreiber_beleg_unterschrift.php.
//
// Bewusst OHNE require_session(): Der Kunde hat kein Konto, der
// Versand-Token ersetzt die Anmeldung. Steht darum namentlich in
// OHNE_ANMELDUNG (test_php.mjs).
//
// Der ganze Ablauf steht in beleg_unterschrift_ablauf() (belege.php) --
// einmal fuer beide Seiten. Hier stehen nur Verbindung und Absender.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../mail_vorlage.php';
require_once __DIR__ . '/../mailer.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$in = json_decode(file_get_contents('php://input'), true) ?? [];
$was = (string)($in['was'] ?? '');
if (!in_array($was, ['anfordern', 'bestaetigen'], true)) {
    json_response(['status' => 'error', 'message' => 'Unvollständige Anfrage.'], 400);
}

$pdo = db();
$betrieb = $pdo->query('SELECT firma FROM betrieb WHERE id = 1')->fetch() ?: [];

// Der Ausweis ist der versand_token -- hier an der Tuer geprueft, bevor
// irgendetwas gelesen oder verschickt wird.
$tokenPruef = $pdo->prepare('SELECT 1 FROM belege WHERE versand_token = ?');
$tokenPruef->execute([(string)($in['token'] ?? '')]);
if (!$tokenPruef->fetchColumn()) {
    json_response(['status' => 'error', 'lage' => 'link', 'message' => 'Dieser Link ist nicht (mehr) gültig.'], 404);
}

beleg_unterschrift_ablauf($was, $pdo, '', $in, trim((string)($betrieb['firma'] ?? '')));
