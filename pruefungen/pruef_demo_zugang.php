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
    demo_platz_waehlen(DEMO_PLAETZE) === null);
$pruef('ein unbekannter Platz in der Belegung verschiebt nichts',
    demo_platz_waehlen(['nichtimvorrat']) === 'demo1');
$pruef('der Vorrat hat zehn Plaetze (ENT-613 -- ENT-600 nannte noch drei)',
    count(DEMO_PLAETZE) === 10);

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
    demo_platz_adresse('demo99') === null && demo_platz_adresse('') === null);
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

// ── Die Signatur (ENT-569, Nachtrag 2026-09-18) ──────────────────────
//
// KEIN PERSONENNAME IM REPOSITORY (Vertraulichkeitsregel in CLAUDE.md; im
// Impressum steht aus demselben Grund bewusst keiner). Die Zeilen kommen
// aus dem Deploy. Geprueft wird die Aussage, nicht der Wortlaut: Was
// hereingereicht wird, steht in der Mail -- und ist nichts hinterlegt,
// zeichnet die Firma, statt dass ein leerer Gruss oder ein Platzhalter
// beim Interessenten ankommt.
$mitName = mail_signatur(['A. Beispiel', 'Funktion', '+41 00 000 00 00']);
$pruef('KRITISCH: die uebergebene Signatur steht in der Mail',
    str_contains($mitName, 'A. Beispiel') && str_contains($mitName, 'Funktion')
    && str_contains($mitName, '+41 00 000 00 00'));
$ohneName = mail_signatur([]);
$pruef('KRITISCH: ohne hinterlegte Signatur zeichnet die Firma, nicht niemand',
    str_contains($ohneName, 'pzu consulting gmbh')
    && str_contains($ohneName, 'Mit freundlichen Grüssen'));
$pruef('leere Zeilen fallen weg, statt als Luecke zu erscheinen',
    !str_contains(mail_signatur(['A. Beispiel', '', '  ']), '<br>'));
// Der Grussblock der Mail darf den Namen NICHT selbst mitbringen.
$quelle = (string)file_get_contents(dirname(__DIR__) . '/backend/demo_zugang.php');
$pruef('KRITISCH: die Mail holt die Signatur aus dem Deploy, statt sie im Quelltext zu fuehren',
    str_contains($quelle, 'mail_signatur_zeilen()'));

// ── Die Telefonnummer in der Signatur (Befund 2026-09-19) ────────────
//
// Apple Mail und iOS Mail erkennen eine Telefonnummer im Fliesstext selbst
// und machen daraus einen Waehl-Verweis -- blau und unterstrichen, mitten
// in einer bewusst grauen Signatur. Wir setzen den Verweis deshalb selbst:
// antippbar bleibt sie, aussehen tut sie wie geplant. Geprueft wird die
// Wirkung am erzeugten HTML, nicht der Wortlaut im Quelltext.
$telZeile = '+41 00 000 00 00';
$mitTel = mail_signatur(['A. Beispiel', 'Funktion', $telZeile]);
preg_match('/<a ([^>]*)href="tel:([^"]*)"([^>]*)>/', $mitTel, $telVerweis);
$pruef('KRITISCH: die Telefonnummer traegt einen eigenen Waehl-Verweis',
    $telVerweis !== [] && preg_replace('/[^0-9+]/', '', $telZeile) === $telVerweis[2]);
$telAuf = ($telVerweis[1] ?? '') . ($telVerweis[3] ?? '');
$pruef('KRITISCH: der Waehl-Verweis bringt seine Farbe selbst mit, statt sie dem Programm zu ueberlassen',
    str_contains($telAuf, 'color:' . MAIL_FARBE_LEISE));
$pruef('der Waehl-Verweis ist nicht unterstrichen -- er soll wie die uebrigen Zeilen aussehen',
    str_contains($telAuf, 'text-decoration:none'));
$pruef('KRITISCH: im Dunkelmodus faerbt sich der Waehl-Verweis mit',
    preg_match('/class="[^"]*\bd-leise\b[^"]*"/', $telAuf) === 1
    && str_contains(mail_dunkelmodus(), '.d-leise'));
// Nur die Nummer wird verlinkt. Ein Verweis auf dem Namen oder der Funktion
// waere schlimmer als gar keiner.
$pruef('KRITISCH: nur die Nummer wird verlinkt, nicht Name oder Funktion',
    substr_count($mitTel, '<a ') === 1);
// Zu kurz und zu lang sind beide keine Rufnummer -- eine Referenz- oder
// Belegnummer in der Signatur darf nicht zum Waehlziel werden.
foreach (['A. Beispiel', 'Geschäftsführer', 'Hochgasse 7', '4632 Trimbach',
          'pzu consulting gmbh', 'info@guardops.ch', '2026',
          '1234-5678', '1234 5678 9012 3456 7890'] as $keineNummer) {
    $pruef('keine Nummer, kein Waehl-Verweis: ' . $keineNummer,
        mail_telefon_ziel($keineNummer) === '');
}
foreach ([$telZeile, '079 000 00 00', 'Tel. ' . $telZeile, 'Mobil: 079 000 00 00'] as $nummer) {
    $pruef('als Nummer erkannt: ' . $nummer, mail_telefon_ziel($nummer) !== '');
}
// Was das Programm trotzdem selbst erkennt -- eine Ortsangabe im Fuss etwa --
// soll wenigstens nicht aus der Gestaltung fallen.
$pruef('KRITISCH: die automatische Einfaerbung von Apple Mail ist ueberschrieben',
    str_contains($mail['html'], 'x-apple-data-detectors')
    && preg_match('/x-apple-data-detectors[^}]*color:\s*inherit\s*!important/', $mail['html']) === 1
    && preg_match('/x-apple-data-detectors[^}]*text-decoration:\s*none\s*!important/', $mail['html']) === 1);

