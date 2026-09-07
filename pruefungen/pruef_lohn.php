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

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
