<?php
declare(strict_types=1);
// Merkt, dass eine Cockpit-Tour gesehen wurde -- steuert, ob sie beim
// naechsten Login automatisch wieder aufgeht.
//
// Kein Recht, sondern strikt eigene Daten: Was jemand am eigenen Bildschirm
// wegklickt oder abschliesst, betrifft niemand sonst. Darum steht dieser
// Endpunkt namentlich in der NUR_EIGENE_DATEN-Liste von test_php.mjs, wie
// mitteilung_antwort.php.
require __DIR__ . '/../db.php';

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
if (!hat_tabelle($pdo, 'tutorial_gesehen')) {
    json_response(['status' => 'error', 'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 400);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$tutorial = trim((string)($in['tutorial'] ?? ''));

// Feste Liste statt freier Werte: Sonst liesse sich diese Tabelle mit
// beliebigen Schluesseln fuellen, ohne dass irgendeine Tour dazu existiert.
$bekannt = ['cockpit_verwaltung'];
if (!in_array($tutorial, $bekannt, true)) {
    json_response(['status' => 'error', 'message' => 'Unbekanntes Tutorial'], 400);
}

$st = $pdo->prepare(
    'INSERT INTO tutorial_gesehen (tutorial, mitarbeiter_id, gesehen_am)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE gesehen_am = VALUES(gesehen_am)'
);
$st->execute([$tutorial, $ich, date('Y-m-d H:i:s')]);

json_response(['status' => 'ok']);
