<?php
// Gemeinsamer Kundenbericht fuer EINEN Einsatz (ENT-160).
//
// GET ?einsatz_id=123 -> { status, bericht: { einsatz, kunde, unterschrift,
//                          personen: [ {name, von, bis, pause_min, netto_h,
//                                       bemerkung, erfasst_am} ] } }
//
// WARUM ES DIESEN ENDPUNKT GIBT
//
// Der Projektinhaber wollte, dass zwei Leute am selben Auftrag nicht zwei
// Blaetter erzeugen. Sein erster Vorschlag war, im Rapport eine zweite Person
// mitzuerfassen und EINEN Rapport zu senden. Das waere falsch: Der Rapport ist
// der Arbeitszeit-Nachweis EINER Person, er traegt Lohn und die monatliche
// Abrechnung nach Art. 12 Ziff. 5 GAV. Niemand darf die Arbeitszeit eines
// anderen behaupten -- und die Zeiten sind ohnehin meist verschieden (im
// Beispiel des Projektinhabers: 15:15 gegen 16:15).
//
// Darum wird hier NICHTS zusammengelegt. Die Rapporte bleiben, wie sie sind.
// Zusammengefuegt wird erst das DOKUMENT: ein Blatt ueber den Einsatz, auf dem
// jede Person mit ihren eigenen Zeiten steht.
//
// Je Person gilt der ZULETZT erfasste Rapport -- dieselbe "neueste zaehlt"-
// Regel wie im Abgleich (ENT-082). Ein Korrektur-Rapport soll den urspruenglichen
// auf dem Blatt ersetzen, nicht neben ihm stehen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
// Derselbe Massstab wie beim Rapport-Ausdruck: Wer Kundenberichte erzeugt,
// sieht ohnehin alle Rapporte. Ein einzelner Mitarbeitender bekommt hier
// nichts -- auf dem Blatt stehen die Zeiten der Kolleginnen und Kollegen.
require_recht($user, 'abgleich');

$einsatzId = (int)($_GET['einsatz_id'] ?? 0);
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id fehlt'], 400);
}

$pdo = db();
$e = $pdo->prepare(
    'SELECT e.id, e.kunde_id, e.kunde_name, e.titel, e.veranstaltung, e.strasse, e.ort,
            e.einsatzart, e.datum, e.von, e.bis, e.bemerkung,
            e.unterschrift, e.unterzeichner, e.unterschrift_am,
            us.name AS unterschrift_holte,
            k.kundennummer AS kunde_nr, k.name AS k_name, k.strasse AS k_strasse,
            k.hausnummer AS k_hausnummer, k.adresszusatz AS k_adresszusatz,
            k.plz AS k_plz, k.ort AS k_ort,
            k.re_name, k.re_zusatz, k.re_strasse, k.re_hausnummer, k.re_plz, k.re_ort
       FROM einsaetze e
       LEFT JOIN kunden k ON k.id = e.kunde_id
       LEFT JOIN mitarbeiter us ON us.id = e.unterschrift_von
      WHERE e.id = ?'
);
$e->execute([$einsatzId]);
$einsatz = $e->fetch();
if (!$einsatz) {
    json_response(['status' => 'error', 'message' => 'Diesen Einsatz gibt es nicht.'], 404);
}

// Alle Rapporte dieses Einsatzes, je Person der neueste. Sortiert nach
// Arbeitsbeginn, damit das Blatt einer nachvollziehbaren Reihenfolge folgt und
// nicht der Reihenfolge des Erfassens.
$r = $pdo->prepare(
    'SELECT r.id, r.mitarbeiter_id, r.von, r.bis, r.pause_min, r.netto_h,
            r.bemerkung, r.erfasst_am,
            m.vorname, m.nachname, m.name
       FROM rapporte r
       JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
      WHERE r.einsatz_id = ?
      ORDER BY r.mitarbeiter_id, r.erfasst_am DESC, r.id DESC'
);
$r->execute([$einsatzId]);

$proPerson = [];
foreach ($r->fetchAll() as $zeile) {
    $mid = (int)$zeile['mitarbeiter_id'];
    // Erster Treffer je Person gewinnt -- die Sortierung stellt den neuesten
    // nach vorn.
    if (isset($proPerson[$mid])) { continue; }
    $name = trim(($zeile['vorname'] ?? '') . ' ' . ($zeile['nachname'] ?? ''));
    $proPerson[$mid] = [
        'id'         => (int)$zeile['id'],
        'name'       => $name !== '' ? $name : (string)$zeile['name'],
        'von'        => $zeile['von'],
        'bis'        => $zeile['bis'],
        'pause_min'  => (int)$zeile['pause_min'],
        'netto_h'    => (float)$zeile['netto_h'],
        'bemerkung'  => $zeile['bemerkung'],
        'erfasst_am' => $zeile['erfasst_am'],
    ];
}
$personen = array_values($proPerson);
usort($personen, fn($a, $b) => strcmp((string)$a['von'], (string)$b['von']));

json_response(['status' => 'ok', 'bericht' => [
    'einsatz' => [
        'id' => (int)$einsatz['id'], 'kunde_name' => $einsatz['kunde_name'],
        'titel' => $einsatz['titel'], 'veranstaltung' => $einsatz['veranstaltung'],
        'strasse' => $einsatz['strasse'], 'ort' => $einsatz['ort'],
        'einsatzart' => $einsatz['einsatzart'], 'datum' => $einsatz['datum'],
        'von' => $einsatz['von'], 'bis' => $einsatz['bis'], 'bemerkung' => $einsatz['bemerkung'],
    ],
    'kunde' => [
        'kunde_id' => $einsatz['kunde_id'] === null ? null : (int)$einsatz['kunde_id'],
        'kunde_nr' => $einsatz['kunde_nr'], 'k_name' => $einsatz['k_name'],
        'k_strasse' => $einsatz['k_strasse'], 'k_hausnummer' => $einsatz['k_hausnummer'],
        'k_adresszusatz' => $einsatz['k_adresszusatz'], 'k_plz' => $einsatz['k_plz'],
        'k_ort' => $einsatz['k_ort'],
        're_name' => $einsatz['re_name'], 're_zusatz' => $einsatz['re_zusatz'],
        're_strasse' => $einsatz['re_strasse'], 're_hausnummer' => $einsatz['re_hausnummer'],
        're_plz' => $einsatz['re_plz'], 're_ort' => $einsatz['re_ort'],
    ],
    'unterschrift' => [
        'bild' => $einsatz['unterschrift'],
        'name' => $einsatz['unterzeichner'],
        'am' => $einsatz['unterschrift_am'],
        'holte' => $einsatz['unterschrift_holte'],
    ],
    'personen' => $personen,
]]);
