<?php
// Die eigenen Schichten eines Mitarbeitenden (ENT-023).
//
// Anders als alle uebrigen Planungs-Endpunkte NICHT admin-only -- aber strikt
// auf die eigene Person gefiltert. Niemand sieht hier die Einteilung anderer.
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();

$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? ''));
$bis = trim((string)($_GET['bis'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $von)) {
    // Der ganze laufende Monat gehoert dazu (ENT-134) -- sonst verschwinden
    // bereits vergangene Schichten des Monats aus der App, sobald sie mehr
    // als einen Tag zurueckliegen. Der Vortag muss zusaetzlich mit: am
    // Monatsersten reicht der Monatsanfang allein nicht zurueck genug, eine
    // Nachtschicht von gestern (noch im Vormonat) laeuft heute noch.
    $monatsanfang = date('Y-m-01');
    $vortag = date('Y-m-d', strtotime('-1 day'));
    $von = min($monatsanfang, $vortag);
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) {
    $bis = date('Y-m-d', strtotime('+90 days'));
}

$stmt = db()->prepare(
    // e.sparte muss mit (ENT-061): Ohne sie koennte die App nicht wissen,
    // dass fuer eine Reinigungsschicht kein Zeitbonus zu rechnen ist --
    // sie wuerde eine Zahl ausweisen, die es nicht gibt.
    'SELECT e.id, e.kunde_name, e.titel, e.strasse, e.ort, e.einsatzart, e.sparte,
            e.datum, e.von, e.bis, e.status, e.bemerkung,
            -- ENT-115: Was die eingeteilte Person vor Ort braucht. Der
            -- Treffpunkt und die Ansprechperson stehen sonst nur in der
            -- Verwaltung -- also genau dort, wo sie niemandem nuetzen.
            e.kanton, e.veranstaltung, e.treffpunkt, e.taetigkeit, e.qualifikation,
            e.kontakt_vorname, e.kontakt_nachname, e.kontakt_telefon,
            z.zusage, z.gesehen_am, o.name AS objekt_name,
            -- Der eigene Ist-Stand (ENT-049): damit die Person ihre
            -- geleistete Zeit selbst nachschlagen kann. Weiterhin strikt auf
            -- die eigene Zuteilung gefiltert -- fremde Ist-Zeiten sind hier
            -- so wenig sichtbar wie fremde Namen.
            z.ist_status, z.ist_von, z.ist_bis,
            z.ist_pause_von, z.ist_pause_min,
            z.ist_pause_bezahlt_ma, z.abgeglichen_am,
            -- Ob am EINSATZ bereits eine Kundenunterschrift liegt (ENT-160)
            -- und wer sie eingeholt hat. Bewusst NICHT die Unterschrift
            -- selbst: Sie ist ein grosses Bild, hier nur als Ja/Nein
            -- gebraucht, und ein fremdes Unterschriftsbild geht die zweite
            -- eingeteilte Person nichts an.
            (e.unterschrift IS NOT NULL) AS schon_unterschrieben,
            us.name AS unterschrift_holte, e.unterzeichner AS unterschrift_name
     FROM einsatz_zuteilung z
     JOIN einsaetze e ON e.id = z.einsatz_id
     LEFT JOIN objekte o ON o.id = e.objekt_id
     LEFT JOIN mitarbeiter us ON us.id = e.unterschrift_von
     WHERE z.mitarbeiter_id = ? AND e.datum BETWEEN ? AND ?
     ORDER BY e.datum, e.von'
);
$stmt->execute([(int)$user['id'], $von, $bis]);

$schichten = array_map(function ($e) {
    $e['id'] = (int)$e['id'];
    $e['ist_pause_min'] = $e['ist_pause_min'] === null ? null : (int)$e['ist_pause_min'];
    // null bleibt null: 'noch nicht festgestellt' ist etwas anderes als 'nein'
    // (GAV-AUS-004). Ein Cast auf int wuerde beides zu 0 machen.
    $e['ist_pause_bezahlt_ma'] = $e['ist_pause_bezahlt_ma'] === null
        ? null : (int)$e['ist_pause_bezahlt_ma'];
    // Als echtes Ja/Nein herausgeben, nicht als "1"/"0" aus der Datenbank --
    // die Oberflaeche prueft darauf, und "0" ist als Zeichenkette wahr.
    $e['schon_unterschrieben'] = (bool)$e['schon_unterschrieben'];
    return $e;
}, $stmt->fetchAll());

// Wie viele Kolleginnen und Kollegen sind sonst noch auf derselben Schicht?
// Wer ist sonst noch auf derselben Schicht?
//
// Bis ENT-121 gab es hier ausdruecklich nur die ANZAHL, keinen Namen. Der
// Projektinhaber hat das fuer die Absprache vor Ort revidiert: Wer zusammen
// arbeitet, soll wissen, wen er sucht.
//
// WAS HERAUSGEHT UND WAS NICHT -- das ist bewusst eng gefasst:
//   ja:    Vor- und Nachname
//   nein:  Telefonnummer, E-Mail, Personalnummer, Anmeldename
//   nein:  die mitarbeiter_id (sie wird fuer nichts gebraucht, was die App
//          tut, und waere ein Schluessel auf eine Person)
//   nein:  der Rueckmeldestand der anderen (zugesagt/abgelehnt) -- das
//          Antwortverhalten einzelner geht die Kollegen nichts an
//   nein:  fremde Ist-Zeiten, unveraendert wie bisher
//
// Die Abfrage laeuft ausschliesslich ueber die Einsatznummern, die weiter
// oben bereits fuer DIESE Person ermittelt wurden. Ein fremder Einsatz kann
// darum gar nicht dabei sein -- die Rechtepruefung liegt in der Herkunft der
// Liste, nicht in einer zusaetzlichen Bedingung, die man vergessen koennte.
$team = [];
if ($schichten) {
    $ids = array_column($schichten, 'id');
    $marken = implode(',', array_fill(0, count($ids), '?'));
    $z = db()->prepare("SELECT z.einsatz_id, m.vorname, m.nachname, m.name,
                               (z.mitarbeiter_id = ?) AS bin_ich
                        FROM einsatz_zuteilung z
                        JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
                        WHERE z.einsatz_id IN ($marken)
                        ORDER BY m.nachname, m.vorname, m.name");
    $z->execute(array_merge([(int)$user['id']], $ids));
    foreach ($z->fetchAll() as $r) {
        $eid = (int)$r['einsatz_id'];
        // Fallback auf den Anmeldenamen: Ein Datensatz ohne Vor- und
        // Nachnamen darf nicht als leere Zeile erscheinen.
        $name = trim(($r['vorname'] ?? '') . ' ' . ($r['nachname'] ?? ''));
        if ($name === '') { $name = (string)($r['name'] ?? ''); }
        $team[$eid][] = ['name' => $name, 'bin_ich' => (int)$r['bin_ich'] === 1];
    }
}
foreach ($schichten as &$s) {
    $s['team'] = $team[$s['id']] ?? [];
    // Die Anzahl bleibt, was sie war -- die Oberflaeche zeigt sie an vielen
    // Stellen, an denen die Namensliste nicht hingehoert.
    $s['im_team'] = count($s['team']) ?: 1;
}
unset($s);

json_response(['status' => 'ok', 'schichten' => $schichten, 'von' => $von, 'bis' => $bis]);
