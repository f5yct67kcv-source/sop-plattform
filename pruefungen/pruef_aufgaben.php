<?php
declare(strict_types=1);
// Die Abschottung der Aufgaben-Zuordnung (ENT-302), echt ausgefuehrt.
//
// WORUM ES GEHT: kontrollpunkt_aufgaben_setzen.php bekommt eine Liste von
// Aufgaben-ids aus dem Browser. Im Browser sind nur die eigenen anklickbar
// -- ueber die Anfrage laesst sich jede Zahl schicken. Ohne Abschottung
// truege ein Kontrollpunkt danach eine Aufgabe aus einem fremden Objekt.
// "Sperren gehoeren in den Server" (CLAUDE.md).
//
// Die Abfrage wird NICHT abgeschrieben, sondern aus der Endpunktdatei
// gelesen und gegen eine SQLite-Datenbank ausgefuehrt. Eine abgeschriebene
// Kopie bliebe gruen, wenn im Endpunkt die Einschraenkung verschwindet.
$quelle = file_get_contents(__DIR__ . '/../backend/api/kontrollpunkt_aufgaben_setzen.php');

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

preg_match('/prepare\("(SELECT id FROM objekt_aufgabe.*?)"\)/s', $quelle, $m);
$sql = $m[1] ?? '';
pruef('Die Abfrage ist im Endpunkt ueberhaupt auffindbar', $sql !== '');

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE objekt_aufgabe (id INTEGER PRIMARY KEY, objekt_id INTEGER,
            bezeichnung TEXT, information TEXT, aktiv INTEGER NOT NULL DEFAULT 1)');
$pdo->exec("INSERT INTO objekt_aufgabe (id, objekt_id, bezeichnung, aktiv) VALUES
            (11, 1, 'Tuere verschliessen', 1),
            (12, 1, 'Sichtkontrolle', 1),
            (13, 1, 'Alte, entfernte Aufgabe', 0),
            (21, 2, 'Aufgabe eines FREMDEN Objekts', 1)");

// Genau so wie im Endpunkt: Platzhalter je id.
$erlaubte = function (int $objektId, array $ids) use ($pdo, $sql): array {
    if (!$ids) { return []; }
    $platz = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare(str_replace('$platz', $platz, $sql));
    $stmt->execute(array_merge([$objektId], $ids));
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
};

pruef('Eigene, aktive Aufgaben kommen durch', $erlaubte(1, [11, 12]) === [11, 12]);
pruef('KRITISCH: eine Aufgabe aus einem FREMDEN Objekt wird nicht durchgelassen',
    !in_array(21, $erlaubte(1, [11, 21]), true));
pruef('KRITISCH: eine entfernte (inaktive) Aufgabe wird nicht durchgelassen',
    !in_array(13, $erlaubte(1, [11, 13]), true));
pruef('Die erlaubten bleiben dabei erhalten -- es wird nicht pauschal alles verworfen',
    $erlaubte(1, [11, 21, 13]) === [11]);
pruef('Eine leere Liste fragt gar nicht erst an', $erlaubte(1, []) === []);
pruef('Eine unbekannte id liefert nichts', $erlaubte(1, [999]) === []);

// ── Die Normalisierung der Eingabe, ebenfalls aus dem Endpunkt gelesen ──
// Sie faengt ab, was gar keine id ist. Ohne sie liefe "0" oder "-1" in die
// Abfrage; harmlos, aber die Antwort "abgewiesen" waere dann ungenau.
preg_match('/\$ids = (array_values\(array_unique.*?\));/s', $quelle, $n);
pruef('Die Normalisierung ist auffindbar', !empty($n[1]));
if (!empty($n[1])) {
    $ids = [3, '3', '7', 0, -2, 'abc', null, 5];
    $norm = eval('return ' . $n[1] . ';');
    pruef('KRITISCH: Doppelte, Nullen, negative und Nicht-Zahlen fallen weg',
        $norm === [3, 7, 5]);
}

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
