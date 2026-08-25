<?php
// Rechenkern des Auslagenersatzes wirklich ausfuehren (nicht nur den
// Quelltext lesen) -- dieselbe Haltung wie pruef_php.php: Playwright bildet
// nur die Oberflaeche nach, PHP laeuft dabei nie. Bei einer Geldrechnung ist
// das der falsche Ort, um sich zu verlassen.
declare(strict_types=1);
require __DIR__ . '/../backend/auslagen.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Zonen und Grundbetraege, Wortlaut Art. 18 Ziff. 3 ──────────────────────
$z = auslagen_zeile('sicherheit', '2026-06-01', 5.0, 'Privatfahrzeug', null, false);
check('KRITISCH: Anstellungsgebiet (5 km) ist 0/0, nicht null/null',
    $z['fahrzeitersatz_rappen'] === 0 && $z['fahrkostenersatz_rappen'] === 0 && $z['gesperrt_grund'] === null);

$z = auslagen_zeile('sicherheit', '2026-06-01', 10.0, 'Privatfahrzeug', null, false);
check('Genau 10 km liegt noch im Anstellungsgebiet (Grenze eingeschlossen)',
    $z['zone_schluessel'] === 'anstellungsgebiet');

$z = auslagen_zeile('sicherheit', '2026-06-01', 10.01, 'Privatfahrzeug', null, false);
check('KRITISCH: 10.01 km faellt in Pauschalzone 1 -- Fahrzeit CHF 5.60, Fahrkosten CHF 7.00',
    $z['zone_schluessel'] === 'pauschalzone1'
    && $z['fahrzeitersatz_rappen'] === 560 && $z['fahrkostenersatz_rappen'] === 700);

$z = auslagen_zeile('sicherheit', '2026-06-01', 25.0, 'Privatfahrzeug', null, false);
check('KRITISCH: Pauschalzone 2 -- Fahrzeit CHF 16.80, Fahrkosten CHF 21.00',
    $z['zone_schluessel'] === 'pauschalzone2'
    && $z['fahrzeitersatz_rappen'] === 1680 && $z['fahrkostenersatz_rappen'] === 2100);

// Regiezone, Art. 18 Ziff. 3.1.4: [(2 x km) - (2 x 10)] x Satz.
// 35 km: Faktor = 70 - 20 = 50. Fahrkosten 50 x 0.70 = 35.00, Fahrzeit 50 x 0.32 = 16.00.
$z = auslagen_zeile('sicherheit', '2026-06-01', 35.0, 'Privatfahrzeug', null, false);
check('KRITISCH: Regiezone rechnet nach der Formel, nicht nach einer Pauschale',
    $z['zone_schluessel'] === 'regiezone'
    && $z['fahrkostenersatz_rappen'] === 3500 && $z['fahrzeitersatz_rappen'] === 1600);

// ── Verkehrsmittel, Art. 18 Ziff. 4 und 5 ───────────────────────────────────
$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Mitfahrer', null, false);
check('KRITISCH: Mitfahrer bekommt einzig den Fahrzeitersatz -- Fahrkosten 0, nicht null',
    $z['fahrzeitersatz_rappen'] === 560 && $z['fahrkostenersatz_rappen'] === 0);

$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Geschaeftsfahrzeug', null, false);
check('KRITISCH: Geschaeftsfahrzeug bekommt ebenfalls nur den Fahrzeitersatz',
    $z['fahrzeitersatz_rappen'] === 560 && $z['fahrkostenersatz_rappen'] === 0);

$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Oeffentlicher Verkehr', 450, false);
check('KRITISCH: OEV nimmt den TATSAECHLICHEN Billettpreis, nicht die Zonen-Pauschale',
    $z['fahrkostenersatz_rappen'] === 450 && $z['fahrzeitersatz_rappen'] === 560);

$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Oeffentlicher Verkehr', null, false);
check('KRITISCH: OEV ohne erfassten Preis bleibt NULL, wird nicht zu 0',
    $z['fahrkostenersatz_rappen'] === null && $z['gesperrt_grund'] === 'oev_preis_unbekannt'
    && $z['fahrzeitersatz_rappen'] === 560);

$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, null, null, false);
check('KRITISCH: unbekanntes Verkehrsmittel laesst den Fahrkostenersatz offen -- der Fahrzeitersatz steht trotzdem',
    $z['fahrkostenersatz_rappen'] === null && $z['gesperrt_grund'] === 'verkehrsmittel_unbekannt'
    && $z['fahrzeitersatz_rappen'] === 560);

$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Fahrrad', null, false);
check('Ein nicht erkanntes Verkehrsmittel wird wie unbekannt behandelt, nicht stillschweigend akzeptiert',
    $z['fahrkostenersatz_rappen'] === null && $z['gesperrt_grund'] === 'verkehrsmittel_unbekannt');

// ── GAV-AUS-010 -- die wichtigste Sperre in dieser Datei ────────────────────
$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Privatfahrzeug', null, true);
check('KRITISCH: GAV-AUS-010 blockiert BEIDE Betraege, nicht nur einen',
    $z['fahrzeitersatz_rappen'] === null && $z['fahrkostenersatz_rappen'] === null
    && $z['gesperrt_grund'] === 'gav_aus_010');
check('Die Rohdaten (Zone, km) bleiben trotzdem stehen -- nur der Betrag fehlt',
    $z['zone_schluessel'] === 'pauschalzone1' && $z['weg_km'] === 15.0);

$z = auslagen_zeile('sicherheit', '2026-06-01', 5.0, 'Privatfahrzeug', null, true);
check('KRITISCH: im Anstellungsgebiet greift die AUS-010-Sperre gar nicht -- da ist ohnehin nichts geschuldet',
    $z['fahrzeitersatz_rappen'] === 0 && $z['fahrkostenersatz_rappen'] === 0 && $z['gesperrt_grund'] === null);

// ── Sparte und Regelwerk ─────────────────────────────────────────────────
$z = auslagen_zeile('reinigung', '2026-06-01', 15.0, 'Privatfahrzeug', null, false);
check('KRITISCH: Sparte Reinigung berechnet nichts, auch keine Zone',
    $z['fahrzeitersatz_rappen'] === null && $z['fahrkostenersatz_rappen'] === null
    && $z['gesperrt_grund'] === 'sparte_reinigung' && $z['zone_schluessel'] === null);

$z = auslagen_zeile('sicherheit', '2099-01-01', 15.0, 'Privatfahrzeug', null, false);
check('KRITISCH: ausserhalb der Gueltigkeit des Regelwerks wird nichts erfunden',
    $z['fahrzeitersatz_rappen'] === null && $z['gesperrt_grund'] === 'regelwerk_unbekannt');

$z = auslagen_zeile('sicherheit', '2026-06-01', null, 'Privatfahrzeug', null, false);
check('KRITISCH: ohne Wegstrecke keine Zone, kein Betrag',
    $z['zone_schluessel'] === null && $z['gesperrt_grund'] === 'wegstrecke_unbekannt');

$z = auslagen_zeile('sicherheit', '2026-06-01', 15.0, 'Privatfahrzeug', null, false);
check('Das Regelwerk wird beim Ergebnis mitgeliefert -- ein Betrag ohne Quelle waere eine Blackbox',
    strpos($z['regelwerk'], 'Ausgabe 2026') !== false);

echo ($ok + count($bad)) . " Pruefungen ausgefuehrt, $ok bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) ? 1 : 0);
