<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../kunden.php';

$user = require_session(); // jeder eingeloggte Nutzer braucht die Liste zum Ausfuellen des Rapports

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
$kinder = kunden_kinder_laden($pdo);
foreach ($rows as &$k) {
    $eigen = $kinder[(int)$k['id']] ?? [];
    $k['kontaktwege'] = $eigen['kontaktwege'] ?? [];
    $k['personen'] = $eigen['personen'] ?? [];
}
unset($k);

$antwort = ['status' => 'ok', 'kunden' => $rows];
// Die naechste freie Nummer als Vorschau fuer den Anlegen-Dialog -- dort steht
// sie ausgegraut, vergeben wird sie weiterhin erst beim Speichern durch
// kunden_create.php. Nur fuer Admins, alle anderen legen keine Kunden an.
if (darf($user, 'kunden')) {
    $antwort['naechste_kundennummer'] = naechste_kundennummer($pdo);
}
json_response($antwort);
