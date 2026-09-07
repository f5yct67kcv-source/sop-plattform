<?php
// Kundenzugang anlegen, aendern, sperren oder entsperren (ENT-441).
//
// POST { id?, kunde_id, name, email, funktion?, aktiv? } -> { status, id }
//
// EIN Endpunkt fuer alles, weil das Formular immer den gewuenschten
// Endzustand schickt -- dasselbe Vorgehen wie bei objekt_personen.php und
// der Einsatz-Zuteilung (ENT-020).
//
// WAS HIER BEWUSST NICHT PASSIERT: Es wird kein Code verschickt und kein
// Zugang "aktiviert". Wer angelegt ist, fordert sich seinen Code selbst an
// (portal_code_anfordern.php). Ein Einladungsversand von hier aus waere ein
// zweiter Weg, ueber die Firmenadresse Nachrichten auszuloesen -- und er
// waere ueberfluessig: Die Adresse steht ohnehin schon hier.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../kundenportal.php';

$user = require_session();
require_recht($user, 'portal');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!kp_tabellen_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Die Einrichtung ist noch nicht gelaufen — bitte zuerst unten links „Einrichtung" ausführen.'], 409);
}

$in       = json_decode(file_get_contents('php://input'), true) ?? [];
$id       = (int)($in['id'] ?? 0);
$kundeId  = (int)($in['kunde_id'] ?? 0);
$name     = trim((string)($in['name'] ?? ''));
$email    = kp_email_normal((string)($in['email'] ?? ''));
$funktion = trim((string)($in['funktion'] ?? ''));
// Fehlt 'aktiv', bleibt es wie es ist -- ein Formular, das das Feld nicht
// kennt, darf niemanden versehentlich sperren oder entsperren.
$aktivDa  = array_key_exists('aktiv', $in);
$aktiv    = $aktivDa ? (!empty($in['aktiv'])) : true;

if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Bitte einen Namen angeben.'], 422);
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['status' => 'error',
        'message' => 'Bitte eine gültige E-Mail-Adresse angeben — sie ist die Anmeldung.'], 422);
}
if (mb_strlen($name) > 200 || mb_strlen($email) > 200 || mb_strlen($funktion) > 120) {
    json_response(['status' => 'error', 'message' => 'Eine der Angaben ist zu lang.'], 422);
}

if ($id <= 0) {
    // Beim Anlegen muss der Kunde stimmen. Beim Aendern wird er NICHT
    // umgehaengt: Ein Zugang, der ploetzlich einem anderen Kunden gehoert,
    // zeigt rueckwirkend fremde Objekte -- das waere ein Umzug, kein
    // Formularfeld, und es gibt keinen Anlass dafuer.
    $ks = $pdo->prepare('SELECT id FROM kunden WHERE id = ?');
    $ks->execute([$kundeId]);
    if (!$ks->fetchColumn()) {
        json_response(['status' => 'error', 'message' => 'Diesen Kunden gibt es nicht.'], 422);
    }
}

// Die Adresse IST die Anmeldung -- sie muss eindeutig bleiben. Der
// Datenbankschluessel faengt es ohnehin ab; hier steht es, damit die
// Meldung sagt, was los ist, statt eines rohen Datenbankfehlers.
$dop = $pdo->prepare('SELECT id FROM kundenzugang WHERE email = ? AND id <> ?');
$dop->execute([$email, $id]);
if ($dop->fetchColumn()) {
    json_response(['status' => 'error',
        'message' => 'Diese E-Mail-Adresse ist bereits einem Zugang zugeordnet.'], 409);
}

if ($id > 0) {
    $vor = $pdo->prepare('SELECT aktiv FROM kundenzugang WHERE id = ?');
    $vor->execute([$id]);
    $vorher = $vor->fetch(PDO::FETCH_ASSOC);
    if (!$vorher) {
        json_response(['status' => 'error', 'message' => 'Diesen Zugang gibt es nicht.'], 404);
    }
    $warAktiv = (int)$vorher['aktiv'] === 1;

    $pdo->prepare(
        'UPDATE kundenzugang
            SET name = ?, email = ?, funktion = ?, aktiv = ?,
                gesperrt_am = CASE WHEN ? = 0 AND aktiv = 1 THEN NOW()
                                   WHEN ? = 1 THEN NULL ELSE gesperrt_am END
          WHERE id = ?'
    )->execute([$name, $email, $funktion !== '' ? $funktion : null,
                $aktiv ? 1 : 0, $aktiv ? 1 : 0, $aktiv ? 1 : 0, $id]);

    // Eine Sperre wirkt SOFORT, nicht erst wenn die Sitzung ablaeuft: Die
    // laufenden Sitzungen werden entfernt. Eine Sperre, die den gerade
    // Angemeldeten noch wochenlang weiterlesen laesst, ist keine.
    if ($warAktiv && !$aktiv) {
        $pdo->prepare('DELETE FROM kunden_sessions WHERE zugang_id = ?')->execute([$id]);
        // Offene Codes ebenfalls entwerten -- sonst kaeme jemand mit einem
        // Code, der eine Minute vor der Sperre im Postfach lag, wieder hinein.
        $pdo->prepare('UPDATE kundenzugang_code SET gueltig_bis = NOW()
                        WHERE zugang_id = ? AND eingeloest_am IS NULL')->execute([$id]);
    }
    json_response(['status' => 'ok', 'id' => $id]);
}

$pdo->prepare(
    'INSERT INTO kundenzugang (kunde_id, name, email, funktion, aktiv, erstellt_von)
     VALUES (?, ?, ?, ?, ?, ?)'
)->execute([$kundeId, $name, $email, $funktion !== '' ? $funktion : null,
            $aktiv ? 1 : 0, (int)$user['id']]);

json_response(['status' => 'ok', 'id' => (int)$pdo->lastInsertId()]);
