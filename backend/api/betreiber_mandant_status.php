<?php
// Status eines Mandanten setzen: aktiv, gesperrt, gekuendigt (ENT-519).
//
// Eigener Endpunkt und nicht Teil der Sammel-Speicherung: Der Status ist
// eine Vertragsaussage, keine Stammdatenpflege. "gekuendigt" zieht spaeter
// Fristen und einen Datenexport nach sich (siehe betreiber-adminbereich.md,
// Abschnitt 5) -- das soll nicht nebenbei in einem Formular passieren, in
// dem jemand eigentlich die Adresse korrigiert.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$daten  = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id     = (int)($daten['id'] ?? 0);
$status = (string)($daten['status'] ?? '');

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!be_mandant_status_gueltig($status)) {
    json_response(['status' => 'error',
        'message' => 'Unbekannter Status. Möglich sind: ' . implode(', ', BE_STATUS) . '.'], 400);
}

$stmt = $pdo->prepare('UPDATE mandant SET status = ?, geaendert_am = NOW() WHERE id = ?');
$stmt->execute([$status, $id]);

$da = (int)$pdo->query('SELECT COUNT(*) FROM mandant WHERE id = ' . $id)->fetchColumn();
if ($da === 0) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}

json_response(['status' => 'ok', 'id' => $id, 'neuer_status' => $status]);
