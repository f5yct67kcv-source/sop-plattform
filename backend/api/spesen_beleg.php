<?php
declare(strict_types=1);
// Liefert den Beleg eines Speseneintrags an die Verwaltung aus (ENT-413).
//
// Getrennt von meine_spesen_beleg.php, obwohl beide dasselbe Byte-Feld
// ausliefern: Der eine Endpunkt ist auf die eigene Person begrenzt und
// steht darum in NUR_EIGENE_DATEN, der andere prueft ein Recht. Ein
// gemeinsamer Endpunkt haette beide Wege in einer Datei -- und stuende dann
// in der Ausnahmeliste, womit die Rechtepruefung des Verwaltungswegs von
// test_php.mjs nicht mehr geprueft wuerde.
//
// Ein Beleg im Zustand 'erfasst' wird hier NICHT herausgegeben: Er liegt
// noch in der Mappe der Person. Die Freigabe zum Ansehen entsteht mit dem
// Einreichen, nicht mit dem Recht.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../spesen.php';

$user = require_session();
require_recht($user, 'personal_schreiben');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 422);
}

$pdo = db();
if (!hat_tabelle($pdo, 'spesen')) {
    json_response(['status' => 'error', 'message' => 'nicht gefunden'], 404);
}

$stmt = $pdo->prepare("SELECT beleg, beleg_mime FROM spesen WHERE id = ? AND status <> 'erfasst'");
$stmt->execute([$id]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r || $r['beleg'] === null || $r['beleg_mime'] === null) {
    json_response(['status' => 'error', 'message' => 'Zu diesem Eintrag gibt es keinen Beleg'], 404);
}

spesen_beleg_kopfzeilen($r['beleg_mime'], strlen($r['beleg']), 'Beleg-' . $id);
echo $r['beleg'];