// ── Das Logo in der Signatur (ENT-648) ───────────────────────────────
//
// Eingebettet, nicht verlinkt: Outlook und die meisten Programme laden ein
// extern verlinktes Bild erst auf Erlaubnis -- bis dahin stuende unter der
// Unterschrift ein leerer Rahmen.
$pruef('KRITISCH: jedes Logo wird als Bild MITGEGEBEN, nicht von aussen nachgeladen',
    count($mail['bilder']) === 2
    && array_filter($mail['bilder'], fn($b) => ($b['inhalt'] ?? '') === '') === []
    && !preg_match('/<img[^>]+src="https?:/', $mail['html']));
$pruef('KRITISCH: das HTML spricht jede mitgegebene Kennung an',
    array_filter($mail['bilder'],
        fn($b) => !str_contains($mail['html'], 'cid:' . $b['cid'])) === []);
// Zwei Fassungen, damit im Dunkelmodus nicht Dunkel auf Dunkel steht.
// Genau so kam die Mail beim Projektinhaber an (2026-09-19).
$pruef('KRITISCH: es gibt eine helle und eine dunkle Fassung, nicht zweimal dieselbe',
    ($mail['bilder'][0]['inhalt'] ?? '') !== ($mail['bilder'][1]['inhalt'] ?? ''));
// Sichtbar ist immer genau eine: die helle steht auf display:none und
// wird erst im Dunkelmodus eingeblendet.
$pruef('KRITISCH: im hellen Modus ist nur die dunkle Fassung sichtbar',
    preg_match('/class="logo-hell"[^>]*style="display:none/', $mail['html']) === 1
    && preg_match('/class="logo-dunkel"[^>]*style="display:block/', $mail['html']) === 1);
$pruef('KRITISCH: der Dunkelmodus tauscht beide Fassungen wirklich gegeneinander',
    preg_match('/@media \(prefers-color-scheme: dark\)[\s\S]*'
        . '\.logo-dunkel \{ display:none/', $mail['html']) === 1
    && preg_match('/@media \(prefers-color-scheme: dark\)[\s\S]*'
        . '\.logo-hell \{ display:block/', $mail['html']) === 1);
// Ein cid-Verweis ohne Bild dahinter zeigt ein zerbrochenes Bild.
$pruef('KRITISCH: ohne Bilddatei steht auch kein Verweis darauf in der Mail',
    (mail_logo() === null) === (!str_contains($mail['html'], 'cid:')));
// Die Klartextfassung hat kein Bild und darf es auch nicht vortaeuschen.
$pruef('die Klartextfassung traegt keinen Bildverweis',
    !str_contains($mail['text'], 'cid:') && !str_contains($mail['text'], '<img'));

// ── Die gemeinsame Gestaltung ────────────────────────────────────────
$pruef('KRITISCH: die Mail traegt Marke und Angaben der Betreiberin, nicht die der Mandantin',
    str_contains($mail['html'], 'GuardOpS')
    && str_contains($mail['html'], 'pzu consulting gmbh')
    && str_contains($mail['html'], 'info@guardops.ch'));
// Die Marke steht EINMAL da. Mit dem Logo in der Signatur waere ein
// getippter Schriftzug im Kopf eine zweite, schlechtere Fassung derselben
// Marke -- eine Geschaeftsmail aus Outlook hat darum keinen Briefkopf.
$pruef('KRITISCH: kein Briefkopf-Balken neben dem Logo -- die Marke steht nicht zweimal da',
    !str_contains($mail['html'], 'background:#14161A'));
// Hausregel: Ueberschrift oben, Wert darunter -- auch hier, nicht nur in
// der Oberflaeche. Geprueft ueber die Reihenfolge im Quelltext, weil genau
// das die Aussage ist.
// (Die Versalien entstehen per text-transform, im Quelltext steht
// "Passwort" -- darum wird hier danach gesucht und nicht nach "PASSWORT".)
$pruef('KRITISCH: die Beschriftung steht vor ihrem Wert, nicht daneben oder darunter',
    strpos($mail['html'], '>Passwort<') !== false
    && strpos($mail['html'], '>Passwort<') < strpos($mail['html'], 'AbcDefGhiJkm'));
// Ein Stylesheet im Kopf wird von Mailprogrammen regelmaessig entfernt.
// Es gibt genau einen, und er traegt AUSSCHLIESSLICH zwei Korrekturen:
// den Dunkelmodus und die Ueberschreibung von Apples Datenerkennung.
// Beide darf man verlieren -- faellt der Block weg, bleibt die Mail
// vollstaendig gestaltet, nur eben hell. Geprueft wird das, indem genau
// diese beiden Bloecke herausgeschnitten werden: was uebrig bleibt, waere
// Gestaltung, die nur hier steht.
$stil = (string)(preg_match('/<style>(.*?)<\/style>/s', $mail['html'], $t) ? $t[1] : '');
$rest = trim((string)preg_replace(
    ['/a\[x-apple-data-detectors\]\s*\{[^}]*\}/',
     '/@media \(prefers-color-scheme: dark\)\s*\{.*\}/s'],
    '', $stil));
$pruef('KRITISCH: die Gestaltung haengt an Inline-Styles, nicht am Stylesheet',
    str_contains($mail['html'], 'style="')
    && substr_count($mail['html'], '<style') === 1
    && $stil !== '' && $rest === '');
// Gegenprobe im Kleinen: Ohne den Block darf keine Farbe und keine
// Flaeche verschwinden -- alles Sichtbare steht auch inline.
$ohneStil = (string)preg_replace('/<style>.*?<\/style>/s', '', $mail['html']);
// Geprueft wird jedes gefaerbte Element einzeln, nicht ob eine Farbe
// irgendwo noch vorkommt: Ein Link ohne eigene Farbe faellt sonst auf das
// Standardblau des Mailprogramms zurueck, und im Dunkelmodus auf eine
// Farbe, die auf dunklem Grund kaum lesbar ist.
preg_match_all('/<a [^>]*>/', $ohneStil, $links);
$ohneFarbe = array_values(array_filter($links[0],
    fn($a) => !preg_match('/style="[^"]*color:#/', $a)));
