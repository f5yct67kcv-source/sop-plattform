<?php
// Kundenportal: Link zum Setzen eines Passworts anfordern (ENT-448).
//
// POST { email }  ->  { status: 'ok', gueltig_minuten }
//
// Loest den sechsstelligen Code ab (ENT-444): Ein Klick statt einer
// abgetippten Zahl. Gleiches Muster wie passwort_vergessen.php fuer
// Mitarbeitende (ENT-373) -- inklusive der beiden Eigenschaften, auf die es
// dabei ankommt:
//
//  1. DER TOKEN WIRD ERST BEIM SPEICHERN VERBRAUCHT, nicht beim Oeffnen des
//     Links. Sicherheitsprogramme in Firmenpostfaechern (Outlook Safe Links
//     und Aehnliches) rufen jeden Link in einer Nachricht vorab auf, um ihn
//     zu pruefen. Ein Link, der beim Aufruf verfaellt, waere danach tot,
//     bevor der Empfaenger ihn ueberhaupt sieht -- und der Fehler saehe aus
//     wie "der Link funktioniert nicht".
//  2. DIE ANTWORT IST IMMER DIESELBE. Ob es die Adresse gibt, ob der Zugang
//     gesperrt ist, ob der Versand geklappt hat -- nichts davon steht
//     darin. Sonst waere dieser Endpunkt ein Werkzeug, um herauszufinden,
//     welche Firmen Kunden sind (Regel aus ENT-373, tragend seit ENT-441).
//
// KEIN require_session() UND KEIN require_kundensession(): Das ist der
// Eingang. Wer hier ankommt, ist noch niemand.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require __DIR__ . '/../mailer.php';
require_once __DIR__ . '/../anmeldung.php';   // Bremse je Absender-Adresse (ENT-501)

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in    = json_decode(file_get_contents('php://input'), true) ?? [];
$email = kp_email_normal((string)($in['email'] ?? ''));

$immerGleich = static function (): void {
    json_response(['status' => 'ok', 'gueltig_minuten' => KP_LINK_MINUTEN,
        'message' => 'Wenn zu dieser Adresse ein Zugang besteht, ist die Nachricht unterwegs.']);
};

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    // Auch hier nicht anders antworten: Eine abweichende Meldung fuer eine
    // unsinnige Adresse verriete, dass die anderen geprueft wurden.
    $immerGleich();
}

$pdo = db();
if (!kp_tabellen_da($pdo)) { $immerGleich(); }

// Ohne eigene Adresse kein Link (ENT-501) -- geprueft vor allem anderen,
// damit kein Token entsteht, das niemand bekommt. Die Antwort bleibt
// gleichlautend; der Grund geht ins Serverprotokoll, nicht an den Browser.
$basis = basis_url();
if ($basis === null) {
    error_log('Kundenportal: APP_BASIS_URL ist nicht gesetzt — kein Link verschickt.');
    $immerGleich();
}

// ── Bremse je Absender-Adresse (ENT-501) ──────────────────────────────
//
// Bis hierher gab es nur die Stundengrenze weiter unten, und die haengt an
// einem BEREITS BESTEHENDEN Zugang: Fuer eine Adresse, die es gar nicht
// gibt, war dieser Endpunkt unbegrenzt aufrufbar. Zusammen mit dem
// Zeitunterschied (bei einem Treffer laeuft ein vollstaendiger
// SMTP-Handshake, bei einem Fehlschlag nicht) liess sich damit
// durchprobieren, welche E-Mail-Adressen Kunden des Betriebs sind.
//
// Eigener Namensraum "portallink:", damit diese Zaehlung weder die
// Portal-Anmeldung noch die Ruecksetzung der Mitarbeitenden sperrt --
// dieselbe Ueberlegung wie bei "reset:" in passwort_vergessen.php.
// Gezaehlt wird JEDE Anfrage, nicht nur eine erfolglose: Es gibt hier kein
// "falsch", das sich unterscheiden liesse, ohne die Existenz zu verraten.
$adresse   = anmeld_adresse();
$bremsName = 'portallink:' . $email;
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen($pdo, $bremsName, $adresse);
if (anmeld_sperre($fehlerName, $fehlerAdresse) > 0) {
    // Auch hier dieselbe Antwort wie sonst: Eine 429 nur fuer bestehende
    // Adressen waere wieder ein Unterschied, den es nicht geben darf.
    $immerGleich();
}
anmeld_fehlversuch($pdo, $bremsName, $adresse);

$stmt = $pdo->prepare('SELECT id, name FROM kundenzugang WHERE email = ? AND aktiv = 1');
$stmt->execute([$email]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) { $immerGleich(); }

$zugangId = (int)$zugang['id'];

// Wie viele Links gingen in der letzten Stunde an diesen Zugang? Schuetzt
// das Postfach des Kunden davor, ueber diesen Weg zugemuellt zu werden.
$zaehl = $pdo->prepare(
    'SELECT COUNT(*) FROM kundenzugang_code
      WHERE zugang_id = ? AND erstellt_am > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
);
$zaehl->execute([$zugangId]);
if ((int)$zaehl->fetchColumn() >= KP_LINK_PRO_STUNDE) { $immerGleich(); }

