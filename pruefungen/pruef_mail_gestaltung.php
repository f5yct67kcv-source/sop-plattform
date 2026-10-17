<?php
declare(strict_types=1);
// E-Mail-Designer des Betriebs (ENT-729), wirklich ausgefuehrt.
//
// Geprueft wird die Mail, die herauskommt -- nicht der Quelltext: Werden
// die Platzhalter eingesetzt, die Farben angewandt, bleibt der Link in der
// Mail, auch wenn jemand die Knopfbeschriftung aendert, kommt nichts vom
// Betrieb ungefiltert ins HTML, und landet eine Antwort beim Betrieb.
//
// KEIN festes Datum (test_datumsfest.mjs).

require_once __DIR__ . '/../backend/mailer.php';
require_once __DIR__ . '/../backend/mail_gestaltung.php';

$ok = 0;
$fehler = [];
$pruef = function (string $was, bool $bedingung) use (&$ok, &$fehler): void {
    if ($bedingung) { $ok++; } else { $fehler[] = $was; }
};

$betrieb = ['firma' => 'Muster Sicherheit AG', 'strasse' => 'Beispielweg 1', 'ort' => '9999 Musterort',
            'telefon' => '000 000 00 00', 'email' => 'buero@beispiel.ch',
            'logo' => ['mime' => 'image/png', 'inhalt' => "\x89PNG-Rohbytes"], 'logo_webp' => false];
$link = 'https://beispiel.ch/api/beleg_oeffentlich.php?token=abc';

// ── 1. Die Vorgabe ist gueltig und vollstaendig ──────────────────────
[$v, $f0] = mail_g_pruefen(null);
$pruef('Die Vorgabe besteht die eigene Pruefung ohne Fehler', $f0 === []);
$pruef('Jede Mailart hat Betreff, Kopfband und Text',
    array_reduce(array_keys(MAIL_ARTEN), fn($c, $a) => $c && $v['texte'][$a]['betreff'] !== ''
        && $v['texte'][$a]['kopf'] !== '' && $v['texte'][$a]['text'] !== '', true));
$pruef('Arten mit Knopf haben eine Beschriftung, die anderen keine',
    array_reduce(array_keys(MAIL_ARTEN), fn($c, $a) => $c
        && ((MAIL_ARTEN[$a]['knopf']) === ($v['texte'][$a]['knopf'] !== '')), true));

foreach (array_keys(MAIL_ARTEN) as $art) {
    $m = mail_betrieb_bauen($v, $betrieb, $art, mail_g_muster($art), ['link' => $link, 'code' => '123 456']);
    $pruef("$art: in Betreff, HTML und Text bleibt kein Platzhalter stehen",
        !preg_match('/\{[A-Za-z-]+\}/', $m['betreff'] . $m['html'] . $m['text']));
    $pruef("$art: der Gruss nennt den Betrieb", str_contains($m['html'], 'Muster Sicherheit AG'));
    if (MAIL_ARTEN[$art]['knopf']) {
        $pruef("$art: der Link steht im Knopf und im reinen Text",
            substr_count($m['html'], 'href="' . htmlspecialchars($link, ENT_QUOTES) . '"') >= 2
            && str_contains($m['text'], $link));
    }
}

// ── 2. Pruefung beim Speichern ───────────────────────────────────────
[, $f] = mail_g_pruefen(['farben' => ['knopf' => 'rot']]);
$pruef('Eine ungueltige Farbe wird abgelehnt', count($f) === 1 && str_contains($f[0], 'Knopf'));
[, $f] = mail_g_pruefen(['texte' => ['offerte' => ['text' => 'Hallo {Kundennr}']]]);
$pruef('Ein unbekannter Platzhalter wird abgelehnt', count($f) === 1 && str_contains($f[0], 'Kundennr'));
[, $f] = mail_g_pruefen(['texte' => ['offerte' => ['text' => 'Ihr Code {Code}']]]);
$pruef('Ein Platzhalter einer anderen Mailart gilt hier nicht', count($f) === 1);
[, $f] = mail_g_pruefen(['gruss' => "Grüsse\n{Nummer}"]);
$pruef('Im Gruss gelten nur Firma, Telefon und E-Mail', count($f) === 1);
[$g, $f] = mail_g_pruefen(['logo' => ['breite' => 9000]]);
$pruef('Eine unsinnige Logogroesse wird abgelehnt', count($f) === 1);
[$g, $f] = mail_g_pruefen(['texte' => ['offerte' => ['knopf' => '', 'betreff' => '  ']]]);
$pruef('Leerer Betreff oder leere Knopfbeschriftung: es gilt wieder die Vorgabe',
    $f === [] && $g['texte']['offerte']['knopf'] === 'Offerte ansehen' && $g['texte']['offerte']['betreff'] !== '');
[$g] = mail_g_pruefen(['unsinn' => 1, 'farben' => ['knopf' => '#e05757']]);
$pruef('Unbekannte Schluessel fallen weg, Farben werden einheitlich geschrieben',
    !isset($g['unsinn']) && $g['farben']['knopf'] === '#E05757');

// ── 3. Was der Betrieb einstellt, kommt an ───────────────────────────
[$g] = mail_g_pruefen(['farben' => ['kopf_hg' => '#E05757', 'kopf_text' => '#111111', 'knopf' => '#123456',
                       'knopf_text' => '#FEDCBA', 'link' => '#00AA00'],
                       'texte' => ['offerte' => ['knopf' => 'Jetzt anschauen', 'kopf' => 'Ihre {Titel}']]]);
