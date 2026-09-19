<?php
declare(strict_types=1);
// ist_produktion() fuer den Staging-Mailmodus (ENT-341) -- require_once,
// nicht require: beide Aufrufer dieser Datei binden db.php bereits vor
// mailer.php ein, ein zweites Laden waere sonst ein harter Abbruch am
// Ausnahmehandler vorbei (derselbe Fallstrick wie in planung_einrichten.php
// dokumentiert).
require_once __DIR__ . '/db.php';

// Minimaler SMTP-Client fuer den Offert-Versand (ENT-192).
//
// Bewusst OHNE Bibliothek (PHPMailer o.ae.): Der Deploy kopiert einzelne
// PHP-Dateien per FTP, es gibt kein Composer und keinen Build-Schritt (siehe
// .github/workflows/deploy-hostpoint.yml). Eine Bibliothek haette Dutzende
// bis Hunderte Dateien mitgebracht, die derselbe Weg haette kopieren muessen.
// Was hier gebraucht wird -- eine Nachricht ueber den Hostpoint-eigenen
// SMTP-Server verschicken -- ist mit PHPs eigenen Stream-Funktionen in ein
// paar Dutzend Zeilen zu haben.
//
// Platzhalter werden beim Deploy durch GitHub Actions aus GitHub Secrets
// ersetzt (gleiches Muster wie db.php/ai.php) -- diese Datei enthaelt nie
// echte Zugangsdaten.
//
// KEIN FREMDER PLATZHALTERNAME IN DIESER DATEI, auch nicht in einem
// Kommentar: Sie geht seit ENT-563 nach guardops.ch mit, und der Bau des
// dortigen Buendels weist jeden Platzhalter ab, der dort nicht ersetzt wird.
// Eine blosse Erwaehnung von "__ANTHROPIC" + "_API_KEY__" in einem Kommentar
// hat den Deploy-Lauf 474 rot gefaerbt. test_deploy.mjs prueft das seither
// hier, statt es dem Runner zu ueberlassen.

// Bewusst nur auf leeren String pruefen -- wie beim Anthropic-Schluessel in
// ai.php --, NICHT zusaetzlich per str_contains() gegen den Platzhaltertext
// selbst. Der Deploy-sed ersetzt JEDES Vorkommen von z.B. "__SMTP_HOST__" in
// der Datei -- auch eines, das nur als Vergleichstext dienen sollte. Ein
// frueherer Versuch genau das zu tun verglich den echten Wert am Ende mit
// sich selbst (ein String enthaelt sich immer selbst) und loeste dadurch
// dieselbe Stelle immer falsch aus, egal welcher Wert im Secret stand
// (ENT-192, gefunden beim ersten echten Testversand). Betraf drei Stellen in
// dieser Datei -- deshalb hier zentral dokumentiert.
function smtp_konfiguriert(): bool
{
    $host = '__SMTP_HOST__';
    return $host !== '';
}

function smtp_absender_adresse(): string
{
    return '__SMTP_ABSENDER__';
}

// Die Zeilen der persoenlichen Signatur unter Mails der Betreiberin --
// Name, Funktion, Telefon (ENT-569, Nachtrag 2026-09-18).
//
// AUS DEM DEPLOY, NICHT AUS DEM QUELLTEXT, und zwar nicht aus Geheimhaltung:
// Ein Personenname gehoert nicht ins Repository (Vertraulichkeitsregel in
// CLAUDE.md). Im Impressum steht aus genau demselben Grund bewusst keiner.
// Gleiche Einordnung wie die Absenderkennung eine Funktion darueber.
//
// EIN Platzhalter statt dreier, mit Strichpunkt getrennt: Der Schritt, der
// im Deploy die Werte setzt, steht bereits dicht an GitHubs Groessengrenze
// fuer einen run-Block. Drei eigene Werte haetten ihn ueber die Grenze
// geschoben, und ein zu grosser Block wird komplett abgewiesen.
//
// Leer ist ein zulaessiger Zustand: Dann zeichnet die Firma (siehe
// mail_signatur() in mail_vorlage.php). Nie ein Platzhaltername.
function mail_signatur_zeilen(): array
{
    $roh = '__MAIL_SIGNATUR__';
    if ($roh === '') { return []; }
    return array_values(array_filter(array_map('trim', explode(';', $roh)), fn($z) => $z !== ''));
}

