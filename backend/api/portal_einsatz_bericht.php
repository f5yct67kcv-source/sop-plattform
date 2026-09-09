<?php
// Kundenportal: der Kundenrapport EINES Einsatzes (ENT-482).
//
// GET ?einsatz_id=<n> -> { status, bericht: { einsatz, kunde, unterschrift, personen } }
//
// Das Gegenstueck zu einsatz_bericht.php (ENT-160), aber NICHT dessen
// Wiederverwendung: Jener haengt an require_session() und dem Recht
// `abgleich_lesen`. Ihn fuer zwei Personenkreise zu oeffnen hiesse, an einer
// Stelle ueber Verwaltung und Betriebsfremde zugleich zu entscheiden -- genau
// die Vermischung, die ENT-441 Punkt 1 vermeidet.
//
// DER INHALT IST 1:1 DERSELBE. Entscheidung des Projektinhabers vom
// 2026-09-08: „1:1 zeigen.. der Kunde bekommt jetzt schon eine physische
// Kopie des Rapports." Namen und Zeiten der eingesetzten Personen gehoeren
// also mit -- sie sind nicht ein Detail auf diesem Blatt, sie sind seine
// Substanz. Das Portal oeffnet damit keinen neuen Datenfluss, sondern einen
// zweiten Weg zu einem Blatt, das der Kunde bereits hat und selbst
// unterschrieben hat.
//
// Je Person zaehlt der ZULETZT erfasste Rapport -- dieselbe „neueste
// zaehlt"-Regel wie im Abgleich (ENT-082) und in ENT-160. Ein
// Korrektur-Rapport ersetzt den urspruenglichen auf dem Blatt, statt daneben
// zu stehen.
//
// Was NICHT mitgeht: einsaetze.titel (interner Planungstitel, steht auf
// keinem Blatt an den Kunden) und einsaetze.bemerkung (interne Notiz zum
// Einsatz -- auf dem Blatt stehen nur die Bemerkungen der Rapporte).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$einsatzId = (int)($_GET['einsatz_id'] ?? 0);
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id erforderlich'], 422);
}

$pdo = db();
$kundeId = (int)$zugang['kunde_id'];
$objektIds = kp_objekt_ids($pdo, $kundeId);

// Eine Antwort fuer alle Ausschlussfaelle: gibt es nicht / gehoert einem
// anderen Kunden / noch nicht unterschrieben. Drei verschiedene waeren ein
// Auskunftsdienst darueber, welche Nummern vergeben sind.
$nichtAbrufbar = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Dieser Einsatz ist nicht abrufbar.'], 404);
};

$e = $pdo->prepare(
    'SELECT e.id, e.kunde_id, e.objekt_id, e.strasse, e.ort, e.einsatzart,
            e.veranstaltung, e.datum,
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
$einsatz = $e->fetch(PDO::FETCH_ASSOC);
if (!$einsatz) { $nichtAbrufbar(); }

if (!kp_einsatz_sichtbar(
        $einsatz['kunde_id'] === null ? null : (int)$einsatz['kunde_id'],
        $kundeId,
        $einsatz['objekt_id'] === null ? null : (int)$einsatz['objekt_id'],
        $objektIds,
        $einsatz['unterschrift'] !== null)) {
    $nichtAbrufbar();
}

// Alle Rapporte dieses Einsatzes, je Person der neueste. Sortiert nach
// Arbeitsbeginn, damit das Blatt einer nachvollziehbaren Reihenfolge folgt
// und nicht der Reihenfolge des Erfassens.
$r = $pdo->prepare(
    'SELECT r.mitarbeiter_id, r.von, r.bis, r.pause_min, r.netto_h, r.bemerkung,
            m.vorname, m.nachname, m.name
       FROM rapporte r
       JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
      WHERE r.einsatz_id = ?
      ORDER BY r.mitarbeiter_id, r.erfasst_am DESC, r.id DESC'
);
$r->execute([$einsatzId]);

$jePerson = [];
foreach ($r->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
    $mid = (int)$zeile['mitarbeiter_id'];
    if (isset($jePerson[$mid])) { continue; }   // erster Treffer = neuester
    $name = trim(((string)$zeile['vorname']) . ' ' . ((string)$zeile['nachname']));
    $jePerson[$mid] = [
        'name'      => $name !== '' ? $name : (string)$zeile['name'],
        'von'       => $zeile['von'],
        'bis'       => $zeile['bis'],
        'pause_min' => (int)$zeile['pause_min'],
        'netto_h'   => (float)$zeile['netto_h'],
        'bemerkung' => $zeile['bemerkung'],
    ];
}
$personen = array_values($jePerson);
usort($personen, static fn(array $a, array $b): int => strcmp((string)$a['von'], (string)$b['von']));

// Zustellnachweis (ENT-491). ERST HIER, nach allen Zuschnittspruefungen:
// Vermerkt wird nur, was auch wirklich ausgeliefert wird. Ein Vermerk
// vor der Pruefung hielte fest, dass jemand nach einer fremden Nummer
// gefragt hat -- das ist keine Zustellung, sondern eine Beobachtung.
kp_abruf_vermerken($pdo, (int)$zugang['id'], 'einsatz', $einsatzId);

json_response(['status' => 'ok', 'bericht' => [
    'einsatz' => [
        'id'            => (int)$einsatz['id'],
        'datum'         => (string)$einsatz['datum'],
        'strasse'       => (string)($einsatz['strasse'] ?? ''),
        'ort'           => (string)($einsatz['ort'] ?? ''),
        'einsatzart'    => (string)($einsatz['einsatzart'] ?? ''),
        'veranstaltung' => $einsatz['veranstaltung'],
    ],
    'kunde' => [
        'kunde_id'  => $einsatz['kunde_id'] === null ? null : (int)$einsatz['kunde_id'],
        'kunde_nr'  => $einsatz['kunde_nr'],
        'k_name'    => $einsatz['k_name'],       'k_strasse'      => $einsatz['k_strasse'],
        'k_hausnummer' => $einsatz['k_hausnummer'], 'k_adresszusatz' => $einsatz['k_adresszusatz'],
        'k_plz'     => $einsatz['k_plz'],        'k_ort'          => $einsatz['k_ort'],
        're_name'   => $einsatz['re_name'],      're_zusatz'      => $einsatz['re_zusatz'],
        're_strasse' => $einsatz['re_strasse'],  're_hausnummer'  => $einsatz['re_hausnummer'],
        're_plz'    => $einsatz['re_plz'],       're_ort'         => $einsatz['re_ort'],
    ],
    'unterschrift' => [
        'bild'  => $einsatz['unterschrift'],
        'name'  => $einsatz['unterzeichner'],
        'am'    => $einsatz['unterschrift_am'],
        'holte' => $einsatz['unterschrift_holte'],
    ],
    'personen' => $personen,
]]);
