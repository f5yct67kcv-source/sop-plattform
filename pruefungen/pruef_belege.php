<?php
// Rechenkern der Belege wirklich ausfuehren (ENT-181) -- dieselbe Haltung wie
// pruef_auslagen.php: Playwright bildet nur die Oberflaeche nach, PHP laeuft
// dabei nie. Bei einer Geldrechnung, die an Kunden geht, ist das der falsche
// Ort, um sich zu verlassen.
//
// Der Leitfall ist eine ECHTE, bereits verschickte Offerte (OF-0093) aus dem
// bisher verwendeten Fremdsystem. Ihre Zahlen sind nicht ausgedacht, sondern
// abgelesen -- wenn diese Rechnung sie nicht auf den Rappen trifft, rechnet
// sie anders als das, was der Kunde schon in der Hand hatte.
declare(strict_types=1);
require __DIR__ . '/../backend/belege.php';

// Mit `--json` rechnet diese Datei nur die gemeinsamen Faelle aus
// belege_faelle.json und gibt das Ergebnis aus, statt zu pruefen. Genau
// dieselben Faelle laufen in test_belege.mjs durch belegSummen() im Browser;
// verglichen wird dort Feld fuer Feld. Das ist die einzige Absicherung gegen
// das Zwei-Sprachen-Risiko -- ohne sie koennte die Vorschau im Formular
// monatelang andere Zahlen zeigen als das, was gespeichert wird.
if (in_array('--json', $argv ?? [], true)) {
    $faelle = json_decode((string)file_get_contents(__DIR__ . '/belege_faelle.json'), true);
    $aus = [];
    foreach ($faelle as $f) {
        $aus[] = ['name' => $f['name'],
                  'summen' => beleg_summen($f['positionen'], (int)$f['rabatt_bp'])];
    }
    echo json_encode($aus, JSON_UNESCAPED_UNICODE), "\n";
    exit(0);
}

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Leitfall OF-0093 ──────────────────────────────────────────────────────
//   Verkehrsdienst   70 Std. x 42.00, 8.1 % MWST
//   Zulagen          10 Stk. x 16.80, steuerfrei (Auslagenersatz Art. 18 GAV)
//   Bestimmungen      1 Stk. x  0.00, reiner Textblock
//   7 % Rabatt auf alles
// Abgelesenes Ergebnis: Zwischensumme 3'108.00, Rabatt -217.56,
// MWST-Grundlage 2'734.20, MWST 221.47, Rundung -0.01, Total 3'111.90
$of0093 = beleg_summen([
    ['menge' => 70, 'einzelpreis_rappen' => 4200, 'mwst_satz_bp' => 810],
    ['menge' => 10, 'einzelpreis_rappen' => 1680, 'mwst_satz_bp' => 0],
    ['menge' => 1,  'einzelpreis_rappen' => 0,    'mwst_satz_bp' => 0],
], 700);

check('KRITISCH: OF-0093 Zwischensumme 3108.00',
    $of0093['zwischensumme_rappen'] === 310800);
check('KRITISCH: OF-0093 Rabatt -217.56',
    $of0093['rabatt_rappen'] === 21756);
check('KRITISCH: OF-0093 MWST-Grundlage 2734.20 -- nur die steuerpflichtige Position, nach Rabatt',
    count($of0093['mwst']) === 1 && $of0093['mwst'][0]['grundlage_rappen'] === 273420);
check('KRITISCH: OF-0093 MWST 221.47',
    $of0093['mwst_rappen'] === 22147);
check('KRITISCH: OF-0093 Rundungsdifferenz -0.01',
    $of0093['rundung_rappen'] === -1);
check('KRITISCH: OF-0093 Total 3111.90',
    $of0093['total_rappen'] === 311190);
check('OF-0093: die steuerfreie Position bekommt keine MWST-Zeile',
    count($of0093['mwst']) === 1 && $of0093['mwst'][0]['satz_bp'] === 810);
