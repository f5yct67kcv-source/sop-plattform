<?php
// Änderungswunsch des Empfängers aus der unangemeldeten Ansicht
// entgegennehmen (ENT-677).
//
// Bewusst OHNE Anmeldung -- aus demselben Grund wie
// betreiber_beleg_oeffentlich.php und betreiber_beleg_entscheidung.php: Der
// Empfaenger ist ein Betrieb, der diese Plattform noch nicht nutzt und kein
// Konto hat; der Token ersetzt die Anmeldung. Steht darum ebenfalls
// namentlich in OHNE_ANMELDUNG (test_php.mjs).
//
// NUR POST, damit ein blosser Linkaufruf -- die Vorschau eines
// Mailprogramms, ein Crawler -- nie eine Nachricht erzeugt.
//
// NUR SOLANGE NICHT ENTSCHIEDEN IST. Nach Annahme oder Ablehnung ist der
// Vorgang abgeschlossen; eine Nachricht danach stuende in einem Faden, den
// niemand mehr erwartet. Die Seite zeigt das Feld dann auch nicht mehr --
// diese Wache hier ist die, die traegt (Hausregel: Sperren gehoeren in den
// Server).
//
// DER VERSAND DARF DIE EINGABE NIE SCHEITERN LASSEN: Ist SMTP nicht
// eingerichtet, ist der Wunsch trotzdem geschrieben. Er steht am Beleg, und
// dort findet ihn der Betreiber auch ohne Post. Umgekehrt waere es eine
// Nachricht, die der Kunde fuer abgeschickt haelt und die es nicht gibt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../mail_vorlage.php';
require_once __DIR__ . '/../mailer.php';

function nachricht_zurueck(string $token, string $lage = ''): void
{
    header('Location: betreiber_beleg_oeffentlich.php?token=' . urlencode($token)
        . ($lage !== '' ? '&lage=' . urlencode($lage) : ''));
    exit;
}

