<?php
declare(strict_types=1);
// Echte Ausfuehrung der Verlaufs-Buendelung aus portal_rundgaenge.php
// (ENT-500) -- die kleine Kurve in der Rundgang-Kachel.
//
// Warum das hier laufen MUSS und nicht im Browser: test_portal.mjs taeuscht
// die Serverantwort vor und sieht die Buendelung darum nie. Sie ist reine
// Datumsrechnerei -- Wochenanfang, Zeitraumgrenzen, Luecken -- also genau
// die Sorte Code, die still falsch wird und erst auffaellt, wenn eine Kurve
// seltsam aussieht.
//
// Der Quelltext wird NICHT abgeschrieben, sondern aus dem Endpunkt geholt:
// Aendert jemand dort die Regel, wird diese Pruefung rot.
$quelle = file_get_contents(__DIR__ . '/../backend/api/portal_rundgaenge.php');

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Den Block von der Tagesrechnung bis zur Eimer-Vorbelegung herausloesen.
// Bis EINSCHLIESSLICH der Vorbelegungsschleife. Nicht mit "bis zur ersten
// Klammer am Zeilenanfang" -- die gehoert zur inneren Funktion
// $schluessel, und der Ausschnitt braeche mitten im Block ab. (Erste
// Fassung genau so: PHP Parse error, unexpected end of file.)
preg_match('/\$vonTag = new DateTimeImmutable.*?= 0;\n\}/s', $quelle, $m);
pruef('Die Buendelung ist im Endpunkt auffindbar', !empty($m[0]));
if (empty($m[0])) {
    foreach ($bad as $b) { echo "X $b\n"; }
    exit(1);
}

/** Fuehrt den echten Block fuer einen Zeitraum aus und zaehlt die Daten ein. */
function buendeln(string $code, string $von, string $bis, array $daten): array {
    $fn = static function () use ($code, $von, $bis, $daten): array {
        eval($code);
        /** @var array $eimer */
        /** @var callable $schluessel */
        /** @var bool $jeTag */
        foreach ($daten as $d) {
            $k = $schluessel($d);
            if (isset($eimer[$k])) { $eimer[$k]++; }
        }
        return ['jeTag' => $jeTag, 'eimer' => $eimer];
    };
    return $fn();
}

// ── Tage: kurzer Zeitraum ──────────────────────────────────────────────
$r = buendeln($m[0], '2026-03-02', '2026-03-08', ['2026-03-02', '2026-03-05', '2026-03-05']);
pruef('KRITISCH: bis 31 Tage wird je TAG gebuendelt', $r['jeTag'] === true);
pruef('Sieben Tage ergeben sieben Abschnitte', count($r['eimer']) === 7);
// Die Luecken sind der Punkt: Nur die vorhandenen Tage aneinanderzureihen
// ergaebe eine Kurve ohne Zeitachse -- drei Runden an drei
// aufeinanderfolgenden Tagen saehen aus wie drei ueber drei Monate.
pruef('KRITISCH: Tage OHNE Runde sind als Null dabei, nicht weggelassen',
    array_keys($r['eimer']) === ['2026-03-02','2026-03-03','2026-03-04','2026-03-05',
                                 '2026-03-06','2026-03-07','2026-03-08']);
pruef('Die Runden landen im richtigen Tag',
    $r['eimer']['2026-03-02'] === 1 && $r['eimer']['2026-03-05'] === 2
    && $r['eimer']['2026-03-03'] === 0);
pruef('Die Summe stimmt mit der Zahl der Runden ueberein',
    array_sum($r['eimer']) === 3);

// ── Die Grenze zwischen Tagen und Wochen ───────────────────────────────
$g31 = buendeln($m[0], '2026-03-01', '2026-03-31', []);
$g32 = buendeln($m[0], '2026-03-01', '2026-04-01', []);
pruef('KRITISCH: genau 31 Tage werden noch je Tag gebuendelt',
    $g31['jeTag'] === true && count($g31['eimer']) === 31);
pruef('KRITISCH: 32 Tage kippen auf Wochen -- sonst haette ein Jahr 365 Striche',
    $g32['jeTag'] === false);

// ── Wochen: langer Zeitraum ────────────────────────────────────────────
// 2026-03-02 ist ein Montag. Ein Datum mitten in der Woche muss im
// Montags-Eimer landen, sonst hinge die Zeitachse am Erfassungstag.
$w = buendeln($m[0], '2026-01-01', '2026-04-30',
    ['2026-03-02', '2026-03-05', '2026-03-08', '2026-03-09']);
pruef('KRITISCH: Wochen beginnen am MONTAG, nicht am Tag der Abfrage',
    ($w['eimer']['2026-03-02'] ?? -1) === 3);
pruef('Der Sonntag gehoert noch zur selben Woche',
    ($w['eimer']['2026-03-02'] ?? -1) === 3 && ($w['eimer']['2026-03-09'] ?? -1) === 1);
pruef('Auch ueber Wochen bleibt die Summe die Zahl der Runden',
    array_sum($w['eimer']) === 4);
pruef('Leere Wochen sind dabei', count($w['eimer']) >= 17
    && in_array(0, $w['eimer'], true));

// ── Ein einzelner Tag ──────────────────────────────────────────────────
$e = buendeln($m[0], '2026-03-02', '2026-03-02', ['2026-03-02']);
pruef('Ein Zeitraum von einem Tag ergibt einen Abschnitt',
    count($e['eimer']) === 1 && $e['eimer']['2026-03-02'] === 1);

// ── Was ausserhalb liegt, faellt auf statt still einen Eimer anzulegen ──
$a = buendeln($m[0], '2026-03-02', '2026-03-08', ['2026-02-01', '2026-03-05']);
pruef('KRITISCH: eine Runde ausserhalb des Zeitraums verschiebt die Zeitachse nicht',
    count($a['eimer']) === 7 && array_sum($a['eimer']) === 1);

// ── Ein Jahreswechsel darf die Wochen nicht durcheinanderbringen ───────
// 2026-01-01 ist ein Donnerstag; seine Woche beginnt am 2025-12-29.
$j = buendeln($m[0], '2025-12-01', '2026-02-28', ['2026-01-01']);
pruef('KRITISCH: ueber den Jahreswechsel bleibt der Wochenanfang der Montag davor',
    ($j['eimer']['2025-12-29'] ?? -1) === 1);

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
