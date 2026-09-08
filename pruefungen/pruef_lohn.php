<?php
declare(strict_types=1);
// Echte Ausfuehrung des Lohn-Rechenkerns (ENT-451).
//
// Warum eine eigene Pruefung und nicht nur ein Browser-Test: Die
// Browser-Suiten taeuschen die Serverantwort vor und kaemen an einer
// Lohnregel nie vorbei. Hier laeuft der echte Quelltext.
//
// Geprueft wird die AUSSAGE, nicht der Wortlaut: nicht "steht 8.33 im
// Code", sondern "eine 26-jaehrige Person in Kategorie C bekommt 4 Wochen
// und damit 8,33 %". Eine Pruefung, die ein Wort sucht, bleibt gruen, wenn
// die Formulierung sich aendert und die Sache verschwindet.
//
// Der wichtigste Block ist ganz unten: die vollstaendige Rechenkette einer
// Monatsabrechnung, gegen die Referenzloesung nachgerechnet.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// planung.php zieht db.php nach; hier wird keine Datenbank gebraucht.
function json_response($data, int $status = 200): void {}
require_once __DIR__ . '/../backend/lohn.php';
require_once __DIR__ . '/../backend/mitarbeiter.php';

// ── Lohnform folgt aus Art. 8, sie ist keine freie Angabe ────────────────
pruef('Kategorie A ergibt Monatslohn (Art. 8 Ziff. 1a)', lohn_form('A') === LOHN_FORM_MONAT);
pruef('Kategorie B ergibt Monatslohn (Art. 8 Ziff. 1a)', lohn_form('B') === LOHN_FORM_MONAT);
pruef('Kategorie C ergibt Stundenlohn (Art. 8 Ziff. 1a)', lohn_form('C') === LOHN_FORM_STUNDE);
// KRITISCH: Ohne Kategorie wird NICHT auf Stundenlohn geraten. Eine
// geratene Lohnform waere schlimmer als gar keine -- sie rechnete still
// falsch weiter. "Unbekannt" darf nie wie ein Ergebnis aussehen.
pruef('KRITISCH: ohne Anstellungskategorie gibt es keine Lohnform, statt eine zu raten',
    lohn_form(null) === null && lohn_form('') === null && lohn_form('X') === null);

// ── Dienstjahr nach Art. 16 Ziff. 2 ──────────────────────────────────────
// "Bei Arbeitsaufnahme vor dem 1. Juli wird das Eintrittsjahr als erstes
// Dienstjahr angerechnet." Der Stichtag 1. Juli ist die ganze Regel.
pruef('Eintritt am 30. Juni: das Eintrittsjahr zaehlt als erstes Dienstjahr',
    lohn_dienstjahr('2024-06-30', '2026-12-31') === 3);
pruef('Eintritt am 1. Juli: das Eintrittsjahr zaehlt NICHT mehr mit',
    lohn_dienstjahr('2024-07-01', '2026-12-31') === 2);
pruef('Am Eintrittstag selbst ist es das erste Dienstjahr',
    lohn_dienstjahr('2026-03-01', '2026-03-01') === 1);
pruef('Vor dem Eintritt gibt es kein Dienstjahr, auch keine Null',
    lohn_dienstjahr('2026-03-01', '2025-12-31') === null);
pruef('Ohne Eintrittsdatum kein Dienstjahr', lohn_dienstjahr(null, '2026-07-01') === null);

// ── Anhang 1: Mindestloehne ──────────────────────────────────────────────
$c1 = lohn_mindestlohn('C', '2026-01-01', '2026-07-31', 'SO');
pruef('Kat. C, 1. Dienstjahr, uebrige Kantone: 24.15',
    $c1['wert'] === 2415 && $c1['einheit'] === 'stunde');
pruef('Kat. C in Zuerich liegt hoeher als in den uebrigen Kantonen',
    lohn_mindestlohn('C', '2026-01-01', '2026-07-31', 'ZH')['wert'] > $c1['wert']);
pruef('Basel-Stadt, Basel-Land und Genf teilen sich eine Gruppe',
    lohn_kantonsgruppe('BS') === lohn_kantonsgruppe('BL')
    && lohn_kantonsgruppe('BL') === lohn_kantonsgruppe('GE')
    && lohn_kantonsgruppe('SO') !== lohn_kantonsgruppe('BS'));
// Die Tabelle endet beim 4. Dienstjahr mit "ab 4." -- ein 20. Dienstjahr
// darf nicht ins Leere greifen, sondern bekommt den letzten Wert.
pruef('Jenseits der letzten Tabellenzeile gilt deren Wert weiter ("ab 4. Dienstjahr")',
    lohn_mindestlohn('C', '2006-01-01', '2026-07-31', 'SO')['wert']
    === lohn_mindestlohn('C', '2023-01-01', '2026-07-31', 'SO')['wert']);
// Die zweite Tabelle des Anhangs. Wer nur eine erfasst, prueft gegen den
// falschen Mindestlohn.
pruef('Geld-/Werttransport hat eigene Ansaetze, die von den allgemeinen abweichen',
    lohn_mindestlohn('C', '2026-01-01', '2026-07-31', 'ZH', 'cit')['wert']
    !== lohn_mindestlohn('C', '2026-01-01', '2026-07-31', 'ZH')['wert']);

// KRITISCH: Was nicht berechenbar ist, kommt als null MIT GRUND zurueck --
// nie als 0. Ein Mindestlohn von 0 hiesse "kein Mindestlohn" und liesse
// jeden Ansatz durchgehen.
$ohne = lohn_mindestlohn(null, '2026-01-01', '2026-07-31');
pruef('KRITISCH: ohne Kategorie kein Mindestlohn von null Franken, sondern ein benannter Grund',
    $ohne['wert'] === null && $ohne['grund'] === 'keine_kategorie' && $ohne['text'] !== '');
$ohneEin = lohn_mindestlohn('C', null, '2026-07-31');
pruef('KRITISCH: ohne Eintritt ebenso -- mit eigenem, unterscheidbarem Grund',
    $ohneEin['wert'] === null && $ohneEin['grund'] === 'kein_eintritt'
    && $ohneEin['grund'] !== $ohne['grund']);
// Ausserhalb des Gueltigkeitszeitraums wird NICHT gerechnet. Eine spaetere
// GAV-Ausgabe wird angehaengt; bis dahin gibt es fuer 2027 keine Zahl.
$spaet = lohn_mindestlohn('C', '2026-01-01', '2027-07-31');
pruef('KRITISCH: ausserhalb des Regelwerk-Zeitraums wird keine Zahl erfunden',
    $spaet['wert'] === null && $spaet['grund'] === 'kein_regelwerk');

