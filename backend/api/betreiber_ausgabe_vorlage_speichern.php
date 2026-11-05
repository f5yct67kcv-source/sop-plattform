<?php
// Eine Vorlage fuer wiederkehrende Kosten anlegen, aendern, beenden
// (ENT-725, Punkt 10).
//
// "Gilt ab": Eine Aenderung trifft die Monate ab `wirksam_ab` (YYYY-MM).
// Fruehere Monate bleiben, wie sie gebucht wurden, und eine Buchung, die
// jemand von Hand angefasst hat, bleibt ebenfalls -- auch ab `wirksam_ab`.
// Kuenftige Monate entstehen ohnehin erst, wenn sie faellig werden, und
// tragen dann den neuen Stand.
//
//   POST {...felder}                     anlegen
//   POST {id, ...felder, wirksam_ab}     aendern
//   POST {id, aktiv: 0|1}                stilllegen / wieder aufnehmen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$pdo = betreiber_db();
if (!be_aus_eingerichtet($pdo)) {
    json_response(['status' => 'error', 'message' => 'Die Ausgaben sind noch nicht eingerichtet.'], 503);
}
$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$FELDER = ['kategorie_id', 'text', 'lieferant', 'intervall', 'waehrung', 'betrag_rappen',
           'betrag_fremd_rappen', 'mwst_satz_bp', 'gueltig_ab', 'gueltig_bis'];

$vorher = null;
if ($id > 0) {
    $s = $pdo->prepare('SELECT id, aktiv, ' . implode(', ', $FELDER) . ' FROM be_ausgabe_vorlage WHERE id = ?');
    $s->execute([$id]);
    $vorher = $s->fetch(PDO::FETCH_ASSOC) ?: null;
    if ($vorher === null) {
        json_response(['status' => 'error', 'message' => 'Vorlage nicht gefunden'], 404);
    }
}

// Stilllegen: Es entstehen keine neuen Monate mehr. Bereits gebuchte
// bleiben stehen -- sie sind angefallen.
if ($vorher !== null && array_key_exists('aktiv', $in) && !array_key_exists('text', $in)) {
    $aktiv = !empty($in['aktiv']) ? 1 : 0;
    $pdo->prepare('UPDATE be_ausgabe_vorlage SET aktiv = ? WHERE id = ?')->execute([$aktiv, $id]);
    if ((int)$vorher['aktiv'] !== $aktiv) {
        be_log($pdo, $ich, 'ausgabevorlage', $id, 'zustand',
               (int)$vorher['aktiv'] ? 'aktiv' : 'stillgelegt', $aktiv ? 'aktiv' : 'stillgelegt');
    }
    if ($aktiv) { be_aus_vorlagen_buchen($pdo, date('Y-m-d')); }
    json_response(['status' => 'ok', 'id' => $id, 'aktiv' => $aktiv]);
}

$r = be_aus_vorlage_pruefen($in, be_aus_kategorien($pdo),
                            $vorher === null ? null : (int)$vorher['kategorie_id']);
if (isset($r['fehler'])) {
    json_response(['status' => 'error', 'message' => $r['fehler']], 400);
}
$felder = $r['felder'];

if ($vorher !== null) {
    $wirksamAb = (string)($in['wirksam_ab'] ?? date('Y-m'));
    if (!be_aus_monat_gueltig($wirksamAb)) {
        json_response(['status' => 'error', 'message' => 'Bitte angeben, ab welchem Monat die Änderung gilt.'], 400);
    }
    // Der Beginn bestimmt, welche Monate ueberhaupt faellig sind. Ihn
    // nachtraeglich zu verschieben, liesse frueh gebuchte Monate stehen,
    // die es nach dem neuen Beginn nicht gaebe. Dafuer wird die Vorlage
    // beendet und eine neue angelegt.
    if (substr((string)$vorher['gueltig_ab'], 0, 10) !== $felder['gueltig_ab']) {
        json_response(['status' => 'error',
            'message' => 'Der Beginn einer Vorlage lässt sich nicht verschieben. '
                       . 'Bitte die Vorlage mit einem Enddatum beenden und eine neue anlegen.'], 400);
    }
    $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($felder)));
    $pdo->prepare("UPDATE be_ausgabe_vorlage SET $satz WHERE id = ?")
        ->execute(array_merge(array_values($felder), [$id]));
    $alt = be_aus_logwerte(array_intersect_key($vorher, $felder));
    $neu = be_aus_logwerte($felder);
    be_log_vergleich($pdo, $ich, 'ausgabevorlage', $id, $alt, $neu);

    $ids = be_aus_vorlage_uebertragen($pdo, ['id' => $id] + $felder, $wirksamAb);
    foreach ($ids as $aid) {
        be_log($pdo, $ich, 'ausgabe', $aid, 'vorlage', null, 'aus Vorlage nachgeführt ab ' . $wirksamAb);
    }
    // Monate nach dem neuen Ende: Sie sind nicht mehr faellig. Nur
    // unberuehrte Buchungen werden archiviert, und nur ab wirksam_ab.
    if ($felder['gueltig_bis'] !== null) {
        $nachEnde = max(be_aus_monat_plus(substr($felder['gueltig_bis'], 0, 7), 1), $wirksamAb);
        $s = $pdo->prepare('SELECT id FROM be_ausgabe WHERE vorlage_id = ? AND periode >= ? AND von_hand = 0 AND aktiv = 1');
        $s->execute([$id, $nachEnde]);
        foreach (array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN)) as $aid) {
            $pdo->prepare('UPDATE be_ausgabe SET aktiv = 0 WHERE id = ?')->execute([$aid]);
            be_log($pdo, $ich, 'ausgabe', $aid, 'zustand', 'aktiv', 'archiviert (nach Ende der Vorlage)');
        }
    }
} else {
    $spalten = array_keys($felder);
    $pdo->prepare('INSERT INTO be_ausgabe_vorlage (' . implode(', ', $spalten) . ', aktiv) VALUES ('
        . implode(', ', array_fill(0, count($spalten), '?')) . ', 1)')
        ->execute(array_values($felder));
    $id = (int)$pdo->lastInsertId();
    be_log($pdo, $ich, 'ausgabevorlage', $id, 'angelegt', null, $felder['text']);
}

$gebucht = be_aus_vorlagen_buchen($pdo, date('Y-m-d'));
json_response(['status' => 'ok', 'id' => $id, 'gebucht' => $gebucht]);
