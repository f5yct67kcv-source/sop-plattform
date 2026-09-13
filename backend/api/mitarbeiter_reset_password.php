<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../anmeldung.php';   // passwort_pruefen (ENT-075)

$user = require_session();
require_recht($user, 'personal_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$name = trim((string)($input['name'] ?? ''));
$password = (string)($input['password'] ?? '');

if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Name erforderlich'], 400);
}
// Fuer wen wird zurueckgesetzt? Ein Verwaltungszugang braucht ein
// laengeres Passwort -- das steht in der Datenbank, nicht in der Anfrage.
$ziel = db()->prepare('SELECT id, ist_admin FROM mitarbeiter WHERE name = ?');
$ziel->execute([$name]);
$zielZeile = $ziel->fetch(PDO::FETCH_ASSOC) ?: ['id' => 0, 'ist_admin' => 0];
$zielId    = (int)$zielZeile['id'];
// Massgeblich sind die Rollen: Auch Planung und Personal sehen fremde
// Personendaten und brauchen darum das laengere Passwort, nicht nur die
// Verwaltung (ENT-077).
$zielIstAdmin = darf_verwaltung([
    'rollen' => rechte_rollen(db(), $zielId, (bool)$zielZeile['ist_admin'])]);

// Augenhoehe (ENT-501): Ein fremdes Passwort zu setzen heisst, dieses Konto
// zu uebernehmen -- die Sitzungen des Ziels werden unten ohnehin beendet.
// Wer 'personal_schreiben' hat, konnte damit bis hierher den Verwalter
// uebernehmen und sich anschliessend selbst jedes Recht geben. Die Pruefung
// steht VOR dem Setzen und nicht danach: Ein abgewiesener Versuch soll das
// Passwort gar nicht erst anfassen.
require_augenhoehe(db(), $user, $zielId, (bool)$zielZeile['ist_admin'],
    'Das Passwort zurueckzusetzen');

$pwFehler = passwort_pruefen($password, $name, $zielIstAdmin);
if ($pwFehler !== null) {
    json_response(['status' => 'error', 'message' => $pwFehler], 400);
}

$hash = password_hash($password, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]);
require_once __DIR__ . '/../mitarbeiter.php';
$stmt = db()->prepare('UPDATE mitarbeiter SET password_hash = ? WHERE name = ?');
$stmt->execute([$hash, $name]);

if ($stmt->rowCount() === 0) {
    json_response(['status' => 'error', 'message' => 'Mitarbeiter nicht gefunden'], 404);
}

require_once __DIR__ . '/../logbuch.php';
if ($zielId > 0) {
    // Ohne Werte: Das Passwort selbst hat im Logbuch nichts verloren, weder
    // das alte noch das neue. Festgehalten wird, DASS es jemand
    // zurueckgesetzt hat und wer.
    logbuch_schreiben(db(), $user, 'mitarbeiter', $zielId, 'passwort', null, null, true);
}

// Bestehende Sitzungen dieses Mitarbeiters beenden -- altes Passwort war
// evtl. kompromittiert oder auf mehreren Geraeten eingeloggt.
db()->prepare('DELETE FROM sessions WHERE mitarbeiter_id = (SELECT id FROM mitarbeiter WHERE name = ?)')->execute([$name]);

ma_stempel(db(), 'passwort_geaendert_am', 'name', $name);

json_response(['status' => 'ok']);
