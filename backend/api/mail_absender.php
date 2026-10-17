<?php
declare(strict_types=1);
// Absender der Kundenmails: GuardOpS oder der eigene Mailserver des
// Betriebs (ENT-730). Reiter "Absender" unter Betrieb › E-Mail-Versand.
//
// GET  -> { status, versand, schluessel_da, stand_unbekannt, darf_aendern, ports, testmail_an }
// POST {aktion: 'speichern', versand}      -> { status, versand } | 400 { fehler } | 422 { message }
// POST {aktion: 'testmail', versand, an}   -> { status, an }
//
// Rechte wie beim E-Mail-Designer: Ansehen mit "betrieb" lesen, Speichern
// und Testmail mit "betrieb" schreiben.
//
// DAS PASSWORT VERLAESST DEN SERVER NIE: GET liefert nur, OB eines
// hinterlegt ist. Ein leeres Passwortfeld beim Speichern heisst
// "unveraendert".
//
// SPEICHERN PRUEFT DIE ANGABEN: Vor dem Speichern meldet sich der Server
// einmal am Mailserver an, ohne etwas zu versenden. Klappt das nicht, wird
// nicht gespeichert (Entscheid des Projektinhabers).
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../mail_gestaltung.php';

$user = require_session();
$pdo = db();
$spalteDa = hat_spalte($pdo, 'betrieb', 'mail_versand');

function mail_v_eigene_adresse(PDO $pdo, int $id): string
{
    $s = $pdo->prepare('SELECT email FROM mitarbeiter WHERE id = ?');
    $s->execute([$id]);
    $a = trim((string)$s->fetchColumn());
    return filter_var($a, FILTER_VALIDATE_EMAIL) ? $a : '';
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    require_recht($user, 'betrieb_lesen');
    json_response([
        'status' => 'ok',
        'versand' => mail_v_oeffentlich(mail_v_laden($pdo)),
        'schluessel_da' => mail_v_schluessel() !== null,
        'stand_unbekannt' => !$spalteDa,
        'darf_aendern' => darf($user, 'betrieb_schreiben'),
        'ports' => MAIL_V_PORTS,
        // Vorschlag fuer das Adressfeld der Testmail: die Adresse am eigenen
        // Konto. Leer, wenn keine hinterlegt ist -- die Seite nimmt dann die
        // Absenderadresse.
        'testmail_an' => mail_v_eigene_adresse($pdo, (int)$user['id']),
    ]);
}

require_recht($user, 'betrieb_schreiben');
$in = json_decode((string)file_get_contents('php://input'), true);
$in = is_array($in) ? $in : [];
$aktion = (string)($in['aktion'] ?? '');
$alt = mail_v_laden($pdo);
[$neu, $fehler] = mail_v_pruefen(is_array($in['versand'] ?? null) ? $in['versand'] : [], $alt);
if ($fehler) {
    json_response(['status' => 'error', 'fehler' => $fehler, 'message' => implode(' ', $fehler)], 400);
}
$schluessel = mail_v_schluessel();
$firma = mail_g_betrieb($pdo)['firma'];

// Der Zugang fuer smtp_senden()/smtp_anmeldung_pruefen() aus der Eingabe;
// ein leeres Passwortfeld nimmt das gespeicherte.
$zugang = function () use ($neu, $alt, $schluessel, $firma): array {
    $klar = $neu['passwort_klar'] !== '' ? $neu['passwort_klar'] : null;
    $s = mail_v_server($neu + ['passwort' => (string)($alt['passwort'] ?? '')], $firma, $schluessel, $klar);
    if (isset($s['fehler'])) {
        json_response(['status' => 'error', 'message' => $s['fehler']], 409);
    }
    return $s;
};

if ($neu['typ'] === 'eigen' && $schluessel === null) {
    json_response(['status' => 'error', 'ohne_schluessel' => true,
        'message' => 'Auf dieser Anlage fehlt noch der Schlüssel, mit dem das Passwort verschlüsselt wird. '
            . 'Ein eigener Mailserver lässt sich erst danach einrichten. Bitte der Betreiberin melden.'], 409);
}

if ($aktion === 'speichern') {
    if (!$spalteDa) {
        json_response(['status' => 'error', 'stand_unbekannt' => true,
            'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand. Der Absender lässt sich danach speichern.'], 409);
    }
    if ($neu['typ'] === 'guardops') {
        // Die Angaben zum eigenen Server bleiben stehen: Wer zurueckwechselt,
        // muss sie nicht neu eintippen. Benutzt werden sie nicht.
        $stand = ['typ' => 'guardops'] + $alt;
        $stand['typ'] = 'guardops';
        unset($stand['letzter_fehler']);
    } else {
        $s = $zugang();
        try {
            smtp_anmeldung_pruefen($s);
        } catch (Throwable $e) {
            json_response(['status' => 'error', 'anmeldung' => false,
                'message' => 'Nicht gespeichert. Der Mailserver hat die Anmeldung nicht angenommen: ' . $e->getMessage()], 422);
        }
        $stand = ['typ' => 'eigen', 'absender' => $neu['absender'], 'benutzer' => $neu['benutzer'],
                  'server' => $neu['server'], 'port' => $neu['port'], 'verschluesselung' => $neu['verschluesselung'],
                  'passwort' => mail_v_verschluesseln($s['pass'], $schluessel),
                  'zuletzt_ok' => date('Y-m-d H:i:s')];
    }
    mail_v_schreiben($pdo, $stand);
    json_response(['status' => 'ok', 'versand' => mail_v_oeffentlich($stand)]);
}

if ($aktion === 'testmail') {
    // Die Adresse kommt aus dem Feld neben dem Knopf (Entscheid des
    // Projektinhabers): So laesst sich auch an ein fremdes Postfach testen,
    // wie die Mail dort ankommt. Der Inhalt ist fest; frei ist nur, wohin.
    $an = trim(preg_replace('/[\x00-\x1F\x7F]/', '', (string)($in['an'] ?? '')));
    if (!filter_var($an, FILTER_VALIDATE_EMAIL)) {
        json_response(['status' => 'error', 'ohne_adresse' => true,
            'message' => 'Bitte eine gültige E-Mail-Adresse für die Testmail eingeben.'], 400);
    }
    $server = $neu['typ'] === 'eigen' ? $zugang() : null;
    if ($server === null && !smtp_konfiguriert()) {
        json_response(['status' => 'error', 'message' => 'Der E-Mail-Versand ist noch nicht eingerichtet.'], 503);
    }
    $ueber = $server !== null ? 'deinen eigenen Mailserver (' . $server['host'] . ')' : 'GuardOpS';
    $text = "Diese Testmail ging über $ueber hinaus. Wenn du sie liest, funktioniert der Versand.";
    $html = '<p style="font-family:' . htmlspecialchars(MAIL_G_SCHRIFT, ENT_QUOTES) . ';font-size:15px;color:#1F2933;">'
          . htmlspecialchars($text) . '</p>';
    try {
        smtp_senden($an, '', '[Testmail] Absender der Kundenmails', $html, $text,
            [], [], '', $server);
    } catch (Throwable $e) {
        json_response(['status' => 'error', 'message' => 'Versand fehlgeschlagen: ' . $e->getMessage()], 502);
    }
    json_response(['status' => 'ok', 'an' => $an]);
}

json_response(['status' => 'error', 'message' => 'Unbekannte Aktion.'], 400);
