<?php
declare(strict_types=1);
// Die Neuerungsliste und die Etappen der Einrichtung (ENT-698), echt
// ausgefuehrt.
//
// Warum das zaehlt: Am Konto steht, bis zu welcher NUMMER jemand gelesen
// hat. Eine doppelte oder verschobene Nummer zeigte Alten Neues oder
// verschluckte Neues -- ohne dass es jemand merkt. Und eine Etappe, die im
// Katalog steht, aber im Kern nicht laeuft (oder umgekehrt), liesse den
// Balken voll werden, waehrend ein Teil der Einrichtung nie lief.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/neuerungen.php';

$k = neuerungen_katalog();
$nummern = array_map(fn($n) => (int)$n['nr'], $k);
pruef('KRITISCH: jede Nummer kommt genau einmal vor', count($nummern) === count(array_unique($nummern)));
pruef('Nummern sind positiv', min($nummern) >= 1);
pruef('KRITISCH: die neueste Nummer ist die hoechste', neuerungen_neueste() === max($nummern));
$falsch = array_filter($k, fn($n) =>
    !isset(NEUERUNG_ARTEN[$n['art']])
    || !$n['fuer'] || array_diff($n['fuer'], NEUERUNG_ZIELE)
    || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$n['datum'])
    || trim((string)$n['titel']) === '' || trim((string)$n['text']) === '');
pruef('Jeder Eintrag hat gueltige Art, Ziel, Datum, Titel und Text', $falsch === []);
// Ein Eintrag fuer Menschen, keine Einrichtungsschritte: kein Tabellen- oder
// Spaltenname im Text (Punkt 1 der Entscheidung).
$technisch = array_filter($k, fn($n) => preg_match('/\b(Tabelle|Spalte|ALTER|SQL)\b/', $n['titel'] . ' ' . $n['text']));
pruef('Die Texte sind fuer Menschen geschrieben, nicht Einrichtungsschritte', $technisch === []);

// neuerungen_fuer(): nur Ungelesenes, nur fuer diese Oberflaeche, Neuestes zuerst.
foreach (NEUERUNG_ZIELE as $ziel) {
    $alle = neuerungen_fuer($ziel, 0);
    $soll = array_values(array_filter($k, fn($n) => in_array($ziel, $n['fuer'], true)));
    pruef("Fuer $ziel erscheint genau, was fuer $ziel markiert ist", count($alle) === count($soll));
    $sortiert = true;
    for ($i = 1; $i < count($alle); $i++) { if ($alle[$i - 1]['nr'] < $alle[$i]['nr']) { $sortiert = false; } }
    pruef("Fuer $ziel absteigend nach Nummer", $sortiert);
}
pruef('KRITISCH: wer bis zur neuesten gelesen hat, sieht nichts mehr',
    neuerungen_fuer('cockpit', neuerungen_neueste()) === []
    && neuerungen_fuer('app', neuerungen_neueste()) === []
    && neuerungen_fuer('betreiber', neuerungen_neueste()) === []);
$zweitneueste = neuerungen_neueste() - 1;
pruef('KRITISCH: wer bis zur zweitneuesten gelesen hat, sieht hoechstens die neueste',
    array_filter(neuerungen_fuer('betreiber', $zweitneueste), fn($n) => $n['nr'] <= $zweitneueste) === []);
pruef('Jeder ausgegebene Eintrag traegt den Anzeigenamen seiner Art',
    array_filter(neuerungen_fuer('cockpit', 0), fn($n) => ($n['art_titel'] ?? '') === '') === []);

// ── Etappen: Katalog und Kern sagen dasselbe
$kern = (string)file_get_contents(__DIR__ . '/../backend/planung_einrichten_kern.php');
preg_match("/function kern_etappen\(\): array \{.*?return \[(.*?)\];/s", $kern, $m);
preg_match_all("/'([a-z]+)'\s*=>/", $m[1] ?? '', $katalog);
preg_match_all("/\\\$laeuft\('([a-z]+)'\)/", $kern, $benutzt);
pruef('Der Etappenkatalog wurde gefunden', count($katalog[1]) >= 3);
pruef('KRITISCH: jede Etappe im Katalog laeuft im Kern',
    array_diff($katalog[1], $benutzt[1]) === []);
pruef('KRITISCH: jede Etappe im Kern steht im Katalog (sonst liefe sie nie einzeln)',
    array_diff($benutzt[1], $katalog[1]) === []);
// Die einmaligen Nachtraege muessen in DERSELBEN Etappe stehen wie die
// Spalten, deren Entstehen sie abfragen -- sonst saehen sie die Spalte schon
// vorhanden und liefen nie.
$spaltenBeginn = strpos($kern, "if (\$laeuft('spalten'))");
$spaltenEnde   = strpos($kern, "Ende Etappe „spalten\"");
foreach (['$neuerungenWarSchonDa = hat_spalte', '2a1b. Neuerungen', '$revierBerechtigungWarSchonDa = hat_spalte', '2a1. Revierdienst'] as $stelle) {
    $pos = strpos($kern, $stelle);
    pruef("KRITISCH: „{$stelle}“ liegt in der Etappe „spalten“",
        $pos !== false && $spaltenBeginn !== false && $spaltenEnde !== false
        && $pos > $spaltenBeginn && $pos < $spaltenEnde);
}

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
