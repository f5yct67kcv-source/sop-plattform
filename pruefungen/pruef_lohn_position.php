<?php
declare(strict_types=1);
// Persoenliche Zulagen und Abzuege (ENT-713) -- echt ausgefuehrt gegen eine
// wirkliche Datenbank (SQLite im Arbeitsspeicher).
//
// EIGENE DATEI und nicht ein Abschnitt in pruef_lohnlauf.php: Der Katalog
// wird in lohnlauf_katalog() einmal je Prozess gemerkt. Dort ist er schon
// gelesen, bevor es eine Tabelle lohnart gibt -- eine selbst angelegte
// Lohnart kaeme darin nie vor, und die Pruefung liefe gegen etwas anderes
// als der Lohnlauf.
//
// Worauf es ankommt, in dieser Reihenfolge, weil so auch der Schaden waere:
//  1. Eine Zulage zaehlt in den AHV-pflichtigen Lohn -- auch wenn die
//     Lohnart die Spalte 'bemessung' auf der Voreinstellung 0 traegt.
//  2. Ein abgeschlossener Monat aendert sich nicht mehr.
//  3. Zwei gleichzeitig gueltige Positionen derselben Lohnart gibt es nicht
//     -- sie zahlten doppelt aus.
//  4. Was nicht gerechnet werden kann, wird gesperrt, nie null.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }
function json_response($data, int $status = 200): void {}

require_once __DIR__ . '/../backend/lohnlauf.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, datum TEXT, sparte TEXT,
            kunde_name TEXT, objekt_id INT, status TEXT)');
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, ist_status TEXT,
            ist_von TEXT, ist_bis TEXT, ist_pause_min INT, ist_pause_bezahlt_ma INT)');
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
            bemessung INT DEFAULT 0, aktiv INT DEFAULT 1)');
$pdo->exec('CREATE TABLE lohn_position (id INTEGER PRIMARY KEY, mitarbeiter_id INT, lohnart_id INT,
            betrag_rappen INT, gueltig_ab TEXT, gueltig_bis TEXT, bemerkung TEXT,
            erfasst_am TEXT, erfasst_von INT, geaendert_am TEXT, geaendert_von INT)');
$pdo->exec('CREATE TABLE lohnlauf (id INTEGER PRIMARY KEY, periode_von TEXT, periode_bis TEXT, status TEXT)');
$pdo->exec('CREATE TABLE lohnlauf_person (id INTEGER PRIMARY KEY, lauf_id INT, mitarbeiter_id INT)');
$pdo->exec('CREATE TABLE lohn_abzug (id INTEGER PRIMARY KEY, schluessel TEXT, bezeichnung TEXT,
            gueltig_ab TEXT, gueltig_bis TEXT, satz_bp INT, fix_rappen INT,
            hoechstlohn_rappen INT, quelle TEXT)');
$pdo->exec('CREATE TABLE lohn_person (id INTEGER PRIMARY KEY, mitarbeiter_id INT, gueltig_ab TEXT,
            nbu_pflichtig INT, nbu_grund TEXT, nbu_von INT, nbu_am TEXT, qst_pflichtig INT)');

// Der Systemkatalog so, wie die Einrichtung ihn anlegt.
$ein = $pdo->prepare('INSERT INTO lohnart (schluessel, bezeichnung, art, basis_schluessel, satz_bp,
    ahv_pflichtig, ferien_pflichtig, ml13_pflichtig, bvg_pflichtig, uvg_pflichtig, qst_pflichtig,
    gav_grundlage, system, sortierung, bemessung) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)');
foreach (lohnart_startbestand() as $la) { $ein->execute($la); }

// Betriebliche Lohnarten -- angelegt wie ueber lohnarten.php, also OHNE
// 'bemessung' (Voreinstellung 0). Genau so stehen sie in jedem Betrieb.
$eigen = $pdo->prepare('INSERT INTO lohnart (id, schluessel, bezeichnung, art, ahv_pflichtig,
    ferien_pflichtig, ml13_pflichtig, bvg_pflichtig, uvg_pflichtig, qst_pflichtig, aktiv, sortierung)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
