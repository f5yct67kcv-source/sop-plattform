<?php
// Einen Demo-Zugang vorzeitig beenden (ENT-600).
//
// Beenden heisst hier dasselbe wie Ablaufen: Konto weg, Instanz geleert,
// Platz frei. Ein Beenden, das nur den Status im Register umstellt, liesse
// die Daten des Interessenten in der Instanz liegen -- und der nächste auf
// diesem Platz hätte sie vor Augen. Genau das verhindert ENT-600.
//
// DAS LEEREN GESCHIEHT ZUERST. Andersherum stünde der Zugang auf "beendet"
// und die Instanz wäre noch voll; der Platz gälte als frei und die nächste
// Freigabe liefe auf fremde Daten. Scheitert das Leeren, bleibt der Zugang
// aktiv und der Betreiber sieht den Fehler -- ein belegter Platz ist ein
// kleineres Übel als ein freigegebener mit fremden Daten darin.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_instanz.php';

require_betreiber_voll();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang')) {
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Zugang?'], 400);
}

$stmt = $pdo->prepare('SELECT * FROM demo_zugang WHERE id = ?');
$stmt->execute([$id]);
$z = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$z) {
    json_response(['status' => 'error', 'message' => 'Diesen Zugang gibt es nicht.'], 404);
}
if ($z['status'] !== 'aktiv') {
    // Schon beendet ist kein Fehler, aber auch kein zweiter Lauf: Ein
    // erneutes Leeren träfe die Instanz des NÄCHSTEN Interessenten.
    json_response(['status' => 'ok', 'schon' => true,
        'message' => 'Dieser Zugang war bereits beendet.']);
}

$fehler = demo_instanz_leeren($pdo, (string)$z['platz']);
if ($fehler !== null) {
    json_response(['status' => 'error', 'message' => $fehler], 503);
}

$pdo->prepare("UPDATE demo_zugang SET status = 'beendet', beendet_am = NOW() WHERE id = ?")
    ->execute([$id]);

json_response(['status' => 'ok', 'id' => $id, 'platz' => $z['platz']]);