// Wort nach RFC 2047 kodieren, falls es Nicht-ASCII enthaelt (Umlaute in
// Firmennamen oder Betreffzeilen). Reines ASCII bleibt unveraendert, damit
// ein einfacher Betreff nicht unnoetig kodiert im Postfach auftaucht.
function smtp_kopf_kodieren(string $text): string
{
    if ($text === '' || mb_check_encoding($text, 'ASCII')) {
        return $text;
    }
    return '=?UTF-8?B?' . base64_encode($text) . '?=';
}

// Ist dieser Wert noch der unveraenderte Platzhalter (Secret nicht gesetzt
// oder die sed-Zeile im Deploy-Workflow fehlt)? Eigene, reine Funktion statt
// eines Inline-Vergleichs, damit sich auch der „bereits konfiguriert"-Fall
// mit einem frei gewaehlten Testwert pruefen laesst -- nicht nur der eine
// Zustand, der in dieser Umgebung tatsaechlich erreichbar ist.
//
// $ohneSchlussstriche MUSS ohne den abschliessenden doppelten Unterstrich
// uebergeben werden: Der Deploy-sed ersetzt nur exakte Treffer auf
// z. B. "__STAGING_TESTMAIL__", und ein Vergleichsziel mit demselben
// abschliessenden Doppel-Unterstrich wuerde vom selben sed mitgetroffen --
// genau der ENT-192-Fehler (siehe Kommentar zu smtp_konfiguriert() oben).
function platzhalter_offen(string $wert, string $ohneSchlussstriche): bool
{
    return $wert === '' || str_contains($wert, $ohneSchlussstriche);
}

// Staging-/Demo-Mailmodus (ENT-341, um die Demo-Umgebung erweitert mit
// ENT-523). Eine reine Funktion ohne Netzwerk- oder $_SERVER-Zugriff --
// damit sich die Umleitung fuer sich pruefen laesst, ohne einen Socket zu
// oeffnen (gleiche Ueberlegung wie bei sitzung_abgelaufen() in db.php).
//
// Ausserhalb der Produktion wird IMMER auf eine konfigurierte Testadresse
// umgeleitet, unabhaengig vom eingegebenen Empfaenger. Demo bekommt eine
// EIGENE Testadresse (DEMO_TESTMAIL) statt der Staging-Adresse -- kein
// stiller Rueckfall ueber "nicht produktion" auf STAGING_TESTMAIL, aus
// demselben Grund wie die eigenen Secret-NAMEN im Deploy-Workflow: eine
// Demo-Mail, die zufaellig im Staging-Testpostfach landet, waere dort
// nicht mehr auffindbar.
//
// WICHTIG (ENT-523, Vorentscheidung fuer Stufe 3): Der Projektinhaber hat
// sich fuer eine ALLOWLIST entschieden -- die spaetere Einladung an einen
// freigegebenen Interessenten soll seine ECHTE Adresse erreichen, nicht
// diese Testadresse. Diese Funktion baut das noch nicht: Es gibt noch
// keine Tabelle mit freigegebenen Adressen (kommt erst mit dem
// Zugangssystem, Stufe 3). Bis dahin verhaelt sich Demo wie Staging --
// JEDE Mail auf die Testadresse, mit eigenem Namen und eigenem Label,
// niemals an den eingegebenen Empfaenger. Stufe 3 erweitert genau diese
// Stelle um die Allowlist-Ausnahme; bis dahin ist "gar keine Demo-Mail
// kommt an" die sichere Fehlrichtung, nicht "irgendeine Demo-Mail geht an
// eine falsche Adresse".
//
// Fehlt die Testadresse (Secret nicht gesetzt), liefert die Funktion einen
// leeren Empfaenger zurueck -- smtp_senden() bricht dann ab, statt
// irgendwohin zu senden.
function smtp_ziel(string $anEmail, string $anName, bool $produktion, bool $istDemo = false): array
{
    if ($produktion) {
        return [$anEmail, $anName];
    }
    if ($istDemo) {
        $demoAdresse = '__DEMO_TESTMAIL__';
        if (platzhalter_offen($demoAdresse, '__DEMO_TESTMAIL')) {
            return ['', ''];
        }
        return [$demoAdresse, 'Demo-Testadresse'];
    }
    $testAdresse = '__STAGING_TESTMAIL__';
    if (platzhalter_offen($testAdresse, '__STAGING_TESTMAIL')) {
        return ['', ''];
    }
    return [$testAdresse, 'Staging-Testadresse'];
}

