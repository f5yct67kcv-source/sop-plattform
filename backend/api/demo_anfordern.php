<?php
// Demo-Zugang anfordern -- oeffentlich, ohne Anmeldung (ENT-601/ENT-613).
//
// Der Nachfolger von betreiber_demo_freigeben.php: Bis hierher schaltete
// ein Betreiber jeden Interessenten von Hand frei. Sobald bezahlte Werbung
// Anfragen in Stoessen statt einzeln bringt, ist das eine Warteschlange --
// und der Projektinhaber will ausdruecklich keine: "ich kann da unmoeglich
// zwei bis drei Tage warten, [...] Leute wollen Demo buchen und sie wollen
// es sofort nutzen koennen" (ENT-601). Dieser Endpunkt tut darum genau das,
// was vorher der Betreiber-Klick tat, nur automatisch und mit den
// Missbrauchsbremsen, die vorher der Mensch war:
//
//   1. Honigtopf und zwei Bremsen (IP UND E-Mail-Adresse) VOR jeder
//      Datenbankarbeit -- ein Bot, der durchkommt, kostet sonst einen
//      Demo-Platz je Versuch.
//   2. Hoechstens EIN aktiver Zugang je E-Mail-Adresse: Kommt dieselbe
//      Adresse ein zweites Mal, wird nichts Neues angelegt, sondern das
//      bestehende Konto bekommt ein neues Passwort zugeschickt -- dasselbe
//      Verhalten wie "Zugangsdaten erneut senden" (demo_erneut_senden.php),
//      absichtlich dieselbe Antwort.
//   3. Seit ENT-624 entsteht hier KEIN Zugang mehr. Dieser Endpunkt legt
//      nur eine offene Anfrage an und verschickt einen Bestaetigungslink;
//      Platz, Instanz, Konto und Register entstehen erst in
//      api/demo_bestaetigen.php. Grund: Bis dahin bewies keine der
//      Pruefungen, dass die Adresse dem Anfragenden gehoert -- ein Skript
//      mit zehn erreichbaren Wegwerf-Domains raeumte den Vorrat leer.
//      Ausfuehrlich im Kopf von demo_bestaetigung.php.
//
// DIE ZUSTIMMUNG WIRD IM SERVER GEPRUEFT, nicht nur im Formular (ENT-624).
// Das Haekchen ist Pflicht; der Abdruck -- Zeitpunkt, IP, Fassung des
// Textes, Rueckruf-Widerspruch -- steht am Bestaetigungssatz und bleibt
// auch nach dem Einloesen erhalten.
//
// KEIN PASSWORT IN DER ANTWORT. Anders als beim Betreiber-Endpunkt (dort
// als Rueckfall gedacht, falls die Mail nicht ankommt, und nur fuer den
// angemeldeten Betreiber sichtbar) ist diese Antwort oeffentlich. Ein
// Passwort darin waere in jedem Browserverlauf, jedem Proxy-Log und jeder
// Fehlerueberwachung lesbar. Scheitert der Versand, bleibt der Zugang
// gueltig; "Zugangsdaten erneut senden" ist der Weg zurueck.
//
// WARUM KEIN ANMELDELINK STATT EINES PASSWORTS (ENT-601 nannte einen):
// passwort_zuruecksetzen.php verweigert einen Link ausdruecklich fuer jedes
// Verwaltungskonto (siehe dort), und der Demo-Zugang bekommt bewusst die
// volle Verwaltungsrolle (ENT-600 Punkt 6). Ein Link ueber denselben Weg
// wuerde also nie funktionieren; ein eigener, zweiter Link-Mechanismus nur
// fuer die Demo waere eine zusaetzliche, kaum genutzte Angriffsflaeche fuer
// wenig Gewinn. Ein frisch erzeugtes Passwort fuer ein frisch angelegtes
// Konto ist nicht der Vorgang, den der Projektinhaber ausschliessen wollte
// ("einfach eine Mailadresse eingeben und ein Passwort zuruecksetzen") --
// dort geht es um das Zuruecksetzen eines BESTEHENDEN Kontos ueber eine
// eingetippte Adresse. Hier entsteht das Konto erst mit der Anfrage, und
// nur die hinterlegte Adresse bekommt die Zugangsdaten je zu sehen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../demo_bremse.php';
require_once __DIR__ . '/../demo_daten.php';
require_once __DIR__ . '/../demo_instanz.php';
require_once __DIR__ . '/../demo_bestaetigung.php';
require_once __DIR__ . '/../mailer.php';

