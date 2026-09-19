<?php
declare(strict_types=1);
// Die offene Demo-Anfrage, bevor sie ein Zugang wird (ENT-624).
//
// WARUM ES DIESEN ZWISCHENSCHRITT GIBT: Bis hierher bekam jeder, der das
// Formular absendete, sofort einen der zehn Plaetze. Honigtopf, Bremse,
// Domainpruefung und Telefonpflicht halten vieles ab -- aber keine dieser
// Pruefungen beweist, dass die Adresse dem Anfragenden GEHOERT. Ein Skript
// mit zehn erreichbaren Wegwerf-Domains raeumt den Vorrat in einer halben
// Stunde leer, und danach steht er vierzehn Tage. Trifft das mit bezahlter
// Werbung zusammen, bekommen echte Interessenten eine Absage.
//
// Darum: Das Formular legt nur noch eine offene Anfrage an. Platz, Instanz,
// Konto und Registereintrag entstehen erst, wenn jemand den Link aus der
// Mail benutzt. Wer das Postfach nicht lesen kann, kommt an den Vorrat
// nicht mehr heran.
//
// DER EHRLICHE INTERESSENT ZAHLT DAFUER NICHTS: Er muss sein Postfach
// ohnehin oeffnen, das Passwort steht nur dort. Ein Klick mehr, kein
// Schritt mehr.
//
// KEIN PLATZ WIRD RESERVIERT. Eine offene Anfrage haelt nichts frei --
// sonst waere die Luecke nur verschoben: Ein Bot koennte zehn Anfragen
// stellen und den Vorrat blockieren, ohne je zu bestaetigen. Wer zuerst
// bestaetigt, bekommt den Platz. Ist beim Bestaetigen keiner mehr frei,
// sagt die Seite das ehrlich.
//
// WARUM DER ROHE WERT NIRGENDS STEHT: Der Bestaetigungswert ist ein
// Schluessel -- wer ihn hat, loest die Anfrage ein. In der Tabelle steht
// nur sein SHA-256-Abdruck, gleiche Regel wie bei den Sitzungen (ENT-501).
// Ein Blick in die Datenbank gibt damit keinen gueltigen Link her.

require_once __DIR__ . '/mail_vorlage.php';

// Wie lange ein Bestaetigungslink gilt. Vierundzwanzig Stunden, nicht zwei:
// Wer abends anfragt, liest die Mail am naechsten Morgen. Ein Link, der
// vorher verfaellt, kostet genau die Interessenten, die man wollte -- und
// er schuetzt nichts zusaetzlich, weil er ohnehin nur einmal gilt.
const DEMO_BESTAETIGUNG_STUNDEN = 24;

// Die Fassung der Nutzungsbedingungen, der zugestimmt wurde. Sie wird MIT
// GESPEICHERT und nicht nur verlinkt: Ohne sie beweist der Abdruck nichts,
// sobald der Text einmal geaendert wird -- dann laesst sich nicht mehr
// sagen, wem welcher Wortlaut vorlag. Bei jeder inhaltlichen Aenderung an
// nutzungsbedingungen.html wird dieses Datum hochgesetzt.
const DEMO_BEDINGUNGEN_FASSUNG = '2026-09-19';

// ── Der Bestaetigungswert ────────────────────────────────────────────
//
// 32 Byte aus der Zufallsquelle des Systems, hexadezimal. Er steht in
// einer URL, also nur Zeichen, die dort ohne Kodierung durchgehen.
function demo_bestaetigung_wert(): string
{
    return bin2hex(random_bytes(32));
}

// Der Abdruck, unter dem der Wert in der Datenbank steht. Eigene Funktion,
// damit Schreiben und Nachschlagen nicht zwei verschiedene Rechnungen
// anstellen koennen.
function demo_bestaetigung_abdruck(string $wert): string
{
    return hash('sha256', $wert);
}

// Ist die Anfrage abgelaufen? Reine Entscheidung, ohne Datenbank und ohne
// Uhr -- damit sie sich echt ausfuehren laesst.
function demo_bestaetigung_abgelaufen(string $erstelltAm, string $jetzt,
                                      int $stunden = DEMO_BESTAETIGUNG_STUNDEN): bool
{
    $erstellt = strtotime($erstelltAm);
    $zeitpunkt = strtotime($jetzt);
    if ($erstellt === false || $zeitpunkt === false) {
        // Ein unlesbarer Zeitstempel gilt als abgelaufen, nicht als
        // gueltig: Im Zweifel wird der Zugang nicht eingerichtet, statt
        // ihn auf einer Annahme einzurichten.
        return true;
    }
    return ($zeitpunkt - $erstellt) > $stunden * 3600;
}

