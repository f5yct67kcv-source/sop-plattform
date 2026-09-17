<?php
// Die reinen Funktionen der Demo-Zugaenge (backend/demo_zugang.php,
// ENT-600) wirklich ausfuehren -- nicht ihren Quelltext lesen.
//
// Warum diese Datei: Fuenf Aussagen sind Entscheidungen und keine
// Formulierungen, und genau die kann eine Textsuche nicht pruefen:
//
//   1. Ist kein Platz frei, kommt NICHTS heraus -- nicht der erste Platz
//      als Notbehelf. Ein Notbehelf legte den zweiten Interessenten auf die
//      Instanz des ersten, also genau in den Fall, den ENT-600 verhindert.
//   2. Die Frist gehoert dem Interessenten: auf die Sekunde genau gilt sie
//      noch.
//   3. Vierzehn Tage sind vierzehn Tage, auch ueber die Zeitumstellung
//      hinweg -- nicht 14 * 86400 Sekunden.
//   4. "Abgelaufen" und "Name oder Passwort falsch" sind verschiedene
//      Texte. Zusammengezogen schickte man jemanden auf die Suche nach
//      einem Tippfehler, den es nicht gibt.
//   5. Restlaufzeit wird abgerundet. "Noch 1 Tag" bei drei Stunden Rest
//      verspricht mehr, als da ist.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);
require __DIR__ . '/../backend/demo_zugang.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

// ── 1. Freien Platz waehlen ──────────────────────────────────────────
$pruef('auf leerem Vorrat kommt der erste Platz',
    demo_platz_waehlen([]) === 'demo1');
$pruef('ist der erste belegt, kommt der zweite',
    demo_platz_waehlen(['demo1']) === 'demo2');
$pruef('Luecken werden gefuellt, nicht uebersprungen',
    demo_platz_waehlen(['demo1', 'demo3']) === 'demo2');
// DER wichtige Fall. Gegenprobe: Gaebe die Funktion hier den ersten Platz
// zurueck, stuende dieser Punkt rot -- und im Betrieb sassen zwei
// Interessenten auf derselben Datenbank.
$pruef('KRITISCH: ist alles belegt, kommt null und nicht der erste Platz',
    demo_platz_waehlen(['demo1', 'demo2', 'demo3']) === null);
$pruef('ein unbekannter Platz in der Belegung verschiebt nichts',
    demo_platz_waehlen(['demo9']) === 'demo1');
$pruef('der Vorrat hat drei Plaetze (ENT-600)',
    count(DEMO_PLAETZE) === 3);

// ── 2. Ablauf ────────────────────────────────────────────────────────
$pruef('die Laufzeit betraegt 14 Tage (ENT-600)', DEMO_ZUGANG_TAGE === 14);
$pruef('der Ablauf liegt 14 Tage nach dem Start',
    demo_zugang_ablauf('2026-03-02 09:00:00') === '2026-03-16 09:00:00');
// Punkt 3: ueber die Zeitumstellung. In der Schweiz beginnt die Sommerzeit
// am letzten Sonntag im Maerz. Wer am 22. Maerz um 09:00 freigibt, dessen
// Zugang laeuft am 5. April um 09:00 ab -- an der Uhr gemessen, nicht an
// 14 * 86400 Sekunden, die auf 08:00 fielen.
$vorher = date_default_timezone_get();
date_default_timezone_set('Europe/Zurich');
$pruef('KRITISCH: 14 Tage bleiben 14 Tage ueber die Zeitumstellung hinweg',
    demo_zugang_ablauf('2026-03-22 09:00:00') === '2026-04-05 09:00:00');
$pruef('Gegenprobe: eine reine Sekundenrechnung ergaebe hier etwas anderes',
    date('Y-m-d H:i:s', strtotime('2026-03-22 09:00:00') + 14 * 86400) !== '2026-04-05 09:00:00');
date_default_timezone_set($vorher);

// ── 3. Abgelaufen oder nicht ─────────────────────────────────────────
// Punkt 2: beide Seiten der Grenze, sonst bestuende die Pruefung auch bei
// einer Frist von einem Jahr.
$pruef('eine Sekunde vor Schluss gilt der Zugang',
    demo_zugang_abgelaufen('2026-03-16 09:00:00', '2026-03-16 08:59:59') === false);
