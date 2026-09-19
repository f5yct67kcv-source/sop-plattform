<?php
// Eine offene Demo-Anfrage einlösen -- öffentlich, ohne Anmeldung (ENT-624).
//
// Hier entsteht, was api/demo_anfordern.php seit ENT-624 bewusst NICHT
// mehr anlegt: Platz, Instanz, Konto, Registereintrag und die Mail mit den
// Zugangsdaten. Der Grund für die Teilung steht im Kopf von
// demo_bestaetigung.php -- kurz: Erst hier ist bewiesen, dass die Adresse
// dem Anfragenden gehört, und erst hier darf ihn das einen der zehn
// knappen Plätze kosten.
//
// NUR POST, NIE GET -- und das ist keine Formalie, sondern der eigentliche
// Schutz dieser Datei. Outlook Safe Links, Virenscanner in Firmennetzen
// und Vorschaudienste rufen JEDE Adresse aus einer Mail auf, bevor ein
// Mensch sie sieht. Würde ein Aufruf genügen, löste der Scanner die
// Anfrage ein, und der Interessent fände einen verbrauchten Link vor --
// ausgerechnet bei Firmen mit ordentlicher IT, also genau der Zielgruppe.
// Ein Scanner ruft auf, aber er drückt keinen Knopf. Darum liegt zwischen
// Link und Einlösung die Seite demo-bestaetigen.html mit einem Knopf, und
// darum antwortet dieser Endpunkt auf GET nicht.
//
// VIER ZUSTÄNDE, VIER ANTWORTEN (Hausregel: „unbekannt" darf nie wie
// „keine" aussehen). Unbekannt, abgelaufen, schon eingelöst und
// eingerichtet sind vier verschiedene Sachverhalte, und die Seite muss sie
// auseinanderhalten können, um vier verschiedene Texte zu zeigen. Das ist
// hier auch unbedenklich: Wer den Wert hat, hat ihn aus der Mail.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../demo_bremse.php';
require_once __DIR__ . '/../demo_bestaetigung.php';
require_once __DIR__ . '/../demo_daten.php';
require_once __DIR__ . '/../demo_instanz.php';
require_once __DIR__ . '/../mailer.php';

// Wortgleich zu demo_anfordern.php -- siehe dort. Eine Meldung an den
// Betreiber darf den Interessenten nie etwas kosten.
function demo_betreiber_melden(array $mail, string $anlass, bool $faellig): void
{
    if (!$faellig) { return; }
    $an = demo_zugang_empfaenger();
    if ($an === null) {
        error_log("demo_bestaetigen ($anlass): kein Empfaenger im Deploy hinterlegt.");
        return;
    }
    try {
        smtp_senden($an, 'GuardOpS', $mail['betreff'], $mail['html'], $mail['text']);
    } catch (Throwable $e) {
        error_log("demo_bestaetigen ($anlass): Versand fehlgeschlagen -- " . $e->getMessage());
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$wert = trim((string)($in['t'] ?? ''));

// Die Form wird geprüft, bevor irgendetwas nachgeschlagen wird: Der Wert
// ist hexadezimal und 64 Zeichen lang. Alles andere kommt nicht aus einer
// unserer Mails und braucht keine Datenbankabfrage.
if (!preg_match('/^[0-9a-f]{64}$/', $wert)) {
    json_response(['status' => 'error', 'grund' => 'unbekannt',
        'message' => 'Dieser Bestätigungslink ist ungültig.'], 400);
}

// Bremse gegen das Durchprobieren von Werten. Eigenes Verzeichnis, damit
// ein Versuch hier nicht gegen das Kontingent des Anfrageformulars zählt.
// Sie fällt zu, nicht auf (siehe demo_bremse.php).
$ip = demo_bremse_adresse();
try {
    $sperre = demo_bremse_pruefen($ip, demo_bremse_verzeichnis() . '-bestaetigen');
} catch (Throwable $e) {
    json_response(['status' => 'error', 'grund' => 'fehlschlag',
        'message' => 'Die Bestätigung kann gerade nicht bearbeitet werden. '
            . 'Bitte später erneut versuchen.'], 503);
}
if ($sperre > 0) {
    json_response(['status' => 'error', 'grund' => 'gebremst',
        'message' => "Zu viele Versuche. Bitte $sperre Minuten warten."], 429);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_bestaetigung') || !hat_tabelle($pdo, 'demo_zugang')
    || !hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error', 'grund' => 'fehlschlag',
        'message' => 'Der Demo-Bereich ist noch nicht eingerichtet.'], 503);
}

$stmt = $pdo->prepare('SELECT * FROM demo_bestaetigung WHERE wert_abdruck = ? LIMIT 1');
$stmt->execute([demo_bestaetigung_abdruck($wert)]);
$offen = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$offen) {
    json_response(['status' => 'error', 'grund' => 'unbekannt',
        'message' => 'Diesen Bestätigungslink kennen wir nicht. '
            . 'Vielleicht wurde er inzwischen durch eine neuere Anfrage ersetzt.'], 404);
}
if ($offen['eingeloest_am'] !== null) {
    // Schon eingelöst ist kein Fehler des Interessenten -- meist hat er
    // den Knopf zweimal gedrückt oder die Seite neu geladen. Der Text
    // sagt darum, wo seine Zugangsdaten sind, statt ihn abzuweisen.
    json_response(['status' => 'error', 'grund' => 'schon_benutzt',
        'message' => 'Dieser Zugang wurde bereits eingerichtet. '
            . 'Die Zugangsdaten liegen in Ihrem Postfach.'], 409);
}
if (demo_bestaetigung_abgelaufen((string)$offen['erstellt_am'], date('Y-m-d H:i:s'))) {
    json_response(['status' => 'error', 'grund' => 'abgelaufen',
        'message' => 'Dieser Bestätigungslink ist abgelaufen. '
            . 'Fordern Sie den Zugang bitte noch einmal an.'], 410);
}

