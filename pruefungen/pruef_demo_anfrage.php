<?php
declare(strict_types=1);
// Demo-Anfrage von der Homepage (ENT-469): Rechenkern UND Bremse werden
// WIRKLICH ausgefuehrt -- beide kommen ohne Datenbank aus, seit die Homepage
// auf ihrer eigenen Domain (guardops.ch) steht. Nur der Endpunkt selbst wird
// am Quelltext geprueft, weil er eine Anfrage und einen Mailversand braucht.
$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/demo_anfrage.php';
require __DIR__ . '/../backend/demo_bremse.php';

// ══════════ RECHENKERN, ECHT AUSGEFUEHRT ═════════════════════════════
$gut = ['firma' => ' Muster Sicherheitsdienst AG ', 'name' => 'A. Beispielperson',
    'email' => 'a.beispiel@example.invalid', 'telefon' => '079 123 45 67',
    'groesse' => '11 – 30', 'nachricht' => "Zeile 1\r\nZeile 2"];
$p = demo_anfrage_pruefen($gut);
pruef('Eine vollstaendige Anfrage wird angenommen', $p['fehler'] === []);
pruef('Randleerzeichen werden entfernt', $p['werte']['firma'] === 'Muster Sicherheitsdienst AG');
pruef('Die Nachricht behaelt ihre Umbrueche (nur im Rumpf, LF statt CRLF)',
    $p['werte']['nachricht'] === "Zeile 1\nZeile 2");

$leer = demo_anfrage_pruefen([]);
pruef('KRITISCH: ohne Firma, Name, E-Mail und Telefon wird abgewiesen -- alle vier Felder benannt',
    isset($leer['fehler']['firma'], $leer['fehler']['name'], $leer['fehler']['email'],
          $leer['fehler']['telefon']));

// Telefon: geprueft werden die ZIFFERN, nicht die Schreibweise. Alle drei
// Formen unten sind dieselbe Nummer und muessen durchkommen; eine zu kurze
// Eingabe darf es nicht.
foreach (['079 123 45 67', '+41 79 123 45 67', '0041 79/123 45 67', '(079) 123-45-67'] as $form) {
    pruef("Die Telefonschreibweise \"$form\" wird angenommen",
        demo_anfrage_pruefen(array_merge($gut, ['telefon' => $form]))['fehler'] === []);
}
foreach (['', '  ', '12345', 'ruf mich an', '079 12'] as $murks) {
    pruef("KRITISCH: \"$murks\" wird als Telefonnummer abgewiesen",
        isset(demo_anfrage_pruefen(array_merge($gut, ['telefon' => $murks]))['fehler']['telefon']));
}
pruef('KRITISCH: gezaehlt werden nur Ziffern, Trennzeichen zaehlen nicht mit',
    demo_telefon_ziffern('+41 79/123 45 67') === 11 && demo_telefon_ziffern('----') === 0);

$falscheMail = demo_anfrage_pruefen(array_merge($gut, ['email' => 'keine adresse']));
pruef('KRITISCH: eine ungueltige E-Mail-Adresse wird abgewiesen', isset($falscheMail['fehler']['email']));

// Header-Injection: ein Umbruch in einem Kopfzeilenfeld darf NIE bis zum
// Betreff durchkommen.
$injiziert = demo_anfrage_pruefen(array_merge($gut, ['firma' => "Firma\r\nBcc: fremd@example.invalid"]));
pruef('KRITISCH: Umbrueche in der Firma werden entfernt (keine zusaetzliche Kopfzeile)',
    $injiziert['fehler'] === [] && !str_contains($injiziert['werte']['firma'], "\n")
    && !str_contains(demo_anfrage_betreff($injiziert['werte']), "\n"));
$injiziertMail = demo_anfrage_pruefen(array_merge($gut, ['email' => "a@example.invalid\r\nCc: b@example.invalid"]));
pruef('KRITISCH: eine E-Mail-Adresse mit Umbruch gilt als ungueltig', isset($injiziertMail['fehler']['email']));

$lang = demo_anfrage_pruefen(array_merge($gut, ['firma' => str_repeat('ä', 500), 'nachricht' => str_repeat('x', 5000)]));
pruef('Ueberlange Felder werden gekuerzt, nicht abgewiesen (multibyte-sicher)',
    $lang['fehler'] === [] && mb_strlen($lang['werte']['firma']) === DEMO_MAX_FIRMA
    && mb_strlen($lang['werte']['nachricht']) === DEMO_MAX_NACHRICHT);

