<?php
// Verlauf einer Personalakte oder des ganzen Personalstamms (ENT-077).
//
// GET ?name=...   -> der Verlauf dieser einen Person
// GET             -> der Verlauf aller Personen (Betriebssicht)
//
// Bewusst nur lesend. Ein Logbuch, aus dem sich Eintraege entfernen lassen,
// waere keines -- darum gibt es hier weder POST noch DELETE, auch nicht
// fuer die Verwaltung.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
// Das Logbuch sagt, wer wann welche Personendaten angefasst hat. Das ist
// selbst wieder eine Auskunft ueber Personen -- darum das Recht "rechte",
// nicht blosses "personal_lesen".
require_recht($user, 'logbuch_lesen');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo  = db();
$name = trim((string)($_GET['name'] ?? ''));
$id   = 0;
if ($name !== '') {
    $s = $pdo->prepare('SELECT id FROM mitarbeiter WHERE name = ?');
    $s->execute([$name]);
    $id = (int)$s->fetchColumn();
    if ($id === 0) {
        json_response(['status' => 'error', 'message' => 'Mitarbeitende(r) nicht gefunden'], 404);
    }
}

$grenze    = (int)($_GET['grenze'] ?? 200);
$eintraege = logbuch_lesen($pdo, 'mitarbeiter', $id, $grenze);

json_response([
    'status'    => 'ok',
    // Ohne die Tabelle gibt es keine Eintraege -- das ist etwas anderes als
    // "es ist nichts passiert". Die Oberflaeche muss den Unterschied
    // hinschreiben koennen, sonst sieht eine fehlende Einrichtung aus wie
    // ein sauberer Verlauf.
    'eingerichtet' => logbuch_tabelle_da($pdo),
    'eintraege'    => $eintraege,
    'grenze'       => $grenze,
    // Wurde die Liste abgeschnitten? Eine stillschweigend gekuerzte Liste
    // liest sich wie eine vollstaendige.
    'gekuerzt'     => count($eintraege) >= $grenze,
]);
