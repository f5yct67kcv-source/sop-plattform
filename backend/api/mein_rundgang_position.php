<?php
// Bewegungsspur einer laufenden Runde entgegennehmen (ENT-318).
//
// Revidiert ENT-131, vom Projektinhaber entschieden und begruendet: Ohne
// laufende Ortung lassen sich Radien von 20-25 m auf kurzer Distanz nicht
// bedienen.
//
// Dieser Endpunkt ist bewusst eng gebaut, weil er den heikelsten
// Datenbestand des Werkzeugs entgegennimmt -- eine Aufenthaltsspur eines
// echten Mitarbeitenden:
//
//   - Nur die EIGENE Runde. mitarbeiter_id kommt aus der Sitzung, nie aus
//     der Anfrage.
//   - Nur eine LAUFENDE Runde. Auf einer beendeten, abgebrochenen oder
//     pausierten Runde werden Positionen abgewiesen. Das ist der Riegel
//     hinter der Zusage "wenn der Rundgang beendet wird, wird die
//     Verfolgung nicht mehr aktiv": Die App hoert von sich aus auf, aber
//     der Server verlaesst sich nicht darauf.
//   - Nur wer Revierdienst macht. Dieselbe Berechtigungsfrage wie in den
//     uebrigen mein_rundgang_*-Endpunkten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input)) {
    json_response(['status' => 'error', 'message' => 'ungueltige Anfrage'], 422);
}

$rundgangId = (int)($input['rundgang_id'] ?? 0);
$punkte     = is_array($input['positionen'] ?? null) ? $input['positionen'] : [];
if ($rundgangId <= 0 || !$punkte) {
    json_response(['status' => 'error', 'message' => 'rundgang_id und positionen erforderlich'], 422);
}

// Obergrenze je Anfrage: Nach einer langen Offline-Phase kann die
// Warteschlange gross sein. Eine Anfrage mit zehntausend Punkten waere
// weder verarbeitbar noch plausibel -- die App sendet in Haeppchen.
if (count($punkte) > 500) {
    json_response(['status' => 'error', 'message' => 'zu viele Positionen auf einmal'], 422);
}

$pdo = db();

// Fehlt die Tabelle noch (Einrichtung nicht gelaufen), ist das KEIN Fehler
// der Runde: Die Ortung ist eine Zusatzfunktion. Sie still zu verwerfen
// waere aber genauso falsch -- die App muss erfahren, dass sie die
// Warteschlange nicht endlos weiterschleppen soll.
if (!hat_tabelle($pdo, 'rundgang_position')) {
    json_response(['status' => 'error', 'code' => 'keine_tabelle',
        'message' => 'Positionen können noch nicht gespeichert werden — bitte einmal einrichten'], 409);
}

// Nur die eigene Runde -- mitarbeiter_id aus der Sitzung.
$rChk = $pdo->prepare('SELECT id, status FROM rundgang WHERE id = ? AND mitarbeiter_id = ?');
$rChk->execute([$rundgangId, (int)$user['id']]);
$rundgang = $rChk->fetch(PDO::FETCH_ASSOC);
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Dieser Rundgang gehoert nicht zu dir'], 404);
}

// Der Riegel hinter der Zusage: keine Spur ausserhalb einer laufenden Runde.
// Die App stoppt die Ortung selbst, aber ein Geraet darf nicht die einzige
// Instanz sein, die das durchsetzt -- sonst genuegte ein veraenderter
// Browser, um eine Spur ueber die ganze Schicht zu schreiben.
if ($rundgang['status'] !== 'laeuft' && $rundgang['status'] !== 'vorbereitet') {
    json_response(['status' => 'error', 'code' => 'nicht_laufend',
        'message' => 'Fuer diesen Rundgang werden keine Positionen mehr gespeichert'], 409);
}

$ein = $pdo->prepare(
    'INSERT INTO rundgang_position (rundgang_id, lat, lng, genauigkeit_m, erfasst_am)
     VALUES (?, ?, ?, ?, ?)'
);

$gespeichert = 0;
$verworfen   = 0;
foreach ($punkte as $pkt) {
    if (!is_array($pkt)) { $verworfen++; continue; }
    $lat = isset($pkt['lat']) && $pkt['lat'] !== '' ? (float)$pkt['lat'] : null;
    $lng = isset($pkt['lng']) && $pkt['lng'] !== '' ? (float)$pkt['lng'] : null;
    $am  = trim((string)($pkt['erfasst_am'] ?? ''));
    // Plausibilitaet, nicht Genauigkeit: 0/0 ist der klassische Nullpunkt
    // eines kaputten Sensors und liegt im Golf von Guinea, nicht in der
    // Schweiz. Solche Punkte in die Spur zu schreiben hiesse, eine
    // Auswertung mit Unsinn zu fuellen.
    if ($lat === null || $lng === null || $am === ''
        || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180
        || ($lat === 0.0 && $lng === 0.0)) {
        $verworfen++;
        continue;
    }
    $gen = isset($pkt['genauigkeit_m']) && $pkt['genauigkeit_m'] !== ''
        ? (int)round((float)$pkt['genauigkeit_m']) : null;
    if ($gen !== null && ($gen < 0 || $gen > 100000)) { $gen = null; }
    $ein->execute([$rundgangId, $lat, $lng, $gen, $am]);
    $gespeichert++;
}

// Alte Spuren wegraeumen (ENT-318). Bewusst hier und nicht in einem
// separaten Aufraeumlauf: Ein Loeschauftrag, den jemand von Hand starten
// muss, wird nie gestartet, und dann liegen Aufenthaltsdaten jahrelang
// herum, obwohl sie ihren Zweck laengst erfuellt haben.
//
// Die Spur dient dem Nachweis einer einzelnen Runde. Nach RUNDGANG_SPUR_TAGE
// ist dieser Zweck erfuellt -- die SCANS mit ihren Zeitstempeln bleiben
// unberuehrt und tragen den Nachweis weiter, nur die Bewegung dazwischen
// verschwindet. Das ist Datensparsamkeit an der Stelle, an der sie am
// meisten bringt.
//
// LIMIT, damit ein einzelner Aufruf nicht in eine lange Sperre laeuft: Es
// wird bei jeder Uebermittlung ein Stueck weggeraeumt, nicht alles auf
// einmal.
try {
    $pdo->prepare(
        'DELETE FROM rundgang_position
          WHERE erfasst_am < DATE_SUB(NOW(), INTERVAL ' . RUNDGANG_SPUR_TAGE . ' DAY)
          LIMIT 500'
    )->execute();
} catch (Throwable $e) {
    // Das Aufraeumen darf die Uebermittlung nicht scheitern lassen.
}

json_response(['status' => 'ok', 'gespeichert' => $gespeichert, 'verworfen' => $verworfen]);