$pruef('KRITISCH: genau auf der Sekunde gilt er noch -- die Frist gehoert dem Interessenten',
    demo_zugang_abgelaufen('2026-03-16 09:00:00', '2026-03-16 09:00:00') === false);
$pruef('eine Sekunde danach ist er abgelaufen',
    demo_zugang_abgelaufen('2026-03-16 09:00:00', '2026-03-16 09:00:01') === true);

// ── 4. Restlaufzeit ──────────────────────────────────────────────────
$pruef('volle 14 Tage am Anfang',
    demo_zugang_resttage('2026-03-16 09:00:00', '2026-03-02 09:00:00') === 14);
// Punkt 5, die Gegenprobe zum Aufrunden.
$pruef('KRITISCH: drei Stunden Rest sind 0 Tage, nicht 1',
    demo_zugang_resttage('2026-03-16 09:00:00', '2026-03-16 06:00:00') === 0);
$pruef('abgelaufen ergibt 0 und keine negative Zahl',
    demo_zugang_resttage('2026-03-16 09:00:00', '2026-03-20 09:00:00') === 0);

// ── 5. Anmeldename ───────────────────────────────────────────────────
$pruef('aus dem Firmennamen wird ein tippbarer Anmeldename',
    demo_login_bilden('Muster Sicherheit GmbH') === 'mustersicherheit');
$pruef('Umlaute werden umschrieben, nicht weggeworfen',
    demo_login_bilden('Bärtschi AG') === 'baertschiag');
$pruef('ein zweiter aus derselben Firma bekommt eine Zahl, keine Abweisung',
    demo_login_bilden('Muster AG', ['musterag']) === 'musterag2');
$pruef('und ein dritter zaehlt weiter',
    demo_login_bilden('Muster AG', ['musterag', 'musterag2']) === 'musterag3');
$pruef('ein Name ganz ohne Buchstaben ergibt trotzdem einen Anmeldenamen',
    demo_login_bilden('+++') === 'gast');
$pruef('der Anmeldename bleibt kurz genug zum Abtippen',
    mb_strlen(demo_login_bilden('Sicherheitsunternehmung Nordwestschweiz AG')) <= 16);

// ── 6. Vier Lagen, vier Texte ────────────────────────────────────────
$abgelaufen = demo_zugang_meldung('abgelaufen');
$beendet    = demo_zugang_meldung('beendet');
$falsch     = demo_zugang_meldung('unbekannt');
$pruef('ein aktiver Zugang bekommt keine Meldung',
    demo_zugang_meldung('aktiv') === '');
$pruef('KRITISCH: "abgelaufen" sagt etwas anderes als "Name oder Passwort falsch"',
    $abgelaufen !== $falsch && $abgelaufen !== '' && $falsch !== '');
$pruef('KRITISCH: "beendet" sagt etwas anderes als "abgelaufen"',
    $beendet !== $abgelaufen);
$pruef('die Meldung zum Ablauf sagt auch, wie es weitergeht',
    str_contains($abgelaufen, 'Probleme bei der Anmeldung'));
$pruef('"Name oder Passwort falsch" verraet nicht, ob es den Namen gibt',
    !str_contains(mb_strtolower($falsch), 'demo-zugang'));

// ── 7. Status als geschlossene Liste ─────────────────────────────────
$pruef('die drei Zustaende gelten', demo_zugang_status_gueltig('aktiv')
    && demo_zugang_status_gueltig('abgelaufen') && demo_zugang_status_gueltig('beendet'));
$pruef('KRITISCH: ein freier Text gilt nicht als Status',
    demo_zugang_status_gueltig('laeuft') === false
    && demo_zugang_status_gueltig('') === false);

// ── 8. Kein Passwort im Register ─────────────────────────────────────
// Der Hash gehoert ins Konto der Instanz, nicht hierher. Geprueft an der
// Tabellendefinition selbst, nicht an einem Kommentar darueber.
$tabelle = mb_strtolower(demo_zugang_tabelle());
$pruef('KRITISCH: das Register traegt kein Passwort und keinen Hash',
    !str_contains($tabelle, 'passwort') && !str_contains($tabelle, 'hash'));
