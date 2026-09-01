<?php
// Die eigenen Stammdaten (ENT-023). Nur lesend.
//
// Ob Mitarbeitende ihre Stammdaten selbst aendern duerfen, ist offen (OP-21).
// Bis das entschieden ist, gibt es hier bewusst kein Schreiben.
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();

$stmt = db()->prepare(
    'SELECT name, ist_admin, personalnummer, anrede, vorname, nachname, geburtsdatum,
            strasse, ort, telefon, mobil, email, erstellt_am, revierdienst_berechtigt
     FROM mitarbeiter WHERE id = ?'
);
$stmt->execute([(int)$user['id']]);
$m = $stmt->fetch();
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Konto nicht gefunden'], 404);
}
$m['ist_admin'] = (bool)$m['ist_admin'];
// Steuert seit ENT-284, ob der Waechter-Reiter in der App erscheint
// (waechterSichtbar()) -- bewusst gesetzte Berechtigung statt Herleitung
// aus der Schicht-Historie.
$m['revierdienst_berechtigt'] = (bool)$m['revierdienst_berechtigt'];

// Die frueher hier gerechnete Monatssumme aus den Rapporten ist mit ENT-049
// entfallen. Grund (vom Projektinhaber): Der Rapport kennt die tatsaechliche
// Pausenabrechnung noch nicht -- die entsteht erst im Abgleich. Zwei
// Stundenzahlen fuer denselben Monat waeren fuer Mitarbeitende nicht
// aufloesbar gewesen. Massgeblich ist die abgeglichene Schichtzeit; sie
// kommt aus meine_schichten.php.
json_response([
    'status' => 'ok',
    'profil' => $m,
]);
