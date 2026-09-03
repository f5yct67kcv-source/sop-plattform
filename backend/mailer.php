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

// Bewusst nur auf leeren String pruefen (wie bei __ANTHROPIC_API_KEY__ in
// ai.php), NICHT zusaetzlich per str_contains() gegen den Platzhaltertext
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

// Staging-Mailmodus (ENT-341). Eine reine Funktion ohne Netzwerk- oder
// $_SERVER-Zugriff -- damit sich die Umleitung fuer sich pruefen laesst,
// ohne einen Socket zu oeffnen (gleiche Ueberlegung wie bei
// sitzung_abgelaufen() in db.php).
//
// Ausserhalb der Produktion wird IMMER auf die konfigurierte Testadresse
// umgeleitet, unabhaengig vom eingegebenen Empfaenger -- es gibt keinen
// Fall, in dem eine Nicht-Produktions-Instanz einen anderen als diesen
// einen Empfaenger anschreiben darf. Fehlt die Testadresse (Secret nicht
// gesetzt), liefert die Funktion einen leeren Empfaenger zurueck --
// smtp_senden() bricht dann ab, statt irgendwohin zu senden.
function smtp_ziel(string $anEmail, string $anName, bool $produktion): array
{
    if ($produktion) {
        return [$anEmail, $anName];
    }
    $testAdresse = '__STAGING_TESTMAIL__';
    if (platzhalter_offen($testAdresse, '__STAGING_TESTMAIL')) {
        return ['', ''];
    }
    return [$testAdresse, 'Staging-Testadresse'];
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
   merken. */
function smtp_senden(string $anEmail, string $anName, string $betreff, string $html, string $text,
                     array $anhaenge = []): void
{
    if (!smtp_konfiguriert()) {
        throw new RuntimeException('Der E-Mail-Versand ist noch nicht eingerichtet (SMTP-Zugangsdaten fehlen).');
    }

    // Staging-Mailmodus (ENT-341): ausserhalb der Produktion geht JEDE Mail
    // ausschliesslich an die konfigurierte Testadresse, nie an den
    // eingegebenen Empfaenger. Bewusst vor jedem Verbindungsaufbau geprueft,
    // damit ein falscher Empfaenger nicht einmal eine Socket-Verbindung
    // ausloest.
    $produktion = ist_produktion();
    [$zielEmail, $zielName] = smtp_ziel($anEmail, $anName, $produktion);
    if ($zielEmail === '') {
        throw new RuntimeException(
            'Staging-Mailmodus: keine Testadresse konfiguriert (Secret STAGING_TESTMAIL fehlt) -- '
            . 'kein Versand, auch nicht an die Testadresse.'
        );
    }
    if (!$produktion) {
        // Der urspruengliche Empfaenger bleibt im Betreff sichtbar, sonst
        // liesse sich im Testpostfach nicht mehr nachvollziehen, wer
        // eigentlich angeschrieben werden sollte.
        $betreff = '[TESTUMGEBUNG -- eigentlich an ' . $anEmail . '] ' . $betreff;
    }
    $anEmail = $zielEmail;
    $anName = $zielName;

    $host = '__SMTP_HOST__';
    $port = (int)'__SMTP_PORT__';
    $verschluesselung = strtolower(trim('__SMTP_VERSCHLUESSELUNG__')); // 'ssl', 'tls' oder leer
    $user = '__SMTP_USER__';
    $pass = '__SMTP_PASSWORD__';
    $absenderEmail = smtp_absender_adresse();
    $absenderName = '__SMTP_ABSENDER_NAME__';

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
        $ehloName = $_SERVER['HTTP_HOST'] ?? 'localhost';
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

        $grenze = 'sop-' . bin2hex(random_bytes(16));
        $von = $absenderName !== ''
            ? smtp_kopf_kodieren($absenderName) . ' <' . $absenderEmail . '>'
            : $absenderEmail;
        $an = $anName !== ''
            ? smtp_kopf_kodieren($anName) . ' <' . $anEmail . '>'
            : $anEmail;

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

        $kopf = [
            'From: ' . $von,
            'To: ' . $an,
            'Subject: ' . smtp_kopf_kodieren($betreff),
            'MIME-Version: 1.0',
        ];

        if (!$anhaenge) {
            $kopf[] = 'Content-Type: multipart/alternative; boundary="' . $grenze . '"';
            $kopf[] = 'Date: ' . date('r');
            $nachricht = implode("\r\n", $kopf) . "\r\n\r\n" . $alternative;
        } else {
            $aussen = 'sop-mix-' . bin2hex(random_bytes(16));
            $kopf[] = 'Content-Type: multipart/mixed; boundary="' . $aussen . '"';
            $kopf[] = 'Date: ' . date('r');
            $nachricht = implode("\r\n", $kopf) . "\r\n\r\n"
                . '--' . $aussen . "\r\n"
                . 'Content-Type: multipart/alternative; boundary="' . $grenze . "\"\r\n\r\n"
                . $alternative;
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
