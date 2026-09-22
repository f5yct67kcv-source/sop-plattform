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
// DAS LOGO STEHT IN DER SIGNATUR, EINGEBETTET (ENT-651). Nicht ueber eine
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

// Dieselbe Palette fuer den Dunkelmodus (homepage.html fuehrt #7098F7 als
// das hellere Blau). Gilt nur dort, wo das Mailprogramm
// prefers-color-scheme auswertet -- siehe mail_rahmen().
const MAIL_DUNKEL_GRUND   = '#1C1F24';
const MAIL_DUNKEL_TEXT    = '#E5E8EC';
const MAIL_DUNKEL_LEISE   = '#9BA3AF';
const MAIL_DUNKEL_FLAECHE = '#24282E';
const MAIL_DUNKEL_RAND    = '#343A42';
const MAIL_DUNKEL_BLAU    = '#7098F7';

// Schriftfamilie ohne Webfont: Ein per @font-face nachgeladener Schnitt
// kommt in Mailprogrammen praktisch nie an. Die Wortmarke traegt darum
// dieselbe Systemschrift wie der Fliesstext.
const MAIL_LOGO_DATEI   = 'guardops-signatur.png';
const MAIL_LOGO_KENNUNG = 'guardops-logo';
// Zweite Fassung fuer den Dunkelmodus. Ein Mailprogramm faerbt Text und
// Flaechen um, ein Bild aber nicht -- das dunkle Logo stuende dort fast
// unsichtbar auf dunklem Grund. Genau so kam es beim Projektinhaber an
// (2026-09-19).
const MAIL_LOGO_DATEI_HELL   = 'guardops-signatur-hell.png';
const MAIL_LOGO_KENNUNG_HELL = 'guardops-logo-hell';
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
//
// $kompakt fuer einen Block, der nur ein paar kurze Angaben traegt
// (ENT-674): Nummer, Datum, Frist brauchen nicht dieselbe Flaeche wie
// Zugangsdaten, die jemand abliest und abtippt. Gleiche Gestaltung, engere
// Abstaende -- KEINE zweite Bauart. Der Zugangsblock der Demo-Mail bleibt
// bewusst geraeumig; dort ist der Wert die Sache selbst.
function mail_feld(string $beschriftung, string $wert, bool $gleichschritt = false,
                   bool $kompakt = false): string
{
    $schrift = $gleichschritt
        ? "font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.5px;"
        : '';
    return '<tr><td style="padding:0 0 ' . ($kompakt ? 12 : 16) . 'px 0;">'
        . '<div class="d-leise" style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;'
        . 'color:' . MAIL_FARBE_LEISE . ';padding-bottom:4px;">' . mail_e($beschriftung) . '</div>'
        . '<div class="d-text" style="font-size:' . ($kompakt ? 15 : 16) . 'px;font-weight:600;color:'
        . MAIL_FARBE_TEXT . ';' . $schrift . '">' . $wert . '</div>'
        . '</td></tr>';
}

// Der abgesetzte Block, in dem die Felder stehen.
function mail_block(string $felder, bool $kompakt = false): string
{
    $luft = $kompakt ? '18px 20px 8px 20px' : '24px 22px 10px 22px';
    return '<table role="presentation" class="d-flaeche" cellpadding="0" cellspacing="0" border="0" width="100%"'
        . ' style="background:' . MAIL_FARBE_FLAECHE . ';border:1px solid ' . MAIL_FARBE_RAND . ';'
        . 'border-radius:6px;margin:4px 0 ' . ($kompakt ? 26 : 30) . 'px 0;"><tr><td style="padding:' . $luft . ';">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
        . $felder . '</table></td></tr></table>';
}

function mail_absatz(string $html): string
{
    return '<p class="d-text" style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:'
        . MAIL_FARBE_TEXT . ';">' . $html . '</p>';
}

// Ein Knopf in der Mail (ENT-624). Erste Mail, die einen braucht: Der
// Bestaetigungslink soll man treffen koennen, auch mit dem Daumen.
//
// ALS TABELLE, NICHT ALS GESTALTETES <a>: Outlook rendert ueber Word und
// gibt einem <a> weder Innenabstand noch Hintergrund zuverlaessig. Eine
// einzelne Tabellenzelle mit Hintergrundfarbe kommt ueberall an.
//
// DIE ADRESSE STEHT ZUSAETZLICH ALS TEXT DARUNTER. Ein Mailprogramm, das
// Knoepfe verschluckt oder Bilder blockt, laesst den Empfaenger sonst vor
// einer Mail ohne Weiterweg sitzen -- und die reine Textfassung hat den
// Knopf ohnehin nie.
function mail_knopf(string $beschriftung, string $ziel, bool $ersatzlink = true): string
{
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"'
        . ' style="margin:6px 0 26px 0;"><tr>'
        . '<td style="background:' . MAIL_FARBE_BLAU . ';border-radius:6px;">'
        . '<a href="' . mail_e($ziel) . '" style="display:inline-block;'
        . 'padding:13px 24px;font-size:15px;font-weight:600;line-height:1.2;'
        . 'color:#FFFFFF;text-decoration:none;">' . mail_e($beschriftung) . '</a>'
        . '</td></tr></table>'
        . ($ersatzlink ? mail_ersatzlink($ziel) : '');
}