$eigen->execute([101, 'funktionszulage', 'Funktionszulage', 'fixbetrag', 1,0,0,1,1,1, 1, 200]);
$eigen->execute([102, 'hundefuehrer',    'Hundeführerzulage', 'stundensatz', 1,1,1,1,1,1, 1, 201]);
$eigen->execute([103, 'uniform',         'Abzug Uniform', 'abzug', 0,0,0,0,0,0, 1, 202]);
$eigen->execute([104, 'pauschale',       'Pauschalspesen', 'netto', 0,0,0,0,0,0, 1, 203]);
$eigen->execute([105, 'prozentig',       'Prozentzulage', 'prozent', 1,0,0,1,1,1, 1, 204]);
$eigen->execute([106, 'alt',             'Alte Zulage', 'fixbetrag', 1,0,0,1,1,1, 0, 205]);
$grundlohnId = (int)$pdo->query("SELECT id FROM lohnart WHERE schluessel = 'grundlohn_stunde'")->fetchColumn();

// Datum bewusst weit weg von heute (CLAUDE.md / test_datumsfest.mjs).
$VON = '2026-05-01'; $BIS = '2026-05-31';
// Eine Tagschicht am Mittwoch, 8 Stunden ohne Pause und ohne Zeitbonus.
$pdo->exec("INSERT INTO einsaetze VALUES (1,'2026-05-06','sicherheit','Kunde',NULL,'geplant')");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (1,1,'anwesend','08:00','16:00',0,0)");
$pdo->exec("INSERT INTO lohn_ansatz VALUES (1,1,'2024-01-01','C',2500,1,833,NULL,NULL,NULL,NULL,NULL,NULL)");
$MA = ['id' => 1, 'anstellungskategorie' => 'C', 'eintritt' => '2024-03-01',
       'geburtsdatum' => '2000-05-04', 'pensum_stunden' => 800];

$schreib = fn(array $in) => lohn_position_schreiben($pdo, 1, $in, 9);

// ══════════════════════ ERFASSEN ═════════════════════════════════════════
pruef('Eine Zulage pro Monat laesst sich erfassen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 101, 'betrag' => '150.00', 'ab' => '2026-01']) === null);
pruef('Eine Zulage pro Stunde laesst sich erfassen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 102, 'betrag' => '1,50', 'ab' => '2026-01']) === null);
pruef('Ein Abzug einmalig im Mai laesst sich erfassen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 103, 'betrag' => '20', 'ab' => '2026-05', 'bis' => '2026-05']) === null);
pruef('Ein Nettobetrag laesst sich erfassen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 104, 'betrag' => '5.00', 'ab' => '2026-05']) === null);

$pos = fn(int $lohnart) => $pdo->query("SELECT * FROM lohn_position WHERE lohnart_id = $lohnart ORDER BY gueltig_ab")->fetchAll();
pruef('Gespeichert wird in Rappen, ohne Fliesskomma-Drift',
    (int)$pos(102)[0]['betrag_rappen'] === 150 && (int)$pos(101)[0]['betrag_rappen'] === 15000);
pruef('Nur ganze Monate: Ab wird der Monatserste, einmalig endet am Monatsletzten',
    $pos(103)[0]['gueltig_ab'] === '2026-05-01' && $pos(103)[0]['gueltig_bis'] === '2026-05-31');
pruef('Ein Tag im Ab-Feld wird auf den Monatsersten gesetzt, nicht als Teilmonat gefuehrt',
    lohn_monat_anfang('2026-05-17') === '2026-05-01' && lohn_monat_anfang('2026-13') === null);
pruef('Ohne Bis gilt die Position bis auf Weiteres (NULL, nicht ein erfundenes Enddatum)',
    $pos(101)[0]['gueltig_bis'] === null);

pruef('KRITISCH: eine Systemlohnart (Grundlohn) laesst sich nicht als Position erfassen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => $grundlohnId, 'betrag' => '10', 'ab' => '2026-06']) !== null);
pruef('Eine Lohnart, die prozentual rechnet, ist nicht waehlbar',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 105, 'betrag' => '10', 'ab' => '2026-06']) !== null);
pruef('Eine deaktivierte Lohnart ist fuer neue Positionen nicht waehlbar',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 106, 'betrag' => '10', 'ab' => '2026-06']) !== null);
pruef('Der Betrag ist positiv -- ob abgezogen wird, sagt die Lohnart',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 101, 'betrag' => '-5', 'ab' => '2030-01']) !== null);
pruef('Bis vor Ab wird abgewiesen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 101, 'betrag' => '5', 'ab' => '2030-05', 'bis' => '2030-04']) !== null);
pruef('KRITISCH: dieselbe Lohnart zweimal im selben Monat wird abgewiesen -- sie zahlte doppelt',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 101, 'betrag' => '99', 'ab' => '2026-08']) !== null);

$waehlbar = array_column(lohn_position_lohnarten($pdo), 'schluessel');
pruef('Waehlbar sind genau die eigenen, aktiven Lohnarten mit passender Rechenart',
    $waehlbar === ['funktionszulage', 'hundefuehrer', 'uniform', 'pauschale']);

