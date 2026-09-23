<?php
// Loest einen Uebergabe-Link ein: Die benannte Person setzt ihr Passwort
// selbst, und dabei entsteht das Erstkonto des Mandanten in DESSEN Anlage
// (ENT-686). Ersetzt backend/setup.php.
//
// STEHT IN OHNE_ANMELDUNG (pruefungen/test_php.mjs): derselbe Grund wie bei
// mandant_einladung_pruefen.php -- wer eingeladen ist, hat noch keinen
// Zugang. Der Ausweis ist der Token, und er liegt als Abdruck in der
// Datenbank (ENT-501).
//
// WAS DIESER ENDPUNKT NICHT TUT, und das ist der Punkt: Er meldet NICHT an.
// Er legt das Konto an, danach fuehrt der gewoehnliche Weg ueber login.php --
// mitsamt Bremse und allem, was dort sonst noch haengt. Eine Sitzung gleich
// hier auszustellen waere ein zweiter Eingang in die Anlage, einer, den ein
// Link aus einem Postfach alleine oeffnet. Dieselbe Zusage wie bei
// betreiber_einladung_einloesen.php.
//
// NUR POST. Ein GET wuerde die Vorschau eines Mailprogramms ausloesen und
// damit die Uebergabe verbrauchen, bevor ein Mensch sie gesehen hat.
//
// WARUM DIESER ENDPUNKT ZUR MANDANTENDATENBANK VERBINDET (Eintrag in
// DARF_VERBINDEN, pruefungen/test_betreiber.mjs): Das Konto MUSS dort
// entstehen -- die Anlage des Mandanten ist der Ort, an dem er sich danach
// anmeldet. Gelesen werden dabei keine Betriebsdaten: der Bauplan und die
// ANZAHL der Menschen in `mitarbeiter`. Geschrieben wird genau eine Zeile,
// das erste Konto einer leeren Anlage. Das ist kein Support-Zugriff -- der
// haengt unveraendert an betreiber_support.php mit Freigabe und Protokoll --
// und es ist auch kein Weg, auf dem ein Betreiber irgendetwas sehen koennte:
// Hier handelt der Kunde, nicht der Betreiber.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../logbuch.php';
require_once __DIR__ . '/../mitarbeiter.php';             // ma_nur_menschen(), ma_personalnummer_generieren()
require_once __DIR__ . '/../planung_einrichten_kern.php';  // kern_schema_fehlend()

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in    = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$token = (string)($in['token'] ?? '');
$pass  = (string)($in['passwort'] ?? '');

$adresse = anmeld_adresse();
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen(db(), 'ma-uebergabe:', $adresse);
$sperre = anmeld_sperre(0, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => 'Zu viele Versuche. Bitte in ' . $sperre . ' Minuten erneut versuchen.'], 429);
}

$pdo = betreiber_db();
if (!mandant_einladung_tabelle_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Dieser Bereich ist noch nicht eingerichtet.'], 503);
}

$e = mandant_einladung_zu_token($pdo, $token);
if ($e === null) {
    anmeld_fehlversuch(db(), 'ma-uebergabe:', $adresse);
    json_response(['status' => 'error',
        'message' => 'Dieser Link gilt nicht mehr. Bitte eine neue Einladung anfordern '
                   . 'bei der Person, die den Zugang eingerichtet hat.'], 404);
}

// Ein Mandant, der zwischen Versand und Einloesen gesperrt oder gekuendigt
// wurde. Zwei Zustaende, zwei Aussagen -- und beide etwas anderes als "der
// Link gilt nicht mehr" darueber.
if ((string)$e['mandant_status'] !== 'aktiv') {
    json_response(['status' => 'error',
        'message' => 'Für diesen Betrieb ist der Zugang derzeit nicht freigeschaltet. '
                   . 'Bitte melden Sie sich bei der Person, die den Zugang eingerichtet hat.'], 409);
}

// istAdmin = true, also die Verwaltungsschwelle: Dieses Konto ist eines
// (ist_admin = 1 weiter unten). Die Zahl steht in backend/anmeldung.php und
// nirgends sonst -- ein Kommentar, der sie abschreibt, wird beim naechsten
// Bemessen zur Falschaussage.
$fehler = passwort_pruefen($pass, (string)$e['email'], true);
if ($fehler !== null) {
    // KEIN Fehlversuch: Der Link war richtig, nur das Passwort zu schwach.
    // Wer daran gezaehlt wuerde, sperrte sich beim Ausprobieren selbst aus.
    json_response(['status' => 'error', 'message' => $fehler], 400);
}

$mandantId = (int)$e['mandant_id'];
$person    = be_name_bauen((string)$e['vorname'], (string)$e['nachname']);

// ── Die Anlage, in der das Konto entsteht ──────────────────────────────
//
// Der Mandant kommt aus derselben Abfrage wie die Einladung; ein zweites
// Suchen waere ein zweiter Ort, an dem dieselbe Zeile gelesen wird.
$m = ['db_host' => $e['db_host'], 'db_name' => $e['db_name'],
      'db_user' => $e['db_user'], 'secret_name' => $e['secret_name']];
