<?php
// Kundenportal: anmelden (ENT-441, erweitert in ENT-444).
//
// POST { email, passwort }  ->  { status, token, name, kunde }
// POST { email, code }      ->  { status, token, name, kunde, passwort_noetig }
//
// ZWEI WEGE, EIN ZIEL. Der Normalfall ist das eigene Passwort. Der
// Einmal-Code ist der Weg fuer die ERSTE Anmeldung und fuer den Fall
// "Passwort vergessen" -- danach verlangt das Portal ein Passwort
// (passwort_noetig). Damit geht nie ein Passwort per Mail hinaus, und
// zugleich muss niemand bei jedem Besuch ins Postfach.
//
// KEIN require_session() UND KEIN require_kundensession(): Auch das ist
// noch der Eingang -- die Sitzung entsteht hier erst.
//
// ZWEI BREMSEN, WEIL ES ZWEI WEGE SIND
//
// Der CODE hat seinen eigenen Zaehler: kundenzugang_code.versuche. Sechs
// Stellen sind eine Million Moeglichkeiten; nach KP_CODE_VERSUCHE ist der
// Code tot, und ein neuer muss angefordert werden. Damit ist ein Code
// hoechstens fuenf Versuche wert, egal wie oft jemand es probiert.
//
// Das PASSWORT haengt an der Bremse aus anmeldung.php (ENT-075) -- mit der
// E-Mail-Adresse an der Stelle des Login-Namens. Ohne sie waere ein
// Kundenpasswort unbegrenzt ratbar, und zwar schneller als jedes
// Mitarbeiterpasswort, weil hier keine Zwei-Faktor-Anmeldung dahinter
// steht. Die Sperre laeuft von selbst ab und verraet nicht, ob es die
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
// Leerzeichen entfernen: Aus einer Mail kopierte Codes tragen sie oft mit.
$code     = preg_replace('/\s+/', '', (string)($in['code'] ?? '')) ?? '';
// Beim Passwort NICHT beschneiden -- ein Leerzeichen am Ende kann Teil
// davon sein, und wer es beim Setzen mitgetippt hat, kaeme sonst nicht
// mehr hinein.
$passwort = (string)($in['passwort'] ?? '');

// EINE Fehlermeldung fuer alles, was schiefgehen kann. Ob die Adresse
// unbekannt ist, der Code abgelaufen, verbraucht oder schlicht falsch --
// nach aussen ist es dasselbe. Der Hinweis auf einen neuen Code steht
// darin, weil er in jedem dieser Faelle der richtige naechste Schritt ist.
$abweisen = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Der Code stimmt nicht oder gilt nicht mehr. '
                   . 'Bitte einen neuen Code anfordern.'], 401);
};

if ($email === '' || ($code === '' && $passwort === '')) {
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
// in login.php). Sie zaehlt fuer BEIDE Wege: Wer den Code durchprobiert,
// soll nicht auf das Passwort ausweichen koennen und umgekehrt.
$adresse = anmeld_adresse();
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen($pdo, $email, $adresse);
$sperre = anmeld_sperre($fehlerName, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => "Zu viele Fehlversuche. Bitte $sperre Minuten warten."], 429);
}

$stmt = $pdo->prepare(
    'SELECT z.id, z.name, z.kunde_id, z.password_hash, k.name AS kunde_name
       FROM kundenzugang z JOIN kunden k ON k.id = z.kunde_id
      WHERE z.email = ? AND z.aktiv = 1'
);
$stmt->execute([$email]);
$zugang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$zugang) { $abweisen(); }

$zugangId = (int)$zugang['id'];
$hash     = (string)($zugang['password_hash'] ?? '');

// ── Weg 1: eigenes Passwort (der Normalfall) ──────────────────────────
if ($passwort !== '') {
    if ($hash === '' || !password_verify($passwort, $hash)) {
        anmeld_fehlversuch($pdo, $email, $adresse);
        // EINE Meldung fuer beides -- ob es zu dieser Adresse ueberhaupt
        // einen Zugang gibt oder ob nur das Passwort falsch ist, steht
        // nicht darin. Der Hinweis auf den Code ist zugleich der Weg fuer
        // jemanden, der noch gar keines gesetzt hat.
        json_response(['status' => 'error',
            'message' => 'E-Mail-Adresse oder Passwort stimmt nicht. '
                       . 'Beim ersten Mal — oder wenn Sie es vergessen haben — '
                       . 'melden Sie sich mit einem Code an.'], 401);
    }
    // Aeltere Passwoerter still auf den neuen Aufwand heben (wie login.php):
    // Das Klartextpasswort liegt genau hier EINMAL vor.
    if (password_needs_rehash($hash, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN])) {
        $pdo->prepare('UPDATE kundenzugang SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($passwort, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), $zugangId]);
    }
    anmeld_zuruecksetzen($pdo, $email);
    kp_sitzung_eroeffnen($pdo, $zugangId, $zugang, false);
}

// ── Weg 2: Einmal-Code (erste Anmeldung, Passwort vergessen) ──────────
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
    anmeld_fehlversuch($pdo, $email, $adresse);
    $abweisen();
}

// Der Code ist verbraucht, sobald er einmal gestimmt hat -- unabhaengig
// davon, was danach noch passiert.
$pdo->prepare('UPDATE kundenzugang_code SET eingeloest_am = NOW() WHERE id = ?')
    ->execute([(int)$satz['id']]);
anmeld_zuruecksetzen($pdo, $email);

// Nach dem Code verlangt das Portal ein Passwort, wenn noch keines steht.
// Das ist der ganze Zweck des Umbaus aus ENT-444: Der Code ist der Weg
// hinein, nicht der Weg fuer jeden Tag.
kp_sitzung_eroeffnen($pdo, $zugangId, $zugang, $hash === '');

// Beide Wege enden hier -- eine Stelle, damit sie nicht auseinanderlaufen.
// Ein zweiter Ort, an dem eine Sitzung entsteht, waere ein zweiter Ort, an
// dem man den Zeitstempel oder den Aufraeumschritt vergisst.
function kp_sitzung_eroeffnen(PDO $pdo, int $zugangId, array $zugang, bool $passwortNoetig): void
{
    $token = bin2hex(random_bytes(32));
    $pdo->prepare(
        'INSERT INTO kunden_sessions (token, zugang_id, erstellt_am, letzte_nutzung)
         VALUES (?, ?, NOW(), NOW())'
    )->execute([$token, $zugangId]);

    // Wann war dieser Zugang zuletzt da? Die einzige Spur, ob ein
    // Portalzugang ueberhaupt genutzt wird -- und damit die Antwort auf die
    // Frage aus OP-426, was Kunden tatsaechlich anschauen.
    $pdo->prepare('UPDATE kundenzugang SET letzter_zugriff = NOW() WHERE id = ?')
        ->execute([$zugangId]);

    json_response(['status' => 'ok', 'token' => $token,
        'name'  => (string)$zugang['name'],
        'kunde' => (string)$zugang['kunde_name'],
        'passwort_noetig' => $passwortNoetig]);
}