$pruef('KRITISCH: ohne den Stylesheet-Block traegt jeder Link seine Farbe selbst',
    $links[0] !== [] && $ohneFarbe === []);
$pruef('KRITISCH: ohne den Stylesheet-Block bleiben Textfarbe und Flaeche erhalten',
    str_contains($ohneStil, MAIL_FARBE_TEXT) && str_contains($ohneStil, MAIL_FARBE_FLAECHE));

// ── Formhelfer der Selbstbedienung (ENT-601) ─────────────────────────
$pruef('das Fallenfeld erkennt eine gefuellte Falle',
    demo_zugang_ist_falle(['website' => 'irgendwas']));
$pruef('ein leeres Fallenfeld ist keine Falle',
    !demo_zugang_ist_falle(['website' => '']) && !demo_zugang_ist_falle([]));
$pruef('demo_zugang_einzeilig ersetzt Umbrueche und kuerzt',
    demo_zugang_einzeilig("Zeile 1\r\nZeile 2\t\tEnde", 100) === 'Zeile 1 Zeile 2 Ende'
    && demo_zugang_einzeilig('123456789', 5) === '12345');

// Telefon ist der Preis fuer den Sofort-Zugang (ENT-601/ENT-613). Geprueft
// wird die Nummer, nicht nur die Anzahl Ziffern (Befund 2026-09-18).
$pruef('eine Schweizer Nummer in jeder ueblichen Schreibweise gilt',
    demo_zugang_telefon_gueltig('+41 79 123 45 67')
    && demo_zugang_telefon_gueltig('0041 79 123 45 67')
    && demo_zugang_telefon_gueltig('079 123 45 67')
    && demo_zugang_telefon_gueltig('079/123 45 67')
    && demo_zugang_telefon_gueltig('+41-79-123-45-67')
    && demo_zugang_telefon_gueltig('(044) 123 45 67')
    && demo_zugang_telefon_gueltig('0791234567'));
$pruef('KRITISCH: neun beliebige Ziffern sind keine Telefonnummer',
    !demo_zugang_telefon_gueltig('123456789')
    && !demo_zugang_telefon_gueltig('111 111 111'));
$pruef('KRITISCH: zu kurz, zu lang oder gar keine Ziffern wird abgewiesen',
    !demo_zugang_telefon_gueltig('079 12')
    && !demo_zugang_telefon_gueltig('079 123 45 678')
    && !demo_zugang_telefon_gueltig('qwd')
    && !demo_zugang_telefon_gueltig(''));
$pruef('KRITISCH: nach der Vorwahl kommt kein 0 und kein 1',
    !demo_zugang_telefon_gueltig('+41 09 123 45 67')
    && !demo_zugang_telefon_gueltig('+41 19 123 45 67')
    && !demo_zugang_telefon_gueltig('009 123 45 67'));
// Drei Laender sind zugelassen (Entscheidung 2026-09-18), der Rest nicht.
$pruef('deutsche und oesterreichische Nummern mit Landesvorwahl gelten',
    demo_zugang_telefon_gueltig('+49 151 12345678')
    && demo_zugang_telefon_gueltig('0049 30 1234567')
    && demo_zugang_telefon_gueltig('+43 664 1234567')
    && demo_zugang_telefon_gueltig('+43 1 1234567'));
$pruef('KRITISCH: ein viertes Land gilt nicht',
    !demo_zugang_telefon_gueltig('+33 6 12 34 56 78')
    && !demo_zugang_telefon_gueltig('+1 415 555 0123')
    && !demo_zugang_telefon_gueltig('+39 06 1234567'));
$pruef('KRITISCH: auch bei DE und AT faellt die fuehrende Null der Vorwahl weg',
    !demo_zugang_telefon_gueltig('+49 0151 12345678')
    && !demo_zugang_telefon_gueltig('+43 0664 1234567'));

// Zustellbarkeit: dieselbe Absicherung wie beim Kontaktformular, mit
// einspeisbarem Nachschlag statt echtem DNS (ENT-469-Bauart).
$immerJa      = fn(string $d): bool => true;
$nieJa        = fn(string $d): bool => false;
$nurKontrolle = fn(string $d): bool => $d === DEMO_ZUGANG_KONTROLL_DOMAIN;
$pruef('eine Domain mit Mailserver gilt als zustellbar',
    demo_zugang_adresse_zustellbar('a@echt.ch', $immerJa) === true);
$pruef('KRITISCH: gestoerter Namensdienst (auch die Kontrolldomain faellt durch) heisst UNBEKANNT, nicht "keine"',
    demo_zugang_adresse_zustellbar('a@irgendwas.ch', $nieJa) === null);
$pruef('KRITISCH: erreichbarer Namensdienst, aber die Domain gibt es wirklich nicht, heisst "keine"',
    demo_zugang_adresse_zustellbar('a@nirgends.test', $nurKontrolle) === false);
$pruef('eine Adresse ohne @ gilt als nicht zustellbar, ohne Absturz',
    demo_zugang_adresse_zustellbar('keine-email', $immerJa) === false);
// ══ Die bekannte Adresse meldet sich erneut (ENT-623) ═════════════════
//
// Bis hierher kam dieselbe Mail heraus wie beim ersten Mal. Kein neuer
// Zugang wurde angelegt -- das ist die Sperre aus ENT-601 und war nie
// anders --, aber die Mail sah aus wie ein zweiter Zugang. Der
// Projektinhaber hat das am 2026-09-19 an der echten Mail beanstandet.

$erst   = demo_zugang_mail('Muster Sicherheit GmbH', 'R. Muster',
    'https://demo1.guardops.ch', 'mustersicherh', 'AbcDefGhiJkm', '2026-10-03 09:14:00');
$wieder = demo_zugang_bekannt_mail('Muster Sicherheit GmbH', 'R. Muster',
    'https://demo1.guardops.ch', 'mustersicherh', 'AbcDefGhiJkm', '2026-10-03 09:14:00');

