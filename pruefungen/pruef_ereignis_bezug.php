<?php
declare(strict_types=1);
// Der Bezug einer Ereignismeldung auf die Aufgabe, aus der sie entstand
// (ENT-621) -- ereignis_bezug_pruefen() in backend/rundgang.php.
//
// WORUM ES GEHT: Meldet der Waechter aus einer Aufgabe heraus, die er nicht
// erledigen konnte, schickt die App Kontrollpunkt und Aufgabe mit. Beide
// Kennungen kommen damit vom AUFRUFER, und dem gehoeren sie nicht. Ohne
// Pruefung koennte jemand eine Kennung aus einem fremden Objekt
// mitschicken, und die Meldung haenge an einem Kontrollpunkt, den sein
// Betrieb gar nicht sehen darf.
//
// Die zweite Haelfte ist genauso wichtig: Ein nicht passender Bezug darf
// die MELDUNG nicht verhindern. Foto und Text sind der Nachweis; dass der
// Kontrollpunkt inzwischen geloescht wurde, ist kein Grund, die Meldung
// wegzuwerfen. Darum gibt die Funktion null zurueck und wirft nicht.
//
// Ohne echte Datenbank: SQLite im Speicher, dieselbe Bauart wie
// pruef_ereignisse.php.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/rundgang.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE kontrollpunkt (id INTEGER PRIMARY KEY, objekt_id INTEGER)');
$pdo->exec('CREATE TABLE objekt_aufgabe (id INTEGER PRIMARY KEY, objekt_id INTEGER)');
// Objekt 1 gehoert dem Betrieb, Objekt 2 einem anderen.
$pdo->exec('INSERT INTO kontrollpunkt (id, objekt_id) VALUES (10, 1), (20, 2)');
$pdo->exec('INSERT INTO objekt_aufgabe (id, objekt_id) VALUES (11, 1), (21, 2)');

// ══════════════ DER NORMALFALL
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, 10, 11);
pruef('KRITISCH: ein Bezug auf das eigene Objekt kommt durch', $kp === 10 && $auf === 11);

// ══════════════ FREI GEMELDET: KEIN BEZUG, UND DAS IST KEIN FEHLER
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, null, null);
pruef('Ohne Angabe bleibt es bei null -- der Normalfall einer freien Meldung',
    $kp === null && $auf === null);
foreach ([0, '', '0', false] as $leer) {
    [$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, $leer, $leer);
    pruef('Auch eine leere Angabe (' . var_export($leer, true) . ') bleibt null',
        $kp === null && $auf === null);
}

// ══════════════ FREMDES OBJEKT: DER BEZUG FAELLT WEG
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, 20, 21);
pruef('KRITISCH: ein Kontrollpunkt aus einem FREMDEN Objekt wird nicht uebernommen', $kp === null);
pruef('KRITISCH: eine Aufgabe aus einem FREMDEN Objekt ebenfalls nicht', $auf === null);

// Und einzeln, damit nicht eine der beiden Pruefungen die andere traegt.
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, 20, 11);
pruef('Ein fremder Kontrollpunkt faellt weg, die eigene Aufgabe bleibt',
    $kp === null && $auf === 11);
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, 10, 21);
pruef('Eine fremde Aufgabe faellt weg, der eigene Kontrollpunkt bleibt',
    $kp === 10 && $auf === null);

// ══════════════ WAS ES GAR NICHT GIBT
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 1, 999, 999);
pruef('KRITISCH: eine erfundene Kennung wird nicht uebernommen',
    $kp === null && $auf === null);

// ══════════════ OHNE OBJEKT LAESST SICH NICHTS PRUEFEN
// Dann gibt es auch nichts zu uebernehmen -- lieber kein Bezug als einer,
// der gegen nichts geprueft wurde.
[$kp, $auf] = ereignis_bezug_pruefen($pdo, 0, 10, 11);
pruef('KRITISCH: ohne Objekt wird kein Bezug uebernommen', $kp === null && $auf === null);

// ══════════════ NICHTS DAVON WIRFT
// Die Meldung selbst muss durchgehen, auch wenn der Bezug nicht passt.
$geworfen = false;
try {
    ereignis_bezug_pruefen($pdo, 1, 'kein Zahlwert', ['auch', 'nicht']);
} catch (Throwable $e) {
    $geworfen = true;
}
pruef('KRITISCH: unbrauchbare Angaben werfen nicht -- die Meldung geht trotzdem raus', !$geworfen);

echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
