<?php
// Dienstfahrzeuge -- der Fahrzeugstamm des Betriebs (ENT-313).
//
// GET   -> Liste
// POST  -> anlegen/aendern, oder loeschen ({id, loeschen:true})
//
// ABGRENZUNG, die diese Datei traegt: Hier steht, was ein Fahrzeug IST --
// nicht, was mit ihm geschehen ist. Der Soll-Ist-Vergleich der gefahrenen
// Kilometer (Tachostand bei Uebernahme und Rueckgabe, Abweichung zur
// erwarteten Strecke, Luecke zwischen zwei Dienstfahrten) ist ein eigener,
// spaeterer Schritt mit eigener Tabelle und eigenem Endpunkt. Beides in
// einer Datei zu fuehren waere der Anfang eines Datensatzes, der zugleich
// Stammblatt und Fahrtenbuch sein will und am Ende keines von beidem
// nachvollziehbar haelt.
//
// LESEN darf, wer plant: Das Fahrzeug wird spaeter am Einsatz eingeteilt,
// und eine Auswahlliste, die der Planung fehlt, waere das Feld wertlos.
// AENDERN ist eine Betriebseinstellung -- dieselbe Trennung wie bei den
// Anstellungsorten (ENT-077).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
// Lesen darf, wer plant ODER den Betrieb einrichtet. Heute traegt die
// Verwaltung ohnehin beide Rechte -- geschrieben steht es trotzdem so, weil
// sonst eine spaetere Rolle mit 'betrieb', aber ohne 'plan', an ihrer
// eigenen Einstellungsseite abprallen wuerde.
require_recht($user, darf($user, 'betrieb') ? 'betrieb' : 'plan');

// Die drei Listen stehen hier und nicht in der Oberflaeche: Der Server weist
// ab, was er nicht kennt, und die Oberflaeche zeigt dieselben Werte an. Eine
// zweite Liste im Browser waere eine zweite Wahrheit.
const FZ_ARTEN = ['personenwagen', 'lieferwagen', 'kombi', 'motorrad', 'anhaenger'];
const FZ_BESITZARTEN = ['eigentum', 'leasing', 'miete'];
// "aktiv" = im Betrieb. "ausser_betrieb" = voruebergehend nicht verfuegbar
// (Werkstatt, stillgelegt). "verkauft" = endgueltig weg. Bewusst drei
// Zustaende: Ein Ja/Nein-Feld wuerde die letzten beiden zu derselben Aussage
// machen, und "steht in der Werkstatt" ist etwas anderes als "gehoert uns
// nicht mehr".
const FZ_STATUS = ['aktiv', 'ausser_betrieb', 'verkauft'];

const FZ_KM_MAX = 3000000;   // 3 Mio. km -- darueber ist es ein Tippfehler

function fz_datum(?string $wert): ?string
{
    $wert = trim((string)$wert);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert) ? $wert : null;
}

function fz_lesen(PDO $pdo): array
{
    $rows = $pdo->query(
        'SELECT f.id, f.kennzeichen, f.bezeichnung, f.marke, f.modell, f.art, f.treibstoff,
                f.farbe, f.stammnummer, f.fahrgestellnummer, f.erstzulassung, f.besitzart,
                f.besitz_bis, f.standort_id, f.status, f.ausser_betrieb_grund, f.mfk_naechste,
                f.vignette_jahr, f.versicherung, f.police_nr, f.service_naechster,
                f.service_naechste_km, f.tacho_km, f.tacho_am, f.bemerkung,
                o.bezeichnung AS standort_name
         FROM fahrzeuge f
         LEFT JOIN anstellungsorte o ON o.id = f.standort_id
         ORDER BY f.status = \'verkauft\', f.kennzeichen'
    )->fetchAll(PDO::FETCH_ASSOC);

    return array_map(function (array $r): array {
        $r['id'] = (int)$r['id'];
        $r['standort_id'] = $r['standort_id'] === null ? null : (int)$r['standort_id'];
        // Zahlen als Zahl oder als NULL heraus -- niemals als 0, wenn nichts
        // erfasst ist. "nie abgelesen" und "steht bei 0 km" sind zwei
        // verschiedene Aussagen, und die Oberflaeche kann sie nur
        // unterscheiden, wenn der Server sie unterscheidet.
        foreach (['vignette_jahr', 'service_naechste_km', 'tacho_km'] as $z) {
            $r[$z] = $r[$z] === null ? null : (int)$r[$z];
        }
        return $r;
    }, $rows);
}