// Ein frueherer, noch nicht eingeloester Link wird ungueltig: Sonst waere
// (etwa wenn jemand zweimal klickt, weil die erste Nachricht spaet ankam)
// der aeltere Link parallel gueltig -- zwei offene Tueren statt einer.
$pdo->prepare('UPDATE kundenzugang_code SET gueltig_bis = NOW()
                WHERE zugang_id = ? AND eingeloest_am IS NULL AND gueltig_bis > NOW()')
    ->execute([$zugangId]);

// 256 Bit Zufall. Gespeichert wird nur der SHA-256-Abdruck -- dasselbe
// Verfahren wie bei passwort_reset (ENT-373) und bewusst NICHT bcrypt: Ein
// Token dieser Laenge ist nicht zu erraten, und bcrypt kostete bei jedem
// Aufruf mit falschem Token spuerbar Rechenzeit.
$tokenRoh = bin2hex(random_bytes(32));
$pdo->prepare(
    'INSERT INTO kundenzugang_code (zugang_id, code_hash, erstellt_am, gueltig_bis)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ' . KP_LINK_MINUTEN . ' MINUTE))'
)->execute([$zugangId, hash('sha256', $tokenRoh)]);

if (!smtp_konfiguriert()) {
    error_log('Kundenportal: Link angefordert, aber SMTP ist nicht eingerichtet.');
    $immerGleich();
}

$betrieb = $pdo->query('SELECT firma FROM betrieb WHERE id = 1')->fetch();
$firma   = trim((string)($betrieb['firma'] ?? ''));
$absender = $firma !== '' ? $firma : 'Ihr Ansprechpartner';

// Die Basisadresse kommt aus dem DEPLOY und nicht mehr aus dem Host-Kopf
// der Anfrage (ENT-501). Das Anliegen der urspruenglichen Fassung bleibt
// erfuellt -- ein Test auf der Staging-Adresse schickt weiterhin Links auf
// Staging --, nur ist die Quelle jetzt der Deploy-Lauf, der die Umgebung
// zweifelsfrei kennt, statt der Anfrage, die jeder frei setzen kann. Dieser
// Endpunkt braucht keine Anmeldung: Der Host-Kopf kam hier von aussen.
$link = $basis . '/portal.html?neu=' . urlencode($tokenRoh);

// Betreff und Text formuliert der SERVER. Nichts aus der Anfrage geht in
// die Nachricht ein -- sonst waere dieser Endpunkt ein Weg, ueber die
// Firmenadresse beliebige Texte zu verschicken.
$betreff = 'Ihr Zugang zum Kundenportal';
$text = "Guten Tag\n\n"
      . "Über diesen Link legen Sie Ihr Passwort für das Kundenportal fest:\n$link\n\n"
      . "Der Link gilt " . KP_LINK_MINUTEN . " Minuten und nur einmal.\n\n"
      . "Haben Sie ihn nicht angefordert, können Sie diese Nachricht ignorieren — "
      . "ohne den Link geschieht nichts.\n\n"
      . "Freundliche Grüsse\n$absender";

$schrift = "font-family:-apple-system,'Segoe UI',Arial,sans-serif";
$e = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$html = '<div style="' . $schrift . ';color:#14161A;max-width:520px">'
      . '<p style="' . $schrift . ';margin:0 0 16px">Guten Tag</p>'
      . '<p style="' . $schrift . ';margin:0 0 20px">Über diesen Link legen Sie Ihr Passwort '
      . 'für das Kundenportal fest:</p>'
      . '<p style="margin:0 0 20px"><a href="' . $e($link) . '" '
      . 'style="' . $schrift . ';display:inline-block;background:#2F5BD7;color:#fff;'
      . 'text-decoration:none;font-weight:700;padding:13px 26px;border-radius:8px">'
      . 'Passwort festlegen</a></p>'
      . '<p style="' . $schrift . ';color:#6B7280;font-size:12px;margin:0 0 16px">'
      . 'Funktioniert der Knopf nicht? Diesen Link in den Browser kopieren:<br>'
      . $e($link) . '</p>'
      . '<p style="' . $schrift . ';margin:0 0 16px;color:#6B7280">Der Link gilt '
      . KP_LINK_MINUTEN . ' Minuten und nur einmal.</p>'
      . '<p style="' . $schrift . ';margin:0 0 16px;color:#6B7280">Haben Sie ihn nicht '
      . 'angefordert, können Sie diese Nachricht ignorieren — ohne den Link geschieht nichts.</p>'
      . '<p style="' . $schrift . ';margin:0">Freundliche Grüsse<br>' . $e($absender) . '</p>'
      . '</div>';

try {
    smtp_senden($email, (string)$zugang['name'], $betreff, $html, $text);
} catch (Throwable $ex) {
    error_log('Kundenportal: Linkversand fehlgeschlagen — ' . $ex->getMessage());
}
$immerGleich();
