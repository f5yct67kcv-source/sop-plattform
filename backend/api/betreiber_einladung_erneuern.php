<?php
// Ein eingeladenes Betreiber-Konto NEU einladen.
//
// WARUM ES DAS BRAUCHT: Der Link aus betreiber_einladen.php gilt
// BE_EINLADUNG_STUNDEN Stunden. Liess die eingeladene Person ihn
// verstreichen, sass das Konto fest: betreiber_einladen.php weist die
// Adresse als vergeben ab, von Hand freischalten ist gesperrt, und auch
// ein archiviertes Konto haelt seine Adresse. Der Kommentar bei der Tabelle
// `betreiber_einladung` versprach "ein erneutes Einladen ersetzt die
// Zeile" -- gebaut war es nicht.
//
// WAS GESCHIEHT: Ein neuer Link an die HINTERLEGTE Adresse, mit neuer
// Frist. Der alte Link ist im selben Schritt tot, auch wenn er noch galt
// (be_einladung_ersetzen()). Die Adresse laesst sich hier nicht aendern:
// Wer eine andere will, aendert sie am Konto -- sonst waere dieser Knopf
// ein zweiter Weg, ein Konto an eine fremde Adresse umzuleiten, ohne dass
// das Logbuch eine Adressaenderung zeigt.
//
// NUR MIT OFFENER EINLADUNG: Ein eingeloestes Konto hat sein Passwort, und
// ein neuer Link waere ein Weg, es ein zweites Mal zu setzen -- das
// Zuruecksetzen fremder Passwoerter gibt es auf dieser Ebene bewusst nicht
// (Reiter Zugang).
//
// WER DARF DAS: require_betreiber_voll(), dieselbe Wache wie beim ersten
// Einladen. Ein neuer Link ist so viel wert wie der erste.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../mailer.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!be_einladung_tabelle_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Die Einladungen sind in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

$in   = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$ziel = (int)($in['id'] ?? 0);
if ($ziel <= 0) {
    json_response(['status' => 'error', 'message' => 'Welches Konto?'], 400);
}

$felder = hat_spalte($pdo, 'betreiber', 'vorname') ? 'id, name, vorname, email' : 'id, name, email';
if (hat_spalte($pdo, 'betreiber', 'archiviert_am')) { $felder .= ', archiviert_am'; }
$s = $pdo->prepare('SELECT ' . $felder . ' FROM betreiber WHERE id = ?');
$s->execute([$ziel]);
$konto = $s->fetch(PDO::FETCH_ASSOC);
if (!$konto) {
    json_response(['status' => 'error', 'message' => 'Dieses Konto gibt es nicht.'], 404);
}
if (!be_einladung_offen($pdo, $ziel)) {
    json_response(['status' => 'error',
        'message' => 'Dieses Konto hat seine Einladung schon eingelöst. Ein neuer Link würde '
                   . 'sein Passwort ein zweites Mal setzen — das gibt es auf dieser Ebene nicht.'], 409);
}
if (($konto['archiviert_am'] ?? null) !== null) {
    json_response(['status' => 'error',
        'message' => 'Dieses Konto ist archiviert. Erst aus dem Archiv holen, dann neu einladen.'], 409);
}

// Erst pruefen, ob sich verschicken laesst (wie beim ersten Einladen).
if (!smtp_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Für diese Anlage ist kein E-Mail-Versand eingerichtet. '
                   . 'Ohne ihn lässt sich niemand einladen.'], 503);
}
$basis = basis_url();
if ($basis === null) {
    json_response(['status' => 'error',
        'message' => 'Die eigene Adresse der Anlage ist nicht gesetzt (APP_BASIS_URL). '
                   . 'Ohne sie liesse sich kein Link bauen, der zurückführt.'], 503);
}

// Ersetzen und versenden in EINER Transaktion: Geht die Nachricht nicht
// hinaus, bleibt der bisherige Link, wie er war -- sonst haette die Person
// einen toten Link im Postfach und keinen neuen.
$tokenRoh = bin2hex(random_bytes(32));
$pdo->beginTransaction();
try {
    if (!be_einladung_ersetzen($pdo, $ziel, $tokenRoh, (int)$ich['id'])) {
        throw new LogicException('keine offene Einladung');
    }
    // Der Pfad zur Seite wird am Buendel gemessen -- Begruendung bei
    // be_einladung_versenden() in backend/betreiber.php.
    $seite = is_file(__DIR__ . '/../betreiber.html') ? '/betreiber.html' : '/';
    be_einladung_versenden($basis . $seite . '?einladung=' . urlencode($tokenRoh),
                           (string)$konto['email'], (string)$konto['name'],
                           (string)($konto['vorname'] ?? ''), (string)$ich['name'], true);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    if ($e instanceof RuntimeException) {
        json_response(['status' => 'error',
            'message' => 'Die Einladung liess sich nicht verschicken. Der bisherige Link bleibt, wie er war.'], 502);
    }
    json_response(['status' => 'error',
        'message' => 'Die Einladung konnte nicht erneuert werden.'], 400);
}

// Logbuch (ENT-614): wer wen neu eingeladen hat, und an welche Adresse.
be_log($pdo, $ich, 'konto', $ziel, 'neu_eingeladen', null, (string)$konto['email']);

json_response(['status' => 'ok', 'id' => $ziel,
               'gueltig_stunden' => BE_EINLADUNG_STUNDEN]);
