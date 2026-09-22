<?php
// Einen Sprung-Schluessel einloesen und daraus eine Sitzung machen
// (ENT-631). Laeuft in der Instanz des BETRIEBS, gegen dessen Datenbank.
//
// OHNE ANMELDUNG, und das mit Absicht: Wer hier ankommt, hat noch keine
// Sitzung -- er will ja gerade eine. Der Ausweis ist der Schluessel
// selbst. Darum steht diese Datei namentlich in OHNE_ANMELDUNG in
// pruefungen/test_php.mjs.
//
// WAS IHN TRAGFAEHIG MACHT, und keines davon ist entbehrlich:
//
//   1. Er ist nicht zu erraten: 32 Zufallsbytes.
//   2. Er lebt 60 Sekunden.
//   3. Er gilt genau einmal -- support_sprung_einloesen() entwertet ihn
//      im selben Befehl, in dem sie ihn prueft.
//   4. Ausgestellt hat ihn jemand, der die Datenbank dieses Betriebs
//      beschreiben kann. Das kann nur der Betreiber.
//
// WARUM KEINE EIGENE PRUEFUNG DER FREIGABE: Sie ist beim Ausstellen
// geschehen (siehe betreiber_support_sprung.php). Sie hier zu wiederholen,
// klaenge nach mehr Sicherheit, waere aber keine -- ein Schluessel, den
// jemand ausstellen konnte, ist ohnehin aus dieser Datenbank heraus
// entstanden. Und sie waere falsch: Ein Demo-Platz hat gar keine
// Freigabe, die zweite Pruefung wuerde genau die Faelle abweisen, fuer
// die der Weg gebaut ist.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../support.php';
require_once __DIR__ . '/../rechte.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    json_response(['status' => 'error', 'message' => 'Nur per POST.'], 405);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true);
$schluessel = trim((string)($daten['schluessel'] ?? ''));
// Laengenpruefung vor der Datenbank: Was offensichtlich kein Schluessel
// ist, braucht keine Abfrage. bin2hex(32 Bytes) sind 64 Zeichen.
if ($schluessel === '' || !preg_match('/^[0-9a-f]{64}$/', $schluessel)) {
    json_response(['status' => 'error', 'message' => 'Kein gültiger Zugang.'], 400);
}

$pdo = db();

$sprung = support_sprung_einloesen($pdo, $schluessel);
if ($sprung === null) {
    // EIN Text fuer alle drei Faelle -- unbekannt, abgelaufen, schon
    // eingeloest. Hier ist das kein Verstoss gegen "unbekannt darf nie wie
    // keine aussehen", sondern dieselbe Ueberlegung wie bei der Anmeldung:
    // Wer den Unterschied erfaehrt, erfaehrt, ob ein Schluessel existiert.
    // Der Betreiber sieht den wahren Grund an anderer Stelle -- er stellt
    // einfach einen neuen aus.
    json_response(['status' => 'error', 'message' => 'Dieser Zugang gilt nicht mehr.'], 403);
}

$supportId = support_konto_id($pdo);
if ($supportId === null) {
    // Der Schluessel ist damit verbraucht. Das ist die richtige Richtung:
    // Lieber ein verlorener Schluessel als einer, der nach einem
    // Fehlschlag noch einmal gilt.
    json_response(['status' => 'error',
        'message' => 'In diesem Betrieb ist kein Support-Konto eingerichtet.'], 409);
}

// ── Die Sitzung ───────────────────────────────────────────────────────
//
// Dieselbe Bauart wie in api/login.php: Rohwert an den Browser, Abdruck in
// die Tabelle (ENT-501). Kein eigener Weg, damit eine spaetere Aenderung
// an Sitzungen nicht an einer zweiten Stelle vergessen wird.
$token = bin2hex(random_bytes(32));
$spalten = ['token', 'mitarbeiter_id'];
$werte   = [sitzung_abdruck($token), $supportId];
if (hat_spalte($pdo, 'sessions', 'letzte_nutzung')) {
    // Eine frische Sitzung darf nicht im selben Moment als untaetig
    // gelten, in dem sie entsteht (ENT-075) -- dieselbe Ueberlegung wie
    // in api/login.php.
    $spalten[] = 'letzte_nutzung';
}
// Der Vermerk, an dem require_session() die Support-Sitzung erkennt und
// aus dem die Spur bis zur Freigabe zurueckfuehrt (ENT-631). OHNE ihn
// waere die Sitzung von einer gewoehnlichen nicht zu unterscheiden, und
// es wuerde nichts protokolliert -- der Zugang funktionierte, waere aber
// unsichtbar. Genau das schliesst ENT-631 aus.
$hatSprungSpalte = hat_spalte($pdo, 'sessions', 'support_sprung_id');
if ($hatSprungSpalte) {
    $spalten[] = 'support_sprung_id';
    $werte[]   = (int)$sprung['id'];
}
$felder = implode(', ', $spalten);
$marken = implode(', ', array_map(
    static fn (string $s): string => $s === 'letzte_nutzung' ? 'NOW()' : '?', $spalten));
$pdo->prepare("INSERT INTO sessions ($felder) VALUES ($marken)")->execute($werte);

$rollen = rechte_rollen($pdo, $supportId, true);
$rechte = rechte_aus_rollen($rollen, rollen_definitionen($pdo));

json_response([
    'status'    => 'ok',
    'token'     => $token,
    'name'      => 'GuardOpS Support',
    'ist_admin' => in_array('rechte_' . STUFE_SCHREIBEN, $rechte, true),
    'rollen'    => $rollen,
    'rechte'    => $rechte,
    // Sagt der Oberflaeche, ob die Spur mitlaeuft. false heisst: Die
    // Einrichtung ist noch nicht durch, und dieser Zugang hinterlaesst
    // KEINE Spur -- das Band sagt es dann auch so. Eine Zusicherung, die
    // still ausfaellt, ist schlimmer als keine.
    'protokolliert' => $hatSprungSpalte,
    // Sagt der Oberflaeche, dass sie das Band zeigen muss (Schritt 3).
    // Sie erfaehrt es hier und nicht aus dem Namen des Kontos: Ein Name
    // ist Text, den jemand aendern kann, und daran darf keine Anzeige
    // haengen, die eine Aussage ueber die Sitzung macht.
    'support'   => true,
    'geraet'    => '',
]);
