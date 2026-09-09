<?php
declare(strict_types=1);
// ══════════════════════════════════════════════════════════════════════════
// GAV-ZEITRECHNUNG, SERVERSEITIG (ENT-451, Etappe 3).
//
// ACHTUNG — DIESE DATEI IST EINE ZWEITE FASSUNG.
//
// Die erste steht in `gav.js` und ist die LESBARE QUELLE: Sie wird von
// dashboard.html und app.html benutzt und traegt die ausfuehrlichen
// Begruendungen zu jeder Regel. Hier steht dieselbe Rechnung noch einmal in
// PHP, und das ist eine bewusste, eng begrenzte Ausnahme von ENT-049
// ("diese Regel darf es nur EINMAL geben").
//
// WARUM DIE AUSNAHME NOETIG WURDE: Ein Lohnlauf ist ein Dokument mit
// Rechtswirkung. Seine Zahlen duerfen nicht davon abhaengen, was ein
// Browser schickt -- "Sperren gehoeren in den Server, nicht in die
// Oberflaeche" (CLAUDE.md). Ohne serverseitige Rechnung waere die Hoehe
// einer Lohnzahlung eine Behauptung des Clients.
//
// WAS DIE DUPLIKATION BEHERRSCHBAR MACHT: `pruefungen/test_gavzeit.mjs`
// rechnet HUNDERTE Faelle durch BEIDE Fassungen und vergleicht sie Wert fuer
// Wert. Laufen sie auseinander, wird sie rot und nennt den Fall. Eine
// GAV-Revision muss also an beiden Stellen nachgezogen werden -- die
// Pruefung erzwingt es, statt darauf zu hoffen.
//
// WER HIER ETWAS AENDERT, aendert es in gav.js mit. In dieser Reihenfolge:
// zuerst gav.js (die Quelle mit den Begruendungen), dann hier.
// ══════════════════════════════════════════════════════════════════════════

// Versioniertes Regelwerk mit Gueltigkeitszeitraum -- wortgleich mit
// GAV_REGELWERK in gav.js. Beim Fortschreiben ANHAENGEN, den alten Eintrag
// stehen lassen. Faellt ein Datum in keinen Zeitraum, wird NICHT gerechnet.
const GAVZEIT_REGELWERK = [
    [
        'quelle' => 'GAV private Sicherheitsdienstleistungen, Ausgabe 2026 (AVE vom 11.12.2025)',
        'ab' => '2026-01-01', 'bis' => '2026-12-31',
        'satz' => 0.10,                                    // 6 Minuten pro Stunde
        'nachtAb' => 23 * 60, 'nachtBis' => 6 * 60,        // 23:00-06:00, ueber Mitternacht
        'sonntagAb' => 6 * 60, 'sonntagBis' => 23 * 60,    // 06:00-23:00 an Sonntagen
    ],
];

function gavzeit_regel(string $datum): ?array
{
    foreach (GAVZEIT_REGELWERK as $r) {
        if ($datum >= $r['ab'] && $datum <= $r['bis']) { return $r; }
    }
    return null;
}

// Minuten aus "HH:MM".
function gavzeit_min(?string $t): int
{
    $s = (string)$t;
    return (int)substr($s, 0, 2) * 60 + (int)substr($s, 3, 2);
}

// Rohzeit in Minuten: bis minus von, ueber Mitternacht hinweg. OHNE
// Pausenabzug -- die Pausenpflicht bemisst sich an der Zeit vor dem Abzug,
// sonst waere die Rechnung zirkulaer.
function gavzeit_roh_min(?string $von, ?string $bis): ?int
{
    if (!$von || !$bis) { return null; }
    $d = gavzeit_min($bis) - gavzeit_min($von);
    if ($d < 0) { $d += 1440; }
    return $d;
}

// Nettozeit in Minuten = Rohzeit minus UNBEZAHLTER Pause (ENT-047).
// Nur die MA-Kennzeichnung wirkt; "bezahlte Pause Kunde" ist eine
// Verrechnungsfrage und hat mit dem Lohn nichts zu tun. Ist die
// Kennzeichnung nicht gesetzt, wird abgezogen -- der Ausgangszustand,
// solange die Feststellung nach Art. 13 Ziff. 2 niemand getroffen hat.
//
// null statt einer negativen Zahl: Eine Pause laenger als die Schicht ist
// keine Zeit, sondern ein Erfassungsfehler.
function gavzeit_netto_min(?string $von, ?string $bis, $pauseMin, $pauseBezahltMa): ?int
{
    $d = gavzeit_roh_min($von, $bis);
    if ($d === null) { return null; }
    if ((int)$pauseBezahltMa !== 1) { $d -= (int)($pauseMin ?? 0); }
    return $d < 0 ? null : $d;
}

