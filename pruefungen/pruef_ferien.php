<?php
// Rechenkern des Ferienanspruchs (ENT-252) wirklich ausfuehren, nicht nur
// den Quelltext lesen -- dieselbe Haltung wie pruef_auslagen.php: Playwright
// bildet nur die Oberflaeche nach, PHP laeuft dabei nie. Bei einer
// Geldrechnung (Ferientage sind Lohnaequivalent) ist das der falsche Ort,
// um sich auf Lesen zu verlassen.
declare(strict_types=1);
require __DIR__ . '/../backend/ferien.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Dienstjahr-/Altersjahr-Stichtag, Art. 20 Ziff. 3 ────────────────────────
check('KRITISCH: Eintritt am 30.06. zaehlt das Eintrittsjahr noch als 1. Dienstjahr',
    ferien_dienstjahr('2026-06-30', 2026) === 1);
check('KRITISCH: Eintritt am 01.07. zaehlt das Eintrittsjahr NICHT mehr mit',
    ferien_dienstjahr('2026-07-01', 2026) === 0 && ferien_dienstjahr('2026-07-01', 2027) === 1);
check('KRITISCH: Geburtstag am 30.06. zaehlt das laufende Jahr schon als erreichtes Altersjahr',
    ferien_altersjahr('2000-06-30', 2026) === 26);
check('KRITISCH: Geburtstag am 01.07. zaehlt erst das Folgejahr',
    ferien_altersjahr('2000-07-01', 2026) === 25 && ferien_altersjahr('2000-07-01', 2027) === 26);

// ── Grundanspruch Kategorie A/B, Ziff. 1 ────────────────────────────────────
check('KRITISCH: 1. Dienstjahr, mittleres Alter -> 4 Wochen (20 Tage)',
    ferien_grundanspruch_tage_ab(1, 36) === 20);
check('KRITISCH: 15. Dienstjahr allein (ohne Altersbedingung) -> 5 Wochen (25 Tage)',
    ferien_grundanspruch_tage_ab(15, 36) === 25);
check('KRITISCH: 5. Dienstjahr UND 45. Altersjahr -> 5 Wochen',
    ferien_grundanspruch_tage_ab(5, 45) === 25);
check('5. Dienstjahr OHNE das Altersjahr reicht nicht',
    ferien_grundanspruch_tage_ab(5, 30) === 20);
check('KRITISCH: 10. Dienstjahr UND 40. Altersjahr -> 5 Wochen',
    ferien_grundanspruch_tage_ab(10, 40) === 25);
check('KRITISCH: junge Person (Altersjahr 18) -> 5 Wochen, unabhaengig vom Dienstjahr',
    ferien_grundanspruch_tage_ab(1, 18) === 25);
check('Genau Altersjahr 20 zaehlt noch zur Jugendregel (Grenze eingeschlossen)',
    ferien_grundanspruch_tage_ab(1, 20) === 25);
check('Altersjahr 21 faellt aus der Jugendregel wieder heraus',
    ferien_grundanspruch_tage_ab(1, 21) === 20);
check('KRITISCH: 10. Dienstjahr UND 60. Altersjahr -> 6 Wochen (30 Tage)',
    ferien_grundanspruch_tage_ab(10, 60) === 30);
check('10. Dienstjahr ohne 60. Altersjahr bleibt bei 5 Wochen (ueber die 40er-Bedingung)',
    ferien_grundanspruch_tage_ab(10, 50) === 25);
check('KRITISCH: dienstjahr < 1 wird intern auf 1 angehoben, kein Nullanspruch',
    ferien_grundanspruch_tage_ab(0, 36) === 20);

// ── Kategorie C: kein Tage-Saldo, Ziff. 2 ───────────────────────────────────
$c = ferien_anspruch_jahr('C', '1990-01-01', '2020-01-01', null, 2026);
check('KRITISCH: Kategorie C liefert null als Anspruch, nicht 0 -- kein Tage-Saldo',
    $c['anspruch_tage'] === null && $c['kategorie'] === 'C');

// ── Ganzjahres-Anspruch, Zusammenspiel der Regeln ───────────────────────────
$r = ferien_anspruch_jahr('B', '1990-01-01', '2020-01-01', null, 2026);
check('KRITISCH: volles Jahr, 7. Dienstjahr, 36 Jahre alt -> 20 Tage, keine Kuerzung',
    $r['anspruch_tage'] === 20.0 && $r['kuerzung_zwoelftel'] === 0);

