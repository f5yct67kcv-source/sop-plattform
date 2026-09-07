<?php
// Betriebsweite Abzugssaetze mit Gueltigkeitszeitraum (ENT-451).
//
// GET  -> alle Saetze, neuste zuerst
// POST -> anlegen/aendern, mit {id, loeschen:true} entfernen
//
// Gleiche Bauart wie GAV_REGELWERK in gav.js und LOHN_MINDESTLOHN in
// lohn.php: Beim Fortschreiben wird ANGEHAENGT, der alte Eintrag bleibt
// stehen. Eine Satzaenderung per 1. Januar darf den Dezember nicht
// rueckwirkend neu rechnen.
//
// BEWUSST OHNE STARTBESTAND: AHV-, ALV-, NBU-, KTG- und BVG-Saetze sind
// gesetzliche bzw. vertragliche Werte, die jaehrlich aendern und nirgends
// im Projekt als Quelle erfasst sind. Ein vorbelegter Satz saehe aus wie
// eine geprüfte Zahl und rechnete weiter, wenn er veraltet. Fehlt ein Satz,
// wird gesperrt statt mit 0 gerechnet -- "unbekannt" ist nicht "keine".
//
// Der PaKo-Beitrag ist die Ausnahme und steht NICHT hier: Er steht
// woertlich im GAV (Art. 6 Ziff. 2) und lebt als versionierte Konstante in
// backend/lohn.php, wie die Mindestloehne aus Anhang 1.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';
require_once __DIR__ . '/../lohn.php';

$user = require_session();
require_recht($user, 'lohn_lesen');

// Welche Abzuege es gibt. Die Liste steht hier und nicht in der Oberflaeche,
// damit ein Tippfehler im Schluessel nicht eine zweite, stille Zeile anlegt.
function lohn_abzug_schluessel(): array
{
    return [
        'ahv' => 'AHV/IV/EO — Arbeitnehmeranteil',
        'alv' => 'ALV — Arbeitnehmeranteil',
        'nbu' => 'NBU (Nichtberufsunfall) — Arbeitnehmeranteil',
        'ktg' => 'Krankentaggeld — Arbeitnehmeranteil (Art. 17 Ziff. 3: höchstens die Hälfte)',
        'bvg' => 'BVG — Vorgabe; der Betrag je Person kommt aus der Meldung der Pensionskasse',
    ];
}

function abzuege_lesen(): array
{
    $rows = db()->query(
        'SELECT * FROM lohn_abzug ORDER BY schluessel, gueltig_ab DESC'
    )->fetchAll();
    return array_map(function ($r) {
        foreach (['id','satz_bp','fix_rappen','hoechstlohn_rappen'] as $f) {
            if (isset($r[$f]) && $r[$f] !== null) { $r[$f] = (int)$r[$f]; }
        }
        return $r;
    }, $rows);
}

// Welche Abzuege heute noch gar nicht erfasst sind. Ausdruecklich benannt
// statt als leere Liste: Eine fehlende Zeile sieht sonst aus wie "kein
// Abzug", und genau das waere sie nicht.
function abzuege_fehlend(array $vorhanden): array
{
    $haben = array_unique(array_column($vorhanden, 'schluessel'));
    return array_values(array_diff(array_keys(lohn_abzug_schluessel()), $haben));
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $liste = abzuege_lesen();
    json_response([
        'status' => 'ok',
        'abzuege' => $liste,
        'katalog' => lohn_abzug_schluessel(),
        'fehlend' => abzuege_fehlend($liste),
    ]);
}

require_recht($user, 'lohn_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($input['id'] ?? 0);
$pdo = db();

if (!empty($input['loeschen'])) {
    if ($id <= 0) { json_response(['status' => 'error', 'message' => 'id fehlt'], 400); }
    $pdo->prepare('DELETE FROM lohn_abzug WHERE id = ?')->execute([$id]);
    $liste = abzuege_lesen();
    json_response(['status' => 'ok', 'abzuege' => $liste, 'fehlend' => abzuege_fehlend($liste)]);
}

$schluessel = strtolower(trim((string)($input['schluessel'] ?? '')));
if (!array_key_exists($schluessel, lohn_abzug_schluessel())) {
    json_response(['status' => 'error',
        'message' => 'Schlüssel: ' . implode(', ', array_keys(lohn_abzug_schluessel()))], 400);
}
$ab = (string)($input['gueltig_ab'] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $ab)) {
    json_response(['status' => 'error', 'message' => 'Gültig ab: Datum erforderlich'], 400);
}
$bis = (string)($input['gueltig_bis'] ?? '');
if ($bis !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $bis)) {
    json_response(['status' => 'error', 'message' => 'Gültig bis: Datum oder leer'], 400);
}
if ($bis !== '' && $bis < $ab) {
    json_response(['status' => 'error', 'message' => 'Gültig bis liegt vor Gültig ab'], 400);
}

