<?php
// Objekte (Dauerauftraege) samt Zahl der aktuell gueltigen Masterschichten (ENT-021).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'objekte_lesen');

$heute = date('Y-m-d');

$objekte = db()->query(
    'SELECT id, kunde_id, kunde_name, name, strasse, plz, ort, kanton, einsatzart, sparte, aktiv, bemerkung, erstellt_am
     FROM objekte ORDER BY aktiv DESC, name'
)->fetchAll();

// Hinterlegte Wegstrecken je Anstellungsort (ENT-054, Art. 18 Ziff. 2).
// Fehlt die Tabelle noch, wird das NICHT als "keine Distanz" ausgegeben,
// sondern gar nicht -- die Oberflaeche muss unterscheiden koennen zwischen
// "noch nicht eingerichtet" und "0 km".
$distanzen = [];
try {
    foreach (db()->query('SELECT objekt_id, anstellungsort_id, km, quelle, ermittelt_am FROM objekt_distanz') as $d) {
        $distanzen[(int)$d['objekt_id']][(int)$d['anstellungsort_id']] = [
            'km' => (float)$d['km'],
            'quelle' => $d['quelle'],
            'ermittelt_am' => $d['ermittelt_am'],
        ];
    }
} catch (Throwable $e) {
    $distanzen = [];
}

// Nur heute gueltige Masterschichten zaehlen -- abgelaufene Fassungen sind
// Geschichte, keine offene Planung.
$stmt = db()->prepare(
    'SELECT objekt_id, COUNT(*) AS anzahl, COALESCE(SUM(arbeitszeit_h), 0) AS stunden
     FROM masterschichten
     WHERE gueltig_ab <= ? AND (gueltig_bis IS NULL OR gueltig_bis >= ?)
     GROUP BY objekt_id'
);
$stmt->execute([$heute, $heute]);
$proObjekt = [];
foreach ($stmt->fetchAll() as $r) {
    $proObjekt[(int)$r['objekt_id']] = ['anzahl' => (int)$r['anzahl'], 'stunden' => (float)$r['stunden']];
}

$objekte = array_map(function ($o) use ($proObjekt, $distanzen) {
    $o['id'] = (int)$o['id'];
    $o['kunde_id'] = $o['kunde_id'] === null ? null : (int)$o['kunde_id'];
    $o['aktiv'] = (int)$o['aktiv'];
    $z = $proObjekt[$o['id']] ?? ['anzahl' => 0, 'stunden' => 0];
    $o['masterschichten'] = $z['anzahl'];
    $o['stunden_je_einsatz'] = $z['stunden'];
    $o['distanzen'] = $distanzen[$o['id']] ?? [];
    return $o;
}, $objekte);

json_response(['status' => 'ok', 'objekte' => $objekte]);
