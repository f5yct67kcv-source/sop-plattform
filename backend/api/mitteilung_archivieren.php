<?php
declare(strict_types=1);
// Eine Mitteilung zurueckziehen oder wieder aufnehmen (ENT-421).
//
// ARCHIVIEREN, NICHT LOESCHEN -- dieselbe Haltung wie bei den Belegen
// (beleg_archivieren.php) und den Kunden: Wer den Lesestand nachweisen will,
// braucht die Mitteilung selbst noch. Eine geloeschte Mitteilung nimmt die
// Zeilen in mitteilung_gelesen mit (ON DELETE CASCADE) und damit den
// Nachweis, dass sie jemand gesehen hat.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'mitteilungen_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'mitteilungen')) {
    json_response(['status' => 'error', 'message' => 'Die Mitteilungen sind noch nicht eingerichtet.'], 400);
}

$in  = json_decode(file_get_contents('php://input'), true) ?? [];
$id  = (int)($in['id'] ?? 0);
// Ohne Angabe wird archiviert. "zurueck" holt sie wieder hervor -- ein
// versehentliches Zurueckziehen soll kein Neutippen erzwingen.
$zurueck = !empty($in['zurueck']);

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$st = $pdo->prepare('UPDATE mitteilungen SET archiviert_am = ? WHERE id = ?');
$st->execute([$zurueck ? null : date('Y-m-d H:i:s'), $id]);
if ($st->rowCount() === 0) {
    // rowCount 0 heisst hier BEIDES: gibt es nicht, oder steht schon so.
    // Der zweite Fall ist kein Fehler -- darum wird nachgesehen, statt zu
    // raten.
    $da = $pdo->prepare('SELECT 1 FROM mitteilungen WHERE id = ?');
    $da->execute([$id]);
    if (!$da->fetchColumn()) {
        json_response(['status' => 'error', 'message' => 'Diese Mitteilung gibt es nicht.'], 404);
    }
}

json_response(['status' => 'ok', 'id' => $id, 'archiviert' => !$zurueck]);
