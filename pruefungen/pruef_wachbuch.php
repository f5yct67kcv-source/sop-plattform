<?php
declare(strict_types=1);
// Echte Ausfuehrung der Wachbuch-Zusammenfuehrung (ENT-480) gegen eine
// wirkliche Datenbank (SQLite im Arbeitsspeicher), gleiches Muster wie
// pruef_rundgang.php.
//
// Warum das hier laufen MUSS und nicht im Browser: Die Browser-Suite taeuscht
// die Serverantwort vor. Sie sieht darum nie, ob vier Quellen richtig
// zusammengefuehrt, richtig sortiert und richtig gekappt werden -- und genau
// das ist der ganze Inhalt dieser Funktion.
$GLOBALS['tabellen'] = ['rundgang_scan' => true, 'rundgang' => true,
                        'rundgang_aufgabe' => true, 'ereignis_meldung' => true];
$GLOBALS['spalten'] = ['rundgang_scan.foto_mime' => true];
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    return $GLOBALS['tabellen'][$t] ?? false;
}
function hat_spalte(PDO $pdo, string $t, string $s): bool {
    return $GLOBALS['spalten'][$t . '.' . $s] ?? false;
}

require __DIR__ . '/../backend/rundgang.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT)');
$pdo->exec('CREATE TABLE objekte (id INTEGER PRIMARY KEY, kunde_id INT, kunde_name TEXT, name TEXT)');
$pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, kunde_id INT, kunde_name TEXT,
            objekt_id INT, titel TEXT, datum TEXT)');
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, vorname TEXT, nachname TEXT)');
$pdo->exec('CREATE TABLE kontrollpunkt (id INTEGER PRIMARY KEY, objekt_id INT, bezeichnung TEXT)');
$pdo->exec('CREATE TABLE rundgang_vorlage (id INTEGER PRIMARY KEY, objekt_id INT, name TEXT,
            fenster_von TEXT, fenster_bis TEXT)');
$pdo->exec('CREATE TABLE rundgang (id INTEGER PRIMARY KEY, einsatz_id INT, mitarbeiter_id INT,
            objekt_id INT, rundgang_vorlage_id INT, status TEXT, rohzeit_start TEXT,
            rohzeit_ende TEXT, pause_minuten INT DEFAULT 0, abbruch_grund TEXT,
            abbruch_freitext TEXT, abgebrochen_am TEXT)');
$pdo->exec('CREATE TABLE rundgang_scan (id INTEGER PRIMARY KEY, rundgang_id INT, kontrollpunkt_id INT,
            status TEXT, erfasst_am TEXT, uebermittelt_am TEXT, beschreibung TEXT, foto_mime TEXT)');
$pdo->exec('CREATE TABLE rundgang_aufgabe (id INTEGER PRIMARY KEY, rundgang_id INT, kontrollpunkt_id INT,
            aufgabe_id INT, bezeichnung TEXT, status TEXT, grund TEXT, erfasst_am TEXT,
            uebermittelt_am TEXT)');
$pdo->exec('CREATE TABLE ereignisart (id INTEGER PRIMARY KEY, bezeichnung TEXT)');
$pdo->exec('CREATE TABLE ereignis_meldung (id INTEGER PRIMARY KEY, objekt_id INT, rundgang_id INT,
            einsatz_id INT, mitarbeiter_id INT, ereignisart_id INT, erfasst_am TEXT,
            vorfall_am TEXT, uebermittelt_am TEXT, bemerkung TEXT, foto_mime TEXT,
            lat REAL, lng REAL)');

// Erfundene Stammdaten, keine echten Kunden- oder Personennamen (CLAUDE.md).
// Relative Daten statt fester Werte -- ein festes Datum nahe beim heutigen
// Tag kippt beim Datumswechsel (test_datumsfest.mjs).
$T0 = date('Y-m-d');
$T1 = date('Y-m-d', strtotime('-1 day'));
$T2 = date('Y-m-d', strtotime('-2 day'));

