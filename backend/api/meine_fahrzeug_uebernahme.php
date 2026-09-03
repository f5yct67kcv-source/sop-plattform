<?php
// Fahrzeugübernahme durch die eigene Person (ENT-340).
//
// Der Weg, den der Projektinhaber beschrieben hat: *"Im Auto ein QR
// anbringen, vielleicht am Rückspiegel wie ein Duftbaum. Mitarbeiter steigt
// in Dienstfahrzeug scannt Code, fotografiert Tacho und/oder trägt KM ein,
// wählt Dienstfahrzeug aus, Schickt ab fertig."*
//
// Drei Festlegungen, die den Aufbau erklären:
//
//  1. NUR ÜBERNAHME, KEINE RÜCKGABE. Wer ein Fahrzeug übernimmt, hat es, bis
//     es der Nächste übernimmt. Jeder Kilometer zwischen zwei Übernahmen
//     gehört zwangsläufig dem, der es in dieser Zeit hatte. Eine Rückgabe
//     wäre ein zweiter Vorgang, den man vergessen kann -- und eine vergessene
//     Rückgabe reisst genau die Lücke, die diese Kette schliessen soll.
//
//  2. "KEIN DIENSTFAHRZEUG" IST AUCH EINE ANTWORT und wird mitgeschrieben
//     (art = 'ohne_fahrzeug'). Sonst liesse sich später nicht unterscheiden,
//     ob jemand privat gefahren ist oder ob er die Frage nie gesehen hat.
//     "Nicht gefragt" und "verneint" sind verschiedene Aussagen.
//
//  3. KILOMETERZAHL UND FOTO SIND BEIDE PFLICHT (ENT-352, revidiert ENT-340).
//     ENT-340 liess zunächst nur die Zahl gelten -- ein Foto allein ist eine
//     Zahl, die noch niemand gelesen hat, und die spätere Abstimmung mit den
//     Schichten bräuchte einen Menschen, der jedes Bild von Hand abtippt.
//     Das galt aber ausdrücklich als "umkehrbar, falls sich das im Betrieb
//     anders anfühlt" -- und genau das ist nach dem ersten echten Test
//     eingetreten: eine 5-6-stellige, von Hand eingetippte Zahl vertippt
//     sich leicht, und ohne Foto als Beleg fällt der Fehler niemandem auf.
//     Das Foto ersetzt die Zahl nicht (dieselbe Abstimmungs-Begründung wie
//     zuvor), es sichert sie ab.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../fahrzeug.php';
require_once __DIR__ . '/../logbuch.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$pdo = db();
if (!hat_tabelle($pdo, 'fahrzeuge') || !hat_tabelle($pdo, 'fahrzeug_uebernahme')) {
    json_response(['status' => 'error',
        'message' => 'Die Fahrzeugübernahme ist noch nicht eingerichtet.'], 503);
}

$input = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$art = (string)($input['art'] ?? 'uebernahme');
if (!in_array($art, ['uebernahme', 'ohne_fahrzeug'], true)) {
    json_response(['status' => 'error', 'message' => 'unbekannte Art'], 422);
}
$bemerkung = trim((string)($input['bemerkung'] ?? ''));

// Der Einsatz wird nur übernommen, wenn er der eigenen Person gehört --
// mitarbeiter_id kommt aus der Sitzung, nie aus dem Rumpf (gleiches Prinzip
// wie mein_rundgang_starten.php). Ein fremder oder unbekannter Einsatz macht
// die Übernahme nicht ungültig, er wird nur nicht zugeordnet: Die Fahrt hat
// stattgefunden, und eine spontane Fahrt ohne Einsatz gehört ausdrücklich in
// die Kette.
$einsatzId = null;
$roh = (int)($input['einsatz_id'] ?? 0);
if ($roh > 0) {
    $c = $pdo->prepare('SELECT e.id FROM einsaetze e
                          JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
                         WHERE e.id = ? AND z.mitarbeiter_id = ?');
    $c->execute([$roh, (int)$user['id']]);
    if ($c->fetchColumn() !== false) { $einsatzId = $roh; }
}

// ── "Kein Dienstfahrzeug" ────────────────────────────────────────────
// Kurzer Weg: kein Fahrzeug, kein Zähler, kein Foto. Nur die Antwort mit
// Zeitstempel und Person.
if ($art === 'ohne_fahrzeug') {
    $ins = $pdo->prepare(
        "INSERT INTO fahrzeug_uebernahme (art, fahrzeug_id, mitarbeiter_id, einsatz_id,
                                          zeitpunkt, quelle, bemerkung)
         VALUES ('ohne_fahrzeug', NULL, ?, ?, NOW(), 'antwort', ?)"
    );
    $ins->execute([(int)$user['id'], $einsatzId, $bemerkung === '' ? null : $bemerkung]);
    json_response(['status' => 'ok', 'art' => 'ohne_fahrzeug', 'id' => (int)$pdo->lastInsertId()]);
}