// DER Punkt: Im Postfach muss man die beiden auseinanderhalten koennen,
// ohne sie zu oeffnen.
$pruef('KRITISCH: die zweite Mail traegt einen anderen Betreff als die erste',
    $wieder['betreff'] !== $erst['betreff']);
// Und sie sagt die Sache, nicht nur einen anderen Betreff.
foreach (['text', 'html'] as $teil) {
    $pruef("die $teil-Fassung sagt, dass der Zugang bereits besteht",
        str_contains(mb_strtolower(strip_tags($wieder[$teil])), 'bereits'));
    // Wer die erste Mail verloren hat, muss wieder hineinkommen -- sonst
    // ist er vierzehn Tage ausgesperrt. "Zugangsdaten erneut senden" gibt
    // es als Endpunkt, aber auf keiner Seite als Bedienelement.
    $pruef("die $teil-Fassung bringt Adresse, Anmeldename und Passwort mit",
        str_contains($wieder[$teil], 'https://demo1.guardops.ch')
        && str_contains($wieder[$teil], 'mustersicherh')
        && str_contains($wieder[$teil], 'AbcDefGhiJkm'));
    // demo_zugang_neues_passwort() wirft die bestehenden Sitzungen weg.
    // Wer das nicht erfaehrt, haelt seinen Zugang fuer kaputt.
    $pruef("die $teil-Fassung sagt, dass die alten Zugangsdaten nicht mehr gelten",
        str_contains(mb_strtolower(strip_tags($wieder[$teil])), 'nicht mehr'));
    // Das Ablaufdatum des BESTEHENDEN Zugangs, nicht ein neues: Der Zugang
    // laeuft weiter, er faengt nicht von vorne an.
    $pruef("die $teil-Fassung nennt das Ablaufdatum des bestehenden Zugangs",
        str_contains($wieder[$teil], '03.10.2026'));
}
// Sie geht an einen Interessenten, nicht an uns -- also mit Unterschrift
// und Logo, anders als die Meldungen weiter unten.
$pruef('die Mail an den Interessenten ist gezeichnet wie die erste',
    str_contains($wieder['html'], 'Mit freundlichen Grüssen'));
$boesWieder = demo_zugang_bekannt_mail('<b>M</b>', '"><script>x</script>',
    'https://demo1.guardops.ch', 'l', 'p', '2026-10-03 09:14:00');
$pruef('KRITISCH: auch hier bleibt eingeschmuggelte Auszeichnung Text',
    !str_contains($boesWieder['html'], '<script>')
    && !str_contains($boesWieder['html'], '<b>M</b>'));

// Der Umschalter sitzt in demo_zugang_neues_passwort(). Sein Vorgabewert
// entscheidet, was "Zugangsdaten erneut senden" verschickt -- dort hat
// jemand ausdruecklich danach gefragt und bekommt die gewohnte Mail.
require_once __DIR__ . '/../backend/demo_instanz.php';
$umschalter = (new ReflectionFunction('demo_zugang_neues_passwort'))->getParameters();
$dritter = $umschalter[2] ?? null;
$pruef('KRITISCH: die Unterscheidung ist ein eigener Schalter, nicht zwei Kopien der Funktion',
    $dritter !== null && $dritter->isOptional());
$pruef('KRITISCH: ohne Angabe bleibt es die gewohnte Mail -- sonst bekaeme auch '
        . '"Zugangsdaten erneut senden" den Text "besteht bereits"',
    $dritter !== null && $dritter->getDefaultValue() === false);

// Die Meldung an uns ueber die erneute Anfrage. Eigener Betreff, damit sie
// sich im Postfach von einer echten Neuanmeldung unterscheidet.
$erneut = demo_erneut_mail('Muster Sicherheit GmbH', 'R. Muster', 'r.muster@beispiel.ch',
    '+41 00 000 00 00', 'demo1', 'https://demo1.guardops.ch', '2026-10-03 09:14:00');
$pruef('KRITISCH: die erneute Anfrage meldet sich anders als eine Neuanmeldung',
    $erneut['betreff'] !== demo_melde_mail('Muster Sicherheit GmbH', 'R. Muster',
        'r.muster@beispiel.ch', '+41 00 000 00 00', 'demo1',
        'https://demo1.guardops.ch', '2026-10-03 09:14:00')['betreff']);
// Ohne diesen Satz liest man sie als zweiten Zugang und sucht einen Platz,
// der gar nicht belegt wurde.
$pruef('KRITISCH: sie sagt ausdrücklich, dass kein neuer Zugang und kein Platz dazukam',
    str_contains($erneut['text'], 'KEIN neuer Zugang')
    && str_contains(strip_tags($erneut['html']), 'kein')
    && str_contains(mb_strtolower($erneut['text']), 'kein weiterer platz'));
$pruef('sie nennt Firma, Person und Erreichbarkeit',
    str_contains($erneut['text'], 'R. Muster')
    && str_contains($erneut['text'], 'r.muster@beispiel.ch')
    && str_contains($erneut['text'], '+41 00 000 00 00'));
$pruef('auch sie ist Hauspost -- kein Logo im Schlepptau',
    $erneut['bilder'] === [] && !str_contains($erneut['html'], 'cid:'));

// ══ Meldungen an den Betreiber (ENT-622) ══════════════════════════════
//
// Bis hierher lief die Selbstbedienung an uns vorbei. Zwei Meldungen
// schliessen die Luecke -- und beide haben eine Eigenschaft, die man nur
// am erzeugten Inhalt pruefen kann, nicht am Quelltext.

$melde = demo_melde_mail('Muster Sicherheit GmbH', 'R. Muster', 'r.muster@beispiel.ch',
    '+41 00 000 00 00', 'demo1', 'https://demo1.guardops.ch', '2026-10-03 09:14:00');

// Wer drei Meldungen im Postfach hat, soll sie auseinanderhalten koennen,
// OHNE sie zu oeffnen.
$pruef('KRITISCH: die Firma steht im Betreff, nicht nur im Rumpf',
    str_contains($melde['betreff'], 'Muster Sicherheit GmbH'));
