<?php
// Feiertage eines Kantons (ENT-021). Reine Kalenderangaben mit Quelle --
// ausdruecklich keine Lohnbewertung.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'masterschichten_lesen');

$kanton = strtoupper(trim((string)($_GET['kanton'] ?? 'SO')));
$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));

$sql = 'SELECT id, datum, kanton, name, halbtags, ab_zeit, quelle FROM feiertage WHERE kanton = ?';
$args = [$kanton];
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $von) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) {
    $sql .= ' AND datum BETWEEN ? AND ?';
    $args[] = $von;
    $args[] = $bis;
}
$sql .= ' ORDER BY datum';

$stmt = db()->prepare($sql);
$stmt->execute($args);
$rows = array_map(function ($r) {
    $r['id'] = (int)$r['id'];
    $r['halbtags'] = (int)$r['halbtags'];
    return $r;
}, $stmt->fetchAll());

// Welche Jahre sind ueberhaupt gepflegt? Damit die Oberflaeche sagen kann,
// ab wann der Kalender ausläuft.
$j = db()->prepare('SELECT MIN(datum) AS von, MAX(datum) AS bis FROM feiertage WHERE kanton = ?');
$j->execute([$kanton]);
$umfang = $j->fetch() ?: ['von' => null, 'bis' => null];

json_response(['status' => 'ok', 'kanton' => $kanton, 'feiertage' => $rows, 'gepflegt' => $umfang]);
