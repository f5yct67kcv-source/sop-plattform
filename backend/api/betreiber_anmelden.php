<?php
// Eingang der Betreiber-Ebene (ENT-524).
//
// Steht namentlich in OHNE_ANMELDUNG (pruefungen/test_php.mjs): Er kann
// keine Sitzung verlangen, die er erst erzeugt -- dieselbe Begruendung wie
// bei login.php und portal_anmelden.php.
//
// Er erbt die Sicherungen des Hauses, statt eigene zu erfinden:
//   - dieselbe Bremse (anmeldeversuche), aber unter EIGENEM Namensraum
//     "betreiber:" -- so wie ENT-373 den Ruecksetzweg unter "reset:" fuehrt.
//     Ohne den Namensraum teilten sich zwei verschiedene Anmeldewege eine
//     Zaehlung, und Fehlversuche am einen sperrten den anderen.
//   - dieselbe Blindpruefung gegen Zeitmessung (passwort_blindpruefung):
//     Ohne sie verraet die Antwortzeit, ob es die Adresse gibt.
//   - dieselbe gleichlautende Antwort fuer "gibt es nicht" und "Passwort
//     falsch".
//
// Der Token wandert im selben Kopf X-Auth-Token wie die beiden anderen
// Wege. Das ist unbedenklich, WEIL die Tabellen getrennt sind: Ein
// Betreiber-Token findet sich weder in `sessions` noch in
// `kunden_sessions`, und umgekehrt. Jedes Mal ist die Antwort 401.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../anmeldung.php';
require_once __DIR__ . '/../betreiber.php';

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$email = mb_strtolower(trim((string)($daten['email'] ?? '')));
$pass  = (string)($daten['passwort'] ?? '');
$code  = zf_code_normalisieren((string)($daten['code'] ?? ''));

// Eigener Namensraum in der Bremse -- siehe Kopf.
$bremsName = 'betreiber:' . $email;
$adresse   = anmeld_adresse();

[$fehlerName, $fehlerAdresse] = anmeld_zaehlen(db(), $bremsName, $adresse);
$sperre = anmeld_sperre($fehlerName, $fehlerAdresse);
if ($sperre > 0) {
    json_response(['status' => 'error',
        'message' => 'Zu viele Versuche. Bitte in ' . $sperre . ' Minuten erneut versuchen.'], 429);
}

$pdo = betreiber_db();
if (!be_tabellen_da($pdo)) {
    // Nicht eingerichtet ist etwas anderes als falsche Zugangsdaten und
    // bekommt darum eine eigene Aussage -- die Hausregel "unbekannt darf
    // nie wie keine aussehen" gilt auch hier.
    json_response(['status' => 'error',
        'message' => 'Der Betreiber-Bereich ist noch nicht eingerichtet.'], 503);
}

$stmt = $pdo->prepare('SELECT id, name, email, passwort_hash FROM betreiber WHERE email = ? AND aktiv = 1');
$stmt->execute([$email]);
$konto = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$konto) {
    // Gleich lange rechnen wie bei einem vorhandenen Konto, sonst
    // unterscheidet die Antwortzeit die beiden Faelle.
    passwort_blindpruefung($pass);
    anmeld_fehlversuch(db(), $bremsName, $adresse);
    json_response(['status' => 'error', 'message' => 'Anmeldung nicht möglich.'], 401);
}

if (!password_verify($pass, (string)$konto['passwort_hash'])) {
    anmeld_fehlversuch(db(), $bremsName, $adresse);
    json_response(['status' => 'error', 'message' => 'Anmeldung nicht möglich.'], 401);
}

// ── Zweiter Faktor (OP-517) ───────────────────────────────────────────
//
// AB HIER ist das Passwort richtig. Die Fehlversuche werden aber noch NICHT
// zurueckgesetzt -- ein sechsstelliger Code liesse sich sonst unbegrenzt
// durchprobieren, weil jeder Versuch die Zaehlung loeschte. Uebernommen aus
// login.php, wo dieselbe Ueberlegung steht.
//
// KEIN GEMERKTES GERAET, anders als in der Verwaltung (ZF_GERAET_TAGE).
// Ein vierzehn Tage vertrautes Geraet ist ein guter Tausch, wenn dahinter
// die Personalakte eines Betriebs liegt. Hinter diesem Konto liegt jeder
// Betrieb, und es gibt keine Ebene darueber, die einen Missbrauch bemerken
// wuerde -- hier wird jedes Mal gefragt.
$kontoId = (int)$konto['id'];
if (be_zf_ist_an($pdo, $kontoId)) {
    if ($code === '') {
        // Kein Fehlversuch: Es wurde noch nichts geraten. Sonst liessen
        // sich fremde Zugaenge allein durch Anmeldeversuche aussperren.
        json_response(['status' => 'zweifaktor',
            'message' => 'Bitte den sechsstelligen Code aus der Authenticator-App eingeben.'], 200);
    }
    if (!be_zf_code_einloesen($pdo, $kontoId, $code, time())) {
        anmeld_fehlversuch(db(), $bremsName, $adresse);
        json_response(['status' => 'error', 'message' => 'Der Code stimmt nicht.'], 401);
    }
}

// Der Rohwert geht einmal an den Aufrufer und wird nie gespeichert --
// in der Tabelle steht ausschliesslich der Abdruck (ENT-501).
$token = bin2hex(random_bytes(32));
$pdo->prepare('INSERT INTO betreiber_sessions (token, betreiber_id) VALUES (?, ?)')
    ->execute([sitzung_abdruck($token), (int)$konto['id']]);
$pdo->prepare('UPDATE betreiber SET letzte_anmeldung = NOW() WHERE id = ?')
    ->execute([(int)$konto['id']]);

json_response([
    'status' => 'ok',
    'token'  => $token,
    'name'   => $konto['name'],
    'email'  => $konto['email'],
    // Damit die Oberflaeche die kurze Frist anzeigen kann, statt den
    // Nutzer von einem stillen Abmelden ueberraschen zu lassen.
    'sitzung_ruhe_minuten' => BE_SITZUNG_RUHE_MIN,
    'sitzung_max_stunden'  => BE_SITZUNG_MAX_STUNDEN,
    // Damit die Oberflaeche sofort zur Einrichtung fuehren kann, statt den
    // Nutzer am ersten Endpunkt in einen 403 laufen zu lassen. Die Sperre
    // selbst sitzt im Server (require_betreiber_voll) -- das hier erspart
    // nur den Umweg.
    'zwei_faktor'          => be_zf_ist_an($pdo, $kontoId),
]);
