<?php
// Demo-Zugang anfordern -- oeffentlich, ohne Anmeldung (ENT-601/ENT-603).
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
//   3. Ab hier derselbe Ablauf wie vorher bei der Betreiber-Freigabe:
//      Platz waehlen, Instanz leeren und befuellen, Konto anlegen,
//      Register schreiben, Mail verschicken.
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
require_once __DIR__ . '/../mailer.php';

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

if ($firma === '' || $person === '' || $email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    json_response(['status' => 'error',
        'message' => 'Bitte Firma, Name und eine gültige E-Mail-Adresse angeben.'], 400);
}
// Telefon ist der Preis fuer den Sofort-Zugang (Entscheidung des
// Projektinhabers, siehe demo_zugang.php) -- Pflichtfeld, nicht optional.
if (demo_zugang_telefon_ziffern($telefon) < DEMO_ZUGANG_TELEFON_MIN_ZIFFERN) {
    json_response(['status' => 'error',
        'message' => 'Bitte eine Telefonnummer angeben, unter der wir Sie erreichen.'], 400);
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
if (!hat_tabelle($pdo, 'demo_zugang') || !hat_tabelle($pdo, 'mandant')) {
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
    $ergebnis = demo_zugang_neues_passwort($pdo, $bestehend);
    if ($ergebnis['fehler'] !== null) {
        error_log('demo_anfordern (bestehender Zugang): ' . $ergebnis['fehler']);
    } else {
        try {
            smtp_senden($email, $person, $ergebnis['mail']['betreff'],
                $ergebnis['mail']['html'], $ergebnis['mail']['text']);
        } catch (Throwable $e) {
            error_log('demo_anfordern (bestehender Zugang): Versand fehlgeschlagen -- ' . $e->getMessage());
        }
    }
    json_response(['status' => 'ok', 'message' => DEMO_ANFORDERN_DANKE]);
}

// ── 4. Freien Platz waehlen ────────────────────────────────────────────
$belegt = $pdo->query("SELECT platz FROM demo_zugang WHERE status = 'aktiv'")
              ->fetchAll(PDO::FETCH_COLUMN);
$platz = demo_platz_waehlen(array_map('strval', $belegt));
if ($platz === null) {
    // "Kein Platz frei" ist ein ehrlicher, sichtbarer Zustand -- kein
    // Interessent soll auf eine Zusage warten, die nicht kommt.
    json_response(['status' => 'error',
        'message' => 'Aktuell sind alle Demo-Plätze belegt. Bitte in Kürze erneut versuchen.'], 409);
}

$stmt = $pdo->prepare('SELECT * FROM mandant WHERE subdomain = ? LIMIT 1');
$stmt->execute([$platz]);
$m = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    error_log("demo_anfordern: Platz „$platz“ ist im Mandantenstamm nicht eingetragen.");
    json_response(['status' => 'error',
        'message' => 'Der Demo-Bereich ist noch nicht vollständig eingerichtet. Bitte in Kürze erneut versuchen.'], 503);
}
$lage = mandant_verbindung_bereit($m);
if ($lage !== 'bereit') {
    error_log("demo_anfordern: Platz „$platz“ nicht verbunden ($lage).");
    json_response(['status' => 'error',
        'message' => 'Der Demo-Bereich ist noch nicht vollständig eingerichtet. Bitte in Kürze erneut versuchen.'], 503);
}
$stand = mandant_stand($m);
if (!$stand['erreichbar'] || !empty($stand['fehlend'])) {
    error_log("demo_anfordern: Platz „$platz“ noch nicht eingerichtet.");
    json_response(['status' => 'error',
        'message' => 'Der Demo-Bereich ist noch nicht vollständig eingerichtet. Bitte in Kürze erneut versuchen.'], 503);
}

// ── 5. Instanz leeren, befuellen, Konto anlegen ───────────────────────
$fehler = demo_instanz_leeren($pdo, $platz);
if ($fehler !== null) {
    error_log('demo_anfordern: ' . $fehler);
    json_response(['status' => 'error',
        'message' => 'Der Demo-Zugang konnte gerade nicht eingerichtet werden. Bitte in Kürze erneut versuchen.'], 503);
}
$instanz = mandant_db($m);
demo_daten_erzeugen_ausfuehren($instanz);

$vergeben = $instanz->query('SELECT name FROM mitarbeiter')->fetchAll(PDO::FETCH_COLUMN);
$login    = demo_login_bilden($firma, array_map('strval', $vergeben));
$passwort = demo_passwort_erzeugen();

$teile    = preg_split('/\s+/', $person) ?: [$person];
$nachname = count($teile) > 1 ? array_pop($teile) : $person;
$vorname  = count($teile) > 0 ? implode(' ', $teile) : '';
$instanz->prepare(
    'INSERT INTO mitarbeiter (name, password_hash, ist_admin, vorname, nachname, aktiv)
     VALUES (?, ?, 1, ?, ?, 1)'
)->execute([$login, password_hash($passwort, PASSWORD_DEFAULT), $vorname, $nachname]);

// ── 6. Register ────────────────────────────────────────────────────────
$start    = date('Y-m-d H:i:s');
$laeuftAb = demo_zugang_ablauf($start);
$ein = $pdo->prepare(
    'INSERT INTO demo_zugang (platz, firma, person, email, telefon, login, status,
                              freigegeben_am, freigegeben_von, laeuft_ab_am)
     VALUES (?, ?, ?, ?, ?, ?, \'aktiv\', ?, ?, ?)'
);
$ein->execute([$platz, $firma, $person, $email, $telefon, $login, $start, DEMO_FREIGEGEBEN_AUTOMATISCH, $laeuftAb]);

// ── 7. Mail ────────────────────────────────────────────────────────────
// Ein Versandfehler aendert die Antwort nicht (siehe Dateikopf) -- er wird
// nur protokolliert, damit ihn jemand sehen kann, ohne dass der Interessent
// je ein Passwort in der HTTP-Antwort zu sehen bekommt.
$adresse = (string)demo_platz_adresse($platz);
$mail    = demo_zugang_mail($firma, $person, $adresse, $login, $passwort, $laeuftAb);
try {
    smtp_senden($email, $person, $mail['betreff'], $mail['html'], $mail['text']);
} catch (Throwable $e) {
    error_log('demo_anfordern: Versand fehlgeschlagen -- ' . $e->getMessage());
}

json_response(['status' => 'ok', 'message' => DEMO_ANFORDERN_DANKE]);
