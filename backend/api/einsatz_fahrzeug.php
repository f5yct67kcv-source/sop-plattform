<?php
// Dienstfahrzeug und Fahrer an einem bestehenden Einsatz (ENT-328).
//
// POST { einsatz_id, fahrzeug_id, fahrer_id }
// Leer geraeumtes fahrzeug_id nimmt beides zurueck -- ein Fahrer ohne
// Fahrzeug ist keine Angabe.
//
// WARUM EIN EIGENER ENDPUNKT neben einsatz_save.php: Im Einsatzplan wird ein
// Fahrzeug nachtraeglich zugeteilt, ohne dass der ganze Einsatz gespeichert
// wird -- genau wie beim Verkehrsmittel (einsatz_verkehrsmittel.php). Der
// ganze Einsatz durch die Anlegen-Ansicht zu schicken, nur um ein Fahrzeug zu
// setzen, wuerde jedes dort fehlende Feld ueberschreiben.
//
// Die PRUEFUNG ist trotzdem dieselbe: einsatz_fahrzeug_pruefen() in
// planung.php. Zwei Endpunkte mit zwei eigenen Regeln waeren zwei Wahrheiten
// darueber, welche Kombination zulaessig ist.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
// einsatz_sperre_pruefen(): dieselbe Sperre wie an jedem anderen Schreibweg
// zu einer abgeglichenen Schicht (ENT-045). Hier besonders wichtig -- am
// Fahrer haengt der Fahrkostenersatz, und der ist beim Abgleich bereits als
// Schnappschuss festgeschrieben (einsatz_abgleich.php).
require_once __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'plan');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$einsatzId = (int)($in['einsatz_id'] ?? 0);
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id erforderlich'], 422);
}

$pdo = db();
if (!hat_spalte($pdo, 'einsaetze', 'fahrzeug_id')) {
    // Nicht eingerichtet ist etwas anderes als "kein Fahrzeug zugeteilt": Im
    // ersten Fall kann niemand eines zuteilen, im zweiten hat es nur noch
    // niemand getan.
    json_response(['status' => 'error', 'message' =>
        'Die Einrichtung für Dienstfahrzeuge ist noch nicht gelaufen.'], 422);
}

$alt = $pdo->prepare('SELECT fahrzeug_id, fahrer_id FROM einsaetze WHERE id = ?');
$alt->execute([$einsatzId]);
$altZeile = $alt->fetch(PDO::FETCH_ASSOC);
if (!$altZeile) {
    json_response(['status' => 'error', 'message' => 'Einsatz nicht gefunden'], 404);
}
$bisherFahrzeugId = $altZeile['fahrzeug_id'] === null ? null : (int)$altZeile['fahrzeug_id'];
$bisherFahrerId   = $altZeile['fahrer_id'] === null ? null : (int)$altZeile['fahrer_id'];

einsatz_sperre_pruefen($pdo, $einsatzId);

// Die aktuelle Zuteilung ist der Massstab fuer den Fahrer -- hier gibt es,
// anders als in einsatz_save.php, keine neue Liste.
$zst = $pdo->prepare('SELECT mitarbeiter_id FROM einsatz_zuteilung WHERE einsatz_id = ?');
$zst->execute([$einsatzId]);
$zuteilung = array_map('intval', $zst->fetchAll(PDO::FETCH_COLUMN));

$fahrzeugId = ($in['fahrzeug_id'] ?? '') === '' ? null : (int)$in['fahrzeug_id'];
$fahrerId   = ($in['fahrer_id'] ?? '')   === '' ? null : (int)$in['fahrer_id'];
$geprueft = einsatz_fahrzeug_pruefen($pdo, $fahrzeugId, $fahrerId, $zuteilung, $bisherFahrzeugId);

$pdo->beginTransaction();
try {
    $pdo->prepare('UPDATE einsaetze SET fahrzeug_id = ?, fahrer_id = ? WHERE id = ?')
        ->execute([$geprueft['fahrzeug_id'], $geprueft['fahrer_id'], $einsatzId]);
    einsatz_fahrer_verkehrsmittel_setzen($pdo, $einsatzId, $geprueft['fahrer_id'], $bisherFahrerId);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok'] + $geprueft);