// Beide Fassungen tragen dieselbe Auskunft -- eine Textfassung, die weniger
// sagt als die HTML-Fassung, ist eine zweite, schlechtere Mail.
foreach (['text', 'html'] as $teil) {
    $pruef("die $teil-Fassung nennt Firma, Person, Adresse, Platz und Ablauf",
        str_contains($melde[$teil], 'Muster Sicherheit GmbH')
        && str_contains($melde[$teil], 'R. Muster')
        && str_contains($melde[$teil], 'r.muster@beispiel.ch')
        && str_contains($melde[$teil], '+41 00 000 00 00')
        && str_contains($melde[$teil], 'demo1')
        && str_contains($melde[$teil], '03.10.2026'));
}
// KEIN PASSWORT. Es steht schon in der Mail an den Interessenten; ein
// zweites Mal verschickt waere es ein zweites Postfach, aus dem es
// entwischen kann. Geprueft wird die Aussage: Die Funktion bekommt das
// Passwort gar nicht erst uebergeben -- ihre Unterschrift kennt es nicht.
$unterschrift = (new ReflectionFunction('demo_melde_mail'))->getParameters();
$pruef('KRITISCH: die Meldung kann kein Passwort enthalten -- sie bekommt keines',
    array_filter($unterschrift,
        fn($par) => str_contains(mb_strtolower($par->getName()), 'passwort')) === []);
// Hauspost, keine Geschaeftsmail: kein eingebettetes Logo in jeder Meldung.
$pruef('die Meldung schleppt kein Logo mit -- sie geht an uns, nicht an einen Kunden',
    $melde['bilder'] === [] && !str_contains($melde['html'], 'cid:'));
// "Unbekannt" darf nie wie "keine" aussehen (Hausregel): Eine fehlende
// Nummer ist etwas anderes als eine leere Zeile.
$ohneTel = demo_melde_mail('Muster Sicherheit GmbH', 'R. Muster', 'r.muster@beispiel.ch',
    '', 'demo1', 'https://demo1.guardops.ch', '2026-10-03 09:14:00');
$pruef('KRITISCH: eine fehlende Telefonnummer wird benannt, nicht weggelassen',
    str_contains($ohneTel['text'], 'keine Angabe')
    && str_contains($ohneTel['html'], 'keine Angabe'));
// Die Angaben kommen aus einem oeffentlichen Formular. Was ein Interessent
// hineinschreibt, darf in der HTML-Fassung nie Auszeichnung werden.
$boes = demo_melde_mail('<b>Muster</b>', '"><script>x</script>', 'a@beispiel.ch',
    '<i>0</i>', 'demo1', 'https://demo1.guardops.ch', '2026-10-03 09:14:00');
$pruef('KRITISCH: eingeschmuggelte Auszeichnung bleibt Text',
    !str_contains($boes['html'], '<b>Muster</b>')
    && !str_contains($boes['html'], '<script>')
    && str_contains($boes['html'], '&lt;b&gt;'));

// Die Vorratswarnung nennt die Zahl der Plaetze, nicht nur "voll": Wer sie
// liest, soll entscheiden koennen, ob er Plaetze freiraeumt oder den Vorrat
// vergroessert -- dafuer muss er wissen, wie gross er ist.
$vorrat = demo_vorrat_mail(10);
$pruef('KRITISCH: die Vorratswarnung nennt die Zahl der Plaetze',
    str_contains($vorrat['text'], '10') && str_contains($vorrat['html'], '10'));
$pruef('sie sagt im Betreff schon, worum es geht',
    str_contains(mb_strtolower($vorrat['betreff']), 'vorrat')
    || str_contains(mb_strtolower($vorrat['betreff']), 'abgewiesen'));
// Sie beschreibt einen Zustand, keinen Interessenten -- abgewiesen wird
// VOR dem Register, wir kennen ihn nicht. Eine Meldung, die so tut, als
// haetten wir einen Namen, schickt jemanden auf eine Suche ins Leere.
$pruef('sie behauptet nicht, wir wüssten, wer abgewiesen wurde',
    str_contains($vorrat['text'], 'wissen wir nicht'));

// ── Die Bremse fuer die Warnung ──────────────────────────────────────
//
// Sie faellt AUF, nicht zu: Ohne Vermerk geht die Warnung raus. Eine Mail
// zu viel ist harmlos, eine verpasste Warnung kostet Interessenten.
$jetzt = 1_800_000_000;
$pruef('KRITISCH: ohne Vermerk geht die Warnung raus',
    demo_warnung_faellig(null, $jetzt) === true);
$pruef('KRITISCH: kurz nach einer Warnung kommt keine zweite',
    demo_warnung_faellig($jetzt - 60, $jetzt) === false);
$pruef('genau an der Grenze ist sie wieder fällig',
    demo_warnung_faellig($jetzt - DEMO_WARNUNG_PAUSE_MIN * 60, $jetzt) === true);
$pruef('eine Sekunde davor noch nicht',
    demo_warnung_faellig($jetzt - DEMO_WARNUNG_PAUSE_MIN * 60 + 1, $jetzt) === false);
// Ein Vermerk aus der Zukunft (verstellte Uhr, kopierte Datei) darf die
// Warnung nicht auf Dauer stilllegen -- sonst schweigt sie fuer immer.
$pruef('KRITISCH: ein Vermerk aus der Zukunft legt die Warnung nicht still',
    demo_warnung_faellig($jetzt + 99999, $jetzt) === true);

// ── Der Empfaenger ───────────────────────────────────────────────────
//
// Dieselbe Pruefung steht ein zweites Mal in demo_anfrage.php -- die beiden
// Dateien liegen in verschiedenen Buendeln, der gemeinsame Ort waere
// mailer.php und wuerde db.php in einen bewusst datenbankfreien Rechenkern
// ziehen (Begruendung ueber demo_zugang_empfaenger_pruefen()). Damit die
// beiden Fassungen nicht auseinanderlaufen, werden sie hier Eingabe fuer
// Eingabe gegeneinander gehalten.
require_once __DIR__ . '/../backend/demo_anfrage.php';
$faelle = ['', '   ', '__DEMO_EMPFAENGER__', 'info@guardops.ch', ' info@guardops.ch ',
    "a@b.ch\r\nBcc: fremd@example.org", "a@b.ch\nX: y", "a\tb@c.ch", 'kein-email',
    'a@b', 'a@b.chä', 'Max <max@beispiel.ch>'];