// Anhang 1, Anmerkung 1: Jahresansaetze werden im Verhaeltnis zur
// Arbeitszeit angepasst.
$b = lohn_mindestlohn('B', '2026-01-01', '2026-07-31');
$bHalb = lohn_mindestlohn_pensum($b, 700);
pruef('Kat. B mit halbem Bezugspensum ergibt den halben Jahresmindestlohn',
    $bHalb['wert'] === (int)round($b['wert'] / 2));
pruef('Ohne Pensum wird nicht hochgerechnet, und das wird gesagt',
    lohn_mindestlohn_pensum($b, null)['pensum_angewendet'] === false);
pruef('Beim Stundenlohn greift die Pensumsanpassung nicht',
    lohn_mindestlohn_pensum($c1, 400)['wert'] === $c1['wert']);

// ── Art. 20 Ziff. 2: Ferienentschaedigung ────────────────────────────────
// Die Schwelle ist das ALTERSJAHR, nicht das Dienstjahr -- anders als bei
// Kategorie A und B in Ziff. 1.
pruef('Bis zum 20. Altersjahr 5 Wochen, also 10,64 %',
    lohn_ferienentschaedigung_bp('2008-05-04', '2026-07-31')['bp'] === LOHN_FERIEN_BP_5W);
pruef('Ab dem Kalenderjahr des 21. Geburtstags 4 Wochen, also 8,33 %',
    lohn_ferienentschaedigung_bp('2005-11-30', '2026-07-31')['bp'] === LOHN_FERIEN_BP_4W);
// Das ganze Kalenderjahr, nicht erst ab dem Geburtstag: Der Geburtstag im
// November wirkt schon im Januar desselben Jahres.
pruef('Es zaehlt das ganze Kalenderjahr, nicht erst der Geburtstag',
    lohn_ferienentschaedigung_bp('2005-11-30', '2026-01-31')['bp'] === LOHN_FERIEN_BP_4W);
// KRITISCH: GAV-AUS-016 ist offen. Der Betriebsentscheid aus ENT-451 lautet
// "im Zweifel zugunsten der mitarbeitenden Person" -- fehlt das
// Geburtsdatum, gilt der HOEHERE Satz, und das wird als Annahme markiert.
$ohneGeb = lohn_ferienentschaedigung_bp(null, '2026-07-31');
pruef('KRITISCH: ohne Geburtsdatum gilt der hoehere Satz, nicht der niedrigere (ENT-451)',
    $ohneGeb['bp'] === LOHN_FERIEN_BP_5W && $ohneGeb['bp'] > LOHN_FERIEN_BP_4W);
pruef('KRITISCH: und dieser Fall ist als Annahme gekennzeichnet, nicht als Tatsache',
    $ohneGeb['annahme'] === true
    && lohn_ferienentschaedigung_bp('2005-11-30', '2026-07-31')['annahme'] === false);

// ── Art. 6 Ziff. 2: PaKo-Vollzugskostenbeitrag ───────────────────────────
pruef('Kat. A zahlt einen Monatsbetrag, unabhaengig von den Stunden',
    lohn_pako_beitrag_rappen('A', 0.0)['rappen'] === 250
    && lohn_pako_beitrag_rappen('A', 180.0)['rappen'] === 250);
pruef('Kat. B und C zahlen 1,5 Rappen je Stunde',
    lohn_pako_beitrag_rappen('C', 100.0)['rappen'] === 150
    && lohn_pako_beitrag_rappen('B', 100.0)['rappen'] === 150);
// 1,5 Rappen sind kein ganzer Rappen. Der Betrag entsteht aus der
// MONATSSUMME und wird einmal gerundet -- je Schicht gerundet zahlte jede
// angebrochene Stunde einen halben Rappen zu viel oder zu wenig.
pruef('Der Beitrag wird aus der Monatssumme gerundet, nicht je Schicht',
    lohn_pako_beitrag_rappen('C', 173.0)['rappen'] === 260
    && lohn_pako_beitrag_rappen('C', 1.0)['rappen'] * 173 !== 260);
pruef('KRITISCH: ohne Kategorie kein PaKo-Beitrag von null, sondern ein Grund',
    lohn_pako_beitrag_rappen(null, 100.0)['rappen'] === null
    && lohn_pako_beitrag_rappen(null, 100.0)['grund'] === 'keine_kategorie');

// ── Art. 25 Ziff. 3: BVG-Eintritt ────────────────────────────────────────
// "Ab 1. Januar nach Vollendung des 24. Altersjahres."
pruef('BVG-pflichtig ab dem 1. Januar nach dem 24. Geburtstag',
    lohn_bvg_pflichtig_ab('2000-12-31') === '2025-01-01');
pruef('Ohne Geburtsdatum keine BVG-Schwelle', lohn_bvg_pflichtig_ab(null) === null);

// ── Rappen und Rundung ───────────────────────────────────────────────────
pruef('Kaufmaennisch gerundet wird von der Null weg, in beide Richtungen',
    lohn_rappen(0.5) === 1 && lohn_rappen(-0.5) === -1 && lohn_rappen(0.4) === 0);
pruef('Ein Prozentanteil ergibt ganze Rappen', lohn_anteil(2500, 833) === 208);

// ── AHV-Nummer und IBAN ──────────────────────────────────────────────────
pruef('Eine gueltige AHV-Nummer wird auf 756.XXXX.XXXX.XX normalisiert',
    ahv_nr_pruefen('7561234567897') === '756.1234.5678.97');
// KRITISCH: Der haeufigste Fehler ist die vertauschte Ziffer -- sie aendert
// die Laenge nicht und kaeme durch eine blosse Laengenpruefung durch.
pruef('KRITISCH: eine vertauschte Ziffer faellt durch die Pruefziffer auf',
    ahv_nr_pruefen('756.1243.5678.97') === null);
pruef('Ein fremdes Laenderpraefix wird abgewiesen',
    ahv_nr_pruefen('123.1234.5678.97') === null);
pruef('Eine gueltige IBAN wird ohne Leerzeichen zurueckgegeben',
    iban_pruefen('CH93 0076 2011 6238 5295 7') === 'CH9300762011623852957');
pruef('KRITISCH: eine falsche IBAN-Pruefsumme faellt auf',
    iban_pruefen('CH94 0076 2011 6238 5295 7') === null);

