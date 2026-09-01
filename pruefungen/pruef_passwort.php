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

pruef('Die Mindestlaenge ist deutlich hoeher als die alten sechs Zeichen', PASSWORT_MIN >= 10);

// ── Was durchgehen muss
pruef('Eine merkbare Wortfolge taugt',
    passwort_pruefen('gruenerbaumamfluss', 'adrianvonarb') === null);
pruef('Auch ohne Sonderzeichen und Grossbuchstaben',
    passwort_pruefen('velofahrenimregen', 'sarah.leisi') === null);
pruef('Mit Sonderzeichen natuerlich auch',
    passwort_pruefen('Tr3ppe!Haus?Dach', 'dario.beispiel') === null);

// ── Was NICHT durchgehen darf
pruef('KRITISCH: zu kurz wird abgewiesen', passwort_pruefen('kurz123', 'x') !== null);
// Ein Wort ohne Muster, auf die jeweilige Laenge geschnitten. NICHT das
// Alphabet nehmen: Das faellt seit dem Nachtrag zu Recht als Folge durch --
// die erste Fassung dieser Pruefung ist genau darueber gestolpert.
$wort = 'blauerstuhlamseeimgartenhinten';
pruef('KRITISCH: genau ein Zeichen zu kurz wird abgewiesen',
    passwort_pruefen(substr($wort, 0, PASSWORT_MIN - 1), 'x') !== null);
pruef('Genau die Mindestlaenge geht durch',
    passwort_pruefen(substr($wort, 0, PASSWORT_MIN), 'x') === null);
pruef('KRITISCH: der eigene Login-Name im Passwort wird abgewiesen',
    passwort_pruefen('adrianvonarb2026', 'adrianvonarb') !== null);
pruef('KRITISCH: auch in anderer Schreibweise',
    passwort_pruefen('xxAdrianVonArbxx', 'adrianvonarb') !== null);
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
pruef('Es gibt eine eigene, hoehere Grenze fuer die Verwaltung',
    PASSWORT_MIN_ADMIN > PASSWORT_MIN);
pruef('KRITISCH: was fuer Mitarbeitende reicht, reicht fuer die Verwaltung nicht',
    passwort_pruefen('blauerstuhlam', 'x', false) === null
    && passwort_pruefen('blauerstuhlam', 'x', true) !== null);
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
