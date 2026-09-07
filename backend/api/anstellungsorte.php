<?php
// Vertraglich vereinbarte Anstellungsorte nach Art. 18 Ziff. 2 (ENT-054).
//
// GET   -> Liste
// POST  -> anlegen/aendern ({id?, bezeichnung, rolle, strasse, plz, ort,
//          km_zum_anderen?, aktiv, bemerkung}) oder loeschen ({id, loeschen:true})
//
// Der GAV laesst HOECHSTENS ZWEI Anstellungsorte zu, davon genau einen als
// Hauptanstellungsort. Beides wird hier durchgesetzt und nicht der Disziplin
// des Bedienenden ueberlassen: Ein zweiter HAO waere kein Schoenheitsfehler,
// sondern wuerde die ganze Zonenrechnung auf einen falschen Messpunkt stellen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
// Lesen darf, wer die Personalakte sieht -- der Anstellungsort steht dort
// und waere sonst eine leere Zeile. Aendern ist eine Betriebseinstellung
// und wird weiter unten getrennt geprueft (ENT-077).
require_recht($user, 'personal_lesen');

function orte_lesen(): array {
    $rows = db()->query(
        'SELECT id, bezeichnung, rolle, strasse, plz, ort, km_zum_anderen, aktiv, bemerkung
         FROM anstellungsorte ORDER BY rolle, bezeichnung'
    )->fetchAll();
    return array_map(function ($r) {
        $r['id'] = (int)$r['id'];
        $r['aktiv'] = (int)$r['aktiv'];
        $r['km_zum_anderen'] = $r['km_zum_anderen'] === null ? null : (float)$r['km_zum_anderen'];
        return $r;
    }, $rows);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    json_response(['status' => 'ok', 'orte' => orte_lesen()]);
}
require_recht($user, 'betrieb_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = isset($input['id']) ? (int)$input['id'] : 0;

if (!empty($input['loeschen'])) {
    if ($id <= 0) {
        json_response(['status' => 'error', 'message' => 'id fehlt'], 400);
    }
    // Die hinterlegten Wegstrecken haengen an diesem Ort und verlieren ohne
    // ihn jeden Sinn -- sie werden mitgeloescht, nicht verwaist stehengelassen.
    $del = db()->prepare('DELETE FROM objekt_distanz WHERE anstellungsort_id = ?');
    $del->execute([$id]);
    $del = db()->prepare('DELETE FROM anstellungsorte WHERE id = ?');
    $del->execute([$id]);
    json_response(['status' => 'ok', 'orte' => orte_lesen()]);
}

$bezeichnung = trim((string)($input['bezeichnung'] ?? ''));
$rolle       = strtolower(trim((string)($input['rolle'] ?? 'hao')));
$strasse     = trim((string)($input['strasse'] ?? ''));
$plz         = trim((string)($input['plz'] ?? '')) ?: null;
$ort         = trim((string)($input['ort'] ?? ''));
$aktiv       = !empty($input['aktiv']) ? 1 : 0;
$bemerkung   = trim((string)($input['bemerkung'] ?? '')) ?: null;
$kmAnderer   = ($input['km_zum_anderen'] ?? '') === '' || $input['km_zum_anderen'] === null
    ? null : (float)$input['km_zum_anderen'];

if ($bezeichnung === '' || $ort === '') {
    json_response(['status' => 'error', 'message' => 'Bezeichnung und Ort erforderlich'], 400);
}
// Der PAKO-Kommentar zu Art. 18 Abs. 2 ist hier ausdruecklich: Anstellungsorte
// muessen "mit genauer Adresse (Strassen, Nr.)" definiert sein, "ein Parkplatz
// ohne Adresse ist als vertraglich definierter Anstellungsort nicht zulaessig".
if ($strasse === '') {
    json_response([
        'status' => 'error',
        'message' => 'Strasse und Nummer sind erforderlich. Der GAV verlangt eine genaue Adresse (Art. 18 Ziff. 2, PAKO-Kommentar).',
    ], 400);
}
if ($rolle !== 'hao' && $rolle !== 'nao') {
    json_response(['status' => 'error', 'message' => 'Rolle muss hao oder nao sein'], 400);
}
if ($kmAnderer !== null && ($kmAnderer < 0 || $kmAnderer > 2000)) {
    json_response(['status' => 'error', 'message' => 'Wegstrecke unplausibel'], 400);
}

// Hoechstens zwei Anstellungsorte, hoechstens ein HAO -- Art. 18 Ziff. 2.
$vorhanden = orte_lesen();
$andere = array_values(array_filter($vorhanden, fn($o) => $o['id'] !== $id));
if ($id <= 0 && count($andere) >= 2) {
    json_response([
        'status' => 'error',
        'message' => 'Der GAV laesst hoechstens zwei Anstellungsorte zu (Art. 18 Ziff. 2).',
    ], 400);
}
if ($rolle === 'hao') {
    foreach ($andere as $o) {
        if ($o['rolle'] === 'hao') {
            json_response([
                'status' => 'error',
                'message' => 'Es kann nur einen Hauptanstellungsort geben. Der zweite Ort ist als Nebenanstellungsort (NAO) zu bezeichnen (Art. 18 Ziff. 2).',
            ], 400);
        }
    }
}

if ($id > 0) {
    $stmt = db()->prepare(
        'UPDATE anstellungsorte SET bezeichnung = ?, rolle = ?, strasse = ?, plz = ?, ort = ?,
                km_zum_anderen = ?, aktiv = ?, bemerkung = ? WHERE id = ?'
    );
    $stmt->execute([$bezeichnung, $rolle, $strasse, $plz, $ort, $kmAnderer, $aktiv, $bemerkung, $id]);
} else {
    $stmt = db()->prepare(
        'INSERT INTO anstellungsorte (bezeichnung, rolle, strasse, plz, ort, km_zum_anderen, aktiv, bemerkung)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$bezeichnung, $rolle, $strasse, $plz, $ort, $kmAnderer, $aktiv, $bemerkung]);
    $id = (int)db()->lastInsertId();
}

// Die Wegstrecke zwischen den beiden Orten ist zwangslaeufig dieselbe, egal
// von welchem aus man sie eintraegt. Sie hier gleich mitzufuehren erspart
// eine widerspruechliche zweite Eingabe -- und der Wert entscheidet nach
// Ziff. 3.2/3.3 darueber, ob im Nebenanstellungsgebiet ueberhaupt etwas
// geschuldet ist.
if ($kmAnderer !== null) {
    $up = db()->prepare('UPDATE anstellungsorte SET km_zum_anderen = ? WHERE id <> ?');
    $up->execute([$kmAnderer, $id]);
}

json_response(['status' => 'ok', 'id' => $id, 'orte' => orte_lesen()]);