// Bedingung 4 der SMTP-Ausnahme (ENT-371): Der Absender soll ausserhalb der
// Produktion als Staging erkennbar sein -- unabhaengig davon, was im
// konfigurierten Secret STAGING_SMTP_ABSENDER_NAME steht (das seit ENT-367
// denselben Wert wie SMTP_ABSENDER_NAME traegt). Deshalb hier automatisch
// erzwungen statt der Sorgfalt beim Befuellen des Secrets ueberlassen --
// dieselbe Haltung wie bei der Empfaenger-Umleitung: eine Absicherung im
// Server, nicht nur eine Konvention. Reine Funktion, mit frei gewaehltem
// Namen (auch leer) pruefbar.
function smtp_absender_name(string $konfiguriert, bool $produktion, bool $istDemo = false): string
{
    if ($produktion) {
        return $konfiguriert;
    }
    $praefix = $istDemo ? '[DEMO]' : '[STAGING]';
    return $konfiguriert === '' ? $praefix : $praefix . ' ' . $konfiguriert;
}

function smtp_lesen($fp): string
{
    $antwort = '';
    while (($zeile = fgets($fp, 515)) !== false) {
        $antwort .= $zeile;
        // Eine Mehrzeilenantwort traegt einen Bindestrich an Stelle 4
        // ("250-GROESSE"), die letzte Zeile ein Leerzeichen ("250 OK").
        if (strlen($zeile) < 4 || $zeile[3] !== '-') { break; }
    }
    return $antwort;
}

function smtp_befehl($fp, string $befehl, array $erwarteteCodes): string
{
    fwrite($fp, $befehl . "\r\n");
    $antwort = smtp_lesen($fp);
    $code = (int)substr($antwort, 0, 3);
    if (!in_array($code, $erwarteteCodes, true)) {
        throw new RuntimeException('Mailserver meldet: ' . trim($antwort));
    }
    return $antwort;
}