// ── Die vollstaendige Rechenkette einer Monatsabrechnung ─────────────────
// Nachgerechnet gegen die Referenzloesung, die der Betrieb heute einsetzt:
// Stundenlohn 25.00, Kategorie C, 26 Jahre alt, 10.00 Stunden im Monat.
//
// Die REIHENFOLGE ist hier die eigentliche Aussage. Der Bruttostundenlohn
// wird aus gerundeten Bestandteilen gebildet und DANN mit den Stunden
// multipliziert. Rechnete man je Bestandteil mal Stunden und summierte
// erst danach, kaemen 291.66 statt 291.60 heraus -- sechs Rappen
// Unterschied bei zehn Stunden, und beides waere vertretbar. Genau darum
// steht die Reihenfolge hier fest und nicht im Ermessen der Oberflaeche.
$grund   = 2500;
$ferienB = lohn_ferienentschaedigung_bp('2000-05-04', '2026-07-31')['bp'];
$ferien  = lohn_anteil($grund, $ferienB);
$ml13    = lohn_anteil($grund, 833);
$brutto  = $grund + $ferien + $ml13;
$stunden = 10.0;
$lohn    = lohn_rappen($brutto * $stunden);
$pako    = lohn_pako_beitrag_rappen('C', $stunden)['rappen'];

pruef('Ferienentschaedigung auf 25.00 ergibt 2.08', $ferien === 208);
pruef('Anteil 13. Monatslohn auf 25.00 ergibt 2.08', $ml13 === 208);
pruef('Bruttostundenlohn ergibt 29.16', $brutto === 2916);
pruef('Zehn Stunden ergeben 291.60 Bruttolohn', $lohn === 29160);
pruef('Der PaKo-Abzug fuer zehn Stunden betraegt 0.15', $pako === 15);
// Die Gegenrechnung der anderen Reihenfolge -- sie MUSS abweichen, sonst
// prueft der Testfall oben nichts.
//
// Die Alternative ist NICHT "gerundete Bestandteile mal Stunden" -- das
// ergibt zufaellig dasselbe, weil die Rundung schon geschehen ist. Der
// wirkliche Unterschied entsteht, wenn der Prozentsatz erst auf den
// MONATSBETRAG angewendet und dann einmal gerundet wird: Aus 2 x 208
// Rappen je Stunde werden dann 2 x 2083 statt 2 x 2080 Rappen im Monat.
// Sechs Rappen bei zehn Stunden -- und mit den Stunden waechst der
// Unterschied. Beide Wege sind vertretbar; darum steht der gewaehlte fest.
$monatsgrund = lohn_rappen($grund * $stunden);
$andereReihenfolge = $monatsgrund
    + lohn_anteil($monatsgrund, $ferienB) + lohn_anteil($monatsgrund, 833);
pruef('KRITISCH: die andere Rechenreihenfolge ergibt nachweislich etwas anderes -- die Festlegung ist keine Formsache',
    $andereReihenfolge === 29166 && $andereReihenfolge !== $lohn);

// Ein 19-Jaehriger in derselben Lage bekommt mehr, nicht gleich viel.
$ferienJung = lohn_anteil($grund, lohn_ferienentschaedigung_bp('2008-05-04', '2026-07-31')['bp']);
pruef('Eine 18-jaehrige Person bekommt bei gleichem Grundlohn mehr Ferienentschaedigung',
    $ferienJung > $ferien && $ferienJung === 266);

// ── Der Lohnartenkatalog ─────────────────────────────────────────────────
$kz = lohnart_kennzeichen();
pruef('Es sind genau die sechs entschiedenen Kennzeichen (ENT-451)',
    count($kz) === 6
    && array_keys($kz) === ['ahv_pflichtig','ferien_pflichtig','ml13_pflichtig',
                            'bvg_pflichtig','uvg_pflichtig','qst_pflichtig']);
pruef('Jedes Kennzeichen traegt eine Erklaerung, keine leere Zeichenkette',
    count(array_filter($kz, fn($t) => trim($t) !== '')) === 6);
pruef('Es gibt eine Lohnart-Art fuer Betraege, die weder Lohn noch Abzug sind',
    array_key_exists('netto', lohnart_arten()));

// ══════════════════════════════════════════════════════════════════════════
// BUNDESRECHT AHV/IV/EO (Etappe 4).
//
// Diese Pruefungen rechnen die BEISPIELE DES MERKBLATTS nach, nicht meine
// eigenen. Das ist der Unterschied zwischen "der Code tut, was ich dachte"
// und "der Code tut, was die Quelle sagt". Merkblatt 2.01, Stand am
// 1. Januar 2026 -- vom Projektinhaber als Dokument beigebracht, nachdem
// eine Websuche fuer dieselbe Frage veraltete Werte geliefert hatte.

// ── Ziff. 1: die Jahrgangstabelle des Merkblatts ─────────────────────────
// "Erwerbstaetige Personen sind ab dem 1. Januar nach dem 17. Geburtstag
// beitragspflichtig." Das Merkblatt fuehrt die Jahrgaenge 2007 bis 2010
// einzeln auf -- genau die werden hier nachgerechnet.
foreach ([2007 => 2025, 2008 => 2026, 2009 => 2027, 2010 => 2028] as $jg => $ab) {
    pruef("AHV-pflichtig: Jahrgang $jg ab $ab (Merkblatt 2.01 Ziff. 1)",
        lohn_ahv_pflichtig_ab("$jg-08-15") === "$ab-01-01");
}
// Das TAGESDATUM darf nichts aendern -- das Merkblatt kennt nur Jahrgaenge.
pruef('AHV-Pflicht haengt am Jahrgang, nicht am Geburtstag im Jahr',
    lohn_ahv_pflichtig_ab('2008-01-01') === lohn_ahv_pflichtig_ab('2008-12-31'));
pruef('Ohne Geburtsdatum keine geratene Beitragspflicht',
    lohn_ahv_pflichtig_ab(null) === null);

// ── Ziff. 2: Referenzalter samt Uebergangsjahrgaengen ────────────────────
// Das Merkblatt fuehrt eine Tabelle: Frauen der Jahrgaenge 1960 bis 1963
// haben ein tieferes Referenzalter, ab 1964 sind es 65 Jahre.
foreach ([1960 => 768, 1961 => 771, 1962 => 774, 1963 => 777, 1964 => 780] as $jg => $soll) {
    pruef("Referenzalter Frau Jahrgang $jg: $soll Monate (Merkblatt 2.01 Ziff. 2)",
        lohn_referenzalter("$jg-03-10", 'weiblich')['monate'] === $soll);
}
pruef('Referenzalter Mann Jahrgang 1960: 65 Jahre, die Uebergangsregel gilt nur fuer Frauen',
    lohn_referenzalter('1960-03-10', 'maennlich')['monate'] === 780);