// ── Übernahme ────────────────────────────────────────────────────────
// Das Fahrzeug kommt entweder vom Aufkleber oder aus der Liste. Die
// Unterscheidung wird mitgeschrieben (quelle), weil sie verschieden viel
// wert ist: Wer den Aufkleber scannt, stand vor dem Fahrzeug; wer aus der
// Liste wählt, hat es behauptet.
$kennung = trim((string)($input['kennung'] ?? ''));
$fahrzeug = null; $quelle = 'liste';
if ($kennung !== '' && hat_spalte($pdo, 'fahrzeuge', 'qr_kennung')) {
    $s = $pdo->prepare('SELECT id, kennzeichen, bezeichnung, status FROM fahrzeuge WHERE qr_kennung = ?');
    $s->execute([$kennung]);
    $fahrzeug = $s->fetch(PDO::FETCH_ASSOC) ?: null;
    $quelle = 'qr';
    if (!$fahrzeug) {
        json_response(['status' => 'error', 'message' => 'Dieser Aufkleber gehört zu keinem Fahrzeug.'], 404);
    }
} else {
    $fahrzeugId = (int)($input['fahrzeug_id'] ?? 0);
    if ($fahrzeugId <= 0) {
        json_response(['status' => 'error', 'message' => 'Bitte ein Fahrzeug wählen.'], 422);
    }
    $s = $pdo->prepare('SELECT id, kennzeichen, bezeichnung, status FROM fahrzeuge WHERE id = ?');
    $s->execute([$fahrzeugId]);
    $fahrzeug = $s->fetch(PDO::FETCH_ASSOC) ?: null;
    if (!$fahrzeug) {
        json_response(['status' => 'error', 'message' => 'Dieses Fahrzeug gibt es nicht.'], 404);
    }
}
$fahrzeugId = (int)$fahrzeug['id'];

// Ein verkauftes oder stillgelegtes Fahrzeug lässt sich nicht übernehmen.
// Der Text sagt, was zu tun ist -- "nicht möglich" allein liesse den
// Mitarbeitenden im Regen stehen.
if (($fahrzeug['status'] ?? 'aktiv') !== 'aktiv') {
    json_response(['status' => 'error',
        'message' => 'Dieses Fahrzeug steht nicht im Betrieb. Bitte im Büro melden.'], 409);
}

// Kilometerstand: Pflicht, und er muss eine Zahl sein. Ein leeres Feld ist
// keine 0 -- 0 wäre eine Aussage über den Zähler.
$kmRoh = $input['tacho_km'] ?? null;
if ($kmRoh === null || $kmRoh === '' || !is_numeric($kmRoh)) {
    json_response(['status' => 'error', 'message' => 'Bitte den Kilometerstand eintragen.'], 422);
}
$km = (int)$kmRoh;

// Die Regel selbst steht in fahrzeug.php und wird dort ausgeführt geprüft.
// Ein Weg an ihr vorbei in der App wäre ein Riegel, den man aufschieben
// kann -- darum entscheidet der Server, nicht das Formular.
$bezug = fz_bezugsstand($pdo, $fahrzeugId);
$fehler = fz_stand_pruefen($bezug, $km);
if ($fehler !== null) {
    json_response(['status' => 'error', 'bezug' => $bezug, 'message' => $fehler], 409);
}

// Foto vom Tacho: Pflicht seit ENT-352, nicht mehr freiwillig (ENT-340
// selbst hielt das für "umkehrbar, falls sich das im Betrieb anders
// anfühlt" -- genau das ist nach dem ersten echten Test eingetreten). Eine
// 5-6-stellige, von Hand eingetippte Zahl vertippt sich leicht, und ohne
// Beleg fällt der Fehler niemandem auf.
if (!isset($input['foto']) || (string)$input['foto'] === '') {
    json_response(['status' => 'error', 'message' => 'Bitte ein Foto vom Tacho mitschicken.'], 422);
}
$fotoRoh = base64_decode((string)$input['foto'], true);
if ($fotoRoh === false || $fotoRoh === '') {
    json_response(['status' => 'error', 'message' => 'Das Foto liess sich nicht lesen.'], 422);
}
if (strlen($fotoRoh) > FZ_FOTO_MAX) {
    json_response(['status' => 'error', 'message' => 'Foto zu gross (höchstens 2 MB).'], 422);
}
$fotoMime = ersatzscan_foto_mime($fotoRoh);
if ($fotoMime === null) {
    json_response(['status' => 'error', 'message' => 'Nur JPEG- oder PNG-Fotos.'], 422);
}
$foto = $fotoRoh;

