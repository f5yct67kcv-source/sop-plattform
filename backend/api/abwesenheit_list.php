<?php
declare(strict_types=1);
// Abwesenheiten aller Mitarbeitenden in einem Zeitraum (ENT-252) -- fuer die
// Gesamtansicht im Dashboard. Nur lesend, nach demselben Muster wie
// verfuegbarkeit_list.php: keine Namen/Listen doppelt mitgeschickt, die
// Oberflaeche hat mitarbeiter_list.php (Name, Funktion, Abteilung,
// Anstellungsort) bereits geladen und verknuepft ueber mitarbeiter_id.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'personal_lesen');

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von)) { $von = date('Y-01-01'); }
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) { $bis = date('Y-12-31'); }

// Ueberlapp mit dem Zeitraum, nicht nur "von" oder "bis" darin -- ein Antrag
// kann vor dem Fenster beginnen und hineinragen oder darueber hinausreichen.
$s = db()->prepare(
    'SELECT id, mitarbeiter_id, typ, von, bis, status, bemerkung, ablehnung_grund,
            beantragt_von, beantragt_am, entschieden_von, entschieden_am
     FROM abwesenheiten
     WHERE von <= ? AND bis >= ?
     ORDER BY von'
);
$s->execute([$bis, $von]);
$rows = array_map(function ($r) {
    $r['id'] = (int)$r['id'];
    $r['mitarbeiter_id'] = (int)$r['mitarbeiter_id'];
    $r['beantragt_von'] = (int)$r['beantragt_von'];
    $r['entschieden_von'] = $r['entschieden_von'] === null ? null : (int)$r['entschieden_von'];
    return $r;
}, $s->fetchAll());

json_response(['status' => 'ok', 'von' => $von, 'bis' => $bis, 'abwesenheiten' => $rows,
    'darf_entscheiden' => darf($user, 'personal_schreiben')]);
