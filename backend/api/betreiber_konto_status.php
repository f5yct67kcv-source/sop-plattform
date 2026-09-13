<?php
// Ein Betreiber-Konto aktivieren oder stilllegen (ENT-519).
//
// MIT AUSSPERRSCHUTZ. Dieselbe Falle wie OP-505 in der Verwaltung: Dort
// liess sich der letzte Verwalter deaktivieren, und danach konnte niemand
// mehr Rollen vergeben -- der Weg zurueck war phpMyAdmin. Hier waere es
// schlimmer, weil es ueber der Betreiber-Ebene keine weitere gibt, die
// jemanden wieder hereinliesse.
//
// Geloescht wird nicht: Ein stillgelegtes Konto bleibt sichtbar, damit
// nachvollziehbar ist, wer einmal Zugang hatte. `aktiv = 0` wirkt sofort,
// weil require_betreiber_voll() es in der Abfrage prueft -- eine laufende
// Sitzung muss nicht erst ablaufen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
$aktiv = $daten['aktiv'] ?? null;

if ($id <= 0 || !is_bool($aktiv)) {
    json_response(['status' => 'error',
        'message' => 'Welches Konto, und aktiv oder stillgelegt?'], 400);
}

$s = $pdo->prepare('SELECT id, name, aktiv FROM betreiber WHERE id = ?');
$s->execute([$id]);
$konto = $s->fetch(PDO::FETCH_ASSOC);
if (!$konto) {
    json_response(['status' => 'error', 'message' => 'Dieses Konto gibt es nicht.'], 404);
}

if (!$aktiv && be_konten_zahl($pdo, $id) === 0) {
    json_response(['status' => 'error',
        'message' => 'Das ist das letzte aktive Betreiber-Konto. Ohne es käme niemand mehr '
                   . 'in diesen Bereich, und es gibt keine Ebene darüber, die wieder '
                   . 'hereinlässt. Zuerst ein zweites Konto anlegen, dann dieses stilllegen.'], 409);
}

$pdo->prepare('UPDATE betreiber SET aktiv = ? WHERE id = ?')->execute([$aktiv ? 1 : 0, $id]);

// Wird ein Konto stillgelegt, verfallen seine Sitzungen sofort mit. Ohne
// das bliebe ein bereits ausgestellter Token bis zum Ablauf gueltig --
// require_betreiber_voll() prueft zwar aktiv = 1, aber der Aufraeumschritt hier
// macht aus "wirkt nicht mehr" auch "liegt nicht mehr herum".
if (!$aktiv) {
    $pdo->prepare('DELETE FROM betreiber_sessions WHERE betreiber_id = ?')->execute([$id]);
}

json_response([
    'status' => 'ok',
    'id'     => $id,
    'aktiv'  => $aktiv,
    'selbst' => $id === (int)$ich['id'],
]);
