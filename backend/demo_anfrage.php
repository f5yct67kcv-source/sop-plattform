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
const DEMO_MAX_TELEFON   = 40;
const DEMO_MAX_NACHRICHT = 2000;
// Telefon: Schreibweisen bleiben frei (+41 79 123 45 67, 079/123 45 67 und
// 0041791234567 sind dieselbe Nummer), die FORM wird aber geprueft -- neun
// beliebige Ziffern sind keine Telefonnummer. Wie eine gueltige Nummer
// aussieht, steht bei demo_telefon_gueltig() weiter unten.
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

// Ist das eine Nummer, unter der jemand erreichbar ist? Ziffern zaehlen
// allein reichte nicht: "123456789" ging bis 2026-09-18 durch.
//
// DIESELBE REGEL WIE BEIM DEMO-ZUGANG (demo_zugang_telefon_gueltig() in
// demo_zugang.php -- die beiden Dateien sind bewusst getrennt, siehe den
// Kommentar dort). Zugelassen sind Schweiz, Deutschland und Oesterreich
// (Entscheidung des Projektinhabers, 2026-09-18); ohne Landesvorwahl gilt
// die Schweiz, weil eine fuehrende Null in allen drei Laendern dieselbe
// Ziffer ist. Die Begruendung zu den Laengen steht bei der Schwester-
// funktion.
function demo_telefon_gueltig(string $wert): bool
{
    $roh = (string)preg_replace('/[\s\/\-\.\(\)]+/u', '', $wert);
    $muster = [
        '/^(?:\+41|0041)[2-9]\d{8}$/',   // Schweiz, international
        '/^(?:\+49|0049)[1-9]\d{5,12}$/', // Deutschland
        '/^(?:\+43|0043)[1-9]\d{3,12}$/', // Oesterreich
        '/^0[2-9]\d{8}$/',               // Schweiz, national
    ];
    foreach ($muster as $m) {
        if (preg_match($m, $roh) === 1) {
            return true;
        }
    }
    return false;
}