// Die Adresse in Klarschrift unter dem Knopf -- die Notloesung fuer ein
// Mailprogramm, das den Knopf verschluckt.
//
// SIE IST NICHT IMMER NOETIG (Befund des Projektinhabers, 2026-09-22:
// optisch stoerend, und andere Anbieter fuehren sie nicht). Jede Mail geht
// als HTML UND als reiner Text hinaus, und die Textfassung traegt die
// Adresse ohnehin; der Knopf selbst ist ein gewoehnlicher Verweis, kein
// Bild und kein Skript. Weglassen darf sie darum, wer eine gewoehnliche
// Geschaeftsmail schreibt -- beleg_mail() tut das.
//
// WO SIE BLEIBT: bei der Bestaetigungsmail zum Demo-Zugang. Dort haengt
// der ganze Vorgang an genau einem Klick innerhalb einer Frist, und wer
// dort nicht weiterkommt, hat keinen zweiten Weg.
//
// Sie tritt zurueck: kleiner als der Fliesstext, leise, ohne Betonung.
function mail_ersatzlink(string $ziel): string
{
    return '<p class="d-leise" style="margin:0 0 24px 0;font-size:11px;line-height:1.55;'
        . 'color:' . MAIL_FARBE_LEISE . ';">Falls der Knopf nicht funktioniert, '
        . 'kopieren Sie diese Adresse in Ihren Browser:<br>'
        . '<span style="word-break:break-all;opacity:0.8;">' . mail_e($ziel) . '</span></p>';
}

// Die Signatur kommt als fertige Zeilenliste herein und NICHT aus dieser
// Datei: Ein Personenname gehoert nicht ins Repository (Vertraulichkeits-
// regel in CLAUDE.md; im Impressum ist aus demselben Grund bewusst keiner
// eingetragen). Die Werte stehen im Deploy, gleiche Einordnung wie die
// Absenderkennung -- siehe mail_signatur_zeilen() in mailer.php.
//
// Ist dort nichts hinterlegt, zeichnet die Firma. Kein leerer Gruss und
// kein Platzhaltername, der bei einem Interessenten ankommt.
function mail_signatur(array $zeilen, string $bildKennung = '',
                       string $bildKennungHell = ''): string
{
    $sichtbar = array_values(array_filter(array_map('trim', $zeilen), fn($z) => $z !== ''));
    if ($sichtbar === []) { $sichtbar = ['pzu consulting gmbh']; }

    $html = '<p class="d-text" style="margin:8px 0 6px 0;font-size:15px;line-height:1.6;color:'
        . MAIL_FARBE_TEXT . ';">Mit freundlichen Grüssen</p>'
        . '<p class="d-text" style="margin:0;font-size:15px;line-height:1.5;color:'
        . MAIL_FARBE_TEXT . ';">'
        . '<b>' . mail_e(array_shift($sichtbar)) . '</b>';
    foreach ($sichtbar as $z) {
        $inhalt = mail_e($z);
        $tel = mail_telefon_ziel($z);
        if ($tel !== '') {
            $inhalt = '<a class="d-leise" href="tel:' . mail_e($tel) . '" style="color:'
                . MAIL_FARBE_LEISE . ';text-decoration:none;">' . $inhalt . '</a>';
        }
        $html .= '<br><span class="d-leise" style="color:' . MAIL_FARBE_LEISE . ';">'
            . $inhalt . '</span>';
    }
    $html .= '</p>';
    if ($bildKennung !== '') {
        $html .= mail_logo_bild($bildKennung, false);
    }
    if ($bildKennungHell !== '') {
        // Die helle Fassung steht zunaechst auf display:none und wird erst
        // im Dunkelmodus eingeblendet (siehe mail_rahmen()). Entfernt ein
        // Mailprogramm den Style-Block, bleibt sie unsichtbar und die
        // dunkle Fassung steht da -- der richtige Rueckfall, denn ein
        // Programm ohne Style-Block faerbt in aller Regel auch nicht um.
        $html .= mail_logo_bild($bildKennungHell, true);
    }
    return $html;
}