// KRITISCH: Bei einem Uebergangsjahrgang ohne gesichertes Geschlecht wird
// NICHT auf 65 geraten. Fuer eine Frau des Jahrgangs 1960 waere das ein
// Jahr zu spaet -- ein Jahr ALV-Abzug zuviel, den niemand bemerkt.
$unbestimmt = lohn_referenzalter('1961-03-10', 'unbestimmt');
pruef('Uebergangsjahrgang ohne Geschlecht: unbekannt statt geraten',
    $unbestimmt['unbekannt'] === true && $unbestimmt['grund'] === 'geschlecht_unbestimmt'
    && $unbestimmt['erreicht_am'] === null);
// Umgekehrt: Ausserhalb der Uebergangsjahrgaenge wird das Geschlecht gar
// nicht gebraucht -- dort waere eine Sperre falsch.
$ohne = lohn_referenzalter('1975-03-10', null);
pruef('Jahrgang 1975 braucht kein Geschlecht: 65 Jahre, keine Sperre',
    $ohne['unbekannt'] === false && $ohne['monate'] === 780);
pruef('Ohne Geburtsdatum kein geratenes Referenzalter',
    lohn_referenzalter(null, 'weiblich')['grund'] === 'kein_geburtsdatum');

// ── Ziff. 17 und 18: der Freibetrag und seine Monatszaehlung ─────────────
// Das Merkblatt rechnet vor: 30. Maerz bis 6. Juni sind VIER Monate, weil
// Anfangs- und Endmonat je ganz zaehlen. Taggenau waeren es gut zwei --
// wer so rechnet, zieht zu wenig ab und belastet den Mitarbeitenden mit
// Beitraegen, die er nicht schuldet.
pruef('Angebrochene Monate: 30. Maerz bis 6. Juni sind 4 (Merkblatt 2.01 Ziff. 17)',
    lohn_angebrochene_monate('2026-03-30', '2026-06-06') === 4);
pruef('Freibetrag 4 Monate = 5600.00 CHF (Merkblatt 2.01 Ziff. 17, Beispiel)',
    lohn_ahv_freibetrag_rappen(4, '2026-06-06') === 560000);
// Beispiel 2 des Merkblatts, beide Arbeitsverhaeltnisse.
pruef('Merkblatt Ziff. 18 Beispiel 2, Firma C: 1. Maerz bis 6. April = 2800.00 CHF',
    lohn_ahv_freibetrag_rappen(
        lohn_angebrochene_monate('2026-03-01', '2026-04-06'), '2026-04-06') === 280000);
pruef('Merkblatt Ziff. 18 Beispiel 2, Firma D: 23. bis 30. April = 1400.00 CHF',
    lohn_ahv_freibetrag_rappen(
        lohn_angebrochene_monate('2026-04-23', '2026-04-30'), '2026-04-30') === 140000);
pruef('Ein voller Monat zaehlt als einer, nicht als zwei',
    lohn_angebrochene_monate('2026-04-01', '2026-04-30') === 1);
pruef('Ein einziger Tag ist ein angebrochener Monat',
    lohn_angebrochene_monate('2026-04-15', '2026-04-15') === 1);
pruef('Verdrehter Zeitraum ergibt 0 Monate, keinen negativen Freibetrag',
    lohn_angebrochene_monate('2026-06-01', '2026-03-01') === 0);
pruef('Freibetrag ist auf den Jahresbetrag gedeckelt (Merkblatt 2.01 Ziff. 15)',
    lohn_ahv_freibetrag_rappen(14, '2026-12-31') === 1680000);
pruef('Zwoelf Monate ergeben genau den Jahresfreibetrag',
    lohn_ahv_freibetrag_rappen(12, '2026-12-31') === 1680000);
pruef('Null Monate ergeben keinen Freibetrag von null, sondern gar keinen',
    lohn_ahv_freibetrag_rappen(0, '2026-12-31') === null);

// ── Ziff. 3: die Beitragssaetze ──────────────────────────────────────────
$sv = lohn_sv('2026-07-15');
pruef('Arbeitnehmeranteil 5,30 % (Merkblatt 2.01 Ziff. 3)', $sv['an_bp'] === 530);
pruef('AHV 8,7 + IV 1,4 + EO 0,5 ergibt die ausgewiesenen 10,6 %',
    $sv['ahv_bp'] + $sv['iv_bp'] + $sv['eo_bp'] === $sv['total_bp']);
// Der Arbeitnehmeranteil ist die HAELFTE des Gesamtsatzes -- steht so im
// Merkblatt und ist die Probe darauf, dass keine der vier Zahlen verrutscht.
pruef('Der Arbeitnehmeranteil ist genau die Haelfte des Gesamtsatzes',
    $sv['an_bp'] * 2 === $sv['total_bp']);
pruef('Jeder Jahrgang des Regelwerks fuehrt seine Quelle mit',
    count(array_filter(LOHN_SV, fn($j) => trim($j['quelle'] ?? '') !== '')) === count(LOHN_SV));
// KRITISCH: Ein nicht erfasstes Jahr liefert NULL, nicht stillschweigend
// das naechstgelegene. Sonst rechnete 2027 weiter mit den Saetzen von 2026,
// ohne dass etwas kaputtgeht -- genau die Fehlerfamilie, wegen der die
// Quellensteuer in Etappe 5 gesperrt statt genullt wird.
pruef('Ein nicht erfasstes Beitragsjahr liefert null statt der Vorjahressaetze',
    lohn_sv('2025-07-15') === null && lohn_sv('2027-07-15') === null);
pruef('Der Anteil rechnet aus dem Regelwerk korrekt: 5,30 % von 291.60 sind 15.45',
    lohn_anteil(29160, $sv['an_bp']) === 1545);

// ── ALV: Merkblatt 2.08, Stand 1. Januar 2025 ────────────────────────────
//
// Nachgerechnet werden die Beispiele DES MERKBLATTS, nicht selbst
// ausgedachte. Ein selbst gewaehltes Beispiel prueft nur, ob der Code tut,
// was ich beim Schreiben dachte; das Merkblattbeispiel prueft, ob er tut,
// was der Bund vorschreibt.
$alv = lohn_alv('2025-06-30');
pruef('ALV 2025 ist erfasst und nennt seine Quelle',
    $alv !== null && str_contains($alv['quelle'], '2.08') && str_contains($alv['quelle'], '2025'));
