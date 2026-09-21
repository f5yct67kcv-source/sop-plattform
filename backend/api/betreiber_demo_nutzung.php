<?php
// Live-Nutzungsauswertung EINES Demo-Platzes (ENT-653): welcher Reiter,
// wie lange, waehrend der Platz noch laeuft.
//
// OHNE SUPPORT-FREIGABE (ENT-526), anders als betreiber_support.php --
// bewusste Abweichung von der sonst geltenden Regel "der Betreiber liest
// nie ohne Freigabe des Mandanten in dessen Instanz hinein" (Rueckfrage an
// den Projektinhaber, 2026-09-21, ENT-653). Vertretbar nur, weil
// demo_nutzung KEINE Geschaeftsdaten eines Mandanten sind, sondern
// Nutzungsdaten des eigenen Produkts durch einen Interessenten -- bereits
// in den Nutzungsbedingungen (Ziffer 8) und in datenschutz-demo-platz.html
// offengelegt. Ein echter Mandant kann hier NIE etwas liefern: Die Tabelle
// bleibt bei ihm immer leer (ist_demo_platz()-Sperre beim Schreiben,
// backend/api/demo_nutzung_melden.php), und dieser Endpunkt weist ausserdem
// ausdruecklich jeden Mandanten ab, der nicht in DEMO_PLAETZE steht --
// keine Ausnahme vom Grundsatz fuer echte Kundinnen und Kunden.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../demo_zugang.php';

require_betreiber_voll();
$stamm = betreiber_db();

$mandantId = (int)($_GET['id'] ?? 0);
if ($mandantId <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!hat_tabelle($stamm, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$s = $stamm->prepare('SELECT id, name, subdomain, status, db_host, db_name, db_user, secret_name
                        FROM mandant WHERE id = ?');
$s->execute([$mandantId]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}
if (!in_array((string)$m['subdomain'], DEMO_PLAETZE, true)) {
    // Kein "keine Daten" -- ein klarer Befund, dass hier grundsaetzlich
    // nichts abgerufen wird, nicht nur zufaellig nichts da ist.
    json_response(['status' => 'error',
        'message' => 'Nutzungsauswertung gibt es nur bei Demo-Plätzen.'], 403);
}

try {
    $pdo = mandant_db($m);
} catch (Throwable $e) {
    json_response(['status' => 'error', 'lage' => mandant_verbindung_bereit($m),
        'message' => 'Dieser Platz ist nicht erreichbar.'], 502);
}

if (!hat_tabelle($pdo, 'demo_nutzung')) {
    json_response(['status' => 'error',
        'message' => 'Bei diesem Platz ist die Nutzungsauswertung noch nicht eingerichtet.'], 409);
}

$zeilen = $pdo->query(
    'SELECT reiter, SUM(dauer_s) AS dauer_s_summe, COUNT(*) AS aufrufe
       FROM demo_nutzung GROUP BY reiter ORDER BY dauer_s_summe DESC'
)->fetchAll(PDO::FETCH_ASSOC);

json_response([
    'status'  => 'ok',
    'mandant' => ['id' => (int)$m['id'], 'name' => $m['name']],
    'reiter'  => array_map(fn($z) => [
        'reiter'      => (string)$z['reiter'],
        'dauer_s'     => (int)$z['dauer_s_summe'],
        'aufrufe'     => (int)$z['aufrufe'],
    ], $zeilen),
]);
