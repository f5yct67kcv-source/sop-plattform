<?php
declare(strict_types=1);
// Die gemeinsame Gestaltung aller Mails, die im Namen der Betreiberin
// hinausgehen: Demo-Zugang heute, Offerten und Rechnungen spaeter
// (ENT-568/ENT-569).
//
// WARUM EINE VORLAGE UND NICHT JE EINE GESTALTUNG: Bis hierher baute jede
// Mail ihr HTML selbst, aus blossen <p>-Absaetzen ohne jede Gestaltung.
// Die erste Mail, die ein Interessent von GuardOpS ueberhaupt zu sehen
// bekommt, ist die mit seinen Zugangsdaten. Zwei getrennte Gestaltungen
// waeren beim naechsten Umbau schon auseinandergelaufen.
//
// TABELLEN UND INLINE-STYLES, kein <style>-Block und kein Flexbox-Raster:
// Mailprogramme entfernen Stylesheets im Kopf regelmaessig, und Outlook
// rendert bis heute ueber Word. Was hier nach veraltetem HTML aussieht,
// ist die Form, die in Mailprogrammen wirklich ankommt. Dieselbe
// Ueberlegung wie in der Oberflaeche gilt trotzdem: Beschriftung oben,
// Wert darunter (CLAUDE.md, Gestaltung).
//
// DAS LOGO STEHT IN DER SIGNATUR, EINGEBETTET (ENT-619). Nicht ueber eine
// externe Adresse: Outlook und die meisten Programme laden solche Bilder
// erst auf Erlaubnis, bis dahin stuende unter der Unterschrift ein leerer
// Rahmen. Eingebettet per Content-ID (multipart/related, siehe
// smtp_senden()) kommt es an -- derselbe Weg, den Outlook fuer seine
// eigenen Signaturen nimmt.
//
// KEIN BRIEFKOPF-BALKEN mehr darueber: Mit dem Logo unten stuende die
// Marke zweimal in derselben Mail, oben als getippter Schriftzug in einer
// Systemschrift, unten als echtes Logo. Eine Geschaeftsmail aus Outlook
// hat aus genau diesem Grund keinen Briefkopf, sondern Text und darunter
// die Signatur.

// Markenfarben, wie auf der oeffentlichen Seite (homepage.html).
const MAIL_FARBE_TEXT   = '#14161A';
const MAIL_FARBE_LEISE  = '#545B67';
const MAIL_FARBE_FLAECHE = '#F2F4F8';
const MAIL_FARBE_RAND   = '#E5E8EC';
const MAIL_FARBE_BLAU   = '#2F5BD7';

// Schriftfamilie ohne Webfont: Ein per @font-face nachgeladener Schnitt
// kommt in Mailprogrammen praktisch nie an. Die Wortmarke traegt darum
// dieselbe Systemschrift wie der Fliesstext.
const MAIL_LOGO_DATEI   = 'guardops-signatur.png';
const MAIL_LOGO_KENNUNG = 'guardops-logo';
// Angezeigt 130 px; die Datei ist 400 px breit -- gut das Dreifache,
// damit sie auch auf feinen Bildschirmen nicht ausfranst.
const MAIL_LOGO_BREITE  = 130;

const MAIL_SCHRIFT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function mail_e(string $w): string
{
    return htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
}

// Ein Feld im abgesetzten Block: Beschriftung oben, Wert darunter.
//
// Das Passwort bekommt eine gleichschrittige Schrift. In der Grundschrift
// sind grosses I, kleines l und die Eins kaum zu unterscheiden, ebenso
// Null und grosses O -- bei einem erzeugten Passwort, das jemand abtippt,
// ist das kein Schoenheitsfehler, sondern ein gescheiterter Anmeldeversuch.
function mail_feld(string $beschriftung, string $wert, bool $gleichschritt = false): string
{
    $schrift = $gleichschritt
        ? "font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.5px;"
        : '';
    return '<tr><td style="padding:0 0 14px 0;">'
        . '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;'
        . 'color:' . MAIL_FARBE_LEISE . ';padding-bottom:3px;">' . mail_e($beschriftung) . '</div>'
        . '<div style="font-size:16px;font-weight:600;color:' . MAIL_FARBE_TEXT . ';'
        . $schrift . '">' . $wert . '</div>'
        . '</td></tr>';
}

// Der abgesetzte Block, in dem die Felder stehen.
function mail_block(string $felder): string
{
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"'
        . ' style="background:' . MAIL_FARBE_FLAECHE . ';border:1px solid ' . MAIL_FARBE_RAND . ';'
        . 'border-radius:6px;margin:0 0 24px 0;"><tr><td style="padding:20px 20px 6px 20px;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
        . $felder . '</table></td></tr></table>';
}

