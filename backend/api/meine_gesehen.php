<?php
// Die eingeteilte Person hat ihre Schicht in der App geoeffnet (ENT-113).
//
// Gestempelt wird beim Oeffnen der Schicht, nicht beim Laden der Liste: Das
// Auge in der Planung soll "hat hineingeschaut" heissen und nicht "die App
// war offen". Vom Projektinhaber so entschieden.
//
// Der Zeitstempel wird nur EINMAL gesetzt -- er haelt fest, wann die Schicht
// zum ersten Mal geoeffnet wurde. Ein spaeteres Ueberschreiben wuerde die
// Aussage verwaessern: "zuletzt angesehen" beantwortet eine andere Frage.
//
// Bewusst ohne Wirkung auf die Zusage: Ansehen ist kein Zusagen.
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$einsatzId = (int)($in['einsatz_id'] ?? 0);
if (!$einsatzId) {
    json_response(['status' => 'error', 'message' => 'einsatz_id fehlt.'], 422);
}

// Nur die eigene Zuteilung. Die mitarbeiter_id kommt aus der Sitzung und
// NICHT aus dem Rumpf -- sonst liesse sich fuer andere quittieren.
$s = db()->prepare(
    'UPDATE einsatz_zuteilung SET gesehen_am = NOW()
      WHERE einsatz_id = ? AND mitarbeiter_id = ? AND gesehen_am IS NULL'
);
$s->execute([$einsatzId, (int)$user['id']]);

json_response(['status' => 'ok']);
