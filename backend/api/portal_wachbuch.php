<?php
// Kundenportal: das Wachbuch (ENT-484).
//
// GET ?von=YYYY-MM-DD&bis=YYYY-MM-DD[&arten=scan,rundgang,...]
//   -> { status, zeitraum, eintraege, gezeigt, gesamt, gekuerzt, je_art,
//        quellen, leer_grund }
//
// Die chronologische Chronik dessen, was an den Objekten des angemeldeten
// Kunden geschehen ist. Dasselbe Wachbuch wie im Cockpit (ENT-480), aber
// mit dem Zuschnitt und den Grenzen des Portals.
//
// DIE kunde_id KOMMT AUS DER SITZUNG, NIE AUS DER ANFRAGE -- wie in jedem
// Portal-Endpunkt. Der Zuschnitt ist kp_objekt_ids(): alle Objekte dieses
// Kunden und kein einziges fremdes. Eine objekt_id nimmt dieser Endpunkt
// bewusst NICHT entgegen: Er hat nichts einzugrenzen, was die Sitzung nicht
// schon eingrenzt, und ein Objektschluessel aus der Anfrage waere eine
// zweite Stelle, an der ueber Sichtbarkeit entschieden wird.
//
// EIGENER ENDPUNKT, nicht wachbuch_liste.php mitbenutzt: Jener haengt an
// require_session() und dem Recht 'rundgaenge_lesen', also am
// Verwaltungszugang. Ihn fuer beide Personenkreise zu oeffnen hiesse, an
// einer Stelle ueber beide zu entscheiden -- dieselbe Trennung wie zwischen
// rundgang_detail.php und portal_rundgang_detail.php.
//
// Die ZUSAMMENFUEHRUNG teilen sich beide (wachbuch_eintraege() in
// backend/rundgang.php). Das ist Absicht und kein Widerspruch zum Absatz
// darueber: Getrennt gepflegt ergaeben zwei Chroniken derselben Nacht
// irgendwann zwei verschiedene Naechte. Getrennt bleibt, WER etwas sehen
// darf; gemeinsam bleibt, WIE sortiert und gekappt wird.
//
// WAS MITGEHT UND WAS NICHT:
//
//   - KEIN Personenname. Die Chronik ist eine Liste und folgt damit
//     portal_rundgaenge.php: Sie beantwortet „was ist geschehen", nicht
//     „wer war es". Wer den Namen braucht, klappt die Runde auf -- dort
//     steht er seit ENT-481. Das ist kein Widerspruch zu ENT-481, sondern
//     dieselbe Abstufung wie zwischen Liste und Detail.
//   - KEIN Kundenname und KEIN Einsatztitel. Der erste ist im Portal immer
//     derselbe, der zweite ist fuer Disponenten geschrieben.
//   - KEINE Uebermittlungszeit. Der Abstand zwischen Erfassen und
//     Uebermitteln (ENT-132) ist ein betriebliches Guetezeichen, kein Teil
//     des Nachweises -- das Rundgang-Detail traegt ihn ebenfalls nicht.
//   - NUR BEENDETE RUNDEN und deren Vorgaenge (ENT-441 Punkt 5). Was noch
//     laeuft, bleibt draussen: Ein Kunde soll den Nachweis sehen, nicht die
//     Person bei der Arbeit.
//   - NUR EREIGNISSE AN EINER RUNDE. Genau das, was das Portal heute schon
//     unter der Runde zeigt. Eine Meldung ausserhalb einer Runde hat ein
//     Kunde noch nie gesehen; sie hier mitzuliefern waere ein neuer
//     Datenfluss und keine Darstellungsfrage -- das braucht eine eigene
//     Entscheidung (OP-484).
//   - Der ABBRUCHGRUND als KLARTEXT aus dem Katalog, nicht als Codewort
//     (ENT-324/ENT-481). portal.html traegt keine eigene Kopie.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Derselbe Zeitraum-Umgang wie portal_rundgaenge.php: ohne Angabe der
// laufende Monat, unsinnige Eingaben nicht stillschweigend uebernehmen --
// ein leerer Zeitraum saehe aus wie „nichts passiert".
$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-01');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $heute;
$gueltig = static fn(string $d): bool => (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
if (!$gueltig($von)) { $von = date('Y-m-01'); }
if (!$gueltig($bis)) { $bis = $heute; }
if ($von > $bis) { [$von, $bis] = [$bis, $von]; }

// Nur benannte Arten werden durchgelassen; alles andere faellt weg, statt
// als unbekannter Wert bis in die Abfrage zu laufen.
$arten = array_values(array_intersect(
    array_filter(explode(',', (string)($_GET['arten'] ?? ''))),
    ['scan', 'rundgang', 'aufgabe', 'ereignis']
));

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

$antwort = [
    'status'   => 'ok',
    'kunde'    => $zugang['kunde_name'],
    'person'   => $zugang['name'],
    'zeitraum' => ['von' => $von, 'bis' => $bis],
];

// Vier verschiedene Aussagen, vier verschiedene Antworten -- dieselbe Regel
// und dieselben Kennungen wie in portal_rundgaenge.php, damit die
// Oberflaeche nicht zwei Wortschaetze braucht.
if (!$objektIds) {
    json_response($antwort + ['eintraege' => [], 'gezeigt' => 0, 'gesamt' => 0,
        'gekuerzt' => false, 'je_art' => [], 'quellen' => [],
        'leer_grund' => 'kein_revierdienst']);
}

$roh = wachbuch_eintraege($pdo, $von, $bis, $objektIds, WACHBUCH_GRENZE, $arten, [
    'nur_beendete_runden'      => true,
    'nur_ereignisse_mit_runde' => true,
]);

// Die Antwort wird STUECK FUER STUECK zusammengesetzt und nicht durchgereicht:
// Was der Kunde bekommt, soll hier abzulesen sein. Ein Durchreichen mit
// unset() waere eine Liste dessen, was NICHT mitgeht -- und ein neues Feld in
// wachbuch_eintraege() liefe still mit hinaus.
$eintraege = array_map(static function (array $e): array {
    $z = [
        'art'           => $e['art'],
        'id'            => $e['id'],
        'zeit'          => $e['zeit'],
        'status'        => $e['status'],
        'objekt_id'     => $e['objekt_id'],
        'objekt_name'   => $e['objekt_name'],
        'rundgang_id'   => $e['rundgang_id'],
        'rundgang_name' => $e['rundgang_name'],
        'hat_foto'      => $e['hat_foto'],
    ];
    if (array_key_exists('punkt_name', $e))  { $z['punkt_name']  = $e['punkt_name']; }
    if (array_key_exists('bezeichnung', $e)) { $z['bezeichnung'] = $e['bezeichnung']; }
    if (array_key_exists('text', $e))        { $z['text']        = $e['text']; }
    if (array_key_exists('vorfall_am', $e))  { $z['vorfall_am']  = $e['vorfall_am']; }
    if ($e['art'] === 'rundgang') {
        $z['scans_anzahl'] = $e['scans_anzahl'];
        // Klartext statt Codewort (ENT-324). Ohne Abbruch bleibt es null --
        // ein leerer Grund an einer abgeschlossenen Runde waere eine Aussage.
        $z['abbruch_grund'] = $e['abbruch_grund'] !== null
            ? (RUNDGANG_ABBRUCH_GRUENDE[$e['abbruch_grund']] ?? (string)$e['abbruch_grund'])
            : null;
    }
    return $z;
}, $roh['eintraege']);

$antwort += [
    'eintraege' => $eintraege,
    'gezeigt'   => $roh['gezeigt'],
    'gesamt'    => $roh['gesamt'],
    'gekuerzt'  => $roh['gekuerzt'],
    'grenze'    => $roh['grenze'],
    'je_art'    => $roh['je_art'],
    'quellen'   => $roh['quellen'],
];

if (!$eintraege) {
    // Zwei verschiedene Gruende, zwei verschiedene Texte -- wie bei den
    // Rundgaengen: Hat es je etwas gegeben, ist der Zeitraum schuld.
    if ($arten) {
        $antwort['leer_grund'] = 'kein_treffer_der_art';
    } else {
        $platz = implode(',', array_fill(0, count($objektIds), '?'));
        $je = $pdo->prepare("SELECT 1 FROM rundgang WHERE objekt_id IN ($platz) LIMIT 1");
        $je->execute($objektIds);
        $antwort['leer_grund'] = $je->fetchColumn()
            ? 'kein_treffer_im_zeitraum' : 'noch_nichts_erfasst';
    }
}

json_response($antwort);
