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
// Ein unbekannter Name antwortet NICHT mit 404: Wer dieses Recht traegt,
// koennte sonst per Namensraten durchprobieren, wer im Betrieb ueberhaupt
// als Mitarbeiter gefuehrt wird -- unabhaengig davon, ob er sonst irgendein
// Recht auf Personendaten hat (Security-Audit Lauf 2, ENT-577/ENT-578,
// Restpunkt "Informationslecke"). Die Oberflaeche fragt ohnehin nie einen
// frei getippten Namen ab, sondern immer den einer bereits offenen,
// bereits berechtigten Personalakte (mdVerlauf() in dashboard.html) -- ein
// unbekannter Name kommt praktisch nur durch einen manuell gebauten Aufruf
// vor, nie durch die App selbst.
$gefunden = true;
if ($name !== '') {
    $s = $pdo->prepare('SELECT id FROM mitarbeiter WHERE name = ?');
    $s->execute([$name]);
    $id = (int)$s->fetchColumn();
    $gefunden = $id > 0;
}

$grenze    = (int)($_GET['grenze'] ?? 200);
// Ein unbekannter Name liefert einen leeren Verlauf -- ungefiltert abfragen
// wuerde stattdessen in den "alle Personen"-Zweig fallen (logbuch_lesen()
// behandelt jede Zahl <= 0 gleich), und damit MEHR preisgeben als gefragt.
$eintraege = $gefunden ? logbuch_lesen($pdo, 'mitarbeiter', $id, $grenze) : [];

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