pruef('Ziff. 1: Gesamtsatz 2,2 %, Arbeitnehmeranteil die Haelfte davon',
    $alv['total_bp'] === 220 && $alv['an_bp'] === 110
    && $alv['an_bp'] * 2 === $alv['total_bp']);
pruef('Ziff. 1: Jahreshoechstbetrag 148 200 Franken',
    $alv['hoechstbetrag_jahr_rappen'] === 14820000);
// KRITISCH: Oberhalb der Grenze faellt seit 2023 GAR NICHTS mehr an. Stuende
// hier versehentlich ein Satz, zoege das Werkzeug von hohen Loehnen einen
// Beitrag ab, den es nicht mehr gibt.
pruef('Ziff. 1: oberhalb der Grenze kein zweiter Satz mehr (seit 2023)',
    $alv['ueber_grenze_bp'] === 0);

// Ziff. 2 als Gegenprobe ueber beide Regelwerke hinweg: Das Merkblatt nennt
// 12,8 % fuer AHV, IV, EO UND ALV zusammen. Unsere beiden Quellen muessen
// sich zu genau diesem Wert addieren -- sonst widerspricht eine der anderen.
pruef('Ziff. 2: AHV/IV/EO 10,6 % plus ALV 2,2 % ergeben die genannten 12,8 %',
    LOHN_SV[2026]['total_bp'] + $alv['total_bp'] === 1280);

// Ziff. 4, das durchgerechnete Beispiel: 15. April bis 29. Dezember.
pruef('Ziff. 4: 15. April bis 29. Dezember sind 255 angerechnete Tage',
    lohn_alv_tage('2025-04-15', '2025-12-29') === 255);
// Gegenprobe zur Zaehlweise: taggenau waeren es 259. Wer Kalendertage
// nimmt, bekommt eine hoehere Grenze und zieht zu lange ALV ab.
pruef('Die 30-Tage-Zaehlung ist nicht die Kalendertagzaehlung',
    lohn_alv_tage('2025-04-15', '2025-12-29')
    !== (int)((new DateTime('2025-12-29'))->diff(new DateTime('2025-04-15'))->days) + 1);
pruef('Ziff. 4: der unterjaehrige Hoechstbetrag betraegt 104 975 Franken',
    lohn_alv_hoechstbetrag('2025-04-15', '2025-12-29', $alv) === 10497500);
pruef('Ziff. 4: auf den darueber liegenden Lohnanteil entfallen 11 225 Franken',
    11620000 - lohn_alv_hoechstbetrag('2025-04-15', '2025-12-29', $alv) === 1122500);
pruef('Ziff. 4: 12,8 % von 104 975 sind 13 436.80',
    lohn_anteil(10497500, 1280) === 1343680);
pruef('Ziff. 4: 10,6 % von 11 225 sind 1 189.85',
    lohn_anteil(1122500, 1060) === 118985);
pruef('Ziff. 4: die Beitraege zusammen ergeben 14 626.65',
    lohn_anteil(10497500, 1280) + lohn_anteil(1122500, 1060) === 1462665);
// KRITISCH und zugleich der Beleg fuer die 5-Rappen-Rundung: Die Haelfte von
// 14 626.65 ist exakt 7 313.325. Das Merkblatt weist 7 313.35 aus. Auf
// Rappen gerundet waeren es 7 313.33 -- der Wert des Merkblatts ist nur mit
// Rundung auf 5 Rappen erreichbar.
pruef('Ziff. 4: die Haelfte von 14 626.65 ergibt auf 5 Rappen die 7 313.35 des Merkblatts',
    lohn_fuenfrappen(1462665 / 2) === 731335);
pruef('Rappenrundung wuerde den Merkblattwert VERFEHLEN (7 313.33)',
    lohn_rappen(1462665 / 2) === 731333 && lohn_rappen(1462665 / 2) !== 731335);

// Ziff. 5: die Monatsgrenze der laufenden Abrechnung.
pruef('Ziff. 5: der provisorische Monatshoechstbetrag ist ein Zwoelftel, also 12 350',
    lohn_alv_monatsgrenze($alv) === 1235000 && 1235000 * 12 === 14820000);

// Ziff. 2: ein volles Jahr ergibt genau den Jahresbetrag, nicht mehr.
pruef('Ein volles Jahr ergibt genau den Jahreshoechstbetrag',
    lohn_alv_hoechstbetrag('2025-01-01', '2025-12-31', $alv) === 14820000);
pruef('Ein Zeitraum ueber zwoelf Monate hinaus hebt die Jahresgrenze nicht an',
    lohn_alv_hoechstbetrag('2025-01-01', '2026-06-30', $alv) === 14820000);
pruef('Ein Monat innerhalb desselben Kalendermonats zaehlt taggenau bis 30',
    lohn_alv_tage('2025-04-15', '2025-04-20') === 6
    && lohn_alv_tage('2025-04-01', '2025-04-30') === 30
    && lohn_alv_tage('2025-01-01', '2025-01-31') === 30);
pruef('Ein umgekehrter Zeitraum ergibt null statt einer geratenen Zahl',
    lohn_alv_tage('2025-12-29', '2025-04-15') === null);

// KRITISCH, gleiche Familie wie bei LOHN_SV: Das ALV-Merkblatt liegt nur im
// Stand 2025 vor. Fuer 2026 darf NICHT stillschweigend derselbe Satz gelten
// -- eine veraltete Grenze produziert weiterhin plausible Betraege.
pruef('Ein nicht erfasstes ALV-Jahr liefert null statt des Vorjahressatzes',
    lohn_alv('2026-07-15') === null && lohn_alv('2024-07-15') === null);
pruef('Der ALV-Jahrgang traegt seine Quelle mit Stand und Ziffern',
    count(array_filter(LOHN_ALV, fn($j) => trim($j['quelle'] ?? '') !== '')) === count(LOHN_ALV));
pruef('Der Hoechstbetrag gilt je Arbeitsverhaeltnis, nicht je Person (Ziff. 1)',
    LOHN_ALV_JE_ARBEITSVERHAELTNIS === true);

// ── UVG: Merkblatt 6.05, Stand 1. Januar 2025 ────────────────────────────
$uvg = lohn_uvg('2025-06-30');
pruef('UVG 2025 ist erfasst und nennt seine Quelle',
    $uvg !== null && str_contains($uvg['quelle'], '6.05') && str_contains($uvg['quelle'], '2025'));
