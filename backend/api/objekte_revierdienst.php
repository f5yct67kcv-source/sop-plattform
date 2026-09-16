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
// in einen Fehlerbehebung. Darum liefert dieser Endpunkt dieselbe MENGE an
// Objekten wie bisher.
//
// NUR NAME UND ID (Security-Audit Lauf 2, ENT-577/ENT-578, behoben hier)
//
// Was aber sehr wohl eine Rechte-Frage ist: welche FELDER je Objekt
// herauskommen. 'kontrollpunkte_lesen' ist dasselbe Recht wie bei
// kontrollpunkt_liste.php und rundgang_vorlage_liste.php -- beide verlangen
// dort zusaetzlich eine einzelne objekt_id und liefern nur zu GENAU diesem
// Objekt etwas. Dieser Endpunkt lieferte bisher als einziger mit demselben
// Recht die komplette Firma auf einmal: Kundenname, Objektadresse, Kanton,
// Bemerkung, dazu Auslastung (masterschichten) und Anfahrtsdistanzen -- fuer
// jedes Objekt, nicht nur die eigenen. rdObjektFuellen() in dashboard.html,
// die einzige Stelle, die dieses JSON liest, baut daraus nur eine
// Auswahlliste aus $('id') und $('name'). Der Rest ging ungenutzt, aber
// vollstaendig lesbar an jeden mit, der nur die Waechter-Rolle traegt.
// Wer die volle Objektliste mit Kundenbezug braucht, hat dafuer bereits
// objekt_list.php -- an 'plan', dem dafuer zustaendigen Recht.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'kontrollpunkte_lesen');

$objekte = db()->query(
    'SELECT id, name, einsatzart, aktiv FROM objekte ORDER BY aktiv DESC, name'
)->fetchAll();

$objekte = array_map(function ($o) {
    $o['id'] = (int)$o['id'];
    $o['aktiv'] = (int)$o['aktiv'];
    return $o;
}, $objekte);

json_response(['status' => 'ok', 'objekte' => $objekte]);
