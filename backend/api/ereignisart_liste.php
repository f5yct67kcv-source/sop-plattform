<?php
// Katalog der Ereignisarten für die Auswahl beim Melden (ENT-295).
//
// Bewusst nur die aktiven, in ihrer Sortierung -- die App soll nicht selbst
// filtern muessen. Wer meldet, waehlt aus diesem Katalog; freier Text bleibt
// der Bemerkung vorbehalten (ENT-164: Auswahl statt Freitext, damit sich
// gleichartige Vorfaelle spaeter ueberhaupt auswerten lassen).
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'ereignisart')) {
    // Vor dem naechsten Einrichten gibt es den Katalog noch nicht. Kein
    // Fehler: Die App zeigt dann den Hinweis, dass keine Arten hinterlegt
    // sind, statt einer Fehlermeldung ohne Handlungsmoeglichkeit.
    json_response(['status' => 'ok', 'arten' => []]);
}

$stmt = $pdo->query('SELECT id, bezeichnung FROM ereignisart WHERE aktiv = 1 ORDER BY sortierung, bezeichnung');
json_response(['status' => 'ok', 'arten' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
