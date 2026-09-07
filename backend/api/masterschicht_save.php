<?php
// Legt eine Masterschicht an oder aendert sie (ENT-021).
//
// Vier Betriebsarten:
//   neu        anlegen ab einem Stichtag
//   aenderung  neue Fassung ab einem Stichtag; die alte bekommt ein Enddatum.
//              Bereits erzeugte Schichten sind Kopien und bleiben unberuehrt --
//              deshalb veraendert eine Aenderung nie die Vergangenheit.
//   korrektur  Schreibfehler richtigstellen (nur Name, Kuerzel, Farbe).
//              Aendert nichts an Zeiten oder Bedarf, darum ohne neue Fassung.
//   beenden    Gueltigkeit auf ein Datum begrenzen
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../planung.php';

$user = require_session();
require_recht($user, 'masterschichten_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in = json_decode(file_get_contents('php://input'), true) ?? [];
$modus = (string)($in['modus'] ?? 'neu');
$id = (int)($in['id'] ?? 0);

if (!in_array($modus, ['neu', 'aenderung', 'korrektur', 'beenden'], true)) {
    json_response(['status' => 'error', 'message' => 'unbekannter Modus'], 400);
}

function lade(int $id): array {
    $s = db()->prepare('SELECT * FROM masterschichten WHERE id = ?');
    $s->execute([$id]);
    $r = $s->fetch();
    if (!$r) {
        json_response(['status' => 'error', 'message' => 'Masterschicht nicht gefunden'], 404);
    }
    return $r;
}
function tagDavor(string $datum): string {
    return (new DateTimeImmutable($datum))->modify('-1 day')->format('Y-m-d');
}
function pruefeDatum($wert, string $feld): string {
    $wert = trim((string)$wert);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld im Format JJJJ-MM-TT erforderlich"], 400);
    }
    return $wert;
}

// ── Nur Beschriftung richtigstellen
if ($modus === 'korrektur') {
    lade($id);
    $s = db()->prepare('UPDATE masterschichten SET name = ?, kuerzel = ?, farbe = ? WHERE id = ?');
    $s->execute([
        trim((string)($in['name'] ?? '')) ?: 'Ohne Namen',
        trim((string)($in['kuerzel'] ?? '')) ?: null,
        trim((string)($in['farbe'] ?? '')) ?: null,
        $id,
    ]);
    json_response(['status' => 'ok', 'id' => $id, 'art' => 'korrigiert']);
}

// ── Gueltigkeit begrenzen
if ($modus === 'beenden') {
    $alt = lade($id);
    $bis = pruefeDatum($in['gueltig_bis'] ?? '', 'Enddatum');
    if ($bis < $alt['gueltig_ab']) {
        json_response(['status' => 'error', 'message' => 'Das Enddatum liegt vor dem Beginn der Fassung'], 400);
    }
    $s = db()->prepare('UPDATE masterschichten SET gueltig_bis = ? WHERE id = ?');
    $s->execute([$bis, $id]);
    json_response(['status' => 'ok', 'id' => $id, 'art' => 'beendet']);
}

// ── Felder fuer neu und aenderung
$objektId = (int)($in['objekt_id'] ?? 0);
$name     = trim((string)($in['name'] ?? ''));
$von      = trim((string)($in['von'] ?? ''));
$bis      = trim((string)($in['bis'] ?? ''));
$art      = in_array(($in['art'] ?? ''), ['arbeit', 'fahrtzeit'], true) ? $in['art'] : 'arbeit';
$rhythmus = in_array(($in['rhythmus'] ?? ''), ['woche', 'intervall'], true) ? $in['rhythmus'] : 'woche';
$gueltigAb = pruefeDatum($in['gueltig_ab'] ?? '', 'Stichtag');
$gueltigBis = trim((string)($in['gueltig_bis'] ?? '')) ?: null;
if ($gueltigBis !== null) {
    $gueltigBis = pruefeDatum($gueltigBis, 'Enddatum');
    if ($gueltigBis < $gueltigAb) {
        json_response(['status' => 'error', 'message' => 'Das Enddatum liegt vor dem Stichtag'], 400);
    }
}

if ($name === '' || $von === '' || $bis === '') {
    json_response(['status' => 'error', 'message' => 'Name, Von und Bis erforderlich'], 400);
}
foreach (['von' => $von, 'bis' => $bis] as $feld => $wert) {
    if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $wert)) {
        json_response(['status' => 'error', 'message' => "$feld im Format HH:MM erforderlich"], 400);
    }
}

$pauseVon = trim((string)($in['pause_von'] ?? '')) ?: null;
$pauseBis = trim((string)($in['pause_bis'] ?? '')) ?: null;
$pauseMin = max(0, min(1440, (int)($in['pause_min'] ?? 0)));
$arbeitszeit = round(max(0, (float)($in['arbeitszeit_h'] ?? 0)), 2);

$bedarf = [];
foreach (['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so', 'feiertag'] as $t) {
    $bedarf[$t] = max(0, min(99, (int)($in['bedarf_' . $t] ?? 0)));
}
$intervallTage  = $rhythmus === 'intervall' ? max(1, min(365, (int)($in['intervall_tage'] ?? 2))) : null;
$intervallStart = $rhythmus === 'intervall' ? pruefeDatum($in['intervall_start'] ?? $gueltigAb, 'Startdatum') : null;
$bedarfIntervall = max(0, min(99, (int)($in['bedarf_intervall'] ?? 1)));