// Die Adresse, unter der bestaetigt wird.
//
// SIE KOMMT AUS DEM DEPLOY, NIE AUS DER ANFRAGE (ENT-501): Ein Link, den
// wir verschicken, darf nicht davon abhaengen, welchen Host-Kopf jemand
// mitgeschickt hat -- sonst schickt ein Angreifer sich selbst den Link.
// Die Verkaufsseite ist eine andere als der Betreiber-Bereich, in dem
// dieser Endpunkt laeuft, darum ein eigener Platzhalter statt basis_url().
function demo_bestaetigung_basis_pruefen(string $wert): ?string
{
    $wert = trim($wert);
    if ($wert === '' || str_contains($wert, '__GUARDOPS_BASIS_URL')) { return null; }
    if (preg_match('/[\x00-\x20\x7F]/', $wert)) { return null; }
    // Ein Schraegstrich am Ende ist erlaubt und faellt darunter weg: Ein
    // Deploy-Wert mit Schraegstrich soll den Link nicht verdoppeln und
    // erst recht nicht die ganze Anfrage scheitern lassen.
    if (!preg_match('#^https://[A-Za-z0-9.-]+(?::\d+)?/?$#', $wert)) { return null; }
    return rtrim($wert, '/');
}

function demo_bestaetigung_basis(): ?string
{
    return demo_bestaetigung_basis_pruefen('__GUARDOPS_BASIS_URL__');
}

// Der vollstaendige Link. Gibt null zurueck, wenn die Adresse nicht
// eingerichtet ist -- "nicht eingerichtet" ist etwas anderes als eine
// kaputte URL, und der Aufrufer soll beides unterscheiden koennen.
function demo_bestaetigung_link(string $wert, ?string $basis = null): ?string
{
    $basis ??= demo_bestaetigung_basis();
    if ($basis === null) { return null; }
    // Der Wert ist hexadezimal, also ohnehin URL-sicher -- kodiert wird er
    // trotzdem, damit die Funktion auch dann stimmt, wenn sich das Format
    // des Wertes einmal aendert.
    return $basis . '/demo-bestaetigen.html?t=' . rawurlencode($wert);
}

