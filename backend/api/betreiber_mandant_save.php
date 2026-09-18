<?php
// Mandant anlegen oder aendern (ENT-519).
//
// Geschrieben wird nur, was in BE_MANDANT_FELDER steht -- eine geschlossene
// Liste. Ausdruecklich NICHT ueber diesen Weg: der Status (eigener
// Endpunkt, weil "gekuendigt" eine Vertragsaussage ist) und die
// GAV-Unterstellung (eigener Endpunkt, weil sie bestaetigt und nicht
// gesetzt wird).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}

$daten = json_decode(file_get_contents('php://input') ?: '', true) ?: [];
$id    = (int)($daten['id'] ?? 0);
$name  = trim((string)($daten['name'] ?? ''));

if ($name === '') {
    json_response(['status' => 'error', 'message' => 'Der Name wird gebraucht.'], 400);
}

$kantonRoh = (string)($daten['kanton'] ?? '');
$kanton    = be_kanton_normal($kantonRoh);
if (trim($kantonRoh) !== '' && $kanton === null) {
    json_response(['status' => 'error',
        'message' => 'Der Kanton wird als zweistelliges Kürzel erwartet, zum Beispiel BE.'], 400);
}

// Ohne '.guardops.ch' -- nur das Wort davor, z. B. 'demo1'. Darueber findet
// die Demo-Zuteilung (demo_instanz.php, demo_anfordern.php) den passenden
// Platz; zwei Mandanten mit derselben Subdomain waeren dort nicht mehr
// unterscheidbar (SELECT ... LIMIT 1 traefe eine stille Wahl).
$subdomain = trim((string)($daten['subdomain'] ?? ''));
if ($subdomain !== '') {
    $stmt = $pdo->prepare('SELECT id FROM mandant WHERE subdomain = ? AND id <> ?');
    $stmt->execute([$subdomain, $id]);
    if ($stmt->fetchColumn() !== false) {
        json_response(['status' => 'error',
            'message' => 'Diese Subdomain ist bereits einem anderen Mandanten zugeteilt.'], 400);
    }
}

$werte = [
    'name'        => $name,
    'subdomain'   => $subdomain,
    'kanton'      => $kanton,
    'db_host'     => trim((string)($daten['db_host'] ?? '')),
    'db_name'     => trim((string)($daten['db_name'] ?? '')),
    'db_user'     => trim((string)($daten['db_user'] ?? '')),
    'secret_name' => trim((string)($daten['secret_name'] ?? '')),
];

// ── Vertragsangaben (ENT-617) ────────────────────────────────────────
//
// LEER BLEIBT NULL, nicht 0. Ein Vertrag ohne eingetragene Laufzeit hat
// keine Laufzeit von null Monaten -- er ist unbekannt, und die Oberflaeche
// muss die beiden auseinanderhalten koennen (Hausregel).
//
// Die Spalten kommen ueber be_spalten_anlegen() nach; zwischen Deploy und
// Einrichtungslauf gibt es sie noch nicht. Was fehlt, wird nicht
// geschrieben, statt den ganzen Speicherweg an einem SQL-Fehler scheitern
// zu lassen.
$datumOderNull = static function ($roh): ?string {
    $t = trim((string)$roh);
    if ($t === '' || $t === '0000-00-00') { return null; }
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', substr($t, 0, 10));
    return $d && $d->format('Y-m-d') === substr($t, 0, 10) ? $d->format('Y-m-d') : null;
};
$monateOderNull = static function ($roh): ?int {
    if ($roh === null || trim((string)$roh) === '') { return null; }
    // 600 Monate sind fuenfzig Jahre. Was darueber liegt, ist ein Vertipper.
    return max(0, min(600, (int)$roh));
};
$vertrag = [
    'vertrag_beginn'          => $datumOderNull($daten['vertrag_beginn'] ?? null),
    'mindestlaufzeit_monate'  => $monateOderNull($daten['mindestlaufzeit_monate'] ?? null),
    'kuendigungsfrist_monate' => $monateOderNull($daten['kuendigungsfrist_monate'] ?? null),
    'verlaengerung_monate'    => $monateOderNull($daten['verlaengerung_monate'] ?? null),
    'gekuendigt_per'          => $datumOderNull($daten['gekuendigt_per'] ?? null),
];
foreach ($vertrag as $feld => $wert) {
    // Nur was mitgeschickt wurde: Ein Formular, das die Vertragsfelder gar
    // nicht kennt, soll sie nicht stillschweigend leeren.
    if (array_key_exists($feld, $daten) && hat_spalte($pdo, 'mandant', $feld)) {
        $werte[$feld] = $wert;
    }
}

