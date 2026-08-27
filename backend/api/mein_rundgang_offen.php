<?php
// Der eigene, noch offene Rundgang zu einem Einsatz (ENT-180/182/145).
//
// Fuer den Wiedereinstieg: Die App haelt Rundgang-Fortschritt bewusst NICHT
// nur im Arbeitsspeicher des Browsers -- ein Reload, ein Tab-Wechsel oder ein
// Geraetewechsel mitten im Rundgang wuerde sonst den bereits erfassten Stand
// verstecken und "Rundgang starten" erneut anbieten, was mein_rundgang_starten.php
// zu Recht mit 409 ablehnt (es laeuft ja schon einer). Dieser Endpunkt sagt der
// App, ob es fuer den Einsatz bereits einen laufenden gibt, und liefert dessen
// vollstaendige Kontrollpunkt-Liste inkl. Erledigt-Status mit.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$einsatzId = isset($_GET['einsatz_id']) ? (int)$_GET['einsatz_id'] : 0;
if ($einsatzId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id erforderlich'], 422);
}

$pdo = db();

// Nur die eigene Zuteilung -- mitarbeiter_id kommt aus der Sitzung, gleiches
// Prinzip wie mein_rundgang_starten.php.
$chk = $pdo->prepare(
    'SELECT e.objekt_id FROM einsaetze e
      JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     WHERE e.id = ? AND z.mitarbeiter_id = ?'
);
$chk->execute([$einsatzId, (int)$user['id']]);
if (!$chk->fetch()) {
    json_response(['status' => 'error', 'message' => 'Dieser Einsatz gehoert nicht zu dir'], 404);
}

$r = $pdo->prepare(
    "SELECT * FROM rundgang WHERE einsatz_id = ? AND mitarbeiter_id = ?
      AND status IN ('vorbereitet','laeuft','pausiert')
      ORDER BY id DESC LIMIT 1"
);
$r->execute([$einsatzId, (int)$user['id']]);
$rundgang = $r->fetch();
if (!$rundgang) {
    json_response(['status' => 'ok', 'rundgang' => null]);
}

$objektId = (int)$rundgang['objekt_id'];
$alle = $pdo->prepare(
    'SELECT id, bezeichnung, reihenfolge, typ FROM kontrollpunkt
      WHERE objekt_id = ? AND aktiv = 1 ORDER BY reihenfolge, id'
);
$alle->execute([$objektId]);

$scans = $pdo->prepare(
    'SELECT kontrollpunkt_id, status, erfasst_am, beschreibung FROM rundgang_scan WHERE rundgang_id = ?'
);
$scans->execute([(int)$rundgang['id']]);
$erledigtNach = [];
foreach ($scans->fetchAll() as $s) {
    if ($s['kontrollpunkt_id'] !== null) {
        $erledigtNach[(int)$s['kontrollpunkt_id']] = $s;
    }
}

$rundgang['kontrollpunkte'] = array_map(function ($k) use ($erledigtNach) {
    $s = $erledigtNach[(int)$k['id']] ?? null;
    $k['id'] = (int)$k['id'];
    $k['erledigt'] = $s ? [
        'status' => $s['status'], 'erfasst_am' => $s['erfasst_am'], 'beschreibung' => $s['beschreibung'],
    ] : null;
    return $k;
}, $alle->fetchAll(PDO::FETCH_ASSOC));

json_response(['status' => 'ok', 'rundgang' => $rundgang]);
