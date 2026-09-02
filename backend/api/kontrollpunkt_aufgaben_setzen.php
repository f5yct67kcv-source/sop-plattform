<?php
// Setzt die Aufgaben EINES Kontrollpunkts auf genau die uebergebene Liste
// (ENT-300). Bewusst "setzen" statt "hinzufuegen/entfernen": Die Oberflaeche
// zeigt eine Liste mit Haken; was dort steht, ist danach der Stand. Zwei
// Endpunkte fuer An und Ab liessen sich in falscher Reihenfolge aufrufen und
// hinterliessen einen Zustand, den niemand angeklickt hat.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_verwalten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$kpId  = isset($input['kontrollpunkt_id']) ? (int)$input['kontrollpunkt_id'] : 0;
$ids   = is_array($input['aufgabe_ids'] ?? null) ? $input['aufgabe_ids'] : [];
if ($kpId <= 0) {
    json_response(['status' => 'error', 'message' => 'kontrollpunkt_id erforderlich'], 400);
}

$pdo = db();
if (!hat_tabelle($pdo, 'objekt_aufgabe') || !hat_tabelle($pdo, 'kontrollpunkt_aufgabe')) {
    json_response(['status' => 'error',
        'message' => 'Die Aufgaben-Tabellen fehlen. Einmal „Einrichtung" ausführen.'], 409);
}

$stmt = $pdo->prepare('SELECT objekt_id FROM kontrollpunkt WHERE id = ?');
$stmt->execute([$kpId]);
$objektId = $stmt->fetchColumn();
if ($objektId === false) {
    json_response(['status' => 'error', 'message' => 'Kontrollpunkt nicht gefunden'], 404);
}

// Ganzzahlen, eindeutig, und AUSSCHLIESSLICH aktive Aufgaben desselben
// Objekts. Ohne diese Pruefung liesse sich per Hand die id einer fremden
// Aufgabe schicken und ein Punkt truege eine Aufgabe aus einem anderen
// Objekt -- im Browser nicht anklickbar, ueber die Anfrage schon.
$ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($n) => $n > 0)));
$erlaubt = [];
if ($ids) {
    $platz = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT id FROM objekt_aufgabe
                           WHERE objekt_id = ? AND aktiv = 1 AND id IN ($platz)");
    $stmt->execute(array_merge([(int)$objektId], $ids));
    $erlaubt = array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}
$abgewiesen = array_values(array_diff($ids, $erlaubt));

// Reihenfolge wie uebergeben, damit die Liste im Fenster stabil bleibt.
$sortiert = array_values(array_filter($ids, fn($n) => in_array($n, $erlaubt, true)));

$pdo->beginTransaction();
try {
    $pdo->prepare('DELETE FROM kontrollpunkt_aufgabe WHERE kontrollpunkt_id = ?')->execute([$kpId]);
    if ($sortiert) {
        $ins = $pdo->prepare('INSERT INTO kontrollpunkt_aufgabe (kontrollpunkt_id, aufgabe_id, reihenfolge)
                              VALUES (?, ?, ?)');
        foreach ($sortiert as $i => $aufgabeId) {
            $ins->execute([$kpId, $aufgabeId, $i]);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

// Abgewiesene werden GENANNT, nicht verschwiegen: Eine Anfrage, die
// stillschweigend weniger tut als verlangt, ist schlimmer als ein Fehler.
json_response(['status' => 'ok', 'gesetzt' => $sortiert, 'abgewiesen' => $abgewiesen]);