$fremdeGroesse = demo_anfrage_pruefen(array_merge($gut, ['groesse' => 'irgendwas']));
pruef('Eine unbekannte Betriebsgroesse wird zu "keine Angabe", nicht zum Fehler',
    $fremdeGroesse['fehler'] === [] && $fremdeGroesse['werte']['groesse'] === '');

pruef('KRITISCH: das Fallenfeld erkennt ein ausgefuelltes Feld -- und nur das',
    demo_ist_falle(['website' => 'http://spam.invalid']) && !demo_ist_falle(['website' => '  '])
    && !demo_ist_falle([]));

$text = demo_anfrage_text($p['werte'], '01.01.2000 12:00');
$html = demo_anfrage_html($p['werte'], '01.01.2000 12:00');
pruef('Der Reintext nennt Firma, Name, E-Mail und die Nachricht',
    str_contains($text, 'Muster Sicherheitsdienst AG') && str_contains($text, 'A. Beispielperson')
    && str_contains($text, 'a.beispiel@example.invalid') && str_contains($text, "Zeile 1\nZeile 2"));
// Eine Nummer, die nur im Formular steht und nicht in der Mail, waere fuer
// den Empfaenger nicht vorhanden -- beide Fassungen muessen sie tragen.
pruef('KRITISCH: Reintext UND HTML-Fassung nennen die Telefonnummer',
    str_contains($text, '079 123 45 67') && str_contains($html, '079 123 45 67'));
$boese = demo_anfrage_pruefen(array_merge($gut, ['nachricht' => '<script>alert(1)</script>']));
$htmlBoese = demo_anfrage_html($boese['werte'], '01.01.2000 12:00');
pruef('KRITISCH: die HTML-Fassung maskiert Eingaben (kein rohes <script>)',
    !str_contains($htmlBoese, '<script>') && str_contains($htmlBoese, '&lt;script&gt;'));
// Dieselbe Lehre wie in beleg_versenden.php (ENT-206): jedes p/a/td traegt
// seine eigene Schrift, weil Outlook sie nicht vererbt.
$tags = [];
preg_match_all('/<(p|a|td)\s[^>]*>/', $html, $tags);
pruef('Jedes p/a/td-Element der HTML-Fassung traegt sein eigenes font-family',
    count($tags[0]) >= 6 && count(array_filter($tags[0], fn($t) => !str_contains($t, 'font-family'))) === 0);
pruef('Der Betreff nennt die Firma', demo_anfrage_betreff($p['werte']) === 'Demo-Anfrage von Muster Sicherheitsdienst AG');

// ══════════ DER EMPFAENGER, ECHT AUSGEFUEHRT ═════════════════════════
// Er kommt seit der eigenen Domain aus dem Deploy statt aus betrieb.email --
// gleiche Bauart wie basis_url_pruefen() in db.php (ENT-501).
pruef('Eine gueltige Adresse aus dem Deploy wird durchgereicht',
    demo_empfaenger_pruefen(' kontakt@example.invalid ') === 'kontakt@example.invalid');
pruef('KRITISCH: ein NICHT ERSETZTER Platzhalter gilt als "nicht eingerichtet", nicht als Adresse',
    demo_empfaenger_pruefen('__DEMO_EMPFAENGER__') === null);
pruef('Eine leere Angabe gilt als "nicht eingerichtet"', demo_empfaenger_pruefen('   ') === null);
pruef('KRITISCH: eine Adresse mit Umbruch wird abgewiesen (sie steht in einer Kopfzeile)',
    demo_empfaenger_pruefen("kontakt@example.invalid\nBcc: fremd@example.invalid") === null);
pruef('Eine unsinnige Adresse wird abgewiesen', demo_empfaenger_pruefen('kein-at-zeichen') === null);
// Die Aussage, nicht der Wortlaut: Im ausgelieferten Code darf der Aufrufer
// den Wert NUR durch die Pruefung reichen, nie roh zurueckgeben.
$kern = (string)file_get_contents(__DIR__ . '/../backend/demo_anfrage.php');
pruef('KRITISCH: demo_empfaenger() reicht den Platzhalter durch die Pruefung, statt ihn roh zurueckzugeben',
    (bool)preg_match('/function demo_empfaenger\(\)[\s:?a-z]*\{\s*return demo_empfaenger_pruefen\(/', $kern));

