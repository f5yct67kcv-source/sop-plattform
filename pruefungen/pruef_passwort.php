<?php
declare(strict_types=1);
// Echte Ausfuehrung der Passwortregeln (ENT-075).
$quelle = file_get_contents(__DIR__ . '/../backend/anmeldung.php');
preg_match_all('/^const (PASSWORT_MIN|PASSWORT_MIN_ADMIN|PASSWORT_KOSTEN|PASSWORT_FOLGE_MAX)\s*=\s*(\d+);/m', $quelle, $k, PREG_SET_ORDER);
foreach ($k as $c) { define($c[1], (int)$c[2]); }
preg_match('/^const PASSWORT_VERBOTEN = \[.*?\];/ms', $quelle, $v);
eval($v[0]);
preg_match('/^const PASSWORT_REIHEN = \[.*?\];/ms', $quelle, $r);
eval($r[0]);
foreach (['passwort_folge', 'passwort_wiederholung'] as $fn) {
    preg_match('/function ' . $fn . '.*?\n\}/s', $quelle, $x);
    eval($x[0]);
}
preg_match('/function passwort_pruefen.*?\n\}/s', $quelle, $f);
eval($f[0]);

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die Laengenregel ist die eine Stelle, an der sich das Schutzniveau am
// leisesten senken laesst -- eine Zahl, und niemand merkt es. Darum ist die
// Absenkung ANMELDEPFLICHTIG (ENT-289): Sie gilt nur, solange
// PASSWORT_ERPROBUNG in anmeldung.php ausdruecklich gesetzt ist. Wer die
// Marke entfernt, bekommt hier die produktiven Werte zurueckverlangt; wer
// die Laengen senkt, ohne die Marke zu setzen, wird ebenfalls rot.
// Gleiches Muster wie GRUNDSTAND in test_datumsfest.mjs: Die Ausnahme darf
// bestehen, aber nicht unsichtbar sein.
$erprobung = (bool)preg_match('/^const PASSWORT_ERPROBUNG\s*=\s*true;/m', $quelle);

if ($erprobung) {
    pruef('Erprobung angemeldet: die verkuerzte Mindestlaenge ist ausdruecklich vermerkt', true);
    pruef('KRITISCH: auch in der Erprobung bleibt eine Mindestlaenge bestehen', PASSWORT_MIN >= 6);
    // Die Auflage steht im Quelltext und nicht nur im Protokoll -- wer die
    // Datei oeffnet, muss ueber sie stolpern.
    pruef('KRITISCH: der Quelltext nennt die Auflage, vor dem Produktivgang zurueckzudrehen',
        (bool)preg_match('/PRODUKTIVEN NUTZUNG/i', $quelle));
} else {
    pruef('Die Mindestlaenge ist deutlich hoeher als die alten sechs Zeichen', PASSWORT_MIN >= 10);
}

// ── Was durchgehen muss
pruef('Eine merkbare Wortfolge taugt',
    passwort_pruefen('gruenerbaumamfluss', 'hansmuster') === null);
pruef('Auch ohne Sonderzeichen und Grossbuchstaben',
    passwort_pruefen('velofahrenimregen', 'sara.beispiel') === null);
pruef('Mit Sonderzeichen natuerlich auch',
    passwort_pruefen('Tr3ppe!Haus?Dach', 'dario.beispiel') === null);

// ── Was NICHT durchgehen darf
// Nicht auf eine feste Zeichenzahl gestuetzt: Die Mindestlaenge ist eine
// Einstellung (ENT-289), die Aussage "zu kurz wird abgewiesen" ist es nicht.
pruef('KRITISCH: zu kurz wird abgewiesen',
    passwort_pruefen(str_repeat('x', max(1, PASSWORT_MIN - 1)), 'q') !== null);
// Ein Wort ohne Muster, auf die jeweilige Laenge geschnitten. NICHT das
// Alphabet nehmen: Das faellt seit dem Nachtrag zu Recht als Folge durch --
// die erste Fassung dieser Pruefung ist genau darueber gestolpert.
$wort = 'blauerstuhlamseeimgartenhinten';
pruef('KRITISCH: genau ein Zeichen zu kurz wird abgewiesen',
    passwort_pruefen(substr($wort, 0, PASSWORT_MIN - 1), 'x') !== null);
pruef('Genau die Mindestlaenge geht durch',
    passwort_pruefen(substr($wort, 0, PASSWORT_MIN), 'x') === null);
