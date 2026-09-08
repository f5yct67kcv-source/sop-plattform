<?php
declare(strict_types=1);
// Demo-Anfrage von der oeffentlichen Homepage (ENT-469): Pruefung der
// Eingabe und Aufbau der Nachricht an den Betrieb.
//
// Reiner Rechenkern ohne Datenbank und ohne Netz -- dieselbe Trennung wie
// bei rundgang.php und planung.php: Was hier steht, laesst sich echt
// ausfuehren (pruefungen/pruef_demo_anfrage.php), der Endpunkt
// api/demo_anfrage.php verdrahtet nur noch.
//
// DREI FESTLEGUNGEN, die den Aufbau erklaeren:
//
//  1. NICHTS WIRD GESPEICHERT. Eine Anfrage ist eine E-Mail an den Betrieb,
//     kein Datensatz. Eine Tabelle braeuchte eine Einrichtung, eine
//     Oberflaeche und eine Aufbewahrungsregel -- fuer eine Kontaktanfrage
//     zu viel Software (Optimierungsziel: die kleinstmoegliche).
//
//  2. KEIN ZEILENUMBRUCH IN EINER KOPFZEILE. Firma, Name und Adresse landen
//     im Betreff und im Absenderblock; ein eingeschmuggeltes "\r\n" waere
//     dort eine zusaetzliche Kopfzeile (Header-Injection). Darum werden
//     Umbrueche aus diesen Feldern entfernt -- nur die Nachricht darf welche
//     tragen, und sie steht ausschliesslich im Rumpf.
//
//  3. EINE FALLE STATT EINES RAETSELS. Ein Feld, das Menschen nicht sehen
//     (per CSS ausserhalb des Bildschirms) und Skripte ausfuellen. Wer es
//     fuellt, bekommt dieselbe Antwort wie alle -- nur ohne Mail. Kein
//     Captcha: Es bremst genau die Interessenten, die die Seite gewinnen
//     soll, und braucht meist einen Dienst in den USA.

const DEMO_MAX_FIRMA     = 120;
const DEMO_MAX_NAME      = 120;
const DEMO_MAX_EMAIL     = 200;
const DEMO_MAX_NACHRICHT = 2000;
// Feste Liste wie im Formular -- eine andere Angabe wird nicht abgewiesen,
// sondern als "keine Angabe" behandelt: Die Groesse ist Zusatzinformation,
// keine Bedingung fuer ein Gespraech.
const DEMO_GROESSEN = ['bis 10', '11 – 30', '31 – 80', 'über 80'];
// Name des Fallenfelds. "website" ist absichtlich ein Feld, das ein Skript
// gern ausfuellt.
const DEMO_FALLE = 'website';
// Dieselbe Antwort fuer Mensch und Skript -- siehe Festlegung 3.
const DEMO_DANKE = 'Vielen Dank. Wir melden uns innert eines Arbeitstages.';

function demo_ist_falle(array $in): bool
{
    return trim((string)($in[DEMO_FALLE] ?? '')) !== '';
}

// Ein einzeiliges Feld: Umbrueche und Tabulatoren werden zu Leerzeichen,
// dann gekuerzt. Multibyte-sicher, damit ein Umlaut am Ende nicht zerrissen
// wird.
function demo_einzeilig(mixed $wert, int $max): string
{
    $s = preg_replace('/[\r\n\t]+/', ' ', (string)$wert) ?? '';
    return mb_substr(trim($s), 0, $max);
}

// Prueft und bereinigt die Eingabe. Gibt ['fehler' => [feld => text],
// 'werte' => [...]] zurueck; leeres 'fehler' heisst: annehmbar.
function demo_anfrage_pruefen(array $in): array
{
    $werte = [
        'firma'     => demo_einzeilig($in['firma'] ?? '', DEMO_MAX_FIRMA),
        'name'      => demo_einzeilig($in['name'] ?? '', DEMO_MAX_NAME),
        'email'     => demo_einzeilig($in['email'] ?? '', DEMO_MAX_EMAIL),
        'groesse'   => demo_einzeilig($in['groesse'] ?? '', 20),
        // Die Nachricht darf Umbrueche tragen -- sie steht nur im Rumpf.
        'nachricht' => mb_substr(trim(str_replace("\r\n", "\n", (string)($in['nachricht'] ?? ''))), 0, DEMO_MAX_NACHRICHT),
    ];
    $fehler = [];
    if ($werte['firma'] === '') {
        $fehler['firma'] = 'Bitte den Namen Ihres Betriebs angeben.';
    }
    if ($werte['name'] === '') {
        $fehler['name'] = 'Bitte Ihren Namen angeben.';
    }
    if ($werte['email'] === '' || filter_var($werte['email'], FILTER_VALIDATE_EMAIL) === false) {
        $fehler['email'] = 'Bitte eine gültige E-Mail-Adresse angeben.';
    }
    if (!in_array($werte['groesse'], DEMO_GROESSEN, true)) {
        $werte['groesse'] = '';
    }
    return ['fehler' => $fehler, 'werte' => $werte];
}

function demo_anfrage_betreff(array $w): string
{
    return 'Demo-Anfrage von ' . $w['firma'];
}

// Reintext -- der Teil, den jedes Postfach zeigt.
function demo_anfrage_text(array $w, string $eingang): string
{
    $zeile = fn(string $k, string $v): string => str_pad($k, 14) . $v . "\n";
    return "Neue Demo-Anfrage über die Homepage\n\n"
        . $zeile('Firma:', $w['firma'])
        . $zeile('Name:', $w['name'])
        . $zeile('E-Mail:', $w['email'])
        . $zeile('Mitarbeitende:', $w['groesse'] !== '' ? $w['groesse'] : 'keine Angabe')
        . $zeile('Eingegangen:', $eingang)
        . "\nNachricht:\n" . ($w['nachricht'] !== '' ? $w['nachricht'] : '(keine)') . "\n\n"
        . 'Antworten direkt an ' . $w['email'] . ".\n";
}

// HTML-Fassung. Jedes Element traegt seine eigene Schrift -- Outlook vererbt
// font-family nicht zuverlaessig (dieselbe Lehre wie in beleg_versenden.php,
// ENT-206).
function demo_anfrage_html(array $w, string $eingang): string
{
    $h = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $schrift = 'font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#14161A';
    $zeile = fn(string $k, string $v): string =>
        '<tr><td style="' . $schrift . ';padding:4px 16px 4px 0;color:#545B67;white-space:nowrap">' . $h($k) . '</td>'
        . '<td style="' . $schrift . ';padding:4px 0">' . $h($v) . '</td></tr>';
    return '<p style="' . $schrift . ';margin:0 0 12px"><strong>Neue Demo-Anfrage über die Homepage</strong></p>'
        . '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">'
        . $zeile('Firma', $w['firma'])
        . $zeile('Name', $w['name'])
        . $zeile('E-Mail', $w['email'])
        . $zeile('Mitarbeitende', $w['groesse'] !== '' ? $w['groesse'] : 'keine Angabe')
        . $zeile('Eingegangen', $eingang)
        . '</table>'
        . '<p style="' . $schrift . ';margin:16px 0 4px;color:#545B67">Nachricht</p>'
        . '<p style="' . $schrift . ';margin:0 0 16px;white-space:pre-wrap">' . ($w['nachricht'] !== '' ? $h($w['nachricht']) : '(keine)') . '</p>'
        . '<p style="' . $schrift . ';margin:0">Antworten direkt an <a href="mailto:' . $h($w['email']) . '" style="' . $schrift . '">' . $h($w['email']) . '</a>.</p>';
}