$abweichung = [];
foreach ($faelle as $f) {
    if (demo_zugang_empfaenger_pruefen($f) !== demo_empfaenger_pruefen($f)) {
        $abweichung[] = $f;
    }
}
$pruef('KRITISCH: die zweite Fassung der Empfaengerpruefung urteilt wie die erste',
    $abweichung === []);
// Und sie urteilt richtig -- eine Gleichheit zweier falscher Fassungen
// waere keine Zusicherung.
$pruef('KRITISCH: ein nicht ersetzter Platzhalter ist "nicht eingerichtet", nicht eine Adresse',
    demo_zugang_empfaenger_pruefen('__DEMO_EMPFAENGER__') === null);
$pruef('KRITISCH: ein Umbruch in der Adresse wird abgewiesen (Kopfzeilen-Einschleusung)',
    demo_zugang_empfaenger_pruefen("a@b.ch\r\nBcc: fremd@example.org") === null);
$pruef('eine gültige Adresse kommt getrimmt durch',
    demo_zugang_empfaenger_pruefen(' info@guardops.ch ') === 'info@guardops.ch');

// ══ Freie Plaetze, nicht nur der erste (Befund 2026-09-19) ═══════════
//
// ANLASS: Beim Einrichten zeigte sich, dass zwei der zehn Plaetze im
// Mandantenstamm stehen, ihre Datenbanken aber nicht erreichbar sind.
// Solange nur EIN Platz gewaehlt wurde, sperrte ein kaputter Platz den
// ganzen Rest hinter sich.
$alle = ['demo1', 'demo2', 'demo3', 'demo4', 'demo5'];
$pruef('KRITISCH: bei nichts Belegtem sind alle Plaetze frei, in der Reihenfolge des Vorrats',
    demo_plaetze_frei([], $alle) === $alle);
// DER Punkt: Eine Luecke in der Mitte darf nicht das Ende der Liste sein.
$pruef('KRITISCH: ein belegter Platz in der Mitte verdeckt die dahinter nicht',
    demo_plaetze_frei(['demo1', 'demo3'], $alle) === ['demo2', 'demo4', 'demo5']);
$pruef('ist alles belegt, bleibt nichts uebrig -- und das ist eine leere Liste, kein Platz',
    demo_plaetze_frei($alle, $alle) === []);
// Die alte Funktion bleibt und muss dasselbe sagen wie vorher: Sie wird
// weiterhin fuer die schnelle Frage "ist ueberhaupt etwas frei" benutzt.
$pruef('KRITISCH: die Wahl des ersten Platzes liefert weiterhin denselben wie zuvor',
    demo_platz_waehlen(['demo1', 'demo2'], $alle) === 'demo3');
$pruef('und null, wenn nichts frei ist', demo_platz_waehlen($alle, $alle) === null);
$pruef('KRITISCH: die Wahl nimmt immer den ersten der freien, nie einen anderen',
    demo_platz_waehlen(['demo2'], $alle) === demo_plaetze_frei(['demo2'], $alle)[0]);

// Und der Einrichtungsablauf muss sie ALLE durchgehen, nicht nur die
// erste: Ein kaputter Platz darf kein Abbruch sein, sondern ein
// uebersprungener. Geprueft am Quelltext der Funktion, weil ein echter
// Durchlauf zehn Datenbanken braeuchte -- geprueft wird aber die Aussage
// (sie iteriert und bricht nicht beim ersten Fehlschlag ab), nicht ein
// Wortlaut.
$einrichten = (string)file_get_contents(dirname(__DIR__) . '/backend/demo_instanz.php');
$rumpf = substr($einrichten, strpos($einrichten, 'function demo_zugang_einrichten'));
$rumpf = substr($rumpf, 0, strpos($rumpf, "\n}\n") ?: strlen($rumpf));
$pruef('KRITISCH: das Einrichten geht alle freien Plaetze durch, statt beim ersten aufzugeben',
    str_contains($rumpf, 'demo_plaetze_frei(')
    && preg_match('/foreach \(\$frei as /', $rumpf) === 1
    && substr_count($rumpf, 'continue;') >= 3);
// Uebersprungen wird nicht still -- ein Vorrat, der lautlos schrumpft,
// faellt erst auf, wenn er leer ist.
// Gezielt: Die Liste der uebergangenen Plaetze muss SELBST protokolliert
// werden. Auf ein blosses error_log( zu pruefen genuegt nicht -- davon
// stehen mehrere im Rumpf, und die Pruefung bliebe gruen, wenn genau
// diese eine Zeile verschwindet.
$pruef('KRITISCH: ein uebergangener Platz landet im Fehlerprotokoll',
    preg_match('/error_log\([^;]*\$uebersprungen/s', $rumpf) === 1);
// "Frei war keiner" und "frei schon, bereit keiner" sind zwei Aussagen.
$pruef('KRITISCH: "alle belegt" und "keiner bereit" bleiben zwei verschiedene Gruende',
    str_contains($rumpf, "'kein_platz'") && str_contains($rumpf, "'nicht_bereit'"));

// ══ Die offene Anfrage vor der Bestaetigung (ENT-624) ═════════════════
require_once __DIR__ . '/../backend/demo_bestaetigung.php';

// Der Wert ist ein Schluessel, kein Kennzeichen: Er muss unvorhersehbar
// sein, sonst raet ihn jemand und richtet fremde Zugaenge ein.
$w1 = demo_bestaetigung_wert();
$w2 = demo_bestaetigung_wert();
$pruef('KRITISCH: der Bestaetigungswert ist 64 Zeichen hexadezimal',
    preg_match('/^[0-9a-f]{64}$/', $w1) === 1);