$lage = mandant_verbindung_bereit($m);
if ($lage !== 'bereit') {
    // NICHT ERREICHBAR IST NICHT "LINK UNGUELTIG". Der Link ist in Ordnung,
    // die Anlage antwortet nicht -- und die Person soll es noch einmal
    // versuchen koennen, statt eine neue Einladung anzufordern.
    json_response(['status' => 'error',
        'message' => 'Der Zugang lässt sich gerade nicht einrichten. '
                   . 'Ihr Link bleibt gültig — bitte in Kürze erneut versuchen.'], 503);
}
try {
    $anlage = mandant_db($m);
} catch (Throwable $ex) {
    json_response(['status' => 'error',
        'message' => 'Der Zugang lässt sich gerade nicht einrichten. '
                   . 'Ihr Link bleibt gültig — bitte in Kürze erneut versuchen.'], 503);
}

// DIE VOLLPRUEFUNG, nicht das Zaehlen von Tabellen -- die Lehre aus demo6
// und demo8 (Befund 2026-09-19): Dort waren alle Tabellen da, die
// nachtraeglichen Spalten fehlten, und beide galten als "eingerichtet". Eine
// halbe Anlage wird nicht uebergeben.
//
// DER TEXT NENNT DIE LUECKEN NICHT: Hier steht ein Kunde davor, kein
// Betreiber. Wieviele Spalten fehlen, hilft ihm nicht und gehoert nicht nach
// draussen; der Betreiber sieht es beim Ausstellen.
if (kern_schema_fehlend($anlage) !== []) {
    json_response(['status' => 'error',
        'message' => 'Der Zugang lässt sich gerade nicht einrichten. '
                   . 'Ihr Link bleibt gültig — bitte melden Sie sich bei der Person, '
                   . 'die ihn Ihnen geschickt hat.'], 503);
}

// Steht schon ein Mensch in der Anlage, ist sie uebergeben. Dieselbe Frage,
// mit der sich setup.php gesperrt hat, mit derselben Ausnahme: Das
// Support-Konto zaehlt nicht mit (ENT-631) -- es entsteht bei der
// Einrichtung, also bevor der erste Mensch da ist. Wuerde es mitgezaehlt,
// waere jede frisch eingerichtete Anlage schon "uebergeben".
//
// ZWEITE, UNABHAENGIGE SPERRE gegen ein doppeltes Erstkonto, neben dem
// Beanspruchen der Einladung darunter. Sie steht hier, weil sie in der
// Anlage selbst nachsieht statt in der Betreiber-Datenbank -- die beiden
// koennten auseinanderlaufen, und dann entscheidet die Anlage.
$menschen = (int)$anlage->query(
    'SELECT COUNT(*) AS c FROM mitarbeiter WHERE ' . ma_nur_menschen($anlage)
)->fetch()['c'];
if ($menschen > 0) {
    json_response(['status' => 'error',
        'message' => 'Für diesen Betrieb ist der Zugang bereits eingerichtet. '
                   . 'Bitte melden Sie sich mit Ihrem Passwort an, oder benutzen Sie '
                   . '„Passwort vergessen".'], 409);
}

// ── Beanspruchen, dann anlegen ────────────────────────────────────────
//
// ZWEI DATENBANKEN, KEINE GEMEINSAME TRANSAKTION. Die Reihenfolge ist darum
// eine Entscheidung: Erst wird die Einladung beansprucht (ein Wettlauf, den
// genau einer gewinnt), dann das Konto angelegt. Scheitert das Anlegen, wird
// die Einladung wieder freigegeben. Umgekehrt waere schlimmer -- dann
// entstuende das Konto, und der Link blieb gueltig.
//
// WAS DAMIT NICHT ABGEDECKT IST, und es steht hier, damit es niemand fuer
// abgedeckt haelt: Bricht der Aufruf zwischen dem Anlegen und dem Commit der
// Beanspruchung ab (Prozess weg, Netz weg), steht die Einladung als
// eingeloest da, ohne dass jemand hineinkommt. Ein neuer Link heilt das, und
// der Zaehler oben laesst ihn zu: Ein Konto gibt es dann nicht.
if (!mandant_einladung_beanspruchen($pdo, $mandantId)) {
    json_response(['status' => 'error',
        'message' => 'Dieser Link wurde soeben schon benutzt.'], 409);
}

try {
    // Personalnummer gleich mit (ENT-684): JEDER Weg, der eine Person
    // anlegt, vergibt ihr eine -- test_php.mjs prueft das ueber alle Wege.
    // setup.php tat es bis ENT-684 nicht, und bei jedem neuen Mandanten
    // entstand darum genau eine Person ohne Nummer.
    $anlage->prepare(
        'INSERT INTO mitarbeiter (name, password_hash, ist_admin, personalnummer)
         VALUES (?, ?, 1, ?)'
    )->execute([
        $person,
        password_hash($pass, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]),
        ma_personalnummer_generieren($anlage),
    ]);
} catch (Throwable $ex) {
    mandant_einladung_freigeben($pdo, $mandantId);
    json_response(['status' => 'error',
        'message' => 'Der Zugang liess sich nicht einrichten. '
                   . 'Ihr Link bleibt gültig — bitte in Kürze erneut versuchen.'], 500);
}

// Logbuch (ENT-614) in der BETREIBER-Datenbank, wo auch das Einladen steht --
// zusammen ergeben die beiden Eintraege, wie die Uebergabe verlaufen ist.
//
// AKTEUR IST DIE EINGELADENE PERSON, nicht der Betreiber: Es gibt hier
// niemanden, der angemeldet waere, und genau das soll dastehen. Id 0, weil
// diese Person kein Betreiber-Konto hat und nie eines bekommt.
be_log($pdo, ['id' => 0, 'name' => $person],
       'mandant', $mandantId, 'erstkonto eingelöst', null, $person);

json_response(['status' => 'ok', 'name' => $person]);
