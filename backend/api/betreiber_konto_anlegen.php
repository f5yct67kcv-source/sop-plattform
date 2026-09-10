<?php
// Legt ein Konto der Betreiber-Ebene an (ENT-524).
//
// WER DARF DAS -- zwei Faelle, und der Unterschied ist der Einstieg:
//
//   1. Es gibt noch KEIN Betreiber-Konto. Dann richtet die Verwaltung
//      dieses Betriebs das erste ein (require_verwaltung), genau wie beim
//      Einrichtungsendpunkt. Ein Endpunkt, der sich selbst freischaltet,
//      solange eine Tabelle leer ist, waere so lange offen, bis ihn jemand
//      findet.
//   2. Es gibt bereits eines. Dann kommt an diese Ebene nur noch heran,
//      wer selbst dazugehoert (require_betreiber). Das ist derselbe
//      Gedanke wie require_augenhoehe() aus ENT-501: An ein Konto, das
//      alles darf, kommt nur, wer das selbst darf. Ein Cockpit-Admin --
//      auch der eines fremden Mandanten -- darf sich ab hier kein
//      Betreiber-Konto mehr ausstellen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';

$pdo = betreiber_db();
if (!be_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Der Betreiber-Bereich ist noch nicht eingerichtet.'], 503);
}

$vorhanden = (int)$pdo->query('SELECT COUNT(*) FROM betreiber')->fetchColumn();
if ($vorhanden === 0) {
    $user = require_session();
    require_verwaltung($user);
} else {
    require_betreiber_voll();
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$name  = trim((string)($daten['name']  ?? ''));
$email = mb_strtolower(trim((string)($daten['email'] ?? '')));
$pass  = (string)($daten['passwort'] ?? '');

if ($name === '' || $email === '') {
    json_response(['status' => 'error', 'message' => 'Name und E-Mail werden gebraucht.'], 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error', 'message' => 'Diese E-Mail-Adresse ist nicht gültig.'], 400);
}

// istAdmin = true, also 16 Zeichen (PASSWORT_MIN_ADMIN). Das ist keine
// Uebervorsicht: Wer dieses Konto hat, hat jeden Mandanten -- es ist das
// maechtigste der ganzen Anlage und traegt darum mindestens die
// Verwaltungsschwelle.
$fehler = passwort_pruefen($pass, $email, true);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 400);
}

try {
    $stmt = $pdo->prepare(
        'INSERT INTO betreiber (name, email, passwort_hash) VALUES (?, ?, ?)'
    );
    $stmt->execute([$name, $email, password_hash($pass, PASSWORD_BCRYPT, ['cost' => PASSWORT_KOSTEN])]);
} catch (Throwable $e) {
    // Doppelte Adresse ist der einzige erwartbare Fall und bekommt eine
    // eigene Aussage -- "geht nicht" waere hier nicht hilfreich.
    $schon = str_contains($e->getMessage(), 'uq_betreiber_email');
    json_response(['status' => 'error',
        'message' => $schon
            ? 'Für diese E-Mail-Adresse gibt es bereits ein Konto.'
            : 'Das Konto konnte nicht angelegt werden.'], 400);
}

json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId()]);
