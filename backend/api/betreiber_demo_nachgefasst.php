<?php
// Einen Demo-Zugang als nachgefasst vermerken -- oder den Vermerk wieder
// zuruecknehmen (ENT-622).
//
// WARUM DAS UEBERHAUPT IM REGISTER STEHT: Das Abzeichen am Reiter im
// Betreiber-Bereich braucht einen Weg auf null. Beim Support ist das der
// Statuswechsel auf "erledigt"; ein Demo-Zugang hatte bis hierher gar
// keinen Zustand, den ein Mensch setzt -- er entsteht automatisch und
// laeuft automatisch ab. Ein Abzeichen, das einfach die laufenden Zugaenge
// zaehlt, stuende zwei Wochen am Stueck da und waere nach drei Tagen
// unsichtbar (genau die Ueberlegung, die schon ueber dem Support-Abzeichen
// in betreiber.html steht).
//
// UND ES LAESST SICH ZURUECKNEHMEN. Ein Fehlklick darf eine Verkaufschance
// nicht dauerhaft aus dem Blick nehmen -- das ist der einzige Weg, auf dem
// dieser Vermerk Schaden anrichten kann.
//
// DER VERMERK GILT AUCH FUER BEENDETE ZUGAENGE. Nachfassen heisst mit dem
// Interessenten sprechen, nicht mit seiner Instanz: Wer sich erst meldet,
// nachdem die vierzehn Tage um sind, ist deswegen kein schlechterer Kunde.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../rechte.php';

$ich = require_betreiber_voll();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')) {
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}
// "Noch nicht nachgeruestet" ist etwas anderes als "noch nie nachgefasst":
// Steht die Spalte nicht, sagt der Endpunkt das, statt stumm nichts zu tun.
// Nachgetragen wird sie von be_spalten_anlegen() (Zahnrad im
// Betreiber-Bereich), nicht hier -- Schemaarbeit gehoert an eine Stelle.
if (!hat_spalte($pdo, 'demo_zugang', 'nachgefasst_am')) {
    json_response(['status' => 'error',
        'message' => 'Das Register kennt den Vermerk „nachgefasst" noch nicht. '
            . 'Einmal die Einrichtung prüfen lassen, dann steht er.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
// Fehlt die Angabe, ist die Handlung "nachgefasst" -- das ist der Knopf,
// den es in der Oberflaeche gibt. Das Zuruecknehmen verlangt ein
// ausdrueckliches false.
$setzen = !array_key_exists('nachgefasst', $daten) || (bool)$daten['nachgefasst'];

if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Zugang?'], 400);
}

$stmt = $pdo->prepare('SELECT id, firma, nachgefasst_am FROM demo_zugang WHERE id = ?');
$stmt->execute([$id]);
$z = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$z) {
    json_response(['status' => 'error', 'message' => 'Diesen Zugang gibt es nicht.'], 404);
}

if ($setzen) {
    // Der erste Vermerk zaehlt. Ein zweiter Klick soll nicht das Datum
    // weiterschieben und damit verwischen, wann es wirklich geschah.
    if ($z['nachgefasst_am'] === null) {
        $pdo->prepare('UPDATE demo_zugang SET nachgefasst_am = NOW(), nachgefasst_von = ? WHERE id = ?')
            ->execute([(string)$ich['name'], $id]);
    }
} else {
    $pdo->prepare("UPDATE demo_zugang SET nachgefasst_am = NULL, nachgefasst_von = '' WHERE id = ?")
        ->execute([$id]);
}

json_response(['status' => 'ok', 'id' => $id, 'nachgefasst' => $setzen]);