// Doppelt abgeschickt (zweimal getippt, Netz gewackelt) legt keine zweite
// Übernahme an. Enger Rahmen: dieselbe Person, dasselbe Fahrzeug, derselbe
// Stand, innerhalb von zehn Minuten. Eine echte zweite Übernahme später am
// Tag bleibt möglich -- sie hätte einen anderen Stand oder läge später.
$dup = $pdo->prepare(
    "SELECT id FROM fahrzeug_uebernahme
      WHERE art = 'uebernahme' AND fahrzeug_id = ? AND mitarbeiter_id = ? AND tacho_km = ?
        AND zeitpunkt >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
      ORDER BY id DESC LIMIT 1"
);
$dup->execute([$fahrzeugId, (int)$user['id'], $km]);
$schonDa = $dup->fetchColumn();
if ($schonDa !== false) {
    json_response(['status' => 'ok', 'art' => 'uebernahme', 'bereits_erfasst' => true,
        'id' => (int)$schonDa, 'fahrzeug' => ['id' => $fahrzeugId,
            'kennzeichen' => $fahrzeug['kennzeichen'], 'bezeichnung' => $fahrzeug['bezeichnung']]]);
}

$ins = $pdo->prepare(
    "INSERT INTO fahrzeug_uebernahme (art, fahrzeug_id, mitarbeiter_id, einsatz_id,
                                      zeitpunkt, tacho_km, quelle, foto, foto_mime, bemerkung)
     VALUES ('uebernahme', ?, ?, ?, NOW(), ?, ?, ?, ?, ?)"
);
$ins->execute([$fahrzeugId, (int)$user['id'], $einsatzId, $km, $quelle,
               $foto, $fotoMime, $bemerkung === '' ? null : $bemerkung]);
$neuId = (int)$pdo->lastInsertId();

// Der Stammdatenwert zieht mit -- er ist die Anzeige im Cockpit und der
// Bezug für die nächste Übernahme. Nur aufwärts: Ein alter Eintrag, der
// verspätet ankommt, darf den Stand nicht zurückdrehen.
if ($bezug === null || $km >= $bezug['tacho_km']) {
    $altKm = $bezug !== null ? (string)$bezug['tacho_km'] : null;
    $pdo->prepare('UPDATE fahrzeuge SET tacho_km = ?, tacho_am = CURDATE() WHERE id = ?')
        ->execute([$km, $fahrzeugId]);
    // Und ins Logbuch (ENT-330). Ohne diesen Eintrag stünde im Cockpit
    // weiterhin der letzte Büro-Eingriff als "Kilometerstand zuletzt
    // geändert" -- eine Auskunft, die dann nicht mehr stimmt.
    logbuch_schreiben($pdo, $user, 'fahrzeug', $fahrzeugId, 'tacho_km', $altKm, (string)$km);
}

// Was zurückgeht, ist die Auskunft für die Bestätigung in der App: worauf
// der Eintrag aufsetzt und wie viele Kilometer seither gefahren wurden.
// Die Zahl wird BENANNT, nicht bewertet -- ob sie zu viel ist, entscheidet
// die Abstimmung mit den Schichten, und dafür fehlt noch die schriftliche
// Regel zur Privatnutzung (OP-314).
$seither = ($bezug !== null) ? $km - $bezug['tacho_km'] : null;
json_response(['status' => 'ok', 'art' => 'uebernahme', 'id' => $neuId,
    'fahrzeug' => ['id' => $fahrzeugId, 'kennzeichen' => $fahrzeug['kennzeichen'],
                   'bezeichnung' => $fahrzeug['bezeichnung']],
    'tacho_km' => $km, 'quelle' => $quelle,
    'bezug' => $bezug, 'km_seither' => $seither,
    'auffaellig' => $seither !== null && $seither > FZ_SPRUNG_AUFFAELLIG]);