// ══════════ DIE BREMSE, ECHT AUSGEFUEHRT ═════════════════════════════
// Die reine Entscheidung zuerst -- ohne Datei, wie anmeld_sperre().
$t = 1000000;   // fester Bezugspunkt, kein Datum in der Naehe von heute
$im_fenster = fn(int $n) => array_fill(0, $n, $t - 60);
pruef('Unter der Grenze ist frei', demo_bremse_entscheiden($im_fenster(DEMO_BREMSE_MAX - 1), $t) === 0);
pruef('KRITISCH: an der Grenze wird gesperrt',
    demo_bremse_entscheiden($im_fenster(DEMO_BREMSE_MAX), $t) === DEMO_BREMSE_SPERRE_MIN);
pruef('KRITISCH: alte Eintraege zaehlen nicht mehr -- die Sperre laeuft ab',
    demo_bremse_entscheiden(array_fill(0, DEMO_BREMSE_MAX * 3, $t - (DEMO_BREMSE_FENSTER_MIN + 1) * 60), $t) === 0);
pruef('Alte Eintraege werden beim Aufraeumen weggeworfen, junge bleiben',
    demo_bremse_aufraeumen([$t - 99999, $t - 60, $t], $t) === [$t - 60, $t]);
pruef('Die Adresse steht nicht im Dateinamen (nur ihr Hash)',
    !str_contains(demo_bremse_datei('203.0.113.7', '/x'), '203.0.113.7')
    && str_contains(demo_bremse_datei('203.0.113.7', '/x'), hash('sha256', '203.0.113.7')));

// Und jetzt mit echten Dateien.
$tmp = sys_get_temp_dir() . '/pruef-demo-bremse-' . bin2hex(random_bytes(6));
$adr = '203.0.113.7';
$frei = true;
for ($i = 0; $i < DEMO_BREMSE_MAX; $i++) {
    if (demo_bremse_pruefen($adr, $tmp, $t + $i) !== 0) { $frei = false; }
}
pruef('Die ersten Anfragen einer Adresse gehen durch', $frei);
pruef('KRITISCH: die Anfrage NACH der Grenze wird gesperrt',
    demo_bremse_pruefen($adr, $tmp, $t + DEMO_BREMSE_MAX) === DEMO_BREMSE_SPERRE_MIN);
pruef('KRITISCH: eine andere Adresse ist davon nicht betroffen',
    demo_bremse_pruefen('198.51.100.9', $tmp, $t + DEMO_BREMSE_MAX) === 0);