/**
 * Erkennt, ob eine Signaturzeile eine Telefonnummer ist, und gibt das Ziel
 * fuer einen tel:-Verweis zurueck ('' wenn die Zeile keine Nummer ist).
 *
 * Hintergrund: Apple Mail und iOS Mail erkennen Telefonnummern im Fliesstext
 * selbst und machen daraus einen Waehl-Verweis -- in ihrer eigenen Farbe und
 * unterstrichen, quer zur uebrigen Signatur. Wer den Verweis selbst setzt,
 * behaelt die Gestaltung, und die Nummer bleibt antippbar. Befund des
 * Projektinhabers am 2026-09-19 an der echten Mail.
 */
function mail_telefon_ziel(string $zeile): string
{
    $zeile = trim($zeile);
    // Eine optionale Beschriftung davor ('Tel.', 'Mobil:', 'T') wird
    // mitgelesen, aber nicht ins Waehlziel uebernommen.
    if (!preg_match('/^(?:(?:Tel|Telefon|Mobile?|Mob|Fon|T|M)\.?\s*:?\s*)?'
            . '(\+?[0-9][0-9\s.\/()-]{7,}[0-9])$/u', $zeile, $treffer)) {
        return '';
    }
    $ziffern = (string)preg_replace('/[^0-9]/', '', $treffer[1]);
    // Kuerzer als neun Ziffern ist keine Rufnummer, laenger als fuenfzehn
    // gibt es nach E.164 nicht -- beides deutet auf etwas anderes hin.
    if (strlen($ziffern) < 9 || strlen($ziffern) > 15) { return ''; }
    return (str_starts_with($treffer[1], '+') ? '+' : '') . $ziffern;
}

// Ein Logo-Bild in der Signatur.
//
// Breite fest in Pixeln UND als Attribut: Outlook rechnet ueber Word und
// ignoriert eine Breite, die nur im style steht -- das Bild kaeme dort in
// seiner vollen Dateibreite an. Die Datei traegt gut die dreifache
// Aufloesung, damit sie auf feinen Bildschirmen nicht ausfranst.
function mail_logo_bild(string $kennung, bool $fuerDunkelmodus): string
{
    return '<img src="cid:' . mail_e($kennung) . '" width="' . MAIL_LOGO_BREITE . '"'
        . ' alt="GuardOpS" class="' . ($fuerDunkelmodus ? 'logo-hell' : 'logo-dunkel') . '"'
        . ' style="display:' . ($fuerDunkelmodus ? 'none' : 'block') . ';border:0;'
        . 'width:' . MAIL_LOGO_BREITE . 'px;max-width:' . MAIL_LOGO_BREITE . 'px;'
        . 'height:auto;margin-top:22px;">';
}

// Das Logo fuer die Signatur, als Rohbytes fuer smtp_senden(). Liegt neben
// dieser Datei, weil der Deploy flach in den Buendelordner kopiert.
//
// Fehlt die Datei, gibt es kein Bild und die Signatur bleibt rein
// textlich -- eine fehlende Bilddatei darf keine Mail verhindern.
function mail_logo(): ?array
{
    return mail_bild_lesen(MAIL_LOGO_DATEI, MAIL_LOGO_KENNUNG);
}

// Die helle Fassung fuer den Dunkelmodus. Fehlt sie, bleibt es bei der
// dunklen allein -- dann ist das Logo im Dunkelmodus schwach sichtbar,
// aber die Mail ist vollstaendig.
function mail_logo_hell(): ?array
{
    return mail_bild_lesen(MAIL_LOGO_DATEI_HELL, MAIL_LOGO_KENNUNG_HELL);
}

function mail_bild_lesen(string $datei, string $kennung): ?array
{
    $pfad = __DIR__ . '/' . $datei;
    if (!is_file($pfad)) { return null; }
    $inhalt = @file_get_contents($pfad);
    if ($inhalt === false || $inhalt === '') { return null; }
    return ['cid' => $kennung, 'mime' => 'image/png', 'inhalt' => $inhalt];
}

