<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../anmeldung.php';   // passwort_pruefen (ENT-075)
require __DIR__ . '/../mitarbeiter.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
require_recht($user, 'personal_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$vorname = trim((string)($input['vorname'] ?? ''));
$nachname = trim((string)($input['nachname'] ?? ''));
$password = (string)($input['password'] ?? '');
// Rollen statt "Admin ja/nein" (ENT-077). Wer keine Rollen mitschickt oder
// sie nicht vergeben darf, legt eine mitarbeitende Person an -- die
// kleinste Rolle. Rechte entstehen so nie aus Versehen, sondern nur, wenn
// jemand sie ausdruecklich gibt.
$rollen = [];
if (is_array($input['rollen'] ?? null) && darf($user, 'rechte')) {
    $rollen = array_values(array_filter(array_map('strval', $input['rollen']), 'rolle_gueltig'));
}
if (!$rollen) { $rollen = [ROLLE_MITARBEITEND]; }
$istAdmin = in_array(ROLLE_VERWALTUNG, $rollen, true) ? 1 : 0;

// Der Login-Name kommt nicht mehr aus dem Formular, sondern wird hier
// gebildet (ENT-376) -- ein mitgeschickter "name" wird ignoriert, sonst
// waere das nur eine Sperre in der Oberflaeche und liesse sich am Browser
// vorbei umgehen.
if ($vorname === '' || $nachname === '') {
    json_response(['status' => 'error',
        'message' => 'Vorname und Nachname erforderlich -- daraus wird der Login-Name gebildet'], 400);
}
$name = ma_login_generieren($vorname, $nachname, db());
$pwFehler = passwort_pruefen($password, $name, (bool)$istAdmin);
if ($pwFehler !== null) {
    json_response(['status' => 'error', 'message' => $pwFehler], 400);
}

// Alle uebrigen Angaben laufen durch dieselbe Fachlogik wie das Bearbeiten
// (ENT-072). Nicht mitgeschickte Felder fehlen einfach -- beim Anlegen gibt
// es keinen Bestand, aus dem sie kommen koennten.
$gelesen = ma_eingabe_lesen($input, [], db());
if ($gelesen['fehler']) {
    json_response(['status' => 'error', 'message' => implode('; ', $gelesen['fehler'])], 400);
}
$s = $gelesen['spalten'];

// Das SQL wird aus der Feldliste gebaut und nicht von Hand geschrieben:
// Spaltenzahl, Platzhalterzahl und Wertezahl koennen so nicht mehr
// auseinanderlaufen. Genau dieser Fehler ist beim Kundenstamm zweimal
// passiert und war beide Male nur durch Nachzaehlen zu finden.
$felder = array_keys($s);
// passwort_geaendert_am gehoert nicht in die Feldliste -- es wird vom System
// gesetzt, nicht vom Formular. Es kommt nur mit, wenn die Spalte schon da ist.
$fest = ['name' => $name, 'password_hash' => password_hash($password, PASSWORD_DEFAULT, ['cost' => PASSWORT_KOSTEN]), 'ist_admin' => $istAdmin];
$jetzt = ma_spalte_da(db(), 'passwort_geaendert_am');
$sql = 'INSERT INTO mitarbeiter (' . implode(', ', array_keys($fest))
     . ($jetzt ? ', passwort_geaendert_am' : '')
     . ($felder ? ', ' . implode(', ', $felder) : '')
     . ') VALUES (' . rtrim(str_repeat('?, ', count($fest)), ', ')
     . ($jetzt ? ', NOW()' : '')
     . str_repeat(', ?', count($felder)) . ')';

$werte = array_merge(array_values($fest), array_values($s));
db()->prepare($sql)->execute($werte);

// Rollen und Logbuch erst nach dem Anlegen -- vorher gibt es keine ID.
$neueId = (int)db()->lastInsertId();
if ($neueId > 0) {
    rechte_setzen(db(), $neueId, $rollen, $user);
    // Ein Eintrag ueber das Anlegen selbst. Ohne ihn beginnt der Verlauf
    // einer Person mit ihrer ersten Aenderung, und wer sie ueberhaupt
    // erfasst hat, stuende nirgends.
    logbuch_schreiben(db(), $user, 'mitarbeiter', $neueId, 'angelegt', null, $name);
}

// Der Name geht mit zurueck: Er kommt seit ENT-376 nicht mehr vom Client
// (er koennte bei Namensgleichheit eine laufende Nummer tragen, die die
// Oberflaeche vorher nicht kennen konnte) -- ohne ihn wuesste die
// Oberflaeche nicht, welche Person sie nach dem Anlegen oeffnen soll.
json_response(['status' => 'ok', 'name' => $name]);