$pruef('KRITISCH: zwei Werte sind nicht derselbe',  $w1 !== $w2);

// In der Datenbank steht nur der Abdruck (gleiche Regel wie bei den
// Sitzungen, ENT-501) -- ein Blick hinein gibt keinen gueltigen Link her.
$pruef('KRITISCH: der Abdruck ist nicht der Wert selbst',
    demo_bestaetigung_abdruck($w1) !== $w1);
$pruef('KRITISCH: derselbe Wert ergibt immer denselben Abdruck -- sonst findet '
        . 'das Nachschlagen nie, was das Schreiben abgelegt hat',
    demo_bestaetigung_abdruck($w1) === demo_bestaetigung_abdruck($w1));
$pruef('verschiedene Werte ergeben verschiedene Abdruecke',
    demo_bestaetigung_abdruck($w1) !== demo_bestaetigung_abdruck($w2));

// Die Frist. Auf die Sekunde: Sie gehoert dem Interessenten, nicht uns.
$t = '2026-09-19 09:00:00';
$pruef('KRITISCH: kurz nach dem Anlegen gilt die Anfrage',
    demo_bestaetigung_abgelaufen($t, '2026-09-19 09:00:01') === false);
$pruef('KRITISCH: genau auf der Frist gilt sie noch',
    demo_bestaetigung_abgelaufen($t, '2026-09-20 09:00:00') === false);
$pruef('eine Sekunde danach nicht mehr',
    demo_bestaetigung_abgelaufen($t, '2026-09-20 09:00:01') === true);
// Ein unlesbarer Zeitstempel gilt als abgelaufen, nicht als gueltig: Im
// Zweifel wird kein Zugang eingerichtet, statt einen auf einer Annahme.
$pruef('KRITISCH: ein unlesbarer Zeitstempel gilt als abgelaufen, nicht als gueltig',
    demo_bestaetigung_abgelaufen('kein datum', $t) === true);

// Die Adresse kommt aus dem Deploy, nie aus der Anfrage (ENT-501).
$pruef('KRITISCH: ein nicht ersetzter Platzhalter ist keine Adresse',
    demo_bestaetigung_basis_pruefen('__GUARDOPS_BASIS_URL__') === null);
$pruef('KRITISCH: ohne https keine Adresse',
    demo_bestaetigung_basis_pruefen('http://guardops.ch') === null);
$pruef('KRITISCH: ein Umbruch in der Adresse wird abgewiesen',
    demo_bestaetigung_basis_pruefen("https://guardops.ch\r\nX: y") === null);
$pruef('kein Pfad in der Basis -- er wuerde den Link verdoppeln',
    demo_bestaetigung_basis_pruefen('https://guardops.ch/irgendwo') === null);
$pruef('ein Schrägstrich am Ende faellt weg, statt den Link doppelt zu machen',
    demo_bestaetigung_basis_pruefen('https://guardops.ch/') === 'https://guardops.ch');

// Der Link. Ohne Basis gibt es keinen -- "nicht eingerichtet" ist etwas
// anderes als eine kaputte Adresse, und der Aufrufer unterscheidet das.
$pruef('KRITISCH: ohne hinterlegte Adresse entsteht kein Link statt eines kaputten',
    demo_bestaetigung_link($w1, null) === null || demo_bestaetigung_basis() !== null);
$link = demo_bestaetigung_link($w1, 'https://guardops.ch');
$pruef('KRITISCH: der Link fuehrt auf die Bestaetigungsseite und traegt den Wert',
    $link === 'https://guardops.ch/demo-bestaetigen.html?t=' . $w1);
// Die Seite, auf die er zeigt, muss es auch geben.
$pruef('KRITISCH: die Seite, auf die der Link zeigt, liegt im Repository',
    is_file(dirname(__DIR__) . '/demo-bestaetigen.html'));

// Die Mail mit dem Link.
$best = demo_bestaetigung_mail('Muster Sicherheit GmbH', 'R. Muster', $link);
foreach (['text', 'html'] as $teil) {
    $pruef("die $teil-Fassung traegt den Link", str_contains($best[$teil], $link));
}
// Zu diesem Zeitpunkt gibt es weder Konto noch Platz -- es KANN kein
// Passwort drinstehen, und die Unterschrift der Funktion sagt das auch.
$pruef('KRITISCH: die Bestaetigungsmail bekommt gar kein Passwort uebergeben',
    array_filter((new ReflectionFunction('demo_bestaetigung_mail'))->getParameters(),
        fn($par) => str_contains(mb_strtolower($par->getName()), 'passwort')) === []);
// Wer die Mail bekommt, ohne sie angefordert zu haben, soll wissen, dass
// Nichtstun genuegt -- sonst meldet er sich beunruhigt oder klickt doch.
$pruef('KRITISCH: sie sagt, dass ohne Bestaetigung nichts geschieht',
    str_contains($best['text'], 'ignorieren Sie diese')
    && str_contains(strip_tags($best['html']), 'ignorieren Sie diese'));
$pruef('sie nennt die Gueltigkeitsdauer, statt sie zu verschweigen',
    str_contains($best['text'], (string)DEMO_BESTAETIGUNG_STUNDEN . ' Stunden'));
$pruef('sie ist gezeichnet wie die anderen Mails an Interessenten',
    str_contains($best['html'], 'Mit freundlichen Grüssen'));

// Der Knopf. Ein Mailprogramm, das ihn verschluckt, darf den Empfaenger
// nicht ohne Weiterweg zuruecklassen -- die Adresse steht darum auch als
// Text darunter.
$knopf = mail_knopf('Bestätigen', 'https://guardops.ch/x?t=1');
$pruef('KRITISCH: der Knopf traegt seine Adresse zusaetzlich als lesbaren Text',
    substr_count($knopf, 'https://guardops.ch/x?t=1') >= 2);
$pruef('KRITISCH: der Knopf bringt seine Farben selbst mit, nicht aus dem Stylesheet',
    str_contains($knopf, 'background:' . MAIL_FARBE_BLAU)
    && str_contains($knopf, 'color:#FFFFFF'));
