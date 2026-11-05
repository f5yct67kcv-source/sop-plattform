<?php
// Eine Kategorie der Ausgaben anlegen, umbenennen, archivieren oder
// zurueckholen (ENT-725, Punkt 11). Nie loeschen: Buchungen verweisen auf
// sie.
//
//   POST {name}               anlegen
//   POST {id, name}           umbenennen
//   POST {id, aktiv: 0|1}     archivieren / zurueckholen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}
$pdo = betreiber_db();
if (!be_aus_eingerichtet($pdo)) {
    json_response(['status' => 'error', 'message' => 'Die Ausgaben sind noch nicht eingerichtet.'], 503);
}
$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);
$alle = be_aus_kategorien($pdo);

if ($id > 0 && !isset($alle[$id])) {
    json_response(['status' => 'error', 'message' => 'Kategorie nicht gefunden'], 404);
}

if ($id > 0 && array_key_exists('aktiv', $in) && !array_key_exists('name', $in)) {
    $aktiv = !empty($in['aktiv']) ? 1 : 0;
    $pdo->prepare('UPDATE be_ausgabe_kategorie SET aktiv = ? WHERE id = ?')->execute([$aktiv, $id]);
    if ($alle[$id]['aktiv'] !== $aktiv) {
        be_log($pdo, $ich, 'ausgabekategorie', $id, 'zustand',
               $alle[$id]['aktiv'] ? 'aktiv' : 'archiviert', $aktiv ? 'aktiv' : 'archiviert');
    }
    json_response(['status' => 'ok', 'id' => $id, 'aktiv' => $aktiv]);
}

$name = mb_substr(trim((string)($in['name'] ?? '')), 0, 100);
if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Bitte einen Namen erfassen.'], 400);
}
// Gleicher Name ohne Ruecksicht auf Gross- und Kleinschreibung: "hosting"
// neben "Hosting" waeren zwei Kategorien, die niemand auseinanderhaelt.
foreach ($alle as $k) {
    if ($k['id'] !== $id && mb_strtolower($k['name']) === mb_strtolower($name)) {
        json_response(['status' => 'error', 'message' => $k['aktiv']
            ? 'Diese Kategorie gibt es schon.'
            : 'Diese Kategorie gibt es schon, sie ist archiviert. Bitte dort zurückholen.'], 400);
    }
}

if ($id > 0) {
    $pdo->prepare('UPDATE be_ausgabe_kategorie SET name = ? WHERE id = ?')->execute([$name, $id]);
    if ($alle[$id]['name'] !== $name) {
        be_log($pdo, $ich, 'ausgabekategorie', $id, 'name', $alle[$id]['name'], $name);
    }
} else {
    $sort = $alle ? max(array_column($alle, 'sortierung')) + 1 : 0;
    $pdo->prepare('INSERT INTO be_ausgabe_kategorie (name, sortierung, aktiv) VALUES (?, ?, 1)')
        ->execute([$name, $sort]);
    $id = (int)$pdo->lastInsertId();
    be_log($pdo, $ich, 'ausgabekategorie', $id, 'angelegt', null, $name);
}
json_response(['status' => 'ok', 'id' => $id]);