// ── Die Mail mit dem Bestaetigungslink ───────────────────────────────
//
// SIE ENTHAELT KEINE ZUGANGSDATEN. Es gibt zu diesem Zeitpunkt keine --
// weder Konto noch Platz. Wer sie abfaengt, hat nichts ausser der
// Moeglichkeit, eine Demo einzurichten, die an diese Adresse geht.
function demo_bestaetigung_mail(string $firma, string $person, string $link): array
{
    $betreff = 'Bitte bestätigen Sie Ihren Demo-Zugang';

    $zeilen = mail_signatur_zeilen();
    $gruss  = $zeilen === [] ? ['pzu consulting gmbh'] : $zeilen;
    $logo     = mail_logo();
    $logoHell = mail_logo_hell();
    $kennung     = $logo === null ? '' : (string)$logo['cid'];
    $kennungHell = $logoHell === null ? '' : (string)$logoHell['cid'];
    $bilder = array_values(array_filter([$logo, $logoHell]));

    $text = "Guten Tag $person\n\n"
          . "vielen Dank für Ihr Interesse an GuardOpS, der Betriebssoftware für "
          . "Sicherheitsdienste. Noch ein Schritt, dann steht Ihr Demo-Zugang für "
          . "$firma bereit.\n\n"
          . "Bitte öffnen Sie diese Adresse und bestätigen Sie dort:\n\n"
          . "$link\n\n"
          . "Wir richten den Zugang erst nach Ihrer Bestätigung ein. So stellen wir "
          . "sicher, dass die Demo-Plätze denen zur Verfügung stehen, die sie "
          . "wirklich nutzen möchten.\n\n"
          . "Der Link gilt " . DEMO_BESTAETIGUNG_STUNDEN . " Stunden und lässt sich "
          . "einmal verwenden. Danach können Sie jederzeit erneut anfragen.\n\n"
          . "Haben Sie keinen Demo-Zugang angefordert? Dann ignorieren Sie diese "
          . "E-Mail einfach — ohne Ihre Bestätigung geschieht nichts.\n\n"
          . "Mit freundlichen Grüssen\n" . implode("\n", $gruss);

    $inhalt = mail_absatz('Guten Tag ' . mail_e($person))
        . mail_absatz('vielen Dank für Ihr Interesse an GuardOpS, der Betriebssoftware für '
            . 'Sicherheitsdienste. Noch ein Schritt, dann steht Ihr Demo-Zugang für '
            . '<b>' . mail_e($firma) . '</b> bereit.')
        . mail_knopf('Demo-Zugang bestätigen', $link)
        . mail_absatz('Wir richten den Zugang erst nach Ihrer Bestätigung ein. So stellen '
            . 'wir sicher, dass die Demo-Plätze denen zur Verfügung stehen, die sie '
            . 'wirklich nutzen möchten.')
        . mail_absatz('Der Link gilt ' . DEMO_BESTAETIGUNG_STUNDEN . ' Stunden und lässt '
            . 'sich einmal verwenden. Danach können Sie jederzeit erneut anfragen.')
        // Wer die Mail bekommt, ohne sie angefordert zu haben, soll wissen,
        // dass Nichtstun genuegt. Ohne diesen Satz meldet sich jemand
        // beunruhigt beim Support -- oder klickt zur Sicherheit doch.
        . mail_absatz('<span style="color:' . MAIL_FARBE_LEISE . '">Haben Sie keinen '
            . 'Demo-Zugang angefordert? Dann ignorieren Sie diese E-Mail einfach — ohne '
            . 'Ihre Bestätigung geschieht nichts.</span>')
        . mail_signatur($zeilen, $kennung, $kennungHell);

    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
        'bilder' => $bilder];
}

// ── Die Tabelle ──────────────────────────────────────────────────────
//
// Sie liegt in der BETREIBER-Datenbank, aus demselben Grund wie das
// Register selbst (siehe demo_zugang_tabelle()): Der naechtliche Reset
// leert jede Tabelle der Demo-Instanzen.
//
// DER ABDRUCK DER ZUSTIMMUNG BLEIBT AUCH NACH DEM EINLOESEN STEHEN. Er ist
// der eigentliche Zweck dieser Zeile, nicht der Link: Er belegt, wer wann
// welcher Fassung zugestimmt hat. Darum wird eine eingeloeste Anfrage
// nicht geloescht, sondern mit `eingeloest_am` versehen.
function demo_bestaetigung_tabelle(): string
{
    return "CREATE TABLE IF NOT EXISTS demo_bestaetigung (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- Nur der Abdruck, nie der Wert selbst (siehe Kopf).
  wert_abdruck CHAR(64) NOT NULL,
  firma VARCHAR(200) NOT NULL,
  person VARCHAR(200) NOT NULL,
  email VARCHAR(200) NOT NULL,
  telefon VARCHAR(40) NOT NULL DEFAULT '',
  -- Der Abdruck der Zustimmung (ENT-624). Welche FASSUNG jemand gesehen
  -- hat, ist der Teil, den man spaeter nicht mehr rekonstruieren kann.
  bedingungen_fassung VARCHAR(20) NOT NULL DEFAULT '',
  -- Widerspruch, nicht Einwilligung: Wer seine Nummer fuer einen
  -- Demo-Zugang hinterlaesst, rechnet mit einem Rueckruf. 0 heisst also
  -- „Rueckruf in Ordnung“, 1 heisst „ausdruecklich nicht erwuenscht“.
  kein_rueckruf TINYINT(1) NOT NULL DEFAULT 0,
  zustimmung_ip VARCHAR(45) NOT NULL DEFAULT '',
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL heisst „noch offen“, nicht „nie eingeloest“ -- solange die Frist
  -- laeuft, sind das zwei verschiedene Aussagen.
  eingeloest_am DATETIME NULL,
  -- Der Weg, auf dem nachgeschlagen wird. Einmalig, damit derselbe
  -- Abdruck nicht zweimal entstehen kann.
  UNIQUE KEY idx_demo_best_abdruck (wert_abdruck),
  KEY idx_demo_best_email (email),
  KEY idx_demo_best_offen (eingeloest_am, erstellt_am)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
}