pruef('KRITISCH: der eigene Login-Name im Passwort wird abgewiesen',
    passwort_pruefen('hansmuster2026', 'hansmuster') !== null);
pruef('KRITISCH: auch in anderer Schreibweise',
    passwort_pruefen('xxHansMusterxx', 'hansmuster') !== null);
pruef('KRITISCH: naheliegende Woerter werden abgewiesen',
    passwort_pruefen('meinpasswort2026', 'x') !== null
    && passwort_pruefen('cupi24istsuper', 'x') !== null);
pruef('KRITISCH: ein langes Passwort aus wenigen Zeichen wird abgewiesen',
    passwort_pruefen('aaaaaaaaaaaaaaaa', 'x') !== null
    && passwort_pruefen('abababababababab', 'x') !== null);

// ── Die Meldung muss ohne Nachschlagen verstaendlich sein
$grund = passwort_pruefen('kurz', 'x');
pruef('Die Meldung nennt die Mindestlaenge', str_contains((string)$grund, (string)PASSWORT_MIN));
pruef('Die Meldung sagt, was stattdessen zu tun ist',
    str_contains((string)$grund, 'Wortfolge'));
pruef('Ein zu kurzer Login-Name loest die Namensregel nicht aus -- sonst faellt fast alles durch',
    passwort_pruefen('gruenerbaumamfluss', 'ab') === null);

// ── Tastaturreihen und Folgen (ENT-075, Nachtrag)
pruef('KRITISCH: eine Tastaturreihe wird abgewiesen',
    passwort_pruefen('asdfghjkloeae', 'x') !== null);
pruef('KRITISCH: auch rueckwaerts gelesen',
    passwort_pruefen('poiuztrewqas', 'x') !== null);
pruef('KRITISCH: das Alphabet der Reihe nach wird abgewiesen',
    passwort_pruefen('abcdefghijkl', 'x') !== null);
pruef('KRITISCH: eine Ziffernfolge wird abgewiesen',
    passwort_pruefen('012345678901', 'x') !== null);
pruef('KRITISCH: ein wiederholter Block wird abgewiesen',
    passwort_pruefen('abcdabcdabcd', 'x') !== null);
pruef('Vier Zeichen aus einer Reihe sind noch kein Muster',
    passwort_pruefen('asdfhausbaum', 'x') === null);
pruef('Ein normales Passwort faellt nicht versehentlich durch',
    passwort_pruefen('gruenerbaumamfluss', 'x') === null
    && passwort_pruefen('velofahrenimregen', 'x') === null
    && passwort_pruefen('Tr3ppe!Haus?Dach', 'x') === null);

// ── Verwaltungszugaenge brauchen mehr
// Waehrend der angemeldeten Erprobung (ENT-289) gilt fuer beide dieselbe
// Laenge -- die Unterscheidung ist dann bewusst aufgehoben, nicht verloren
// gegangen. Ohne die Marke wird sie wieder verlangt.
if ($erprobung) {
    pruef('Erprobung: Verwaltung und Mitarbeitende haben absichtlich dieselbe Grenze',
        PASSWORT_MIN_ADMIN === PASSWORT_MIN);
} else {
    pruef('Es gibt eine eigene, hoehere Grenze fuer die Verwaltung',
        PASSWORT_MIN_ADMIN > PASSWORT_MIN);
    pruef('KRITISCH: was fuer Mitarbeitende reicht, reicht fuer die Verwaltung nicht',
        passwort_pruefen('blauerstuhlam', 'x', false) === null
        && passwort_pruefen('blauerstuhlam', 'x', true) !== null);
}
pruef('Die Meldung sagt, dass es an der Verwaltung liegt',
    str_contains((string)passwort_pruefen('kurz', 'x', true), 'Verwaltungszugänge'));
pruef('Ein langes Passwort taugt auch fuer die Verwaltung',
    passwort_pruefen('blauerstuhlamseeimgarten', 'x', true) === null);

// ── Aufwand beim Verschluesseln
pruef('KRITISCH: der Aufwand ist ausdruecklich gesetzt und nicht dem Zufall der PHP-Fassung ueberlassen',
    defined('PASSWORT_KOSTEN') && PASSWORT_KOSTEN >= 12);
pruef('Aber nicht so hoch, dass eine Anmeldung unzumutbar wird', PASSWORT_KOSTEN <= 13);

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
