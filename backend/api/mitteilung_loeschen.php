<?php
declare(strict_types=1);
// Eine archivierte Mitteilung endgueltig loeschen (ENT-433).
//
// GETRENNT VOM ZURUECKZIEHEN, und zwar mit Absicht. Zurueckziehen
// (mitteilung_archivieren.php) nimmt eine Mitteilung aus der App und laesst
// alles stehen; hier verschwindet sie samt Lesestand aus der Datenbank.
// Zwei verschiedene Folgen brauchen zwei verschiedene Handgriffe -- ein
// Knopf, der je nach Zustand das eine oder das andere tut, waere die Sorte
// Stelle, an der ein Fehlklick den Nachweis vernichtet.
//
// DIE SPERRE STEHT HIER, NICHT IM COCKPIT (Hausregel). Geloescht werden
// darf nur, was im Archiv steht -- zurueckgezogen oder abgelaufen. Was
// gerade in der App sichtbar ist, wird abgewiesen, auch wenn jemand am
// Browser vorbei anfragt. Die Entscheidung darueber trifft
// mitteilung_im_archiv() in mitteilungen.php, damit Cockpit und Server
// dieselbe Grenze ziehen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mitteilungen.php';

$user = require_session();
require_recht($user, 'mitteilungen');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'mitteilungen')) {
    json_response(['status' => 'error', 'message' => 'Die Mitteilungen sind noch nicht eingerichtet.'], 400);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 400);
}

$st = $pdo->prepare('SELECT id, archiviert_am, sichtbar_ab, sichtbar_bis FROM mitteilungen WHERE id = ?');
$st->execute([$id]);
$m = $st->fetch();
if (!$m) {
    // "Gibt es nicht" ist etwas anderes als "darf nicht" -- und beides
    // etwas anderes als "hat nicht geklappt".
    json_response(['status' => 'error', 'message' => 'Diese Mitteilung gibt es nicht.'], 404);
}

$jetzt = date('Y-m-d H:i:s');
if (!mitteilung_im_archiv($m, $jetzt)) {
    json_response(['status' => 'error',
        'message' => 'Diese Mitteilung ist noch nicht im Archiv — gelöscht wird nur, '
                   . 'was zurückgezogen oder abgelaufen ist. Zuerst zurückziehen.'], 400);
}

// Der Lesestand geht ausdruecklich mit, und ausdruecklich hier: Auf die
// Fremdschluessel-Kaskade der Datenbank ist kein Verlass -- sie haengt an
// der Tabellenart und fehlt auf einem Server, auf dem die Tabellen einmal
// von Hand angelegt wurden. Bliebe der Lesestand stehen, waeren es Zeilen
// zu einer Mitteilung, die es nicht mehr gibt.
$anzahl = 0;
if (hat_tabelle($pdo, 'mitteilung_gelesen')) {
    $lg = $pdo->prepare('DELETE FROM mitteilung_gelesen WHERE mitteilung_id = ?');
    $lg->execute([$id]);
    $anzahl = $lg->rowCount();
}
// Die Geraete-Bilanz steht an der Mitteilung selbst (push_bilanz) und geht
// mit ihr -- kein zweiter Loeschweg noetig.
$pdo->prepare('DELETE FROM mitteilungen WHERE id = ?')->execute([$id]);

json_response(['status' => 'ok', 'id' => $id, 'lesestand_entfernt' => $anzahl]);
