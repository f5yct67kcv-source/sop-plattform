<?php
// Wegstrecke Anstellungsort -> Objekt festhalten (ENT-054, Art. 18 Ziff. 2).
//
// POST {objekt_id, anstellungsort_id, km, quelle?, bemerkung?}
// km leer oder null -> Eintrag wird geloescht, die Distanz gilt wieder als
// UNBEKANNT. Das ist ausdruecklich etwas anderes als 0 km: unbekannt heisst
// "nicht beurteilbar", 0 heisst "am Anstellungsort". Wer die beiden
// vermengt, laesst Mitarbeitende still ohne Entschaedigung dastehen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'objekte_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$objektId = (int)($input['objekt_id'] ?? 0);
$ortId    = (int)($input['anstellungsort_id'] ?? 0);
$rohKm    = $input['km'] ?? null;

if ($objektId <= 0 || $ortId <= 0) {
    json_response(['status' => 'error', 'message' => 'objekt_id und anstellungsort_id erforderlich'], 400);
}

if ($rohKm === null || $rohKm === '') {
    $del = db()->prepare('DELETE FROM objekt_distanz WHERE objekt_id = ? AND anstellungsort_id = ?');
    $del->execute([$objektId, $ortId]);
    json_response(['status' => 'ok', 'geloescht' => true]);
}

$km = (float)str_replace(',', '.', (string)$rohKm);
if (!is_finite($km) || $km < 0 || $km > 2000) {
    json_response(['status' => 'error', 'message' => 'Wegstrecke unplausibel'], 400);
}

// Woher die Zahl stammt, wird mitgeschrieben. An der 10-km-Grenze
// entscheidet sie ueber Geld -- da muss spaeter nachvollziehbar sein, ob
// sie jemand eingetippt oder ein Dienst geliefert hat.
$quelle = trim((string)($input['quelle'] ?? 'manuell')) ?: 'manuell';
$bemerkung = trim((string)($input['bemerkung'] ?? '')) ?: null;
$wer = (string)($user['name'] ?? '');

$stmt = db()->prepare(
    'INSERT INTO objekt_distanz (objekt_id, anstellungsort_id, km, quelle, ermittelt_am, bestaetigt_von, bemerkung)
     VALUES (?, ?, ?, ?, CURDATE(), ?, ?)
     ON DUPLICATE KEY UPDATE km = VALUES(km), quelle = VALUES(quelle),
        ermittelt_am = VALUES(ermittelt_am), bestaetigt_von = VALUES(bestaetigt_von),
        bemerkung = VALUES(bemerkung)'
);
$stmt->execute([$objektId, $ortId, $km, $quelle, $wer, $bemerkung]);

json_response(['status' => 'ok', 'km' => $km, 'quelle' => $quelle]);
