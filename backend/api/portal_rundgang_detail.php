<?php
// Kundenportal: EINE Runde in voller Tiefe (ENT-455).
//
// GET ?rundgang_id=<n> -> { status, rundgang: { ... } }
//
// Das Gegenstueck zu rundgang_detail.php, aber NICHT dessen Wiederverwendung:
// Jener Endpunkt haengt an require_session() und rundgaenge_lesen, und ihn
// fuer zwei Personenkreise zu oeffnen hiesse, an einer Stelle ueber beide zu
// entscheiden. Ein Kundenzugang und ein Verwaltungszugang trennen sich hier
// genauso wie in kundenportal.php begruendet.
//
// WAS MITGEHT UND WAS NICHT:
//
//   - Der NAME der eingesetzten Person geht MIT (ENT-481). OP-423 war lange
//     offen; der Projektinhaber hat am 2026-09-08 entschieden, den Rapport
//     „1:1" zu zeigen, mit der Begruendung, der Kunde bekomme ohnehin schon
//     eine physische Kopie davon. Damit ist der Name kein neuer Datenfluss,
//     sondern derselbe auf einem zweiten Weg -- die tragende Ueberlegung
//     hinter ENT-441.
//   - Der ABBRUCHGRUND ebenso, und zwar als KLARTEXT aus dem Katalog, nicht
//     als Codewort (dieselbe Regel wie im Cockpit, ENT-324). Die Zuordnung
//     bleibt hier im Server; eine zweite Kopie des Katalogs in portal.html
//     liefe beim naechsten Grund auseinander.
//   - Der KUNDENNAME und der interne Einsatztitel (einsaetze.titel) bleiben
//     draussen. Der erste ist im Portal immer derselbe, der zweite ist fuer
//     Disponenten geschrieben -- er steht auf keinem Blatt an den Kunden.
//   - Die BEWEGUNGSSPUR bleibt in portal_rundgang_weg.php und kommt erst auf
//     einen Knopfdruck (ENT-474).
//
// Die kunde_id kommt aus der Sitzung, nie aus der Anfrage.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$rundgangId = (int)($_GET['rundgang_id'] ?? 0);
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

// EINE Antwort fuer alle drei Faelle: gibt es nicht / gehoert einem anderen
// Kunden / laeuft noch. Drei verschiedene Antworten waeren ein
// Auskunftsdienst darueber, welche Nummern im System vergeben sind.
$nichtAbrufbar = static function (): void {
    json_response(['status' => 'error',
        'message' => 'Dieser Rundgang ist nicht abrufbar.'], 404);
};

if (!$objektIds) { $nichtAbrufbar(); }

$stmt = $pdo->prepare(
    'SELECT r.id, r.objekt_id, r.status, r.rundgang_vorlage_id,
            r.rohzeit_start, r.rohzeit_ende, r.pause_minuten,
            r.abbruch_grund, r.abbruch_freitext,
            e.datum, o.name AS objekt_name, o.strasse, o.ort,
            m.vorname, m.nachname,
            (SELECT MAX(s.erfasst_am) FROM rundgang_scan s WHERE s.rundgang_id = r.id) AS letzter_scan
       FROM rundgang r
       JOIN einsaetze e ON e.id = r.einsatz_id
       JOIN objekte o ON o.id = r.objekt_id
       JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
      WHERE r.id = ?'
);
$stmt->execute([$rundgangId]);
$r = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$r) { $nichtAbrufbar(); }

$laeuft = in_array((string)$r['status'], RUNDGANG_OFFENE_STATUS, true);
if (!kp_runde_sichtbar((int)$r['objekt_id'], $objektIds, $laeuft)) { $nichtAbrufbar(); }

$objektId  = (int)$r['objekt_id'];
$vorlageId = $r['rundgang_vorlage_id'] !== null ? (int)$r['rundgang_vorlage_id'] : null;

// Alle Punkte der Runde -- auch die NICHT besuchten. Nur die Scans zu zeigen
// hiesse, dass ein ausgelassener Kontrollpunkt im Nachweis gar nicht
// vorkommt; ein Nachweis, in dem das Fehlende fehlt, ist keiner
// (ENT-441 Punkt 3, wortgleich zur Begruendung in rundgang_detail.php).
$scans = $pdo->prepare(
    'SELECT id, kontrollpunkt_id, status, erfasst_am, beschreibung,
            foto_mime IS NOT NULL AS hat_foto
       FROM rundgang_scan WHERE rundgang_id = ?'
);
$scans->execute([$rundgangId]);
$erledigtNach = [];
foreach ($scans->fetchAll(PDO::FETCH_ASSOC) as $s) {
    if ($s['kontrollpunkt_id'] !== null) {
        $erledigtNach[(int)$s['kontrollpunkt_id']] = [
            'scan_id'      => (int)$s['id'],
            'status'       => (string)$s['status'],
            'erfasst_am'   => $s['erfasst_am'],
            'beschreibung' => $s['beschreibung'],
            'hat_foto'     => (bool)$s['hat_foto'],
        ];
    }
}

// Der Name der Kontrollrunde gehoert dazu -- er steht im Rapport, den der
// Kunde heute per Mail bekommt ("Runde: Schlusskontrolle" sagt etwas,
// "Runde: 3 von 12 Punkten des Objekts" nicht). Anders als
// `einsaetze.titel` ist er kein interner Planungstitel.
$vorlageName = null;
if ($vorlageId !== null) {
    $v = $pdo->prepare('SELECT name FROM rundgang_vorlage WHERE id = ?');
    $v->execute([$vorlageId]);
    $name = $v->fetchColumn();
    if ($name !== false) { $vorlageName = (string)$name; }
}