// Schickt eine Meldung an den Betreiber -- und schweigt, wenn etwas daran
// scheitert.
//
// DIE MELDUNG DARF DEN INTERESSENTEN NIE ETWAS KOSTEN. Sie ist unsere
// Bequemlichkeit, nicht seine: Ein nicht eingerichteter Empfaenger, ein
// stummer SMTP-Server oder ein Fehler beim Aufbau duerfen weder seine
// Antwort veraendern noch seinen Zugang verhindern. Darum ohne Ausnahme
// nach aussen, nur mit Eintrag ins Fehlerprotokoll -- dieselbe Haltung wie
// beim Versand an ihn selbst weiter unten.
function demo_betreiber_melden(array $mail, string $anlass, bool $faellig): void
{
    if (!$faellig) { return; }
    $an = demo_zugang_empfaenger();
    if ($an === null) {
        // "Nicht eingerichtet" ist etwas anderes als "fehlgeschlagen" --
        // im Protokoll steht darum, welcher der beiden Faelle es war.
        error_log("demo_anfordern ($anlass): kein Empfaenger im Deploy hinterlegt.");
        return;
    }
    try {
        smtp_senden($an, 'GuardOpS', $mail['betreff'], $mail['html'], $mail['text']);
    } catch (Throwable $e) {
        error_log("demo_anfordern ($anlass): Versand fehlgeschlagen -- " . $e->getMessage());
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input') ?: '', true) ?: [];

// ── 1. Honigtopf ───────────────────────────────────────────────────────
// Dieselbe Falle wie beim Kontaktformular (demo_anfrage.php): ein Feld,
// das Menschen nicht sehen und Skripte ausfuellen. Wer es fuellt, bekommt
// dieselbe Antwort wie alle -- und beruehrt weder Bremse noch Datenbank.
if (demo_zugang_ist_falle($in)) {
    json_response(['status' => 'ok', 'message' => DEMO_ANFORDERN_DANKE]);
}

$firma   = demo_zugang_einzeilig($in['firma'] ?? '', DEMO_ZUGANG_MAX_FIRMA);
$person  = demo_zugang_einzeilig($in['person'] ?? $in['name'] ?? '', DEMO_ZUGANG_MAX_NAME);
$email   = demo_zugang_einzeilig($in['email'] ?? '', DEMO_ZUGANG_MAX_EMAIL);
$telefon = demo_zugang_einzeilig($in['telefon'] ?? '', DEMO_ZUGANG_MAX_TELEFON);
// Die Zustimmung zu den Nutzungsbedingungen (ENT-624). Pflicht, und zwar
// im SERVER geprueft: Eine Sperre, die man am Browser vorbei umgehen kann,
// ist keine (CLAUDE.md). Ohne sie gibt es keinen Abdruck, und ohne Abdruck
// ist die Zustimmung nichts wert.
$bedingungen = !empty($in['bedingungen']);
// Widerspruch, keine Einwilligung: Wer seine Nummer fuer einen Demo-Zugang
// hinterlaesst, rechnet mit einem Rueckruf (Entscheidung des
// Projektinhabers am 2026-09-19). Wer keinen will, sagt es hier.
$keinRueckruf = !empty($in['kein_rueckruf']);

if ($firma === '' || $person === '' || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_response(['status' => 'error',
        'message' => 'Bitte Firma, Name und eine gültige E-Mail-Adresse angeben.'], 400);
}
// Telefon ist der Preis fuer den Sofort-Zugang (Entscheidung des
// Projektinhabers, siehe demo_zugang.php) -- Pflichtfeld, nicht optional.
if (!$bedingungen) {
    json_response(['status' => 'error', 'felder' => ['bedingungen' => true],
        'message' => 'Bitte bestätigen Sie die Nutzungsbedingungen und die Datenschutzerklärung.'], 400);
}
if (!demo_zugang_telefon_gueltig($telefon)) {
    json_response(['status' => 'error', 'felder' => ['telefon' => true],
        'message' => 'Bitte eine Telefonnummer aus der Schweiz, Deutschland oder Österreich angeben — mit Landesvorwahl, z. B. +41 79 123 45 67.'], 400);
}
// Existiert die Domain ueberhaupt? Eine Anfrage verbraucht sofort einen von
// zehn knappen Plaetzen -- eine Adresse, die es nicht gibt, waere ein
// Platz, den niemand je abholt. "Nicht pruefbar" (null) wird durchgelassen.
if (demo_zugang_adresse_zustellbar($email) === false) {
    json_response(['status' => 'error',
        'message' => 'Diese E-Mail-Adresse scheint es nicht zu geben. Bitte prüfen und erneut versuchen.'], 400);
}

// ── 2. Zwei Bremsen: IP UND E-Mail-Adresse ────────────────────────────
// Ein eigenes Verzeichnis, getrennt von der Bremse des Kontaktformulars
// (demo_bremse.php) -- sonst zaehlte eine harmlose Kontaktanfrage gegen
// das Kontingent einer Demo-Anforderung und umgekehrt.
$verzeichnis = demo_bremse_verzeichnis() . '-zugang';
$ip = demo_bremse_adresse();
try {
    $sperreIp = demo_bremse_pruefen($ip, $verzeichnis);
    $sperreEmail = demo_bremse_pruefen('email:' . mb_strtolower($email), $verzeichnis);
} catch (Throwable $e) {
    // Die Bremse faellt zu, nicht auf (siehe demo_bremse.php) -- ein
    // Verzeichnis, das nicht beschrieben werden kann, ist der gefaehrlichste
    // Zustand, nicht der harmloseste.
    json_response(['status' => 'error',
        'message' => 'Die Anfrage kann gerade nicht bearbeitet werden. Bitte später erneut versuchen.'], 503);
}
$sperre = max($sperreIp, $sperreEmail);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => "Zu viele Anfragen. Bitte $sperre Minuten warten."], 429);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'demo_zugang') || !hat_tabelle($pdo, 'mandant')
    || !hat_tabelle($pdo, 'demo_bestaetigung')) {
    json_response(['status' => 'error',
        'message' => 'Der Demo-Bereich ist noch nicht eingerichtet.'], 503);
}

