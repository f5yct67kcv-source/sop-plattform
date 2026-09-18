<?php
// Empfaenger der Betreiberin: Betriebe, die noch keine Mandanten sind
// (ENT-605).
//
// Gegenstueck zu kunden_list.php im Cockpit, mit einem Unterschied: Dort
// gibt es eine abgestufte Sicht (wer nur Rapporte schreibt, bekommt drei
// Felder). Hier gibt es sie nicht, weil es hier keine Stufen gibt -- ein
// Betreiber-Konto hat keine Rechte im Sinne von rechte.php, es hat Zutritt
// oder keinen (siehe Kopf von betreiber.php).
//
// Aktive UND archivierte in einem Zug, wie im Cockpit: Die Oberflaeche hat
// einen Umschalter und soll dafuer nicht zweimal fragen muessen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../kunden.php';

require_betreiber_voll();

$pdo = betreiber_db();

// Fehlt die Tabelle, ist die Ebene nicht eingerichtet -- und das ist etwas
// anderes als "keine Adressen erfasst". Die Oberflaeche unterscheidet
// beides und braucht dafuer eine eigene Aussage, keinen leeren Kasten
// (CLAUDE.md: unbekannt darf nie wie keine aussehen).
if (!hat_tabelle($pdo, 'be_kunden')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'kunden' => []]);
}

$rows = $pdo->query(
    'SELECT id, kundennummer, art, anrede, vorname, nachname, name, zusatzfeld,
            strasse, hausnummer, adresszusatz, plz, ort, uid, mwst_nr,
            telefon, kontaktperson, email, notiz, aktiv, mandant_id,
            re_name, re_zusatz, re_strasse, re_hausnummer, re_plz, re_ort
     FROM be_kunden ORDER BY name'
)->fetchAll();

$kinder = kunden_kinder_laden($pdo, 'be_');
foreach ($rows as &$k) {
    $eigen = $kinder[(int)$k['id']] ?? [];
    $k['kontaktwege'] = $eigen['kontaktwege'] ?? [];
    $k['personen']    = $eigen['personen'] ?? [];
}
unset($k);

json_response([
    'status'          => 'ok',
    'eingerichtet'    => true,
    'kunden'          => $rows,
    // Vorschau fuer den Anlegen-Dialog. Vergeben wird die Nummer erst beim
    // Speichern durch den Server -- wie im Cockpit (ENT-040).
    'naechste_nummer' => naechste_kundennummer($pdo, 'be_'),
]);
