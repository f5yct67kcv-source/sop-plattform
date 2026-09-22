<?php
// Prueft einen Einladungslink, bevor die Seite das Formular zeigt (ENT-667).
//
// STEHT IN OHNE_ANMELDUNG (pruefungen/test_php.mjs): Wer eingeladen ist, hat
// naturgemaess noch keinen Zugang -- der Ausweis ist der Token selbst, wie
// bei beleg_oeffentlich.php. Anders als dort ist er hier ein ABDRUCK in der
// Datenbank, nie der Rohwert (ENT-501): Dieser Link setzt ein Passwort auf
// der maechtigsten Ebene der Anlage, er ist kein Lesezugriff auf ein
// Dokument.
//
// WARUM ES DIESEN ENDPUNKT UEBERHAUPT GIBT, statt die Seite einfach das
// Formular zeigen zu lassen: Ein abgelaufener oder schon eingeloester Link
// soll das sagen, BEVOR jemand sich ein Passwort ausdenkt und es zweimal
// eintippt. Die Hausregel "unbekannt darf nie wie keine aussehen" gilt auch
// fuer den Aufwand, den man jemandem umsonst zumutet.
//
// ER GIBT NUR ZURUECK, WAS AUF DER SEITE OHNEHIN STEHEN MUSS: Name und
// Adresse des eingeladenen Kontos, damit die Person sieht, wofuer sie ein
// Passwort setzt. Kein Hash, keine Kontonummer, nichts ueber andere Konten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';

$in    = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$token = (string)($in['token'] ?? '');

// Dieselbe Bremse wie an den uebrigen Eingaengen, unter eigenem Namensraum
// (ENT-373/ENT-524). Ein 256-Bit-Token laesst sich nicht erraten, darum ist
// sie hier keine Abwehr, sondern eine Begrenzung: Sie haelt jemanden davon
// ab, diesen Endpunkt als Dauerlast zu benutzen.
//
// GEWERTET WIRD NUR DIE ADRESSE -- einen Namen gibt es hier nicht, und der
// Namensraum sorgt dafuer, dass die Zaehlung nicht mit der eines Kontos
// verschmilzt. Was er NICHT trennt, ist der Adresszaehler: Wer von einer
// Adresse aus zwanzig tote Links oeffnet, ist danach auch am gewoehnlichen
// Anmeldeweg gebremst. Das ist dasselbe Verhalten wie zwischen login.php
// und passwort_vergessen.php und hier gewollt -- eine Adresse, die sich so
// auffaellig verhaelt, soll ueberall langsamer werden.
$adresse = anmeld_adresse();
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen(db(), 'be-einladung:', $adresse);
$sperre = anmeld_sperre(0, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => 'Zu viele Versuche. Bitte in ' . $sperre . ' Minuten erneut versuchen.'], 429);
}

$pdo = betreiber_db();
if (!be_einladung_tabelle_da($pdo)) {
    json_response(['status' => 'error',
        'message' => 'Der Betreiber-Bereich ist noch nicht eingerichtet.'], 503);
}

$konto = be_einladung_konto($pdo, $token);
if ($konto === null) {
    anmeld_fehlversuch(db(), 'be-einladung:', $adresse);
    // ABGELAUFEN, EINGELOEST UND ERFUNDEN sind hier EINE Aussage, und das
    // ist Absicht: "Dieser Link ist abgelaufen" bestaetigte, dass es ihn
    // einmal gab. Der Text sagt darum, was zu tun ist, statt was war.
    json_response(['status' => 'error',
        'message' => 'Dieser Link gilt nicht mehr. Bitte eine neue Einladung anfordern '
                   . 'bei der Person, die den Zugang eingerichtet hat.'], 404);
}

json_response([
    'status'   => 'ok',
    'name'     => $konto['name'],
    'email'    => $konto['email'],
    'mindestlaenge' => PASSWORT_MIN_ADMIN,
]);