$pdo->exec("INSERT INTO kunden (id, name) VALUES (7, 'Muster Liegenschaften AG')");
$pdo->exec("INSERT INTO kunden (id, name) VALUES (8, 'Beispiel Immobilien GmbH')");
$pdo->exec("INSERT INTO objekte (id, kunde_id, kunde_name, name)
            VALUES (1, 7, 'Muster Liegenschaften AG', 'Testliegenschaft Nord')");
$pdo->exec("INSERT INTO objekte (id, kunde_id, kunde_name, name)
            VALUES (2, 8, 'Beispiel Immobilien GmbH', 'Testliegenschaft Sued')");
$pdo->exec("INSERT INTO mitarbeiter (id, vorname, nachname) VALUES (5, 'Erika', 'Muster')");
$pdo->exec("INSERT INTO kontrollpunkt (id, objekt_id, bezeichnung) VALUES (11, 1, 'Eingang')");
$pdo->exec("INSERT INTO kontrollpunkt (id, objekt_id, bezeichnung) VALUES (12, 1, 'Keller')");
$pdo->exec("INSERT INTO rundgang_vorlage (id, objekt_id, name, fenster_von, fenster_bis)
            VALUES (21, 1, 'Schliessrunde', '22:00:00', '06:00:00')");
$pdo->exec("INSERT INTO ereignisart (id, bezeichnung) VALUES (31, 'Feststellung')");

// Einsatz 101 traegt die Kundenkopie, Einsatz 102 NICHT -- der zweite Fall
// prueft den Rueckfall auf objekte.kunde_id.
$pdo->exec("INSERT INTO einsaetze (id, kunde_id, kunde_name, objekt_id, titel, datum)
            VALUES (101, 7, 'Muster Liegenschaften AG', 1, 'Nachtdienst', '$T1')");
$pdo->exec("INSERT INTO einsaetze (id, kunde_id, kunde_name, objekt_id, titel, datum)
            VALUES (102, NULL, NULL, 2, NULL, '$T1')");

// Runde 201: regulaer beendet, mit zwei Scans und einer Aufgabe.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, rohzeit_start, rohzeit_ende)
            VALUES (201, 101, 5, 1, 21, 'abgeschlossen', '$T1 22:05:00', '$T1 22:40:00')");
$pdo->exec("INSERT INTO rundgang_scan (id, rundgang_id, kontrollpunkt_id, status, erfasst_am, uebermittelt_am)
            VALUES (301, 201, 11, 'bestaetigt', '$T1 22:05:00', '$T1 22:06:00')");
$pdo->exec("INSERT INTO rundgang_scan (id, rundgang_id, kontrollpunkt_id, status, erfasst_am, uebermittelt_am, beschreibung, foto_mime)
            VALUES (302, 201, 12, 'ersatzscan', '$T1 22:20:00', '$T1 22:21:00', 'Chip defekt', 'image/jpeg')");
$pdo->exec("INSERT INTO rundgang_aufgabe (id, rundgang_id, kontrollpunkt_id, aufgabe_id, bezeichnung, status, erfasst_am, uebermittelt_am)
            VALUES (401, 201, 12, 61, 'Licht loeschen', 'erledigt', '$T1 22:22:00', '$T1 22:23:00')");
$pdo->exec("INSERT INTO ereignis_meldung (id, objekt_id, rundgang_id, einsatz_id, mitarbeiter_id,
            ereignisart_id, erfasst_am, uebermittelt_am, bemerkung, foto_mime)
            VALUES (501, 1, 201, 101, 5, 31, '$T1 22:30:00', '$T1 22:31:00', 'Tuer stand offen', 'image/jpeg')");

$w = wachbuch_eintraege($pdo, $T2, $T0);
$arten = array_column($w['eintraege'], 'art');

// ══════════════ ALLE VIER QUELLEN, EINE LISTE
pruef('KRITISCH: alle vier Arten stehen in EINER Liste',
    in_array('scan', $arten, true) && in_array('rundgang', $arten, true)
    && in_array('aufgabe', $arten, true) && in_array('ereignis', $arten, true));
pruef('Genau die fuenf erfassten Vorgaenge, kein Vorgang doppelt',
    count($w['eintraege']) === 5 && count(array_unique(array_column($w['eintraege'], 'id'))) === 5);

// ══════════════ SORTIERUNG
$zeiten = array_column($w['eintraege'], 'zeit');
$absteigend = $zeiten;
rsort($absteigend);
pruef('KRITISCH: neueste zuoberst -- ueber alle vier Quellen hinweg, nicht je Quelle',
    $zeiten === $absteigend);
pruef('KRITISCH: der Rundgang steht ueber seinen eigenen Scans, nicht dazwischen',
    array_search('rundgang', $arten, true) === 0);

// Gleiche Sekunde, zwei Arten: Der Rundgang schliesst ab, was der Scan getan
// hat -- ohne feste Rangfolge waere die Reihenfolge zufaellig und dieselbe
// Nacht saehe zweimal anders aus.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, rohzeit_start, rohzeit_ende)
            VALUES (202, 101, 5, 1, 21, 'abgeschlossen', '$T2 23:00:00', '$T2 23:30:00')");
$pdo->exec("INSERT INTO rundgang_scan (id, rundgang_id, kontrollpunkt_id, status, erfasst_am, uebermittelt_am)
            VALUES (303, 202, 11, 'bestaetigt', '$T2 23:30:00', '$T2 23:31:00')");
$g = wachbuch_eintraege($pdo, $T2, $T2);
pruef('KRITISCH: bei gleicher Sekunde steht der Rundgang vor dem Scan (feste Rangfolge)',
    count($g['eintraege']) === 2 && $g['eintraege'][0]['art'] === 'rundgang'
    && $g['eintraege'][1]['art'] === 'scan');
$pdo->exec('DELETE FROM rundgang WHERE id = 202');
$pdo->exec('DELETE FROM rundgang_scan WHERE id = 303');

// ══════════════ DER ZEITPUNKT EINER RUNDE -- DREI QUELLEN, FESTE REIHENFOLGE
$rundgang = null;
foreach ($w['eintraege'] as $e) { if ($e['art'] === 'rundgang') { $rundgang = $e; } }
pruef('Eine beendete Runde traegt ihre Endzeit, nicht die Startzeit',
    $rundgang !== null && $rundgang['zeit'] === "$T1 22:40:00");

// Ohne rohzeit_ende gilt der letzte Scan (ENT-321). Sonst faellt eine Runde,
// die der Server nie abgeschlossen hat, still aus der Chronik.
$pdo->exec("UPDATE rundgang SET rohzeit_ende = NULL WHERE id = 201");
$ohneEnde = wachbuch_eintraege($pdo, $T2, $T0);
$r2 = null;
foreach ($ohneEnde['eintraege'] as $e) { if ($e['art'] === 'rundgang') { $r2 = $e; } }
pruef('KRITISCH: ohne rohzeit_ende gilt der letzte Scan als Zeitpunkt (ENT-321)',
    $r2 !== null && $r2['zeit'] === "$T1 22:20:00");

// Weder Ende noch Scan: kein Zeitpunkt. Ihn zu erfinden waere schlimmer, als
// die Runde wegzulassen -- eine erfundene Zeit in einem Nachweis ist eine
// Behauptung.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status)
            VALUES (203, 101, 5, 1, 'abgeschlossen')");
$leer = wachbuch_eintraege($pdo, $T2, $T0);
pruef('KRITISCH: eine Runde ohne jeden Zeitpunkt bekommt keinen erfundenen',
    !in_array('rundgang-203', array_column($leer['eintraege'], 'id'), true));
$pdo->exec('DELETE FROM rundgang WHERE id = 203');
$pdo->exec("UPDATE rundgang SET rohzeit_ende = '$T1 22:40:00' WHERE id = 201");

// Ein Abbruch traegt abgebrochen_am, nicht das Ende -- und den Grund im Eintrag.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, rundgang_vorlage_id,
            status, rohzeit_start, abbruch_grund, abbruch_freitext, abgebrochen_am)
            VALUES (204, 101, 5, 1, 21, 'abgebrochen', '$T0 01:00:00', 'notfall',
                    'Alarm am Nachbarobjekt', '$T0 01:12:00')");
$mitAbbruch = wachbuch_eintraege($pdo, $T2, $T0);
$ab = null;
foreach ($mitAbbruch['eintraege'] as $e) { if ($e['id'] === 'rundgang-204') { $ab = $e; } }
pruef('KRITISCH: ein Abbruch steht mit Zeitpunkt, Grund und Freitext in der Chronik',
    $ab !== null && $ab['zeit'] === "$T0 01:12:00" && $ab['status'] === 'abgebrochen'
    && $ab['abbruch_grund'] === 'notfall' && $ab['text'] === 'Alarm am Nachbarobjekt');
// Eine LAUFENDE Runde ist kein Vorgang -- sie ist Arbeit, die noch aussteht.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, rohzeit_start)
            VALUES (205, 101, 5, 1, 'laeuft', '$T0 02:00:00')");
$pdo->exec("INSERT INTO rundgang_scan (id, rundgang_id, kontrollpunkt_id, status, erfasst_am, uebermittelt_am)
            VALUES (304, 205, 11, 'bestaetigt', '$T0 02:05:00', '$T0 02:06:00')");
$laufend = wachbuch_eintraege($pdo, $T2, $T0);
pruef('Eine laufende Runde steht nicht als "erledigt" da -- ihr Scan schon',
    !in_array('rundgang-205', array_column($laufend['eintraege'], 'id'), true)
    && in_array('scan-304', array_column($laufend['eintraege'], 'id'), true));

// ══════════════ ZEITRAUM
$eng = wachbuch_eintraege($pdo, $T0, $T0);
pruef('KRITISCH: der Zeitraum greift -- was davor liegt, ist nicht drin',
    count($eng['eintraege']) === 2
    && in_array('rundgang-204', array_column($eng['eintraege'], 'id'), true));
$randVon = wachbuch_eintraege($pdo, $T1, $T1);
pruef('Der Zeitraum schliesst beide Randtage voll ein (00:00 bis 23:59)',
    count($randVon['eintraege']) === 5);

// ══════════════ WOHIN DIE VERWEISE FUEHREN
$scan = null;
foreach ($w['eintraege'] as $e) { if ($e['id'] === 'scan-302') { $scan = $e; } }
pruef('KRITISCH: jeder Eintrag traegt die Kennungen fuer Kunde, Objekt und Rundgang',
    $scan !== null && $scan['kunde_id'] === 7 && $scan['objekt_id'] === 1
    && $scan['rundgang_id'] === 201);
pruef('Der Rundgangname und sein Zeitfenster kommen aus der Vorlage mit',
    $scan !== null && $scan['rundgang_name'] === 'Schliessrunde'
    && $scan['fenster_von'] === '22:00:00');
pruef('Die Person steht als "Nachname, Vorname" da',
    $scan !== null && $scan['person'] === 'Muster, Erika');
pruef('Die Bemerkung und das Foto eines Ersatzscans gehen nicht verloren',
    $scan !== null && $scan['text'] === 'Chip defekt' && $scan['hat_foto'] === true);

// ══════════════ DIE NUMMER DER QUELLE (ENT-533)
// Die zusammengesetzte 'id' ("scan-302") haelt zwei Arten mit derselben
// Nummer auseinander; sie ist eine Kennung fuer die Liste. Wer ein Foto
// ABRUFEN will, braucht die Nummer der Quelle selbst. Sie aus der Kennung
// herauszuschneiden hiesse, deren Schreibweise zur Schnittstelle zu machen.
$ereignis = null;
foreach ($w['eintraege'] as $e) { if ($e['art'] === 'ereignis') { $ereignis = $e; break; } }
pruef('KRITISCH: jeder Eintrag traegt die Nummer seiner Quelle, nicht nur die Kennung',
    $scan !== null && $ereignis !== null
    && $scan['quelle_id'] === 302 && $scan['id'] === 'scan-302'
    && $ereignis['quelle_id'] === 501 && $ereignis['id'] === 'ereignis-501');
pruef('KRITISCH: das Foto einer Ereignismeldung geht nicht verloren',
    $ereignis !== null && $ereignis['hat_foto'] === true);

// Fehlt die Kundenkopie am Einsatz, gilt die des Objekts -- sonst zeigte die
// Zeile keinen Kunden, obwohl einer bekannt ist.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, rohzeit_start, rohzeit_ende)
            VALUES (206, 102, 5, 2, 'abgeschlossen', '$T1 05:00:00', '$T1 05:20:00')");
$rueck = wachbuch_eintraege($pdo, $T1, $T1);
$r3 = null;
foreach ($rueck['eintraege'] as $e) { if ($e['id'] === 'rundgang-206') { $r3 = $e; } }
pruef('KRITISCH: ohne Kundenkopie am Einsatz gilt der Kunde des Objekts',
    $r3 !== null && $r3['kunde_id'] === 8 && $r3['kunde_name'] === 'Beispiel Immobilien GmbH');
$pdo->exec('DELETE FROM rundgang WHERE id = 206');

// ══════════════ OBJEKTFILTER
$nurNord = wachbuch_eintraege($pdo, $T2, $T0, 1);
$nurSued = wachbuch_eintraege($pdo, $T2, $T0, 2);
pruef('Der Objektfilter greift auf allen vier Quellen',
    count($nurNord['eintraege']) === count($laufend['eintraege'])
    && count($nurSued['eintraege']) === 0);

// ══════════════ WAS BEWUSST NICHT DRIN STEHT
// Eine unbeantwortete Aufgabe ist das FEHLEN eines Eintrags und hat keinen
// Zeitpunkt. Sie in eine Zeitleiste zu stellen hiesse, ihr einen zu erfinden.
pruef('KRITISCH: eine Aufgabe ohne Antwort erscheint nicht -- sie hat keinen Zeitpunkt',
    count(array_filter($w['eintraege'],
        static fn($e) => $e['art'] === 'aufgabe' && $e['status'] === 'unbeantwortet')) === 0);

// ══════════════ EIN EREIGNIS OHNE HINTERLEGTE ART
$pdo->exec("INSERT INTO ereignis_meldung (id, objekt_id, mitarbeiter_id, ereignisart_id,
            erfasst_am, uebermittelt_am, bemerkung)
            VALUES (502, 1, 5, NULL, '$T1 23:00:00', '$T1 23:01:00', 'Ohne Art gemeldet')");
$ohneArt = wachbuch_eintraege($pdo, $T1, $T1);
$ev = null;
foreach ($ohneArt['eintraege'] as $e) { if ($e['id'] === 'ereignis-502') { $ev = $e; } }
pruef('KRITISCH: ein Ereignis ohne hinterlegte Art bekommt keine erfundene Kategorie',
    $ev !== null && $ev['bezeichnung'] === null);
pruef('Ein Ereignis ohne Einsatz faellt nicht aus der Liste (LEFT JOIN, nicht JOIN)',
    $ev !== null && $ev['objekt_id'] === 1);
$pdo->exec('DELETE FROM ereignis_meldung WHERE id = 502');

// ══════════════ KAPPUNG: "400 VON 1238" STATT "400"
for ($i = 0; $i < 12; $i++) {
    $pdo->exec("INSERT INTO rundgang_scan (id, rundgang_id, kontrollpunkt_id, status, erfasst_am, uebermittelt_am)
                VALUES (" . (900 + $i) . ", 201, 11, 'bestaetigt', '$T1 21:"
                . str_pad((string)$i, 2, '0', STR_PAD_LEFT) . ":00', '$T1 21:30:00')");
}
$gekappt = wachbuch_eintraege($pdo, $T2, $T0, null, 5);
pruef('KRITISCH: bei zu vielen Eintraegen wird gekappt und das ausdruecklich gesagt',
    $gekappt['gekuerzt'] === true && $gekappt['gezeigt'] === 5);
pruef('KRITISCH: "gesamt" nennt die WIRKLICHE Zahl, nicht die gezeigte -- '
    . 'sonst saehe eine gekuerzte Liste aus wie eine vollstaendige',
    $gekappt['gesamt'] > $gekappt['gezeigt']
    && $gekappt['gesamt'] === count(wachbuch_eintraege($pdo, $T2, $T0)['eintraege']));
pruef('Gekappt wird nach der Zusammenfuehrung, nicht je Quelle -- die '
    . 'neuesten Eintraege ueberhaupt bleiben stehen',
    $gekappt['eintraege'][0]['zeit'] === wachbuch_eintraege($pdo, $T2, $T0)['eintraege'][0]['zeit']);
$pdo->exec('DELETE FROM rundgang_scan WHERE id >= 900');
$voll = wachbuch_eintraege($pdo, $T2, $T0);
pruef('Ohne Kappung sagt die Antwort das auch',
    $voll['gekuerzt'] === false && $voll['gezeigt'] === $voll['gesamt']);

// ══════════════ ART-FILTER: FILTERT DIE LISTE, NICHT DIE ZAHLEN
$nurEreignis = wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, ['ereignis']);
pruef('KRITISCH: der Art-Filter laesst nur die gewaehlte Art durch',
    count($nurEreignis['eintraege']) === 1
    && $nurEreignis['eintraege'][0]['art'] === 'ereignis');
// Ohne diese Zahlen saehe man neben einem gesetzten Filter nicht mehr, dass
// hinter ihm noch etwas liegt -- "kein Treffer" und "nichts geplant" sind
// verschiedene Aussagen.
pruef('KRITISCH: die Zahl je Art bleibt die WIRKLICHE, auch fuer eine ausgeblendete Art',
    $nurEreignis['je_art']['scan'] === $voll['je_art']['scan']
    && $nurEreignis['je_art']['scan'] > 0
    && $nurEreignis['gesamt'] === 1);
$mehrere = wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, ['scan', 'aufgabe']);
pruef('Mehrere Arten zugleich sind moeglich',
    count(array_unique(array_column($mehrere['eintraege'], 'art'))) === 2);
pruef('Ein leerer Filter heisst "alles", nicht "nichts"',
    count(wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, [])['eintraege'])
    === count($voll['eintraege']));

// ══════════════ EINE FEHLENDE QUELLE IST NICHT "NICHTS PASSIERT"
$GLOBALS['tabellen']['ereignis_meldung'] = false;
$ohneQuelle = wachbuch_eintraege($pdo, $T2, $T0);
pruef('KRITISCH: eine fehlende Tabelle sagt "fehlt" und laesst die uebrigen Quellen laufen',
    $ohneQuelle['quellen']['ereignisse'] === 'fehlt'
    && $ohneQuelle['quellen']['scans'] === 'ok'
    && count($ohneQuelle['eintraege']) === count($voll['eintraege']) - 1);
$GLOBALS['tabellen']['ereignis_meldung'] = true;

// Eine Tabelle, die es gibt, deren Abfrage aber scheitert (halbe Einrichtung,
// fehlende Spalte): auch das ist eine EIGENE Aussage, kein "nichts da".
$pdo->exec('ALTER TABLE ereignis_meldung RENAME TO ereignis_meldung_weg');
$kaputt = wachbuch_eintraege($pdo, $T2, $T0);
pruef('KRITISCH: eine nicht abfragbare Quelle meldet "fehler", nicht stillschweigend nichts',
    $kaputt['quellen']['ereignisse'] === 'fehler');
$pdo->exec('ALTER TABLE ereignis_meldung_weg RENAME TO ereignis_meldung');

// ══════════════ OBJEKTZUSCHNITT ALS LISTE (ENT-484, Kundenportal)
// Das Portal schneidet nicht auf EIN Objekt zu, sondern auf alle Objekte des
// angemeldeten Kunden.
$pdo->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, rohzeit_start, rohzeit_ende)
            VALUES (210, 102, 5, 2, 'abgeschlossen', '$T1 03:00:00', '$T1 03:20:00')");
$beide = wachbuch_eintraege($pdo, $T2, $T0, [1, 2]);
$nurZwei = wachbuch_eintraege($pdo, $T2, $T0, [2]);
pruef('KRITISCH: eine Objektliste schneidet auf genau diese Objekte zu',
    count($beide['eintraege']) === count($voll['eintraege']) + 1
    && count($nurZwei['eintraege']) === 1
    && $nurZwei['eintraege'][0]['id'] === 'rundgang-210');
pruef('Eine Zahl und eine einelementige Liste bedeuten dasselbe',
    count(wachbuch_eintraege($pdo, $T2, $T0, 2)['eintraege']) === 1);

// Der gefaehrlichste Fall des ganzen Portals: Ein Zugang OHNE Objekte darf
// nicht die Chronik aller sehen. Eine leere Liste heisst "nichts", nicht
// "keine Einschraenkung" -- in SQL waere ein leeres IN() ein Syntaxfehler
// oder, schlimmer, eine weggelassene Bedingung.
$keine = wachbuch_eintraege($pdo, $T2, $T0, []);
pruef('KRITISCH: eine LEERE Objektliste liefert nichts -- nicht alles',
    count($keine['eintraege']) === 0 && $keine['gesamt'] === 0
    && $keine['gezeigt'] === 0);

// ══════════════ NUR BEENDETE RUNDEN (Portal, ENT-441 Punkt 5)
// Ein Kunde soll den Nachweis sehen, nicht die Person bei der Arbeit. Runde
// 205 laeuft und traegt den Scan 304.
$mitLaufend = wachbuch_eintraege($pdo, $T2, $T0);
$ohneLaufend = wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, null,
    ['nur_beendete_runden' => true]);
pruef('KRITISCH: mit dem Portal-Schalter faellt der Scan einer noch LAUFENDEN Runde weg',
    in_array('scan-304', array_column($mitLaufend['eintraege'], 'id'), true)
    && !in_array('scan-304', array_column($ohneLaufend['eintraege'], 'id'), true));
pruef('KRITISCH: die Vorgaenge BEENDETER Runden bleiben vollstaendig da',
    in_array('scan-301', array_column($ohneLaufend['eintraege'], 'id'), true)
    && in_array('aufgabe-401', array_column($ohneLaufend['eintraege'], 'id'), true)
    && in_array('rundgang-204', array_column($ohneLaufend['eintraege'], 'id'), true));
// Auch die Zahl je Art muss den Schalter kennen -- sonst stuende neben einer
// gekuerzten Chronik eine Zahl, die mehr verspricht, als sie zeigt.
pruef('KRITISCH: die Zahl je Art zaehlt dasselbe, was die Liste zeigt',
    $ohneLaufend['je_art']['scan'] === $mitLaufend['je_art']['scan'] - 1);

// Eine Aufgabe an einer laufenden Runde faellt ebenso weg.
$pdo->exec("INSERT INTO rundgang_aufgabe (id, rundgang_id, kontrollpunkt_id, aufgabe_id, bezeichnung, status, erfasst_am, uebermittelt_am)
            VALUES (402, 205, 11, 62, 'Tuer pruefen', 'erledigt', '$T0 02:06:00', '$T0 02:07:00')");
$ohneLaufend2 = wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, null,
    ['nur_beendete_runden' => true]);
pruef('KRITISCH: auch die Aufgabe einer laufenden Runde bleibt draussen',
    !in_array('aufgabe-402', array_column($ohneLaufend2['eintraege'], 'id'), true)
    && in_array('aufgabe-402',
        array_column(wachbuch_eintraege($pdo, $T2, $T0)['eintraege'], 'id'), true));

// ══════════════ EREIGNISSE NUR MIT RUNDE (Portal)
// 501 haengt an Runde 201 (beendet), 503 an gar keiner, 504 an der laufenden 205.
$pdo->exec("INSERT INTO ereignis_meldung (id, objekt_id, mitarbeiter_id, ereignisart_id,
            erfasst_am, uebermittelt_am, bemerkung)
            VALUES (503, 1, 5, 31, '$T1 20:00:00', '$T1 20:01:00', 'Ohne Runde gemeldet')");
$pdo->exec("INSERT INTO ereignis_meldung (id, objekt_id, rundgang_id, mitarbeiter_id, ereignisart_id,
            erfasst_am, uebermittelt_am, bemerkung)
            VALUES (504, 1, 205, 5, 31, '$T0 02:10:00', '$T0 02:11:00', 'Waehrend der laufenden Runde')");
$alle = array_column(wachbuch_eintraege($pdo, $T2, $T0)['eintraege'], 'id');
pruef('Ohne Schalter stehen alle drei Meldungen da',
    in_array('ereignis-501', $alle, true) && in_array('ereignis-503', $alle, true)
    && in_array('ereignis-504', $alle, true));
$portal = array_column(wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, null,
    ['nur_beendete_runden' => true, 'nur_ereignisse_mit_runde' => true])['eintraege'], 'id');
pruef('KRITISCH: mit Schalter bleibt nur die Meldung an einer BEENDETEN Runde',
    in_array('ereignis-501', $portal, true)
    && !in_array('ereignis-503', $portal, true)
    && !in_array('ereignis-504', $portal, true));
// Die beiden Schalter sind getrennt und duerfen sich nicht gegenseitig
// erledigen: "nur beendete Runden" allein darf eine Meldung OHNE Runde nicht
// mitloeschen -- sie haengt an keiner, also kann keine von ihr laufen.
$nurBeendet = array_column(wachbuch_eintraege($pdo, $T2, $T0, null, WACHBUCH_GRENZE, null,
    ['nur_beendete_runden' => true])['eintraege'], 'id');
pruef('KRITISCH: "nur beendete Runden" allein loescht eine Meldung OHNE Runde nicht mit',
    in_array('ereignis-503', $nurBeendet, true)
    && !in_array('ereignis-504', $nurBeendet, true));
$pdo->exec('DELETE FROM ereignis_meldung WHERE id IN (503, 504)');
$pdo->exec('DELETE FROM rundgang_aufgabe WHERE id = 402');
$pdo->exec('DELETE FROM rundgang WHERE id = 210');

// ══════════════ OHNE FOTO-SPALTE (VOR DER EINRICHTUNG)
$GLOBALS['spalten']['rundgang_scan.foto_mime'] = false;
$pdo->exec('ALTER TABLE rundgang_scan RENAME COLUMN foto_mime TO foto_mime_weg');
$ohneFoto = wachbuch_eintraege($pdo, $T2, $T0);
pruef('Ohne die Foto-Spalte faellt der Reiter nicht aus -- er sagt nur kein Foto',
    $ohneFoto['quellen']['scans'] === 'ok'
    && count(array_filter($ohneFoto['eintraege'], static fn($e) => $e['hat_foto'])) === 1);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { foreach ($bad as $b) { echo "  - $b\n"; } exit(1); }
echo "Keine Beanstandung.\n";
