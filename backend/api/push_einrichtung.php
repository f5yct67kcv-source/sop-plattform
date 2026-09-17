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
//
// SEIT ENT-604 auch fuer natives Push (APNs): `endpunkt` traegt dann das
// Geraete-Token statt einer URL, `kanal` steht auf 'apns'. Dieselbe
// Tabelle, derselbe Endpunkt -- nur die Gueltigkeitspruefung und die
// "eingerichtet"-Frage verzweigen nach Kanal (push.php, Festlegung 1).
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
        // Warum nicht eingerichtet (ENT-424). Die App zeigt es nicht
        // an -- die Mitarbeitenden koennen daran nichts aendern --, aber
        // es steht in der Antwort, damit sich der Fall am Geraet
        // nachsehen laesst, ohne im Cockpit zu suchen.
        'grund'         => $tabelleDa ? push_grund() : 'keine_tabelle',
        'schluessel'    => push_oeffentlicher_schluessel(),
        'dieses_geraet' => $abo !== null,
        'geraete'       => $geraete,
        // Eigene, zusaetzliche Felder fuer die native Huelle (ENT-604) --
        // additiv, damit ein bestehender Abruf aus dem Browser unveraendert
        // bleibt.
        'apns_eingerichtet' => $tabelleDa && push_apns_konfiguriert(),
        'apns_grund'        => $tabelleDa ? push_apns_grund() : 'keine_tabelle',
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
// Der Kanal entscheidet, WAS "endpunkt" ueberhaupt ist -- bei Web Push
// eine URL, bei APNs ein Geraete-Token. Vor der Anmelden-Pruefung
// gebraucht (siehe unten), darum schon hier gelesen; beim Abmelden bleibt
// der bisherige, kanal-unabhaengige Weg (der Wert kollidiert praktisch
// nie zwischen den Formen).
$kanalEingabe = trim((string)($in['kanal'] ?? 'webpush'));
$istApns = $kanalEingabe === 'apns';

if ($endpunkt === '' || (!$istApns && push_ursprung($endpunkt) === null)
                     || ($istApns && !push_apns_token_gueltig($endpunkt))) {
    json_response(['status' => 'error', 'message' => $istApns
        ? 'Kein gültiges Geräte-Token' : 'Kein gültiger Endpunkt (https erwartet)'], 400);
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
$kanal = $kanalEingabe;
if (!push_kanal_gueltig($kanal)) {
    json_response(['status' => 'error', 'message' => 'Unbekannter Kanal'], 400);
}
// Welcher Schluessel zaehlt, haengt vom Kanal ab -- ein Geraet ohne
// Gegenstueck (VAPID fuer Web Push, APNs-Schluessel fuer 'apns') waere
// ein Abo, an das nie etwas zugestellt werden kann, und die App zeigte
// trotzdem "eingeschaltet".
if ($istApns ? !push_apns_konfiguriert() : !push_konfiguriert()) {
    json_response(['status' => 'error',
        'message' => 'Auf dem Server fehlt der Push-Schlüssel — bitte in der Einrichtung hinterlegen.'], 400);
}

// p256dh und auth kommen vom Browser mit dem Web-Push-Abo. Sie werden
// heute NICHT gebraucht (es wird ohne Nutzlast verschickt, siehe
// push.php), aber mitgespeichert: Sie stammen aus genau diesem Abo, und
// ohne sie muesste spaeter jede Person ihr Abo neu erteilen, falls doch
// einmal ein Titel mitgeschickt werden soll. Bei 'apns' gibt es beides
// nicht -- ein Geraete-Token ist kein Web-Push-Abo.
$p256dh = $istApns ? null : trim((string)($in['p256dh'] ?? ''));
$auth   = $istApns ? null : trim((string)($in['auth'] ?? ''));
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
