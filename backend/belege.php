<?php
declare(strict_types=1);
// Belege: Offerten heute, Rechnungen spaeter (ENT-181).
//
// Die EINZIGE Stelle, die aus Positionen einen Frankenbetrag macht --
// dieselbe Haltung wie auslagen.php (ENT-125): Was auf einem Dokument steht,
// das an einen Kunden geht, wird auf dem Server gerechnet. Der Browser
// rechnet dieselbe Formel ein zweites Mal, aber nur fuer die Live-Anzeige
// beim Erfassen; massgeblich ist immer diese Datei.
//
// ZWEI-SPRACHEN-RISIKO bewusst eingegangen, nicht uebersehen: belegSummen()
// in dashboard.html muss dieselben Zahlen liefern wie beleg_summen() hier.
// test_belege.mjs prueft beide gegen dieselben Faelle -- weicht eine der
// beiden ab, wird die Suite rot. Aendert jemand die Formel, gehoert sie an
// BEIDEN Stellen geaendert.
//
// ALLES IN RAPPEN, ganzzahlig. Franken mit Nachkommastellen summieren sich
// ueber viele Positionen zu Rundungsdrift; Rappen nicht. Prozentsaetze
// ebenfalls ganzzahlig, in Basispunkten (Hundertstel-Prozent): 8.10 % = 810,
// 7 % = 700, 0 % = 0. Damit ist auch der MWST-Satz exakt darstellbar, was
// er als Fliesskommazahl nicht waere.

// Wieviel Nachkommastellen die Menge fuehrt. Auch sie wird intern
// ganzzahlig gerechnet (70.00 -> 7000), damit 0.1 * 4200 nicht als
// 420.00000000000006 durch die Rechnung laeuft.
const BELEG_MENGE_FAKTOR = 100;

// Die Belegarten. 'offerte' ist heute die einzige gebaute; 'rechnung' steht
// hier, weil die Nummernvergabe und die Summenrechnung von Anfang an fuer
// beide gelten sollen (ENT-181) -- nicht als Ankuendigung, dass es sie schon
// gaebe.
const BELEG_ARTEN = [
    'offerte'  => ['praefix' => 'OF', 'titel' => 'Offerte'],
    'rechnung' => ['praefix' => 'RE', 'titel' => 'Rechnung'],
];

// Die Status einer Offerte. Bewusst von Hand gesetzt, auch 'angeschaut':
// Ohne Kundenportal kann das System nicht wissen, ob jemand die Offerte
// geoeffnet hat -- eine automatisch gesetzte Lesebestaetigung waere eine
// Behauptung. 'abgelehnt' und 'bestaetigt' sind die beiden Endpunkte.
const BELEG_STATUS = ['entwurf', 'versendet', 'angeschaut', 'bestaetigt', 'abgelehnt'];

function beleg_art_gueltig(string $art): bool
{
    return array_key_exists($art, BELEG_ARTEN);
}

function beleg_status_gueltig(string $status): bool
{
    return in_array($status, BELEG_STATUS, true);
}

// Naechste freie Belegnummer, Format OF-0001 aufwaerts. Aus dem bestehenden
// Hoechststand abgeleitet statt aus einem eigenen Zaehler -- gleiches Muster
// wie naechste_kundennummer() in kunden.php, aus demselben Grund: kein
// zweiter Zaehler, der aus dem Tritt geraten kann.
//
// Je Belegart ein eigener Zaehler: Offerten und Rechnungen zaehlen
// unabhaengig, sonst haette die erste Rechnung eine Nummer, die aussieht,
// als fehlten neunzig Rechnungen davor.
function beleg_naechste_nummer(PDO $pdo, string $art): string
{
    $praefix = BELEG_ARTEN[$art]['praefix'] ?? null;
    if ($praefix === null) { throw new InvalidArgumentException('Unbekannte Belegart'); }
    $s = $pdo->prepare(
        "SELECT nummer FROM belege
          WHERE art = ? AND nummer REGEXP ?
          ORDER BY CAST(SUBSTRING(nummer, 4) AS UNSIGNED) DESC LIMIT 1"
    );
    $s->execute([$art, '^' . $praefix . '-[0-9]{4}$']);
    $letzte = $s->fetchColumn();
    $n = $letzte ? ((int)substr((string)$letzte, 3)) + 1 : 1;
    return $praefix . '-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
}

// Kaufmaennisch runden, halbe Rappen weg von der Null. PHP round() tut das
// bereits; die eigene Funktion existiert, damit die Absicht im Code steht
// und JS (Math.round rundet halbe Werte zur groesseren Zahl, nicht weg von
// der Null) sichtbar dieselbe Regel bekommt.
function beleg_runden(float $wert): int
{
    return (int)round($wert, 0, PHP_ROUND_HALF_UP);
}

// Schweizer Rappenrundung auf 5 Rappen. So rechnet das bisher verwendete
// Fremdsystem, und so steht es auf den bereits verschickten Offerten
// (Zeile "Rundungsdifferenz") -- uebernommen, nicht neu erfunden.
function beleg_rappen_runden(int $rappen): int
{
    return (int)(round($rappen / 5, 0, PHP_ROUND_HALF_UP) * 5);
}

