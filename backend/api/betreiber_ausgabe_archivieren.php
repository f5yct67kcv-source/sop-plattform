<?php
// Eine Ausgabe archivieren oder zurueckholen (ENT-725, Punkt 12).
//
// "Loeschen" heisst hier archivieren: Die Ausgabe zaehlt danach nirgends
// mehr, bleibt aber samt Logbuch und Datei nachvollziehbar. Eine aus einer
// Vorlage gebuchte Zeile kommt nach dem Archivieren nicht wieder -- der
// Monat ist belegt, nur zaehlt er nicht.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$in    = json_decode(file_get_contents('php://input'), true) ?? [];
$id    = (int)($in['id'] ?? 0);
$aktiv = !empty($in['aktiv']) ? 1 : 0;
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}
$pdo = betreiber_db();
if (!be_aus_eingerichtet($pdo)) {
    json_response(['status' => 'error', 'message' => 'Die Ausgaben sind noch nicht eingerichtet.'], 503);
}
$s = $pdo->prepare('SELECT aktiv FROM be_ausgabe WHERE id = ?');
$s->execute([$id]);
$vorher = $s->fetchColumn();
if ($vorher === false) {
    json_response(['status' => 'error', 'message' => 'Ausgabe nicht gefunden'], 404);
}
$pdo->prepare('UPDATE be_ausgabe SET aktiv = ? WHERE id = ?')->execute([$aktiv, $id]);
if ((int)$vorher !== $aktiv) {
    be_log($pdo, $ich, 'ausgabe', $id, 'zustand',
           (int)$vorher === 1 ? 'aktiv' : 'archiviert', $aktiv ? 'aktiv' : 'archiviert');
}
json_response(['status' => 'ok', 'aktiv' => $aktiv]);