// Ein Enddatum vor dem Beginn ist kein Vertrag, sondern ein Vertipper -- und
// er wuerde die Lage "gekuendigt, beendet" ergeben, die niemand erklaeren
// kann.
if (!empty($werte['gekuendigt_per']) && !empty($werte['vertrag_beginn'])
    && $werte['gekuendigt_per'] < $werte['vertrag_beginn']) {
    json_response(['status' => 'error',
        'message' => 'Das Kündigungsdatum liegt vor dem Vertragsbeginn.'], 400);
}

// Ein Passwort kommt hier nie an, und wenn doch, wird es nicht gespeichert:
// Der Mandantenstamm traegt kein Passwortfeld (ENT-519). Wer eines mitsendet,
// bekommt eine klare Antwort statt stillem Verschlucken.
foreach (['db_pass', 'db_passwort', 'passwort', 'secret'] as $verboten) {
    if (array_key_exists($verboten, $daten)) {
        json_response(['status' => 'error',
            'message' => 'Datenbank-Passwörter werden hier nicht gespeichert — sie kommen aus dem Deploy. '
                       . 'Im Feld „secret_name" steht nur, welches Secret gemeint ist.'], 400);
    }
}

if ($id > 0) {
    // Der Stand VOR der Aenderung, fuer das Logbuch (ENT-614). Genau die
    // Spalten, die gleich geschrieben werden -- nicht mehr.
    $vor = $pdo->prepare('SELECT ' . implode(', ', array_keys($werte)) . ' FROM mandant WHERE id = ?');
    $vor->execute([$id]);
    $vorher = $vor->fetch(PDO::FETCH_ASSOC) ?: [];

    // Der Satz entsteht aus den Schluesseln von $werte, nicht aus einer
    // zweiten, von Hand gepflegten Spaltenliste: Sonst geht beim naechsten
    // Feld genau eine der beiden vergessen, und das faellt erst auf, wenn
    // jemand den Wert sucht.
    $satz = implode(', ', array_map(fn($f) => "$f = ?", array_keys($werte)));
    $stmt = $pdo->prepare(
        'UPDATE mandant SET ' . $satz . ', geaendert_am = NOW() WHERE id = ?'
    );
    $stmt->execute([...array_values($werte), $id]);
    if ($stmt->rowCount() === 0) {
        // Kein Treffer heisst hier zweierlei: Es gibt den Mandanten nicht,
        // oder es hat sich nichts geaendert. Beides ist kein Fehler, aber
        // "gibt es nicht" muss man wissen.
        $da = (int)$pdo->query('SELECT COUNT(*) FROM mandant WHERE id = ' . $id)->fetchColumn();
        if ($da === 0) {
            json_response(['status' => 'error', 'message' => 'Diesen Mandanten gibt es nicht.'], 404);
        }
    }
    be_log_vergleich($pdo, $ich, 'mandant', $id, $vorher, $werte);
    json_response(['status' => 'ok', 'id' => $id, 'angelegt' => false]);
}

$spalten = array_keys($werte);
$stmt = $pdo->prepare(
    'INSERT INTO mandant (' . implode(', ', $spalten) . ') VALUES ('
    . implode(', ', array_fill(0, count($spalten), '?')) . ')'
);
$stmt->execute(array_values($werte));
$neueId = (int)$pdo->lastInsertId();
be_log($pdo, $ich, 'mandant', $neueId, 'angelegt', null, $werte['name']);
json_response(['status' => 'ok', 'id' => $neueId, 'angelegt' => true]);
