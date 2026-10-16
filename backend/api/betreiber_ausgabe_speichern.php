<?php
// Eine Ausgabe erfassen oder aendern (ENT-725, Punkte 7 und 12).
//
// Jede Aenderung steht im Logbuch, alt und neu als lesbare Werte. Eine aus
// einer Vorlage gebuchte Zeile wird beim ersten Aendern "von Hand" -- eine
// spaetere Vorlagenaenderung laesst sie danach in Ruhe.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$pdo = betreiber_db();
if (!be_aus_eingerichtet($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Die Ausgaben sind noch nicht eingerichtet. Bitte zuerst die Einrichtung ausführen.'], 503);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$FELDER = ['datum', 'periode', 'kategorie_id', 'text', 'lieferant', 'waehrung',
           'betrag_rappen', 'betrag_fremd_rappen', 'mwst_satz_bp'];

$vorher = null;
if ($id > 0) {
    $s = $pdo->prepare('SELECT ' . implode(', ', $FELDER) . ', von_hand, vorlage_id FROM be_ausgabe WHERE id = ?');
    $s->execute([$id]);
    $vorher = $s->fetch(PDO::FETCH_ASSOC) ?: null;
    if ($vorher === null) {
        json_response(['status' => 'error', 'message' => 'Ausgabe nicht gefunden'], 404);
    }
}

$r = be_aus_ausgabe_pruefen($in, be_aus_kategorien($pdo),
                            $vorher === null ? null : (int)$vorher['kategorie_id']);
if (isset($r['fehler'])) {
    json_response(['status' => 'error', 'message' => $r['fehler']], 400);
}
$felder = $r['felder'];

// Eine Buchung aus einer Vorlage bleibt in ihrem Monat. Wanderte sie, buchte
// be_aus_vorlagen_buchen() den frei gewordenen Monat beim naechsten Lesen
// ein zweites Mal -- die Kosten stuenden doppelt da.
if ($vorher !== null && $vorher['vorlage_id'] !== null && $felder['periode'] !== (string)$vorher['periode']) {
    json_response(['status' => 'error',
        'message' => 'Diese Ausgabe stammt aus einer Vorlage und bleibt in ihrem Monat. '
                   . 'Für einen anderen Monat bitte das Datum innerhalb desselben Monats wählen.'], 400);
}

if ($vorher !== null) {
    $alt = be_aus_logwerte(array_intersect_key($vorher, $felder));
    $neu = be_aus_logwerte($felder);
    // Nur eine tatsaechliche Aenderung macht eine Vorlagenzeile "von Hand".
    // Ein Speichern ohne Unterschied soll sie nicht der Vorlage entziehen.
    $vonHand = (int)$vorher['von_hand'] === 1 || $alt != $neu ? 1 : 0;
    $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($felder)));
    $pdo->prepare("UPDATE be_ausgabe SET $satz, von_hand = ? WHERE id = ?")
        ->execute(array_merge(array_values($felder), [$vonHand, $id]));
    be_log_vergleich($pdo, $ich, 'ausgabe', $id, $alt, $neu);
    if ((int)$vorher['von_hand'] === 0 && $vonHand === 1) {
        be_log($pdo, $ich, 'ausgabe', $id, 'von_hand', 'aus Vorlage', 'von Hand geändert');
    }
} else {
    $spalten = array_keys($felder);
    $pdo->prepare('INSERT INTO be_ausgabe (' . implode(', ', $spalten) . ', von_hand, aktiv) VALUES ('
        . implode(', ', array_fill(0, count($spalten), '?')) . ', 1, 1)')
        ->execute(array_values($felder));
    $id = (int)$pdo->lastInsertId();
    be_log($pdo, $ich, 'ausgabe', $id, 'angelegt', null, $felder['text']);
}

json_response(['status' => 'ok', 'id' => $id]);
