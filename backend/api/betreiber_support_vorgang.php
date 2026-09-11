<?php
// Der Arbeitsvorrat des Betreibers (ENT-538).
//
// Die Gegenseite von api/support_anfrage.php: Dort schildert ein Betrieb
// sein Anliegen, hier wird es abgearbeitet.
//
// LIEFERT KEINE BETRIEBSDATEN. Was hier steht, hat der Mandant selbst
// geschrieben -- Betreff, Schilderung und der Kontext, den die Oberfläche
// mitgeschickt hat (Bildschirm, Version, Rolle des Meldenden). Kein
// Personal, keine Einsätze, keine Löhne. Wer in die Anlage sehen will,
// braucht weiterhin die Support-Freigabe des Mandanten
// (api/betreiber_support.php, ENT-526) -- ein Vorgang regt sie an, er
// ersetzt sie nicht und erteilt sie nicht.
//
// GET             -> Vorrat über alle Mandanten
// GET ?id=…       -> ein Vorgang mit Verlauf
// POST { id, text }    -> antworten (setzt Status auf 'wartet_auf_kunde')
// POST { id, status }  -> Status von Hand setzen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../supportvorgang.php';

$betreiber = require_betreiber_voll();
$pdo = betreiber_db();

if (!sv_tabellen_da($pdo)) {
    // 503 und nicht "keine Vorgänge": Nicht eingerichtet ist etwas anderes
    // als leer, und der Unterschied entscheidet, was zu tun ist.
    json_response(['status' => 'error', 'lage' => 'nicht_eingerichtet',
        'message' => 'Der Supportkanal ist noch nicht eingerichtet. '
                   . 'Einmal die Einrichtung des Betreiber-Bereichs ausführen.'], 503);
}

if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $id = (int)($_GET['id'] ?? 0);
    if ($id > 0) {
        $vorgang = sv_detail($pdo, $id);
        if ($vorgang === null) {
            json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
        }
        json_response(['status' => 'ok', 'vorgang' => $vorgang,
                       'nachrichten' => sv_nachrichten($pdo, $id)]);
    }

    // Die Mandantennamen kommen aus EINER Abfrage dazu, nicht je Zeile --
    // und der Vorrat bleibt lesbar, wenn ein Mandant gelöscht wurde: Dann
    // steht dort "unbekannter Mandant" und nicht nichts.
    $namen = [];
    if (hat_tabelle($pdo, 'mandant')) {
        foreach ($pdo->query('SELECT id, name FROM mandant')->fetchAll(PDO::FETCH_ASSOC) ?: [] as $m) {
            $namen[(int)$m['id']] = (string)$m['name'];
        }
    }

    $liste = array_map(static function (array $v) use ($namen): array {
        $v['id']        = (int)$v['id'];
        $v['mandant_id']= (int)$v['mandant_id'];
        $v['mandant']   = $namen[$v['mandant_id']] ?? 'Unbekannter Mandant';
        $v['art_wort']  = sv_art_wort((string)$v['art']);
        $v['status_wort'] = sv_status_wort((string)$v['status']);
        return $v;
    }, sv_liste($pdo));

    json_response([
        'status'    => 'ok',
        'lage'      => 'ok',
        'vorgaenge' => $liste,
        'offen'     => sv_zaehler_offen($pdo),
        'status_liste' => SV_STATUS,
    ]);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id = (int)($daten['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Kein Vorgang angegeben.'], 400);
}

// Status von Hand setzen.
if (isset($daten['status'])) {
    $status = (string)$daten['status'];
    if (!sv_status_gueltig($status)) {
        json_response(['status' => 'error', 'message' => 'Diesen Status gibt es nicht.'], 400);
    }
    if (!sv_status_setzen($pdo, $id, $status)) {
        json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
    }
    json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status,
                   'offen' => sv_zaehler_offen($pdo)]);
}

// Antworten.
$text = trim((string)($daten['text'] ?? ''));
if ($text === '') {
    json_response(['status' => 'error', 'message' => 'Bitte etwas schreiben.'], 400);
}

// Wer antwortet, kommt aus der Sitzung -- nie aus der Anfrage.
$wer = trim((string)($betreiber['name'] ?? 'Support'));
$neu = sv_antwort($pdo, $id, 'betreiber', $wer, $text);
if ($neu === null) {
    json_response(['status' => 'error', 'message' => 'Diesen Vorgang gibt es nicht.'], 404);
}

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $neu,
               'nachrichten' => sv_nachrichten($pdo, $id),
               'offen' => sv_zaehler_offen($pdo)]);