$m = mail_betrieb_bauen($g, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Kopfband in der gewaehlten Farbe und mit dem eigenen Text',
    str_contains($m['html'], 'background:#E05757') && str_contains($m['html'], 'color:#111111;">Ihre Offerte'));
$pruef('Knopf in der gewaehlten Farbe und mit der eigenen Beschriftung',
    str_contains($m['html'], 'background:#123456') && str_contains($m['html'], 'color:#FEDCBA;text-decoration:none;">Jetzt anschauen'));
$pruef('KRITISCH: eine geaenderte Beschriftung nimmt den Link nicht mit', str_contains($m['html'], 'href="' . $link . '"'));
$pruef('Die Linkfarbe gilt fuer den Ersatzlink', str_contains($m['html'], 'color:#00AA00;word-break'));

[$g] = mail_g_pruefen(['texte' => ['offerte' => ['text' => "<script>alert(1)</script> & <b>fett</b>"]],
                       'gruss' => "<img src=x onerror=1>"]);
$m = mail_betrieb_bauen($g, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('KRITISCH: Text des Betriebs kommt nie als HTML in die Mail',
    !str_contains($m['html'], '<script') && !str_contains($m['html'], '<b>fett') && !str_contains($m['html'], '<img src=x')
    && str_contains($m['html'], '&lt;script&gt;'));
$boes = $betrieb; $boes['firma'] = '<a href="x">Firma</a>';
$m = mail_betrieb_bauen($v, $boes, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Auch der Firmenname wird maskiert', !str_contains($m['html'], '<a href="x">'));

// ── 4. Logo ──────────────────────────────────────────────────────────
$m = mail_betrieb_bauen($v, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Logo an: eingebettet ueber cid, genau ein Bild dabei',
    str_contains($m['html'], 'src="cid:betrieb-logo"') && count($m['bilder']) === 1 && $m['bilder'][0]['cid'] === 'betrieb-logo');
[$g] = mail_g_pruefen(['logo' => ['an' => false]]);
$m = mail_betrieb_bauen($g, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Logo aus: kein Bild in der Mail', !str_contains($m['html'], '<img') && $m['bilder'] === []);
$m = mail_betrieb_bauen($v, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link], true);
$pruef('Vorschau: Logo als data-Adresse, nichts eingebettet',
    str_contains($m['html'], 'src="data:image/png;base64,') && $m['bilder'] === []);
$ohne = $betrieb; $ohne['logo'] = null;
$m = mail_betrieb_bauen($v, $ohne, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Ohne hinterlegtes Logo: keine leere Bildstelle', !str_contains($m['html'], '<img'));
[$g] = mail_g_pruefen(['logo' => ['ausrichtung' => 'rechts', 'breite' => 90]]);
$m = mail_betrieb_bauen($g, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Ausrichtung und Breite des Logos werden angewandt',
    str_contains($m['html'], 'align="right"') && str_contains($m['html'], 'width="90"'));

// ── 5. Hinweis, Antwortadresse, Fassung, Code ────────────────────────
$m = mail_betrieb_bauen($v, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('Hinweis "Versendet mit GuardOpS" ist voreingestellt an', str_contains($m['html'], 'Versendet mit'));
[$g] = mail_g_pruefen(['hinweis' => false]);
$m = mail_betrieb_bauen($g, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link]);
$pruef('und laesst sich abschalten', !str_contains($m['html'], 'Versendet mit'));
$pruef('Antworten gehen an die E-Mail des Betriebs', $m['antwort_an'] === 'buero@beispiel.ch');
$m = mail_betrieb_bauen($v, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link, 'fassung' => 2]);
$pruef('Ab der zweiten Fassung steht der Hinweis "angepasste Fassung" -- auch im reinen Text',
    str_contains($m['html'], 'angepasste Fassung (Fassung 2)') && str_contains($m['text'], 'angepasste Fassung'));
$m = mail_betrieb_bauen($v, $betrieb, 'offerte', mail_g_muster('offerte'), ['link' => $link, 'fassung' => 1]);
$pruef('Bei der ersten Fassung nicht', !str_contains($m['html'], 'angepasste Fassung'));
$m = mail_betrieb_bauen($v, $betrieb, 'code', mail_g_muster('code'), ['code' => '987 654']);
$pruef('Die Code-Mail traegt den Code, auch wenn der Text ihn nicht nennt',
    str_contains($m['html'], '987 654') && str_contains($m['text'], '987 654'));

// ── 6. Antwortadresse im Kopf der Nachricht ──────────────────────────
$n = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', '<p>x</p>', 'x', [], [], 'g1', 'buero@beispiel.ch');
$pruef('Reply-To steht im Kopf', str_contains($n, "\r\nReply-To: buero@beispiel.ch\r\n"));
$n = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', '<p>x</p>', 'x', [], [], 'g1', "x@y.ch\r\nBcc: z@z.ch");
$pruef('KRITISCH: eine Antwortadresse mit Umbruch schleust keine Kopfzeile ein',
    !str_contains($n, 'Bcc:') && !str_contains($n, 'Reply-To'));
$n = smtp_nachricht_bauen('a@bsp.ch', 'b@bsp.ch', 'Betreff', '<p>x</p>', 'x', [], [], 'g1');
$pruef('Ohne Antwortadresse kein Reply-To', !str_contains($n, 'Reply-To'));

echo "$ok bestanden\n";
foreach ($fehler as $f) { echo "  x $f\n"; }
exit($fehler ? 1 : 0);