function mail_absatz(string $html): string
{
    return '<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:'
        . MAIL_FARBE_TEXT . ';">' . $html . '</p>';
}

// Die Signatur kommt als fertige Zeilenliste herein und NICHT aus dieser
// Datei: Ein Personenname gehoert nicht ins Repository (Vertraulichkeits-
// regel in CLAUDE.md; im Impressum ist aus demselben Grund bewusst keiner
// eingetragen). Die Werte stehen im Deploy, gleiche Einordnung wie die
// Absenderkennung -- siehe mail_signatur_zeilen() in mailer.php.
//
// Ist dort nichts hinterlegt, zeichnet die Firma. Kein leerer Gruss und
// kein Platzhaltername, der bei einem Interessenten ankommt.
function mail_signatur(array $zeilen, string $bildKennung = ''): string
{
    $sichtbar = array_values(array_filter(array_map('trim', $zeilen), fn($z) => $z !== ''));
    if ($sichtbar === []) { $sichtbar = ['pzu consulting gmbh']; }

    $html = '<p style="margin:0 0 4px 0;font-size:15px;line-height:1.6;color:'
        . MAIL_FARBE_TEXT . ';">Mit freundlichen Grüssen</p>'
        . '<p style="margin:0;font-size:15px;line-height:1.5;color:' . MAIL_FARBE_TEXT . ';">'
        . '<b>' . mail_e(array_shift($sichtbar)) . '</b>';
    foreach ($sichtbar as $z) {
        $html .= '<br><span style="color:' . MAIL_FARBE_LEISE . ';">' . mail_e($z) . '</span>';
    }
    $html .= '</p>';
    if ($bildKennung !== '') {
        // Breite fest in Pixeln UND als Attribut: Outlook rechnet ueber
        // Word und ignoriert eine Breite, die nur im style steht -- das
        // Bild kaeme dort in seiner vollen Dateibreite an. Die Datei
        // traegt die doppelte Aufloesung, damit sie auf feinen
        // Bildschirmen nicht ausfranst.
        $html .= '<img src="cid:' . mail_e($bildKennung) . '" width="' . MAIL_LOGO_BREITE . '"'
            . ' alt="GuardOpS" style="display:block;border:0;width:' . MAIL_LOGO_BREITE . 'px;'
            . 'max-width:' . MAIL_LOGO_BREITE . 'px;height:auto;margin-top:14px;">';
    }
    return $html;
}

// Das Logo fuer die Signatur, als Rohbytes fuer smtp_senden(). Liegt neben
// dieser Datei, weil der Deploy flach in den Buendelordner kopiert.
//
// Fehlt die Datei, gibt es kein Bild und die Signatur bleibt rein
// textlich -- eine fehlende Bilddatei darf keine Mail verhindern.
function mail_logo(): ?array
{
    $pfad = __DIR__ . '/' . MAIL_LOGO_DATEI;
    if (!is_file($pfad)) { return null; }
    $inhalt = @file_get_contents($pfad);
    if ($inhalt === false || $inhalt === '') { return null; }
    return ['cid' => MAIL_LOGO_KENNUNG, 'mime' => 'image/png', 'inhalt' => $inhalt];
}

// Der Rahmen um alles: Kopf mit der Wortmarke, Inhalt, Fuss mit den
// Angaben der Betreiberin. Die Angaben im Fuss stehen fest -- sie sind
// oeffentlich und stehen wortgleich im Impressum (ENT-563).
function mail_rahmen(string $inhalt): string
{
    $fuss = '<tr><td style="padding:0 28px 28px 28px;">'
        . '<div style="border-top:1px solid ' . MAIL_FARBE_RAND . ';padding-top:16px;'
        . 'font-size:12px;line-height:1.6;color:' . MAIL_FARBE_LEISE . ';">'
        . 'pzu consulting gmbh &middot; Hochgasse 7 &middot; 4632 Trimbach<br>'
        . '<a href="mailto:info@guardops.ch" style="color:' . MAIL_FARBE_BLAU
        . ';text-decoration:none;">info@guardops.ch</a>'
        . ' &middot; '
        . '<a href="https://guardops.ch" style="color:' . MAIL_FARBE_BLAU
        . ';text-decoration:none;">guardops.ch</a>'
        . '</div></td></tr>';

    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"'
        . ' style="background:#FFFFFF;margin:0;padding:0;">'
        . '<tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"'
        . ' style="max-width:600px;width:100%;border:1px solid ' . MAIL_FARBE_RAND . ';'
        . 'border-radius:8px;overflow:hidden;font-family:' . MAIL_SCHRIFT . ';">'
        . '<tr><td style="padding:28px 28px 8px 28px;">' . $inhalt . '</td></tr>'
        . $fuss
        . '</table></td></tr></table>';
}
