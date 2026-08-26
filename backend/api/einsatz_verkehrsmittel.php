<?php
// Verkehrsmittel-Ausnahme je Zuteilung (ENT-123/ENT-125).
//
// Die VORGABE steht am Mitarbeiter-Stammblatt (mitarbeiter.verkehrsmittel).
// Hier wird nur die AUSNAHME fuer EINE Person auf EINEM Einsatz gesetzt --
// fuer die Fahrgemeinschaft, die es nur diesmal gibt. Leer geraeumt heisst:
// die Vorgabe der Person gilt wieder.
//
// POST { einsatz_id, mitarbeiter_id, verkehrsmittel, oev_rappen }
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
// einsatz_sperre_pruefen() -- dieselbe Sperre wie an jedem anderen
// Schreibweg zu einer abgeglichenen Schicht (ENT-045). Der
// Auslagenersatz-Schnappschuss ist beim Abgleich bereits festgeschrieben;
// eine Ausnahme danach zu aendern wuerde ihn stillschweigend veralten lassen.
require_once __DIR__ . '/../planung.php';
require_once __DIR__ . '/../mitarbeiter.php';   // MA_VERKEHRSMITTEL

$user = require_session();
require_recht($user, 'plan');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$einsatzId = (int)($in['einsatz_id'] ?? 0);
$maId = (int)($in['mitarbeiter_id'] ?? 0);
if ($einsatzId <= 0 || $maId <= 0) {
    json_response(['status' => 'error', 'message' => 'einsatz_id und mitarbeiter_id erforderlich'], 422);
}

$s = db()->prepare('SELECT 1 FROM einsatz_zuteilung WHERE einsatz_id = ? AND mitarbeiter_id = ?');
$s->execute([$einsatzId, $maId]);
if (!$s->fetchColumn()) {
    json_response(['status' => 'error', 'message' => 'Diese Person ist auf diesem Einsatz nicht eingeteilt'], 404);
}

einsatz_sperre_pruefen(db(), $einsatzId);

$verkehrsmittel = trim((string)($in['verkehrsmittel'] ?? ''));
if ($verkehrsmittel !== '' && !in_array($verkehrsmittel, MA_VERKEHRSMITTEL, true)) {
    json_response(['status' => 'error', 'message' => 'Unbekanntes Verkehrsmittel'], 422);
}
// Nur bei "Oeffentlicher Verkehr" hat ein Billettpreis ueberhaupt eine
// Bedeutung -- fuer jedes andere Verkehrsmittel wird er verworfen, statt
// als Karteileiche stehenzubleiben und spaeter falsch gelesen zu werden.
$oevRappen = null;
if ($verkehrsmittel === 'Oeffentlicher Verkehr' && isset($in['oev_rappen']) && $in['oev_rappen'] !== '') {
    $oevRappen = (int)$in['oev_rappen'];
    if ($oevRappen < 0 || $oevRappen > 99999) {
        json_response(['status' => 'error', 'message' => 'Billettpreis zwischen 0 und 999.99 CHF'], 422);
    }
}

db()->prepare('UPDATE einsatz_zuteilung SET verkehrsmittel = ?, oev_rappen = ?
               WHERE einsatz_id = ? AND mitarbeiter_id = ?')
    ->execute([$verkehrsmittel === '' ? null : $verkehrsmittel, $oevRappen, $einsatzId, $maId]);

json_response(['status' => 'ok']);
