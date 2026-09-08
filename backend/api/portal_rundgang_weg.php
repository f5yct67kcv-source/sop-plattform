<?php
// Kundenportal: der Weg waehrend einer Runde (ENT-474).
//
// GET ?rundgang_id=<n> -> { status, punkte, eingerichtet, aufbewahrung_tage }
//
// DIESER ENDPUNKT IST DIE AUSNAHME, NICHT DIE REGEL.
//
// ENT-441 Punkt 3 hatte die Bewegungsspur ausdruecklich aus dem Portal
// ausgeschlossen, ENT-322 aus demselben Grund aus dem Rapport: Sie gibt dem
// Kunden Aufenthaltsdaten des Mitarbeitenden. Der Projektinhaber hat das am
// 2026-09-07 revidiert (ENT-474) -- ganze Spur, aber hinter einem Knopf.
// `test_php.mjs` fuehrt genau diese eine Datei namentlich als erlaubt; ein
// ZWEITER Portal-Endpunkt, der `rundgang_position` liest, faellt dort auf.
//
// Bewusst ein eigener Endpunkt und nicht Teil von portal_rundgang_detail.php
// -- derselbe Grund wie bei rundgang_spur.php im Cockpit:
//
//   1. Datensparsamkeit. Wer eine Runde aufklappt, bekommt nicht nebenbei
//      die Aufenthaltsspur mitgeliefert. Sie kommt erst auf den Knopf.
//   2. Menge. Eine Runde traegt leicht hundert Punkte.
//
// Die kunde_id kommt aus der Sitzung, nie aus der Anfrage; die Frage "darf
// dieser Kunde diese Runde sehen" beantwortet dieselbe Stelle wie beim
// Detail- und beim Foto-Endpunkt (kp_runde_sichtbar).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$rundgangId = (int)($_GET['rundgang_id'] ?? 0);
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

// Dieselbe eine Antwort wie beim Detail: gibt es nicht / fremder Kunde /
// laeuft noch. Drei verschiedene waeren ein Auskunftsdienst darueber, welche
// Nummern vergeben sind.
$nichtAbrufbar = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Dieser Rundgang ist nicht abrufbar.'], 404);
};

if (!$objektIds) { $nichtAbrufbar(); }

$stmt = $pdo->prepare('SELECT objekt_id, status FROM rundgang WHERE id = ?');
$stmt->execute([$rundgangId]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r) { $nichtAbrufbar(); }

$laeuft = in_array((string)$r['status'], RUNDGANG_OFFENE_STATUS, true);
if (!kp_runde_sichtbar((int)$r['objekt_id'], $objektIds, $laeuft)) { $nichtAbrufbar(); }

// Die Aufbewahrungsfrist kommt aus der Konstante und nicht als Zahl in den
// Anzeigetext: Steht sie an zwei Orten, laufen die beiden auseinander, und
// dann behauptet die Oberflaeche eine Frist, die nicht gilt.
$antwort = ['status' => 'ok', 'aufbewahrung_tage' => RUNDGANG_SPUR_TAGE];

// Fehlt die Tabelle (Einrichtung nach ENT-318 nicht gelaufen), ist die
// Antwort eine LEERE Spur mit eigenem Vermerk -- nicht ein Fehler. "Noch
// nicht eingerichtet" und "es gibt keine Spur" sind verschiedene Aussagen.
if (!hat_tabelle($pdo, 'rundgang_position')) {
    json_response($antwort + ['punkte' => [], 'eingerichtet' => false]);
}

$spur = $pdo->prepare(
    'SELECT lat, lng, genauigkeit_m, erfasst_am
       FROM rundgang_position
      WHERE rundgang_id = ?
      ORDER BY erfasst_am, id'
);
$spur->execute([$rundgangId]);

json_response($antwort + [
    'punkte'       => $spur->fetchAll(PDO::FETCH_ASSOC),
    'eingerichtet' => true,
]);