pruef('Ziff. 5: Hoechstbetrag 148 200 im Jahr UND 406 am Tag, beide einzeln',
    $uvg['hoechstbetrag_jahr_rappen'] === 14820000
    && $uvg['hoechstbetrag_tag_rappen'] === 40600);
// KRITISCH: Der Tagesbetrag ist KEINE Ableitung. Waere er es, muesste eine
// der beiden Rechnungen aufgehen -- keine tut es. Diese Pruefung haelt fest,
// dass hier nicht gerechnet werden darf.
pruef('Der Tagesbetrag laesst sich aus dem Jahresbetrag NICHT herleiten',
    lohn_rappen($uvg['hoechstbetrag_jahr_rappen'] / 360) !== $uvg['hoechstbetrag_tag_rappen']
    && lohn_rappen($uvg['hoechstbetrag_jahr_rappen'] / 365) !== $uvg['hoechstbetrag_tag_rappen']
    && $uvg['hoechstbetrag_tag_rappen'] * 365 !== $uvg['hoechstbetrag_jahr_rappen']);
// Gleicher Betrag, zwei Gesetze: nachgewiesen aus zwei Merkblaettern, nicht
// voneinander abgeleitet. Die Pruefung haelt die Gleichheit fest, damit ein
// spaeteres Auseinanderlaufen auffaellt -- und nicht, weil eines das andere
// bestimmt.
pruef('UVG-Jahresbetrag und ALV-Obergrenze stimmen ueberein (zwei Quellen, keine Ableitung)',
    $uvg['hoechstbetrag_jahr_rappen'] === LOHN_ALV[2025]['hoechstbetrag_jahr_rappen']);
pruef('Die ALV-Zaehlung 30/360 gilt fuer das UVG nicht mit',
    LOHN_ALV[2025]['tage_jahr'] === 360 && !array_key_exists('tage_jahr', $uvg));

// Ziff. 5: wer welche Praemie traegt.
pruef('Ziff. 5: den Berufsunfall traegt der Arbeitgeber, den Nichtberufsunfall der Mitarbeitende',
    LOHN_BU_TRAEGT === 'arbeitgeber' && LOHN_NBU_TRAEGT === 'arbeitnehmer'
    && LOHN_BU_TRAEGT !== LOHN_NBU_TRAEGT);
pruef('Der Lohnartenkatalog kennt einen NBU-Abzug, aber KEINEN BU-Abzug',
    count(array_filter(lohnart_startbestand(), fn($l) => $l[0] === 'nbu')) === 1
    && count(array_filter(lohnart_startbestand(), fn($l) => $l[0] === 'bu')) === 0);

// Ziff. 4: die Acht-Stunden-Schwelle. Vom Projektinhaber als Hinweis
// eingebracht, hier aus der Primaerquelle bestaetigt.
pruef('Ziff. 4: die Schwelle liegt bei acht Wochenstunden',
    $uvg['nbu_schwelle_std_woche'] === 8);
pruef('Acht Stunden genau genuegen -- "mindestens acht" schliesst die acht ein',
    lohn_nbu_deckung(8.0, $uvg)['stand'] === LOHN_NBU_VERSICHERT);
pruef('Knapp darunter besteht keine NBU-Deckung',
    lohn_nbu_deckung(7.9, $uvg)['stand'] === LOHN_NBU_NICHT);
pruef('Ein Aushilfseinsatz von vier Wochenstunden erzeugt keinen NBU-Abzug',
    lohn_nbu_deckung(4.0, $uvg)['stand'] === LOHN_NBU_NICHT);
// KRITISCH und die eigentliche Aussage dieses Blocks: Unbekannt ist nicht
// "nicht versichert" und erst recht nicht "versichert". Beides waere geraten,
// und beide Richtungen kosten jemanden Geld.
pruef('Unbekannte Wochenarbeitszeit ergibt "unbekannt", nicht eine der beiden Antworten',
    lohn_nbu_deckung(null, $uvg)['stand'] === LOHN_NBU_UNBEKANNT
    && LOHN_NBU_UNBEKANNT !== LOHN_NBU_NICHT
    && LOHN_NBU_UNBEKANNT !== LOHN_NBU_VERSICHERT);
pruef('Jede der drei Antworten traegt einen erklaerenden Satz mit Fundstelle',
    count(array_filter([lohn_nbu_deckung(null, $uvg), lohn_nbu_deckung(4.0, $uvg),
                        lohn_nbu_deckung(9.0, $uvg)],
        fn($d) => strlen($d['text']) > 40 && str_contains($d['text'], '6.05'))) === 3);
// KRITISCH, und beim Bauen selbst aufgefallen: 'pensum_stunden' ist ein
// JAHRESpensum von 1 bis 3000 Stunden (ENT-065). Wird es versehentlich als
// Wochenarbeitszeit hereingereicht, antwortete die Funktion ohne Schutz brav
// "versichert" -- fuer JEDE Person, auch die Aushilfe mit vier Wochenstunden.
// Geprueft wird das VERHALTEN, nicht der Wortlaut des Quelltextes.
pruef('Ein versehentlich uebergebenes Jahrespensum ergibt nicht "versichert"',
    lohn_nbu_deckung(416.0, $uvg)['stand'] === LOHN_NBU_UNBEKANNT
    && lohn_nbu_deckung(1800.0, $uvg)['stand'] === LOHN_NBU_UNBEKANNT
    && lohn_nbu_deckung(3000.0, $uvg)['stand'] === LOHN_NBU_UNBEKANNT);
pruef('Die Obergrenze ist die Woche selbst: 168 Stunden gelten noch, 169 nicht mehr',
    lohn_nbu_deckung(168.0, $uvg)['stand'] === LOHN_NBU_VERSICHERT
    && lohn_nbu_deckung(169.0, $uvg)['stand'] === LOHN_NBU_UNBEKANNT);
pruef('Der Hinweis benennt den vermuteten Fehler, statt nur "unbekannt" zu sagen',
    str_contains(lohn_nbu_deckung(416.0, $uvg)['text'], 'Jahrespensum'));
pruef('Ein nicht erfasstes UVG-Jahr liefert null statt des Vorjahreswerts',
    lohn_uvg('2026-07-15') === null && lohn_uvg('2024-07-15') === null);

