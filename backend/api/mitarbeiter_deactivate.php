<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'personal_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$name = trim((string)($input['name'] ?? ''));
if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Name erforderlich'], 400);
}

// Vorbereitete Abfrage statt quote() im Zeichenkettenrumpf -- quote() ist
// hier zwar korrekt, aber es ist die einzige Stelle im Haus, die es so
// macht, und eine Ausnahme vom Muster wird irgendwann abgeschrieben.
$ziel = db()->prepare('SELECT id, ist_admin FROM mitarbeiter WHERE name = ?');
$ziel->execute([$name]);
$zielZeile = $ziel->fetch(PDO::FETCH_ASSOC) ?: ['id' => 0, 'ist_admin' => 0];
$zielId    = (int)$zielZeile['id'];

// Augenhoehe (ENT-501): Deaktivieren sperrt sofort aus -- require_session()
// prueft aktiv = 1. Wer 'personal_schreiben' hat, konnte damit bis hierher
// den Verwalter aus dem eigenen Werkzeug aussperren.
require_augenhoehe(db(), $user, $zielId, (bool)$zielZeile['ist_admin'],
    'Es zu deaktivieren');

// Aussperrschutz (ENT-501). rechte_setzen() hat ihn seit ENT-440 und nennt
// ihn "die einzige Regel, die sich hier NICHT uebergehen laesst" -- er
// zaehlt aber nur AKTIVE Personen, und genau daran lief das Deaktivieren
// vorbei: Es nahm den letzten Zugang weg, ohne dass eine Rolle sich
// aenderte. Danach kann niemand mehr Rollen vergeben, und der Weg zurueck
// ist phpMyAdmin.
if ($zielId > 0 && konto_vergibt_rollen(db(), $zielId, (bool)$zielZeile['ist_admin'])
    && rechte_verwaltung_zahl(db(), $zielId) === 0) {
    json_response(['status' => 'error',
        'message' => 'Das ist die letzte aktive Person, die Rollen vergeben darf. '
            . 'Ohne sie könnte niemand mehr Berechtigungen ändern. '
            . 'Zuerst jemand anderem ein Profil mit „Rollen & Berechtigungen: schreiben" '
            . 'geben, dann hier deaktivieren.'], 400);
}

db()->prepare('UPDATE mitarbeiter SET aktiv = 0 WHERE name = ?')->execute([$name]);
db()->prepare('DELETE FROM sessions WHERE mitarbeiter_id = (SELECT id FROM mitarbeiter WHERE name = ?)')->execute([$name]);

if ($zielId > 0) {
    logbuch_schreiben(db(), $user, 'mitarbeiter', $zielId, 'aktiv', '1', '0');
}

json_response(['status' => 'ok']);