$r = ferien_anspruch_jahr('B', '1960-01-01', '2000-01-01', null, 2026);
check('KRITISCH: 27. Dienstjahr, 66 Jahre alt -> volle 30 Tage',
    $r['anspruch_tage'] === 30.0);

// ── Pro-rata bei unterjaehrigem Ein-/Austritt, Ziff. 6 ──────────────────────
$r = ferien_anspruch_jahr('B', '1990-01-01', '2026-08-01', null, 2026);
check('KRITISCH: Eintritt nach dem 1. Juli -- Grundanspruch bleibt 4 Wochen (nicht 0), pro-rata auf 5 von 12 Monaten',
    $r['grundanspruch_tage'] === 20 && $r['pro_rata_monate'] === 5 && abs($r['anspruch_tage'] - 20 * 5 / 12) < 0.05);

$r = ferien_anspruch_jahr('B', '1990-01-01', '2010-01-01', '2026-06-30', 2026);
check('KRITISCH: Austritt Ende Juni -- 6 von 12 Monaten des vollen (hier: 5-Wochen-)Anspruchs',
    $r['grundanspruch_tage'] === 25 && $r['pro_rata_monate'] === 6 && abs($r['anspruch_tage'] - 25 * 6 / 12) < 0.05);

$r = ferien_anspruch_jahr('B', '1990-01-01', '2027-01-01', null, 2026);
check('KRITISCH: Anstellung beginnt erst NACH dem betrachteten Jahr -> kein Arbeitsverhaeltnis, Anspruch 0',
    $r['anspruch_tage'] === 0.0 && strpos($r['hinweis'] ?? '', 'Kein Arbeitsverhaeltnis') !== false);

// ── Kuerzung bei langer Abwesenheit, Ziff. 5 (ANNAHME GAV-AUS-012) ──────────
check('KRITISCH: unter der Zwei-Monats-Schwelle (Krankheitsgruppe) keine Kuerzung',
    ferien_kuerzung_zwoelftel([['typ' => 'krankheit', 'von' => '2026-02-01', 'bis' => '2026-03-15']], 2026) === 0);
check('KRITISCH: genau zwei volle Monate (60 Tage) -> 1 Zwoelftel Kuerzung',
    ferien_kuerzung_zwoelftel([['typ' => 'krankheit', 'von' => '2026-02-01', 'bis' => '2026-04-01']], 2026) === 1);
check('KRITISCH: drei volle Monate -> 2 Zwoelftel Kuerzung',
    ferien_kuerzung_zwoelftel([['typ' => 'unfall', 'von' => '2026-01-01', 'bis' => '2026-03-31']], 2026) === 2);
check('KRITISCH: Schwangerschaft hat eine eigene Drei-Monats-Schwelle, nicht zwei',
    ferien_kuerzung_zwoelftel([['typ' => 'schwangerschaft', 'von' => '2026-01-01', 'bis' => '2026-02-28']], 2026) === 0
    && ferien_kuerzung_zwoelftel([['typ' => 'schwangerschaft', 'von' => '2026-01-01', 'bis' => '2026-03-31']], 2026) === 1);
check('KRITISCH: Krankheit und Unfall zaehlen zur SELBEN Gruppe zusammen (kumulierte Annahme)',
    ferien_kuerzung_zwoelftel([
        ['typ' => 'krankheit', 'von' => '2026-01-01', 'bis' => '2026-02-14'],
        ['typ' => 'unfall',    'von' => '2026-04-01', 'bis' => '2026-04-16'],
    ], 2026) === 1);
check('Militaerdienst zaehlt zur selben Gruppe wie Krankheit/Unfall',
    ferien_kuerzung_zwoelftel([['typ' => 'militaer', 'von' => '2026-01-01', 'bis' => '2026-03-01']], 2026) === 1);
check('Ferien selbst loesen KEINE Kuerzung aus -- nur die vier unverschuldeten Arten',
    ferien_kuerzung_zwoelftel([['typ' => 'ferien', 'von' => '2026-01-01', 'bis' => '2026-06-30']], 2026) === 0);

$r = ferien_anspruch_jahr('B', '1990-01-01', '2010-01-01', null, 2026,
    [['typ' => 'krankheit', 'von' => '2026-02-01', 'bis' => '2026-04-11']]);
check('KRITISCH: die Kuerzung wirkt tatsaechlich auf den Endanspruch, als ANNAHME markiert',
    $r['kuerzung_zwoelftel'] === 1 && $r['kuerzung_ist_annahme'] === true
    && abs($r['anspruch_tage'] - 25 * 11 / 12) < 0.05);

echo ($ok + count($bad)) . " Pruefungen ausgefuehrt, $ok bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) ? 1 : 0);
