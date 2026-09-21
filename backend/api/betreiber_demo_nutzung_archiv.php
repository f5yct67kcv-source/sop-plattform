<?php
// Archivierte, anonyme Nutzungsauswertung ueber ALLE bisher geleerten
// Demo-Plaetze hinweg (ENT-653) -- je Reiter die Gesamtdauer und Anzahl
// Aufrufe. Kein Bezug zu Platz, Firma oder Person; siehe Kopfkommentar
// von be_demo_nutzung_archiv in backend/betreiber.php.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$stamm = betreiber_db();

if (!hat_tabelle($stamm, 'be_demo_nutzung_archiv')) {
    json_response(['status' => 'error',
        'message' => 'Das Nutzungsarchiv ist noch nicht eingerichtet.'], 503);
}

$zeilen = $stamm->query(
    'SELECT reiter, SUM(dauer_s_summe) AS dauer_s_summe, SUM(aufrufe) AS aufrufe
       FROM be_demo_nutzung_archiv GROUP BY reiter ORDER BY dauer_s_summe DESC'
)->fetchAll(PDO::FETCH_ASSOC);

json_response([
    'status' => 'ok',
    'reiter' => array_map(fn($z) => [
        'reiter'  => (string)$z['reiter'],
        'dauer_s' => (int)$z['dauer_s_summe'],
        'aufrufe' => (int)$z['aufrufe'],
    ], $zeilen),
]);