// Setzt die fertige MIME-Nachricht zusammen -- Kopfzeilen und Rumpf.
//
// EIGENE, REINE FUNKTION (ENT-619): Der Aufbau einer Mail mit Klartext,
// HTML, eingebettetem Bild und Anhang ist die fehleranfaelligste Stelle
// dieser Datei -- eine falsch verschachtelte Grenze macht aus dem Logo
// einen Anhang oder aus dem Text eine unlesbare Wand. In smtp_senden()
// steckte das bis hierher mitten zwischen zwei Socket-Befehlen und war
// nur mit einem echten Mailserver zu pruefen. Hier laesst es sich fuer
// sich ausfuehren (pruefungen/pruef_mail_aufbau.php).
function smtp_nachricht_bauen(string $von, string $an, string $betreff, string $html,
                              string $text, array $anhaenge = [], array $bilder = [],
                              ?string $grenze = null): string
{
    // Die Grenze ist normalerweise zufaellig; als Parameter nur, damit eine
    // Pruefung den Aufbau mit einem festen Wert vergleichen kann.
    $grenze = $grenze ?? 'sop-' . bin2hex(random_bytes(16));

    // Base64 fuer beide Teile: Eine SMTP-Zeile, die mit einem Punkt
    // beginnt, wuerde von manchen Servern als Nachrichtenende (dot
    // stuffing) missverstanden -- der Punkt ist im Base64-Alphabet aber
    // gar nicht enthalten, das Problem stellt sich also nie.
    $alternative = '--' . $grenze . "\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($text)) . "\r\n"
        . '--' . $grenze . "\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($html)) . "\r\n"
        . '--' . $grenze . "--\r\n";

    // ── Eingebettete Bilder (ENT-619) ─────────────────────────────
    //
    // Ein Bild in der Signatur ist weder eine zweite Darstellung der
    // Nachricht noch ein Anhang daneben: Es GEHOERT zum HTML-Teil und
    // wird von dort ueber "cid:" angesprochen. Dafuer gibt es
    // "multipart/related" -- aussen die Nachricht samt ihrer Bilder,
    // innen weiterhin die Alternative zur Auswahl. Genau so bauen
    // Outlook und Apple Mail ihre Signaturen.
    //
    // WARUM NICHT EINFACH EINE BILDADRESSE IM HTML: Outlook und die
    // meisten Programme laden externe Bilder erst nach ausdruecklicher
    // Erlaubnis. Bis dahin stuende an der Stelle des Logos ein leerer
    // Rahmen -- ausgerechnet unter der Unterschrift.
    //
    // OHNE BILDER AENDERT SICH NICHTS: Der Aufbau bleibt Zeichen fuer
    // Zeichen der bisherige (siehe Versprechen im Kopfkommentar) --
    // der Offert-Versand soll von dieser Erweiterung nichts merken.
    $rumpfTyp = 'multipart/alternative; boundary="' . $grenze . '"';
    $rumpf    = $alternative;
    if ($bilder) {
        $rel = 'sop-rel-' . bin2hex(random_bytes(16));
        $rumpf = '--' . $rel . "\r\n"
            . 'Content-Type: multipart/alternative; boundary="' . $grenze . "\"\r\n\r\n"
            . $alternative;
        foreach ($bilder as $b) {
            // Die Kennung landet im Kopfbereich und im HTML. Alles
            // ausser Buchstaben, Ziffern, Punkt und Bindestrich faellt
            // weg -- ein Umbruch oder eine spitze Klammer darin waere
            // dieselbe Einschleusung, gegen die oben die Adressen und
            // der Betreff geprueft werden (ENT-501).
            $cid = preg_replace('/[^A-Za-z0-9._-]/', '', (string)($b['cid'] ?? '')) ?? '';
            if ($cid === '') { continue; }
            $rumpf .= '--' . $rel . "\r\n"
                . 'Content-Type: ' . (string)($b['mime'] ?? 'image/png') . "\r\n"
                . "Content-Transfer-Encoding: base64\r\n"
                . 'Content-ID: <' . $cid . ">\r\n"
                . 'Content-Disposition: inline; filename="' . $cid . "\"\r\n\r\n"
                . chunk_split(base64_encode((string)($b['inhalt'] ?? ''))) . "\r\n";
        }
        $rumpf .= '--' . $rel . "--\r\n";
        $rumpfTyp = 'multipart/related; type="multipart/alternative"; boundary="' . $rel . '"';
    }

    $kopf = [
        'From: ' . $von,
        'To: ' . $an,
        'Subject: ' . smtp_kopf_kodieren($betreff),
        'MIME-Version: 1.0',
    ];

    if (!$anhaenge) {
        $kopf[] = 'Content-Type: ' . $rumpfTyp;
        $kopf[] = 'Date: ' . date('r');
        $nachricht = implode("\r\n", $kopf) . "\r\n\r\n" . $rumpf;
    } else {
        $aussen = 'sop-mix-' . bin2hex(random_bytes(16));
        $kopf[] = 'Content-Type: multipart/mixed; boundary="' . $aussen . '"';
        $kopf[] = 'Date: ' . date('r');
        $nachricht = implode("\r\n", $kopf) . "\r\n\r\n"
            . '--' . $aussen . "\r\n"
            . 'Content-Type: ' . $rumpfTyp . "\r\n\r\n"
            . $rumpf;
        foreach ($anhaenge as $a) {
            // Der Dateiname wird nach RFC 2047 kodiert, falls er Umlaute
            // traegt -- ein roher Umlaut im Kopfbereich macht die
            // Nachricht unzustellbar oder den Namen unlesbar.
            $dateiname = smtp_kopf_kodieren((string)($a['name'] ?? 'anhang'));
            $mime = (string)($a['mime'] ?? 'application/octet-stream');
            $nachricht .= '--' . $aussen . "\r\n"
                . 'Content-Type: ' . $mime . '; name="' . $dateiname . "\"\r\n"
                . "Content-Transfer-Encoding: base64\r\n"
                . 'Content-Disposition: attachment; filename="' . $dateiname . "\"\r\n\r\n"
                . chunk_split(base64_encode((string)($a['inhalt'] ?? ''))) . "\r\n";
        }
        $nachricht .= '--' . $aussen . "--\r\n";
    }

    return $nachricht;
}