check('OF-0093: der Rabatt verteilt sich anteilig (2734.20 + 156.24)',
    $of0093['zeilen'][0]['netto_rappen'] === 273420
    && $of0093['zeilen'][1]['netto_rappen'] === 15624);
check('OF-0093: der ausgewiesene Rabatt ist die Summe der verteilten Anteile',
    $of0093['zeilen'][0]['gesamt_rabatt_rappen']
    + $of0093['zeilen'][1]['gesamt_rabatt_rappen']
    + $of0093['zeilen'][2]['gesamt_rabatt_rappen'] === $of0093['rabatt_rappen']);
check('OF-0093: Netto nach beiden Rabatten 2890.44',
    $of0093['netto_rappen'] === 289044);

// ── Warum der Gesamtrabatt anteilig verteilt wird ─────────────────────────
// Die Gegenprobe zur Begruendung im Rechenkern: Zoege man den Rabatt nur von
// der Zwischensumme ab und rechnete die MWST auf den UNRABATTIERTEN Betrag,
// kaeme 238.14 statt 221.47 heraus -- 16.65 zuviel MWST auf einer einzigen
// Offerte.
check('KRITISCH: die MWST haengt am rabattierten, nicht am vollen Betrag',
    $of0093['mwst_rappen'] !== beleg_runden(294000 * 810 / 10000));

// ── Rabatt je Position ────────────────────────────────────────────────────
$posRabatt = beleg_summen([
    ['menge' => 10, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 810, 'rabatt_bp' => 1000],
    ['menge' => 1,  'einzelpreis_rappen' => 5000,  'mwst_satz_bp' => 810],
], 0);
check('Positionsrabatt 10 % auf 100.00 x 10 ergibt 900.00',
    $posRabatt['zeilen'][0]['zwischen_rappen'] === 90000);
check('Eine Position ohne eigenen Rabatt bleibt unberuehrt',
    $posRabatt['zeilen'][1]['zwischen_rappen'] === 5000);
check('Die Zwischensumme zaehlt die bereits rabattierten Zeilen',
    $posRabatt['zwischensumme_rappen'] === 95000);

// Positionsrabatt UND Gesamtrabatt zusammen: der Gesamtrabatt greift auf dem
// bereits positionsrabattierten Betrag, nicht auf dem Bruttobetrag.
$beide = beleg_summen([
    ['menge' => 1, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 0, 'rabatt_bp' => 1000],
], 1000);
check('KRITISCH: Gesamtrabatt greift nach dem Positionsrabatt (100 -> 90 -> 81)',
    $beide['netto_rappen'] === 8100);

// ── Mehrere Positionen mit demselben Satz ─────────────────────────────────
// Die MWST wird je SATZ gerechnet, nicht je Position -- sonst wird zweimal
// gerundet und die Summe weicht von einer MWST-Abrechnung ab.
$gleicherSatz = beleg_summen([
    ['menge' => 1, 'einzelpreis_rappen' => 333, 'mwst_satz_bp' => 810],
    ['menge' => 1, 'einzelpreis_rappen' => 333, 'mwst_satz_bp' => 810],
], 0);
check('KRITISCH: gleicher Satz wird zu EINER MWST-Zeile zusammengefasst',
    count($gleicherSatz['mwst']) === 1 && $gleicherSatz['mwst'][0]['grundlage_rappen'] === 666);
check('KRITISCH: einmal gerundet, nicht zweimal (666 x 8.1 % = 54, nicht 2 x 27)',
    $gleicherSatz['mwst_rappen'] === beleg_runden(666 * 810 / 10000));

// ── Mehrere verschiedene Saetze ───────────────────────────────────────────
$zweiSaetze = beleg_summen([
    ['menge' => 1, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 810],
    ['menge' => 1, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 260],
], 0);
check('Zwei Saetze ergeben zwei MWST-Zeilen', count($zweiSaetze['mwst']) === 2);
check('Der hoehere Satz steht zuerst', $zweiSaetze['mwst'][0]['satz_bp'] === 810);
check('Beide Betraege werden addiert (810 + 260)',
    $zweiSaetze['mwst_rappen'] === 810 + 260);