$pdo = db();

// Vor dem naechsten Einrichtungslauf gibt es die Tabelle noch nicht. Das ist
// kein Fehler, aber auch NICHT dasselbe wie "keine Fahrzeuge erfasst" -- die
// Oberflaeche muss beide Faelle verschieden benennen koennen, sonst sucht
// jemand stundenlang nach Fahrzeugen, die nie angelegt werden konnten.
if (!hat_tabelle($pdo, 'fahrzeuge')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'fahrzeuge' => []]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response(['status' => 'ok', 'eingerichtet' => true, 'fahrzeuge' => fz_lesen($pdo)]);
}

require_recht($user, 'betrieb');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = isset($in['id']) ? (int)$in['id'] : 0;

if (!empty($in['loeschen'])) {
    if ($id <= 0) {
        json_response(['status' => 'error', 'message' => 'id fehlt'], 422);
    }
    $pdo->prepare('DELETE FROM fahrzeuge WHERE id = ?')->execute([$id]);
    json_response(['status' => 'ok', 'eingerichtet' => true, 'fahrzeuge' => fz_lesen($pdo)]);
}

// Kontrollschild vereinheitlichen: Grossbuchstaben, genau ein Leerzeichen
// zwischen Kanton und Nummer. Ohne das waeren "so 12345", "SO12345" und
// "SO  12345" drei verschiedene Fahrzeuge, und der eindeutige Schluessel
// unten liefe ins Leere.
$kennzeichen = strtoupper(trim((string)($in['kennzeichen'] ?? '')));
$kennzeichen = preg_replace('/\s+/', ' ', $kennzeichen);
if ($kennzeichen === '') {
    json_response(['status' => 'error', 'message' => 'Das Kontrollschild ist erforderlich.'], 422);
}
if (mb_strlen($kennzeichen) > 20) {
    json_response(['status' => 'error', 'message' => 'Das Kontrollschild ist zu lang.'], 422);
}

$art       = strtolower(trim((string)($in['art'] ?? 'personenwagen')));
$besitzart = strtolower(trim((string)($in['besitzart'] ?? 'eigentum')));
$status    = strtolower(trim((string)($in['status'] ?? 'aktiv')));
if (!in_array($art, FZ_ARTEN, true)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Fahrzeugart'], 422);
}
if (!in_array($besitzart, FZ_BESITZARTEN, true)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Besitzart'], 422);
}
if (!in_array($status, FZ_STATUS, true)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Status'], 422);
}

$text = function (string $feld, int $max) use ($in): ?string {
    $w = trim((string)($in[$feld] ?? ''));
    return $w === '' ? null : mb_substr($w, 0, $max);
};

$standortId = ($in['standort_id'] ?? '') === '' || $in['standort_id'] === null
    ? null : (int)$in['standort_id'];
if ($standortId !== null) {
    $s = $pdo->prepare('SELECT 1 FROM anstellungsorte WHERE id = ?');
    $s->execute([$standortId]);
    if (!$s->fetchColumn()) {
        json_response(['status' => 'error', 'message' => 'Dieser Standort gibt es nicht.'], 422);
    }
}

// Eine Zahl, die nicht dasteht, bleibt NULL -- sie wird nicht zu 0. Der
// Unterschied zwischen "nicht erfasst" und "null Kilometer" ist genau der,
// den ein Fahrtenbuch spaeter braucht.
$zahl = function (string $feld, int $min, int $max) use ($in) {
    $roh = $in[$feld] ?? null;
    if ($roh === null || $roh === '') { return null; }
    $wert = (int)$roh;
    return ($wert < $min || $wert > $max) ? false : $wert;
};

