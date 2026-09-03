<?php
// Alle geplanten Einsaetze samt Zuteilung (ENT-020, erweitert in ENT-021).
// Optional auf einen Zeitraum eingegrenzt -- bei taeglich wiederkehrenden
// Objektschichten waechst die Gesamtmenge sonst schnell.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'plan');

$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
$eingegrenzt = preg_match('/^\d{4}-\d{2}-\d{2}$/', $von) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis);

// ENT-325: Dienstfahrzeug und Fahrer stehen erst nach dem naechsten
// Einrichtungslauf in der Tabelle. Ohne diese Abfrage bricht zwischen Deploy
// und Einrichtung die GANZE Planungsansicht weg -- eine fehlende Spalte in
// einem SELECT ist ein Fehler, kein leeres Feld.
$hatFahrzeug = hat_spalte(db(), 'einsaetze', 'fahrzeug_id');

$sql = 'SELECT id, kunde_id, kunde_name, objekt_id, masterschicht_id, serie_id, titel, strasse, ort, kanton,
               einsatzart, sparte, datum, von, bis, bedarf, status, bemerkung, erstellt_am, spontan_erzeugt,
               -- ENT-115: Diese Spalten gab es laengst, geliefert wurden sie nie.
               -- Die Einsatzplan-Ansicht las e.treffpunkt und bekam immer undefined.
               veranstaltung, treffpunkt, taetigkeit, qualifikation,
               kontakt_vorname, kontakt_nachname, kontakt_telefon,
               weg_km, weg_minuten, weg_adresse,
               ist_status, ist_von, ist_bis, ist_pause_von, ist_pause_min,
               ist_pause_bezahlt_ma, ist_pause_bezahlt_kunde, ist_bemerkung, abgeglichen_am,
               -- Kundenunterschrift am Einsatz (ENT-160). Das Bild selbst bleibt
               -- hier draussen: Es waere in jeder Einsatzliste mitgeschleppt,
               -- obwohl es nur der eine Kundenbericht braucht. Was die Liste
               -- braucht, ist die Auskunft OB und von wem -- das Bild holt der
               -- Bericht einzeln (einsatz_bericht.php).
               (unterschrift IS NOT NULL) AS hat_unterschrift,
               unterzeichner, unterschrift_am'
        . ($hatFahrzeug ? ', fahrzeug_id, fahrer_id' : '')
        . ' FROM einsaetze';
$args = [];
if ($eingegrenzt) {
    $sql .= ' WHERE datum BETWEEN ? AND ?';
    $args = [$von, $bis];
}
$sql .= ' ORDER BY datum DESC, von ASC, id DESC';

$stmt = db()->prepare($sql);
$stmt->execute($args);
$einsaetze = $stmt->fetchAll();

// Zuteilungen in einem Zug holen und zuordnen -- eine Abfrage je Einsatz waere
// bei einem Monatsplan schnell dreistellig.
$zsql = 'SELECT z.einsatz_id, z.mitarbeiter_id, z.zusage, z.gesehen_am, m.personalnummer,
                z.ist_status, z.ist_von, z.ist_bis, z.ist_pause_von, z.ist_pause_min,
                z.ist_pause_bezahlt_ma, z.ist_pause_bezahlt_kunde, z.ist_bemerkung, z.abgeglichen_am,
                m.name, m.vorname, m.nachname
         FROM einsatz_zuteilung z
         JOIN mitarbeiter m ON m.id = z.mitarbeiter_id';
if ($eingegrenzt) {
    $zsql .= ' JOIN einsaetze e ON e.id = z.einsatz_id AND e.datum BETWEEN ? AND ?';
}
$zsql .= ' ORDER BY m.name';
$zstmt = db()->prepare($zsql);
$zstmt->execute($args);

$proEinsatz = [];
foreach ($zstmt->fetchAll() as $z) {
    $proEinsatz[(int)$z['einsatz_id']][] = [
        'id' => (int)$z['mitarbeiter_id'],
        'name' => $z['name'],
        'vorname' => $z['vorname'],
        'nachname' => $z['nachname'],
        'zusage' => $z['zusage'],
        'gesehen_am' => $z['gesehen_am'],
        'personalnummer' => $z['personalnummer'],
        // Der Abgleich je Person (ENT-045). 'offen' heisst "noch nicht
        // geprueft" und ist bewusst von 'abwesend' unterschieden.
        'ist_status' => $z['ist_status'],
        'ist_von' => $z['ist_von'],
        'ist_bis' => $z['ist_bis'],
        'ist_pause_von' => $z['ist_pause_von'],
        'ist_pause_min' => $z['ist_pause_min'] === null ? null : (int)$z['ist_pause_min'],
        // null bleibt null: 'noch nicht entschieden' ist etwas anderes als
        // 'nein' (GAV-AUS-004). Ein Cast auf int wuerde beides zu 0 machen.
        'ist_pause_bezahlt_ma' => $z['ist_pause_bezahlt_ma'] === null ? null : (int)$z['ist_pause_bezahlt_ma'],
        'ist_pause_bezahlt_kunde' => $z['ist_pause_bezahlt_kunde'] === null ? null : (int)$z['ist_pause_bezahlt_kunde'],
        'ist_bemerkung' => $z['ist_bemerkung'],
        'abgeglichen_am' => $z['abgeglichen_am'],
    ];
}

$einsaetze = array_map(function ($e) use ($proEinsatz, $hatFahrzeug) {
    $e['id'] = (int)$e['id'];
    // ENT-325. Fehlt die Spalte noch, geht der Schluessel GAR NICHT hinaus --
    // die Oberflaeche unterscheidet dann "nicht eingerichtet" von "kein
    // Fahrzeug zugeteilt". Ein 0 oder ein null waere fuer sie dasselbe wie
    // "keines", und genau diese Verwechslung soll es hier nicht geben.
    if ($hatFahrzeug) {
        $e['fahrzeug_id'] = $e['fahrzeug_id'] === null ? null : (int)$e['fahrzeug_id'];
        $e['fahrer_id']   = $e['fahrer_id'] === null ? null : (int)$e['fahrer_id'];
    }
    $e['kunde_id'] = $e['kunde_id'] === null ? null : (int)$e['kunde_id'];
    $e['objekt_id'] = $e['objekt_id'] === null ? null : (int)$e['objekt_id'];
    $e['masterschicht_id'] = $e['masterschicht_id'] === null ? null : (int)$e['masterschicht_id'];
    $e['bedarf'] = (int)$e['bedarf'];
    $e['spontan_erzeugt'] = (bool)$e['spontan_erzeugt'];
    $e['mitarbeiter'] = $proEinsatz[$e['id']] ?? [];
    return $e;
}, $einsaetze);

json_response(['status' => 'ok', 'einsaetze' => $einsaetze, 'eingegrenzt' => (bool)$eingegrenzt]);