// Satz in Prozent entgegennehmen und in Basispunkte umrechnen -- getippt
// wird "5.3", gespeichert 530. Fliesskomma nur an dieser einen Stelle.
$satzBp = null;
if (isset($input['satz_prozent']) && $input['satz_prozent'] !== '') {
    $t = str_replace(',', '.', (string)$input['satz_prozent']);
    if (!is_numeric($t)) {
        json_response(['status' => 'error', 'message' => 'Satz: Zahl in Prozent, z. B. 5.3'], 400);
    }
    $satzBp = lohn_rappen((float)$t * 100);
}
$fix = null;
if (isset($input['fix_franken']) && $input['fix_franken'] !== '') {
    $t = str_replace([',', "'"], ['.', ''], (string)$input['fix_franken']);
    if (!is_numeric($t)) {
        json_response(['status' => 'error', 'message' => 'Fixbetrag: Zahl in Franken'], 400);
    }
    $fix = lohn_rappen((float)$t * 100);
}
if ($satzBp === null && $fix === null) {
    json_response(['status' => 'error',
        'message' => 'Entweder ein Satz in Prozent oder ein Fixbetrag ist erforderlich'], 400);
}
$hoechst = null;
if (isset($input['hoechstlohn_franken']) && $input['hoechstlohn_franken'] !== '') {
    $t = str_replace([',', "'"], ['.', ''], (string)$input['hoechstlohn_franken']);
    if (is_numeric($t)) { $hoechst = lohn_rappen((float)$t * 100); }
}
// Ohne Quelle wird nicht gespeichert. An dieser Zahl haengt Geld -- da darf
// spaeter niemand raten muessen, ob sie jemand eingetippt oder aus einer
// Verfuegung uebernommen hat. Gleiche Haltung wie bei objekt_distanz.quelle.
$quelle = trim((string)($input['quelle'] ?? ''));
if ($quelle === '') {
    json_response(['status' => 'error',
        'message' => 'Quelle erforderlich — woher stammt dieser Satz?'], 400);
}
$bem = trim((string)($input['bemerkung'] ?? '')) ?: null;

$werte = [$schluessel, lohn_abzug_schluessel()[$schluessel], $ab, $bis ?: null,
          $satzBp, $fix, $hoechst, $quelle, $bem, (int)$user['id']];
if ($id > 0) {
    $werte[] = $id;
    $pdo->prepare(
        'UPDATE lohn_abzug SET schluessel = ?, bezeichnung = ?, gueltig_ab = ?, gueltig_bis = ?,
             satz_bp = ?, fix_rappen = ?, hoechstlohn_rappen = ?, quelle = ?, bemerkung = ?,
             geaendert_von = ?, geaendert_am = NOW()
         WHERE id = ?'
    )->execute($werte);
} else {
    try {
        $pdo->prepare(
            'INSERT INTO lohn_abzug
               (schluessel, bezeichnung, gueltig_ab, gueltig_bis, satz_bp, fix_rappen,
                hoechstlohn_rappen, quelle, bemerkung, geaendert_von, geaendert_am)
             VALUES (?,?,?,?,?,?,?,?,?,?,NOW())'
        )->execute($werte);
    } catch (Throwable $e) {
        json_response(['status' => 'error',
            'message' => 'Für ' . strtoupper($schluessel) . ' gibt es bereits einen Satz ab '
                       . $ab . ' — bitte diesen ändern statt einen zweiten anzulegen'], 400);
    }
}
$liste = abzuege_lesen();
json_response(['status' => 'ok', 'abzuege' => $liste, 'fehlend' => abzuege_fehlend($liste)]);