// ══════════════════════ DER LOHNLAUF ═════════════════════════════════════
$p = lohnlauf_person($pdo, $MA, $VON, $BIS);
$z = [];
foreach ($p['zeilen'] as $zz) { $z[$zz['schluessel']] = $zz; }
$fe = lohn_ferienentschaedigung_bp($MA['geburtsdatum'], $BIS);

pruef('Die Zulage pro Monat steht mit vollem Betrag in der Abrechnung',
    ($z['funktionszulage']['betrag_rappen'] ?? null) === 15000);
pruef('Die Zulage pro Stunde rechnet mit der bewerteten Zeit: 1.50 x 8 h = 12.00',
    ($z['hundefuehrer']['betrag_rappen'] ?? null) === 1200
    && abs(($z['hundefuehrer']['menge'] ?? 0) - 8.0) < 1e-9
    && ($z['hundefuehrer']['basis_rappen'] ?? null) === 150);
pruef('Ferienentschaedigung auf der Zulage entsteht als eigene Zeile mit dem Satz des Grundlohns',
    ($z['ferien_auf_zulage']['betrag_rappen'] ?? null) === lohn_anteil(1200, $fe['bp'])
    && ($z['ferien_auf_zulage']['satz_bp'] ?? null) === $fe['bp']);
pruef('13. Monatslohn auf der Zulage entsteht als eigene Zeile mit dem Satz aus dem Ansatz',
    ($z['anteil_13ml_auf_zulage']['betrag_rappen'] ?? null) === lohn_anteil(1200, 833));
pruef('Eine Zulage OHNE Ferien-Kennzeichen bekommt keine Ferienzeile',
    count(array_filter($p['zeilen'], fn($x) => $x['schluessel'] === 'ferien_auf_zulage')) === 1);
pruef('Abzug und Nettobetrag stehen NICHT auf der Bruttoseite',
    !isset($z['uniform']) && !isset($z['pauschale']));

// KRITISCH -- das ist der Fehler, der sonst live gegangen waere: Eine
// selbst angelegte Lohnart traegt bemessung = 0, und der Lauf zaehlt nur
// Zeilen mit bemessung = 1. Die Zulage stuende in der Abrechnung, fehlte
// aber im Bruttolohn und in der AHV-Grundlage -- zu tiefe Beitraege, ohne
// dass etwas kaputtginge.
$kat = lohnlauf_katalog($pdo);
$g = lohnlauf_grundlagen($p['zeilen'], $kat);
$lohn = $z['geleistete_stunden']['betrag_rappen'];
$erwartet = $lohn + 15000 + 1200 + lohn_anteil(1200, $fe['bp']) + lohn_anteil(1200, 833);
pruef('KRITISCH: die Zulagen zaehlen im Bruttolohn mit, obwohl die Lohnart bemessung = 0 traegt',
    $p['brutto_rappen'] === $erwartet);
pruef('KRITISCH: und ebenso in der AHV-Grundlage',
    $g['ahv'] === $erwartet && $g['unbekannte_lohnarten'] === []);
pruef('Die Bestandteile des Stundensatzes zaehlen weiterhin NICHT doppelt',
    $p['brutto_rappen'] !== $erwartet + 2500);

// ── Die Nettoseite ───────────────────────────────────────────────────────
$pdo->exec("INSERT INTO lohn_abzug VALUES (1,'nbu','NBU','2020-01-01',NULL,150,NULL,NULL,'Police')");
$pdo->exec("INSERT INTO lohn_abzug VALUES (2,'ktg','KTG','2020-01-01',NULL,100,NULL,NULL,'Police')");
$pdo->exec("INSERT INTO lohn_abzug VALUES (3,'bvg','BVG','2020-01-01',NULL,NULL,0,NULL,'Kasse')");
$ab = lohnlauf_abzuege($pdo, $p, $BIS, ['stand' => LOHN_NBU_VERSICHERT]);
$n = [];
foreach ($ab['zeilen'] as $zz) { $n[$zz['schluessel']] = $zz; }
pruef('Der Abzug steht nach dem Nettolohn, mit negativem Vorzeichen',
    ($n['uniform']['betrag_rappen'] ?? null) === -2000
    && $n['uniform']['sortierung'] > $n['nettolohn']['sortierung']);
pruef('Der Nettobetrag steht nach dem Nettolohn, positiv',
    ($n['pauschale']['betrag_rappen'] ?? null) === 500
    && $n['pauschale']['sortierung'] > $n['nettolohn']['sortierung']);
