<?php
declare(strict_types=1);
// Neues Passwort ueber einen zuvor per E-Mail verschickten Link setzen
// (ENT-373). Gegenstueck zu passwort_vergessen.php.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../anmeldung.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$token = (string)($in['token'] ?? '');
$neu = (string)($in['neu'] ?? '');

// Eine einzige, unspezifische Fehlermeldung fuer JEDEN ungueltigen Zustand
// des Tokens (fehlt, unbekannt, abgelaufen, schon benutzt). Ein Unterschied
// zwischen "abgelaufen" und "schon benutzt" waere fuer den echten Empfaenger
// kein Gewinn -- in beiden Faellen muss ein neuer Link her --, verriete
// einem Dritten mit erratenem Token aber, ob er nahe an einem echten war.
$ungueltig = static function () {
    json_response(['status' => 'error',
        'message' => 'Der Link ist ungültig oder abgelaufen. Bitte einen neuen Link anfordern.'], 400);
};

if ($token === '' || $neu === '') {
    json_response(['status' => 'error', 'message' => 'token und neu erforderlich'], 400);
}

$pdo = db();
if (!hat_tabelle($pdo, 'passwort_reset')) { $ungueltig(); }

$tokenHash = hash('sha256', $token);
$s = $pdo->prepare(
    'SELECT pr.id AS reset_id, pr.laeuft_ab, pr.benutzt_am,
            m.id AS mitarbeiter_id, m.name, m.ist_admin
     FROM passwort_reset pr
     JOIN mitarbeiter m ON m.id = pr.mitarbeiter_id
     WHERE pr.token_hash = ? AND m.aktiv = 1'
);
$s->execute([$tokenHash]);
$row = $s->fetch(PDO::FETCH_ASSOC);
if (!$row || $row['benutzt_am'] !== null || strtotime((string)$row['laeuft_ab']) < time()) {
    $ungueltig();
}

$mitarbeiterId = (int)$row['mitarbeiter_id'];
// Doppelte Absicherung (siehe passwort_vergessen.php): Fuer ein Admin-/
// Personal-Konto darf hier ohnehin nie ein gueltiger Token liegen -- diese
// Zeile faengt es trotzdem ab, falls sich das je aendern sollte, ohne dass
// diese Datei mitgeaendert wird.
$istVerwaltung = darf_verwaltung(['rollen' => rechte_rollen($pdo, $mitarbeiterId, (bool)$row['ist_admin'])]);
if ($istVerwaltung) { $ungueltig(); }

$pwFehler = passwort_pruefen($neu, (string)$row['name'], false);
if ($pwFehler !== null) {
    json_response(['status' => 'error', 'message' => $pwFehler], 400);
}

$pdo->beginTransaction();
try {
    $pdo->prepare('UPDATE mitarbeiter SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($neu, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), $mitarbeiterId]);
    $pdo->prepare('UPDATE passwort_reset SET benutzt_am = NOW() WHERE id = ?')
        ->execute([(int)$row['reset_id']]);
    // Auch andere, noch offene Anfragen fuer dieselbe Person verfallen --
    // sonst bliebe ein zweiter, frueher verschickter Link parallel gueltig.
    $pdo->prepare('UPDATE passwort_reset SET benutzt_am = NOW() WHERE mitarbeiter_id = ? AND benutzt_am IS NULL')
        ->execute([$mitarbeiterId]);
    // Ein Passwort-Reset ist ein Wiederherstellungsvorgang, kein normaler
    // Passwortwechsel aus einer angemeldeten Sitzung heraus (anders als
    // mein_passwort.php): ALLE bestehenden Sitzungen fallen weg, nicht nur
    // die fremden -- es gibt hier keine "eigene" Sitzung, die bleiben duerfte.
    $pdo->prepare('DELETE FROM sessions WHERE mitarbeiter_id = ?')->execute([$mitarbeiterId]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

// Eine etwaige Anmeldesperre (ENT-075) faellt mit einem erfolgreichen Reset
// weg -- wer sich gerade erfolgreich ausgewiesen hat, soll nicht zusaetzlich
// noch auf eine frueher verhaengte Wartezeit stossen.
anmeld_zuruecksetzen($pdo, (string)$row['name']);

json_response(['status' => 'ok', 'name' => $row['name']]);
