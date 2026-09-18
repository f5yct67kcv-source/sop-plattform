<?php
// "Zugangsdaten erneut senden" -- oeffentlich, ohne Anmeldung (ENT-601).
//
// Der Weg, den ein Interessent braucht, dessen Demo-Mail geloescht ist oder
// nie ankam -- ohne dass sich damit jemand einen Zugang verschaffen kann,
// den er nicht schon hat. Wortgleiches Prinzip wie passwort_vergessen.php:
//
//   - EINE Antwort fuer JEDEN Fall. Ob die Adresse einen aktiven Zugang
//     hat oder nicht, ob der Versand klappt oder nicht -- die Antwort ist
//     immer dieselbe. Alles andere verriete, welche Adressen einen Zugang
//     haben.
//   - Es entsteht NIE ein neuer Zugang. Diese Datei setzt ausschliesslich
//     ein neues Passwort fuer ein BESTEHENDES Konto -- ueber
//     demo_zugang_neues_passwort() in demo_instanz.php, denselben Weg, den
//     auch demo_anfordern.php fuer eine zweite Anfrage derselben Adresse
//     nimmt. Es gibt also nur einen Ort, an dem das passiert.
//   - KEIN eingetipptes Konto wird uebernommen oder zurueckgesetzt. Genau
//     das hatte der Projektinhaber ausdruecklich ausgeschlossen ("hier darf
//     es nicht moeglich sein, einfach eine mailadresse einzugeben und ein
//     PW zurueckzusetzen"): Diese Adresse bekommt hoechstens ein neues
//     Passwort fuer IHR EIGENES, bereits bestehendes Demo-Konto -- nie fuer
//     ein fremdes, nie fuer ein Konto ausserhalb der Demo.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../demo_bremse.php';
require_once __DIR__ . '/../demo_instanz.php';
require_once __DIR__ . '/../mailer.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

const DEMO_ERNEUT_DANKE = 'Falls diese Adresse einen aktiven Demo-Zugang hat, wurde soeben '
    . 'eine E-Mail mit neuen Zugangsdaten verschickt.';

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];

// Honigtopf mitverwendet -- ein Bot, der das Anfrageformular kennt, kennt
// meist auch dieses Feld.
if (demo_zugang_ist_falle($in)) {
    json_response(['status' => 'ok', 'message' => DEMO_ERNEUT_DANKE]);
}

$email = demo_zugang_einzeilig($in['email'] ?? '', DEMO_ZUGANG_MAX_EMAIL);

// Eigenes Bremsverzeichnis wie bei demo_anfordern.php, aus demselben Grund
// -- getrennt von der Bremse des Kontaktformulars UND von der der
// Erstanfrage: Wer viele "erneut senden" ausloest, soll das nicht auf
// Kosten der Erstanfrage-Bremse anderer Interessenten tun.
$verzeichnis = demo_bremse_verzeichnis() . '-erneut';
try {
    $sperre = demo_bremse_pruefen(demo_bremse_adresse(), $verzeichnis);
} catch (Throwable $e) {
    // Auch hier: zufaellt, nicht aufmacht. Anders als bei demo_anfordern.php
    // bleibt die Antwort dieselbe -- ein Fehler in der Bremse darf nicht
    // verraten, dass gerade etwas versucht wurde.
    json_response(['status' => 'ok', 'message' => DEMO_ERNEUT_DANKE]);
}
if ($sperre > 0 || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_response(['status' => 'ok', 'message' => DEMO_ERNEUT_DANKE]);
}

$pdo = betreiber_db();
if (hat_tabelle($pdo, 'demo_zugang')) {
    $stmt = $pdo->prepare("SELECT * FROM demo_zugang WHERE status = 'aktiv' AND email = ? LIMIT 1");
    $stmt->execute([$email]);
    $zugang = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($zugang) {
        $ergebnis = demo_zugang_neues_passwort($pdo, $zugang);
        if ($ergebnis['fehler'] !== null) {
            error_log('demo_erneut_senden: ' . $ergebnis['fehler']);
        } else {
            try {
                smtp_senden($email, (string)$zugang['person'], $ergebnis['mail']['betreff'],
                    $ergebnis['mail']['html'], $ergebnis['mail']['text'],
                    [], $ergebnis['mail']['bilder'] ?? []);
            } catch (Throwable $e) {
                error_log('demo_erneut_senden: Versand fehlgeschlagen -- ' . $e->getMessage());
            }
        }
    }
}

json_response(['status' => 'ok', 'message' => DEMO_ERNEUT_DANKE]);