// Der Rahmen um alles: Kopf mit der Wortmarke, Inhalt, Fuss mit den
// Angaben der Betreiberin. Die Angaben im Fuss stehen fest -- sie sind
// oeffentlich und stehen wortgleich im Impressum (ENT-563).
function mail_rahmen(string $inhalt): string
{
    // Mehr Luft nach unten als zuvor: Logo, Trennlinie und Fussangaben
    // standen zu dicht aufeinander (Befund des Projektinhabers am
    // 2026-09-19 an der echten Mail).
    $fuss = '<tr><td style="padding:0 32px 34px 32px;">'
        . '<div class="d-rand d-leise" style="border-top:1px solid ' . MAIL_FARBE_RAND . ';'
        . 'padding-top:24px;font-size:12px;line-height:1.7;color:' . MAIL_FARBE_LEISE . ';">'
        . 'pzu consulting gmbh &middot; Hochgasse 7 &middot; 4632 Trimbach<br>'
        . '<a class="d-blau" href="mailto:info@guardops.ch" style="color:' . MAIL_FARBE_BLAU
        . ';text-decoration:none;">info@guardops.ch</a>'
        . ' &middot; '
        . '<a class="d-blau" href="https://guardops.ch" style="color:' . MAIL_FARBE_BLAU
        . ';text-decoration:none;">guardops.ch</a>'
        . '</div></td></tr>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        // Sagt dem Mailprogramm, dass diese Nachricht beide Darstellungen
        // selbst mitbringt. Ohne das faerben manche Programme auf eigene
        // Faust um -- und treffen dabei den Text, aber nie ein Bild.
        . '<meta name="color-scheme" content="light dark">'
        . '<meta name="supported-color-schemes" content="light dark">'
        . '<style>' . mail_datenerkennung() . mail_dunkelmodus() . '</style></head>'
        . '<body style="margin:0;padding:0;">'
        . '<table role="presentation" class="d-grund" cellpadding="0" cellspacing="0" border="0"'
        . ' width="100%" style="background:#FFFFFF;margin:0;padding:0;">'
        . '<tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" class="d-karte" cellpadding="0" cellspacing="0" border="0"'
        . ' width="600" style="max-width:600px;width:100%;background:#FFFFFF;'
        . 'border:1px solid ' . MAIL_FARBE_RAND . ';'
        . 'border-radius:8px;overflow:hidden;font-family:' . MAIL_SCHRIFT . ';">'
        . '<tr><td style="padding:36px 32px 30px 32px;">' . $inhalt . '</td></tr>'
        . $fuss
        . '</table></td></tr></table></body></html>';
}

// Die Regeln fuer den Dunkelmodus.
//
// DER EINZIGE STYLE-BLOCK DIESER VORLAGE, und er darf verlorengehen: Wo
// ein Mailprogramm ihn entfernt (Gmail zum Beispiel), bleibt alles so
// hell wie ohne ihn -- die Inline-Styles tragen die Gestaltung weiter.
// Wo er ankommt (Apple Mail, iOS Mail, Outlook auf dem Mac), traegt er
// genau das nach, was ein Programm sonst selbst zusammenreimt: Text und
// Flaechen passen zusammen, und das Logo wird gegen die helle Fassung
// getauscht statt dunkel auf dunkel zu verschwinden.
//
// !important ueberall, weil Inline-Styles sonst Vorrang haben.
function mail_dunkelmodus(): string
{
    return '@media (prefers-color-scheme: dark) {'
        . '.d-grund { background:' . MAIL_DUNKEL_GRUND . ' !important; }'
        . '.d-karte { background:' . MAIL_DUNKEL_GRUND . ' !important;'
        . ' border-color:' . MAIL_DUNKEL_RAND . ' !important; }'
        . '.d-flaeche { background:' . MAIL_DUNKEL_FLAECHE . ' !important;'
        . ' border-color:' . MAIL_DUNKEL_RAND . ' !important; }'
        . '.d-text { color:' . MAIL_DUNKEL_TEXT . ' !important; }'
        . '.d-leise { color:' . MAIL_DUNKEL_LEISE . ' !important; }'
        . '.d-rand { border-color:' . MAIL_DUNKEL_RAND . ' !important; }'
        . '.d-blau, .d-blau a { color:' . MAIL_DUNKEL_BLAU . ' !important; }'
        . '.logo-dunkel { display:none !important; }'
        . '.logo-hell { display:block !important; }'
        . '}';
}

/**
 * Nimmt dem Mailprogramm die Hoheit ueber das, was es selbst als Telefonnummer,
 * Datum oder Adresse erkennt. Apple Mail faerbt solche Fundstellen sonst blau
 * und unterstreicht sie -- auch mitten in einer bewusst grauen Signatur.
 * Was wir selbst verlinken, ist davon nicht betroffen; die Regel faengt den
 * Rest ab, etwa eine Ortsangabe im Fuss.
 */
function mail_datenerkennung(): string
{
    return 'a[x-apple-data-detectors] {'
        . ' color: inherit !important;'
        . ' text-decoration: none !important;'
        . ' font-size: inherit !important;'
        . ' font-family: inherit !important;'
        . ' font-weight: inherit !important;'
        . ' line-height: inherit !important;'
        . ' }';
}