$tachoKm = $zahl('tacho_km', 0, FZ_KM_MAX);
$serviceKm = $zahl('service_naechste_km', 0, FZ_KM_MAX);
$vignette = $zahl('vignette_jahr', 2000, 2100);
if ($tachoKm === false || $serviceKm === false) {
    json_response(['status' => 'error', 'message' => 'Ein Kilometerstand liegt ausserhalb des plausiblen Bereichs (0 bis 3 000 000).'], 422);
}
if ($vignette === false) {
    json_response(['status' => 'error', 'message' => 'Das Vignettenjahr ist unplausibel.'], 422);
}

// Ein Kilometerstand ohne Ablesedatum ist nicht beurteilbar: Niemand weiss
// dann, ob er von gestern oder vom letzten Sommer stammt. Statt still
// "heute" zu unterstellen -- was eine erfundene Tatsache waere -- wird das
// Datum verlangt, sobald eine Zahl dasteht.
$tachoAm = fz_datum($in['tacho_am'] ?? null);
if ($tachoKm !== null && $tachoAm === null) {
    json_response(['status' => 'error', 'message' => 'Zum Kilometerstand gehört das Datum, an dem er abgelesen wurde.'], 422);
}
if ($tachoKm === null) { $tachoAm = null; }

// Der Grund gehoert zum Zustand, nicht zum Fahrzeug: Steht es wieder im
// Betrieb, wird er verworfen statt als Karteileiche stehenzubleiben und
// spaeter falsch gelesen zu werden (dasselbe Muster wie oev_rappen in
// einsatz_verkehrsmittel.php).
$grund = $status === 'aktiv' ? null : $text('ausser_betrieb_grund', 200);
// Ebenso das Vertragsende: Es hat nur bei Leasing und Miete eine Bedeutung.
$besitzBis = $besitzart === 'eigentum' ? null : fz_datum($in['besitz_bis'] ?? null);

$werte = [
    'kennzeichen'         => $kennzeichen,
    'bezeichnung'         => $text('bezeichnung', 200),
    'marke'               => $text('marke', 100),
    'modell'              => $text('modell', 100),
    'art'                 => $art,
    'treibstoff'          => $text('treibstoff', 20),
    'farbe'               => $text('farbe', 50),
    'stammnummer'         => $text('stammnummer', 30),
    'fahrgestellnummer'   => $text('fahrgestellnummer', 30),
    'erstzulassung'       => fz_datum($in['erstzulassung'] ?? null),
    'besitzart'           => $besitzart,
    'besitz_bis'          => $besitzBis,
    'standort_id'         => $standortId,
    'status'              => $status,
    'ausser_betrieb_grund' => $grund,
    'mfk_naechste'        => fz_datum($in['mfk_naechste'] ?? null),
    'vignette_jahr'       => $vignette,
    'versicherung'        => $text('versicherung', 200),
    'police_nr'           => $text('police_nr', 50),
    'service_naechster'   => fz_datum($in['service_naechster'] ?? null),
    'service_naechste_km' => $serviceKm,
    'tacho_km'            => $tachoKm,
    'tacho_am'            => $tachoAm,
    'bemerkung'           => $text('bemerkung', 2000),
];

$doppelt = $pdo->prepare('SELECT id FROM fahrzeuge WHERE kennzeichen = ? AND id <> ?');
$doppelt->execute([$kennzeichen, $id]);
if ($doppelt->fetchColumn()) {
    json_response([
        'status' => 'error',
        'message' => 'Ein Fahrzeug mit dem Kontrollschild ' . $kennzeichen . ' ist bereits erfasst.',
    ], 422);
}

$spalten = array_keys($werte);
if ($id > 0) {
    $satz = implode(', ', array_map(fn($s) => "$s = ?", $spalten));
    $stmt = $pdo->prepare("UPDATE fahrzeuge SET $satz WHERE id = ?");
    $stmt->execute([...array_values($werte), $id]);
} else {
    $platz = implode(', ', array_fill(0, count($spalten), '?'));
    $stmt = $pdo->prepare('INSERT INTO fahrzeuge (' . implode(', ', $spalten) . ") VALUES ($platz)");
    $stmt->execute(array_values($werte));
    $id = (int)$pdo->lastInsertId();
}

json_response(['status' => 'ok', 'id' => $id, 'eingerichtet' => true, 'fahrzeuge' => fz_lesen($pdo)]);
