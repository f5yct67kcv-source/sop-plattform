<?php
// Jahresstunden je Mitarbeitendem fuer die Pensen-Kontrolle (ENT-065).
//
// Der Endpunkt liefert ROHDATEN, keine fertigen Summen. Grund: Zeitbonus und
// Nettozeit werden in gav.js gerechnet, und diese Regel darf es nur EINMAL
// geben (ENT-049). Eine zweite Fassung in PHP waere der sichere Weg, dass die
// Kontrollseite andere Zahlen zeigt als die Dienstplaene -- und dann glaubt
// niemand mehr einer von beiden.
//
// Geliefert wird nur, was abgeglichen ist. Was noch offen ist, wird gezaehlt
// und mitgegeben, damit die Oberflaeche die Luecke benennen kann statt sie zu
// verschweigen (dieselbe Haltung wie ENT-053).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'verfuegbarkeit_lesen');

$jahr = (int)($_GET['jahr'] ?? date('Y'));
if ($jahr < 2000 || $jahr > 2100) {
    json_response(['status' => 'error', 'message' => 'Jahr unplausibel'], 400);
}
$von = sprintf('%04d-01-01', $jahr);
$bis = sprintf('%04d-12-31', $jahr);

$hatKat = hat_spalte(db(), 'mitarbeiter', 'anstellungskategorie');
$felder = $hatKat
    ? 'id, name, vorname, nachname, personalnummer, anstellungskategorie, pensum_stunden, eintritt'
    : "id, name, vorname, nachname, personalnummer, NULL AS anstellungskategorie,
       NULL AS pensum_stunden, NULL AS eintritt";
$leute = db()->query("SELECT $felder FROM mitarbeiter WHERE aktiv = 1 ORDER BY nachname, vorname, name")
    ->fetchAll();

// Alle Zuteilungen des Jahres in EINER Abfrage -- eine je Person waere bei
// zwanzig Leuten zwanzig Abfragen fuer dieselbe Tabelle.
$sql = "SELECT z.mitarbeiter_id, e.datum, e.sparte,
               COALESCE(z.ist_status, 'offen') AS ist_status,
               z.ist_von, z.ist_bis, z.ist_pause_min, z.ist_pause_bezahlt_ma
        FROM einsatz_zuteilung z
        JOIN einsaetze e ON e.id = z.einsatz_id
        WHERE e.datum BETWEEN ? AND ? AND e.status <> 'abgesagt'
        ORDER BY e.datum, e.von";
try {
    $stmt = db()->prepare($sql);
    $stmt->execute([$von, $bis]);
    $rows = $stmt->fetchAll();
} catch (Throwable $ex) {
    // Die Ist-Spalten kommen erst mit der Einrichtung (OP-40/OP-43). Fehlen
    // sie, wird nicht geraten -- die Seite meldet dann schlicht nichts.
    json_response(['status' => 'ok', 'jahr' => $jahr, 'eingerichtet' => false, 'mitarbeiter' => []]);
}

$proMa = [];
$offen = [];
foreach ($rows as $r) {
    $id = (int)$r['mitarbeiter_id'];
    if (($r['ist_status'] ?? 'offen') === 'offen') {
        $offen[$id] = ($offen[$id] ?? 0) + 1;
        continue;
    }
    if (!$r['ist_von'] || !$r['ist_bis']) { continue; }
    $proMa[$id][] = [
        'datum' => substr((string)$r['datum'], 0, 10),
        'von' => substr((string)$r['ist_von'], 0, 5),
        'bis' => substr((string)$r['ist_bis'], 0, 5),
        'pause_min' => $r['ist_pause_min'] === null ? null : (int)$r['ist_pause_min'],
        'pause_bezahlt_ma' => $r['ist_pause_bezahlt_ma'] === null ? null : (int)$r['ist_pause_bezahlt_ma'],
        'sparte' => $r['sparte'] ?: 'sicherheit',
    ];
}

$aus = array_map(function ($m) use ($proMa, $offen) {
    $id = (int)$m['id'];
    return [
        'id' => $id,
        'name' => $m['name'],
        'vorname' => $m['vorname'],
        'nachname' => $m['nachname'],
        'personalnummer' => $m['personalnummer'],
        'kategorie' => $m['anstellungskategorie'],
        'pensum' => $m['pensum_stunden'] === null ? null : (int)$m['pensum_stunden'],
        'eintritt' => $m['eintritt'],
        'schichten' => $proMa[$id] ?? [],
        'offen' => $offen[$id] ?? 0,
    ];
}, $leute);

json_response(['status' => 'ok', 'jahr' => $jahr, 'eingerichtet' => true, 'mitarbeiter' => $aus]);
