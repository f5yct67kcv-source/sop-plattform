<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../kunden.php';

$user = require_session();
require_recht($user, 'kunden_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$gelesen = kunden_eingabe_lesen($input);
$s = $gelesen['spalten'];

// Pflicht sind seit ENT-044 nur noch Name (bei einer Privatperson aus Vor- und
// Nachnamen gebildet) sowie PLZ und Ort. Strasse und Telefon sind freiwillig
// geworden -- ein Kunde ohne eigene Telefonnummer ist ein zulaessiger Zustand,
// und ein Pflichtfeld, das man mit einem Strich fuellt, ist keine Pruefung.
if ($s['name'] === '') {
    json_response(['status' => 'error', 'message' => $s['art'] === 'privat'
        ? 'Vor- und Nachname erforderlich' : 'Name erforderlich'], 400);
}
if ($s['plz'] === '' || $s['ort'] === '') {
    json_response(['status' => 'error', 'message' => 'PLZ und Ort erforderlich'], 400);
}

// Die Kundennummer vergibt ausschliesslich das System, fortlaufend und danach
// unveraenderlich (ENT-040) -- das Feld im Dialog ist eine ausgegraute
// Vorschau, sein Inhalt wird hier bewusst nicht gelesen.
$pdo = db();
$pdo->beginTransaction();
try {
    $kundennummer = naechste_kundennummer($pdo);
    $felder = array_keys($s);
    $pdo->prepare(
        'INSERT INTO kunden (kundennummer, ' . implode(', ', $felder) . ', aktiv) VALUES (?'
        . str_repeat(', ?', count($felder)) . ', 1)'
    )->execute(array_merge([$kundennummer], array_values($s)));
    $id = (int)$pdo->lastInsertId();

    if ($gelesen['kinder'] !== null) {
        kunden_kinder_speichern($pdo, $id, $gelesen['kinder']['kontaktwege'], $gelesen['kinder']['personen']);
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['status' => 'ok', 'id' => $id, 'kundennummer' => $kundennummer]);
