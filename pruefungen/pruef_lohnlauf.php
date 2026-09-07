<?php
declare(strict_types=1);
// Echte Ausfuehrung des Lohnlauf-Rechenkerns gegen eine wirkliche Datenbank
// (SQLite im Arbeitsspeicher) -- ENT-451, Etappe 3.
//
// Warum gegen eine Datenbank und nicht gegen einen nachgebauten Ablauf: Der
// Kern lebt von der Abfrage. Ob nur ABGEGLICHENE Schichten zaehlen, ob eine
// abgesagte draussen bleibt, ob eine Reinigungsschicht gesperrt wird -- das
// entscheidet sich zwischen SQL und PHP, und ein Mock haette es nie
// bemerkt.
//
// Der wichtigste Block steht unten: Was NICHT gerechnet wird, bekommt einen
// benannten Grund und KEINEN Betrag. Eine Null waere eine Aussage ueber
// Geld, die niemand getroffen hat.

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

// Datum bewusst weit weg von heute (CLAUDE.md / test_datumsfest.mjs).
$VON = '2026-07-01'; $BIS = '2026-07-31';

// Person 1: Stundenlohn, saubere Faelle.
//  - Mi 01.07., 08:00-18:00, 60 Min unbezahlte Pause  -> 540 Min netto, kein Bonus
//  - So 05.07., 08:00-12:00, ohne Pause               -> 240 Min netto, Sonntagsbonus
//  - Fr 10.07., 22:00-02:00, ohne Pause               -> 240 Min, 3 h davon Nachtfenster
$pdo->exec("INSERT INTO einsaetze VALUES
  (1,'2026-07-01','sicherheit','Kunde',NULL,'geplant'),
  (2,'2026-07-05','sicherheit','Kunde',NULL,'geplant'),
  (3,'2026-07-10','sicherheit','Kunde',NULL,'geplant'),
  (4,'2026-07-15','reinigung','Kunde',NULL,'geplant'),
  (5,'2026-07-16','sicherheit','Kunde',NULL,'geplant'),
  (6,'2026-07-17','sicherheit','Kunde',NULL,'abgesagt'),
  (7,'2026-07-20','sicherheit','Kunde',NULL,'geplant')");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES
  (1,1,'abgeglichen','08:00','18:00',60,0),
  (2,1,'abgeglichen','08:00','12:00',0,0),
  (3,1,'abgeglichen','22:00','02:00',0,0),
  (4,1,'abgeglichen','08:00','12:00',0,0),
  (5,1,'offen','08:00','12:00',0,0),
  (6,1,'abgeglichen','08:00','12:00',0,0),
  (7,1,'abgeglichen','08:00','12:00',300,0)");
$pdo->exec("INSERT INTO lohn_ansatz VALUES
  (1,1,'2024-01-01','C',2500,1,833,NULL,NULL,'monat',15000,'stunde',200)");

$MA1 = ['id' => 1, 'anstellungskategorie' => 'C', 'eintritt' => '2024-03-01',
        'geburtsdatum' => '2000-05-04', 'pensum_stunden' => 800];

$zeit = lohnlauf_zeiten($pdo, 1, $VON, $BIS);

// ── Welche Schichten ueberhaupt zaehlen ──────────────────────────────────
pruef('KRITISCH: eine abgesagte Schicht taucht gar nicht erst auf',
    count(array_filter($zeit['schichten'], fn($s) => $s['einsatz_id'] === 6)) === 0);
pruef('KRITISCH: eine noch nicht abgeglichene Schicht zaehlt nicht mit, wird aber GEZAEHLT',
    $zeit['nicht_abgeglichen'] === 1
    && count(array_filter($zeit['schichten'], fn($s) => $s['einsatz_id'] === 5)) === 0);
pruef('KRITISCH: eine Reinigungsschicht wird gesperrt statt nach dem Sicherheits-GAV bewertet (OP-32)',
    ($zeit['gesperrt']['sparte_reinigung'] ?? 0) === 1);
pruef('KRITISCH: eine Pause laenger als die Schicht wird als Erfassungsfehler gesperrt, nicht negativ gerechnet',
    ($zeit['gesperrt']['pause_laenger_als_schicht'] ?? 0) === 1);

// ── Die Zeitsummen, einzeln nachvollziehbar ──────────────────────────────
// Mi 01.07. 08:00-18:00 = 600 roh, 540 netto, kein Bonusfenster
// So 05.07. 08:00-12:00 = 240 roh, 240 netto, 240 Min im Sonntagsfenster -> 24 Min Bonus
// Fr 10.07. 22:00-02:00 = 240 roh, 240 netto, 22:00-23:00 kein Fenster,
//                          23:00-02:00 = 180 Min Nacht -> 18 Min Bonus
pruef('Die Rohzeit ist die Summe der Schichten ohne Pausenabzug',
    $zeit['summe']['roh_min'] === 600 + 240 + 240);
pruef('Die Nettozeit zieht die unbezahlte Pause ab',
    $zeit['summe']['netto_min'] === 540 + 240 + 240);
pruef('Der Sonntagsbonus greift fuer die volle Sonntagsschicht (Art. 12 Ziff. 2)',
    abs($zeit['schichten'][1]['bonus_min'] - 24.0) < 1e-9);
pruef('KRITISCH: bei der Nachtschicht zaehlen nur die Minuten IM Fenster ab 23:00, nicht die ganze Schicht',
    abs($zeit['schichten'][2]['bonus_min'] - 18.0) < 1e-9);
pruef('Eine Tagschicht ohne Nacht- und Sonntagsanteil bekommt keinen Bonus',
    abs($zeit['schichten'][0]['bonus_min'] - 0.0) < 1e-9);
pruef('KRITISCH: die bewertete Zeit ist Nettozeit PLUS Zeitbonus, und beide stehen daneben',
    abs($zeit['summe']['bewertet_min'] - (1020 + 42.0)) < 1e-9
    && $zeit['summe']['netto_min'] === 1020
    && abs($zeit['summe']['bonus_min'] - 42.0) < 1e-9);

// ── Die Lohnzeilen ───────────────────────────────────────────────────────
$p = lohnlauf_person($pdo, $MA1, $VON, $BIS);
$zeile = fn($k) => current(array_filter($p['zeilen'], fn($z) => $z['schluessel'] === $k)) ?: null;

pruef('Die Lohnform folgt aus der Kategorie und wird nicht erfragt', $p['lohnform'] === 'stunde');
pruef('Der Grundlohn steht als eigene Zeile', ($zeile('grundlohn_stunde')['betrag_rappen'] ?? 0) === 2500);
pruef('Die Ferienentschaedigung wird aus dem Alter abgeleitet: 26-jaehrig -> 8,33 %',
    ($zeile('ferienentschaedigung')['satz_bp'] ?? 0) === 833
    && ($zeile('ferienentschaedigung')['betrag_rappen'] ?? 0) === 208);
pruef('Der Anteil 13. Monatslohn erscheint mit dem erfassten Satz',
    ($zeile('anteil_13ml')['betrag_rappen'] ?? 0) === 208);
pruef('Der Bruttostundenlohn ist die Summe der gerundeten Bestandteile',
    ($zeile('brutto_stundenlohn')['betrag_rappen'] ?? 0) === 2916);
// 1062 Minuten bewertete Zeit = 17,7 Stunden. 2916 x 17,7 = 51'613,2 -> 51'613 Rappen.
pruef('KRITISCH: der Lohn entsteht aus Bruttostundenlohn MAL bewerteter Zeit',
    ($zeile('geleistete_stunden')['betrag_rappen'] ?? 0) === (int)round(2916 * 1062 / 60));
pruef('Die Stundenzeile nennt die Menge in Stunden, nicht in Minuten',
    abs(($zeile('geleistete_stunden')['menge'] ?? 0) - 17.7) < 1e-9);
pruef('KRITISCH: die Stundenzeile ist als annahmebasiert gekennzeichnet, weil der Zeitbonus auf GAV-AUS-008 beruht',
    ($zeile('geleistete_stunden')['annahme'] ?? 0) === 1);
pruef('Der Hinweis schluesselt auf, woraus die bewertete Zeit besteht',
    str_contains($zeile('geleistete_stunden')['hinweis'] ?? '', 'Nettozeit')
    && str_contains($zeile('geleistete_stunden')['hinweis'] ?? '', 'Zeitbonus'));

// ── Zuschlaege nach Art. 19 ──────────────────────────────────────────────
pruef('Eine Monatspauschale nach Art. 19 wird ausbezahlt',
    ($zeile('zuschlag_hund')['betrag_rappen'] ?? 0) === 15000);
// Der Waffenzuschlag ist als Stundenentschaedigung vereinbart. Nach Art. 19
// entsteht er aus dem ANGEORDNETEN Einsatz -- die Anordnung je Schicht
// fuehrt das Datenmodell nicht. Also gesperrt statt geschaetzt.
pruef('KRITISCH: eine Stundenentschaedigung nach Art. 19 wird gesperrt, nicht aus der Berechtigung hergeleitet',
    $zeile('zuschlag_waffe') !== null
    && $zeile('zuschlag_waffe')['betrag_rappen'] === null
    && ($zeile('zuschlag_waffe')['gesperrt_grund'] ?? '') === 'anordnung_fehlt');
pruef('Ein nicht vereinbarter Zuschlag erzeugt gar keine Zeile', $zeile('zuschlag_fachausweis') === null);

// ── Die Bruttosumme ──────────────────────────────────────────────────────
pruef('Der Bruttolohn ist Stundenlohn plus ausbezahlte Zuschlaege',
    $p['brutto_rappen'] === (int)round(2916 * 1062 / 60) + 15000);
pruef('KRITISCH: eine gesperrte Zuschlagszeile geht NICHT als Null in die Summe ein',
    $p['brutto_rappen'] > 0 && $zeile('zuschlag_waffe')['betrag_rappen'] === null);

// ── Was nicht gerechnet werden kann ──────────────────────────────────────
$ohneKat = lohnlauf_person($pdo, ['id' => 1, 'anstellungskategorie' => null,
    'eintritt' => '2024-03-01', 'geburtsdatum' => '2000-05-04'], $VON, $BIS);
pruef('KRITISCH: ohne Anstellungskategorie entstehen keine Zeilen, sondern ein benannter Grund',
    $ohneKat['gesperrt_grund'] === 'keine_kategorie' && $ohneKat['zeilen'] === []
    && $ohneKat['brutto_rappen'] === 0);
pruef('Aber die ZEITEN sind trotzdem gerechnet -- die Sperre betrifft den Lohn, nicht die Stunden',
    $ohneKat['netto_min'] === 1020);

$monat = lohnlauf_person($pdo, ['id' => 1, 'anstellungskategorie' => 'A',
    'eintritt' => '2024-03-01', 'geburtsdatum' => '2000-05-04'], $VON, $BIS);
pruef('KRITISCH: der Monatslohn wird ausdruecklich gesperrt, nicht still als Stundenlohn gerechnet',
    $monat['gesperrt_grund'] === 'monatslohn_offen' && $monat['zeilen'] === []);

$ohneAnsatz = lohnlauf_person($pdo, ['id' => 2, 'anstellungskategorie' => 'C',
    'eintritt' => '2024-03-01', 'geburtsdatum' => '2000-05-04'], $VON, $BIS);
pruef('KRITISCH: ohne Lohnansatz wird nicht mit null gerechnet, sondern gesperrt',
    $ohneAnsatz['gesperrt_grund'] === 'kein_ansatz');

// Ein Ansatz, der erst NACH dem Zeitraum gilt, darf nicht rueckwirkend
// greifen -- sonst rechnete eine Lohnerhoehung alte Monate neu.
$pdo->exec("INSERT INTO lohn_ansatz VALUES
  (2,3,'2027-01-01','C',3000,1,833,NULL,NULL,NULL,NULL,NULL,NULL)");
$kuenftig = lohnlauf_person($pdo, ['id' => 3, 'anstellungskategorie' => 'C',
    'eintritt' => '2024-03-01', 'geburtsdatum' => '2000-05-04'], $VON, $BIS);
pruef('KRITISCH: ein erst kuenftig gueltiger Ansatz greift nicht rueckwirkend',
    $kuenftig['gesperrt_grund'] === 'kein_ansatz');

// ── Mindestlohnwarnung ───────────────────────────────────────────────────
$pdo->exec("INSERT INTO lohn_ansatz VALUES
  (3,4,'2024-01-01','C',2000,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL)");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES (1,4,'abgeglichen','08:00','18:00',60,0)");
$tief = lohnlauf_person($pdo, ['id' => 4, 'anstellungskategorie' => 'C',
    'eintritt' => '2024-03-01', 'geburtsdatum' => '2000-05-04'], $VON, $BIS);
pruef('KRITISCH: ein Grundlohn unter dem GAV-Mindestlohn erzeugt eine Warnung',
    isset($tief['warnung']) && $tief['warnung']['art'] === 'unter_mindestlohn');
pruef('Die Warnung sperrt nicht -- der Lauf entsteht trotzdem, sichtbar gekennzeichnet',
    $tief['brutto_rappen'] > 0 && $tief['gesperrt_grund'] === null);
pruef('Ein Ansatz ueber dem Mindestlohn erzeugt keine Warnung', !isset($p['warnung']));

// ── Zeitzuschlag nach Art. 14 Ziff. 3 ────────────────────────────────────
// Person 5 arbeitet 22 Tage zu 10 Stunden = 220 Stunden bewertete Zeit,
// also 10 ueber der Schwelle von 210. Der Zuschlag von 25 % kann nach dem
// Wortlaut ausbezahlt ODER als Freizeit ausgeglichen werden -- die Wahl
// hat niemand getroffen. Die Zeile muss trotzdem ENTSTEHEN: Fehlte sie,
// waere die Abrechnung stillschweigend zu tief.
$id = 100;
for ($t = 1; $t <= 22; $t++) {
    $datum = sprintf('2026-07-%02d', $t);
    $pdo->exec("INSERT INTO einsaetze VALUES ($id,'$datum','sicherheit','Kunde',NULL,'geplant')");
    // 08:00-18:00 mit 0 Pause: 600 Minuten, kein Nacht- oder Sonntagsfenster,
    // damit die Schwelle ohne Bonusanteil erreicht wird.
    $pdo->exec("INSERT INTO einsatz_zuteilung VALUES ($id,5,'abgeglichen','08:00','18:00',0,0)");
    $id++;
}
$pdo->exec("INSERT INTO lohn_ansatz VALUES
  (4,5,'2024-01-01','C',2500,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL)");
$viel = lohnlauf_person($pdo, ['id' => 5, 'anstellungskategorie' => 'C',
    'eintritt' => '2024-03-01', 'geburtsdatum' => '2000-05-04'], $VON, $BIS);
$zViel = fn($k) => current(array_filter($viel['zeilen'], fn($z) => $z['schluessel'] === $k)) ?: null;

// 22 x 600 Minuten = 13'200 Minuten Nettozeit. Drei der Tage (5., 12. und
// 19. Juli 2026) sind SONNTAGE, und 08:00-18:00 liegt vollstaendig im
// Sonntagsfenster 06:00-23:00 -- also je 60 Minuten Bonus, zusammen 180.
// Ausgerechnet und nicht abgelesen: Wer den beobachteten Wert einsetzt,
// hat ein Stempelkissen statt einer Pruefung.
$SONNTAGE = 3;
$NETTO_SOLL = 22 * 600;
$BONUS_SOLL = $SONNTAGE * 60.0;
pruef('Zweiundzwanzig Zehnstundentage ergeben 13\'200 Minuten Nettozeit',
    $viel['netto_min'] === $NETTO_SOLL);
pruef('KRITISCH: die drei Sonntage darunter tragen je eine volle Stunde Zeitbonus',
    abs($viel['bonus_min'] - $BONUS_SOLL) < 1e-9);
pruef('Die bewertete Zeit ist die Summe aus beidem',
    abs($viel['bewertet_min'] - ($NETTO_SOLL + $BONUS_SOLL)) < 1e-9);
pruef('KRITISCH: ueber 210 Stunden entsteht die Zeitzuschlags-Zeile ueberhaupt (Art. 14 Ziff. 3)',
    $zViel('zeitzuschlag') !== null);
pruef('Sie nennt die MEHRstunden ueber der Schwelle, nicht die Gesamtstunden',
    abs(($zViel('zeitzuschlag')['menge'] ?? 0) - (($NETTO_SOLL + $BONUS_SOLL - 210 * 60) / 60)) < 1e-9
    && ($zViel('zeitzuschlag')['menge'] ?? 0) < $viel['bewertet_min'] / 60);
pruef('Sie fuehrt den Satz von 25 Prozent', ($zViel('zeitzuschlag')['satz_bp'] ?? 0) === 2500);
// Der eigentliche Punkt: Sie hat KEINEN Betrag, aber einen Grund. Waere sie
// gar nicht da, faellt eine zu tiefe Abrechnung niemandem auf.
pruef('KRITISCH: sie traegt keinen Betrag, sondern den Grund -- die Wahl zwischen Auszahlung und Freizeit ist offen',
    $zViel('zeitzuschlag')['betrag_rappen'] === null
    && ($zViel('zeitzuschlag')['gesperrt_grund'] ?? '') === 'ausgleich_offen');
// Ohne 13. Monatslohn: Bruttostundenlohn = 2500 + 208 Ferienentschaedigung.
// Der Zeitzuschlag ist gesperrt und darf die Summe NICHT beeinflussen --
// weder als Betrag noch als Null.
pruef('KRITISCH: der gesperrte Zeitzuschlag geht nicht in den Bruttolohn ein',
    $viel['brutto_rappen'] === (int)round((2500 + 208) * ($NETTO_SOLL + $BONUS_SOLL) / 60));
pruef('Unter der Schwelle entsteht die Zeile nicht -- 17,7 Stunden sind keine 210',
    $zeile('zeitzuschlag') === null);

// ── Jeder erzeugte Schluessel steht im Lohnartenkatalog ──────────────────
// DIESE PRUEFUNG GIBT ES WEGEN EINES ECHTEN FEHLERS: Der Lauf erzeugte
// 'brutto_stundenlohn' und 'geleistete_stunden', und beide fehlten im
// Katalog. Aufgefallen ist es erst beim Durchsehen, nicht beim Bauen.
//
// Die Folge waere in der Abzugsetappe eingetreten und dort still geblieben:
// Die Kennzeichen einer Lohnart bestimmen, in welche Bemessungsgrundlage
// ihr Betrag zaehlt. Fehlt die Lohnart, fehlen die Kennzeichen -- und
// 'geleistete_stunden' traegt den GESAMTEN AHV-pflichtigen Lohn. Die AHV
// waere auf null gerechnet worden, ohne dass etwas kaputtgeht.
$katalog = array_column(lohnart_startbestand(), 0);
$erzeugt = [];
foreach ([$p, $viel, $tief] as $fall) {
    foreach ($fall['zeilen'] as $z) { $erzeugt[$z['schluessel']] = true; }
}
$fehlend = array_diff(array_keys($erzeugt), $katalog);
pruef('KRITISCH: jeder Schluessel, den der Lohnlauf erzeugt, steht im Lohnartenkatalog',
    $fehlend === []);
if ($fehlend) { echo "  fehlend: " . implode(', ', $fehlend) . "\n"; }
pruef('Die Pruefung sieht ueberhaupt Schluessel -- sonst waere sie leer und gruen',
    count($erzeugt) >= 7);

// Die Zwischensumme darf in KEINE Bemessungsgrundlage zaehlen: Sonst
// staende derselbe Lohn zweimal darin, einmal als Stundenansatz und einmal
// als Monatsbetrag.
$nach = fn($k) => current(array_filter(lohnart_startbestand(), fn($l) => $l[0] === $k)) ?: null;
$brutto = $nach('brutto_stundenlohn');
pruef('KRITISCH: der Bruttostundenlohn ist eine Zwischensumme und zaehlt in keine Bemessungsgrundlage',
    $brutto !== null && array_sum(array_slice($brutto, 5, 6)) === 0);
// Und die Zeile mit dem echten Betrag traegt die Grundlagen, die sie
// tragen muss -- aber NICHT Ferien und 13. Monatslohn, die stecken schon
// im Bruttostundenlohn.
$std = $nach('geleistete_stunden');
pruef('KRITISCH: die Stundenzeile ist AHV-, BVG-, UVG- und quellensteuerpflichtig',
    $std !== null && $std[5] === 1 && $std[8] === 1 && $std[9] === 1 && $std[10] === 1);
pruef('KRITISCH: aber weder ferien- noch 13.-ML-pflichtig -- sonst gaebe es Ferienentschaedigung auf die Ferienentschaedigung',
    $std !== null && $std[6] === 0 && $std[7] === 0);

// ── Jeder Sperrgrund ist erklaert ────────────────────────────────────────
// Ein Rohschluessel in der Oberflaeche waere fuer die bedienende Person
// keine Auskunft. Darum muss zu jedem Grund ein Satz stehen.
$gruende = lohnlauf_sperrgruende();
$benutzt = ['sparte_reinigung', 'kein_regelwerk', 'kein_ansatz', 'keine_kategorie',
            'zeiten_unvollstaendig', 'pause_laenger_als_schicht', 'monatslohn_offen',
            'anordnung_fehlt', 'ausgleich_offen'];
pruef('KRITISCH: zu jedem verwendeten Sperrgrund gibt es einen erklaerenden Satz',
    count(array_diff($benutzt, array_keys($gruende))) === 0);
pruef('Und keiner dieser Saetze ist leer',
    count(array_filter($gruende, fn($t) => strlen(trim($t)) > 20)) === count($gruende));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
