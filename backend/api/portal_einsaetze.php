<?php
// Kundenportal: die Einsaetze des angemeldeten Kunden (ENT-482).
//
// GET ?von=YYYY-MM-DD&bis=YYYY-MM-DD
//   -> { status, zeitraum, einsaetze, je_vorhanden, leer_grund }
//
// Der Verkehrsdienst-Teil aus ENT-441 Punkt 4. Eine Zeile ist ein EINSATZ
// und nicht ein Rapport: Das Dokument ist der Kundenrapport nach ENT-160 --
// ein Blatt je Einsatz, auf dem jede Person mit IHREN Zeiten steht. Der
// Rapport bleibt der Arbeitszeit-Nachweis einer Person; zusammengefasst
// wird nur das Blatt.
//
// SICHTBAR IST, WAS UNTERSCHRIEBEN IST (ENT-441 Punkt 5). Die Unterschrift
// haengt seit ENT-160 am Einsatz. Was der Kunde selbst gegengezeichnet hat,
// darf er nachlesen -- und es braucht keinen taeglichen Freigabe-Handgriff,
// der vergessen werden kann.
//
// Die kunde_id kommt aus der Sitzung, nie aus der Anfrage.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-01');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $heute;
$gueltig = static fn(string $d): bool => (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
if (!$gueltig($von)) { $von = date('Y-m-01'); }
if (!$gueltig($bis)) { $bis = $heute; }
if ($von > $bis) { [$von, $bis] = [$bis, $von]; }

$pdo = db();
$kundeId = (int)$zugang['kunde_id'];
$objektIds = kp_objekt_ids($pdo, $kundeId);

$antwort = [
    'status'       => 'ok',
    'zeitraum'     => ['von' => $von, 'bis' => $bis],
    'einsaetze'    => [],
    'je_vorhanden' => false,
];

// Die beiden Wege aus kp_einsatz_sichtbar() als eine Bedingung. Ohne
// Objekte bleibt allein e.kunde_id -- das ist der Normalfall im
// Verkehrsdienst.
$objektTeil = '';
$objektWerte = [];
if ($objektIds) {
    $objektTeil = ' OR e.objekt_id IN (' . implode(',', array_fill(0, count($objektIds), '?')) . ')';
    $objektWerte = $objektIds;
}
$wem = '(e.kunde_id = ?' . $objektTeil . ')';

// "Gibt es ueberhaupt je einen" wird OHNE Zeitraum gefragt. Die Oberflaeche
// entscheidet daran, ob sie den Verkehrsdienst-Teil ueberhaupt anbietet --
// und das darf sich nicht aendern, nur weil jemand den Zeitraum verstellt.
$je = $pdo->prepare("SELECT 1 FROM einsaetze e
                      WHERE $wem AND e.unterschrift IS NOT NULL LIMIT 1");
$je->execute([$kundeId, ...$objektWerte]);
$antwort['je_vorhanden'] = (bool)$je->fetchColumn();

$stmt = $pdo->prepare(
    "SELECT e.id, e.datum, e.strasse, e.ort, e.einsatzart, e.veranstaltung,
            e.unterzeichner, e.unterschrift_am
       FROM einsaetze e
      WHERE $wem
        AND e.unterschrift IS NOT NULL
        AND e.datum BETWEEN ? AND ?
      ORDER BY e.datum DESC, e.id DESC"
);
$stmt->execute([$kundeId, ...$objektWerte, $von, $bis]);
$zeilen = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Personen und Zeiten je Einsatz: EINE Abfrage fuer alle Zeilen statt einer
// je Zeile. Je Person zaehlt der ZULETZT erfasste Rapport -- dieselbe
// "neueste zaehlt"-Regel wie im Abgleich (ENT-082) und im Kundenbericht
// (ENT-160). Ohne sie zaehlte ein Korrektur-Rapport doppelt, und die Zahl
// auf der Zeile widerspraeche dem Blatt darunter.
$nachEinsatz = [];
if ($zeilen) {
    $ids = array_map(static fn(array $z): int => (int)$z['id'], $zeilen);
    $platz = implode(',', array_fill(0, count($ids), '?'));
    $r = $pdo->prepare(
        "SELECT einsatz_id, mitarbeiter_id, von, bis, netto_h
           FROM rapporte
          WHERE einsatz_id IN ($platz)
          ORDER BY einsatz_id, mitarbeiter_id, erfasst_am DESC, id DESC"
    );
    $r->execute($ids);
    $gesehen = [];
    foreach ($r->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $eid = (int)$zeile['einsatz_id'];
        $schluessel = $eid . ':' . (int)$zeile['mitarbeiter_id'];
        if (isset($gesehen[$schluessel])) { continue; }   // nur der neueste je Person
        $gesehen[$schluessel] = true;
        if (!isset($nachEinsatz[$eid])) {
            $nachEinsatz[$eid] = ['personen' => 0, 'stunden' => 0.0, 'von' => null, 'bis' => null];
        }
        $nachEinsatz[$eid]['personen']++;
        $nachEinsatz[$eid]['stunden'] += (float)$zeile['netto_h'];
        $v = (string)$zeile['von'];
        $b = (string)$zeile['bis'];
        if ($nachEinsatz[$eid]['von'] === null || $v < $nachEinsatz[$eid]['von']) {
            $nachEinsatz[$eid]['von'] = $v;
        }
        if ($nachEinsatz[$eid]['bis'] === null || $b > $nachEinsatz[$eid]['bis']) {
            $nachEinsatz[$eid]['bis'] = $b;
        }
    }
}

foreach ($zeilen as $z) {
    $eid = (int)$z['id'];
    $summe = $nachEinsatz[$eid] ?? ['personen' => 0, 'stunden' => 0.0, 'von' => null, 'bis' => null];
    $antwort['einsaetze'][] = [
        'id'            => $eid,
        'datum'         => (string)$z['datum'],
        'strasse'       => (string)($z['strasse'] ?? ''),
        'ort'           => (string)($z['ort'] ?? ''),
        'einsatzart'    => (string)($z['einsatzart'] ?? ''),
        'veranstaltung' => $z['veranstaltung'],
        'personen'      => (int)$summe['personen'],
        // Zwei Einheiten, zwei Felder: "personen" zaehlt Menschen,
        // "stunden" zaehlt Zeit. Nie unter einer Ueberschrift.
        'stunden'       => round((float)$summe['stunden'], 2),
        'von'           => $summe['von'],
        'bis'           => $summe['bis'],
    ];
}

// Vier verschiedene Aussagen, vier verschiedene Antworten (Hausregel). Der
// Server sagt, WARUM die Liste leer ist.
if (!$antwort['einsaetze']) {
    $antwort['leer_grund'] = $antwort['je_vorhanden']
        ? 'kein_treffer_im_zeitraum'
        : 'noch_nichts_unterschrieben';
}

json_response($antwort);
