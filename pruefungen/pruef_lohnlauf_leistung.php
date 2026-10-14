<?php
declare(strict_types=1);
// Zulage je Leistungsart (ENT-721, Schritt 3) -- echt ausgefuehrt gegen
// SQLite im Arbeitsspeicher.
//
// EIGENE DATEI aus demselben Grund wie pruef_lohn_position.php: Der Katalog
// wird je Prozess einmal gemerkt.
//
// Worauf es ankommt:
//  1. Gezaehlt werden NUR die Stunden der Schichten mit dieser Leistungsart.
//  2. Der Satz der Person schlaegt den Standardsatz; ohne beide kein Betrag.
//  3. Ist eine Zulage hinterlegt und an Schichten keine Leistungsart
//     gewaehlt, entsteht eine gesperrte Zeile -- kein stilles Weglassen.
//  4. Der Grundlohn zaehlt seine Stunden dadurch nicht doppelt oder anders.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }
function json_response($data, int $status = 200): void {}

require_once __DIR__ . '/../backend/lohnlauf.php';

function db_bauen(bool $mitLeistung): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                                   PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, datum TEXT, sparte TEXT,
                kunde_name TEXT, objekt_id INT, status TEXT)');
    $pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, ist_status TEXT,
                ist_von TEXT, ist_bis TEXT, ist_pause_min INT, ist_pause_bezahlt_ma INT'
                . ($mitLeistung ? ', leistungsart_id INT' : '') . ')');
    $pdo->exec('CREATE TABLE lohn_ansatz (id INTEGER PRIMARY KEY, mitarbeiter_id INT, gueltig_ab TEXT,
                kategorie TEXT, ansatz_rappen INT, ferien_laufend INT, ml13_bp INT,
                zuschlag_fachausweis_art TEXT, zuschlag_fachausweis_rappen INT,
                zuschlag_hund_art TEXT, zuschlag_hund_rappen INT,
                zuschlag_waffe_art TEXT, zuschlag_waffe_rappen INT)');
    $pdo->exec('CREATE TABLE lohnart (id INTEGER PRIMARY KEY, schluessel TEXT UNIQUE, bezeichnung TEXT,
                art TEXT, basis_schluessel TEXT, satz_bp INT,
                ahv_pflichtig INT, ferien_pflichtig INT, ml13_pflichtig INT,
                bvg_pflichtig INT, uvg_pflichtig INT, qst_pflichtig INT,
                gav_grundlage TEXT, system INT DEFAULT 0, sortierung INT DEFAULT 100,
                bemessung INT DEFAULT 0, aktiv INT DEFAULT 1, nummer TEXT, standard_rappen INT)');
    $pdo->exec('CREATE TABLE lohn_position (id INTEGER PRIMARY KEY, mitarbeiter_id INT, lohnart_id INT,
                betrag_rappen INT, gueltig_ab TEXT, gueltig_bis TEXT, bemerkung TEXT,
                erfasst_am TEXT, erfasst_von INT, geaendert_am TEXT, geaendert_von INT)');
    $pdo->exec('CREATE TABLE lohnlauf (id INTEGER PRIMARY KEY, periode_von TEXT, periode_bis TEXT, status TEXT)');
    $pdo->exec('CREATE TABLE lohnlauf_person (id INTEGER PRIMARY KEY, lauf_id INT, mitarbeiter_id INT)');
    $ein = $pdo->prepare('INSERT INTO lohnart (schluessel, bezeichnung, art, basis_schluessel, satz_bp,
        ahv_pflichtig, ferien_pflichtig, ml13_pflichtig, bvg_pflichtig, uvg_pflichtig, qst_pflichtig,
        gav_grundlage, system, sortierung, bemessung) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)');
    foreach (lohnart_startbestand() as $la) { $ein->execute($la); }
    // Zwei Leistungsarten, angelegt wie ueber lohnarten.php.
    $pdo->exec("INSERT INTO lohnart (id, schluessel, bezeichnung, art, ahv_pflichtig, ferien_pflichtig,
        ml13_pflichtig, bvg_pflichtig, uvg_pflichtig, qst_pflichtig, aktiv, sortierung, nummer, standard_rappen)
        VALUES (201, 'la_hund', 'Hundeführer', 'leistung', 1,1,1,1,1,1, 1, 300, '102', 150),
               (202, 'la_objekt', 'Objektschutz', 'leistung', 1,0,0,1,1,1, 1, 301, '103', NULL)");
    // Drei Tagschichten im Mai, ohne Pause und ohne Zeitbonus.
    $pdo->exec("INSERT INTO einsaetze VALUES (1,'2026-05-06','sicherheit','Kunde',NULL,'geplant'),
               (2,'2026-05-07','sicherheit','Kunde',NULL,'geplant'),
               (3,'2026-05-08','sicherheit','Kunde',NULL,'geplant')");
    if ($mitLeistung) {
        $pdo->exec("INSERT INTO einsatz_zuteilung VALUES (1,1,'anwesend','08:00','16:00',0,0,201),
                   (2,1,'anwesend','08:00','16:00',0,0,NULL), (3,1,'anwesend','08:00','12:00',0,0,202)");
    } else {
        $pdo->exec("INSERT INTO einsatz_zuteilung VALUES (1,1,'anwesend','08:00','16:00',0,0),
                   (2,1,'anwesend','08:00','16:00',0,0), (3,1,'anwesend','08:00','12:00',0,0)");
    }
    $pdo->exec("INSERT INTO lohn_ansatz VALUES (1,1,'2024-01-01','C',2500,1,833,NULL,NULL,NULL,NULL,NULL,NULL)");
    return $pdo;
}

$MA = ['id' => 1, 'anstellungskategorie' => 'C', 'eintritt' => '2024-03-01',
       'geburtsdatum' => '2000-05-04', 'pensum_stunden' => 800];
$zeilen = function (array $p): array {
    $z = [];
    foreach ($p['zeilen'] as $x) { $z[$x['schluessel']][] = $x; }
    return $z;
};

$pdo = db_bauen(true);
$fe = lohn_ferienentschaedigung_bp($MA['geburtsdatum'], '2026-05-31');

// ── Ohne eigenen Satz: der Standard aus dem Katalog ──────────────────────
$p = lohnlauf_person($pdo, $MA, '2026-05-01', '2026-05-31');
$z = $zeilen($p);
pruef('Der Grundlohn zählt weiterhin alle 20 Stunden, nicht mehr und nicht weniger',
    abs(($z['geleistete_stunden'][0]['menge'] ?? 0) - 20.0) < 1e-9);
pruef('KRITISCH: die Zulage zählt NUR die 8 Stunden mit dieser Leistungsart: 1.50 x 8 = 12.00',
    ($z['la_hund'][0]['betrag_rappen'] ?? null) === 1200 && abs(($z['la_hund'][0]['menge'] ?? 0) - 8.0) < 1e-9);
pruef('Ohne eigenen Satz gilt der Standardsatz, und das steht da',
    ($z['la_hund'][0]['basis_rappen'] ?? null) === 150
    && str_contains($z['la_hund'][0]['hinweis'] ?? '', 'Standard'));
pruef('Ferienentschädigung auf der Leistungsart als eigene Zeile, als Annahme gekennzeichnet (GAV-AUS-019)',
    ($z['ferien_auf_zulage'][0]['betrag_rappen'] ?? null) === lohn_anteil(1200, $fe['bp'])
    && ($z['ferien_auf_zulage'][0]['annahme'] ?? 0) === 1);
pruef('13. Monatslohn auf der Leistungsart als eigene Zeile',
    ($z['anteil_13ml_auf_zulage'][0]['betrag_rappen'] ?? null) === lohn_anteil(1200, 833));
pruef('KRITISCH: ohne eigenen und ohne Standardsatz entsteht kein Betrag, sondern eine gesperrte Zeile',
    isset($z['la_objekt'][0]) && $z['la_objekt'][0]['betrag_rappen'] === null
    && ($z['la_objekt'][0]['gesperrt_grund'] ?? '') === 'leistungsart_ohne_satz'
    && abs(($z['la_objekt'][0]['menge'] ?? 0) - 4.0) < 1e-9);
pruef('Ohne hinterlegte Zulage keine Hinweiszeile für Schichten ohne Leistungsart',
    !isset($z['leistungsart_offen']));
pruef('Die Zulage zählt im Bruttolohn mit',
    $p['brutto_rappen'] >= 1200 && in_array('la_hund', array_keys($z), true));
$ohneZulage = $p['brutto_rappen'];

// ── Mit eigenem Satz ─────────────────────────────────────────────────────
pruef('Ein eigener Satz je Leistungsart lässt sich als persönliche Position erfassen',
    lohn_position_schreiben($pdo, 1, ['aktion' => 'neu', 'lohnart_id' => 201, 'betrag' => '2.00', 'ab' => '2026-01'], 9) === null);
$p = lohnlauf_person($pdo, $MA, '2026-05-01', '2026-05-31');
$z = $zeilen($p);
pruef('KRITISCH: der eigene Satz schlägt den Standard: 2.00 x 8 = 16.00, nicht auf alle 20 Stunden',
    ($z['la_hund'][0]['betrag_rappen'] ?? null) === 1600 && count($z['la_hund']) === 1);
pruef('Der eigene Satz rechnet NICHT zusätzlich als Stundenzulage auf alle Stunden',
    !array_filter($p['zeilen'], fn($x) => ($x['betrag_rappen'] ?? 0) === 4000));
pruef('KRITISCH: hinterlegte Zulage und eine Schicht ohne Leistungsart: gesperrte Hinweiszeile mit 8 Stunden',
    ($z['leistungsart_offen'][0]['gesperrt_grund'] ?? '') === 'leistungsart_nicht_gewaehlt'
    && isset($z['leistungsart_offen'][0]) && $z['leistungsart_offen'][0]['betrag_rappen'] === null
    && abs(($z['leistungsart_offen'][0]['menge'] ?? 0) - 8.0) < 1e-9);
pruef('Der Bruttolohn wächst genau um die Differenz von Zulage samt Ferien- und 13.-Anteil',
    $p['brutto_rappen'] - $ohneZulage
      === (1600 - 1200) + (lohn_anteil(1600, $fe['bp']) - lohn_anteil(1200, $fe['bp']))
        + (lohn_anteil(1600, 833) - lohn_anteil(1200, 833)));
pruef('Jeder Sperrgrund hat einen erklärenden Text',
    isset(lohnlauf_sperrgruende()['leistungsart_nicht_gewaehlt'], lohnlauf_sperrgruende()['leistungsart_ohne_satz'],
          lohnlauf_sperrgruende()['leistungsart_unbekannt']));

// ── Teilzeitraum: der eigene Satz gilt je Monat ──────────────────────────
$p = lohnlauf_person($pdo, $MA, '2026-05-01', '2026-05-15');
$z = $zeilen($p);
pruef('Kein ganzer Monat: der eigene Satz sperrt die Zeile statt anteilig zu raten',
    ($z['la_hund'][0]['gesperrt_grund'] ?? '') === 'periode_kein_monat');

// ── Vor der Einrichtung: keine Spalte, keine Zeile, kein Absturz ─────────
$alt = db_bauen(false);
$p = lohnlauf_person($alt, $MA, '2026-05-01', '2026-05-31');
pruef('Ohne Spalte an der Zuteilung läuft der Lohnlauf wie bisher',
    !array_filter($p['zeilen'], fn($x) => str_starts_with($x['schluessel'], 'la_'))
    && abs(($zeilen($p)['geleistete_stunden'][0]['menge'] ?? 0) - 20.0) < 1e-9);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