// ── 3. Hoechstens ein aktiver Zugang je E-Mail-Adresse (ENT-601) ──────
// Dieselbe Adresse ein zweites Mal heisst: neues Passwort fuer das
// BESTEHENDE Konto, keine zweite Instanz. Das ist wortgleich der Ablauf
// von demo_erneut_senden.php -- absichtlich dieselbe Funktion, ein Aufruf.
$stmt = $pdo->prepare("SELECT * FROM demo_zugang WHERE status = 'aktiv' AND email = ? LIMIT 1");
$stmt->execute([$email]);
$bestehend = $stmt->fetch(PDO::FETCH_ASSOC);
if ($bestehend) {
    // true = "diese Adresse hat schon einen Zugang" (ENT-623). Die Mail
    // sagt dann zuerst genau das, statt wie beim ersten Mal auszusehen --
    // sie traegt trotzdem ein Passwort, weil es sonst keinen Weg zurueck
    // gibt (Begruendung bei demo_zugang_bekannt_mail()).
    $ergebnis = demo_zugang_neues_passwort($pdo, $bestehend, true);
    if ($ergebnis['fehler'] !== null) {
        error_log('demo_anfordern (bestehender Zugang): ' . $ergebnis['fehler']);
    } else {
        try {
            smtp_senden($email, $person, $ergebnis['mail']['betreff'],
                $ergebnis['mail']['html'], $ergebnis['mail']['text'],
                [], $ergebnis['mail']['bilder'] ?? []);
        } catch (Throwable $e) {
            error_log('demo_anfordern (bestehender Zugang): Versand fehlgeschlagen -- ' . $e->getMessage());
        }
        // Auch dieser Fall wird gemeldet (ENT-623, Revision von ENT-622):
        // Wer sich ein zweites Mal meldet, ist selbst ein Signal -- und
        // ohne diese Meldung liess sich beim Testen nicht unterscheiden,
        // ob die Meldungen gehen oder ob es nichts zu melden gab. Eigener
        // Betreff, damit sie nicht mit einer Neuanmeldung verwechselt wird.
        //
        // Nur im Erfolgsfall: Konnte das Passwort nicht gesetzt werden,
        // stimmt die Aussage "der bestehende Zugang hat ein neues
        // Passwort bekommen" nicht. Der Fehler steht dann im Protokoll.
        demo_betreiber_melden(
            demo_erneut_mail((string)$bestehend['firma'], (string)$bestehend['person'],
                (string)$bestehend['email'], (string)$bestehend['telefon'],
                (string)$bestehend['platz'],
                (string)demo_platz_adresse((string)$bestehend['platz']),
                (string)$bestehend['laeuft_ab_am']),
            'Meldung ueber erneute Anfrage', true);
    }
    json_response(['status' => 'ok', 'message' => DEMO_ANFORDERN_DANKE]);
}

