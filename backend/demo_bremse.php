<?php
declare(strict_types=1);
// Bremse fuer das Demo-Formular der oeffentlichen Homepage.
//
// WARUM NICHT DIE ANMELDEBREMSE AUS anmeldung.php: Die zaehlt in einer
// MySQL-Tabelle. Seit die Homepage auf ihrer eigenen Domain steht
// (guardops.ch), gibt es dort keine Datenbank -- und es soll auch keine
// geben: Eine Verkaufsseite, die an der Datenbank des Rapport-Tools haengt,
// faellt mit ihr aus und traegt deren Zugangsdaten ein zweites Mal.
//
// DIE WICHTIGSTE FESTLEGUNG DIESER DATEI -- SIE FAELLT ZU, NICHT AUF:
// Kann der Zaehler nicht gelesen oder geschrieben werden, gilt die Anfrage
// als GESPERRT, nicht als frei. Der Nachbarcode traegt genau diese Lehre
// schon: In anmeldung.php steht ueber der Tabellenpruefung "Fehlt die
// Tabelle, gibt es keine Bremse -- und das ist der gefaehrlichste Zustand
// dieser Datei (ENT-501)". Eine Bremse, die bei einem vollen Verzeichnis
// lautlos verschwindet, ist keine Bremse, sondern die Behauptung einer.
//
// Der Empfaenger steht fest im Deploy, ein Angreifer kann also keine fremden
// Adressen anschreiben -- der Schaden waere ein geflutetes Postfach und ein
// SMTP-Zugang, den Hostpoint wegen Massenversand sperrt. Das genuegt, um
// im Zweifel abzulehnen statt zu senden.
//
// AUF DER PLATTE STEHT KEINE ADRESSE. Der Dateiname ist der SHA-256 der
// Absenderadresse, der Inhalt sind nackte Zeitstempel. Das Verzeichnis liegt
// im Temp-Bereich des Kontos, nie im ausgelieferten Verzeichnis.

const DEMO_BREMSE_FENSTER_MIN = 15;   // Zeitraum, in dem Anfragen zaehlen
const DEMO_BREMSE_MAX         = 5;    // Anfragen je Adresse im Fenster
const DEMO_BREMSE_SPERRE_MIN  = 15;   // wie lange danach gesperrt wird

// Absenderadresse, wortgleich zu anmeld_adresse() in anmeldung.php.
function demo_bremse_adresse(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'unbekannt'), 0, 45);
}

function demo_bremse_verzeichnis(): string
{
    return sys_get_temp_dir() . '/guardops-demo-bremse';
}

// Dateiname aus dem Hash -- siehe Kopf: die Adresse selbst steht nirgends.
function demo_bremse_datei(string $adresse, string $verzeichnis): string
{
    return $verzeichnis . '/' . hash('sha256', $adresse) . '.txt';
}

// DIE ENTSCHEIDUNG, als eigene Funktion OHNE Dateizugriff -- damit sie sich
// echt ausfuehren laesst (pruefungen/pruef_demo_anfrage.php). Dieselbe
// Trennung wie bei anmeld_sperre() in anmeldung.php.
// Gibt die Sperrdauer in Minuten zurueck, 0 = frei.
function demo_bremse_entscheiden(array $zeitpunkte, int $jetzt): int
{
    $grenze = $jetzt - DEMO_BREMSE_FENSTER_MIN * 60;
    $im_fenster = array_filter($zeitpunkte, fn($t) => $t > $grenze);
    return count($im_fenster) >= DEMO_BREMSE_MAX ? DEMO_BREMSE_SPERRE_MIN : 0;
}

// Wirft die alten Zeitstempel weg und gibt zurueck, was im Fenster bleibt.
function demo_bremse_aufraeumen(array $zeitpunkte, int $jetzt): array
{
    $grenze = $jetzt - DEMO_BREMSE_FENSTER_MIN * 60;
    return array_values(array_filter($zeitpunkte, fn($t) => $t > $grenze));
}

// Liest den Zaehler, traegt DIESE Anfrage ein und entscheidet.
//
// Zaehlt JEDE Anfrage, nicht nur eine fehlerhafte -- wie bei der
// Passwort-Ruecksetzung (ENT-373): Fuenf Anfragen in einer Viertelstunde von
// derselben Adresse sind kein Interessent mehr.
//
// Rueckgabe: Sperrdauer in Minuten, 0 = frei.
// Wirft RuntimeException, wenn der Zaehler nicht gefuehrt werden kann --
// siehe Kopf: der Aufrufer lehnt dann ab, er sendet NICHT.
function demo_bremse_pruefen(string $adresse, ?string $verzeichnis = null, ?int $jetzt = null): int
{
    $verzeichnis ??= demo_bremse_verzeichnis();
    $jetzt ??= time();

    if (!is_dir($verzeichnis) && !@mkdir($verzeichnis, 0700, true) && !is_dir($verzeichnis)) {
        throw new RuntimeException('Die Bremse hat kein Verzeichnis: ' . $verzeichnis);
    }
    $datei = demo_bremse_datei($adresse, $verzeichnis);

    // Exklusiv oeffnen und waehrend Lesen UND Schreiben gesperrt halten:
    // Zwei gleichzeitige Anfragen derselben Adresse duerfen nicht beide den
    // alten Stand lesen und sich gegenseitig ueberschreiben.
    $f = @fopen($datei, 'c+');
    if ($f === false) {
        throw new RuntimeException('Die Bremse kann ihren Zaehler nicht oeffnen: ' . $datei);
    }
    try {
        if (!flock($f, LOCK_EX)) {
            throw new RuntimeException('Die Bremse bekommt keine Sperre auf ihren Zaehler.');
        }
        $roh = stream_get_contents($f);
        $zeitpunkte = array_map('intval', array_filter(explode("\n", (string)$roh), fn($z) => trim($z) !== ''));

        $sperre = demo_bremse_entscheiden($zeitpunkte, $jetzt);

        // Auch eine abgewiesene Anfrage wird eingetragen: Wer weiterklopft,
        // verlaengert seine Sperre, statt sie auszusitzen.
        $neu = demo_bremse_aufraeumen($zeitpunkte, $jetzt);
        $neu[] = $jetzt;
        rewind($f);
        ftruncate($f, 0);
        if (fwrite($f, implode("\n", $neu) . "\n") === false) {
            throw new RuntimeException('Die Bremse kann ihren Zaehler nicht schreiben.');
        }
        fflush($f);
    } finally {
        @flock($f, LOCK_UN);
        @fclose($f);
    }

    demo_bremse_kehren($verzeichnis, $jetzt);
    return $sperre;
}

// Gelegentlich alte Zaehler wegraeumen, damit das Verzeichnis nicht
// unbegrenzt waechst. Nicht bei jeder Anfrage -- das waere ein
// Verzeichnisdurchlauf je Formularabsendung fuer nichts.
function demo_bremse_kehren(string $verzeichnis, int $jetzt, int $jede = 50): void
{
    if (random_int(1, $jede) !== 1) { return; }
    $alt = $jetzt - 2 * DEMO_BREMSE_FENSTER_MIN * 60;
    foreach ((array)@glob($verzeichnis . '/*.txt') as $d) {
        if (@filemtime($d) < $alt) { @unlink($d); }
    }
}
