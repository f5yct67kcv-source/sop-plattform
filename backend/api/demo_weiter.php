<?php
// „GuardOpS weiter nutzen" aus der Abschiedsmail -- öffentlich, ohne
// Anmeldung (ENT-634).
//
// Nach vierzehn Tagen ist der Demo-Zugang weg. Die Abschiedsmail gibt dem
// Interessenten einen Knopf zurück; dieser Endpunkt nimmt den Klick
// entgegen, hält ihn am Zugang fest und meldet ihn uns per Mail.
//
// NUR POST, NIE GET -- derselbe Schutz wie bei demo_bestaetigen.php und
// aus demselben Grund: Outlook Safe Links, Virenscanner in Firmennetzen
// und Vorschaudienste rufen JEDE Adresse aus einer Mail auf, bevor ein
// Mensch sie sieht. Genügte der Aufruf, bekäme der Betreiber Anfragen von
// Betrieben, die nie geklickt haben, und riefe Leute an, die nichts
// wollten. Ein Scanner ruft auf, aber er drückt keinen Knopf.
//
// DIE GRÖSSENANGABE IST DER KNOPF. Auf demo-weiter.html führt jede der
// vier Flächen (bis 10, 11 bis 30, mehr als 30, lieber nicht sagen) genau
// hierher. Ein Klick, und Anfrage und Grösse sind zusammen da -- kein
// Formular, kein zweiter Schritt.
//
// MEHRFACH ERLAUBT, ANDERS ALS BEIM BESTÄTIGUNGSLINK. Wer zuerst „lieber
// nicht sagen" klickt und es sich überlegt, soll die Angabe nachreichen
// können; wer den Knopf zweimal drückt, soll keine Fehlermeldung sehen.
// Der Zeitpunkt der ERSTEN Anfrage bleibt dabei stehen -- er sagt, wie
// schnell jemand reagiert hat, und das lässt sich nicht nachholen.
//
// DREI ZUSTÄNDE, DREI ANTWORTEN (Hausregel): unbekannter Wert, noch nicht
// eingerichtete Anlage und angenommen sind drei verschiedene Sachverhalte.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../demo_bremse.php';
require_once __DIR__ . '/../mailer.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$wert    = trim((string)($in['w'] ?? ''));
$groesse = trim((string)($in['groesse'] ?? ''));

// Die Form wird geprüft, bevor irgendetwas nachgeschlagen wird: Der Wert
// ist hexadezimal und 64 Zeichen lang. Alles andere kommt nicht aus einer
// unserer Mails und braucht keine Datenbankabfrage.
if (!preg_match('/^[0-9a-f]{64}$/', $wert)) {
    json_response(['status' => 'error', 'grund' => 'unbekannt',
        'message' => 'Dieser Link ist ungültig.'], 400);
}
// Eine Klasse, die wir nicht kennen, wird NICHT stillschweigend zu „keine
// Angabe": Dann stünde im Register eine Antwort, die niemand gegeben hat.
if (!demo_groesse_gueltig($groesse)) {
    json_response(['status' => 'error', 'grund' => 'unbekannt',
        'message' => 'Diese Angabe kennen wir nicht.'], 400);
}

// Bremse gegen das Durchprobieren von Werten. Eigenes Verzeichnis, damit
// ein Versuch hier nicht gegen das Kontingent des Anfrageformulars zählt.
$ip = demo_bremse_adresse();
try {
    $sperre = demo_bremse_pruefen($ip, demo_bremse_verzeichnis() . '-weiter');
} catch (Throwable $e) {
    json_response(['status' => 'error', 'grund' => 'fehlschlag',
        'message' => 'Die Anfrage kann gerade nicht bearbeitet werden. '
            . 'Bitte später erneut versuchen.'], 503);
}
if ($sperre > 0) {
    json_response(['status' => 'error', 'grund' => 'gebremst',
        'message' => "Zu viele Versuche. Bitte $sperre Minuten warten."], 429);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')
    || !hat_spalte($pdo, 'demo_zugang', 'ende_abdruck')
    || !hat_spalte($pdo, 'demo_zugang', 'weiter_am')) {
    // „Noch nicht eingerichtet" ist etwas anderes als „Link unbekannt".
    json_response(['status' => 'error', 'grund' => 'fehlschlag',
        'message' => 'Der Demo-Bereich ist auf diesem Server noch nicht '
            . 'vollständig eingerichtet.'], 503);
}

$stmt = $pdo->prepare(
    'SELECT id, platz, firma, person, email, telefon, weiter_am
       FROM demo_zugang WHERE ende_abdruck = ? LIMIT 1'
);
$stmt->execute([demo_ende_abdruck($wert)]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) {
    json_response(['status' => 'error', 'grund' => 'unbekannt',
        'message' => 'Diesen Link kennen wir nicht.'], 404);
}

// Der Zeitpunkt der ersten Anfrage bleibt stehen (siehe Kopf).
$schonDa = $zugang['weiter_am'] !== null;
$pdo->prepare(
    'UPDATE demo_zugang SET weiter_groesse = ?,
            weiter_am = COALESCE(weiter_am, NOW()) WHERE id = ?'
)->execute([$groesse, (int)$zugang['id']]);

// Die Meldung an uns. Sie darf den Interessenten nichts kosten: Kommt der
// Mailserver nicht durch, steht die Anfrage trotzdem im Register, und der
// Fehlschlag gehört ins Fehlerprotokoll, nicht auf seinen Bildschirm.
$an = demo_zugang_empfaenger();
if ($an === null) {
    error_log('demo_weiter: kein Empfaenger im Deploy hinterlegt.');
} else {
    try {
        $mail = demo_weiter_mail((string)$zugang['firma'], (string)$zugang['person'],
            (string)$zugang['email'], (string)$zugang['telefon'],
            (string)$zugang['platz'], $groesse);
        smtp_senden($an, 'GuardOpS', $mail['betreff'], $mail['html'], $mail['text']);
    } catch (Throwable $e) {
        error_log('demo_weiter: Versand fehlgeschlagen -- ' . $e->getMessage());
    }
}

json_response([
    'status'   => 'ok',
    // Sagt der Seite, ob das die erste Anfrage war. Sie braucht es für den
    // Text: „Ihre Anfrage ist raus" stimmt beim zweiten Klick nicht mehr.
    'erneut'   => $schonDa,
    'groesse'  => $groesse,
]);
