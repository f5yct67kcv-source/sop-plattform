<?php
// Kundenportal: Einmal-Code anfordern (ENT-441 Punkt 7).
//
// POST { email }  ->  { status: 'ok', gueltig_minuten }
//
// KEIN require_session() UND KEIN require_kundensession(): Das ist der
// Eingang. Wer hier ankommt, ist noch niemand.
//
// DIE ANTWORT IST IMMER DIESELBE. Ob es die Adresse gibt, ob der Zugang
// gesperrt ist, ob der Versand geklappt hat -- nichts davon steht in der
// Antwort. Sonst waere dieser Endpunkt ein Werkzeug, um herauszufinden,
// welche Adressen bei welchem Sicherheitsunternehmen hinterlegt sind.
// Dieselbe Regel und derselbe Grund wie in passwort_vergessen.php
// (ENT-373).
//
// EHRLICH BENANNT, WAS ER NICHT LOEST: Die Antwortzeit unterscheidet sich
// messbar, weil nur im Trefferfall eine Mail hinausgeht. Das restlos zu
// beseitigen brauchte einen Versand im Hintergrund, den es hier nicht gibt
// (kein Zeitgeber, siehe OP-421). Wer die Adresse ohnehin kennt, gewinnt
// dadurch nichts; wer raten will, bekommt ein schwaches Signal. Der
// Zaehler unten begrenzt, wie oft.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require __DIR__ . '/../mailer.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in    = json_decode(file_get_contents('php://input'), true) ?? [];
$email = kp_email_normal((string)($in['email'] ?? ''));

// Die immer gleiche Antwort -- eine Funktion, damit sie nicht an fuenf
// Stellen leicht verschieden formuliert wird.
$immerGleich = static function (): void {
    json_response(['status' => 'ok', 'gueltig_minuten' => KP_CODE_MINUTEN,
        'message' => 'Wenn zu dieser Adresse ein Zugang besteht, ist der Code unterwegs.']);
};

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    // Auch hier nicht anders antworten: Eine abweichende Meldung fuer eine
    // unsinnige Adresse verriete, dass die anderen geprueft wurden.
    $immerGleich();
}

$pdo = db();
if (!kp_tabellen_da($pdo)) { $immerGleich(); }

$stmt = $pdo->prepare('SELECT id, name FROM kundenzugang WHERE email = ? AND aktiv = 1');
$stmt->execute([$email]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) { $immerGleich(); }

$zugangId = (int)$zugang['id'];

// Wie viele Codes ging in der letzten Stunde an diesen Zugang? Schuetzt
// das Postfach des Kunden davor, ueber diesen Weg zugemuellt zu werden.
$zaehl = $pdo->prepare(
    'SELECT COUNT(*) FROM kundenzugang_code
      WHERE zugang_id = ? AND erstellt_am > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
);
$zaehl->execute([$zugangId]);
if ((int)$zaehl->fetchColumn() >= KP_CODE_PRO_STUNDE) { $immerGleich(); }

// Aeltere offene Codes desselben Zugangs verfallen. Sonst gaebe es mehrere
// gueltige Wege hinein, und der aelteste liegt am laengsten im Postfach.
$pdo->prepare('UPDATE kundenzugang_code SET gueltig_bis = NOW()
                WHERE zugang_id = ? AND eingeloest_am IS NULL AND gueltig_bis > NOW()')
    ->execute([$zugangId]);

$code = kp_code_erzeugen();
// Gehasht, nicht im Klartext -- der Code ist der ganze Weg hinein und damit
// so schutzwuerdig wie ein Passwort (gleiche Ueberlegung wie bei den
// Notfallcodes in zwei_faktor_codes).
$pdo->prepare(
    'INSERT INTO kundenzugang_code (zugang_id, code_hash, erstellt_am, gueltig_bis)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ' . KP_CODE_MINUTEN . ' MINUTE))'
)->execute([$zugangId, password_hash($code, PASSWORD_DEFAULT)]);

if (!smtp_konfiguriert()) {
    // Nach aussen dieselbe Antwort. Nach innen ist das ein Betriebsfehler,
    // der auffallen muss -- ohne Mailversand kommt kein Kunde hinein.
    error_log('Kundenportal: Code angefordert, aber SMTP ist nicht eingerichtet.');
    $immerGleich();
}

$betrieb = $pdo->query('SELECT firma FROM betrieb WHERE id = 1')->fetch();
$firma   = trim((string)($betrieb['firma'] ?? ''));
$absender = $firma !== '' ? $firma : 'Ihr Ansprechpartner';

// Betreff und Text formuliert der SERVER. Nichts aus der Anfrage geht in
// die Nachricht ein -- sonst waere dieser Endpunkt ein Weg, ueber die
// Firmenadresse beliebige Texte zu verschicken (gleiche Regel wie in
// rundgang_rapport_versenden.php).
$betreff = 'Ihr Anmeldecode für das Kundenportal';
$text = "Guten Tag\n\n"
      . "Ihr Anmeldecode lautet: $code\n\n"
      . "Er gilt " . KP_CODE_MINUTEN . " Minuten und nur einmal.\n\n"
      . "Haben Sie diesen Code nicht angefordert, können Sie diese Nachricht "
      . "ignorieren — ohne den Code geschieht nichts.\n\n"
      . "Freundliche Grüsse\n$absender";

$schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
$e = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
      . '<p style="' . $schrift . ';margin:0 0 16px">Guten Tag</p>'
      . '<p style="' . $schrift . ';margin:0 0 8px">Ihr Anmeldecode:</p>'
      . '<div style="' . $schrift . ';font-size:32px;font-weight:700;letter-spacing:6px;'
      . 'padding:16px 0;margin:0 0 16px">' . $e($code) . '</div>'
      . '<p style="' . $schrift . ';margin:0 0 16px;color:#6B7280">Er gilt '
      . KP_CODE_MINUTEN . ' Minuten und nur einmal.</p>'
      . '<p style="' . $schrift . ';margin:0 0 16px;color:#6B7280">Haben Sie diesen Code nicht '
      . 'angefordert, können Sie diese Nachricht ignorieren — ohne den Code geschieht nichts.</p>'
      . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . $e($absender) . '</p>'
      . '</div>';

try {
    smtp_senden($email, (string)$zugang['name'], $betreff, $html, $text);
} catch (Throwable $ex) {
    // Auch der Fehlschlag bleibt nach aussen unsichtbar.
    error_log('Kundenportal: Code-Versand fehlgeschlagen — ' . $ex->getMessage());
}
$immerGleich();
