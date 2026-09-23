<?php
declare(strict_types=1);
// Neuerungen fuer das Update-Fenster (ENT-698).
//
// GET  ?ziel=cockpit|app  -- was diese Person noch nicht gesehen hat; im
//                            Cockpit dazu, ob eine Einrichtung aussteht und
//                            ob sie sie selbst einspielen darf.
// POST {bis: n}           -- "gelesen bis Nummer n".
//
// Kein Recht, sondern strikt eigene Daten wie tutorial_gesehen.php: Was
// jemand gelesen hat, betrifft niemand sonst. Darum steht dieser Endpunkt
// namentlich in der NUR_EIGENE_DATEN-Liste von test_php.mjs. Wer einspielen
// darf, entscheidet weiterhin darf() -- hier wird es nur mitgeteilt, damit
// das Fenster den richtigen Knopf zeigt. Eingespielt wird ueber
// planung_einrichten.php, und das verlangt betrieb_schreiben selbst.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../neuerungen.php';

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();
$methode = $_SERVER['REQUEST_METHOD'];

// Ohne die Spalte ist unbekannt, was jemand gelesen hat (siehe unten).
$spalteDa = hat_spalte($pdo, 'mitarbeiter', 'neuerungen_gesehen_bis');

if ($methode === 'POST') {
    if (!$spalteDa) {
        json_response(['status' => 'error',
            'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 400);
    }
    $in  = json_decode((string)file_get_contents('php://input'), true) ?? [];
    // Nie ueber die neueste Nummer hinaus: Sonst verschluckte ein zu hoher
    // Wert jede kuenftige Neuerung. Und nie zurueck: Ein veralteter Browser
    // soll Gelesenes nicht wieder ungelesen machen.
    $bis = max(0, min((int)($in['bis'] ?? 0), neuerungen_neueste()));
    $pdo->prepare('UPDATE mitarbeiter SET neuerungen_gesehen_bis = GREATEST(COALESCE(neuerungen_gesehen_bis, 0), ?)
                    WHERE id = ?')->execute([$bis, $ich]);
    json_response(['status' => 'ok', 'gesehen_bis' => $bis]);
}
if ($methode !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

// Das Cockpit bekommt nur, wer hinein darf -- sonst sieht jemand
// Ankuendigungen zu Bildschirmen, die er nie oeffnen kann.
$ziel = (string)($_GET['ziel'] ?? 'cockpit');
if ($ziel !== 'app' && !darf_verwaltung($user)) { $ziel = 'app'; }
if ($ziel !== 'app') { $ziel = 'cockpit'; }

$antwort = ['status' => 'ok', 'ziel' => $ziel, 'neueste' => neuerungen_neueste()];

if ($spalteDa) {
    $s = $pdo->prepare('SELECT neuerungen_gesehen_bis FROM mitarbeiter WHERE id = ?');
    $s->execute([$ich]);
    $wert = $s->fetchColumn();
    if ($wert === null || $wert === false) {
        // Neues Konto (ENT-698, Punkt 8): gilt als gelesen bis heute.
        $pdo->prepare('UPDATE mitarbeiter SET neuerungen_gesehen_bis = ? WHERE id = ? AND neuerungen_gesehen_bis IS NULL')
            ->execute([neuerungen_neueste(), $ich]);
        $gesehen = neuerungen_neueste();
    } else {
        $gesehen = (int)$wert;
    }
    $antwort['gesehen_bis'] = $gesehen;
    $antwort['neuerungen']  = neuerungen_fuer($ziel, $gesehen);
} else {
    // Die Spalte bringt erst die Einrichtung. Bis dahin ist unbekannt, was
    // jemand gelesen hat -- das Fenster zeigt dann die ganze Liste, damit
    // gerade das Update, das die Spalte bringt, nicht verschwiegen wird.
    $antwort['gesehen_bis'] = null;
    $antwort['neuerungen']  = neuerungen_fuer($ziel, 0);
    $antwort['stand_unbekannt'] = true;
}

if ($ziel === 'cockpit') {
    // Dieselbe Zaehlung, die den Punkt am Kontomenue faerbt ('ausstehend'
    // in planung_einrichten_ausfuehren) -- eine Definition, nicht zwei.
    require_once __DIR__ . '/../planung_einrichten_kern.php';
    $antwort['einrichtung_ausstehend'] = count(kern_schema_fehlend($pdo))
        + count(kern_verweise_fehlend($pdo)) + count(kern_breite_fehlend($pdo));
    $antwort['darf_einspielen'] = darf($user, 'betrieb_schreiben');
}

json_response($antwort);
