<?php
// Die Angaben eines Betreiber-Kontos aendern (ENT-615).
//
// WER DARF DAS: require_betreiber_voll() -- wer selbst auf dieser Ebene
// angemeldet ist und seinen zweiten Faktor bestaetigt hat, darf jedes Konto
// dieser Ebene bearbeiten. Eine Abstufung waere hier eine Erfindung: Die
// Ebene hat keine Rollen, jedes Konto darf ohnehin jeden Mandanten
// (ENT-519). Die Stelle, an der es NICHT egal ist, wer handelt, ist das
// Passwort -- das aendert jeder nur an seinem eigenen Konto, und dafuer gibt
// es betreiber_konto_passwort.php.
//
// NICHT HIER: aktiv/stillgelegt (betreiber_konto_status.php, mit
// Aussperrschutz) und der zweite Faktor (betreiber_zf_*). Beide tragen
// eigene Wachen, die ein gemeinsamer Speicher-Endpunkt mitschleppen muesste.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_spalte($pdo, 'betreiber', 'vorname')) {
    // Nicht eingerichtet ist etwas anderes als nicht erlaubt (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Die Namensfelder sind in dieser Anlage noch nicht nachgetragen. '
                   . 'Ein Lauf der Einrichtung holt das nach.'], 503);
}

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id = (int)($in['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welches Konto?'], 400);
}

$s = $pdo->prepare('SELECT id, name, anrede, vorname, nachname, email FROM betreiber WHERE id = ?');
$s->execute([$id]);
$vorher = $s->fetch(PDO::FETCH_ASSOC);
if (!$vorher) {
    json_response(['status' => 'error', 'message' => 'Dieses Konto gibt es nicht.'], 404);
}

$anrede   = mb_substr(trim((string)($in['anrede']   ?? '')), 0, 20);
$vorname  = mb_substr(trim((string)($in['vorname']  ?? '')), 0, 100);
$nachname = mb_substr(trim((string)($in['nachname'] ?? '')), 0, 100);
$email    = mb_strtolower(mb_substr(trim((string)($in['email'] ?? '')), 0, 200));

if ($nachname === '') {
    json_response(['status' => 'error', 'message' => 'Ein Nachname wird gebraucht.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error', 'message' => 'Diese E-Mail-Adresse ist nicht gültig.'], 400);
}

$name = be_name_bauen($vorname, $nachname);
$nachher = ['name' => $name, 'anrede' => $anrede, 'vorname' => $vorname,
            'nachname' => $nachname, 'email' => $email];

try {
    $u = $pdo->prepare(
        'UPDATE betreiber SET name = ?, anrede = ?, vorname = ?, nachname = ?, email = ? WHERE id = ?'
    );
    $u->execute([$name, $anrede, $vorname, $nachname, $email, $id]);
} catch (Throwable $e) {
    $schon = str_contains($e->getMessage(), 'uq_betreiber_email');
    json_response(['status' => 'error',
        'message' => $schon
            ? 'Für diese E-Mail-Adresse gibt es bereits ein Konto.'
            : 'Die Änderung konnte nicht gespeichert werden.'], 400);
}

// `name` wird aus den Teilen zusammengesetzt und ist darum keine eigene
// Aenderung -- er stuende sonst bei jeder Namenskorrektur doppelt im Verlauf.
unset($vorher['id'], $vorher['name'], $nachher['name']);
$zahl = be_log_vergleich($pdo, $ich, 'konto', $id, $vorher, $nachher);

json_response(['status' => 'ok', 'id' => $id, 'name' => $name, 'logbuch' => $zahl]);
