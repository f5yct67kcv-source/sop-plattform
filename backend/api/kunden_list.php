<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../kunden.php';

// Jede angemeldete Person kommt herein: Das Rapportformular (index.html)
// fuellt daraus seine Kundenauswahl und braucht Name, Strasse und Ort.
//
// ABER NICHT ALLES (ENT-440): Bis hierher lieferte dieser Endpunkt jeder
// angemeldeten Person den vollstaendigen Kundensatz -- UID, MWST-Nummer,
// Rechnungsadresse, Notiz, Ansprechpersonen und deren Kontaktwege. Das
// Rapportformular verwendet davon drei Felder. Seit ENT-440 gibt es die
// Stufe "Kunden: lesen", und ein Schalter, der die Daten nicht wirklich
// zurueckhaelt, waere eine Sperre in der Oberflaeche statt im Server --
// genau das, was die Projektregel verbietet. Dieselbe Bauart wie bei den
// vertraulichen Personalfeldern (ENT-072/ENT-077): Die Felder werden aus
// der Antwort ENTFERNT, nicht leer geschickt -- ein leeres Feld sieht aus
// wie "nicht erfasst".
$user = require_session();
$vollerZugriff = darf($user, 'kunden_lesen');
// Was das Rapportformular braucht, und nichts darueber hinaus.
const KUNDEN_RAPPORTFELDER = ['id', 'name', 'strasse', 'ort'];

// Aktive und archivierte Kunden kommen in einem Zug (ENT-040) -- wie schon
// bei objekte/einsaetze filtert das Dashboard selbst nach aktiv, statt einen
// zweiten Aufruf zu brauchen.
$pdo = db();
$rows = $pdo->query(
    'SELECT id, kundennummer, art, anrede, vorname, nachname, name, zusatzfeld,
            strasse, hausnummer, adresszusatz, plz, ort, uid, mwst_nr,
            telefon, kontaktperson, email, notiz, aktiv,
            re_name, re_zusatz, re_strasse, re_hausnummer, re_plz, re_ort
     FROM kunden ORDER BY name'
)->fetchAll();

// Ansprechpersonen und Kommunikationswege haengen mit dran (ENT-044), damit
// Detailseite und Bearbeiten-Dialog ohne zweiten Aufruf auskommen. Bei sehr
// vielen Kunden ist das die Stelle, die als Erstes zu gross wird -- derselbe
// Vorbehalt wie in OP-31.
if ($vollerZugriff) {
    $kinder = kunden_kinder_laden($pdo);
    foreach ($rows as &$k) {
        $eigen = $kinder[(int)$k['id']] ?? [];
        $k['kontaktwege'] = $eigen['kontaktwege'] ?? [];
        $k['personen'] = $eigen['personen'] ?? [];
    }
    unset($k);
} else {
    // Ansprechpersonen und Kontaktwege gar nicht erst laden -- was nicht
    // geholt wird, kann auch nicht versehentlich mitgeschickt werden.
    foreach ($rows as &$k) {
        $k = array_intersect_key($k, array_flip(KUNDEN_RAPPORTFELDER));
    }
    unset($k);
}

$antwort = ['status' => 'ok', 'kunden' => $rows];
// Die naechste freie Nummer als Vorschau fuer den Anlegen-Dialog -- dort steht
// sie ausgegraut, vergeben wird sie weiterhin erst beim Speichern durch
// kunden_create.php. Nur fuer Admins, alle anderen legen keine Kunden an.
if (darf($user, 'kunden_schreiben')) {
    $antwort['naechste_kundennummer'] = naechste_kundennummer($pdo);
}
json_response($antwort);
