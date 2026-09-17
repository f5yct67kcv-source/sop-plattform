<?php
// Einen Interessenten für die Demo freigeben (ENT-600).
//
// Der Ablauf in einem Zug, und die Reihenfolge ist nicht beliebig:
//
//   1. Freien Platz suchen. Keiner frei heisst ABBRECHEN, nicht den ersten
//      nehmen -- zwei Interessenten auf einer Instanz sind genau der Fall,
//      den ENT-600 verhindert.
//   2. Die Instanz dieses Platzes leeren und mit Musterdaten befüllen.
//      Erst leeren, dann füllen: Ein zweiter Musterbetrieb neben dem alten
//      wäre eine stille Verdoppelung von allem.
//   3. Das persönliche Konto in der Instanz anlegen.
//   4. Erst jetzt ins Register schreiben. Andersherum stünde dort ein
//      Zugang, den es in der Instanz nicht gibt -- und der Platz wäre
//      belegt, ohne dass sich jemand anmelden könnte.
//   5. Mail verschicken. Scheitert sie, bleibt der Zugang bestehen und der
//      Betreiber sieht das in der Liste: Die Zugangsdaten stehen in der
//      Antwort und lassen sich von Hand weitergeben. Ein Rückbau wäre hier
//      falsch -- der Zugang FUNKTIONIERT, nur die Post kam nicht an.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_daten.php';
require_once __DIR__ . '/../demo_instanz.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')) {
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$daten  = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$firma  = trim((string)($daten['firma'] ?? ''));
$person = trim((string)($daten['person'] ?? ''));
$email  = trim((string)($daten['email'] ?? ''));

if ($firma === '' || $person === '' || $email === '') {
    json_response(['status' => 'error',
        'message' => 'Firma, Name und E-Mail-Adresse werden gebraucht.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error',
        'message' => 'Diese E-Mail-Adresse sieht nicht nach einer Adresse aus.'], 400);
}

// ── 1. Freien Platz ───────────────────────────────────────────────────
$belegt = $pdo->query("SELECT platz FROM demo_zugang WHERE status = 'aktiv'")
              ->fetchAll(PDO::FETCH_COLUMN);
$platz = demo_platz_waehlen(array_map('strval', $belegt));
if ($platz === null) {
    // "Kein Platz frei" ist etwas anderes als "geht nicht" -- der Betreiber
    // muss wissen, dass er einen laufenden Zugang beenden kann.
    json_response(['status' => 'error',
        'message' => 'Alle ' . count(DEMO_PLAETZE) . ' Demo-Plätze sind belegt. '
                   . 'Beenden Sie einen laufenden Zugang oder warten Sie, bis einer abläuft.'], 409);
}

// Die Instanz dieses Platzes finden. Sie steht als Mandant im Stamm; die
// Spalte `subdomain` trägt den Platznamen.
if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}
$stmt = $pdo->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
$stmt->execute([$platz]);
$m = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error',
        'message' => "Der Platz „$platz“ ist im Mandantenstamm nicht eingetragen. "
                   . 'Vor der ersten Freigabe muss er dort mit seiner eigenen Datenbank stehen.'], 503);
}
// Vier Lagen, vier Texte -- "nicht eingerichtet", "kein Zugriff" und
// "nichts vorhanden" sind verschiedene Aussagen (Hausregel).
$lage = mandant_verbindung_bereit($m);
if ($lage === 'standardverbindung') {
    json_response(['status' => 'error',
        'message' => "Der Platz „$platz“ zeigt auf die Standard-Datenbank statt auf eine eigene. "
                   . 'Eine Freigabe darauf würde den laufenden Betrieb leeren.'], 409);
}
if ($lage !== 'bereit') {
    json_response(['status' => 'error',
        'message' => "Der Platz „$platz“ ist nicht verbunden ($lage)."], 503);
}

// Die Instanz muss eingerichtet sein. Leeren und Befüllen setzen die
// Tabellen voraus; auf einer leeren Datenbank liefe beides ins Nichts und
// der Interessent bekäme einen Link auf eine Anmeldung ohne Konto.
$stand = mandant_stand($m);
if (!$stand['erreichbar'] || !empty($stand['fehlend'])) {
    json_response(['status' => 'error',
        'message' => "Der Platz „$platz“ ist noch nicht eingerichtet — es fehlen Tabellen. "
                   . 'Einmalig einrichten, dann steht er für jede weitere Freigabe bereit.'], 503);
}