// ── 4. Ist ueberhaupt ein Platz frei? ─────────────────────────────────
//
// Geprueft wird das SCHON HIER, obwohl der Platz erst beim Bestaetigen
// vergeben wird: Jemanden erst eine Mail holen und ihn dann nach dem Klick
// abweisen zu lassen, waere der unfreundlichste mögliche Ablauf. Reserviert
// wird trotzdem nichts -- sonst waere die Luecke nur verschoben, und ein
// Bot koennte den Vorrat mit unbestaetigten Anfragen blockieren. Wer zuerst
// bestaetigt, bekommt den Platz; demo_bestaetigen.php sagt es notfalls
// noch einmal.
$belegt = $pdo->query("SELECT platz FROM demo_zugang WHERE status = 'aktiv'")
              ->fetchAll(PDO::FETCH_COLUMN);
if (demo_platz_waehlen(array_map('strval', $belegt)) === null) {
    demo_betreiber_melden(demo_vorrat_mail(count(DEMO_PLAETZE)), 'Vorratswarnung',
        demo_warnung_faellig_und_vermerken());
    json_response(['status' => 'error',
        'message' => 'Aktuell sind alle Demo-Plätze belegt. Bitte in Kürze erneut versuchen.'], 409);
}

// ── 5. Offene Anfrage anlegen und den Link verschicken ───────────────
//
// HIER ENTSTEHT NOCH KEIN ZUGANG. Kein Platz, keine Instanz, kein Konto,
// kein Registereintrag -- nur eine Zeile mit dem Abdruck des
// Bestaetigungswerts und dem Abdruck der Zustimmung.
//
// Aeltere offene Anfragen derselben Adresse werden entwertet: Sonst hat
// jemand, der dreimal absendet, drei gueltige Links, und der Abdruck sagt
// nicht mehr, welche Zustimmung zum Zugang gehoert.
$pdo->prepare('DELETE FROM demo_bestaetigung WHERE email = ? AND eingeloest_am IS NULL')
    ->execute([$email]);

$wert = demo_bestaetigung_wert();
$pdo->prepare(
    'INSERT INTO demo_bestaetigung (wert_abdruck, firma, person, email, telefon,
                                    bedingungen_fassung, kein_rueckruf, zustimmung_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
)->execute([demo_bestaetigung_abdruck($wert), $firma, $person, $email, $telefon,
    DEMO_BEDINGUNGEN_FASSUNG, $keinRueckruf ? 1 : 0, $ip]);

$link = demo_bestaetigung_link($wert);
if ($link === null) {
    // Die Adresse der Verkaufsseite steht nicht im Deploy. Dann gibt es
    // keinen Link, und eine Mail ohne Link waere schlimmer als keine --
    // "noch nicht eingerichtet" ist etwas anderes als "fehlgeschlagen".
    error_log('demo_anfordern: keine Basis-Adresse fuer den Bestaetigungslink hinterlegt.');
    json_response(['status' => 'error',
        'message' => 'Der Demo-Bereich ist noch nicht vollständig eingerichtet. '
            . 'Bitte in Kürze erneut versuchen.'], 503);
}

$mail = demo_bestaetigung_mail($firma, $person, $link);
try {
    smtp_senden($email, $person, $mail['betreff'], $mail['html'], $mail['text'],
        [], $mail['bilder'] ?? []);
} catch (Throwable $e) {
    error_log('demo_anfordern: Versand fehlgeschlagen -- ' . $e->getMessage());
}

// KEINE Meldung an den Betreiber an dieser Stelle: Eine unbestaetigte
// Anfrage ist kein Interessent, sondern eine Absichtserklaerung -- und
// genau die kann ein Bot in Serie erzeugen. Gemeldet wird beim
// Bestaetigen (demo_bestaetigen.php).

json_response(['status' => 'ok', 'message' => DEMO_ANFORDERN_DANKE]);
