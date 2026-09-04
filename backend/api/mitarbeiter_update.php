<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'personal_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$name = trim((string)($input['name'] ?? ''));
if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Name erforderlich'], 400);
}

// Bestand laden, damit nicht mitgeschickte Felder ihren Wert behalten. Ein
// Formular, das nur einen Abschnitt sendet, darf den Rest nicht leeren.
$vorher = db()->prepare('SELECT * FROM mitarbeiter WHERE name = ?');
$vorher->execute([$name]);
$bestand = $vorher->fetch(PDO::FETCH_ASSOC);
if (!$bestand) {
    json_response(['status' => 'error', 'message' => 'Mitarbeitende(r) nicht gefunden'], 404);
}

$gelesen = ma_eingabe_lesen($input, $bestand, db());
if ($gelesen['fehler']) {
    json_response(['status' => 'error', 'message' => implode('; ', $gelesen['fehler'])], 400);
}
$s = $gelesen['spalten'];

// Personalnummer und Login-Name von Hand aendern (ENT-393): Beide sind
// sonst gesperrt (ENT-387 bzw. ENT-376/381), aber die Verwaltung muss eine
// falsch vergebene Nummer oder einen verschriebenen Namen korrigieren
// koennen. ma_eingabe_lesen() kennt keine Rechte -- die Pruefung lebt darum
// hier, direkt am Eingang, mit demselben Recht wie Rollenvergabe und
// "Login-Namen umstellen" (beides ebenfalls exklusiv Verwaltung).
if (array_key_exists('personalnummer', $input)) {
    $neuePn = trim((string)$input['personalnummer']);
    if ($neuePn !== (string)($bestand['personalnummer'] ?? '')) {
        if (!darf($user, 'rechte')) {
            json_response(['status' => 'error',
                'message' => 'Die Personalnummer darf nur die Verwaltung ändern.'], 403);
        }
        if (!ma_personalnummer_gueltig($neuePn)) {
            json_response(['status' => 'error',
                'message' => 'Personalnummer muss vierstellig sein (1000–9999).'], 400);
        }
        $frei = db()->prepare('SELECT COUNT(*) AS c FROM mitarbeiter WHERE personalnummer = ? AND id <> ?');
        $frei->execute([$neuePn, $bestand['id']]);
        if ((int)$frei->fetch()['c'] > 0) {
            json_response(['status' => 'error', 'message' => 'Diese Personalnummer ist bereits vergeben.'], 400);
        }
        $s['personalnummer'] = $neuePn;
    }
}

$nameNeu = null;
if (array_key_exists('name_neu', $input)) {
    $roh = trim((string)$input['name_neu']);
    if ($roh !== '' && $roh !== $bestand['name']) {
        if (!darf($user, 'rechte')) {
            json_response(['status' => 'error',
                'message' => 'Der Login-Name darf nur die Verwaltung ändern.'], 403);
        }
        if (!ma_login_name_gueltig($roh)) {
            json_response(['status' => 'error',
                'message' => 'Login-Name muss dem Muster vorname.nachname entsprechen (klein geschrieben, ohne Leerzeichen).'], 400);
        }
        $frei = db()->prepare('SELECT COUNT(*) AS c FROM mitarbeiter WHERE name = ? AND id <> ?');
        $frei->execute([$roh, $bestand['id']]);
        if ((int)$frei->fetch()['c'] > 0) {
            json_response(['status' => 'error', 'message' => 'Dieser Login-Name ist bereits vergeben.'], 400);
        }
        $nameNeu = $roh;
        $s['name'] = $nameNeu;
    }
}

if (!$s) {
    json_response(['status' => 'ok', 'geaendert' => 0]);
}

// Wer die vertraulichen Angaben nicht sehen darf, darf sie auch nicht
// aendern (ENT-077). Ohne diese Sperre koennte die Planung die AHV-Nummer
// ueberschreiben, ohne sie je gesehen zu haben -- und das Logbuch haette
// als alten Wert nichts stehen, weil ihr das Feld nie ausgeliefert wurde.
if (!darf($user, 'personal_vertraulich')) {
    $verboten = array_intersect(array_keys($s), ma_vertrauliche_felder());
    foreach ($verboten as $feld) { unset($s[$feld]); }
    if (!$s) {
        json_response(['status' => 'error',
            'message' => 'Dafür fehlt dir die Berechtigung.'], 403);
    }
}

// Auch hier aus der Feldliste gebaut statt von Hand -- siehe
// mitarbeiter_create.php.
$sql = 'UPDATE mitarbeiter SET ' . implode(', ', array_map(fn($f) => "$f = ?", array_keys($s)))
     . ' WHERE name = ?';
db()->prepare($sql)->execute(array_merge(array_values($s), [$name]));

// Wurde der Login-Name gerade geaendert, gilt der alte sofort nicht mehr --
// dasselbe Prinzip wie bei "Login-Namen umstellen" (ENT-381): ein noch
// offenes Browserfenster darf nicht unter dem alten Namen weiterlaufen.
if ($nameNeu !== null) {
    db()->prepare('DELETE FROM sessions WHERE mitarbeiter_id = ?')->execute([(int)$bestand['id']]);
}

// Ins Logbuch, WER wann WAS geaendert hat (ENT-077). Erst nach dem
// Speichern: Ein Eintrag ueber eine Aenderung, die gar nicht stattgefunden
// hat, waere schlimmer als kein Eintrag. Verglichen wird gegen den zuvor
// geladenen Bestand -- nur echte Unterschiede kommen ins Buch.
logbuch_vergleichen(db(), $user, 'mitarbeiter', (int)$bestand['id'],
    $bestand, $s, ma_vertrauliche_felder());

// Rollen, falls mitgeschickt und falls der Bedienende sie vergeben darf.
$rollenFehler = null;
if (array_key_exists('rollen', $input) && is_array($input['rollen'])) {
    if (!darf($user, 'rechte')) {
        json_response(['status' => 'error',
            'message' => 'Rollen darf nur die Verwaltung vergeben.'], 403);
    }
    $rollenFehler = rechte_setzen(db(), (int)$bestand['id'],
        array_map('strval', $input['rollen']), $user);
}

json_response(['status' => $rollenFehler ? 'error' : 'ok',
    'geaendert' => count($s),
    'message'   => $rollenFehler]);
