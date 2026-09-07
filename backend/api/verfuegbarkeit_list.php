<?php
// Sperrtage aller Mitarbeitenden in einem Zeitraum (ENT-028) -- fuer die
// Planung. Nur lesend; die Angaben stammen von den Personen selbst.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'verfuegbarkeit_lesen');

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von)) { $von = date('Y-m-01'); }
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) { $bis = date('Y-m-d', strtotime('+120 days')); }

$s = db()->prepare(
    'SELECT v.mitarbeiter_id, v.datum, v.art, v.bemerkung
     FROM verfuegbarkeiten v
     JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
     WHERE v.datum BETWEEN ? AND ?
     ORDER BY v.datum'
);
$s->execute([$von, $bis]);
$tage = array_map(function ($r) {
    $r['mitarbeiter_id'] = (int)$r['mitarbeiter_id'];
    return $r;
}, $s->fetchAll());

json_response(['status' => 'ok', 'von' => $von, 'bis' => $bis, 'sperren' => $tage]);