function nachricht_abbruch(int $code, string $text): void
{
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo $text;
    exit;
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        nachricht_abbruch(405, 'Nur POST erlaubt.');
    }

    $token = (string)($_POST['token'] ?? '');
    $text  = trim((string)($_POST['text'] ?? ''));
    $name  = trim((string)($_POST['name'] ?? ''));
    if ($token === '') {
        nachricht_abbruch(400, 'Unvollständige Anfrage.');
    }

    // Dieselbe Bremse wie an den uebrigen unangemeldeten Eingaengen
    // (ENT-373/ENT-524), unter eigenem Namensraum. Ein 256-Bit-Token laesst
    // sich nicht erraten -- sie ist hier keine Abwehr, sondern eine
    // Begrenzung: Sie haelt jemanden davon ab, diesen Weg als Dauerlast oder
    // als Postfach-Schleuder zu benutzen.
    $adresse = anmeld_adresse();
    [, $fehlerAdresse] = anmeld_zaehlen(db(), 'be-nachricht:', $adresse);
    $sperre = anmeld_sperre(0, $fehlerAdresse);
    if ($sperre > 0) {
        nachricht_abbruch(429, 'Zu viele Einsendungen. Bitte in ' . $sperre . ' Minuten erneut versuchen.');
    }

    $pdo = betreiber_db();
    if (!hat_tabelle($pdo, 'be_belege')) {
        nachricht_abbruch(404, 'Dieser Link ist nicht (mehr) gültig.');
    }

    $s = $pdo->prepare(
        'SELECT id, art, nummer, status, kunde_id, gueltig_bis, entscheidung_am
           FROM be_belege WHERE versand_token = ?'
    );
    $s->execute([$token]);
    $b = $s->fetch();
    if (!$b) {
        // Ein erfundener Token wird gezaehlt: Wer hier reihenweise probiert,
        // soll langsamer werden. Ein richtiger Token zaehlt nicht mit --
        // sonst braechte sich ein Kunde mit mehreren Nachrichten selbst aus.
        anmeld_fehlversuch(db(), 'be-nachricht:', $adresse);
        nachricht_abbruch(404, 'Dieser Link ist nicht (mehr) gültig.');
    }

    // Nicht eingerichtet ist etwas anderes als abgewiesen: Zwischen Deploy
    // und Einrichtungslauf gibt es die Tabelle noch nicht.
    if (!be_beleg_nachricht_tabelle_da($pdo)) {
        nachricht_zurueck($token, 'nicht_eingerichtet');
    }

    $heute = date('Y-m-d');
    $abgelaufen = !empty($b['gueltig_bis']) && substr((string)$b['gueltig_bis'], 0, 10) !== '0000-00-00'
        && substr((string)$b['gueltig_bis'], 0, 10) < $heute;
    if (!empty($b['entscheidung_am']) || $abgelaufen) {
        nachricht_zurueck($token);
    }
    if ($text === '') {
        nachricht_zurueck($token, 'leer');
    }

    $nid = be_beleg_nachricht_anlegen($pdo, (int)$b['id'], 'kunde', $name, $text);
    if ($nid === 0) {
        nachricht_zurueck($token, 'leer');
    }

    // Der Zustand wechselt nur aus den beiden Lagen, in denen der Ball beim
    // Empfaenger lag. Ein Entwurf bleibt Entwurf -- er ist nie hinausgegangen.
    //
    // IN TRY/CATCH: Kennt die Spalte den Wert noch nicht (Anlage vor dem
    // Einrichtungslauf), weist MySQL das UPDATE ab. Die Nachricht ist dann
    // trotzdem geschrieben, und das ist das Wichtigere -- der Zustand ist die
    // Anzeige, nicht die Sache.
    if (in_array((string)$b['status'], ['versendet', 'angeschaut'], true)) {
        try {
            $pdo->prepare("UPDATE be_belege SET status = 'aenderung' WHERE id = ?")
                ->execute([(int)$b['id']]);
        } catch (Throwable $ex) {
            // Siehe oben: kein Grund, die Eingabe scheitern zu lassen.
        }
    }

    // ── Benachrichtigung an die Betreiber-Konten ──────────────────────
    try {
        if (smtp_konfiguriert()) {
            $basis = basis_url();
            // Im Buendel liegt der Betreiber-Bereich auf "/", im Repository
            // unter "/betreiber.html" -- gemessen statt angenommen, derselbe
            // Fallstrick wie beim Einladungslink (ENT-667).
            $seite = is_file(__DIR__ . '/../betreiber.html') ? '/betreiber.html' : '/';
            $link  = $basis === null ? '' : rtrim($basis, '/') . $seite;

            $kundeName = '';
            if ($b['kunde_id']) {
                $k = $pdo->prepare('SELECT name FROM be_kunden WHERE id = ?');
                $k->execute([(int)$b['kunde_id']]);
                $kundeName = (string)($k->fetchColumn() ?: '');
            }
            $absender = be_beleg_nachricht_absender(['seite' => 'kunde', 'autor' => $name]);
            $mail = beleg_nachricht_mail_betreiber($b, $kundeName, $absender, $text, $link);

            $e = $pdo->query('SELECT name, email FROM betreiber WHERE aktiv = 1 ORDER BY id ASC');
            foreach ($e->fetchAll(PDO::FETCH_ASSOC) ?: [] as $konto) {
                try {
                    smtp_senden((string)$konto['email'], (string)$konto['name'],
                        $mail['betreff'], $mail['html'], $mail['text']);
                } catch (Throwable $ex) {
                    // Ein Empfaenger, den es nicht mehr gibt, darf die
                    // uebrigen nicht aufhalten.
                }
            }
        }
    } catch (Throwable $ex) {
        // Siehe Kopf: Der Versand darf die Eingabe nie scheitern lassen.
    }

    nachricht_zurueck($token, 'gesendet');
} catch (Throwable $e) {
    nachricht_abbruch(500,
        'Diese Anfrage liess sich gerade nicht verarbeiten. Bitte versuchen Sie es später erneut.');
}
