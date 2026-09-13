<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../anmeldung.php';
require __DIR__ . '/../zweifaktor.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$name = trim((string)($input['name'] ?? ''));
$password = (string)($input['password'] ?? '');
// Zweiter Faktor (ENT-076). Beides freiwillig: Wer keine Zwei-Faktor-
// Anmeldung eingeschaltet hat, merkt von diesen Zeilen nichts.
$code   = (string)($input['code'] ?? '');
$geraet = (string)($input['geraet'] ?? '');
$geraetMerken = !empty($input['geraet_merken']);

if ($name === '' || $password === '') {
    json_response(['status' => 'error', 'message' => 'Name und Passwort erforderlich'], 400);
}

// Bremse gegen Passwort-Raten (ENT-075). Die Pruefung steht VOR dem
// Datenbankzugriff auf das Konto -- ein gesperrter Versuch soll gar nicht
// erst rechnen.
$adresse = anmeld_adresse();
[$fehlerName, $fehlerAdresse] = anmeld_zaehlen(db(), $name, $adresse);
$sperre = anmeld_sperre($fehlerName, $fehlerAdresse);
if ($sperre > 0) {
    // Dieselbe Grundaussage wie bei falschem Passwort: Ob es den Namen
    // gibt, wird auch hier nicht verraten -- die Sperre greift fuer einen
    // erfundenen Namen genauso.
    json_response(['status' => 'error',
        'message' => "Zu viele Fehlversuche. Bitte $sperre Minuten warten."], 429);
}

$stmt = db()->prepare('SELECT id, password_hash, ist_admin FROM mitarbeiter WHERE name = ? AND aktiv = 1');
$stmt->execute([$name]);
$user = $stmt->fetch();

// Gibt es das Konto nicht, wird trotzdem gerechnet (ENT-501): Sonst
// unterscheidet die ANTWORTZEIT, was die Meldung absichtlich nicht
// unterscheidet. Siehe passwort_blindpruefung() in anmeldung.php.
if (!$user) {
    passwort_blindpruefung($password);
}
if (!$user || !password_verify($password, $user['password_hash'])) {
    anmeld_fehlversuch(db(), $name, $adresse);
    json_response(['status' => 'error', 'message' => 'Name oder Passwort falsch'], 401);
}

// ── Zweiter Faktor, falls eingeschaltet (ENT-076) ─────────────────────
// AB HIER ist das Passwort richtig. Die Fehlversuche werden aber noch NICHT
// zurueckgesetzt: Ein sechsstelliger Code liesse sich sonst unbegrenzt
// durchprobieren, weil jeder Versuch die Zaehlung loeschen wuerde.
$person = (int)$user['id'];
if (zf_ist_an(db(), $person)) {
    $vertraut = $geraet !== '' && zf_geraet_gilt(db(), $person, $geraet);
    if (!$vertraut) {
        if ($code === '') {
            // Kein Fehlversuch: Es wurde ja noch nichts geraten. Sonst
            // koennte jemand fremde Zugaenge allein durch Anmeldeversuche
            // aussperren.
            json_response(['status' => 'zweifaktor',
                'message' => 'Bitte den sechsstelligen Code aus der Authenticator-App eingeben.',
                'geraet_tage' => ZF_GERAET_TAGE], 200);
        }
        // Erst der Zeitcode, dann die Notfallcodes -- der Normalfall zuerst.
        $gut = zf_code_einloesen(db(), $person, $code, time())
            || zf_notfallcode_einloesen(db(), $person, $code);
        if (!$gut) {
            anmeld_fehlversuch(db(), $name, $adresse);
            json_response(['status' => 'error',
                'message' => 'Der Code stimmt nicht.'], 401);
        }
    }
}

// Geschafft -- die Fehlversuche dieses Namens sind erledigt.
anmeld_zuruecksetzen(db(), $name);

// Aeltere Passwoerter still auf den neuen Aufwand heben (ENT-075). Das
// Klartextpasswort liegt genau hier EINMAL vor -- ein spaeterer Zeitpunkt
// koennte es gar nicht mehr. Bestehende Konten werden dadurch nicht
// ausgesperrt: Sie behalten ihr Passwort, es wird nur besser verwahrt.
if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN])) {
    db()->prepare('UPDATE mitarbeiter SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), (int)$user['id']]);
}

$token = bin2hex(random_bytes(32));
// Wann war diese Person zuletzt da? Die Angabe steht im Mitarbeiterbereich
// (ENT-072) und ist die einzige Spur, ob ein Zugang ueberhaupt genutzt wird.
require_once __DIR__ . '/../mitarbeiter.php';
ma_stempel(db(), 'letzter_zugriff', 'id', (int)$user['id']);

// letzte_nutzung gleich mitsetzen (ENT-075): Eine frische Sitzung darf nicht
// im selben Moment als untaetig gelten, in dem sie entsteht.
if (hat_spalte(db(), 'sessions', 'letzte_nutzung')) {
    $stmt = db()->prepare('INSERT INTO sessions (token, mitarbeiter_id, letzte_nutzung) VALUES (?, ?, NOW())');
} else {
    $stmt = db()->prepare('INSERT INTO sessions (token, mitarbeiter_id) VALUES (?, ?)');
}
// Gespeichert wird nur der Abdruck (ENT-501) -- der Rohwert geht an den
// Browser und steht danach nirgends mehr auf dem Server.
$stmt->execute([sitzung_abdruck($token), $user['id']]);

// Geraet merken, wenn gewuenscht und die Zwei-Faktor-Anmeldung an ist.
// Ohne zweiten Faktor waere ein gemerktes Geraet sinnlos -- es wuerde
// nichts ersetzen.
$geraetWert = '';
if ($geraetMerken && zf_ist_an(db(), $person)) {
    // Nur eine grobe Bezeichnung, damit man in der Liste erkennt, welches
    // Geraet gemeint ist. Die volle Browserkennung waere ein Merkmal mehr,
    // als fuer diesen Zweck noetig ist.
    $kennung = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    $bez = 'Unbekanntes Gerät';
    foreach ([['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Android', 'Android-Gerät'],
              ['Macintosh', 'Mac'], ['Windows', 'Windows-Rechner'], ['Linux', 'Linux-Rechner']] as [$suche, $klar]) {
        if (str_contains($kennung, $suche)) { $bez = $klar; break; }
    }
    $geraetWert = zf_geraet_merken(db(), $person, $bez);
    if (random_int(1, 20) === 1) { zf_geraete_aufraeumen(db()); }
}

// Rollen und Rechte gleich mitgeben (ENT-077), damit die Oberflaeche nach
// dem Anmelden sofort weiss, was sie zeigen darf -- ohne eine zweite
// Anfrage, waehrend deren Laufzeit falsche Knoepfe dastuenden.
$rollen = rechte_rollen(db(), (int)$user['id'], (bool)$user['ist_admin']);
$rechte = rechte_aus_rollen($rollen, rollen_definitionen(db()));
json_response(['status' => 'ok', 'token' => $token, 'name' => $name,
    // ist_admin spiegelt seit ENT-440 das Recht und nicht den Rollennamen --
    // dieselbe Ableitung wie in require_session() und rechte_setzen().
    'ist_admin' => in_array('rechte_' . STUFE_SCHREIBEN, $rechte, true),
    'rollen'    => $rollen,
    'rechte'    => $rechte,
    'geraet' => $geraetWert]);