// Prueft und bereinigt die Eingabe. Gibt ['fehler' => [feld => text],
// 'werte' => [...]] zurueck; leeres 'fehler' heisst: annehmbar.
function demo_anfrage_pruefen(array $in): array
{
    $werte = [
        'firma'     => demo_einzeilig($in['firma'] ?? '', DEMO_MAX_FIRMA),
        'name'      => demo_einzeilig($in['name'] ?? '', DEMO_MAX_NAME),
        'email'     => demo_einzeilig($in['email'] ?? '', DEMO_MAX_EMAIL),
        'telefon'   => demo_einzeilig($in['telefon'] ?? '', DEMO_MAX_TELEFON),
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
    if (!demo_telefon_gueltig($werte['telefon'])) {
        // "Fehlt" und "so geschrieben ergibt das keine Nummer" sind zwei
        // verschiedene Aussagen und bekommen zwei verschiedene Texte.
        $fehler['telefon'] = $werte['telefon'] === ''
            ? 'Bitte eine Telefonnummer angeben, unter der wir Sie erreichen.'
            : 'Bitte eine Telefonnummer aus der Schweiz, Deutschland oder Österreich angeben — mit Landesvorwahl, z. B. +41 79 123 45 67.';
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
        . $zeile('Telefon:', $w['telefon'])
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
        . $zeile('Telefon', $w['telefon'])
        . $zeile('Mitarbeitende', $w['groesse'] !== '' ? $w['groesse'] : 'keine Angabe')
        . $zeile('Eingegangen', $eingang)
        . '</table>'
        . '<p style="' . $schrift . ';margin:16px 0 4px;color:#545B67">Nachricht</p>'
        . '<p style="' . $schrift . ';margin:0 0 16px;white-space:pre-wrap">' . ($w['nachricht'] !== '' ? $h($w['nachricht']) : '(keine)') . '</p>'
        . '<p style="' . $schrift . ';margin:0">Antworten direkt an <a href="mailto:' . $h($w['email']) . '" style="' . $schrift . '">' . $h($w['email']) . '</a>.</p>';
}

// ── Der Empfaenger (seit der eigenen Domain) ──────────────────────────
//
// Bis hierher stand er in der Datenbank (betrieb.email, ENT-247). Seit die
// Homepage auf guardops.ch liegt, gibt es dort keine -- und der Empfaenger
// kommt aus dem Deploy, genau wie die eigene Adresse in basis_url()
// (ENT-501). Dieselbe Regel, derselbe Aufbau: eine reine Pruefung, die sich
// ohne Netz und ohne Datei ausfuehren laesst, und ein duenner Aufrufer
// darueber, der den vom Deploy ersetzten Platzhalter hineinreicht.
//
// EIN NICHT ERSETZTER PLATZHALTER IST "NICHT EINGERICHTET", NICHT "LEER":
// Beides gibt hier null, und der Endpunkt sagt dazu ausdruecklich 503
// "noch nicht eingerichtet" statt "fehlgeschlagen" -- ein Interessent soll
// es nicht "spaeter noch einmal" versuchen, wenn es nie gehen kann.
function demo_empfaenger_pruefen(string $wert): ?string
{
    $wert = trim($wert);
    if ($wert === '' || str_contains($wert, '__DEMO_EMPFAENGER')) { return null; }
    // Kein Steuerzeichen und kein Umbruch: Die Adresse steht in einer
    // Kopfzeile (siehe Festlegung 2 oben).
    if (preg_match('/[\x00-\x20\x7F]/', $wert)) { return null; }
    if (filter_var($wert, FILTER_VALIDATE_EMAIL) === false) { return null; }
    return $wert;
}

function demo_empfaenger(): ?string
{
    return demo_empfaenger_pruefen('__DEMO_EMPFAENGER__');
}

// ── Gibt es die angegebene Adresse ueberhaupt? ────────────────────────
//
// ANLASS: Der Projektinhaber hat am 2026-09-14 absichtlich "info@test.cha"
// eingegeben, und die Anfrage ging durch. FILTER_VALIDATE_EMAIL prueft nur
// die SCHREIBWEISE, und die ist dort tadellos -- es gibt die Endung ".cha"
// bloss nicht. Wer sich vertippt, wartet danach vergeblich auf Antwort, und
// wir halten eine Anfrage in der Hand, die sich nicht beantworten laesst.
//
// DREI ZUSTAENDE, NICHT ZWEI -- der Grund fuer die Kontrolldomain:
// checkdnsrr() liefert false sowohl fuer „diese Domain gibt es nicht" als
// auch fuer „der Namensdienst antwortet gerade nicht". Das zweite als das
// erste zu melden hiesse, einem Interessenten zu sagen, seine Adresse sei
// falsch, obwohl wir es gar nicht wissen -- genau der Fehler, den die Regel
// „unbekannt darf nie wie keine aussehen" meint. Darum wird bei einem
// Fehlschlag zusaetzlich eine Domain nachgeschlagen, von der wir wissen,
// dass es sie gibt. Faellt die auch durch, liegt es am Namensdienst: dann
// gilt die Adresse als nicht pruefbar (null) und wird DURCHGELASSEN.
//
// Die Kontrolle laeuft nur im Fehlerfall -- der Normalfall kostet einen
// einzigen, meist zwischengespeicherten Nachschlag.
const DEMO_KONTROLL_DOMAIN = 'guardops.ch';

function demo_domain(string $email): string
{
    $pos = strrpos($email, '@');
    return $pos === false ? '' : substr($email, $pos + 1);
}

// Ein Mailserver gilt als vorhanden, wenn es einen MX-Eintrag gibt -- oder,
// wie RFC 5321 es zulaesst, ersatzweise einen A/AAAA-Eintrag, der dann
// implizit als Mailziel dient. Fehlt die Funktion (abgeschaltet auf manchen
// Hostpaketen), wird nichts behauptet: siehe Aufrufer.
function demo_hat_mailserver(string $domain): bool
{
    return checkdnsrr($domain, 'MX')
        || checkdnsrr($domain, 'A')
        || checkdnsrr($domain, 'AAAA');
}

// true = zustellbar, false = diese Domain gibt es nicht,
// null = nicht pruefbar (Namensdienst gestoert oder abgeschaltet).
// $nachschlag ist einspeisbar, damit sich alle drei Faelle ohne Netz pruefen
// lassen -- dieselbe Bauart wie die einspeisbare Zeit in demo_bremse.php.
function demo_adresse_zustellbar(string $email, ?callable $nachschlag = null): ?bool
{
    if ($nachschlag === null) {
        if (!function_exists('checkdnsrr')) { return null; }
        $nachschlag = 'demo_hat_mailserver';
    }
    $domain = demo_domain($email);
    if ($domain === '') { return false; }
    if ($nachschlag($domain)) { return true; }
    return $nachschlag(DEMO_KONTROLL_DOMAIN) ? false : null;
}
