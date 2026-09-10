<?php
// Kundenportal: Passwort ueber den zugeschickten Link setzen (ENT-448).
//
// POST { token, passwort }  ->  { status, token: <sitzung>, name, kunde }
//
// Gegenstueck zu portal_link_anfordern.php und im Aufbau bewusst gleich wie
// passwort_zuruecksetzen.php fuer Mitarbeitende (ENT-373).
//
// KEIN require_kundensession(): Der Link IST der Ausweis. Wer ihn hat, hat
// Zugriff auf das hinterlegte Postfach -- mehr verlangt auch der
// Mitarbeiterweg nicht.
//
// DER TOKEN WIRD ERST HIER VERBRAUCHT, beim Speichern. Das Oeffnen des
// Links (ein GET auf portal.html) beruehrt ihn nicht -- sonst waere er
// bereits tot, wenn ein Sicherheitsprogramm im Postfach ihn vorab
// angeklickt hat, und das tun Firmenpostfaecher regelmaessig.
//
// Nach dem Setzen wird gleich eine Sitzung eroeffnet. Wer sein Passwort
// eben festgelegt hat, soll es nicht im naechsten Schritt sofort wieder
// eintippen muessen -- er hat sich mit dem Link ausgewiesen und mit dem
// Passwort bestaetigt, dass er es kennt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require __DIR__ . '/../anmeldung.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in       = json_decode(file_get_contents('php://input'), true) ?? [];
$token    = (string)($in['token'] ?? '');
// Nicht beschneiden: Ein Leerzeichen am Ende kann Teil des Passworts sein.
$passwort = (string)($in['passwort'] ?? '');

// Eine einzige, unspezifische Meldung fuer JEDEN ungueltigen Zustand des
// Links (fehlt, unbekannt, abgelaufen, schon benutzt). Der Unterschied
// waere fuer den echten Empfaenger kein Gewinn -- in jedem Fall muss ein
// neuer Link her --, verriete einem Dritten mit geratenem Token aber, ob er
// nahe an einem echten war (Formulierung wie ENT-373).
$ungueltig = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Der Link ist ungültig oder abgelaufen. Bitte einen neuen anfordern.'], 400);
};

if ($token === '' || $passwort === '') {
    json_response(['status' => 'error', 'message' => 'token und passwort erforderlich'], 422);
}

$pdo = db();
if (!kp_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Das Kundenportal ist noch nicht eingerichtet.'], 503);
}
if (!hat_spalte($pdo, 'kundenzugang', 'password_hash')) {
    // "Noch nicht eingerichtet" ist etwas anderes als "Link ungueltig". Wer
    // das verwechselt, fordert endlos neue Links an, die alle funktionieren.
    json_response(['status' => 'error',
        'message' => 'Die Passwortvergabe ist noch nicht eingerichtet. '
                   . 'Bitte wenden Sie sich an Ihren Ansprechpartner.'], 503);
}

$s = $pdo->prepare(
    'SELECT c.id AS code_id, c.eingeloest_am, UNIX_TIMESTAMP(c.gueltig_bis) AS bis,
            z.id AS zugang_id, z.name, z.email, k.name AS kunde_name
       FROM kundenzugang_code c
       JOIN kundenzugang z ON z.id = c.zugang_id
       JOIN kunden k ON k.id = z.kunde_id
      WHERE c.code_hash = ? AND z.aktiv = 1'
);
$s->execute([hash('sha256', $token)]);
$row = $s->fetch(PDO::FETCH_ASSOC);
if (!$row || $row['eingeloest_am'] !== null || (int)$row['bis'] < time()) {
    $ungueltig();
}

// Die E-Mail-Adresse ist der Anmeldename dieses Zugangs -- sie darf darum
// nicht im Passwort stehen. Der lokale Teil vor dem @ ist das, was jemand
// zuerst probiert.
$loginTeil = explode('@', (string)$row['email'])[0] ?? '';
$fehler = passwort_pruefen($passwort, $loginTeil, false);
if ($fehler !== null) {
    // KEIN Verbrauch des Tokens: Ein zu schwaches Passwort ist ein
    // Vertipper, kein Angriff. Wer den Link dafuer verloere, muesste einen
    // neuen anfordern, nur weil er die Regel noch nicht kannte.
    json_response(['status' => 'error', 'message' => $fehler], 422);
}

$zugangId = (int)$row['zugang_id'];

$pdo->prepare('UPDATE kundenzugang_code SET eingeloest_am = NOW() WHERE id = ?')
    ->execute([(int)$row['code_id']]);
$pdo->prepare('UPDATE kundenzugang SET password_hash = ? WHERE id = ?')
    ->execute([password_hash($passwort, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), $zugangId]);

// Alle bestehenden Sitzungen dieses Zugangs beenden. Wer sein Passwort neu
// setzt, will oft genau das: den hinauswerfen, der noch angemeldet ist.
// Hier gibt es keine eigene zu schonen -- die entsteht erst gleich.
$pdo->prepare('DELETE FROM kunden_sessions WHERE zugang_id = ?')->execute([$zugangId]);
// Und offene Links entwerten -- einer, der noch im Postfach liegt, waere
// sonst weiterhin ein Weg an dem eben gesetzten Passwort vorbei.
$pdo->prepare('UPDATE kundenzugang_code SET gueltig_bis = NOW()
                WHERE zugang_id = ? AND eingeloest_am IS NULL')->execute([$zugangId]);

// Fehlversuche dieser Adresse loeschen: Wer ein neues Passwort gesetzt hat,
// soll nicht an einer Sperre haengen, die vom Vergessen des alten stammt.
anmeld_zuruecksetzen($pdo, (string)$row['email']);

$sitzung = bin2hex(random_bytes(32));
$pdo->prepare(
    'INSERT INTO kunden_sessions (token, zugang_id, erstellt_am, letzte_nutzung)
     VALUES (?, ?, NOW(), NOW())'
)->execute([sitzung_abdruck($sitzung), $zugangId]);
$pdo->prepare('UPDATE kundenzugang SET letzter_zugriff = NOW() WHERE id = ?')
    ->execute([$zugangId]);

json_response(['status' => 'ok', 'token' => $sitzung,
    'name'  => (string)$row['name'],
    'kunde' => (string)$row['kunde_name']]);