// Verschickt eine HTML-Mail mit Klartext-Alternative. Wirft eine Exception
// mit einer fuer die Oberflaeche verstaendlichen Meldung, statt selbst einen
// Fehler auszugeben -- der Aufrufer entscheidet, wie er das dem Benutzer
// zeigt (siehe beleg_versenden.php).
/* $anhaenge (ENT-322): Liste von ['name' => 'rapport.pdf',
   'mime' => 'application/pdf', 'inhalt' => <Rohbytes>].

   Warum die Nachricht dann anders aufgebaut ist: Ohne Anhang ist die Mail
   eine "multipart/alternative" -- zwei Darstellungen DERSELBEN Nachricht
   (Text oder HTML), und das Programm des Empfaengers waehlt eine davon.
   Ein Anhang ist aber keine andere Darstellung, sondern ein zweiter Teil
   NEBEN der Nachricht. Haengte man ihn in dieselbe Alternative, waere er
   fuer manche Programme eine dritte Variante des Textes und verschwaende
   still. Deshalb wird die Alternative bei Anhaengen in ein
   "multipart/mixed" eingepackt: aussen die Teile nebeneinander, innen die
   Darstellungen zur Auswahl. Das ist die Bauart, die auch Outlook und
   Apple Mail erwarten.

   Ohne Anhang bleibt der Aufbau EXAKT wie bisher -- der Offert-Versand
   (ENT-192) laeuft produktiv und soll von dieser Erweiterung nichts
   merken.

   $bilder (ENT-619): Liste von ['cid' => 'logo', 'mime' => 'image/png',
   'inhalt' => <Rohbytes>] -- Bilder, die IM HTML stehen und dort ueber
   src="cid:logo" angesprochen werden, nicht Anhaenge daneben. Begruendung
   der Bauart bei der Zusammensetzung weiter unten. Auch hier gilt: Ohne
   Bilder aendert sich am Aufbau nichts. */