// ── Rappenrundung ─────────────────────────────────────────────────────────
check('Rappenrundung: 3111.91 wird zu 3111.90', beleg_rappen_runden(311191) === 311190);
check('Rappenrundung: 3111.93 wird zu 3111.95', beleg_rappen_runden(311193) === 311195);
check('Rappenrundung: ein glatter Betrag bleibt', beleg_rappen_runden(311190) === 311190);
// Die exakte Mitte kann bei ganzzahligen Rappen NICHT auftreten: sie laege
// bei 2.5 Fuenferschritten, also 12.5 Rappen. Geprueft wird darum beides,
// was tatsaechlich vorkommt -- knapp darunter und knapp darueber.
check('Rappenrundung: 12 liegt naeher bei 10 und wird abgerundet', beleg_rappen_runden(12) === 10);
check('Rappenrundung: 13 liegt naeher bei 15 und wird aufgerundet', beleg_rappen_runden(13) === 15);
check('Eine Rundung nach oben ergibt eine positive Differenz',
    beleg_summen([['menge' => 1, 'einzelpreis_rappen' => 13, 'mwst_satz_bp' => 0]], 0)['rundung_rappen'] === 2);
check('Eine Rundung nach unten ergibt eine negative Differenz',
    beleg_summen([['menge' => 1, 'einzelpreis_rappen' => 12, 'mwst_satz_bp' => 0]], 0)['rundung_rappen'] === -2);

// ── Menge mit Nachkommastellen ────────────────────────────────────────────
$halb = beleg_summen([['menge' => 0.5, 'einzelpreis_rappen' => 4200, 'mwst_satz_bp' => 0]], 0);
check('Halbe Stunde zu 42.00 ergibt 21.00', $halb['zwischensumme_rappen'] === 2100);
$krumm = beleg_summen([['menge' => 7.25, 'einzelpreis_rappen' => 4200, 'mwst_satz_bp' => 0]], 0);
check('7.25 Std. zu 42.00 ergibt 304.50', $krumm['zwischensumme_rappen'] === 30450);

// ── Randfaelle, die nicht umfallen duerfen ────────────────────────────────
$leer = beleg_summen([], 0);
check('Ein Beleg ohne Positionen ergibt 0, keinen Fehler',
    $leer['total_rappen'] === 0 && $leer['zwischensumme_rappen'] === 0 && $leer['mwst'] === []);
$nurText = beleg_summen([['menge' => 1, 'einzelpreis_rappen' => 0, 'mwst_satz_bp' => 0]], 700);
check('Ein reiner Textblock (0.00) erzeugt keinen Rabatt und keine MWST',
    $nurText['total_rappen'] === 0 && $nurText['rabatt_rappen'] === 0);
$negativ = beleg_summen([['menge' => 1, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 0]], -500);
check('Ein negativer Rabattsatz wird als 0 behandelt, nicht als Zuschlag',
    $negativ['netto_rappen'] === 10000);
$hundert = beleg_summen([['menge' => 1, 'einzelpreis_rappen' => 10000, 'mwst_satz_bp' => 810]], 10000);
check('100 % Rabatt ergibt 0, und dann auch keine MWST',
    $hundert['netto_rappen'] === 0 && $hundert['mwst_rappen'] === 0);

// ── Belegarten und Status ─────────────────────────────────────────────────
check('Offerte ist eine gueltige Belegart', beleg_art_gueltig('offerte'));
check('Rechnung ist als Belegart vorgesehen', beleg_art_gueltig('rechnung'));
check('KRITISCH: eine unbekannte Belegart wird abgewiesen', !beleg_art_gueltig('lieferschein'));
check('Alle fuenf Status sind gueltig',
    count(array_filter(BELEG_STATUS, 'beleg_status_gueltig')) === 5);
check('KRITISCH: ein unbekannter Status wird abgewiesen', !beleg_status_gueltig('storniert'));

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
