<?php
// demo_nutzung_melden.php WIRKLICH ausfuehren (ENT-653), gegen eine
// In-Memory-SQLite-Datenbank -- nicht nur die Serverantwort vortaeuschen.
//
// Aufruf: php pruef_demo_nutzung.php <json-koerper-auf-stdin>
// Umgebungsvariable PRUEF_IST_DEMO_PLATZ=0 stellt den Nicht-Demo-Platz-Fall
// nach (Standard: 1, wie ein echter Demo-Platz).
// Gibt die tatsaechliche JSON-Antwort auf stdout aus; test_demo_nutzung.mjs
// wertet sie aus.
declare(strict_types=1);

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec(
    'CREATE TABLE demo_nutzung (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reiter TEXT NOT NULL,
        dauer_s INTEGER NOT NULL,
        erfasst_am TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )'
);

function db(): PDO { global $pdo; return $pdo; }
// Reichert eine Erfolgsantwort testhalber um den tatsaechlichen Tabellen-
// inhalt an (der echte Endpunkt liefert nur "status":"ok" zurueck) -- sonst
// liesse sich von aussen nicht pruefen, ob und mit welchen Werten wirklich
// eingefuegt wurde.
function json_response($data, int $status = 200): void {
    global $pdo;
    if (($data['status'] ?? null) === 'ok') {
        $data['zeilen_zur_pruefung'] = $pdo->query(
            'SELECT reiter, dauer_s FROM demo_nutzung'
        )->fetchAll();
    }
    http_response_code($status);
    echo json_encode($data);
    exit;
}
// Authentisierung ist nicht Gegenstand dieser Pruefung (dafuer NUR_EIGENE_
// DATEN in test_php.mjs) -- hier zaehlt die eigentliche Logik des Endpunkts:
// Formpruefung, die Demo-Platz-Sperre und die wirklich ausgefuehrte Zeile.
function require_session(): array { return ['id' => 1, 'name' => 'test']; }
function ist_demo_platz(): bool { return getenv('PRUEF_IST_DEMO_PLATZ') !== '0'; }

$quelle = file_get_contents(__DIR__ . '/../backend/api/demo_nutzung_melden.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require __DIR__ \. .*$/m', '', $quelle);
$quelle = str_replace('php://input', 'php://stdin', $quelle);

$_SERVER['REQUEST_METHOD'] = 'POST';
eval($quelle);
