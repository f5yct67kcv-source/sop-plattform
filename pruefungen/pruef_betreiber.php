<?php
// Die reinen Funktionen der Betreiber-Ebene (backend/betreiber.php, ENT-518)
// wirklich ausfuehren -- nicht ihren Quelltext lesen.
//
// Warum diese Datei: Drei Aussagen der Betreiber-Ebene sind Entscheidungen
// und keine Formulierungen, und genau die kann eine Textsuche nicht
// pruefen:
//
//   1. Die Sitzungsfristen sind SCHAERFER als jede bestehende Frist des
//      Hauses. Wer dieses Konto hat, hat jeden Mandanten.
//   2. "GAV-Unterstellung noch nicht bestaetigt" ist etwas anderes als
//      "nicht unterstellt". Ein Ja/Nein mit Vorgabewert wuerde die
//      Bestaetigung stillschweigend vorwegnehmen.
//   3. Der Mandantenstatus ist eine geschlossene Liste, kein freier Text.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);
require __DIR__ . '/../backend/betreiber.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

// ── 1. Sitzungsfristen ────────────────────────────────────────────────
$jetzt = 1_800_000_000;

$pruef('frische Sitzung gilt',
    be_sitzung_abgelaufen($jetzt - 60, $jetzt - 60, $jetzt) === false);

// Ruhe: 30 Minuten. 29 gilt, 31 nicht -- beide Seiten der Grenze, sonst
// bestuende die Pruefung auch bei einer Frist von einer Woche.
$pruef('29 Minuten ohne Nutzung gelten noch',
    be_sitzung_abgelaufen($jetzt - 3600, $jetzt - 29 * 60, $jetzt) === false);
$pruef('31 Minuten ohne Nutzung sind abgelaufen',
    be_sitzung_abgelaufen($jetzt - 3600, $jetzt - 31 * 60, $jetzt) === true);

// Absolutes Alter: 24 Stunden, unabhaengig davon, wie aktiv jemand ist.
// Der zweite Fall ist der wichtige -- eine dauernd genutzte Sitzung darf
// nicht ewig leben.
$pruef('23 Stunden alte, eben genutzte Sitzung gilt',
    be_sitzung_abgelaufen($jetzt - 23 * 3600, $jetzt - 10, $jetzt) === false);
$pruef('25 Stunden alte Sitzung ist abgelaufen, auch wenn eben genutzt',
    be_sitzung_abgelaufen($jetzt - 25 * 3600, $jetzt - 10, $jetzt) === true);

// Der eigentliche Punkt: schaerfer als das Haus. Die Verwaltung laeuft mit
// 7 Tagen absolut (SITZUNG_ADMIN_MAX_TAGE), das Portal mit 90 Tagen.
// Verglichen wird gegen die echten Konstanten aus db.php, nicht gegen
// abgeschriebene Zahlen -- zieht jemand dort die Frist herunter, faellt es
// hier auf.
$pruef('KRITISCH: Betreiber-Frist ist kuerzer als die der Verwaltung',
    BE_SITZUNG_MAX_STUNDEN < SITZUNG_ADMIN_MAX_TAGE * 24);
$pruef('KRITISCH: Betreiber-Ruhefrist ist hoechstens die Bueroruhe',
    BE_SITZUNG_RUHE_MIN <= SITZUNG_BUERO_RUHE_MIN);

// ── 2. GAV-Lage ist dreiwertig ────────────────────────────────────────
$pruef('ohne Bestaetigung: unbestaetigt, nicht "nicht unterstellt"',
    be_gav_lage(null, null) === 'unbestaetigt');
$pruef('leeres Datum zaehlt ebenfalls als unbestaetigt',
    be_gav_lage(0, '') === 'unbestaetigt');
// Die entscheidende Gegenprobe: Auch wenn schon ein Wert gesetzt ist,
// bleibt die Lage unbestaetigt, solange niemand bestaetigt hat. Wer das
// zu einem Ja/Nein zusammenzieht, faellt hier durch.
$pruef('KRITISCH: gesetzter Wert ohne Bestaetigung bleibt unbestaetigt',
    be_gav_lage(1, null) === 'unbestaetigt');
$pruef('bestaetigt und unterstellt',
    be_gav_lage(1, '2026-09-10 08:00:00') === 'unterstellt');
$pruef('bestaetigt und nicht unterstellt',
    be_gav_lage(0, '2026-09-10 08:00:00') === 'nicht_unterstellt');

// ── 3. Mandantenstatus ist eine geschlossene Liste ────────────────────
foreach (['aktiv', 'gesperrt', 'gekuendigt'] as $s) {
    $pruef("Status $s ist gueltig", be_mandant_status_gueltig($s) === true);
}
$pruef('KRITISCH: freier Text ist kein gueltiger Status',
    be_mandant_status_gueltig('irgendwas') === false);
$pruef('leerer Status ist ungueltig',
    be_mandant_status_gueltig('') === false);

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