$ohneAbzuege = $n['nettolohn']['betrag_rappen'] + $n['pako']['betrag_rappen'];
pruef('Abzug und Nettobetrag aendern keinen Sozialversicherungsbeitrag, aber den Auszahlungsbetrag',
    $n['nettolohn']['betrag_rappen'] !== null
    && $ab['auszahlung_rappen'] === lohn_fuenfrappen($ohneAbzuege - 2000 + 500));

// ── Ausserhalb des Zeitraums ────────────────────────────────────────────
$juni = lohnlauf_person($pdo, $MA, '2026-06-01', '2026-06-30');
pruef('Der einmalige Abzug vom Mai erscheint im Juni nicht mehr',
    !in_array('uniform', array_column($juni['positionen_netto'] ?? [], 'schluessel'), true));

// ── Kein ganzer Monat: gesperrt statt anteilig ──────────────────────────
$halb = lohnlauf_person($pdo, $MA, '2026-05-01', '2026-05-15');
$h = [];
foreach ($halb['zeilen'] as $zz) { $h[$zz['schluessel']] = $zz; }
pruef('KRITISCH: in einem Lauf ueber einen halben Monat entsteht die Zulage GESPERRT, nicht voll und nicht null',
    isset($h['funktionszulage']) && $h['funktionszulage']['betrag_rappen'] === null
    && ($h['funktionszulage']['gesperrt_grund'] ?? '') === 'periode_kein_monat');
$halbAb = lohnlauf_abzuege($pdo, $halb, '2026-05-15', ['stand' => LOHN_NBU_VERSICHERT]);
pruef('Und ein gesperrter Abzug sperrt den Auszahlungsbetrag',
    $halbAb['auszahlung_rappen'] === null);
pruef('Jeder neue Sperrgrund hat einen erklaerenden Text',
    isset(lohnlauf_sperrgruende()['periode_kein_monat'])
    && isset(lohnlauf_sperrgruende()['position_art_ungueltig']));

// ── Eine nachtraeglich umgestellte Lohnart ───────────────────────────────
$pdo->exec("UPDATE lohnart SET art = 'prozent' WHERE id = 101");
$um = lohnlauf_person($pdo, $MA, $VON, $BIS);
$u = [];
foreach ($um['zeilen'] as $zz) { $u[$zz['schluessel']] = $zz; }
pruef('Wird die Lohnart spaeter auf "prozentual" umgestellt, sperrt die Position statt zu raten',
    ($u['funktionszulage']['gesperrt_grund'] ?? '') === 'position_art_ungueltig'
    && $u['funktionszulage']['betrag_rappen'] === null);
$pdo->exec("UPDATE lohnart SET art = 'fixbetrag' WHERE id = 101");

// ══════════════════════ AENDERN UND DIE SPERRE ═══════════════════════════
// Ein freigegebener Lauf fuer den Mai. Ab jetzt ist alles bis 31.05.
// abgeschlossen.
$pdo->exec("INSERT INTO lohnlauf VALUES (1,'2026-05-01','2026-05-31','freigegeben')");
$pdo->exec("INSERT INTO lohnlauf_person VALUES (1,1,1)");
// Ein Entwurf fuer Juni zaehlt NICHT als abgeschlossen.
$pdo->exec("INSERT INTO lohnlauf VALUES (2,'2026-06-01','2026-06-30','entwurf')");
$pdo->exec("INSERT INTO lohnlauf_person VALUES (2,2,1)");
pruef('Abgeschlossen ist, was freigegeben ist -- ein Entwurf zaehlt nicht',
    lohn_position_abgeschlossen_bis($pdo, 1) === '2026-05-31');
pruef('Eine andere Person ist davon nicht betroffen',
    lohn_position_abgeschlossen_bis($pdo, 2) === null);

$fz = $pos(101)[0];
pruef('KRITISCH: eine verwendete Position laesst sich nicht korrigieren',
    $schreib(['aktion' => 'korrigieren', 'eintrag_id' => (int)$fz['id'], 'lohnart_id' => 101,
              'betrag' => '999', 'ab' => '2026-01']) !== null
    && (int)$pos(101)[0]['betrag_rappen'] === 15000);
pruef('KRITISCH: und nicht loeschen',
    $schreib(['aktion' => 'loeschen', 'eintrag_id' => (int)$fz['id']]) !== null
    && count($pos(101)) === 1);