// ── 2. Instanz leeren und neu befüllen ────────────────────────────────
// Derselbe Griff wie beim Beenden und beim Ablaufen -- eine Stelle, nicht
// drei (siehe backend/demo_instanz.php). Er prüft auch noch einmal selbst,
// dass der Platz nicht auf die Standard-Datenbank zeigt.
$fehler = demo_instanz_leeren($pdo, $platz);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 503);
}
$instanz = mandant_db($m);
demo_daten_erzeugen_ausfuehren($instanz);

// ── 3. Persönliches Konto in der Instanz ──────────────────────────────
$vergeben = $instanz->query('SELECT name FROM mitarbeiter')->fetchAll(PDO::FETCH_COLUMN);
$login    = demo_login_bilden($firma, array_map('strval', $vergeben));
$passwort = demo_passwort_erzeugen();

// Volle Verwaltungsrolle (ENT-600, Punkt 6). Sie ist vertretbar, WEIL der
// Interessent allein in dieser Instanz sitzt -- die Entscheidung hängt an
// der eigenen Instanz und fällt mit ihr.
$anlegen = $instanz->prepare(
    'INSERT INTO mitarbeiter (name, password_hash, ist_admin, vorname, nachname, aktiv)
     VALUES (?, ?, 1, ?, ?, 1)'
);
// Der Anzeigename ist der des Interessenten -- er sieht in seiner eigenen
// Instanz sich selbst, und sonst sieht ihn dort niemand.
$teile   = preg_split('/\s+/', $person) ?: [$person];
$nachname = count($teile) > 1 ? array_pop($teile) : $person;
$vorname  = count($teile) > 0 ? implode(' ', $teile) : '';
$anlegen->execute([$login, password_hash($passwort, PASSWORD_DEFAULT), $vorname, $nachname]);

// ── 4. Register ───────────────────────────────────────────────────────
$start    = date('Y-m-d H:i:s');
$laeuftAb = demo_zugang_ablauf($start);
// Wer freigegeben hat, steht im Register -- dieselbe Schreibweise wie bei
// der GAV-Bestaetigung (betreiber_mandant_gav.php).
$wer      = trim((string)$ich['name']) . ' <' . (string)$ich['email'] . '>';

$ein = $pdo->prepare(
    'INSERT INTO demo_zugang (platz, firma, person, email, login, status,
                              freigegeben_am, freigegeben_von, laeuft_ab_am)
     VALUES (?, ?, ?, ?, ?, \'aktiv\', ?, ?, ?)'
);
$ein->execute([$platz, $firma, $person, $email, $login, $start, $wer, $laeuftAb]);
$id = (int)$pdo->lastInsertId();

// ── 5. Mail ───────────────────────────────────────────────────────────
$adresse = (string)demo_platz_adresse($platz);
$mail    = demo_zugang_mail($firma, $person, $adresse, $login, $passwort, $laeuftAb);
$versand = 'gesendet';
$grund   = '';
try {
    smtp_senden($email, $person, $mail['betreff'], $mail['html'], $mail['text']);
} catch (Throwable $e) {
    // Der Zugang funktioniert, nur die Post kam nicht an. Zwei
    // verschiedene Aussagen, zwei verschiedene Texte -- und kein Rückbau.
    $versand = 'nicht_gesendet';
    $grund   = $e->getMessage();
}

json_response([
    'status'  => 'ok',
    'id'      => $id,
    'platz'   => $platz,
    'adresse' => $adresse,
    'login'   => $login,
    // Das Passwort steht GENAU EINMAL in einer Antwort: hier, damit der
    // Betreiber es weitergeben kann, wenn die Mail nicht ankam. Danach ist
    // es nur noch als Hash in der Instanz vorhanden und nirgends abrufbar.
    'passwort'     => $passwort,
    'laeuft_ab_am' => $laeuftAb,
    'versand'      => $versand,
    'versand_grund' => $grund,
]);