// Dieselbe Ausgabe wie gavNetto() in gav.js: "HH:MM" oder leer. Nur fuer
// die Kreuzpruefung und fuer Anzeigen -- gerechnet wird mit Minuten.
function gavzeit_netto(?string $von, ?string $bis, $pauseMin, $pauseBezahltMa): string
{
    $d = gavzeit_netto_min($von, $bis, $pauseMin, $pauseBezahltMa);
    if ($d === null) { return ''; }
    return str_pad((string)intdiv($d, 60), 2, '0', STR_PAD_LEFT) . ':'
         . str_pad((string)($d % 60), 2, '0', STR_PAD_LEFT);
}

// Mindestpause nach Art. 13 Ziff. 1, woertlich aus dem Vertrag. Die Zahlen
// sind eindeutig; offen ist nur, WORAUF sie angewendet werden
// (GAV-AUS-007). Hier: Rohzeit der einzelnen Schicht.
const GAVZEIT_PAUSE_REGEL = [
    ['abMin' => 540, 'pause' => 60, 'text' => 'mehr als 9 Std.'],
    ['abMin' => 420, 'pause' => 30, 'text' => 'mehr als 7 Std.'],
    ['abMin' => 330, 'pause' => 15, 'text' => 'mehr als 5½ Std.'],
];

function gavzeit_pause_soll(?string $von, ?string $bis): ?array
{
    $roh = gavzeit_roh_min($von, $bis);
    if ($roh === null) { return null; }
    foreach (GAVZEIT_PAUSE_REGEL as $r) {
        if ($roh > $r['abMin']) { return ['min' => $r['pause'], 'weil' => $r['text']]; }
    }
    return ['min' => 0, 'weil' => null];
}

// Zeitbonus nach Art. 12 Ziff. 2: 6 Minuten (10 %) pro Stunde, die in ein
// Bonusfenster faellt -- Nachtarbeit 23:00-06:00 oder Sonntagsarbeit
// 06:00-23:00, jeweils inklusive Pause.
//
// Minutenweise ueber den echten Kalenderverlauf, weil eine Schicht ueber
// Mitternacht in einen Sonntag hineinlaufen kann. Verankert auf 12:00 Uhr
// wie in gav.js -- so verschiebt kein Sommerzeitwechsel den Wochentag.
//
// ANTEILIG statt nur volle Stunden: GAV-AUS-008, vorlaeufige Annahme, und
// nach dem Betriebsentscheid aus ENT-451 die fuer die mitarbeitende Person
// guenstigere Lesart.
//
// FEIERTAGE FEHLEN (GAV-AUS-006): Ein Feiertag, der kein Sonntag ist,
// bekommt hier keinen Bonus; die Summe ist dann ZU TIEF. Aufrufer muessen
// das kenntlich machen.
function gavzeit_bonus_min(string $datum, ?string $von, ?string $bis): ?float
{
    $regel = gavzeit_regel($datum);
    if (!$regel || !$von || !$bis) { return null; }
    $start = gavzeit_min($von);
    $ende  = gavzeit_min($bis);
    if ($ende <= $start) { $ende += 1440; }
    $tag0 = strtotime($datum . ' 12:00:00');
    if ($tag0 === false) { return null; }
    $imFenster = 0;
    for ($m = $start; $m < $ende; $m++) {
        $tagesMin = (($m % 1440) + 1440) % 1440;
        $wochentag = (int)date('w', $tag0 + intdiv($m, 1440) * 86400);
        $inNacht = $tagesMin >= $regel['nachtAb'] || $tagesMin < $regel['nachtBis'];
        $inSonntag = $wochentag === 0
            && $tagesMin >= $regel['sonntagAb'] && $tagesMin < $regel['sonntagBis'];
        if ($inNacht || $inSonntag) { $imFenster++; }
    }
    return $imFenster * $regel['satz'];
}

// Gilt das Sicherheits-Regelwerk fuer diesen Einsatz? Fehlt die Sparte,
// gilt SICHERHEIT -- die vorsichtige Richtung. Nur der ausdrueckliche Wert
// 'reinigung' schaltet ab: kein Teilwort, keine Aehnlichkeit. Ein still
// unterdrueckter Bonus kostet den Mitarbeitenden Geld und faellt niemandem
// auf; einer zu viel kostet den Betrieb und faellt bei der Abrechnung auf.
const GAVZEIT_SPARTE = 'sicherheit';

function gavzeit_gilt($sparte): bool
{
    $s = strtolower(trim((string)($sparte ?: GAVZEIT_SPARTE)));
    return $s !== 'reinigung';
}

// Minuten als "H:MM" -- dieselbe Ausgabe wie gavStd() in gav.js.
function gavzeit_std($min): string
{
    $m = max(0, (int)round((float)$min));
    return intdiv($m, 60) . ':' . str_pad((string)($m % 60), 2, '0', STR_PAD_LEFT);
}
