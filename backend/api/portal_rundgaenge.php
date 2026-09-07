<?php
// Kundenportal: die Rundgaenge des angemeldeten Kunden (ENT-441).
//
// GET ?von=YYYY-MM-DD&bis=YYYY-MM-DD -> { status, kunde, objekte, zeitraum,
//                                         rundgaenge, leer_grund }
//
// DIE kunde_id KOMMT AUS DER SITZUNG, NIE AUS DER ANFRAGE. Dieser Endpunkt
// nimmt keinen Kunden-, Objekt- oder Zugangsschluessel entgegen; wer etwas
// derartiges mitschickt, aendert damit nichts. Ein Portal-Endpunkt, der
// eine kunde_id laese, waere derselbe Fehler wie ein Zwei-Faktor-Endpunkt,
// der die Person aus der Anfrage nimmt.
//
// NUR ABGESCHLOSSENE RUNDEN (ENT-441 Punkt 5). Was noch laeuft, ist nicht
// sichtbar -- ein Kunde soll den Nachweis sehen, nicht die Person bei der
// Arbeit. Ein ABGEBROCHENER Rundgang erscheint dagegen sehr wohl: Er ist
// beendet, und eine Nichterfuellung zu verschweigen waere das Gegenteil
// eines Nachweises. Ob der Grund dazu sichtbar ist, entscheidet spaeter ein
// Schalter (OP-423).
//
// KEINE PERSONENNAMEN IN DIESER LISTE. Sie beantwortet die Frage "hat die
// Runde stattgefunden", und dafuer braucht es keinen Namen. Was auf der
// Detailseite steht, entscheidet OP-423.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Ohne Zeitraum der laufende Monat. Anders als bei rundgang_liste.php
// (dort: heute) -- ein Kunde sucht nicht den heutigen Tag, sondern die
// letzten Wochen, und ein Portal, das beim Oeffnen leer aussieht, ist ein
// schlechter erster Eindruck.
$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-01');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $heute;
// Unsinnige Eingaben nicht stillschweigend uebernehmen: Ein falsch
// formatiertes Datum ergaebe in MySQL einen leeren Zeitraum, und leer sieht
// aus wie "nichts passiert".
$gueltig = static fn(string $d): bool => (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
if (!$gueltig($von)) { $von = date('Y-m-01'); }
if (!$gueltig($bis)) { $bis = $heute; }
if ($von > $bis) { [$von, $bis] = [$bis, $von]; }

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

$antwort = [
    'status'   => 'ok',
    'kunde'    => $zugang['kunde_name'],
    'person'   => $zugang['name'],
    'zeitraum' => ['von' => $von, 'bis' => $bis],
    'objekte'  => [],
    'rundgaenge' => [],
];

// Vier verschiedene Aussagen, vier verschiedene Antworten (Hausregel:
// „unbekannt darf nie wie keine aussehen"). Der Server sagt, WARUM die
// Liste leer ist -- die Oberflaeche soll das nicht aus einer Anzahl 0
// erraten muessen, denn dabei entsteht regelmaessig der Satz „keine
// Rundgaenge", wo „kein Revierdienst eingerichtet" richtig waere.
if (!$objektIds) {
    $antwort['leer_grund'] = 'kein_revierdienst';
    json_response($antwort);
}

$platz = implode(',', array_fill(0, count($objektIds), '?'));

$os = $pdo->prepare("SELECT id, name, strasse, ort FROM objekte WHERE id IN ($platz) ORDER BY name");
$os->execute($objektIds);
$antwort['objekte'] = array_map(static fn(array $o): array => [
    'id'      => (int)$o['id'],
    'name'    => (string)$o['name'],
    'strasse' => (string)($o['strasse'] ?? ''),
    'ort'     => (string)($o['ort'] ?? ''),
], $os->fetchAll(PDO::FETCH_ASSOC));

$offen = implode(',', array_fill(0, count(RUNDGANG_OFFENE_STATUS), '?'));
$sql = "SELECT r.id, r.objekt_id, r.status, r.rundgang_vorlage_id,
               r.rohzeit_start, r.rohzeit_ende, r.pause_minuten,
               e.datum, o.name AS objekt_name,
               (SELECT MAX(s.erfasst_am) FROM rundgang_scan s WHERE s.rundgang_id = r.id) AS letzter_scan
          FROM rundgang r
          JOIN einsaetze e ON e.id = r.einsatz_id
          JOIN objekte o ON o.id = r.objekt_id
         WHERE r.objekt_id IN ($platz)
           AND r.status NOT IN ($offen)
           AND e.datum BETWEEN ? AND ?
         ORDER BY e.datum DESC, r.rohzeit_start DESC";
$stmt = $pdo->prepare($sql);
$stmt->execute([...$objektIds, ...RUNDGANG_OFFENE_STATUS, $von, $bis]);
$zeilen = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($zeilen as $r) {
    $vorlageId = $r['rundgang_vorlage_id'] !== null ? (int)$r['rundgang_vorlage_id'] : null;
    $dauer = rundgang_dauer($r['rohzeit_start'], $r['rohzeit_ende'], $r['letzter_scan'],
        (int)$r['pause_minuten'], (string)$r['status']);
    $antwort['rundgaenge'][] = [
        'id'           => (int)$r['id'],
        'datum'        => (string)$r['datum'],
        'objekt_id'    => (int)$r['objekt_id'],
        'objekt_name'  => (string)$r['objekt_name'],
        'status'       => (string)$r['status'],
        'beginn'       => $r['rohzeit_start'],
        'dauer'        => $dauer,
        'fortschritt'  => rundgang_fortschritt($pdo, (int)$r['id'], (int)$r['objekt_id'], $vorlageId),
    ];
}

if (!$antwort['rundgaenge']) {
    // Zwei verschiedene Gruende, zwei verschiedene Texte: Hat es je einen
    // Rundgang gegeben, ist der Zeitraum schuld -- dann darf dort nicht
    // stehen, es sei nie etwas erfasst worden.
    $je = $pdo->prepare("SELECT 1 FROM rundgang WHERE objekt_id IN ($platz) LIMIT 1");
    $je->execute($objektIds);
    $antwort['leer_grund'] = $je->fetchColumn() ? 'kein_treffer_im_zeitraum' : 'noch_nichts_erfasst';
}

json_response($antwort);
