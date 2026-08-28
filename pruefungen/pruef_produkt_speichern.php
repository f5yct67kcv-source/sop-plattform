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
// SQLite kennt REGEXP nicht von sich aus (anders als MySQL) -- ohne diese
// Registrierung wirft naechste_produktnummer() "no such function: REGEXP".
// Reine Testvorrichtung; die geprüfte Abfrage selbst bleibt unveraendert.
$pdo->sqliteCreateFunction('REGEXP', function (string $muster, ?string $wert): int {
    return preg_match('/' . str_replace('/', '\/', $muster) . '/', (string)$wert) === 1 ? 1 : 0;
}, 2);
$pdo->exec(
    'CREATE TABLE produkte (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nummer TEXT NULL,
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
// Mit eigener Nummer, um zu pruefen, dass naechste_produktnummer() darauf
// aufbaut statt bei P0001 neu zu beginnen (ENT-219).
$pdo->exec("INSERT INTO produkte (id, nummer, name, beschreibung, einzelpreis_rappen, einheit, mwst_satz_bp, sortierung, aktiv)
    VALUES (1, 'P0001', 'Bestehend', 'alt', 1000, 'Std.', 810, 10, 1)");

function db(): PDO { global $pdo; return $pdo; }
// Reichert eine Erfolgsantwort testhalber um die tatsaechlich gespeicherte
// Nummer an (produkt_speichern.php selbst liefert nur die Id zurueck) --
// sonst liesse sich von aussen nicht pruefen, ob naechste_produktnummer()
// wirklich etwas Sinnvolles in die Zeile geschrieben hat (ENT-219).
function json_response($data, int $status = 200): void {
    global $pdo;
    if (($data['status'] ?? null) === 'ok' && isset($data['id'])) {
        $s = $pdo->prepare('SELECT nummer FROM produkte WHERE id = ?');
        $s->execute([$data['id']]);
        $data['nummer_zur_pruefung'] = $s->fetchColumn();
    }
    http_response_code($status);
    echo json_encode($data);
    exit;
}
// Authentisierung und Rechteprüfung sind nicht Gegenstand dieser Prüfung
// (siehe test_zweifaktor.mjs/test_rollen.mjs dafür) -- hier zaehlt allein,
// ob die SQL-Anweisung selbst gegen eine echte Datenbank durchlaeuft.
function require_session(): array { return ['name' => 'test', 'ist_admin' => true]; }
function require_recht(array $user, string $recht): void {}

// naechste_produktnummer() WIRKLICH mitlaufen lassen (ENT-219), nicht
// stubben -- sonst prueft dieser Harness die Nummernvergabe gar nicht.
require __DIR__ . '/../backend/produkte.php';

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