pruef('KRITISCH: ein neuer Betrag ab einem abgeschlossenen Monat wird abgewiesen',
    $schreib(['aktion' => 'ab', 'eintrag_id' => (int)$fz['id'], 'betrag' => '200', 'ab' => '2026-05']) !== null);
pruef('KRITISCH: Beenden vor dem Abschluss wird abgewiesen -- der Mai haette sonst nachtraeglich keine Zulage',
    $schreib(['aktion' => 'beenden', 'eintrag_id' => (int)$fz['id'], 'bis' => '2026-04']) !== null
    && $pos(101)[0]['gueltig_bis'] === null);
pruef('KRITISCH: eine neue Position in einem abgeschlossenen Monat wird abgewiesen',
    $schreib(['aktion' => 'neu', 'lohnart_id' => 104, 'betrag' => '1', 'ab' => '2026-03', 'bis' => '2026-03']) !== null);

pruef('Ein neuer Betrag ab dem ersten offenen Monat geht',
    $schreib(['aktion' => 'ab', 'eintrag_id' => (int)$fz['id'], 'betrag' => '200', 'ab' => '2026-06']) === null);
$fzAlle = $pos(101);
pruef('Die alte Position endet am Vortag und bleibt stehen, die neue uebernimmt das offene Ende',
    count($fzAlle) === 2
    && $fzAlle[0]['gueltig_bis'] === '2026-05-31' && (int)$fzAlle[0]['betrag_rappen'] === 15000
    && $fzAlle[1]['gueltig_ab'] === '2026-06-01' && $fzAlle[1]['gueltig_bis'] === null
    && (int)$fzAlle[1]['betrag_rappen'] === 20000);
$juni2 = lohnlauf_person($pdo, $MA, '2026-06-01', '2026-06-30');
pruef('Der Juni rechnet mit dem neuen Betrag, genau einmal',
    array_values(array_map(fn($x) => $x['betrag_rappen'],
        array_filter($juni2['zeilen'], fn($x) => $x['schluessel'] === 'funktionszulage'))) === [20000]);
$mai2 = lohnlauf_person($pdo, $MA, $VON, $BIS);
pruef('Der Mai rechnet weiterhin mit dem alten Betrag',
    array_values(array_map(fn($x) => $x['betrag_rappen'],
        array_filter($mai2['zeilen'], fn($x) => $x['schluessel'] === 'funktionszulage'))) === [15000]);

pruef('Beenden nach dem Abschluss geht',
    $schreib(['aktion' => 'beenden', 'eintrag_id' => (int)$fzAlle[1]['id'], 'bis' => '2026-09']) === null
    && $pos(101)[1]['gueltig_bis'] === '2026-09-30');
pruef('Wieder oeffnen (Bis leer) geht ebenso',
    $schreib(['aktion' => 'beenden', 'eintrag_id' => (int)$fzAlle[1]['id'], 'bis' => '']) === null
    && $pos(101)[1]['gueltig_bis'] === null);
pruef('Die alte, verwendete Position laesst sich nicht wieder oeffnen -- sie ueberlappte die neue',
    $schreib(['aktion' => 'beenden', 'eintrag_id' => (int)$fzAlle[0]['id'], 'bis' => '']) !== null);

$pauschale = $pos(104)[0];
pruef('Eine Position, die im abgeschlossenen Mai beginnt, laesst sich nicht korrigieren -- auch nicht auf spaeter',
    $schreib(['aktion' => 'korrigieren', 'eintrag_id' => (int)$pauschale['id'], 'lohnart_id' => 104,
              'betrag' => '7.50', 'ab' => '2026-06']) !== null);
$schreib(['aktion' => 'neu', 'lohnart_id' => 103, 'betrag' => '10', 'ab' => '2026-07', 'bis' => '2026-07']);
$juli = $pos(103)[1];
pruef('Eine noch nicht verwendete Position laesst sich korrigieren',
    $schreib(['aktion' => 'korrigieren', 'eintrag_id' => (int)$juli['id'], 'lohnart_id' => 103,
              'betrag' => '12', 'ab' => '2026-07', 'bis' => '2026-07']) === null
    && (int)$pos(103)[1]['betrag_rappen'] === 1200);
pruef('Und loeschen',
    $schreib(['aktion' => 'loeschen', 'eintrag_id' => (int)$juli['id']]) === null
    && count($pos(103)) === 1);
pruef('Eine fremde Position laesst sich nicht ansprechen',
    lohn_position_schreiben($pdo, 2, ['aktion' => 'loeschen', 'eintrag_id' => (int)$pauschale['id']], 9) !== null
    && count($pos(104)) === 1);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
