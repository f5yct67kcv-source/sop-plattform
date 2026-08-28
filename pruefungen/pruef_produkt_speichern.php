<?php
// produkt_speichern.php WIRKLICH ausfuehren (ENT-217), gegen eine
// In-Memory-SQLite-Datenbank -- nicht nur die Serverantwort vortaeuschen wie
// test_offerten.mjs. Genau diese Luecke liess den HY093-Fehler vom
// 28.08.2026 unbemerkt: sieben "?"-Platzhalter fuer sechs gebundene Werte
// bei der Neuanlage eines Produkts -- eine Zeile SQL, die kein gemockter
// Test je zu Gesicht bekommt.
//
// Aufruf: php pruef_produkt_speichern.php <json-koerper-auf-stdin>
// Gibt die tatsaechliche JSON-Antwort auf stdout aus; der Aufrufer (php --
// oder test_produkt_speichern.mjs) wertet sie aus.
declare(strict_types=1);

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec(
    'CREATE TABLE produkte (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        beschreibung TEXT,
        einzelpreis_rappen INTEGER NOT NULL DEFAULT 0,
        einheit TEXT NOT NULL DEFAULT "Std.",
        mwst_satz_bp INTEGER NOT NULL DEFAULT 810,
        sortierung INTEGER NOT NULL DEFAULT 0,
        aktiv INTEGER NOT NULL DEFAULT 1
    )'
);
// Ein bereits bestehendes Produkt, um auch den UPDATE-Zweig (id > 0) wirklich
// zu durchlaufen -- der lief schon vorher korrekt, soll es aber bleiben.
$pdo->exec("INSERT INTO produkte (id, name, beschreibung, einzelpreis_rappen, einheit, mwst_satz_bp, sortierung, aktiv)
    VALUES (1, 'Bestehend', 'alt', 1000, 'Std.', 810, 10, 1)");

function db(): PDO { global $pdo; return $pdo; }
function json_response($data, int $status = 200): void { http_response_code($status); echo json_encode($data); exit; }
// Authentisierung und Rechteprüfung sind nicht Gegenstand dieser Prüfung
// (siehe test_zweifaktor.mjs/test_rollen.mjs dafür) -- hier zaehlt allein,
// ob die SQL-Anweisung selbst gegen eine echte Datenbank durchlaeuft.
function require_session(): array { return ['name' => 'test', 'ist_admin' => true]; }
function require_recht(array $user, string $recht): void {}

$quelle = file_get_contents(__DIR__ . '/../backend/api/produkt_speichern.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require(_once)? __DIR__ \. .*$/m', '', $quelle);
// 'php://input' liefert im CLI-SAPI immer leer (anders als bei einer echten
// HTTP-Anfrage) -- 'php://stdin' ist das CLI-Gegenstueck zum rohen
// Anfragerumpf. Reine Testvorrichtung, die geprüfte Logik bleibt unveraendert.
$quelle = str_replace('php://input', 'php://stdin', $quelle);

$_SERVER['REQUEST_METHOD'] = 'POST';
eval($quelle);