if ($rhythmus === 'woche' && array_sum($bedarf) === 0) {
    json_response(['status' => 'error', 'message' => 'Ohne Bedarf an mindestens einem Tag entsteht nie eine Schicht'], 400);
}
if ($rhythmus === 'intervall' && $bedarfIntervall === 0) {
    json_response(['status' => 'error', 'message' => 'Ohne Bedarf entsteht nie eine Schicht'], 400);
}

// Sparte des Objekts als Rueckfallwert fuer eine Vorlage ohne eigene Angabe.
function objekt_sparte(int $objektId): string
{
    if ($objektId <= 0) { return 'sicherheit'; }
    $s = db()->prepare('SELECT sparte FROM objekte WHERE id = ?');
    $s->execute([$objektId]);
    return sparte_pruefen($s->fetchColumn());
}

$felder = [
    'objekt_id' => $objektId,
    'name' => $name,
    'kuerzel' => trim((string)($in['kuerzel'] ?? '')) ?: null,
    'art' => $art,
    'von' => $von,
    'bis' => $bis,
    'pause_von' => $pauseVon,
    'pause_bis' => $pauseBis,
    'pause_min' => $pauseMin,
    'arbeitszeit_h' => $arbeitszeit,
    'farbe' => trim((string)($in['farbe'] ?? '')) ?: null,
    // Eigene Sparte je Vorlage. Fehlt die Angabe, gilt die des Objekts --
    // so bleibt ein reines Sicherheitsobjekt ohne Zutun richtig (ENT-037).
    'sparte' => sparte_pruefen($in['sparte'] ?? null, objekt_sparte($objektId)),
    'auf_abruf' => !empty($in['auf_abruf']) ? 1 : 0,
    'rhythmus' => $rhythmus,
    'bedarf_mo' => $bedarf['mo'], 'bedarf_di' => $bedarf['di'], 'bedarf_mi' => $bedarf['mi'],
    'bedarf_do' => $bedarf['do'], 'bedarf_fr' => $bedarf['fr'], 'bedarf_sa' => $bedarf['sa'],
    'bedarf_so' => $bedarf['so'], 'bedarf_feiertag' => $bedarf['feiertag'],
    'intervall_tage' => $intervallTage,
    'intervall_start' => $intervallStart,
    'bedarf_intervall' => $bedarfIntervall,
    'gueltig_ab' => $gueltigAb,
    'gueltig_bis' => $gueltigBis,
];

function einfuegen(array $felder, ?int $ersetzt): int {
    $felder['ersetzt_id'] = $ersetzt;
    $spalten = implode(', ', array_keys($felder));
    $marken = implode(', ', array_fill(0, count($felder), '?'));
    $s = db()->prepare("INSERT INTO masterschichten ($spalten) VALUES ($marken)");
    $s->execute(array_values($felder));
    return (int)db()->lastInsertId();
}

if ($modus === 'neu') {
    if ($objektId <= 0) {
        json_response(['status' => 'error', 'message' => 'objekt_id erforderlich'], 400);
    }
    $chk = db()->prepare('SELECT id FROM objekte WHERE id = ?');
    $chk->execute([$objektId]);
    if (!$chk->fetch()) {
        json_response(['status' => 'error', 'message' => 'Objekt nicht gefunden'], 404);
    }
    json_response(['status' => 'ok', 'id' => einfuegen($felder, null), 'art' => 'angelegt']);
}

// ── Aenderung mit Stichtag
$alt = lade($id);
$felder['objekt_id'] = (int)$alt['objekt_id'];
// Wie beim Objekt: bei einer Aenderung ohne ausdrueckliche Angabe gilt die
// bisherige Sparte weiter. Sonst faellt eine Reinigungsvorlage still auf
// Sicherheit zurueck, weil beim Aendern keine objekt_id mitgeschickt wird.
$felder['sparte'] = sparte_pruefen($in['sparte'] ?? null, sparte_pruefen($alt['sparte'] ?? null));

if ($gueltigAb <= $alt['gueltig_ab']) {
    // Der Stichtag liegt nicht nach dem Beginn der alten Fassung -- diese hat
    // damit nie fuer einen frueheren Tag gegolten. Dann ist eine zweite Fassung
    // sinnlos, die bestehende Zeile wird vollstaendig ersetzt.
    $satz = implode(', ', array_map(fn($k) => "$k = ?", array_keys($felder)));
    $s = db()->prepare("UPDATE masterschichten SET $satz WHERE id = ?");
    $s->execute([...array_values($felder), $id]);
    json_response(['status' => 'ok', 'id' => $id, 'art' => 'ersetzt']);
}

$pdo = db();
$pdo->beginTransaction();
try {
    $ende = tagDavor($gueltigAb);
    // Ein bereits gesetztes frueheres Enddatum bleibt stehen.
    if ($alt['gueltig_bis'] === null || $alt['gueltig_bis'] > $ende) {
        $pdo->prepare('UPDATE masterschichten SET gueltig_bis = ? WHERE id = ?')->execute([$ende, $id]);
    }
    $neu = einfuegen($felder, $id);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    // Die einheitliche Fehlerbehandlung in db.php formuliert die Meldung --
    // so erfaehrt der Admin z.B., dass eine Tabelle noch fehlt.
    throw $e;
}

json_response(['status' => 'ok', 'id' => $neu, 'art' => 'neue Fassung', 'alt_bis' => $ende]);
