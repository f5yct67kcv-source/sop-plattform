<?php
// Prueft einen Uebergabe-Link, bevor die Seite das Formular zeigt (ENT-686).
//
// STEHT IN OHNE_ANMELDUNG (pruefungen/test_php.mjs): Wer eingeladen ist, hat
// naturgemaess noch keinen Zugang -- der Ausweis ist der Token selbst, wie
// bei betreiber_einladung_pruefen.php. Er liegt als ABDRUCK in der Datenbank,
// nie im Rohwert (ENT-501): Dieser Link legt den Verwaltungszugang einer
// ganzen Anlage an, er ist kein Lesezugriff auf ein Dokument.
//
// KEIN betreiber_-PRAEFIX, weil dieser Endpunkt keine Betreiber-Anmeldung
// verlangt -- dieselbe Unterscheidung wie bei demo_anfordern.php. Er steht
// deshalb NAMENTLICH in der Liste der oeffentlichen Endpunkte in
// test_betreiber.mjs: Ohne diesen Eintrag saehe die Wache ueber
// mandant_db()-Aufrufer ihn gar nicht.
//
// WARUM ES DIESEN ENDPUNKT GIBT, statt die Seite gleich das Formular zeigen
// zu lassen: Ein abgelaufener oder schon eingeloester Link soll das sagen,
// BEVOR jemand sich ein Passwort ausdenkt und zweimal eintippt.
//
// WARUM ER DIE ANLAGE NICHT ANFASST -- ausdrueckliche Entscheidung, kein
// Versehen: Er koennte zusaetzlich nachsehen, ob die Anlage erreichbar und
// ihr Schema vollstaendig ist. Dagegen sprechen zwei Dinge. Erstens ist die
// Wache ueber die mandant_db()-Aufrufer die wichtigste im Haus; jeder
// weitere Aufrufer weitet sie, und dieser waere ein unangemeldeter. Zweitens
// ist der Fall schon vorher abgefangen: betreiber_mandant_einladen.php
// prueft Erreichbarkeit UND Bauplan, bevor der Link ueberhaupt hinausgeht.
// Bleibt die Anlage, die zwischen Versand und Einloesen kaputtgeht -- die
// meldet mandant_einladung_einloesen.php mit eigenem Text, und nur dort wird
// jemandem ein Handgriff umsonst zugemutet.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';

$in    = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$token = (string)($in['token'] ?? '');

// Dieselbe Bremse wie an den uebrigen Eingaengen, unter EIGENEM Namensraum:
// Ein 256-Bit-Token laesst sich nicht erraten, darum ist sie hier keine
// Abwehr, sondern eine Begrenzung -- sie haelt jemanden davon ab, diesen
// Endpunkt als Dauerlast zu benutzen. Der eigene Namensraum sorgt dafuer,
// dass die Zaehlung nicht mit der eines Kontos verschmilzt; der
// Adresszaehler bleibt geteilt, und das ist gewollt (wie zwischen login.php
// und passwort_vergessen.php): Eine Adresse, die sich auffaellig verhaelt,
// soll ueberall langsamer werden.
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
    // ABGELAUFEN, EINGELOEST UND ERFUNDEN sind EINE Aussage, und das ist
    // Absicht: "Dieser Link ist abgelaufen" bestaetigte, dass es ihn einmal
    // gab. Der Text sagt darum, was zu tun ist, statt was war.
    json_response(['status' => 'error',
        'message' => 'Dieser Link gilt nicht mehr. Bitte eine neue Einladung anfordern '
                   . 'bei der Person, die den Zugang eingerichtet hat.'], 404);
}

// NUR WAS AUF DER SEITE OHNEHIN STEHEN MUSS: der Name des Betriebs und die
// eigene Adresse, damit die Person sieht, wofuer sie ein Passwort setzt.
// Nichts ueber die Anlage, keine Datenbankangaben, keine Kennungen.
json_response([
    'status'        => 'ok',
    'betrieb'       => $e['mandant_name'],
    'person'        => be_name_bauen((string)$e['vorname'], (string)$e['nachname']),
    'email'         => $e['email'],
    'mindestlaenge' => PASSWORT_MIN_ADMIN,
]);
