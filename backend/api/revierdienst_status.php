<?php
// Wer ist heute im Revierdienst eingeteilt und was macht er gerade?
//
// Die Hauptseite unter "Revierdienst" beantwortet der Einsatzleitung genau
// eine Frage: Wer ist draussen, und wie steht es um ihn. Alles hier ist aus
// dem BESTEHENDEN Datenbestand abgeleitet -- keine neue Tabelle, keine neue
// Spalte.
//
// WER ERSCHEINT (Entscheid des Projektinhabers, 2026-08-29)
// Alle heute fuer einen Revierdienst-Einsatz eingeteilten Personen -- nicht
// nur die mit laufendem Rundgang. Sonst gaebe es den Zustand "eingeteilt,
// aber noch nicht losgelaufen" gar nicht, und genau der interessiert die
// Einsatzleitung am meisten.
//
// DIE DREI ZUSTAENDE
//   aktiv  -> ein Rundgang mit Status 'offen' laeuft
//   pause  -> ein Rundgang mit Status 'pausiert'
//   frei   -> eingeteilt, aber gerade kein offener Rundgang
// 'vorbereitet' zaehlt bewusst als frei: Der Rundgang ist angelegt, aber
// niemand ist unterwegs -- ihn als "aktiv" auszugeben waere eine Aussage
// ueber die Person, die nicht stimmt.
//
// KEIN ALARM
// Das Mockup zeigt einen vierten Zustand "Alarm". Dafuer gibt es im
// Datenmodell NICHTS -- kein Feld, keine Tabelle, kein Ereignis, nur das
// Recht 'alarmempfaenger'. Ein erfundener Alarmzustand waere in einem
// Waechtersystem schlimmer als keiner: Er sagt "alles ruhig", ohne es zu
// wissen. Bleibt offen, siehe OP-233.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');

$heute = date('Y-m-d');
$pdo = db();

// Ein Rundgang haengt an (einsatz_id, mitarbeiter_id). Der LEFT JOIN nimmt
// nur laufende und pausierte -- abgeschlossene und abgebrochene sagen nichts
// darueber, was die Person JETZT tut.
$stmt = $pdo->prepare(
    "SELECT m.id AS mitarbeiter_id, m.vorname, m.nachname, m.funktion_id,
            e.id AS einsatz_id, e.titel, e.von, e.bis, e.objekt_id,
            o.name AS objekt_name,
            r.id AS rundgang_id, r.status AS rundgang_status, r.rohzeit_start
       FROM einsatz_zuteilung z
       JOIN einsaetze e   ON e.id = z.einsatz_id
       JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
       LEFT JOIN objekte o ON o.id = e.objekt_id
       LEFT JOIN rundgang r ON r.einsatz_id = e.id
                           AND r.mitarbeiter_id = m.id
                           AND r.status IN ('offen', 'pausiert')
      WHERE e.datum = ? AND e.einsatzart = 'Revierdienst'
      ORDER BY m.nachname, m.vorname"
);
$stmt->execute([$heute]);
$zeilen = $stmt->fetchAll();

// Funktionsbezeichnungen getrennt nachschlagen. Die Tabelle wird von der
// Einrichtung angelegt und kann fehlen -- dann bleibt die Funktion null und
// die Oberflaeche sagt "Funktion nicht hinterlegt" statt gar nichts. Ein
// LEFT JOIN auf eine fehlende Tabelle wuerde die ganze Abfrage sprengen.
$funktionen = [];
try {
    foreach ($pdo->query('SELECT id, bezeichnung FROM ma_funktion') as $f) {
        $funktionen[(int)$f['id']] = (string)$f['bezeichnung'];
    }
} catch (Throwable $e) {
    $funktionen = [];
}

// Der zuletzt bestaetigte Scan je laufendem Rundgang -- das "· Tor 4" hinter
// dem Objektnamen.
//
// Gueltige Scan-Zustaende sind 'bestaetigt', 'nicht_verfuegbar' und
// 'ersatzscan' (siehe mein_rundgang_scan.php). Gezaehlt werden hier nur die
// ersten und letzten: Beide belegen, dass die Person an diesem Punkt WAR --
// ein Ersatzscan ist ein bestaetigter Nachweis auf anderem Weg (ENT-210).
// 'nicht_verfuegbar' belegt das Gegenteil: der Punkt war nicht erreichbar,
// die Person also gerade NICHT dort. Ihn mitzuzaehlen hiesse, die
// Einsatzleitung an einen Ort zu schicken, wo niemand ist.
$letzterPunkt = [];
$rundgangIds = array_values(array_filter(array_map(
    static fn($z) => $z['rundgang_id'] !== null ? (int)$z['rundgang_id'] : null, $zeilen)));
if ($rundgangIds) {
    $platzhalter = implode(',', array_fill(0, count($rundgangIds), '?'));
    try {
        $s = $pdo->prepare(
            "SELECT s.rundgang_id, k.bezeichnung, s.erfasst_am
               FROM rundgang_scan s
               JOIN kontrollpunkt k ON k.id = s.kontrollpunkt_id
              WHERE s.rundgang_id IN ($platzhalter)
                AND s.status IN ('bestaetigt', 'ersatzscan')
              ORDER BY s.erfasst_am ASC"
        );
        $s->execute($rundgangIds);
        foreach ($s->fetchAll() as $sc) {
            $letzterPunkt[(int)$sc['rundgang_id']] = (string)$sc['bezeichnung'];
        }
    } catch (Throwable $e) {
        $letzterPunkt = [];
    }
}

$leute = array_map(static function (array $z) use ($funktionen, $letzterPunkt) {
    $rid = $z['rundgang_id'] !== null ? (int)$z['rundgang_id'] : null;
    $status = 'frei';
    if ($z['rundgang_status'] === 'offen')    { $status = 'aktiv'; }
    if ($z['rundgang_status'] === 'pausiert') { $status = 'pause'; }
    $fid = $z['funktion_id'] !== null ? (int)$z['funktion_id'] : null;
    return [
        'mitarbeiter_id' => (int)$z['mitarbeiter_id'],
        'vorname'        => $z['vorname'],
        'nachname'       => $z['nachname'],
        // null heisst "nicht hinterlegt" und ist etwas anderes als ""
        'funktion'       => $fid !== null ? ($funktionen[$fid] ?? null) : null,
        'einsatz_id'     => (int)$z['einsatz_id'],
        'titel'          => $z['titel'],
        'von'            => $z['von'],
        'bis'            => $z['bis'],
        'objekt_id'      => $z['objekt_id'] !== null ? (int)$z['objekt_id'] : null,
        'objekt_name'    => $z['objekt_name'],
        'rundgang_id'    => $rid,
        'status'         => $status,
        'letzter_punkt'  => $rid !== null ? ($letzterPunkt[$rid] ?? null) : null,
    ];
}, $zeilen);

// Zwei Zahlen, zwei Bedeutungen -- getrennt ausgewiesen, damit die
// Oberflaeche sie nicht unter eine Ueberschrift zwingt (Hausregel
// "Einheiten nie vermischen"): eingeteilt zaehlt Personen, aktiv zaehlt
// laufende Rundgaenge.
$aktiv = count(array_filter($leute, static fn($l) => $l['status'] === 'aktiv'));

json_response([
    'status'     => 'ok',
    'datum'      => $heute,
    'leute'      => $leute,
    'eingeteilt' => count($leute),
    'aktiv'      => $aktiv,
]);
