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
// KRITISCH: Auch die ABZUGSZEILEN. Diese Pruefung entstand, weil zwei
// Lohnarten im Katalog fehlten -- und sah danach nur die Bruttoseite an.
// Als die Abzugsseite dazukam, fehlten 'nettolohn' und 'auszahlung'
// prompt wieder im Katalog, und die Pruefung blieb gruen. Das
// Sicherheitsnetz war nicht auf den neuen Teil mitgezogen worden.
foreach (['2026-07-31', '2027-07-31'] as $stichtagK) {
    foreach ([LOHN_NBU_VERSICHERT, LOHN_NBU_NICHT, LOHN_NBU_PRUEFEN] as $standK) {
        $abK = lohnlauf_abzuege($pdo, ['mitarbeiter_id' => 1, 'brutto_rappen' => 500000,
            'kategorie' => 'C', 'bewertet_min' => 12000,
            'zeilen' => [['schluessel' => 'geleistete_stunden', 'betrag_rappen' => 500000]]],
            $stichtagK, ['stand' => $standK]);
        foreach ($abK['zeilen'] as $z) { $erzeugt[$z['schluessel']] = true; }
    }
}
$fehlend = array_diff(array_keys($erzeugt), $katalog);
pruef('KRITISCH: jeder Schluessel, den der Lohnlauf erzeugt, steht im Lohnartenkatalog',
    $fehlend === []);
if ($fehlend) { echo "  fehlend: " . implode(', ', $fehlend) . "\n"; }
pruef('Die Pruefung sieht ueberhaupt Schluessel -- sonst waere sie leer und gruen',
    count($erzeugt) >= 7);
pruef('Und sie sieht auch die Zeilen der ABZUGSSEITE, nicht nur die Bruttoseite',
    isset($erzeugt['ahv']) && isset($erzeugt['nettolohn']) && isset($erzeugt['auszahlung']));

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