// Auch hier: was hereingereicht wird, bleibt Text.
$pruef('KRITISCH: eingeschmuggelte Auszeichnung im Knopf bleibt Text',
    !str_contains(mail_knopf('<b>X</b>', 'https://a.ch'), '<b>X</b>'));

// ══ Die Abschiedsmail nach dem Ablauf (ENT-634) ══════════════════════
//
// Geprueft wird die AUSSAGE der Mail, nicht ihr Wortlaut: dass sie den
// Weg zurueck anbietet, dass sie ohne Link trotzdem brauchbar bleibt, und
// dass der Link den Wert traegt.
$ende = demo_ende_mail('Beispiel Betrieb AG', 'R. Beispiel',
    demo_ende_link(str_repeat('a', 64), 'https://guardops.ch'));
$pruef('die Abschiedsmail nennt Firma und Person',
    str_contains($ende['text'], 'Beispiel Betrieb AG')
    && str_contains($ende['text'], 'R. Beispiel'));
// Der Anlass der Mail ist nicht die Schliessung, sondern die Frage, ob es
// weitergeht. Ohne Knopf waere sie genau die trockene Sperrmeldung, die
// der Projektinhaber nicht wollte.
$pruef('KRITISCH: sie bietet den Weg zurueck an, statt nur das Ende zu melden',
    str_contains($ende['html'], 'weiter nutzen')
    && str_contains($ende['html'], '/demo-weiter.html?w='));
// Sie sagt, dass die Daten weg sind -- wer das nicht liest, sucht sie
// spaeter beim Support.
$pruef('KRITISCH: sie sagt, dass die Testdaten geloescht sind',
    str_contains($ende['text'], 'gelöscht'));
// Der Knopf verspricht keine Wiederaufnahme, sondern einen Anruf.
$pruef('KRITISCH: sie kuendigt an, dass sich jemand meldet -- der Zugang geht nicht wieder auf',
    str_contains($ende['text'], 'Wir melden uns'));
// Eine Mail, deren Textfassung anders zeichnet als ihre HTML-Fassung, ist
// nicht "fast gleich" -- je nach Mailprogramm sieht der Empfaenger die eine
// oder die andere.
$pruef('KRITISCH: Text- und HTML-Fassung zeichnen mit derselben Grussformel',
    str_contains($ende['text'], 'Mit freundlichen Grüssen')
    && str_contains(strip_tags($ende['html']), 'Mit freundlichen Grüssen'));
// Eingeschmuggelte Auszeichnung bleibt Text -- wie ueberall sonst.
$ende2 = demo_ende_mail('<b>X</b>', '<i>Y</i>', null);
$pruef('KRITISCH: eingeschmuggelte Auszeichnung bleibt Text',
    !str_contains($ende2['html'], '<b>X</b>') && !str_contains($ende2['html'], '<i>Y</i>'));
// Ohne Basisadresse im Deploy gibt es keinen Link. Die Mail muss trotzdem
// stehen: Ein Knopf ins Leere waere schlimmer als keiner, ein Ausfall des
// Ablaufs waere am schlimmsten.
$pruef('KRITISCH: ohne Basisadresse faellt nur der Knopf weg, nicht die Mail',
    demo_ende_link(str_repeat('a', 64), null) === null
    && $ende2['betreff'] !== '' && !str_contains($ende2['html'], 'demo-weiter.html'));

// Der Wert im Link steht in der Datenbank nur als Abdruck (ENT-501).
$wert = demo_ende_wert();
$pruef('KRITISCH: der Wert ist 64 Zeichen hexadezimal, wie der Bestaetigungswert',
    (bool)preg_match('/^[0-9a-f]{64}$/', $wert));
$pruef('KRITISCH: zwei Werte sind nicht derselbe',
    $wert !== demo_ende_wert());
$pruef('KRITISCH: der Abdruck ist nicht der Wert -- ein Blick in die Datenbank gibt keinen Link her',
    demo_ende_abdruck($wert) !== $wert
    && demo_ende_abdruck($wert) === demo_ende_abdruck($wert));

// Die Groessenklassen. "keine Angabe" ist eine ANTWORT und muss sich von
// "gar nicht gefragt" unterscheiden (Hausregel).
$pruef('KRITISCH: nur bekannte Groessenklassen werden angenommen',
    demo_groesse_gueltig('bis10') && demo_groesse_gueltig('keine')
    && !demo_groesse_gueltig('') && !demo_groesse_gueltig('bis 10')
    && !demo_groesse_gueltig('riesig'));
$pruef('KRITISCH: die ausdrueckliche Verweigerung liest sich anders als eine fehlende Angabe',
    demo_groesse_text('keine') !== demo_groesse_text('')
    && demo_groesse_text('') !== '');
$pruef('jede Klasse hat einen lesbaren Text, keinen Schluessel',
    count(array_filter(array_keys(DEMO_GROESSE_KLASSEN),
        fn($k) => demo_groesse_text($k) === $k)) === 0);

// Die Meldung an den Betreiber. Die Groesse ist der Grund, warum gefragt
// wird -- sie gehoert in den Betreff, nicht nur in den Rumpf.
$weiter = demo_weiter_mail('Beispiel Betrieb AG', 'R. Beispiel', 'r@beispiel.ch',
    '+41 79 000 00 00', 'demo1', 'elfbis30');
$pruef('KRITISCH: die Meldung traegt Firma und Groesse im Betreff',
    str_contains($weiter['betreff'], 'Beispiel Betrieb AG')
    && str_contains($weiter['betreff'], demo_groesse_text('elfbis30')));
$pruef('sie nennt alle Wege, den Interessenten zu erreichen',
    str_contains($weiter['text'], 'r@beispiel.ch')
    && str_contains($weiter['text'], '+41 79 000 00 00')
    && str_contains($weiter['text'], 'demo1'));

echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $n) { echo "  x $n\n"; }
exit(count($bad) ? 1 : 0);
