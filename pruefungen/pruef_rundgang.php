<?php
declare(strict_types=1);
// Echte Ausfuehrung des Rundgang-Kerns (ENT-132/ENT-145/ENT-180) gegen eine
// wirkliche Datenbank (SQLite im Arbeitsspeicher), gleiches Muster wie
// pruef_einsatz_abgeschlossen.php. Die Playwright-Suiten pruefen nie die
// eigentliche SQL-Abfrage oder die Geofence-Rechnung -- die laufen nur hier.
require __DIR__ . '/../backend/rundgang.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// ══════════════ GEO-DISTANZ (HAVERSINE)
pruef('Derselbe Punkt hat Distanz 0', geo_distanz_meter(47.2, 7.8, 47.2, 7.8) < 0.01);
// Bern (46.9480, 7.4474) -- Zuerich HB (47.3779, 8.5403): Luftlinie ca. 95 km,
// bekannter Referenzwert (oeffentlich nachpruefbar), Toleranz 2 km fuer die
// Kugelnaeherung.
$d = geo_distanz_meter(46.9480, 7.4474, 47.3779, 8.5403);
pruef('KRITISCH: Haversine liefert eine plausible Distanz Bern-Zuerich (ca. 95km)',
    $d > 93000 && $d < 97000);
// Zwei Punkte 20m auseinander (grob: 0.00018 Grad Breite ~ 20m) sollten im
// erwarteten Bereich liegen -- das ist der praktisch relevante Massstab
// (Default-Geofence-Radius, ENT-132-N1).
$nah = geo_distanz_meter(47.2000, 7.8000, 47.20018, 7.8000);
pruef('Kleine Distanzen im Meterbereich sind plausibel (nicht km, nicht cm)',
    $nah > 15 && $nah < 25);

// ══════════════ RUNDGANG_SCAN_PRUEFEN -- NFC
$nfcPunkt = ['typ' => 'nfc', 'chip_id' => 'ABC123', 'lat' => null, 'lng' => null, 'geofence_radius_m' => 20];
pruef('KRITISCH: passende Chip-ID wird akzeptiert',
    rundgang_scan_pruefen($nfcPunkt, 'ABC123', null, null) === null);
pruef('KRITISCH: falsche Chip-ID wird abgelehnt',
    rundgang_scan_pruefen($nfcPunkt, 'FALSCH', null, null) !== null);
pruef('KRITISCH: fehlende Chip-ID wird abgelehnt (nicht stillschweigend akzeptiert)',
    rundgang_scan_pruefen($nfcPunkt, null, null, null) !== null);

// ══════════════ RUNDGANG_SCAN_PRUEFEN -- GEOFENCE
$geoPunkt = ['typ' => 'geofence', 'chip_id' => null, 'lat' => 47.2000, 'lng' => 7.8000, 'geofence_radius_m' => 20];
pruef('KRITISCH: eine Position direkt am Punkt wird akzeptiert',
    rundgang_scan_pruefen($geoPunkt, null, 47.2000, 7.8000) === null);
pruef('KRITISCH: eine Position weit ausserhalb des Radius wird abgelehnt',
    rundgang_scan_pruefen($geoPunkt, null, 47.3000, 7.8000) !== null);
pruef('KRITISCH: fehlender Standort wird abgelehnt, nicht als "irgendwo" durchgelassen',
    rundgang_scan_pruefen($geoPunkt, null, null, null) !== null);
pruef('Die Fehlermeldung nennt die Distanz, damit sie nachvollziehbar ist',
    str_contains((string)rundgang_scan_pruefen($geoPunkt, null, 47.3000, 7.8000), 'm entfernt'));

// ══════════════ DATENBANKTEIL -- WELCHE KONTROLLPUNKTE SIND NOCH OFFEN
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE kontrollpunkt (id INTEGER PRIMARY KEY AUTOINCREMENT, objekt_id INT,
            bezeichnung TEXT, reihenfolge INT, typ TEXT, chip_id TEXT, lat REAL, lng REAL,
            geofence_radius_m INT, aktiv INT)');
$pdo->exec('CREATE TABLE rundgang_scan (id INTEGER PRIMARY KEY AUTOINCREMENT, rundgang_id INT,
            kontrollpunkt_id INT, status TEXT, erfasst_am TEXT, beschreibung TEXT)');

$pdo->exec("INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ, chip_id, aktiv)
            VALUES (1, 'Eingang', 1, 'nfc', 'A1', 1)");
$pdo->exec("INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ, chip_id, aktiv)
            VALUES (1, 'Keller', 2, 'nfc', 'A2', 1)");
$pdo->exec("INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ, lat, lng, geofence_radius_m, aktiv)
            VALUES (1, 'Parkplatz', 3, 'geofence', 47.2, 7.8, 20, 1)");
// Ein deaktivierter Punkt eines anderen Objekts zaehlt nirgends mit.
$pdo->exec("INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ, chip_id, aktiv)
            VALUES (1, 'Alter Punkt', 4, 'nfc', 'A9', 0)");

$uebrig = rundgang_kontrollpunkte_uebrig($pdo, 100, 1);
pruef('KRITISCH: ohne Scans sind alle aktiven Kontrollpunkte offen',
    count($uebrig) === 3);
pruef('Ein deaktivierter Kontrollpunkt zaehlt nicht mit',
    !in_array('Alter Punkt', array_column($uebrig, 'bezeichnung'), true));
pruef('Die Reihenfolge stimmt', array_column($uebrig, 'bezeichnung') === ['Eingang', 'Keller', 'Parkplatz']);

$pdo->exec("INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am)
            VALUES (100, 1, 'bestaetigt', '2026-01-01 08:00:00')");
$uebrig = rundgang_kontrollpunkte_uebrig($pdo, 100, 1);
pruef('KRITISCH: ein bestaetigter Punkt verschwindet aus der Restliste',
    count($uebrig) === 2 && !in_array('Eingang', array_column($uebrig, 'bezeichnung'), true));

$pdo->exec("INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am, beschreibung)
            VALUES (100, 2, 'nicht_verfuegbar', '2026-01-01 08:05:00', 'Chip defekt')");
$uebrig = rundgang_kontrollpunkte_uebrig($pdo, 100, 1);
pruef('KRITISCH: auch "nicht verfuegbar" entfernt den Punkt aus der Restliste (ENT-145)',
    count($uebrig) === 1 && $uebrig[0]['bezeichnung'] === 'Parkplatz');

// Ein Scan fuer einen ANDEREN Rundgang darf diesen hier nicht beeinflussen --
// sonst wuerden sich parallele/nacheinander laufende Rundgaenge gegenseitig
// verfaelschen.
$uebrigAnders = rundgang_kontrollpunkte_uebrig($pdo, 200, 1);
pruef('KRITISCH: ein anderer Rundgang am selben Objekt startet mit einer eigenen, vollen Liste',
    count($uebrigAnders) === 3);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