// ── Der Rechenkern ────────────────────────────────────────────────────────
//
// Reihenfolge, abgeleitet aus einer bereits verschickten Offerte (OF-0093)
// und dort auf den Rappen genau nachgerechnet:
//
//   1. Je Position:  Menge x Einzelpreis            = Bruttobetrag
//   2. Je Position:  minus Positionsrabatt
//   3. Summe daraus                                 = Zwischensumme
//   4. Gesamtrabatt, ANTEILIG auf jede Position verteilt
//   5. MWST je Satz auf den so rabattierten Betraegen
//   6. Total, gerundet auf 5 Rappen, Differenz ausgewiesen
//
// WARUM DER GESAMTRABATT ANTEILIG VERTEILT WIRD und nicht einfach von der
// Zwischensumme abgezogen: Die Positionen tragen unterschiedliche
// MWST-Saetze (Verkehrsdienst 8.1 %, Auslagenersatz 0 %). Zoege man den
// Rabatt nur von der Summe ab, stuende nicht mehr fest, wieviel davon auf
// die steuerpflichtige und wieviel auf die steuerfreie Position entfaellt --
// und damit auch die MWST-Grundlage nicht.
//
// Der ausgewiesene Gesamtrabatt ist die SUMME der verteilten Anteile, nicht
// der gerundete Prozentsatz der Zwischensumme. Beides kann sich um einen
// Rappen unterscheiden; massgeblich ist die Summe der Anteile, sonst geht
// die Rechnung auf dem Papier nicht auf.
function beleg_summen(array $positionen, int $rabattBp = 0): array
{
    if ($rabattBp < 0) { $rabattBp = 0; }

    $zeilen = [];
    $zwischensumme = 0;

    foreach ($positionen as $p) {
        $mengeGanz  = beleg_runden((float)($p['menge'] ?? 0) * BELEG_MENGE_FAKTOR);
        $einzelpreis = (int)($p['einzelpreis_rappen'] ?? 0);
        $posRabattBp = max(0, (int)($p['rabatt_bp'] ?? 0));
        $satzBp      = max(0, (int)($p['mwst_satz_bp'] ?? 0));

        $brutto     = beleg_runden($mengeGanz * $einzelpreis / BELEG_MENGE_FAKTOR);
        $posRabatt  = beleg_runden($brutto * $posRabattBp / 10000);
        $netto      = $brutto - $posRabatt;

        $zeilen[] = [
            'brutto_rappen'      => $brutto,
            'pos_rabatt_rappen'  => $posRabatt,
            'zwischen_rappen'    => $netto,
            'mwst_satz_bp'       => $satzBp,
        ];
        $zwischensumme += $netto;
    }

    // Schritt 4: Gesamtrabatt anteilig -- je Position aus IHREM Betrag, nicht
    // aus der Summe (siehe Begruendung oben).
    $rabattTotal = 0;
    foreach ($zeilen as $i => $z) {
        $anteil = beleg_runden($z['zwischen_rappen'] * $rabattBp / 10000);
        $zeilen[$i]['gesamt_rabatt_rappen'] = $anteil;
        $zeilen[$i]['netto_rappen']         = $z['zwischen_rappen'] - $anteil;
        $rabattTotal += $anteil;
    }
    $netto = $zwischensumme - $rabattTotal;

    // Schritt 5: MWST je SATZ, nicht je Position -- sonst wuerde bei mehreren
    // Positionen desselben Satzes mehrfach gerundet, und die Summe stimmte
    // nicht mit dem ueberein, was auf einer MWST-Abrechnung stuende.
    $grundlagen = [];
    foreach ($zeilen as $z) {
        $satz = $z['mwst_satz_bp'];
        $grundlagen[$satz] = ($grundlagen[$satz] ?? 0) + $z['netto_rappen'];
    }
    krsort($grundlagen);   // hoechster Satz zuerst, stabile Reihenfolge

    $mwstZeilen = [];
    $mwstTotal  = 0;
    foreach ($grundlagen as $satz => $grundlage) {
        if ($satz === 0) { continue; }   // steuerfrei: keine Zeile, kein Betrag
        $betrag = beleg_runden($grundlage * $satz / 10000);
        $mwstZeilen[] = [
            'satz_bp'           => (int)$satz,
            'grundlage_rappen'  => $grundlage,
            'betrag_rappen'     => $betrag,
        ];
        $mwstTotal += $betrag;
    }

    // Schritt 6
    $vorRundung = $netto + $mwstTotal;
    $total      = beleg_rappen_runden($vorRundung);

    return [
        'zeilen'               => $zeilen,
        'zwischensumme_rappen' => $zwischensumme,
        'rabatt_bp'            => $rabattBp,
        'rabatt_rappen'        => $rabattTotal,
        'netto_rappen'         => $netto,
        'mwst'                 => $mwstZeilen,
        'mwst_rappen'          => $mwstTotal,
        'rundung_rappen'       => $total - $vorRundung,
        'total_rappen'         => $total,
    ];
}