// ── NBU-Unterstellung nach Empfehlung 7/87 ───────────────────────────────
//
// Grundlage vom Projektinhaber: BGer 8C_644/2025 und Empfehlung 7/87.
// Die ersten drei Faelle sind SEINE Beispiele, mit seinen Erwartungswerten.
$e = fn(array $w) => lohn_nbu_ermittlung($w, $uvg);
pruef('Beispiel 1: abwechselnd 20 und 0 Stunden ergibt Ø 10 und damit Deckung',
    $e([20,0,20,0,20,0])['stand'] === LOHN_NBU_VERSICHERT
    && abs($e([20,0,20,0,20,0])['schnitt_std'] - 10.0) < 0.001);
pruef('Beispiel 2: eine Woche 20, dann zwei Wochen 0 ergibt Ø 6,67 und keine Deckung',
    $e([20,0,0,20,0,0])['stand'] === LOHN_NBU_NICHT
    && abs($e([20,0,0,20,0,0])['schnitt_std'] - 6.6667) < 0.001);
pruef('Beispiel 3: mehr Arbeits- als Nullwochen, die Nullwochen fallen raus',
    $e([20,20,0,20,20,0])['stand'] === LOHN_NBU_VERSICHERT
    && $e([20,20,0,20,20,0])['basis'] === 'nur_arbeitswochen');

// Die vier Regeln einzeln -- jede mit einem Fall, in dem NUR sie die
// Entscheidung traegt. Ein Beispiel, das ueber zwei Wege zugleich zur
// Deckung fuehrt, belegt keine der beiden Regeln.
pruef('Regel 2 allein traegt: 8,8,8,1,1 hat Ø 5,2 aber die Mehrheit ab der Schwelle',
    $e([8,8,8,1,1])['stand'] === LOHN_NBU_VERSICHERT
    && $e([8,8,8,1,1])['ueber_schnitt'] === false
    && $e([8,8,8,1,1])['ueber_mehrheit'] === true);
pruef('Regel 3 allein traegt: 12,12,4,0,0 deckt nur, weil die Nullwochen rausfallen',
    $e([12,12,4,0,0])['stand'] === LOHN_NBU_VERSICHERT
    && $e([12,12,4,0,0])['basis'] === 'nur_arbeitswochen'
    && $e([12,12,4,0,0])['ueber_mehrheit'] === false
    && array_sum([12,12,4,0,0]) / 5 < 8.0);
// KRITISCH: "ueberwiegen" heisst MEHR, nicht gleich viel. Bei Gleichstand
// zaehlen alle Wochen -- sonst bekaeme jeder Zweiwochenrhythmus die
// guenstigere Rechnung geschenkt.
pruef('Bei Gleichstand von Arbeits- und Nullwochen zaehlen alle Kalenderwochen',
    $e([8,0,8,0])['basis'] === 'alle_wochen'
    && $e([8,0,8,0,8,0,8,0])['basis'] === 'alle_wochen');
pruef('Genau acht Stunden im Schnitt genuegen -- die Schwelle ist eingeschlossen',
    $e([8,8,8,8])['stand'] === LOHN_NBU_VERSICHERT
    && $e([7.99,7.99,7.99,7.99])['stand'] === LOHN_NBU_NICHT);
// KRITISCH und der Fall, den der Projektinhaber selbst als offen benannt
// hat: Neueintritt ohne Stundenhistorie. Keine Historie ist NICHT
// "nicht versichert".
pruef('Ohne Stundenhistorie lautet die Antwort "unbekannt", nicht "nicht versichert"',
    $e([])['stand'] === LOHN_NBU_UNBEKANNT && $e([])['schnitt_std'] === null);
pruef('Jedes Ergebnis traegt seine Herleitung mit, nicht nur ein Ja oder Nein',
    str_contains($e([20,0,20,0,20,0])['text'], '7/87')
    && str_contains($e([12,12,4,0,0])['text'], '7/87')
    && str_contains($e([20,0,0,20,0,0])['text'], 'Woche'));

// Die guenstigere der beiden Varianten.
pruef('Die guenstigere Variante ist die MIT Deckung',
    LOHN_NBU_GUENSTIGER === LOHN_NBU_VERSICHERT);
pruef('Empfehlung 7/87: geprueft werden drei und zwoelf Monate',
    LOHN_NBU_FENSTER_MONATE === [3, 12]);
// KRITISCH: Reicht EINE Variante, gilt Deckung. Waere es umgekehrt, verloere
// die Aushilfe mit schwankendem Einsatz die Deckung, sobald ein einziges
// Fenster ungluecklich liegt.
pruef('Deckt nur die Zwoelfmonatsvariante, gilt trotzdem Deckung',
    lohn_nbu_unterstellung([3 => $e([20,0,0,20,0,0]), 12 => $e([20,0,20,0,20,0])], $uvg)['stand']
        === LOHN_NBU_VERSICHERT);
pruef('Deckt nur die Dreimonatsvariante, gilt ebenfalls Deckung',
    lohn_nbu_unterstellung([3 => $e([20,0,20,0,20,0]), 12 => $e([20,0,0,20,0,0])], $uvg)['stand']
        === LOHN_NBU_VERSICHERT);
pruef('Das Ergebnis nennt, welche Variante entschieden hat',
    lohn_nbu_unterstellung([3 => $e([20,0,0,20,0,0]), 12 => $e([20,0,20,0,20,0])], $uvg)['entschieden_durch'] === 12);
pruef('Deckt keine Variante, steht "nicht versichert" fest',
    lohn_nbu_unterstellung([3 => $e([20,0,0,20,0,0]), 12 => $e([20,0,0,20,0,0])], $uvg)['stand']
        === LOHN_NBU_NICHT);
pruef('Sind alle Varianten ohne Historie, bleibt es unbekannt statt unversichert',
    lohn_nbu_unterstellung([3 => $e([]), 12 => $e([])], $uvg)['stand'] === LOHN_NBU_UNBEKANNT);
// Das vertragliche Pensum ist nach BGer 8C_644/2025 NICHT massgebend. Der
// Rechenkern kennt darum ueberhaupt keinen Weg, es einzubringen: Er nimmt
// nur geleistete Wochenstunden entgegen.
pruef('Ein 20-Prozent-Pensum aendert nichts -- gerechnet wird aus geleisteten Stunden',
    $e([2,2,2,2])['stand'] === LOHN_NBU_NICHT
    && $e([20,20,20,20])['stand'] === LOHN_NBU_VERSICHERT);

