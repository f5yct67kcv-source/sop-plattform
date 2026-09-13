<?php
// Kundenportal: anmelden (ENT-441, umgebaut in ENT-444 und ENT-448).
//
// POST { email, passwort }  ->  { status, token, name, kunde }
//
// EIN Weg, nicht mehr zwei. Bis ENT-448 fuehrte auch ein sechsstelliger
// Code hier hinein; er ist durch den Link aus portal_link_anfordern.php
// ersetzt, der direkt zur Passwortvergabe fuehrt
// (portal_neues_passwort.php). Damit gibt es genau eine Anmeldung -- und
// genau einen Weg zurueck, wenn das Passwort fehlt oder vergessen ist.
//
// KEIN require_session() UND KEIN require_kundensession(): Das ist der
// Eingang. Wer hier ankommt, ist noch niemand.
//
// DIE BREMSE GEGEN PASSWORT-RATEN ist dieselbe wie bei den Mitarbeitenden
// (ENT-075), mit der E-Mail-Adresse an der Stelle des Login-Namens. Ohne
// sie waere ein Kundenpasswort unbegrenzt ratbar, und zwar schneller als
// jedes Mitarbeiterpasswort -- hier steht keine Zwei-Faktor-Anmeldung
// dahinter. Die Sperre laeuft von selbst ab und verraet nicht, ob es die
// Adresse gibt: Sie greift fuer eine erfundene genauso.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require __DIR__ . '/../anmeldung.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in       = json_decode(file_get_contents('php://input'), true) ?? [];
$email    = kp_email_normal((string)($in['email'] ?? ''));
// Beim Passwort NICHT beschneiden -- ein Leerzeichen am Ende kann Teil
// davon sein, und wer es beim Setzen mitgetippt hat, kaeme sonst nicht
// mehr hinein.
$passwort = (string)($in['passwort'] ?? '');

// EINE Meldung fuer alles: unbekannte Adresse, falsches Passwort, noch kein
// Passwort gesetzt. Nach aussen ist es dasselbe. Der Hinweis auf den Link
// ist zugleich der richtige naechste Schritt in jedem dieser Faelle.
$abweisen = static function (): void {
    json_response(['status' => 'error',
        'message' => 'E-Mail-Adresse oder Passwort stimmt nicht. Haben Sie noch keines '
                   . 'oder es vergessen, fordern Sie unten einen Link an.'], 401);
};

if ($email === '' || $passwort === '') {
    json_response(['status' => 'error',
        'message' => 'Bitte E-Mail-Adresse und Passwort eingeben.'], 422);
}

$pdo = db();
if (!kp_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Das Kundenportal ist noch nicht eingerichtet.'], 503);
}

// Die Bremse steht VOR dem Datenbankzugriff auf den Zugang -- ein
// gesperrter Versuch soll gar nicht erst rechnen (gleiche Reihenfolge wie
// in login.php).
$adresse = anmeld_adresse();
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen($pdo, $email, $adresse);
$sperre = anmeld_sperre($fehlerName, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => "Zu viele Fehlversuche. Bitte $sperre Minuten warten."], 429);
}

// Die Passwortspalte kam mit ENT-444 dazu und wird NICHT vorausgesetzt:
// Zwischen einem Deploy und dem Ausfuehren der Einrichtung liegt immer eine
// Zeitspanne, und in der muss die Seite eine verstaendliche Antwort geben
// statt an einem SQL-Fehler zu zerbrechen (dasselbe Muster wie db.php seit
// ENT-075 fuer sessions.letzte_nutzung).
if (!hat_spalte($pdo, 'kundenzugang', 'password_hash')) {
    json_response(['status' => 'error',
        'message' => 'Die Anmeldung ist noch nicht eingerichtet. '
                   . 'Bitte wenden Sie sich an Ihren Ansprechpartner.'], 503);
}

$stmt = $pdo->prepare(
    'SELECT z.id, z.name, z.kunde_id, z.password_hash, k.name AS kunde_name
       FROM kundenzugang z JOIN kunden k ON k.id = z.kunde_id
      WHERE z.email = ? AND z.aktiv = 1'
);
$stmt->execute([$email]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) {
    // Gerechnet wird trotzdem (ENT-501): Ohne das verriete die
    // ANTWORTZEIT, was die Meldung absichtlich verschweigt -- und hier
    // waere die Auskunft, welche E-Mail-Adressen Kunden des Betriebs sind.
    passwort_blindpruefung($passwort);
    anmeld_fehlversuch($pdo, $email, $adresse);
    $abweisen();
}

$zugangId = (int)$zugang['id'];
$hash     = (string)($zugang['password_hash'] ?? '');

// Auch der Fall "Zugang da, aber noch kein Passwort gesetzt" darf sich
// nicht ueber die Zeit verraten -- er ist von aussen dieselbe Aussage.
if ($hash === '') {
    passwort_blindpruefung($passwort);
}
if ($hash === '' || !password_verify($passwort, $hash)) {
    anmeld_fehlversuch($pdo, $email, $adresse);
    $abweisen();
}

// Aeltere Passwoerter still auf den neuen Aufwand heben (wie login.php):
// Das Klartextpasswort liegt genau hier EINMAL vor.
if (password_needs_rehash($hash, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN])) {
    $pdo->prepare('UPDATE kundenzugang SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($passwort, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), $zugangId]);
}
anmeld_zuruecksetzen($pdo, $email);

$token = bin2hex(random_bytes(32));
$pdo->prepare(
    'INSERT INTO kunden_sessions (token, zugang_id, erstellt_am, letzte_nutzung)
     VALUES (?, ?, NOW(), NOW())'
)->execute([sitzung_abdruck($token), $zugangId]);

// Wann war dieser Zugang zuletzt da? Die einzige Spur, ob ein Portalzugang
// ueberhaupt genutzt wird -- und damit die Antwort auf die Frage aus
// OP-426, was Kunden tatsaechlich anschauen.
$pdo->prepare('UPDATE kundenzugang SET letzter_zugriff = NOW() WHERE id = ?')
    ->execute([$zugangId]);

json_response(['status' => 'ok', 'token' => $token,
    'name'  => (string)$zugang['name'],
    'kunde' => (string)$zugang['kunde_name']]);
