<?php
// Objekte fuer die Revierdienst-Einrichtung (ENT-224) -- gleiche Liste wie
// objekt_list.php, aber an einem anderen Recht.
//
// WARUM ES DIESEN ENDPUNKT BRAUCHT
//
// Die Einrichtung unter "Revierdienst" ist im Menue mit 'rundgang_verwalten'
// freigegeben. Genau dieses Recht traegt die Rolle "Waechtersystem"
// (ROLLE_WAECHTER in rechte.php): 'rundgang_verwalten', 'rundgang_einsehen',
// 'alarmempfaenger' -- ausdruecklich OHNE 'plan', weil sie unabhaengig von
// den vier Hauptrollen zusaetzlich vergeben wird.
//
// Ihre Objektliste holte sie sich aber ueber objekt_list.php, und der
// verlangt 'plan'. Wer nur die Waechter-Rolle hat, kam also in die
// Einrichtung hinein und fand dort einen leeren Objekt-Waehler vor --
// ausgerechnet die Rolle, fuer die die Seite gebaut wurde, konnte sie nicht
// benutzen. Der Fehler ist still: kein Absturz, keine Meldung, nur eine
// Auswahl ohne Eintraege, die aussieht wie "es gibt keine Objekte".
// Das ist dieselbe Familie wie die Hausregel "unbekannt darf nie wie keine
// aussehen" -- hier auf der Rechte-Ebene statt in der Oberflaeche.
//
// BEWUSST NICHT GEFILTERT
//
// Naheliegend waere, hier nur Objekte mit einsatzart='Revierdienst'
// zurueckzugeben -- weniger Daten fuer eine Rolle, die weniger sehen soll.
// Das wuerde aber aendern, WAS im Waehler steht: heute stehen dort alle
// Objekte. Ob der Waehler kuratiert werden soll, ist eine Produktfrage und
// keine Rechte-Frage; sie gehoert dem Projektinhaber (siehe OP-230), nicht
// in einen Fehlerbehebung. Darum liefert dieser Endpunkt exakt dieselbe
// Menge wie bisher.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');

$objekte = db()->query(
    'SELECT id, kunde_id, kunde_name, name, strasse, plz, ort, kanton, einsatzart, sparte, aktiv, bemerkung, erstellt_am
     FROM objekte ORDER BY aktiv DESC, name'
)->fetchAll();

// Dieselben abgeleiteten Felder wie objekt_list.php mitliefern, damit die
// geteilte objekte-Liste in dashboard.html dieselbe Form behaelt, egal
// welcher der beiden Endpunkte sie zuerst gefuellt hat. Sonst fehlten
// openObjekt() und der Objektliste unter Kunden stillschweigend Felder,
// je nachdem, welche Ansicht zuerst offen war.
$heute = date('Y-m-d');

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