// ── Der entschiedene Fall selbst: BGer 8C_644/2025 ───────────────────────
//
// Die staerkste verfuegbare Pruefung -- ein realer Sachverhalt mit einem
// gerichtlich bestaetigten Ergebnis, nicht ein selbst gewaehltes Beispiel.
//
// Sachverhalt (E. 2): befristete Anstellung vom 16. bis 31. August 2023,
// gearbeitet 4 Std. am 16., 19., 20. und 25. August sowie 3,5 Std. am
// 31. August, zusammen 19,5 Stunden in den Kalenderwochen 33, 34 und 35.
// Ergebnis (E. 5.3.2): 19,5 geteilt durch DREI Kalenderwochen ergibt
// 6,5 Stunden je Woche -- keine Deckung.
$kw33 = 4.0 + 4.0 + 4.0;   // 16., 19., 20. August
$kw34 = 4.0;               // 25. August
$kw35 = 3.5;               // 31. August
$fall = lohn_nbu_ermittlung([$kw33, $kw34, $kw35], $uvg);
pruef('BGer 8C_644/2025: 19,5 Stunden auf drei Kalenderwochen ergeben 6,5 je Woche',
    abs($kw33 + $kw34 + $kw35 - 19.5) < 0.001
    && abs($fall['schnitt_std'] - 6.5) < 0.001);
pruef('BGer 8C_644/2025: geteilt wird durch die drei Wochen, nicht durch die Arbeitstage',
    $fall['wochen_total'] === 3 && $fall['basis'] === 'nur_arbeitswochen');
pruef('BGer 8C_644/2025: das Ergebnis ist keine Deckung',
    $fall['stand'] === LOHN_NBU_NICHT);
// E. 5.3.1: "gemaess Ziff. 3 der Empfehlung reicht bereits eine
// Arbeitsstunde in einer Woche fuer die Beruecksichtigung in der Berechnung".
// Eine Woche mit einer Stunde ist eine Arbeitswoche und drueckt den Schnitt.
pruef('Ziff. 3: schon eine einzige Stunde macht die Woche zur Arbeitswoche',
    lohn_nbu_ermittlung([20.0, 20.0, 1.0], $uvg)['wochen_total'] === 3
    && lohn_nbu_ermittlung([20.0, 20.0, 1.0], $uvg)['arbeitswochen'] === 3
    && abs(lohn_nbu_ermittlung([20.0, 20.0, 1.0], $uvg)['schnitt_std'] - 41.0/3) < 0.001);
// E. 5.3.1, Rechenbeispiel 3.2: neun Stunden an drei Tagen DERSELBEN Woche
// ergeben neun Stunden je Woche -- nicht drei. Geteilt wird durch Wochen.
pruef('Rechenbeispiel 3.2: neun Stunden in einer Woche sind neun je Woche, nicht drei',
    abs(lohn_nbu_ermittlung([9.0], $uvg)['schnitt_std'] - 9.0) < 0.001
    && lohn_nbu_ermittlung([9.0], $uvg)['stand'] === LOHN_NBU_VERSICHERT);

// E. 5.5: Die guenstigere Variante gilt NUR fuer die Wahl des Fensters.
// Das Bundesgericht verwirft ausdruecklich einen allgemeinen Grundsatz,
// "es habe stets die fuer die versicherte Person guenstige Berechnungsweise
// zur Anwendung zu gelangen".
pruef('E. 5.5: der Fall des Urteils bleibt unversichert, obwohl das unguenstig ist',
    $fall['stand'] !== LOHN_NBU_VERSICHERT && $fall['ausfalltage'] === 0);

// ── Ziff. 4: zweite Stufe, bewusst NICHT gerechnet ───────────────────────
//
// "Laesst sich damit keine Deckung bewerkstelligen, werden tageweise
// Ausfallstunden wegen Unfall oder Krankheit [...] ergaenzt."
// Woraus sich die durchschnittliche taegliche Arbeitszeit bemisst, sagt
// weder das Urteil noch Merkblatt 6.05. Statt sie zu erfinden, meldet das
// Werkzeug 'pruefen'.
pruef('Ohne Ausfalltage bleibt es bei "nicht versichert"',
    lohn_nbu_ermittlung([6.0, 6.0, 6.0], $uvg, 0)['stand'] === LOHN_NBU_NICHT);
// KRITISCH: Mit Ausfalltagen darf die Deckung NICHT verneint werden -- nach
// Ziff. 4 koennte sie bestehen. Ein zu Unrecht verneinter Anspruch faellt
// nirgends auf, weil ein fehlender Abzug niemanden stoert.
pruef('Mit Ausfalltagen wegen Unfall oder Krankheit lautet die Antwort "pruefen"',
    lohn_nbu_ermittlung([6.0, 6.0, 6.0], $uvg, 4)['stand'] === LOHN_NBU_PRUEFEN
    && LOHN_NBU_PRUEFEN !== LOHN_NBU_NICHT
    && LOHN_NBU_PRUEFEN !== LOHN_NBU_VERSICHERT);
pruef('Reicht Stufe 1 bereits, spielen Ausfalltage keine Rolle',
    lohn_nbu_ermittlung([20.0, 20.0], $uvg, 10)['stand'] === LOHN_NBU_VERSICHERT);
pruef('Der Hinweis nennt Ziffer, Anzahl Ausfalltage und den Grund der Unklarheit',
    str_contains(lohn_nbu_ermittlung([6.0,6.0,6.0], $uvg, 4)['text'], 'Ziff. 4')
    && str_contains(lohn_nbu_ermittlung([6.0,6.0,6.0], $uvg, 4)['text'], '4 Ausfalltage'));
// Ein 'pruefen' in einem Fenster darf vom anderen nicht ueberstimmt werden.
pruef('Sagt ein Fenster "pruefen", ueberstimmt das andere es nicht mit "nicht versichert"',
    lohn_nbu_unterstellung([3 => lohn_nbu_ermittlung([6.0,6.0,6.0], $uvg, 4),
                            12 => lohn_nbu_ermittlung([6.0,6.0,6.0], $uvg, 0)], $uvg)['stand']
        === LOHN_NBU_PRUEFEN);
pruef('Deckung schlaegt "pruefen" -- ein sicheres Ja braucht keine Handpruefung',
    lohn_nbu_unterstellung([3 => lohn_nbu_ermittlung([6.0,6.0,6.0], $uvg, 4),
                            12 => lohn_nbu_ermittlung([20.0,20.0], $uvg, 0)], $uvg)['stand']
        === LOHN_NBU_VERSICHERT);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
