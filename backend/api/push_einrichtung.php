<?php
declare(strict_types=1);
// Benachrichtigungen ein- und ausschalten -- fuer die eigene Person
// (ENT-424).
//
// Kein Recht, sondern strikt eigene Daten: JEDE angemeldete Person darf
// ihre eigenen Geraete anmelden. Die mitarbeiter_id stammt ausnahmslos aus
// der Sitzung, nie aus der Anfrage. Darum steht dieser Endpunkt namentlich
// in der NUR_EIGENE_DATEN-Liste von test_php.mjs.
//
// GET  -- was dieses Geraet wissen muss: Ist Push serverseitig eingerichtet,
//         wie lautet der oeffentliche Schluessel, und habe ich hier schon
//         ein Abo?
// POST -- Abo anlegen ("an": endpunkt, keys) oder abmelden ("aus": endpunkt).
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../push.php';

$user = require_session();
$ich  = (int)$user['id'];
$pdo  = db();
$jetzt = date('Y-m-d H:i:s');

// Ohne Tabelle ist Push nicht eingerichtet -- das ist etwas anderes als
// "ausgeschaltet", und die App sagt beides verschieden (Hausregel:
// "unbekannt" darf nie wie "keine" aussehen).
$tabelleDa = hat_tabelle($pdo, 'push_abo');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $endpunkt = trim((string)($_GET['endpunkt'] ?? ''));
    $abo = null;
    if ($tabelleDa && $endpunkt !== '') {
        $st = $pdo->prepare('SELECT id, erstellt_am, letzter_erfolg FROM push_abo
                              WHERE mitarbeiter_id = ? AND endpunkt = ? AND abgemeldet_am IS NULL');
        $st->execute([$ich, $endpunkt]);
        $abo = $st->fetch() ?: null;
    }
    // Wie viele Geraete hat diese Person insgesamt? Beantwortet die Frage
    // "habe ich das auf dem anderen Telefon schon eingeschaltet?", ohne
    // dass sie dort nachsehen muss.
    $geraete = 0;
    if ($tabelleDa) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM push_abo WHERE mitarbeiter_id = ? AND abgemeldet_am IS NULL');
        $st->execute([$ich]);
        $geraete = (int)$st->fetchColumn();
    }
    json_response([
        'status'        => 'ok',
        'eingerichtet'  => $tabelleDa && push_konfiguriert(),
        'tabelle_da'    => $tabelleDa,
        'schluessel'    => push_oeffentlicher_schluessel(),
        'dieses_geraet' => $abo !== null,
        'geraete'       => $geraete,
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

if (!$tabelleDa) {
    json_response(['status' => 'error',
        'message' => 'Die Benachrichtigungen sind noch nicht eingerichtet — einmal „Einrichtung" ausführen.'], 400);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$endpunkt = trim((string)($in['endpunkt'] ?? ''));

if ($endpunkt === '' || push_ursprung($endpunkt) === null) {
    json_response(['status' => 'error', 'message' => 'Kein gültiger Endpunkt (https erwartet)'], 400);
}

// ── Abmelden
if (!empty($in['aus'])) {
    // NUR eigene Abos: Ohne die mitarbeiter_id in der Bedingung liesse
    // sich mit einem fremden Endpunkt jemand anderem die Benachrichtigung
    // abstellen.
    $st = $pdo->prepare('SELECT id FROM push_abo WHERE mitarbeiter_id = ? AND endpunkt = ? AND abgemeldet_am IS NULL');
    $st->execute([$ich, $endpunkt]);
    $id = $st->fetchColumn();
    if ($id) { push_abo_abmelden($pdo, (int)$id, 'selbst abgeschaltet', $jetzt); }
    // Kein Fehler, wenn es kein Abo gab: Ausschalten, was schon aus ist,
    // ist keine Stoerung.
    json_response(['status' => 'ok', 'an' => false]);
}

// ── Anmelden
$kanal = trim((string)($in['kanal'] ?? 'webpush'));
if (!push_kanal_gueltig($kanal)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Kanal'], 400);
}
if (!push_konfiguriert()) {
    // Ein Abo ohne Schluessel waere ein Eintrag, an den nie etwas
    // zugestellt werden kann -- und die App zeigte "eingeschaltet".
    json_response(['status' => 'error',
        'message' => 'Auf dem Server fehlt der Push-Schlüssel — bitte in der Einrichtung hinterlegen.'], 400);
}

// p256dh und auth kommen vom Browser mit dem Abo. Sie werden heute NICHT
// gebraucht (es wird ohne Nutzlast verschickt, siehe push.php), aber
// mitgespeichert: Sie stammen aus genau diesem Abo, und ohne sie muesste
// spaeter jede Person ihr Abo neu erteilen, falls doch einmal ein Titel
// mitgeschickt werden soll.
$p256dh = trim((string)($in['p256dh'] ?? ''));
$auth   = trim((string)($in['auth'] ?? ''));
// Geraetebezeichnung: freiwillig und kurz, damit in der Verwaltung nicht
// nur eine Nummer steht. KEIN vollstaendiger User-Agent -- der ist ein
// Wiedererkennungsmerkmal und wird hier nicht gebraucht.
$geraet = mb_substr(trim((string)($in['geraet'] ?? '')), 0, 60);

// Derselbe Endpunkt zweimal ist dasselbe Geraet -- dann wird das
// bestehende Abo wiederbelebt statt ein zweites angelegt. Sonst bekaeme
// jemand, der zweimal auf "einschalten" tippt, jede Meldung doppelt.
$st = $pdo->prepare('SELECT id FROM push_abo WHERE mitarbeiter_id = ? AND endpunkt = ?');
$st->execute([$ich, $endpunkt]);
$vorhanden = $st->fetchColumn();

if ($vorhanden) {
    $pdo->prepare('UPDATE push_abo SET abgemeldet_am = NULL, abmeldegrund = NULL, kanal = ?,
                          p256dh = ?, auth = ?, geraet = ?, fehler_zahl = 0, letzter_fehler = NULL
                    WHERE id = ?')
        ->execute([$kanal, $p256dh, $auth, $geraet, (int)$vorhanden]);
    json_response(['status' => 'ok', 'an' => true, 'id' => (int)$vorhanden, 'neu' => false]);
}

$pdo->prepare('INSERT INTO push_abo (mitarbeiter_id, kanal, endpunkt, p256dh, auth, geraet, erstellt_am)
               VALUES (?, ?, ?, ?, ?, ?, ?)')
    ->execute([$ich, $kanal, $endpunkt, $p256dh, $auth, $geraet, $jetzt]);

json_response(['status' => 'ok', 'an' => true, 'id' => (int)$pdo->lastInsertId(), 'neu' => true]);
