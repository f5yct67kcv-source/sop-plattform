<?php
// Produkt anlegen oder aendern (ENT-181).
//
// EIN Endpunkt fuer beides: Ohne id wird angelegt, mit id geaendert. Zwei
// fast gleiche Endpunkte waeren zwei Stellen, an denen dieselbe Pruefung
// stehen muesste -- und irgendwann steht sie nur noch an einer.
//
// WICHTIG: Was hier geaendert wird, wirkt NUR auf kuenftige Belege. Bereits
// erfasste Positionen tragen ihre eigene Kopie von Name, Preis, Einheit und
// Satz (Snapshot-Regel, siehe belege.php) -- eine Preisaenderung veraendert
// keine verschickte Offerte rueckwirkend.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../produkte.php';

$user = require_session();
require_recht($user, 'offerten');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int)($in['id'] ?? 0);

$name = mb_substr(trim((string)($in['name'] ?? '')), 0, 200);
if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Ein Name ist erforderlich.'], 400);
}

$ganz = static function ($wert, int $min, int $max): int {
    return max($min, min($max, (int)round((float)$wert)));
};
$felder = [
    'name'               => $name,
    'beschreibung'       => trim((string)($in['beschreibung'] ?? '')),
    'einzelpreis_rappen' => $ganz($in['einzelpreis_rappen'] ?? 0, 0, 99999999),
    'einheit'            => mb_substr(trim((string)($in['einheit'] ?? 'Std.')), 0, 20) ?: 'Std.',
    // 10000 Basispunkte = 100 %. Ein hoeherer Satz waere kein Steuersatz mehr.
    'mwst_satz_bp'       => $ganz($in['mwst_satz_bp'] ?? 810, 0, 10000),
    'sortierung'         => $ganz($in['sortierung'] ?? 0, 0, 9999),
];

$pdo = db();
if ($id > 0) {
    $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($felder)));
    $s = $pdo->prepare("UPDATE produkte SET $satz WHERE id = ?");
    $s->execute(array_merge(array_values($felder), [$id]));
    if ($s->rowCount() === 0) {
        // rowCount 0 heisst entweder "gibt es nicht" oder "nichts geaendert".
        // Nur der erste Fall ist ein Fehler -- darum wird nachgesehen.
        $chk = $pdo->prepare('SELECT id FROM produkte WHERE id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) {
            json_response(['status' => 'error', 'message' => 'Leistung nicht gefunden'], 404);
        }
    }
} else {
    // Produktnummer wird vergeben, nicht eingegeben (ENT-219,
    // Projektinhaber-Entscheidung 2026-08-28) -- automatisch fortlaufend,
    // damit keine Doppel- oder Luecken-Nummern von Hand entstehen.
    $felder = ['nummer' => naechste_produktnummer($pdo)] + $felder;
    $spalten = array_keys($felder);
    // Ein Platzhalter je Spalte -- NICHT "(?" plus count($spalten) weitere
    // (das waeren einer zuviel: "aktiv" dahinter ist ein fester Literal,
    // kein eigener Platzhalter). Genau dieser Ueberschuss liess jede
    // Neuanlage seit ENT-181 mit PDOException HY093 "Invalid parameter
    // number" scheitern -- am Server nie sichtbar, weil PDO die Anfrage
    // schon vor dem Versand als fehlerhaft verwirft (ENT-217).
    $platzhalter = implode(', ', array_fill(0, count($spalten), '?'));
    $pdo->prepare(
        'INSERT INTO produkte (' . implode(', ', $spalten) . ', aktiv) VALUES (' . $platzhalter . ', 1)'
    )->execute(array_values($felder));
    $id = (int)$pdo->lastInsertId();
}

json_response(['status' => 'ok', 'id' => $id]);
