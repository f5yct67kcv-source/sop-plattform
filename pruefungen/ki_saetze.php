<?php
declare(strict_types=1);
// Messlauf der Spracheingabe gegen das ECHTE Modell (ENT-695).
//
//     KI_MESSLAUF_SCHLUESSEL=sk-ant-... php pruefungen/ki_saetze.php
//
// Bewusst NICHT Teil von alle.mjs: Er kostet API-Aufrufe (rund zwei
// Haiku-Aufrufe je Satz, zusammen wenige Rappen), braucht einen Schluessel
// und haengt am Anbieter. Er ist Pflicht vor jeder Aenderung am Katalog, an
// den Beschreibungen oder am Prompt der Spracheingabe -- die normale
// Regression prueft nur, was die Oberflaeche aus einer Antwort macht, nicht,
// ob das Modell richtig zuordnet.
//
// Ergebnis: 0 = jeder kritische Satz richtig und insgesamt mindestens 90 %,
// 1 = sonst, 2 = kein Schluessel (nicht gemessen ist nicht gruen).
$schluessel = (string)getenv('KI_MESSLAUF_SCHLUESSEL');
if ($schluessel === '') {
    fwrite(STDERR, "Kein Schluessel. Aufruf: KI_MESSLAUF_SCHLUESSEL=... php pruefungen/ki_saetze.php\n"
        . "Ohne Schluessel ist nichts gemessen -- das ist kein gruenes Ergebnis.\n");
    exit(2);
}
define('KI_MESSLAUF_SCHLUESSEL', $schluessel);
require __DIR__ . '/../backend/ai.php';

$daten = json_decode((string)file_get_contents(__DIR__ . '/ki_saetze.json'), true);
$listen = $daten['listen'];
$heute = date('Y-m-d');
$richtig = 0; $gesamt = 0; $kritischFalsch = [];

foreach ($daten['saetze'] as $s) {
    $gesamt++;
    $fehler = [];
    $a = anthropic_ki_absicht($s['text']);
    if ($a === null) {
        $fehler[] = 'Stufe 1 ohne Antwort (' . ki_fehlergrund() . ')';
        $absicht = '—';
    } else {
        $absicht = (string)($a['absicht'] ?? '');
        if ($absicht !== $s['absicht']) {
            $fehler[] = "Anliegen {$absicht} statt {$s['absicht']}";
        }
    }
    // Stufe 2 nur, wo es etwas nachzupruefen gibt und Stufe 1 stimmte.
    if (!$fehler && $s['absicht'] === 'beleg_neu') {
        $f = ki_faehigkeiten()['beleg_neu'];
        $e = anthropic_ki_felder('beleg_neu', $s['text'], array_intersect_key($listen, array_flip($f['listen'])), $heute);
        if ($e === null) {
            $fehler[] = 'Stufe 2 ohne Antwort (' . ki_fehlergrund() . ')';
        } else {
            [, $r] = ki_felder_auswerten('beleg_neu', $e, $listen);
            if (($r['art'] ?? '') !== $s['art']) { $fehler[] = "Art {$r['art']} statt {$s['art']}"; }
            $kid = $r['kunde']['id'] ?? null;
            if ($kid !== $s['kunde_id']) { $fehler[] = 'Kunde ' . json_encode($kid) . ' statt ' . json_encode($s['kunde_id']); }
            $ids = array_values(array_filter(array_column($r['positionen'], 'produkt_id')));
            sort($ids);
            $soll = $s['produkte']; sort($soll);
            if ($ids !== $soll) { $fehler[] = 'Produkte ' . json_encode($ids) . ' statt ' . json_encode($soll); }
            $frei = count(array_filter($r['positionen'], fn($p) => $p['produkt_id'] === null));
            if ($frei !== (int)($s['freitext'] ?? 0)) { $fehler[] = "{$frei} Freitextzeilen statt " . (int)($s['freitext'] ?? 0); }
        }
    }
    if ($fehler) {
        echo '✗ ' . ($s['kritisch'] ? '[kritisch] ' : '') . $s['text'] . "\n    " . implode('; ', $fehler) . "\n";
        if ($s['kritisch']) { $kritischFalsch[] = $s['text']; }
    } else {
        $richtig++;
        echo "✓ {$s['text']}\n";
    }
}

$quote = $gesamt ? round(100 * $richtig / $gesamt) : 0;
echo "\n{$richtig} von {$gesamt} richtig ({$quote} %), " . count($kritischFalsch) . " kritische falsch.\n";
exit(($kritischFalsch || $quote < 90) ? 1 : 0);
