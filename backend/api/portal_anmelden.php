<?php
// Kundenportal: Einmal-Code einloesen und Sitzung eroeffnen (ENT-441).
//
// POST { email, code }  ->  { status, token, name, kunde }
//
// KEIN require_session() UND KEIN require_kundensession(): Auch das ist
// noch der Eingang -- die Sitzung entsteht hier erst.
//
// WARUM DER ZAEHLER AM CODE HAENGT UND NICHT AN DER ADRESSE
//
// Sechs Stellen sind eine Million Moeglichkeiten. Ohne Begrenzung waeren
// sie in Minuten durchprobiert. Die Bremse aus anmeldung.php (ENT-075)
// greift hier nicht: Sie zaehlt je Login-Name, und ein Kundenzugang hat
// keinen. Darum zaehlt kundenzugang_code.versuche die Fehleingaben AUF
// DIESEN Code -- nach KP_CODE_VERSUCHE ist er tot, und ein neuer muss
// angefordert werden. Damit ist ein Code hoechstens fuenf Versuche wert,
// egal wie oft jemand es probiert.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in    = json_decode(file_get_contents('php://input'), true) ?? [];
$email = kp_email_normal((string)($in['email'] ?? ''));
// Leerzeichen entfernen: Aus einer Mail kopierte Codes tragen sie oft mit.
$code  = preg_replace('/\s+/', '', (string)($in['code'] ?? '')) ?? '';

// EINE Fehlermeldung fuer alles, was schiefgehen kann. Ob die Adresse
// unbekannt ist, der Code abgelaufen, verbraucht oder schlicht falsch --
// nach aussen ist es dasselbe. Der Hinweis auf einen neuen Code steht
// darin, weil er in jedem dieser Faelle der richtige naechste Schritt ist.
$abweisen = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Der Code stimmt nicht oder gilt nicht mehr. '
                   . 'Bitte einen neuen Code anfordern.'], 401);
};

if ($email === '' || $code === '') {
    json_response(['status' => 'error',
        'message' => 'Bitte E-Mail-Adresse und Code eingeben.'], 422);
}

$pdo = db();
if (!kp_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Das Kundenportal ist noch nicht eingerichtet.'], 503);
}

$stmt = $pdo->prepare(
    'SELECT z.id, z.name, z.kunde_id, k.name AS kunde_name
       FROM kundenzugang z JOIN kunden k ON k.id = z.kunde_id
      WHERE z.email = ? AND z.aktiv = 1'
);
$stmt->execute([$email]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) { $abweisen(); }

$zugangId = (int)$zugang['id'];

// Der juengste noch nicht eingeloeste Code dieses Zugangs. Aeltere sind
// beim Anfordern eines neuen bereits ungueltig gemacht worden.
$cs = $pdo->prepare(
    'SELECT id, code_hash, versuche, eingeloest_am,
            UNIX_TIMESTAMP(gueltig_bis) AS bis
       FROM kundenzugang_code
      WHERE zugang_id = ?
      ORDER BY id DESC LIMIT 1'
);
$cs->execute([$zugangId]);
$satz = $cs->fetch(PDO::FETCH_ASSOC);
if (!$satz) { $abweisen(); }

$eingeloest = $satz['eingeloest_am'] !== null
    ? (strtotime((string)$satz['eingeloest_am']) ?: 0)
    : null;
$zustand = kp_code_zustand($eingeloest, (int)$satz['bis'], (int)$satz['versuche'], time());
if ($zustand !== 'offen') { $abweisen(); }

if (!password_verify($code, (string)$satz['code_hash'])) {
    // Fehlversuch zaehlen, BEVOR abgewiesen wird -- sonst waere der Zaehler
    // wirkungslos.
    $pdo->prepare('UPDATE kundenzugang_code SET versuche = versuche + 1 WHERE id = ?')
        ->execute([(int)$satz['id']]);
    $abweisen();
}

// Der Code ist verbraucht, sobald er einmal gestimmt hat -- unabhaengig
// davon, was danach noch passiert.
$pdo->prepare('UPDATE kundenzugang_code SET eingeloest_am = NOW() WHERE id = ?')
    ->execute([(int)$satz['id']]);

$token = bin2hex(random_bytes(32));
$pdo->prepare(
    'INSERT INTO kunden_sessions (token, zugang_id, erstellt_am, letzte_nutzung)
     VALUES (?, ?, NOW(), NOW())'
)->execute([$token, $zugangId]);

// Wann war dieser Zugang zuletzt da? Die einzige Spur, ob ein Portalzugang
// ueberhaupt genutzt wird -- und damit die Antwort auf die Frage aus
// OP-426, was Kunden tatsaechlich anschauen.
$pdo->prepare('UPDATE kundenzugang SET letzter_zugriff = NOW() WHERE id = ?')
    ->execute([$zugangId]);

json_response(['status' => 'ok', 'token' => $token,
    'name'  => (string)$zugang['name'],
    'kunde' => (string)$zugang['kunde_name']]);
