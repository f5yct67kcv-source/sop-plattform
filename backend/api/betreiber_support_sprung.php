<?php
// Den Sprung ins Cockpit eines Mandanten ausstellen (ENT-631).
//
// WAS DIESER ENDPUNKT NICHT TUT: Er meldet niemanden an. Er stellt einen
// Einmal-Schluessel aus und nennt die Adresse, an der er einzuloesen ist.
// Die Sitzung entsteht drueben, in der Instanz des Betriebs, durch
// api/support_sprung_einloesen.php -- und zwar gegen DEREN Datenbank.
// Zwei Haeuser, zwei Tueren: Der Betreiber-Bereich kann keine Sitzung im
// Cockpit erzeugen, er kann nur einen Schluessel hinterlegen.
//
// DIE BEDINGUNG, und sie ist die ganze Entscheidung (ENT-631):
//
//   - Demo-Platz  -> offen. Der Platz gehoert dem Betreiber, die Daten
//                    darin sind erfunden, und es gibt keinen Kunden, der
//                    eine Freigabe erteilen koennte.
//   - Mandant     -> nur bei gueltiger Freigabe nach ENT-526. Die liegt in
//                    SEINER Datenbank, nicht hier -- laege sie hier,
//                    koennte der Betreiber sie sich selbst ausstellen.
//
// Der Unterschied wird HIER entschieden und nicht drueben: Die Instanz
// weiss nicht, ob sie ein Demo-Platz ist; sie wuerde es aus ihrer eigenen
// Umgebungskennung ableiten, und das ist eine Angabe, die im Zweifel der
// Aufrufer beeinflusst. Der Mandantenstamm dagegen ist die Wahrheit
// darueber, was ein Platz ist.
//
// POST und nicht GET: Der Aufruf legt eine Zeile an und verbraucht einen
// Schluessel. Ein GET, den ein Vorschau-Abruf oder ein Verlauf-Eintrag
// wiederholt, wuerde Schluessel am laufenden Band ausstellen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../support.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'error', 'message' => 'Nur per POST.'], 405);
}

$ich = require_betreiber_voll();
$stamm = betreiber_db();

$daten = json_decode(file_get_contents('php://input') ?: '', true);
$mandantId = (int)($daten['id'] ?? 0);
if ($mandantId <= 0) {
    json_response(['status' => 'error', 'message' => 'Welcher Mandant?'], 400);
}
if (!hat_tabelle($stamm, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$s = $stamm->prepare('SELECT id, name, subdomain, status, db_host, db_name, db_user, secret_name
                        FROM mandant WHERE id = ?');
$s->execute([$mandantId]);
$m = $s->fetch(PDO::FETCH_ASSOC);
if (!$m) {
    json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
}

$adresse = mandant_adresse((string)$m['subdomain']);
if ($adresse === null) {
    // Nicht "nicht erreichbar": Der Mandant hat keine eigene Adresse
    // hinterlegt. Das ist etwas anderes als eine, die nicht antwortet.
    json_response(['status' => 'error', 'grund' => 'keine_adresse',
        'message' => 'Für diesen Mandanten ist keine Subdomain hinterlegt — '
                   . 'ohne sie gibt es keine Adresse, zu der gesprungen werden könnte.'], 409);
}

try {
    $pdo = mandant_db($m);
} catch (Throwable $e) {
    json_response(['status' => 'error', 'lage' => mandant_verbindung_bereit($m),
        'message' => 'Dieser Mandant ist nicht erreichbar.'], 502);
}

// ── Demo oder Mandant? ────────────────────────────────────────────────
$istDemo = in_array((string)$m['subdomain'], DEMO_PLAETZE, true);

$freigabeId = null;
if (!$istDemo) {
    if (!support_tabellen_da($pdo)) {
        json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
            'message' => 'Bei diesem Mandanten ist die Support-Freigabe noch nicht eingerichtet.'], 409);
    }
    $freigabe = support_freigabe_gueltig($pdo);
    if ($freigabe === null) {
        json_response([
            'status'  => 'error',
            'grund'   => 'keine_freigabe',
            'lage'    => support_lage($pdo),
            'message' => 'Für diesen Mandanten liegt keine gültige Support-Freigabe vor. '
                       . 'Sie wird im Cockpit des Betriebs erteilt und ist befristet.',
        ], 403);
    }
    $freigabeId = (int)$freigabe['id'];
}

// ── Kann drueben ueberhaupt jemand sein? ──────────────────────────────
//
// Vor dem Ausstellen geprueft und nicht danach: Ein Schluessel, der
// drueben auf kein Support-Konto trifft, waere ein Sprung ins Leere --
// der Betreiber saehe eine Anmeldemaske und wuesste nicht, warum.
if (!support_sprung_da($pdo) || support_konto_id($pdo) === null) {
    json_response(['status' => 'error', 'grund' => 'nicht_eingerichtet',
        'message' => 'Bei diesem Mandanten fehlt das Support-Konto. '
                   . 'Einmal „Einrichtung" laufen lassen, dann steht es.'], 409);
}

// ── Protokollieren, BEVOR der Schluessel herausgeht ───────────────────
//
// Dieselbe Reihenfolge wie bei der Diagnose in betreiber_support.php: Ein
// Abbruch nach dem Ausstellen darf keine Luecke hinterlassen. Beim
// Demo-Platz gibt es keine Freigabe, auf die sich der Eintrag beziehen
// koennte -- dort traegt erst die Sitzung selbst ihre Spuren ein
// (Schritt 2), und der Sprung steht in support_sprung mit Name und Zeit.
$wer = trim((string)$ich['name']) . ' <' . (string)$ich['email'] . '>';
if ($freigabeId !== null) {
    support_zugriff_merken($pdo, $freigabeId, $wer, 'Sprung ins Cockpit');
}

$schluessel = support_sprung_ausstellen($pdo, $freigabeId, $wer);

// Aufraeumen bei Gelegenheit: kein eigener Zeitgeber fuer eine Tabelle,
// die ein paar Zeilen im Monat bekommt.
support_sprung_aufraeumen($pdo);

json_response([
    'status'  => 'ok',
    // Der Schluessel steht im FRAGMENT (#), nicht in der Abfrage (?).
    // Ein Fragment sendet der Browser nicht an den Server -- es landet
    // also in keinem Zugriffsprotokoll, in keinem Verweis-Kopf und in
    // keiner Weiterleitung. Das ist die Antwort auf ENT-075 („nie in der
    // URL"): Gemeint war, was der Server zu sehen bekommt, und das ist
    // hier nichts.
    'ziel'    => $adresse . '/dashboard.html#support=' . $schluessel,
    'mandant' => (string)$m['name'],
    'demo'    => $istDemo,
    'sekunden'=> SUPPORT_SPRUNG_SEKUNDEN,
    'message' => 'Sprung bereit — er gilt ' . SUPPORT_SPRUNG_SEKUNDEN . ' Sekunden.',
]);
