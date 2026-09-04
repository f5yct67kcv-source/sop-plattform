<?php
declare(strict_types=1);
// Vergibt Personalnummern an bestehende Mitarbeitende, die noch keine
// haben -- zufaellig, vierstellig (ENT-387). Wer schon eine Nummer hat,
// behaelt sie unveraendert; die Personalnummer selbst laesst sich seither
// nirgends mehr aendern (Sperre in mitarbeiter.php, ma_eingabe_lesen()).
//
// GET ist reiner Vorschaumodus (kein Schreiben) -- dieselbe Berechnung wie
// POST, damit die Oberflaeche vor der Ausfuehrung genau das zeigen kann,
// was nachher tatsaechlich passiert. Gleiches Muster wie
// mitarbeiter_zugang_migrieren.php und planung_einrichten.php.
//
// Das Recht "personal_schreiben" genuegt (anders als bei den Login-Namen):
// Die Personalnummer ist kein Anmeldemerkmal, ihre Vergabe meldet niemanden
// ab und betrifft nicht die eigene Anmeldung des Aufrufenden.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();
require_recht($user, 'personal_schreiben');
$methode = $_SERVER['REQUEST_METHOD'];
if ($methode !== 'GET' && $methode !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

if ($methode === 'GET') {
    json_response(['status' => 'ok', 'plan' => ma_personalnummer_migrationsplan(db())]);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
// Ausdrueckliche Bestaetigung im Aufruf selbst -- gleiches Muster wie beim
// Login-Namen, auch wenn hier keine Anmeldung betroffen ist: Was im
// Browser steht, ist nur Bequemlichkeit, die eigentliche Huerde steht hier.
if (($input['bestaetigt'] ?? null) !== true) {
    json_response(['status' => 'error', 'message' => 'Bestätigung erforderlich'], 400);
}

$plan = ma_personalnummer_migrieren(db(), $user);
json_response(['status' => 'ok', 'plan' => $plan]);