// Weiterklopfen verlaengert die Sperre, statt sie auszusitzen: Der Eintrag
// wird auch dann geschrieben, wenn die Anfrage abgewiesen wird.
demo_bremse_pruefen($adr, $tmp, $t + DEMO_BREMSE_MAX + 1);
$zeilen = file($tmp . '/' . hash('sha256', $adr) . '.txt', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
pruef('KRITISCH: auch eine abgewiesene Anfrage wird gezaehlt (Weiterklopfen verlaengert)',
    count($zeilen) === DEMO_BREMSE_MAX + 2);
pruef('Nach Ablauf des Fensters ist dieselbe Adresse wieder frei',
    demo_bremse_pruefen($adr, $tmp, $t + (DEMO_BREMSE_FENSTER_MIN + 1) * 60) === 0);

// DIE WICHTIGSTE PRUEFUNG DIESER DATEI: Kann die Bremse nicht arbeiten,
// meldet sie das -- sie gibt NICHT "frei" zurueck. Der Nachbarcode traegt
// genau diese Lehre (anmeldung.php, ENT-501: "Fehlt die Tabelle, gibt es
// keine Bremse -- und das ist der gefaehrlichste Zustand dieser Datei").
//
// Als unbeschreibbaren Ort wird ein Pfad UNTERHALB EINER DATEI benutzt, nicht
// ein Verzeichnis ohne Schreibrecht: Die Pruefungen laufen je nach Umgebung
// als root, und root schreibt auch dorthin, wo das Recht fehlt -- die Pruefung
// waere dann gruen, ohne je etwas gezeigt zu haben. Ein Unterordner in einer
// Datei scheitert fuer jeden.
$sperrdatei = sys_get_temp_dir() . '/pruef-demo-bremse-datei-' . bin2hex(random_bytes(6));
file_put_contents($sperrdatei, 'keine Ablage');
$fiel_zu = false;
try { demo_bremse_pruefen($adr, $sperrdatei . '/unmoeglich', $t); }
catch (Throwable $e) { $fiel_zu = true; }
pruef('KRITISCH: kann die Bremse kein Verzeichnis anlegen, meldet sie einen Fehler -- sie sagt NICHT still "frei"', $fiel_zu);
@unlink($sperrdatei);

// ZWEITER RIEGEL, EIGENER PRUEFFALL. Die Gegenprobe hat gezeigt, dass der
// Fall oben NUR das fehlende Verzeichnis trifft: mkdir scheitert zuerst, und
// ein Fehler im Oeffnen des Zaehlers blieb dadurch unbemerkt. Hier steht das
// Verzeichnis, aber der Zaehler selbst ist nicht zu oeffnen -- er ist ein
// Verzeichnis statt einer Datei.
$dazwischen = sys_get_temp_dir() . '/pruef-demo-bremse-quer-' . bin2hex(random_bytes(6));
mkdir($dazwischen, 0700, true);
mkdir(demo_bremse_datei($adr, $dazwischen), 0700, true);
$fiel_zu2 = false;
try { demo_bremse_pruefen($adr, $dazwischen, $t); }
catch (Throwable $e) { $fiel_zu2 = true; }
pruef('KRITISCH: kann die Bremse ihren Zaehler nicht oeffnen, meldet sie einen Fehler -- sie sagt NICHT still "frei"',
    $fiel_zu2);
@rmdir(demo_bremse_datei($adr, $dazwischen)); @rmdir($dazwischen);
array_map('unlink', (array)glob($tmp . '/*.txt')); @rmdir($tmp);

// ══════════ ZUSTELLBARKEIT, OHNE NETZ GEPRUEFT ═══════════════════════
// Der Nachschlag wird eingespeist: Diese Suite darf nicht davon abhaengen, ob
// der Rechner, auf dem sie laeuft, gerade ins DNS kommt -- sonst pruefte sie
// die Leitung statt die Logik.
$kennt = fn(array $vorhanden) => fn(string $d) => in_array($d, $vorhanden, true);

pruef('KRITISCH: eine Adresse mit Mailserver gilt als zustellbar',
    demo_adresse_zustellbar('a@beispiel.invalid', $kennt(['beispiel.invalid', DEMO_KONTROLL_DOMAIN])) === true);
pruef('KRITISCH: eine Adresse ohne Mailserver wird erkannt -- der Fall "info@test.cha"',
    demo_adresse_zustellbar('info@test.cha', $kennt([DEMO_KONTROLL_DOMAIN])) === false);
pruef('KRITISCH: antwortet der Namensdienst gar nicht, lautet das Urteil "nicht pruefbar" -- NICHT "gibt es nicht"',
    demo_adresse_zustellbar('info@test.cha', $kennt([])) === null);
pruef('Ohne @-Zeichen gibt es keine Domain, also auch keinen Mailserver',
    demo_adresse_zustellbar('keine-adresse', $kennt([DEMO_KONTROLL_DOMAIN])) === false);
pruef('Getrennt wird am LETZTEN @, nicht am ersten',
    demo_domain('"a@b"@beispiel.invalid') === 'beispiel.invalid');

// Die Kontrolldomain kostet einen zweiten Nachschlag. Im Normalfall darf er
// gar nicht erst stattfinden.
$gefragt = [];
demo_adresse_zustellbar('a@beispiel.invalid', function (string $d) use (&$gefragt) {
    $gefragt[] = $d;
    return true;
});
pruef('Im Normalfall wird nur EINE Domain nachgeschlagen, nicht zusaetzlich die Kontrolle',
    $gefragt === ['beispiel.invalid']);

// ══════════ ENDPUNKT, AM QUELLTEXT ═══════════════════════════════════
$q = file_get_contents(__DIR__ . '/../backend/api/demo_senden.php');
$q = preg_replace('/\/\/[^\n]*/', '', (string)$q);   // Kommentare zaehlen nicht
pruef('KRITISCH: der Endpunkt existiert', $q !== '');
pruef('Nur POST wird angenommen', (bool)preg_match("/REQUEST_METHOD'\] !== 'POST'/", $q));
pruef('KRITISCH: keine Sitzung -- der Endpunkt ist oeffentlich und verlangt bewusst keine',
    !str_contains($q, 'require_session(') && !str_contains($q, 'require_kundensession('));
// Der Kern der Umstellung: Dieser Endpunkt laeuft auch dort, wo es keine
// Datenbank gibt. Eine einzige db()-Zeile wuerde das lautlos beenden --
// auf guardops.ch mit stehengelassenen __DB_*__-Platzhaltern faellt sie
// nicht beim Deploy auf, sondern beim ersten Interessenten.
pruef('KRITISCH: der Endpunkt ruft die Datenbank NIRGENDS auf',
    !preg_match('/\bdb\(\)/', $q) && !preg_match('/\bPDO\b/', $q) && !str_contains($q, 'anmeldung.php'));
pruef('KRITISCH: die Bremse wird benutzt und greift VOR der Pruefung der Felder',
    str_contains($q, 'demo_bremse_pruefen(')
    && strpos($q, 'demo_bremse_pruefen(') < strpos($q, 'demo_anfrage_pruefen('));
pruef('KRITISCH: eine Bremse, die nicht arbeiten kann, fuehrt zur Ablehnung -- nicht zum Versand',
    (bool)preg_match('/demo_bremse_pruefen\([\s\S]{0,200}?catch[\s\S]{0,300}?503/', $q));
pruef('KRITISCH: der Empfaenger kommt aus dem Deploy, nie aus der Anfrage',
    str_contains($q, 'demo_empfaenger()')
    && !preg_match('/smtp_senden\(\s*\$in\b/', $q) && !preg_match('/\$in\[.empfaenger.\]/', $q));
pruef('KRITISCH: das Fallenfeld fuehrt zur selben Erfolgsantwort ohne Versand',
    (bool)preg_match('/demo_ist_falle\(\$in\)[\s\S]{0,120}DEMO_DANKE/', $q)
    && strpos($q, 'demo_ist_falle(') < strpos($q, 'smtp_senden('));
// Vier Zustaende, vier Texte -- "unbekannt" darf nie wie "keine" aussehen.
// Drei verschiedene 503-Antworten (Bremse kaputt, Empfaenger fehlt, SMTP
// fehlt), dazu 429 und 502. Gezaehlt wird ausserdem, dass die Texte
// tatsaechlich VERSCHIEDEN sind, nicht nur die Nummern.
$texte = [];
preg_match_all("/'message' => '([^']+)'/", $q, $texte);
pruef('"Nicht eingerichtet" (503), "zu viele Anfragen" (429) und "fehlgeschlagen" (502) sind verschiedene Antworten',
    substr_count($q, '503') === 3 && str_contains($q, '502') && str_contains($q, '429'));
pruef('KRITISCH: keine zwei Antworten tragen denselben Text',
    count($texte[1]) >= 6 && count($texte[1]) === count(array_unique($texte[1])));
pruef('Der Versand wird nur versucht, wenn SMTP eingerichtet ist',
    strpos($q, 'smtp_konfiguriert()') < strpos($q, 'smtp_senden('));
// Abgewiesen wird NUR das belegte "gibt es nicht". Ein Vergleich auf "falsy"
// statt auf === false wuerde auch das "nicht pruefbar" (null) abweisen und
// damit einem Interessenten bei gestoertem Namensdienst sagen, seine Adresse
// sei falsch.
pruef('KRITISCH: nur ein belegtes "gibt es nicht" weist ab, nicht auch "nicht pruefbar"',
    (bool)preg_match('/demo_adresse_zustellbar\([^;]*===\s*false/', $q));
pruef('KRITISCH: der Nachschlag geschieht erst NACH dem Fallenfeld -- ein Skript loest keinen aus',
    strpos($q, 'demo_ist_falle(') < strpos($q, 'demo_adresse_zustellbar('));

// ══════════ AUSGABE ══════════════════════════════════════════════════
echo "\n$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
