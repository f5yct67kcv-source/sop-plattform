<?php
// Gibt es fuer die angemeldete Person UEBERHAUPT noch einen offenen
// Rundgang? (ENT-624)
//
// Der Unterschied zu mein_rundgang_offen.php ist die fehlende einsatz_id:
// Jener Endpunkt beantwortet "laeuft fuer DIESEN Einsatz noch etwas" und
// setzt damit voraus, dass die App schon weiss, wo sie suchen soll. Nach
// einem App-Neustart weiss sie das nicht mehr -- rundgangAktiv lebt nur im
// Arbeitsspeicher der Sitzung, und mit ihm verschwand bis hierher auch der
// Hinweis-Chip aus ENT-234. Eine am Vorabend pausierte Runde war danach
// unsichtbar, obwohl sie in der Auswertung weiterlief.
//
// Bewusst MAGER: nur, was die Rueckfrage beim Start anzeigen muss. Die
// vollstaendige Runde samt Kontrollpunkten, Aufgaben und Ansprechpartnern
// holt erst "Fortsetzen" ueber mein_rundgang_offen.php. Dieser Endpunkt
// laeuft bei jedem App-Start und bei jeder Rueckkehr aus dem Hintergrund;
// er darf nichts kosten.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$pdo = db();

// Ausschliesslich die eigenen Runden: mitarbeiter_id kommt aus der Sitzung,
// nie aus der Anfrage. Damit braucht es hier keine zusaetzliche Pruefung der
// Zuteilung -- wem die Runde gehoert, steht in der Zeile selbst.
$stmt = $pdo->prepare(
    "SELECT r.id, r.einsatz_id, r.objekt_id, r.rundgang_vorlage_id, r.status,
            r.vorbereitet_am, r.rohzeit_start, r.pausiert_seit, r.pause_minuten,
            e.datum AS einsatz_datum,
            o.name AS objekt_name, o.kunde_name,
            v.name AS vorlage_name
       FROM rundgang r
       JOIN einsaetze e ON e.id = r.einsatz_id
       JOIN objekte   o ON o.id = r.objekt_id
  LEFT JOIN rundgang_vorlage v ON v.id = r.rundgang_vorlage_id
      WHERE r.mitarbeiter_id = ? AND r.status IN ('vorbereitet','laeuft','pausiert')
      ORDER BY r.id DESC"
);
$stmt->execute([(int)$user['id']]);
$offene = $stmt->fetchAll(PDO::FETCH_ASSOC);
if (!$offene) {
    json_response(['status' => 'ok', 'rundgang' => null, 'weitere' => 0]);
}

$r = $offene[0];
$vorlageId = $r['rundgang_vorlage_id'] !== null ? (int)$r['rundgang_vorlage_id'] : null;
// Dieselbe Zaehlung wie ueberall sonst (rundgang_fortschritt): Ein
// Ersatzscan zaehlt als erledigt, "nicht verfuegbar" nicht. Neu gerechnet
// waere es eine zweite Wahrheit ueber denselben Fortschritt.
$fortschritt = rundgang_fortschritt($pdo, (int)$r['id'], (int)$r['objekt_id'], $vorlageId);

json_response(['status' => 'ok', 'rundgang' => [
    'id'             => (int)$r['id'],
    'einsatz_id'     => (int)$r['einsatz_id'],
    // Damit die App die Schicht nachladen kann, wenn sie ausserhalb des
    // geladenen Zeitraums liegt -- genau der Fall einer vergessenen Runde
    // vom Vormonat.
    'einsatz_datum'  => $r['einsatz_datum'],
    'status'         => (string)$r['status'],
    'vorbereitet_am' => $r['vorbereitet_am'],
    'rohzeit_start'  => $r['rohzeit_start'],
    'pausiert_seit'  => $r['pausiert_seit'],
    'pause_minuten'  => (int)$r['pause_minuten'],
    'objekt_name'    => (string)($r['objekt_name'] ?? ''),
    'kunde_name'     => $r['kunde_name'],
    // Ohne gewaehlte Kontrollrunde bleibt das null, und die App sagt dann
    // ausdruecklich "alle Punkte des Objekts" statt die Zeile leer zu
    // lassen ("unbekannt" darf nie wie "keine" aussehen).
    'vorlage_name'   => $r['vorlage_name'],
    'punkte_anzahl'  => (int)$fortschritt['gesamt'],
    'erledigt_anzahl' => (int)$fortschritt['erledigt'],
], 'weitere' => count($offene) - 1]);