// Hat diese Adresse inzwischen einen aktiven Zugang? Möglich, wenn jemand
// zweimal angefragt und beide Male bestätigt hat. Kein zweiter Platz
// (ENT-601) -- stattdessen derselbe Weg wie bei einer erneuten Anfrage.
$stmt = $pdo->prepare("SELECT * FROM demo_zugang WHERE status = 'aktiv' AND email = ? LIMIT 1");
$stmt->execute([(string)$offen['email']]);
$bestehend = $stmt->fetch(PDO::FETCH_ASSOC);
if ($bestehend) {
    $pdo->prepare('UPDATE demo_bestaetigung SET eingeloest_am = NOW() WHERE id = ?')
        ->execute([(int)$offen['id']]);
    $ergebnis = demo_zugang_neues_passwort($pdo, $bestehend, true);
    if ($ergebnis['fehler'] !== null) {
        error_log('demo_bestaetigen (bestehender Zugang): ' . $ergebnis['fehler']);
    } else {
        try {
            smtp_senden((string)$offen['email'], (string)$offen['person'],
                $ergebnis['mail']['betreff'], $ergebnis['mail']['html'],
                $ergebnis['mail']['text'], [], $ergebnis['mail']['bilder'] ?? []);
        } catch (Throwable $e) {
            error_log('demo_bestaetigen (bestehender Zugang): Versand fehlgeschlagen -- '
                . $e->getMessage());
        }
    }
    json_response(['status' => 'ok', 'grund' => 'besteht_bereits',
        'adresse' => demo_platz_adresse((string)$bestehend['platz']),
        'message' => 'Für diese Adresse besteht bereits ein Demo-Zugang. '
            . 'Wir haben Ihnen neue Zugangsdaten geschickt.']);
}

// ── Jetzt wird wirklich eingerichtet ─────────────────────────────────
//
// ZUERST DER VERMERK, DANN DIE ARBEIT: Zwei Klicks kurz hintereinander
// dürfen nicht zwei Plätze kosten. Der Vermerk mit der Bedingung
// „eingeloest_am IS NULL" lässt genau einen von beiden durch -- der
// zweite sieht danach den Zustand „schon benutzt" und richtet nichts ein.
// Andersherum stünde am Ende ein zweiter Zugang für denselben Menschen.
$gesetzt = $pdo->prepare(
    'UPDATE demo_bestaetigung SET eingeloest_am = NOW()
      WHERE id = ? AND eingeloest_am IS NULL'
);
$gesetzt->execute([(int)$offen['id']]);
if ($gesetzt->rowCount() !== 1) {
    json_response(['status' => 'error', 'grund' => 'schon_benutzt',
        'message' => 'Dieser Zugang wurde bereits eingerichtet. '
            . 'Die Zugangsdaten liegen in Ihrem Postfach.'], 409);
}

$firma   = (string)$offen['firma'];
$person  = (string)$offen['person'];
$email   = (string)$offen['email'];
$telefon = (string)$offen['telefon'];

$neu = demo_zugang_einrichten($pdo, $firma, $person, $email, $telefon);
if ($neu['fehler'] !== null) {
    // Die Einrichtung ist nicht zustande gekommen -- also gilt die
    // Bestätigung auch nicht als verbraucht. Sonst hätte der Interessent
    // einen entwerteten Link und keinen Zugang, und das ist der
    // ärgerlichste aller Zustände.
    $pdo->prepare('UPDATE demo_bestaetigung SET eingeloest_am = NULL WHERE id = ?')
        ->execute([(int)$offen['id']]);
    if ($neu['fehler'] === 'kein_platz') {
        demo_betreiber_melden(demo_vorrat_mail(count(DEMO_PLAETZE)), 'Vorratswarnung',
            demo_warnung_faellig_und_vermerken());
    }
    json_response(['status' => 'error', 'grund' => $neu['fehler'],
        'message' => $neu['meldung']], $neu['code']);
}

try {
    smtp_senden($email, $person, $neu['mail']['betreff'], $neu['mail']['html'],
        $neu['mail']['text'], [], $neu['mail']['bilder'] ?? []);
} catch (Throwable $e) {
    error_log('demo_bestaetigen: Versand fehlgeschlagen -- ' . $e->getMessage());
}

// Erst jetzt ist es ein Interessent und keine Absichtserklärung mehr --
// darum meldet ENT-622 an dieser Stelle und nicht schon beim Absenden des
// Formulars.
demo_betreiber_melden(
    demo_melde_mail($firma, $person, $email, $telefon, (string)$neu['platz'],
        (string)$neu['adresse'], (string)$neu['laeuft_ab']),
    'Meldung ueber neuen Zugang', true);

json_response(['status' => 'ok', 'grund' => 'eingerichtet',
    'adresse' => $neu['adresse'],
    'message' => 'Ihr Demo-Zugang ist eingerichtet. '
        . 'Die Zugangsdaten sind unterwegs zu Ihnen.']);
