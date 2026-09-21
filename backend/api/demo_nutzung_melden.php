<?php
// Nutzungsauswertung der Demo-Plaetze (ENT-653): welcher Reiter, wie lange.
//
// NUR require_session(), kein require_recht() -- dieselbe Bauart wie
// meine_gesehen.php: Die anmeldende Person meldet ausschliesslich etwas
// ueber ihre EIGENE laufende Sitzung, keine fremden Daten. Steht darum in
// der Ausnahmeliste NUR_EIGENE_DATEN (pruefungen/test_php.mjs).
//
// SERVERSEITIG AUF DEMO-PLAETZE BESCHRAENKT (ist_demo_platz(), backend/
// db.php). Der Browser blendet den Aufruf zwar schon aus (dashboard.html
// prueft window.APP_UMGEBUNG_DEMO_PLATZ, bevor er ueberhaupt sendet), aber
// eine Sperre, die man am Browser vorbei umgehen kann, ist keine (CLAUDE.md).
// Ein echter Betrieb und die eine ENT-523-Demo-Umgebung bekommen darum
// immer 403 -- nie eine still ignorierte Zeile.
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
if (!ist_demo_platz()) {
    json_response(['status' => 'error', 'message' => 'Nur fuer Demo-Plaetze.'], 403);
}

$in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];

// Reiter-Name: derselbe kurze Bezeichner, den go(view) in dashboard.html
// schon verwendet ('uebersicht', 'kunden', 'revierdienst', ...). Bewusst
// KEINE feste Liste hier -- eine zweite, separat zu pflegende Aufzaehlung
// derselben Namen wuerde frueher oder spaeter von dashboard.html abweichen
// ("eine Definition, nicht zwei"). Stattdessen nur eine Formpruefung:
// kurz, aus denselben Zeichen wie die bestehenden view-Namen.
$reiter = (string)($in['reiter'] ?? '');
if ($reiter === '' || strlen($reiter) > 40 || !preg_match('/^[a-z0-9_-]+$/', $reiter)) {
    json_response(['status' => 'error', 'message' => 'reiter fehlt oder ungueltig.'], 422);
}

// Dauer in Sekunden, nie 0 (kein Aufruf ohne echten vorherigen Reiter) und
// nach oben gedeckelt -- ein liegen gelassener Tab soll die Statistik nicht
// mit einer einzigen Zeile von mehreren Tagen verzerren. Sechs Stunden sind
// grosszuegig genug fuer jede reale Vorfuehrung.
$dauerS = (int)($in['dauer_s'] ?? 0);
if ($dauerS < 1) {
    json_response(['status' => 'error', 'message' => 'dauer_s fehlt oder ungueltig.'], 422);
}
$dauerS = min($dauerS, 6 * 3600);

db()->prepare('INSERT INTO demo_nutzung (reiter, dauer_s) VALUES (?, ?)')
    ->execute([$reiter, $dauerS]);

json_response(['status' => 'ok']);
