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
            kontrollpunkt_id INT, status TEXT, erfasst_am TEXT, beschreibung TEXT,
            foto TEXT, foto_mime TEXT)');

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

// ══════════════ RUNDGANG_FORTSCHRITT -- FUER DIE UEBERSICHT (ENT-183)
$fortschritt = rundgang_fortschritt($pdo, 100, 1);
pruef('KRITISCH: Fortschritt zaehlt bestaetigte und nicht-verfuegbare Punkte getrennt',
    $fortschritt === ['gesamt' => 3, 'bestaetigt' => 1, 'nicht_verfuegbar' => 1, 'ersatzscan' => 0]);

$fortschrittAnders = rundgang_fortschritt($pdo, 200, 1);
pruef('KRITISCH: ein anderer Rundgang hat einen eigenen, unbeeinflussten Fortschritt',
    $fortschrittAnders === ['gesamt' => 3, 'bestaetigt' => 0, 'nicht_verfuegbar' => 0, 'ersatzscan' => 0]);

// Alle drei Punkte des Rundgangs 100 erledigen -> "gesamt" bleibt korrekt,
// auch wenn nichts mehr offen ist (kein Verwechseln mit "es gibt keine
// Kontrollpunkte").
$pdo->exec("INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am)
            VALUES (100, 3, 'bestaetigt', '2026-01-01 08:10:00')");
$fortschritt = rundgang_fortschritt($pdo, 100, 1);
pruef('KRITISCH: vollstaendig erledigt zeigt trotzdem die richtige Gesamtzahl, nicht 0',
    $fortschritt === ['gesamt' => 3, 'bestaetigt' => 2, 'nicht_verfuegbar' => 1, 'ersatzscan' => 0]);

// ══════════════ RUNDGANG_VORLAGE_PUNKTE_SETZEN -- KONTROLLRUNDEN (ENT-204)
$pdo->exec('CREATE TABLE rundgang_vorlage (id INTEGER PRIMARY KEY AUTOINCREMENT, objekt_id INT, name TEXT, aktiv INT)');
$pdo->exec('CREATE TABLE rundgang_vorlage_punkt (id INTEGER PRIMARY KEY AUTOINCREMENT, vorlage_id INT,
            kontrollpunkt_id INT, reihenfolge INT)');
// Ein zweites Objekt mit eigenem Kontrollpunkt, um die Fremdobjekt-Pruefung
// unten ueberhaupt herausfordern zu koennen.
$pdo->exec("INSERT INTO kontrollpunkt (objekt_id, bezeichnung, reihenfolge, typ, chip_id, aktiv)
            VALUES (2, 'Fremdes Objekt', 1, 'nfc', 'F1', 1)");

$pdo->exec("INSERT INTO rundgang_vorlage (objekt_id, name, aktiv) VALUES (1, 'Oeffnungsrunde', 1)");
$vorlageId = (int)$pdo->lastInsertId();

pruef('Unbekannte Vorlage liefert eine Fehlermeldung',
    rundgang_vorlage_punkte_setzen($pdo, 999999, [1, 2]) !== null);

pruef('KRITISCH: ein Punkt eines fremden Objekts wird abgelehnt',
    rundgang_vorlage_punkte_setzen($pdo, $vorlageId, [1, 99]) !== null);
$leer = $pdo->query("SELECT COUNT(*) FROM rundgang_vorlage_punkt WHERE vorlage_id = $vorlageId")->fetchColumn();
pruef('Eine abgelehnte Zuordnung aendert nichts (kein Teilerfolg)', (int)$leer === 0);

pruef('Eine doppelt angegebene Kontrollpunkt-Id wird abgelehnt',
    rundgang_vorlage_punkte_setzen($pdo, $vorlageId, [1, 1]) !== null);

pruef('KRITISCH: eine gueltige Zuordnung wird angenommen',
    rundgang_vorlage_punkte_setzen($pdo, $vorlageId, [2, 1]) === null);
$gesetzt = $pdo->query("SELECT kontrollpunkt_id, reihenfolge FROM rundgang_vorlage_punkt
                         WHERE vorlage_id = $vorlageId ORDER BY reihenfolge")->fetchAll();
pruef('Die Reihenfolge folgt der uebergebenen Liste, nicht der Kontrollpunkt-Id',
    $gesetzt === [['kontrollpunkt_id' => 2, 'reihenfolge' => 0], ['kontrollpunkt_id' => 1, 'reihenfolge' => 1]]);

pruef('KRITISCH: ein zweiter Aufruf ERSETZT die Zuordnung, statt sie zu ergaenzen',
    rundgang_vorlage_punkte_setzen($pdo, $vorlageId, [1]) === null);
$nachher = $pdo->query("SELECT COUNT(*) FROM rundgang_vorlage_punkt WHERE vorlage_id = $vorlageId")->fetchColumn();
pruef('Nach dem Ersetzen steht nur noch der neue Punkt da', (int)$nachher === 1);

pruef('Eine leere Liste entfernt alle Punkte (Runde ohne Zuordnung ist erlaubt)',
    rundgang_vorlage_punkte_setzen($pdo, $vorlageId, []) === null);
$leerNachher = $pdo->query("SELECT COUNT(*) FROM rundgang_vorlage_punkt WHERE vorlage_id = $vorlageId")->fetchColumn();
pruef('KRITISCH: die leere Liste wurde tatsaechlich angewendet', (int)$leerNachher === 0);

// ══════════════ VORLAGE-FILTER BEI UEBRIG/FORTSCHRITT (ENT-204, App-Auswahl
// beim Rundgang-Start). Eigener, unbenutzter Rundgang (300), damit die
// bereits oben verbrauchten Scans an Rundgang 100 hier nicht mitzaehlen.
$pdo->exec("INSERT INTO rundgang_vorlage (objekt_id, name, aktiv) VALUES (1, 'Kurzrunde', 1)");
$kurzrundeId = (int)$pdo->lastInsertId();
// Bewusst in umgekehrter Reihenfolge zu kontrollpunkt.reihenfolge gesetzt
// (Parkplatz=3 vor Eingang=1), um zu pruefen, dass tatsaechlich die
// Vorlagen-eigene Reihenfolge zaehlt, nicht die globale.
rundgang_vorlage_punkte_setzen($pdo, $kurzrundeId, [3, 1]);

$uebrigVorlage = rundgang_kontrollpunkte_uebrig($pdo, 300, 1, $kurzrundeId);
pruef('KRITISCH: mit Vorlage zaehlen nur deren Punkte, nicht alle Objekt-Punkte',
    count($uebrigVorlage) === 2);
pruef('Der nicht zugeordnete Kontrollpunkt (Keller) fehlt in der Vorlagen-Restliste',
    !in_array('Keller', array_column($uebrigVorlage, 'bezeichnung'), true));
pruef('KRITISCH: die Reihenfolge folgt der Vorlage, nicht kontrollpunkt.reihenfolge',
    array_column($uebrigVorlage, 'bezeichnung') === ['Parkplatz', 'Eingang']);

$fortschrittVorlage = rundgang_fortschritt($pdo, 300, 1, $kurzrundeId);
pruef('KRITISCH: "gesamt" zaehlt bei gewaehlter Vorlage nur deren Punkte (2, nicht 3)',
    $fortschrittVorlage === ['gesamt' => 2, 'bestaetigt' => 0, 'nicht_verfuegbar' => 0, 'ersatzscan' => 0]);

$pdo->exec("INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am)
            VALUES (300, 1, 'bestaetigt', '2026-01-01 09:00:00')");
$uebrigVorlage = rundgang_kontrollpunkte_uebrig($pdo, 300, 1, $kurzrundeId);
pruef('Ein bestaetigter Vorlagen-Punkt verschwindet auch hier aus der Restliste',
    count($uebrigVorlage) === 1 && $uebrigVorlage[0]['bezeichnung'] === 'Parkplatz');
$fortschrittVorlage = rundgang_fortschritt($pdo, 300, 1, $kurzrundeId);
pruef('Fortschritt zaehlt den bestaetigten Vorlagen-Punkt, "gesamt" bleibt bei 2',
    $fortschrittVorlage === ['gesamt' => 2, 'bestaetigt' => 1, 'nicht_verfuegbar' => 0, 'ersatzscan' => 0]);

pruef('KRITISCH: ohne Vorlage (null) bleibt das alte Verhalten -- alle drei Punkte zaehlen weiterhin',
    count(rundgang_kontrollpunkte_uebrig($pdo, 300, 1)) === 2 // Eingang schon bestaetigt, 2 von 3 offen
    && rundgang_fortschritt($pdo, 300, 1)['gesamt'] === 3);

// ══════════════ ERSATZSCAN -- FOTOBELEG STATT TECHNISCHER PRUEFUNG (Q-22)
pruef('KRITISCH: ein JPEG wird an den Magic Bytes erkannt',
    ersatzscan_foto_mime("\xFF\xD8\xFF\xE0Rest eines Fotos") === 'image/jpeg');
pruef('KRITISCH: ein PNG wird an den Magic Bytes erkannt',
    ersatzscan_foto_mime("\x89PNG\r\n\x1a\nRest eines Fotos") === 'image/png');
pruef('KRITISCH: beliebiger Inhalt (kein Bild) wird abgelehnt, nicht stillschweigend akzeptiert',
    ersatzscan_foto_mime('<html>kein Foto</html>') === null);
pruef('Ein leerer String ist kein gueltiges Foto',
    ersatzscan_foto_mime('') === null);

// Eigener, frischer Rundgang (400): ein Ersatzscan muss wie eine
// Bestaetigung aus der Restliste verschwinden (Kontrollpunkt 2 = Keller),
// aber getrennt von "bestaetigt" gezaehlt werden.
$pdo->exec("INSERT INTO rundgang_scan (rundgang_id, kontrollpunkt_id, status, erfasst_am, beschreibung, foto, foto_mime)
            VALUES (400, 2, 'ersatzscan', '2026-01-01 10:00:00', 'Chip zerstoert', 'FOTOINHALT', 'image/jpeg')");
$uebrigErsatzscan = rundgang_kontrollpunkte_uebrig($pdo, 400, 1);
pruef('KRITISCH: ein per Ersatzscan erledigter Punkt verschwindet aus der Restliste',
    !in_array('Keller', array_column($uebrigErsatzscan, 'bezeichnung'), true));
$fortschrittErsatzscan = rundgang_fortschritt($pdo, 400, 1);
pruef('KRITISCH: Ersatzscan zaehlt separat, nicht als "bestaetigt" mit',
    $fortschrittErsatzscan === ['gesamt' => 3, 'bestaetigt' => 0, 'nicht_verfuegbar' => 0, 'ersatzscan' => 1]);

// ══════════════ RUNDGANG_IM_FENSTER -- AUSFUEHRUNGSFENSTER (ENT-279)
pruef('Ohne konfiguriertes Fenster (beide NULL) schraenkt die Funktion nichts ein',
    rundgang_im_fenster('12:00', null, null, 5) === true);

pruef('KRITISCH: eine Uhrzeit innerhalb des Fensters ist erlaubt',
    rundgang_im_fenster('22:00', '21:00', '23:00', 5) === true);
pruef('KRITISCH: eine Uhrzeit deutlich ausserhalb des Fensters ist nicht erlaubt',
    rundgang_im_fenster('12:00', '21:00', '23:00', 5) === false);

pruef('KRITISCH: 5 Minuten vor Fensterbeginn liegt noch innerhalb der Toleranz',
    rundgang_im_fenster('20:55', '21:00', '23:00', 5) === true);
pruef('KRITISCH: 6 Minuten vor Fensterbeginn liegt bereits ausserhalb der Toleranz',
    rundgang_im_fenster('20:54', '21:00', '23:00', 5) === false);
pruef('KRITISCH: 5 Minuten nach Fensterende liegt noch innerhalb der Toleranz',
    rundgang_im_fenster('23:05', '21:00', '23:00', 5) === true);
pruef('KRITISCH: 6 Minuten nach Fensterende liegt bereits ausserhalb der Toleranz',
    rundgang_im_fenster('23:06', '21:00', '23:00', 5) === false);

// Ein Fenster kann ueber Mitternacht gehen (z. B. eine Nachtrunde 23:00-01:00).
pruef('KRITISCH: ein Fenster ueber Mitternacht erlaubt eine Uhrzeit kurz nach 00:00',
    rundgang_im_fenster('00:30', '23:00', '01:00', 5) === true);
pruef('KRITISCH: ein Fenster ueber Mitternacht erlaubt eine Uhrzeit kurz vor Fensterbeginn',
    rundgang_im_fenster('22:56', '23:00', '01:00', 5) === true);
pruef('KRITISCH: ein Fenster ueber Mitternacht lehnt eine Uhrzeit weit ausserhalb (Mittag) ab',
    rundgang_im_fenster('12:00', '23:00', '01:00', 5) === false);
pruef('Ein Fenster ueber Mitternacht lehnt eine Uhrzeit kurz nach Fensterende ab',
    rundgang_im_fenster('01:06', '23:00', '01:00', 5) === false);

pruef('Eine Uhrzeit mit Sekunden (HH:MM:SS, wie sie MySQL TIME liefert) wird gleich ausgewertet wie ohne',
    rundgang_im_fenster('22:00:30', '21:00', '23:00', 5) === true);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