// ── Wochenstunden fuer die NBU-Unterstellung (Empfehlung 7/87) ───────────
//
// Gegen eine echte Datenbank, weil sich genau hier die zwei Entscheidungen
// entscheiden, die gegen die naheliegende Wahl getroffen wurden: dass die
// Reinigungssparte MITzaehlt und der Zeitbonus NICHT.
$mkw = 90;   // eigener Mitarbeiter, damit die anderen Faelle unberuehrt bleiben
$pdo->exec("INSERT INTO einsaetze VALUES
    (900,'2026-07-06','bewachung','Kunde',1,'geplant'),
    (901,'2026-07-13','reinigung','Kunde',1,'geplant'),
    (902,'2026-07-05','bewachung','Kunde',1,'geplant'),
    (903,'2026-06-15','bewachung','Kunde',1,'abgesagt'),
    (904,'2026-06-22','bewachung','Kunde',1,'geplant')");
$pdo->exec("INSERT INTO einsatz_zuteilung VALUES
    (900,$mkw,'abgeglichen','08:00','18:00',60,0),
    (901,$mkw,'abgeglichen','08:00','18:00',0,0),
    (902,$mkw,'abgeglichen','08:00','18:00',0,0),
    (903,$mkw,'abgeglichen','08:00','18:00',0,0),
    (904,$mkw,'offen','08:00','18:00',0,0)");

$w = lohnlauf_nbu_wochen($pdo, $mkw, '2026-07-31', 3);

pruef('Das Fenster beginnt an einem Montag, nicht mitten in der Woche',
    date('N', strtotime($w['von'])) === '1');
// KRITISCH -- Ziff. 2 der Empfehlung 7/87: "Nur ganze Wochen sind zu
// beachten. Faellt der Beginn bzw. das Ende der relevanten Periode zwischen
// zwei Wochenenden, bleiben diese angebrochenen Wochen unberuehrt."
// Beide Raender muessen NACH INNEN wandern. Wandert der Anfang nach aussen,
// holt er Stunden von vor dem Zeitraum herein; bleibt die angebrochene
// Schlusswoche drin, zaehlt sie mit zu wenigen Stunden als volle Woche und
// drueckt den Durchschnitt gegen den Mitarbeitenden.
pruef('Der Fensteranfang liegt NICHT vor dem Zeitraum, sondern auf dem Montag danach',
    $w['monate'] === 3 && date('N', strtotime($w['von'])) === '1'
    && strtotime($w['von']) >= strtotime('2026-05-02'));
pruef('Das Fenster endet auf einem Sonntag, nicht am angebrochenen Stichtag',
    date('N', strtotime($w['bis'])) === '7'
    && strtotime($w['bis']) <= strtotime('2026-07-31')
    && $w['bis'] !== '2026-07-31');
pruef('Die angebrochene Schlusswoche kommt in der Liste gar nicht vor',
    !array_key_exists(date('o-\WW', strtotime('2026-07-31')), $w['wochen']));
// KRITISCH: Nullstundenwochen MUESSEN in der Liste stehen. Ohne sie sind die
// Regeln 3 und 4 der Empfehlung nicht anwendbar, und der Durchschnitt waere
// systematisch zu hoch.
pruef('Wochen ohne Einsatz stehen als Nullstundenwochen in der Liste',
    count($w['liste']) === count($w['wochen'])
    && count(array_filter($w['liste'], fn($h) => $h == 0.0)) > 5
    && count($w['liste']) > 10);

// Die Pause geht ab: 08:00-18:00 mit 60 Minuten unbezahlter Pause sind neun
// Stunden, nicht zehn.
pruef('Gezaehlt wird die Nettozeit: zehn Stunden minus einer Stunde Pause sind neun',
    abs($w['wochen'][date('o-\WW', strtotime('2026-07-06'))] - 9.0) < 0.001);
// KRITISCH: Die Reinigungssparte ist fuer den GAV gesperrt (OP-32). Fuer die
// Unfallversicherung ist das ohne Bedeutung -- wer dort arbeitet, arbeitet.
pruef('Eine Schicht der Reinigungssparte zaehlt fuer die NBU-Unterstellung mit',
    !gavzeit_gilt('reinigung')
    && abs($w['wochen'][date('o-\WW', strtotime('2026-07-13'))] - 10.0) < 0.001);
// KRITISCH: Der Zeitbonus ist eine tarifliche Gutschrift, keine geleistete
// Arbeitszeit. Die Pruefung belegt beides: dass fuer diese Schicht ueberhaupt
// ein Bonus entsteht, und dass er NICHT mitgezaehlt wird.
$bonusSchicht = gavzeit_bonus_min('2026-07-05', '08:00', '18:00');
pruef('Der Zeitbonus entsteht fuer diese Schicht wirklich',  $bonusSchicht > 0);
pruef('Er wird trotzdem nicht mitgezaehlt: geleistet sind zehn Stunden, nicht mehr',
    abs($w['wochen'][date('o-\WW', strtotime('2026-07-05'))] - 10.0) < 0.001);
pruef('Eine abgesagte Schicht zaehlt nicht mit',
    abs($w['wochen'][date('o-\WW', strtotime('2026-06-15'))] - 0.0) < 0.001);
pruef('Eine nicht abgeglichene Schicht zaehlt nicht mit',
    abs($w['wochen'][date('o-\WW', strtotime('2026-06-22'))] - 0.0) < 0.001);

// Und die Kette bis zum Ergebnis: aus den Wochen wird die Unterstellung.
$uvgP = lohn_uvg('2025-06-30');
$erg  = lohn_nbu_ermittlung($w['liste'], $uvgP);
pruef('Aus den gezaehlten Wochen entsteht ein nachvollziehbares Ergebnis',
    in_array($erg['stand'], [LOHN_NBU_VERSICHERT, LOHN_NBU_NICHT], true)
    && $erg['wochen_total'] === count($w['liste'])
    && $erg['schnitt_std'] !== null);
pruef('Ein Mitarbeiter ganz ohne Einsaetze ergibt lauter Nullwochen, nicht eine leere Liste',
    count(lohnlauf_nbu_wochen($pdo, 999, '2026-07-31', 3)['liste']) > 10
    && array_sum(lohnlauf_nbu_wochen($pdo, 999, '2026-07-31', 3)['liste']) == 0.0);

// ── Ziff. 4: Ausfalltage wegen Unfall oder Krankheit ─────────────────────
$pdo->exec('CREATE TABLE abwesenheiten (id INTEGER PRIMARY KEY, mitarbeiter_id INT,
            typ TEXT, von TEXT, bis TEXT, status TEXT)');
$pdo->exec("INSERT INTO abwesenheiten VALUES
    (1,$mkw,'krankheit','2026-06-01','2026-06-05','genehmigt'),
    (2,$mkw,'unfall','2026-06-08','2026-06-09','genehmigt'),
    (3,$mkw,'ferien','2026-06-15','2026-06-19','genehmigt'),
    (4,$mkw,'militaer','2026-06-22','2026-06-26','genehmigt'),
    (5,$mkw,'krankheit','2026-07-01','2026-07-03','beantragt'),
    (6,$mkw,'krankheit','2026-04-01','2026-04-03','genehmigt')");
$wa = lohnlauf_nbu_wochen($pdo, $mkw, '2026-07-31', 3);
// 1. bis 5. Juni sind fuenf Tage, 8. bis 9. Juni zwei -- zusammen sieben.
pruef('Krankheit und Unfall werden tageweise gezaehlt',
    $wa['ausfalltage'] === 7);
// KRITISCH: "Weitere Ergaenzungen, z.B. wegen Militaer, Feier- oder
// Urlaubstagen, sind nicht zulaessig" (Ziff. 4). Ferien und Militaer duerfen
// die Deckung nicht herbeirechnen -- das waeren zusammen zehn Tage mehr.
pruef('Ferien und Militaer zaehlen ausdruecklich NICHT mit',
    $wa['ausfalltage'] === 7 && $wa['ausfalltage'] !== 17);
pruef('Eine nur beantragte Abwesenheit ist keine Abwesenheit',
    $wa['ausfalltage'] === 7);
pruef('Eine Abwesenheit vor dem Fenster zaehlt nicht mit',
    strtotime('2026-04-03') < strtotime($wa['von']) && $wa['ausfalltage'] === 7);

// Und die Kette bis zum Ergebnis, mit der zweiten Stufe.
$ergA = lohn_nbu_ermittlung($wa['liste'], $uvgP, $wa['ausfalltage']);
pruef('Reichen die Stunden nicht und gibt es Ausfalltage, lautet die Antwort "pruefen"',
    $ergA['stand'] === LOHN_NBU_PRUEFEN && $ergA['ausfalltage'] === 7);
pruef('Ohne die Ausfalltage waere daraus ein "nicht versichert" geworden',
    lohn_nbu_ermittlung($wa['liste'], $uvgP, 0)['stand'] === LOHN_NBU_NICHT);

// ══════════════════════ DIE ABZUGSSEITE (Etappe 4) ═══════════════════════
$pdo->exec('CREATE TABLE lohn_abzug (id INTEGER PRIMARY KEY, schluessel TEXT, bezeichnung TEXT,
            gueltig_ab TEXT, gueltig_bis TEXT, satz_bp INT, fix_rappen INT,
            hoechstlohn_rappen INT, quelle TEXT)');
$pdo->exec('CREATE TABLE lohn_person (id INTEGER PRIMARY KEY, mitarbeiter_id INT, gueltig_ab TEXT,
            nbu_pflichtig INT, nbu_grund TEXT, nbu_von INT, nbu_am TEXT, qst_pflichtig INT)');

// Die Zeilen der Referenzabrechnung: 25.00/h + 8.33 % + 8.33 % = 29.16,
// mal zehn Stunden = 291.60.
$refZeilen = [
    ['schluessel' => 'grundlohn_stunde',     'betrag_rappen' => 2500],
    ['schluessel' => 'ferienentschaedigung', 'betrag_rappen' => 208],
    ['schluessel' => 'anteil_13ml',          'betrag_rappen' => 208],
    ['schluessel' => 'brutto_stundenlohn',   'betrag_rappen' => 2916],
    ['schluessel' => 'geleistete_stunden',   'betrag_rappen' => 29160],
];
$refKopf = ['brutto_rappen' => 29160, 'kategorie' => 'C', 'bewertet_min' => 600,
            'zeilen' => $refZeilen];
$kat = lohnlauf_katalog(null);
$grund = lohnlauf_grundlagen($refZeilen, $kat);

// KRITISCH -- der Fehler, der beim Bauen auffiel und sonst live gegangen
// waere: Grundlohn, Ferienentschaedigung und 13.-Anteil sind Bestandteile
// eines STUNDENSATZES. Zaehlt man sie mit, steht der Stundenlohn zweimal in
// der Grundlage: 32 076 statt 29 160 Rappen, zehn Prozent zu hoch -- und
// jeder Abzug entsprechend zu gross, zulasten des Mitarbeitenden.
pruef('Die AHV-Grundlage ist der Periodenbetrag, nicht die Summe aller Kennzeichen-Zeilen',
    $grund['ahv'] === 29160);
pruef('Der Stundenlohn wird nicht doppelt gezaehlt',
    $grund['ahv'] !== 2500 + 208 + 208 + 29160);
pruef('Zwischensummen zaehlen in keine Grundlage',
    lohnart_ist_bemessung(array_values(array_filter(lohnart_startbestand(),
        fn($z) => $z[0] === 'brutto_stundenlohn'))[0]) === false);
pruef('Eine Lohnart, die der Katalog nicht kennt, wird namentlich gemeldet statt verschluckt',
    lohnlauf_grundlagen([['schluessel' => 'tippfehler', 'betrag_rappen' => 5000]], $kat)
        ['unbekannte_lohnarten'] === ['tippfehler']);

// ── Der Weg mit Saetzen: 2026 rechnet die AHV ────────────────────────────
// 2026 rechnet AHV UND ALV -- beide Merkblaetter gelten fuer dieses Jahr.
$a26 = lohnlauf_abzuege($pdo, $refKopf, '2026-07-31', ['stand' => LOHN_NBU_UNBEKANNT]);
$z26 = [];
foreach ($a26['zeilen'] as $z) { $z26[$z['schluessel']] = $z; }
// Referenzabrechnung: 5,300 % von 291.60 sind 15.45.
pruef('AHV: 5,300 % von 291.60 ergeben die 15.45 der Referenzabrechnung',
    $z26['ahv']['betrag_rappen'] === -1545);
pruef('Der Abzug steht als NEGATIVER Betrag da, nicht als positiver mit Vorzeichen im Kopf',
    $z26['ahv']['betrag_rappen'] < 0);
// KRITISCH: Fuer 2026 ist kein ALV-Regelwerk erfasst. Die Zeile entsteht
// trotzdem -- mit Grund und OHNE Betrag. Ein weggelassener Abzug faellt
// niemandem auf, eine gesperrte Zeile schon.
pruef('ALV 2026: 1,100 % von 291.60 ergeben die 3.21 der Referenzabrechnung',
    $z26['alv']['betrag_rappen'] === -321);
// Fuer ein Jahr OHNE Regelwerk muss die Zeile mit Grund und ohne Betrag
// entstehen. 2027 ist ausdruecklich nicht erfasst.
$a27 = lohnlauf_abzuege($pdo, $refKopf, '2027-07-31', ['stand' => LOHN_NBU_UNBEKANNT]);
$z27 = []; foreach ($a27['zeilen'] as $z) { $z27[$z['schluessel']] = $z; }
pruef('Fehlt das Regelwerk eines Jahres, entsteht die Zeile mit Grund und ohne Betrag',
    $z27['alv']['betrag_rappen'] === null
    && $z27['alv']['gesperrt_grund'] === 'kein_alv_regelwerk'
    && $z27['ahv']['gesperrt_grund'] === 'kein_sv_regelwerk'
    && strlen($z27['alv']['hinweis']) > 30);
pruef('Ein fehlender Satz ergibt niemals einen Abzug von null',
    $z26['ktg']['betrag_rappen'] === null && $z26['ktg']['gesperrt_grund'] === 'kein_ktg_satz'
    && $z26['bvg']['betrag_rappen'] === null);
pruef('Der Lauf meldet sich als unvollstaendig, solange etwas gesperrt ist',
    $a26['vollstaendig'] === false && count($a26['sperren']) > 0);

// ── Der Weg mit Saetzen: 2025 rechnet die ALV ────────────────────────────
$a25 = lohnlauf_abzuege($pdo, $refKopf, '2025-07-31', ['stand' => LOHN_NBU_UNBEKANNT]);
$z25 = [];
foreach ($a25['zeilen'] as $z) { $z25[$z['schluessel']] = $z; }
pruef('ALV: 1,100 % von 291.60 ergeben die 3.21 der Referenzabrechnung',
    $z25['alv']['betrag_rappen'] === -321);
pruef('Fehlt das AHV-Regelwerk, sperrt umgekehrt die AHV-Zeile',
    $z25['ahv']['betrag_rappen'] === null
    && $z25['ahv']['gesperrt_grund'] === 'kein_sv_regelwerk');

// ── Aufbau der Abrechnung ────────────────────────────────────────────────
// KRITISCH -- der schwerste Fehler dieser Etappe, beim Vorfuehren gefunden:
// Die einzelne Zeile sagte korrekt "nicht gerechnet", die ZWISCHENSUMME
// zaehlte sie aber als null. Am Referenzbeispiel stand dadurch ein Nettolohn
// von 276.15 statt 272.94 -- plausibel und zu HOCH, weil der ALV-Abzug
// fehlte. Wer das ausbezahlt, zahlt zu viel und schuldet die Beitraege
// trotzdem. Eine Summe ueber eine gesperrte Zeile ist keine Summe.
pruef('KRITISCH: fehlt eine Abzugszeile, entsteht KEIN Nettolohn',
    $z26['ktg']['betrag_rappen'] === null
    && $z26['nettolohn']['betrag_rappen'] === null
    && $z26['nettolohn']['gesperrt_grund'] === 'abzug_fehlt');
pruef('KRITISCH: und erst recht kein Auszahlungsbetrag',
    $z26['auszahlung']['betrag_rappen'] === null
    && $z26['auszahlung']['gesperrt_grund'] === 'abzug_fehlt');
pruef('Der Hinweis benennt die fehlenden Abzuege namentlich, nicht nur "gesperrt"',
    str_contains($z26['nettolohn']['hinweis'], 'Krankentaggeld')
    && str_contains($z26['nettolohn']['hinweis'], 'BVG'));
// Die Rechenvorschrift selbst, als Aussage die immer gilt: Steht ein
// Nettolohn da, ist er die Summe -- steht keiner da, steht auch keine Zahl
// da. Formuliert als Bedingung, damit sie auch dann noch prueft, wenn
// spaeter alle Regelwerke erfasst sind und die Summe wirklich entsteht.
$summeVorNetto = 29160;
foreach ($a26['zeilen'] as $z) {
    if ((int)$z['sortierung'] < 60) { $summeVorNetto += (int)($z['betrag_rappen'] ?? 0); }
}
pruef('Ein vorhandener Nettolohn ist die Summe; ein fehlender ist keine Zahl',
    $z26['nettolohn']['betrag_rappen'] === null
        ? $z26['nettolohn']['gesperrt_grund'] !== null
        : $z26['nettolohn']['betrag_rappen'] === $summeVorNetto);
// Und die Gegenrichtung: Ist NICHTS gesperrt, muessen beide Summen entstehen.
// Geprueft an einem Kopf ohne Abzugszeilen -- dort gibt es nichts zu sperren.
$leer = lohnlauf_abzuege($pdo, ['brutto_rappen' => 10000, 'kategorie' => 'A',
    'bewertet_min' => 0, 'zeilen' => []], '2026-07-31', ['stand' => LOHN_NBU_UNBEKANNT]);
$zl = []; foreach ($leer['zeilen'] as $z) { $zl[$z['schluessel']] = $z; }
pruef('Sperrt nichts, entstehen beide Summen als Zahl',
    $zl['nettolohn']['betrag_rappen'] !== null || count($leer['sperren']) > 0);
// Referenzabrechnung: PaKo 10 Stunden x 0.015 = 0.15, NACH dem Nettolohn.
pruef('PaKo: zehn Stunden mal 1,5 Rappen ergeben die 0.15 der Referenzabrechnung',
    $z26['pako']['betrag_rappen'] === -15);
pruef('Der PaKo steht NACH dem Nettolohn, so wie ihn die Referenzabrechnung ausweist',
    $z26['pako']['sortierung'] > $z26['nettolohn']['sortierung']
    && $z26['ahv']['sortierung'] < $z26['nettolohn']['sortierung']);
pruef('Der PaKo-Betrag steht trotzdem da -- er ist gerechnet, nur die Summe nicht',
    $z26['pako']['betrag_rappen'] === -15);
// KRITISCH (Merkblatt 6.05 Ziff. 5): Der Berufsunfall traegt der
// Arbeitgeber. Er darf auf keiner Abrechnung als Abzug erscheinen.
pruef('Ein BU-Abzug erscheint auf keiner Abrechnung',
    !array_key_exists('bu', $z26));
// Beide Rundungen sind am 2026-09-08 entschieden (OP-465).
pruef('Der Auszahlungsbetrag wird auf 5 Rappen gerundet',
    LOHNLAUF_AUSZAHLUNG_AUF_5_RAPPEN === true);
pruef('Gerundet wird je Abzug, nicht auf die Summe',
    LOHNLAUF_RUNDUNG_JE_ABZUG === true);

// ── NBU: Unterstellung, Satz, Uebersteuerung ─────────────────────────────
$aN = lohnlauf_abzuege($pdo, $refKopf, '2026-07-31', ['stand' => LOHN_NBU_NICHT,
    'text' => 'Unter acht Wochenstunden.']);
$zN = []; foreach ($aN['zeilen'] as $z) { $zN[$z['schluessel']] = $z; }
pruef('Ohne Deckung entsteht KEIN NBU-Abzug, sondern eine Zeile mit Grund',
    $zN['nbu']['betrag_rappen'] === null && $zN['nbu']['gesperrt_grund'] === 'nbu_keine_deckung');
$aV = lohnlauf_abzuege($pdo, $refKopf, '2026-07-31', ['stand' => LOHN_NBU_VERSICHERT]);
$zV = []; foreach ($aV['zeilen'] as $z) { $zV[$z['schluessel']] = $z; }
pruef('Mit Deckung, aber ohne erfassten Praemiensatz: eigener Grund, nicht derselbe',
    $zV['nbu']['gesperrt_grund'] === 'kein_nbu_satz'
    && $zV['nbu']['gesperrt_grund'] !== $zN['nbu']['gesperrt_grund']);
$pdo->exec("INSERT INTO lohn_abzug VALUES (1,'nbu','NBU','2020-01-01',NULL,160,NULL,NULL,'Police')");
$aS = lohnlauf_abzuege($pdo, $refKopf, '2026-07-31', ['stand' => LOHN_NBU_VERSICHERT]);
$zS = []; foreach ($aS['zeilen'] as $z) { $zS[$z['schluessel']] = $z; }
pruef('Mit Deckung und Satz wird gerechnet: 1,60 % von 291.60 sind 4.67',
    $zS['nbu']['betrag_rappen'] === -467);
pruef('Der Hinweis nennt die Quelle des Satzes',
    str_contains((string)$zS['nbu']['hinweis'], 'Police'));

// Uebersteuerung: von Hand gesetzt schlaegt die Rechnung.
$pdo->exec("INSERT INTO lohn_person VALUES (1,$mkw,'2026-01-01',0,'Vom Versicherer bestaetigt',7,'2026-01-05 10:00',0)");
$u = lohnlauf_nbu($pdo, $mkw, '2026-07-31');
pruef('Eine Uebersteuerung schlaegt die Rechnung',
    $u['stand'] === LOHN_NBU_NICHT && $u['quelle'] === 'uebersteuert');
pruef('Die Uebersteuerung fuehrt Grund, Person und Zeitpunkt mit',
    $u['uebersteuert']['grund'] === 'Vom Versicherer bestaetigt'
    && (int)$u['uebersteuert']['von'] === 7 && $u['uebersteuert']['am'] !== null);
pruef('Ohne Uebersteuerung wird gerechnet und der Zeitraum mitgeliefert',
    lohnlauf_nbu($pdo, 999, '2025-07-31')['quelle'] === 'gerechnet'
    && isset(lohnlauf_nbu($pdo, 999, '2025-07-31')['fenster'][3]['zeitraum']['von']));
// KRITISCH: Der frueher hier stehende Vorgabewert 1 haette bei JEDER Person
// stillschweigend auf "versichert" gesetzt -- in Richtung Abzug.
pruef('Ohne Eintrag ist die Uebersteuerung leer, nicht auf "versichert" vorbelegt',
    lohnlauf_nbu($pdo, 999, '2025-07-31')['uebersteuert'] === null);

// ── Rundung auf 5 Rappen mit eigener Zeile (OP-465, entschieden) ─────────
$pdo->exec("INSERT INTO lohn_abzug VALUES (10,'ktg','Krankentaggeld','2020-01-01',NULL,70,NULL,NULL,'Police')");
$pdo->exec("INSERT INTO lohn_abzug VALUES (11,'bvg','BVG','2020-01-01',NULL,NULL,4500,NULL,'PK-Meldung')");
$voll = lohnlauf_abzuege($pdo, ['mitarbeiter_id' => $mkw] + $refKopf, '2026-07-31',
    ['stand' => LOHN_NBU_VERSICHERT]);
$zv = []; foreach ($voll['zeilen'] as $z) { $zv[$z['schluessel']] = $z; }
pruef('Mit allen Saetzen entsteht eine vollstaendige Abrechnung',
    $voll['vollstaendig'] === true && $zv['auszahlung']['betrag_rappen'] !== null);
// KRITISCH: Der Auszahlungsbetrag ist durch 5 teilbar -- sonst ist nicht
// gerundet worden.
pruef('Der Auszahlungsbetrag geht auf 5 Rappen auf',
    $zv['auszahlung']['betrag_rappen'] % 5 === 0);
// KRITISCH und der Kern der Entscheidung: Die Rechnung muss auf dem Papier
// AUFGEHEN. Nettolohn plus alle Zeilen danach ergibt den Auszahlungsbetrag
// -- die Rundungszeile ist genau das Glied, das sonst fehlte.
$summeNach = $zv['nettolohn']['betrag_rappen'];
foreach ($voll['zeilen'] as $z) {
    if ((int)$z['sortierung'] > 60 && $z['schluessel'] !== 'auszahlung') {
        $summeNach += (int)($z['betrag_rappen'] ?? 0);
    }
}
pruef('KRITISCH: die Abrechnung geht auf -- Nettolohn plus alle Zeilen danach ist der Auszahlungsbetrag',
    $summeNach === $zv['auszahlung']['betrag_rappen']);
pruef('Gibt es eine Rundungsdifferenz, steht sie als eigene Zeile da',
    !isset($zv['rundungsdifferenz'])
    || (abs($zv['rundungsdifferenz']['betrag_rappen']) <= 2
        && $zv['rundungsdifferenz']['betrag_rappen'] !== 0));
pruef('Die Rundungszeile steht zwischen dem Nettolohn und dem Auszahlungsbetrag',
    !isset($zv['rundungsdifferenz'])
    || ($zv['rundungsdifferenz']['sortierung'] > $zv['nettolohn']['sortierung']
        && $zv['rundungsdifferenz']['sortierung'] < $zv['auszahlung']['sortierung']));
// Eine Zeile mit 0.00 waere in rund einem Fuenftel aller Abrechnungen zu
// sehen und sagte nichts. Fehlt sie, geht die Rechnung ohnehin auf.
pruef('Ohne Differenz entsteht keine Rundungszeile mit 0.00',
    count(array_filter($voll['zeilen'],
        fn($z) => $z['schluessel'] === 'rundungsdifferenz' && $z['betrag_rappen'] === 0)) === 0);

// ── Die Quellensteuer haengt an der PERSON, nicht am Lohn ────────────────
// KRITISCH: Zuerst entstand die gesperrte Zeile, sobald ein
// quellensteuerpflichtiger Lohnbestandteil vorlag -- also bei JEDEM
// normalen Lohn. Damit haette jede Abrechnung bis Etappe 5 gesperrt,
// obwohl die allermeisten Mitarbeitenden nicht quellensteuerpflichtig sind.
pruef('KRITISCH: ohne das Merkmal entsteht keine Quellensteuerzeile',
    !isset($zv['quellensteuer']) && $zv['auszahlung']['betrag_rappen'] !== null);
$pdo->exec("INSERT INTO lohn_person (id, mitarbeiter_id, gueltig_ab, nbu_pflichtig, qst_pflichtig)
            VALUES (3, 91, '2020-01-01', 1, 1)");
$qst = lohnlauf_abzuege($pdo, ['mitarbeiter_id' => 91] + $refKopf, '2026-07-31',
    ['stand' => LOHN_NBU_VERSICHERT]);
$zq = []; foreach ($qst['zeilen'] as $z) { $zq[$z['schluessel']] = $z; }
pruef('Mit dem Merkmal entsteht sie und sperrt -- Etappe 5, nicht stiller Nullabzug',
    isset($zq['quellensteuer']) && $zq['quellensteuer']['betrag_rappen'] === null
    && $zq['quellensteuer']['gesperrt_grund'] === 'quellensteuer_offen');
pruef('Und dann gibt es folgerichtig auch keinen Auszahlungsbetrag',
    $zq['auszahlung']['betrag_rappen'] === null);

// ── AHV und ALV stehen im Regelwerk, nicht in lohn_abzug ────────────────
//
// KRITISCH, und bis 2026-09-09 falsch: Der Katalog von lohn_abzuege.php bot
// 'ahv' und 'alv' zur Erfassung an, gelesen wurden sie dort nie. Ein
// eingetragener Satz war tote Zahl -- die Warnung "noch nicht erfasst"
// verschwand, die Rechnung blieb gleich. Das ist die gefaehrlichere
// Schwester von "unbekannt sieht aus wie keine": ERFASST SIEHT AUS WIE
// WIRKSAM.
//
// Geprueft wird das VERHALTEN, nicht der Katalog: Ein absichtlich falscher
// AHV-Satz in lohn_abzug darf den Betrag nicht bewegen. Eine Pruefung, die
// nur nachsieht, ob 'ahv' im Katalog fehlt, bliebe gruen, wenn jemand ihn
// wieder eintraegt UND gleichzeitig auslesen laesst.
$ahvVorher = $zv['ahv']['betrag_rappen'];
pruef('Der AHV-Abzug kommt aus dem Merkblatt: 5,30 % von 291.60 sind 15.45',
    $ahvVorher === -1545);
$pdo->exec("INSERT INTO lohn_abzug VALUES (20,'ahv','AHV','2020-01-01',NULL,9900,NULL,NULL,'erfunden')");
$pdo->exec("INSERT INTO lohn_abzug VALUES (21,'alv','ALV','2020-01-01',NULL,9900,NULL,NULL,'erfunden')");
$nachher = lohnlauf_abzuege($pdo, ['mitarbeiter_id' => $mkw] + $refKopf, '2026-07-31',
    ['stand' => LOHN_NBU_VERSICHERT]);
$zn = []; foreach ($nachher['zeilen'] as $z) { $zn[$z['schluessel']] = $z; }
pruef('KRITISCH: ein in lohn_abzug erfasster AHV-Satz aendert den Abzug NICHT',
    $zn['ahv']['betrag_rappen'] === $ahvVorher);
pruef('KRITISCH: dasselbe fuer die ALV -- 99 % im Satz bleiben wirkungslos',
    $zn['alv']['betrag_rappen'] === $zv['alv']['betrag_rappen']);
pruef('Und der Hinweis nennt weiterhin das Merkblatt, nicht die erfasste Quelle',
    str_contains((string)$zn['ahv']['hinweis'], 'Merkblatt 2.01')
    && !str_contains((string)$zn['ahv']['hinweis'], 'erfunden'));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