$rohPunkte = rundgang_punkte_der_runde($pdo, $objektId, $vorlageId);
$rohPunkte = array_map(static function ($k) use ($erledigtNach) {
    $k['id'] = (int)$k['id'];
    $k['erledigt'] = $erledigtNach[$k['id']] ?? null;
    return $k;
}, $rohPunkte);
$mitAufgaben = rundgang_punkte_mit_aufgaben($pdo, $rundgangId, $rohPunkte);

// Die Geodaten der Kontrollpunkte (lat/lng/geofence_radius_m) bleiben hier
// draussen. Sie kommen aus rundgang_punkte_der_runde() mit, werden aber
// ohne Karte fuer nichts gebraucht -- und was nicht gebraucht wird, wird
// nicht ausgeliefert.
$punkte = array_map(static fn(array $k): array => [
    'id'          => (int)$k['id'],
    'bezeichnung' => (string)$k['bezeichnung'],
    'erledigt'    => $k['erledigt'],
    'aufgaben'    => $k['aufgaben'] ?? [],
], $mitAufgaben);

// Ereignisse dieser Runde (ENT-441 Punkt 3a: im Fremdsystem ein eigener
// Menuepunkt der Kundenansicht, hier unter der Runde, an der sie haengen).
// Das Foto selbst bleibt draussen -- es waere ein LONGBLOB je Zeile.
$ereignisse = [];
if (hat_tabelle($pdo, 'ereignis_meldung')) {
    // ENT-545: Auch der Kunde soll „Foto nach 90 Tagen entfernt" sehen und
    // nicht denselben leeren Platz wie bei einer Meldung ohne Foto.
    $weg = hat_spalte($pdo, 'ereignis_meldung', 'foto_geloescht_am')
        ? 'em.foto_geloescht_am IS NOT NULL' : '0';
    $eStmt = $pdo->prepare(
        'SELECT em.id, em.erfasst_am, em.bemerkung,
                em.foto_mime IS NOT NULL AS hat_foto,
                ' . $weg . ' AS foto_geloescht, ea.bezeichnung AS art
           FROM ereignis_meldung em
           LEFT JOIN ereignisart ea ON ea.id = em.ereignisart_id
          WHERE em.rundgang_id = ?
          ORDER BY em.erfasst_am, em.id'
    );
    $eStmt->execute([$rundgangId]);
    foreach ($eStmt->fetchAll(PDO::FETCH_ASSOC) as $e) {
        $ereignisse[] = [
            'id'         => (int)$e['id'],
            'erfasst_am' => $e['erfasst_am'],
            'art'        => $e['art'],
            'bemerkung'  => $e['bemerkung'],
            'hat_foto'   => (bool)$e['hat_foto'],
            'foto_geloescht' => (bool)$e['foto_geloescht'],
        ];
    }
}

// Zustellnachweis (ENT-491). ERST HIER, nach allen Zuschnittspruefungen:
// Vermerkt wird nur, was auch wirklich ausgeliefert wird. Ein Vermerk
// vor der Pruefung hielte fest, dass jemand nach einer fremden Nummer
// gefragt hat -- das ist keine Zustellung, sondern eine Beobachtung.
kp_abruf_vermerken($pdo, (int)$zugang['id'], 'rundgang', $rundgangId);

json_response(['status' => 'ok', 'rundgang' => [
    'id'             => (int)$r['id'],
    'datum'          => (string)$r['datum'],
    'objekt_name'    => (string)$r['objekt_name'],
    'strasse'        => (string)($r['strasse'] ?? ''),
    'ort'            => (string)($r['ort'] ?? ''),
    'status'         => (string)$r['status'],
    'vorlage_name'   => $vorlageName,
    // Vor- und Nachname zusammengesetzt und nicht als zwei Felder: Wie ein
    // Name geschrieben wird, entscheidet der Server -- sonst tut es jede
    // Oberflaeche anders.
    'person'         => trim(((string)$r['vorname']) . ' ' . ((string)$r['nachname'])),
    // Klartext statt Codewort (ENT-324). Ohne Abbruch bleibt beides null --
    // ein leerer Grund an einer abgeschlossenen Runde waere eine Aussage
    // ueber nichts.
    'abbruch_grund'  => $r['abbruch_grund'] !== null
        ? (RUNDGANG_ABBRUCH_GRUENDE[$r['abbruch_grund']] ?? (string)$r['abbruch_grund'])
        : null,
    'abbruch_freitext' => $r['abbruch_freitext'],
    'rohzeit_start'  => $r['rohzeit_start'],
    'rohzeit_ende'   => $r['rohzeit_ende'],
    'letzter_scan'   => $r['letzter_scan'],
    'pause_minuten'  => (int)$r['pause_minuten'],
    'dauer'          => rundgang_dauer($r['rohzeit_start'], $r['rohzeit_ende'],
        $r['letzter_scan'], (int)$r['pause_minuten'], (string)$r['status']),
    'fortschritt'    => rundgang_fortschritt($pdo, $rundgangId, $objektId, $vorlageId),
    'kontrollpunkte' => $punkte,
    // Immer mitgeliefert, auch leer: „keine Ereignisse" ist eine Aussage,
    // ein fehlendes Feld keine (Hausregel).
    'ereignisse'     => $ereignisse,
]]);
