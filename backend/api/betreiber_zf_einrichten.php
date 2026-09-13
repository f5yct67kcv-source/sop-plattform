<?php
// Zweiten Faktor einrichten oder erneuern (OP-517).
//
// Zwei Faelle, und der Unterschied ist wichtig:
//
//   - Noch nichts bestaetigt: Ein neues Geheimnis wird erzeugt, fertig. Ein
//     unbestaetigtes Geheimnis ist wertlos und darf jederzeit ersetzt werden
//     -- sonst haenge fest, wessen App den QR-Code nicht gelesen hat.
//   - Bereits bestaetigt: Das Erneuern verlangt einen gueltigen Code. Ohne
//     das koennte jemand mit einer gekaperten Sitzung den zweiten Faktor
//     durch seinen eigenen ersetzen -- und haette den Schutz damit
//     ausgehebelt, statt ihn zu ueberwinden.
//
// Wer weder App noch Notfallcode hat, kommt hier nicht weiter. Das ist
// Absicht: Der Weg zurueck fuehrt ueber ein zweites Betreiber-Konto
// (betreiber_zf_zuruecksetzen.php), nicht ueber eine Hintertuer.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber();
$pdo = betreiber_db();
$id  = (int)$ich['id'];

if (!be_zf_tabelle_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Der Betreiber-Bereich ist noch nicht vollständig eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];

if (be_zf_ist_an($pdo, $id)) {
    $code = zf_code_normalisieren((string)($daten['code'] ?? ''));
    if ($code === '') {
        json_response(['status' => 'error',
            'message' => 'Der zweite Faktor ist bereits eingerichtet. Zum Erneuern bitte den '
                       . 'aktuellen Code aus der App oder einen Notfallcode eingeben.'], 400);
    }
    if (!be_zf_code_einloesen($pdo, $id, $code, time())) {
        json_response(['status' => 'error', 'message' => 'Der Code stimmt nicht.'], 401);
    }
}

$geheim = zf_geheimnis_erzeugen();
$pdo->prepare(
    'INSERT INTO betreiber_zwei_faktor (betreiber_id, geheim, bestaetigt_am, letztes_fenster, notfallcodes)
     VALUES (?, ?, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE geheim = VALUES(geheim), bestaetigt_am = NULL,
                             letztes_fenster = NULL, notfallcodes = NULL'
)->execute([$id, $geheim]);

json_response([
    'status'  => 'ok',
    // Die Adresse fuer den QR-Code. Der Bereichsname steht hier und nicht
    // als Firmenname im Quelltext -- was in der App erscheint, soll sagen,
    // WELCHER Zugang gemeint ist, nicht wie die Firma heisst.
    'adresse' => zf_adresse((string)$ich['email'], $geheim, 'Betreiber-Bereich'),
    'lesbar'  => zf_lesbar($geheim),
    'hinweis' => 'Erst nach der Bestätigung mit einem Code aus der App gilt der zweite Faktor.',
]);