function smtp_senden(string $anEmail, string $anName, string $betreff, string $html, string $text,
                     array $anhaenge = [], array $bilder = []): void
{
    if (!smtp_konfiguriert()) {
        throw new RuntimeException('Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).');
    }

    // ── Kein Zeilenumbruch in Adresse, Name oder Betreff (ENT-501) ─────
    //
    // ANLASS: Die Sicherheitspruefung vom 2026-09-09. Diese Funktion hat
    // bis hierher NICHTS selbst geprueft -- smtp_befehl() haengt an jeden
    // Befehl ein CRLF an, und die Empfaengeradresse ging roh in
    // "RCPT TO:<...>" und in den "To:"-Kopf. Ob das gutgeht, entschieden
    // ausschliesslich die Aufrufer.
    //
    // Fuenf von sechs prueften: demo_anfrage.php entfernt Steuerzeichen,
    // portal_link_anfordern.php und rundgang_rapport_versenden.php nutzen
    // FILTER_VALIDATE_EMAIL, passwort_vergessen.php liest aus der
    // Mitarbeitertabelle. beleg_versenden.php prueft nicht -- dort steht
    // nur trim(), und trim() entfernt Umbrueche nur am Rand, nicht in der
    // Mitte. Eine als Kundenadresse gespeicherte Zeichenkette mit CRLF
    // haette dort eine zweite SMTP-Zeile einschleusen koennen.
    //
    // DIE PRUEFUNG GEHOERT HIERHER und nicht in sechs Aufrufer: Sie ist
    // einmal richtig statt sechsmal, und der siebte Aufrufer erbt sie von
    // selbst -- genau die Sorte Regel, die in diesem Haus schon mehrfach
    // gebrochen wurde, weil etwas NEUES sie nicht geerbt hat.
    //
    // Sie steht VOR dem Staging-Zweig: Dort wandert $anEmail in den
    // Betreff, ein ungeprueftes Feld waere also auch dort ein Weg.
    foreach (['Empfaengeradresse' => $anEmail, 'Empfaengername' => $anName,
              'Betreff' => $betreff] as $was => $wert) {
        if (preg_match('/[\r\n]/', $wert)) {
            throw new RuntimeException($was . ' enthaelt einen Zeilenumbruch — nicht versendet.');
        }
    }
    if (!filter_var($anEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Keine gueltige Empfaengeradresse — nicht versendet.');
    }

    // Staging-/Demo-Mailmodus (ENT-341, ENT-523): ausserhalb der Produktion
    // geht JEDE Mail ausschliesslich an die fuer die jeweilige Umgebung
    // konfigurierte Testadresse, nie an den eingegebenen Empfaenger --
    // Demo hat dabei eine EIGENE Testadresse, kein gemeinsamer Topf mit
    // Staging (siehe smtp_ziel()). Bewusst vor jedem Verbindungsaufbau
    // geprueft, damit ein falscher Empfaenger nicht einmal eine
    // Socket-Verbindung ausloest.
    $produktion = ist_produktion();
    $istDemo = ist_demo();
    [$zielEmail, $zielName] = smtp_ziel($anEmail, $anName, $produktion, $istDemo);
    if ($zielEmail === '') {
        throw new RuntimeException(
            $istDemo
                ? 'Demo-Mailmodus: keine Testadresse konfiguriert (Secret DEMO_TESTMAIL fehlt) -- '
                  . 'kein Versand, auch nicht an die Testadresse.'
                : 'Staging-Mailmodus: keine Testadresse konfiguriert (Secret STAGING_TESTMAIL fehlt) -- '
                  . 'kein Versand, auch nicht an die Testadresse.'
        );
    }
    if (!$produktion) {
        // Der urspruengliche Empfaenger bleibt im Betreff sichtbar, sonst
        // liesse sich im Testpostfach nicht mehr nachvollziehen, wer
        // eigentlich angeschrieben werden sollte.
        $betreff = ($istDemo ? '[DEMO -- eigentlich an ' : '[TESTUMGEBUNG -- eigentlich an ') . $anEmail . '] ' . $betreff;
    }
    $anEmail = $zielEmail;
    $anName = $zielName;

    $host = '__SMTP_HOST__';
    $port = (int)'__SMTP_PORT__';
    $verschluesselung = strtolower(trim('__SMTP_VERSCHLUESSELUNG__')); // 'ssl', 'tls' oder leer
    $user = '__SMTP_USER__';
    $pass = '__SMTP_PASSWORD__';
    $absenderEmail = smtp_absender_adresse();
    $absenderName = smtp_absender_name('__SMTP_ABSENDER_NAME__', $produktion, $istDemo);

    $transport = $verschluesselung === 'ssl' ? 'ssl://' : '';
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $fp = @stream_socket_client(
        $transport . $host . ':' . $port, $errno, $errstr, 15.0, STREAM_CLIENT_CONNECT, $ctx
    );
    if (!$fp) {
        throw new RuntimeException('Verbindung zum Mailserver fehlgeschlagen: ' . $errstr);
    }
    stream_set_timeout($fp, 15);

    try {
        smtp_lesen($fp); // Begruessung (220)
        // Der EHLO-Name benennt den ABSENDENDEN Rechner. Er kam bis
        // ENT-501 aus dem Host-Kopf der Anfrage -- ein Wert von aussen in
        // einer SMTP-Befehlszeile, und damit dieselbe Familie wie die
        // Links oben. Jetzt aus der beim Deploy gesetzten Adresse; ist
        // keine hinterlegt, bleibt "localhost" wie bisher.
        $basisEhlo = basis_url();
        $ehloName = $basisEhlo !== null
            ? (string)(parse_url($basisEhlo, PHP_URL_HOST) ?: 'localhost')
            : 'localhost';
        smtp_befehl($fp, 'EHLO ' . $ehloName, [250]);

        if ($verschluesselung === 'tls') {
            smtp_befehl($fp, 'STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('TLS-Verschluesselung liess sich nicht aufbauen.');
            }
            smtp_befehl($fp, 'EHLO ' . $ehloName, [250]);
        }

        if ($user !== '') {
            smtp_befehl($fp, 'AUTH LOGIN', [334]);
            smtp_befehl($fp, base64_encode($user), [334]);
            smtp_befehl($fp, base64_encode($pass), [235]);
        }

        smtp_befehl($fp, 'MAIL FROM:<' . $absenderEmail . '>', [250]);
        smtp_befehl($fp, 'RCPT TO:<' . $anEmail . '>', [250, 251]);
        smtp_befehl($fp, 'DATA', [354]);

        $von = $absenderName !== ''
            ? smtp_kopf_kodieren($absenderName) . ' <' . $absenderEmail . '>'
            : $absenderEmail;
        $an = $anName !== ''
            ? smtp_kopf_kodieren($anName) . ' <' . $anEmail . '>'
            : $anEmail;
        $nachricht = smtp_nachricht_bauen($von, $an, $betreff, $html, $text,
            $anhaenge, $bilder);

        fwrite($fp, $nachricht . "\r\n.\r\n");
        $antwort = smtp_lesen($fp);
        if ((int)substr($antwort, 0, 3) !== 250) {
            throw new RuntimeException('Mailserver meldet: ' . trim($antwort));
        }
        smtp_befehl($fp, 'QUIT', [221]);
    } finally {
        fclose($fp);
    }
}
