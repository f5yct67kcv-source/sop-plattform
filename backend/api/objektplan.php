<?php
// Alles, was die Objektplanung eines Monats braucht, in einem Zug (ENT-024):
// Soll-Bedarf aus den Masterschichten, vorhandene Einsaetze mit Zuteilung,
// Feiertage.
//
// Der Soll wird ausdruecklich unabhaengig davon geliefert, ob schon Schichten
// erzeugt wurden. Sonst zeigt ein frisch angelegtes Objekt einen leeren Monat,
// obwohl der Bedarf feststeht -- genau der Zustand, der die Ansicht bisher
// nutzlos gemacht hat.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'objekte_lesen');

$objektId = (int)($_GET['objekt_id'] ?? 0);
$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));

foreach (['von' => $von, 'bis' => $bis] as $feld => $wert) {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld im Format JJJJ-MM-TT erforderlich"], 400);
    }
}
if ($bis < $von) {
    json_response(['status' => 'error', 'message' => 'Das Enddatum liegt vor dem Beginn'], 400);
}
$spanne = (int)(new DateTimeImmutable($von))->diff(new DateTimeImmutable($bis))->format('%a');
if ($spanne > 400) {
    json_response(['status' => 'error', 'message' => 'Hoechstens 400 Tage auf einmal'], 400);
}

$b = planung_bedarf($objektId, $von, $bis);
if (isset($b['fehler'])) {
    json_response(['status' => 'error', 'message' => $b['fehler']], 404);
}

// ── Vorhandene Einsaetze dieses Objekts im Zeitraum
$e = db()->prepare(
    'SELECT id, kunde_id, kunde_name, objekt_id, masterschicht_id, titel, strasse, ort,
            einsatzart, sparte, datum, von, bis, bedarf, status, bemerkung,
            ist_status, abgeglichen_am
     FROM einsaetze
     WHERE objekt_id = ? AND datum BETWEEN ? AND ?
     ORDER BY datum, von'
);
$e->execute([$objektId, $von, $bis]);
$einsaetze = $e->fetchAll();

$proEinsatz = [];
if ($einsaetze) {
    $ids = array_column($einsaetze, 'id');
    $marken = implode(',', array_fill(0, count($ids), '?'));
    $z = db()->prepare(
        "SELECT z.einsatz_id, z.mitarbeiter_id, z.zusage, z.ist_status, z.abgeglichen_am,
                m.name, m.vorname, m.nachname
         FROM einsatz_zuteilung z
         JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
         WHERE z.einsatz_id IN ($marken)
         ORDER BY m.nachname, m.vorname, m.name"
    );
    $z->execute($ids);
    foreach ($z->fetchAll() as $r) {
        $proEinsatz[(int)$r['einsatz_id']][] = [
            'id' => (int)$r['mitarbeiter_id'],
            'name' => $r['name'],
            'vorname' => $r['vorname'],
            'nachname' => $r['nachname'],
            'zusage' => $r['zusage'],
            // Traegt die Sperre abgeglichener Schichten in die Objektplanung
            // (ENT-045). Ohne dieses Feld koennte das Raster nie ein Schloss
            // zeigen -- die Sperre griffe, waere aber unsichtbar.
            'ist_status' => $r['ist_status'],
            'abgeglichen_am' => $r['abgeglichen_am'],
        ];
    }
}
foreach ($einsaetze as &$row) {
    $row['id'] = (int)$row['id'];
    $row['bedarf'] = (int)$row['bedarf'];
    $row['objekt_id'] = $row['objekt_id'] === null ? null : (int)$row['objekt_id'];
    $row['masterschicht_id'] = $row['masterschicht_id'] === null ? null : (int)$row['masterschicht_id'];
    $row['mitarbeiter'] = $proEinsatz[$row['id']] ?? [];
}
unset($row);

// Von den Vorlagen wird nur mitgegeben, was die Ansicht wirklich braucht.
$vorlagen = array_map(fn($v) => [
    'id' => (int)$v['id'],
    'name' => $v['name'],
    'kuerzel' => $v['kuerzel'],
    'art' => $v['art'],
    'sparte' => $v['sparte'] ?? 'sicherheit',
    'von' => substr((string)$v['von'], 0, 5),
    'bis' => substr((string)$v['bis'], 0, 5),
    'arbeitszeit_h' => (float)$v['arbeitszeit_h'],
    'auf_abruf' => (int)$v['auf_abruf'],
    'farbe' => $v['farbe'],
    'gueltig_ab' => $v['gueltig_ab'],
    'gueltig_bis' => $v['gueltig_bis'],
], $b['vorlagen']);

json_response([
    'status' => 'ok',
    'objekt' => $b['objekt'],
    'von' => $von,
    'bis' => $bis,
    'vorlagen' => $vorlagen,
    'bedarf' => $b['bedarf'],
    'einsaetze' => $einsaetze,
    'feiertage' => $b['feiertage'],
]);