$pruef('das Register traegt Platz, Adresse, Anmeldename und Ablauf',
    str_contains($tabelle, 'platz') && str_contains($tabelle, 'email')
    && str_contains($tabelle, 'login') && str_contains($tabelle, 'laeuft_ab_am'));

// ── 9. Adresse eines Platzes ─────────────────────────────────────────
$pruef('ein Platz ergibt seine eigene Adresse',
    demo_platz_adresse('demo2') === 'https://demo2.guardops.ch');
// Gegenprobe: Ein Platz, den es nicht gibt, ergibt KEINE Adresse. Sonst
// stuende in einer Mail ein Link auf etwas, das nirgends steht.
$pruef('KRITISCH: ein unbekannter Platz ergibt keine Adresse',
    demo_platz_adresse('demo9') === null && demo_platz_adresse('') === null);
$pruef('die Adresse ist verschluesselt (https)',
    str_starts_with((string)demo_platz_adresse('demo1'), 'https://'));

// ── 10. Passwort ─────────────────────────────────────────────────────
$pw = demo_passwort_erzeugen();
$pruef('das Passwort hat die vorgegebene Laenge', strlen($pw) === 12);
// Der Grund fuer den eigenen Zeichenvorrat: Wer 0 und O nicht unterscheiden
// kann, tippt falsch und haelt sich selbst fuer den Fehler.
$pruef('KRITISCH: keine verwechselbaren Zeichen im Vorrat (0 O 1 l I)',
    preg_match('/[0O1lI]/', DEMO_PASSWORT_ZEICHEN) === 0);
$pruef('und auch nicht im erzeugten Passwort',
    preg_match('/[0O1lI]/', $pw) === 0);
// Zwei Laeufe duerfen nicht dasselbe ergeben. Bei 54^12 Moeglichkeiten
// waere eine Wiederholung ein Zeichen dafuer, dass gar nicht gezogen wird.
$pruef('KRITISCH: zwei Passwoerter sind nicht dasselbe',
    demo_passwort_erzeugen() !== demo_passwort_erzeugen());
$pruef('der Vorrat ist gross genug, um 12 Stellen zu tragen',
    strlen(DEMO_PASSWORT_ZEICHEN) >= 50);

// ── 11. Die Mail an den Interessenten ────────────────────────────────
$mail = demo_zugang_mail('Muster AG', 'R. Beispiel', 'https://demo1.guardops.ch',
    'musterag', 'AbcDefGhiJkm', '2026-03-16 09:00:00');
foreach (['text', 'html'] as $teil) {
    $pruef("die Mail ($teil) traegt die Adresse",
        str_contains($mail[$teil], 'demo1.guardops.ch'));
    $pruef("die Mail ($teil) traegt den Anmeldenamen",
        str_contains($mail[$teil], 'musterag'));
    $pruef("die Mail ($teil) traegt das Passwort",
        str_contains($mail[$teil], 'AbcDefGhiJkm'));
    // Ohne Datum meldet sich jemand am 15. Tag und haelt den Zugang fuer
    // kaputt.
    $pruef("KRITISCH: die Mail ($teil) nennt das Ablaufdatum",
        str_contains($mail[$teil], '16.03.2026'));
    $pruef("KRITISCH: die Mail ($teil) warnt vor echten Personendaten",
        str_contains($mail[$teil], 'echten Personendaten'));
}
$pruef('der Betreff sagt, worum es geht',
    str_contains($mail['betreff'], 'Demo-Zugang'));
// Ein Firmenname mit spitzen Klammern darf im HTML-Teil kein Markup werden.
$boes = demo_zugang_mail('<b>Muster</b>', 'X', 'https://demo1.guardops.ch',
    'x', 'y', '2026-03-16 09:00:00');
$pruef('KRITISCH: ein Firmenname wird im HTML-Teil maskiert, nicht eingebaut',
    !str_contains($boes['html'], '<b>Muster</b>') && str_contains($boes['html'], '&lt;b&gt;'));

// ── Ergebnis ─────────────────────────────────────────────────────────
echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $n) { echo "  x $n\n"; }
exit(count($bad) ? 1 : 0);
