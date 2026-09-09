<?php
// Eine einzelne Runde in voller Tiefe (ENT-322).
//
// Warum ein eigener Endpunkt und nicht mehr Felder an rundgang_liste.php:
// Die Liste zeigt vierzehn Tage. Haengte man jeder Zeile ihre Kontrollpunkte,
// Aufgaben und Ereignisse an, laedt jeder Aufruf der Revierdienst-Startseite
// die Nachweise mehrerer hundert Runden mit -- fuer eine Uebersicht, in der
// davon nichts zu sehen ist. Dasselbe Prinzip wie bei rundgang_spur.php:
// Der schwerere Datenbestand kommt erst, wenn ihn jemand ausdruecklich
// ansieht.
//
// Die Bewegungsspur steht bewusst NICHT hier drin, sondern bleibt in
// rundgang_spur.php. Sie ist der heikelste Teil, und ein Rapport soll sich
// erzeugen lassen, ohne dass dabei zwangslaeufig Aufenthaltsdaten mitgeladen
// werden (Entscheid des Projektinhabers zu ENT-322: keine Karte im Rapport).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../rundgang.php';

$user = require_session();
require_recht($user, 'rundgaenge_lesen');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$rundgangId = (int)($_GET['rundgang_id'] ?? 0);
if ($rundgangId <= 0) {
    json_response(['status' => 'error', 'message' => 'rundgang_id erforderlich'], 422);
}

$pdo = db();
$stmt = $pdo->prepare(
    'SELECT r.id, r.einsatz_id, r.objekt_id, r.mitarbeiter_id, r.status,
            r.rundgang_vorlage_id,
            r.vorbereitet_am, r.rohzeit_start, r.rohzeit_ende,
            r.pause_minuten, r.abbruch_grund, r.abbruch_freitext, r.ausnahme_grund,
            e.datum, e.kunde_name, e.titel, e.von, e.bis, e.kunde_id,
            o.name AS objekt_name, o.strasse, o.ort,
            m.vorname, m.nachname, kd.email AS kunde_email,
            (SELECT MAX(s.erfasst_am) FROM rundgang_scan s WHERE s.rundgang_id = r.id) AS letzter_scan
       FROM rundgang r
       JOIN einsaetze e ON e.id = r.einsatz_id
       JOIN objekte o ON o.id = r.objekt_id
       JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
       LEFT JOIN kunden kd ON kd.id = e.kunde_id
      WHERE r.id = ?'
);
$stmt->execute([$rundgangId]);
$rundgang = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$rundgang) {
    json_response(['status' => 'error', 'message' => 'Rundgang nicht gefunden'], 404);
}

$objektId = (int)$rundgang['objekt_id'];
$vorlageId = $rundgang['rundgang_vorlage_id'] !== null ? (int)$rundgang['rundgang_vorlage_id'] : null;

// Der Name der gewaehlten Kontrollrunde gehoert in den Rapport: "Runde:
// Schlusskontrolle" sagt etwas, "Runde: 3 von 12 Punkten des Objekts" nicht.
$rundgang['vorlage_name'] = null;
if ($vorlageId !== null) {
    $v = $pdo->prepare('SELECT name FROM rundgang_vorlage WHERE id = ?');
    $v->execute([$vorlageId]);
    $name = $v->fetchColumn();
    if ($name !== false) { $rundgang['vorlage_name'] = (string)$name; }
}

$rundgang['dauer'] = rundgang_dauer(
    $rundgang['rohzeit_start'], $rundgang['rohzeit_ende'], $rundgang['letzter_scan'],
    (int)$rundgang['pause_minuten'], (string)$rundgang['status']
);
$rundgang['fortschritt'] = rundgang_fortschritt($pdo, $rundgangId, $objektId, $vorlageId);

// Alle Punkte der Runde -- auch die NICHT besuchten. Nur die Scans zu zeigen
// hiesse, dass ein ausgelassener Kontrollpunkt im Rapport gar nicht
// vorkommt; ein Nachweis, in dem das Fehlende fehlt, ist keiner.
// Die id kommt mit (ENT-329): Ohne sie liesse sich das Foto eines
// Ersatzscans nicht abrufen -- rundgang_scan_foto.php braucht sie.
$scans = $pdo->prepare(
    'SELECT id, kontrollpunkt_id, status, erfasst_am, uebermittelt_am, beschreibung,
            foto_mime IS NOT NULL AS hat_foto
       FROM rundgang_scan WHERE rundgang_id = ?'
);
$scans->execute([$rundgangId]);
$erledigtNach = [];
foreach ($scans->fetchAll(PDO::FETCH_ASSOC) as $s) {
    if ($s['kontrollpunkt_id'] !== null) {
        $erledigtNach[(int)$s['kontrollpunkt_id']] = [
            'scan_id'       => (int)$s['id'],
            'status'        => $s['status'],
            'erfasst_am'    => $s['erfasst_am'],
            'uebermittelt_am' => $s['uebermittelt_am'],
            'beschreibung'  => $s['beschreibung'],
            'hat_foto'      => (bool)$s['hat_foto'],
        ];
    }
}

$punkte = array_map(static function ($k) use ($erledigtNach) {
    $k['id'] = (int)$k['id'];
    $k['erledigt'] = $erledigtNach[$k['id']] ?? null;
    return $k;
}, rundgang_punkte_der_runde($pdo, $objektId, $vorlageId));
$rundgang['kontrollpunkte'] = rundgang_punkte_mit_aufgaben($pdo, $rundgangId, $punkte);

// Ereignisse dieser Runde (ENT-297/ENT-311). Das Foto selbst bleibt draussen
// -- es waere ein LONGBLOB je Zeile in einer Antwort, die sonst wenige
// Kilobyte hat. Ob eines vorliegt, steht als Kennzeichen mit drin.
$ereignisse = [];
if (hat_tabelle($pdo, 'ereignis_meldung')) {
    $eStmt = $pdo->prepare(
        'SELECT em.id, em.erfasst_am, em.vorfall_am, em.bemerkung,
                em.foto_mime IS NOT NULL AS hat_foto, ea.bezeichnung AS art
           FROM ereignis_meldung em
           LEFT JOIN ereignisart ea ON ea.id = em.ereignisart_id
          WHERE em.rundgang_id = ?
          ORDER BY em.erfasst_am, em.id'
    );
    $eStmt->execute([$rundgangId]);
    foreach ($eStmt->fetchAll(PDO::FETCH_ASSOC) as $e) {
        $e['hat_foto'] = (bool)$e['hat_foto'];
        $ereignisse[] = $e;
    }
}
$rundgang['ereignisse'] = $ereignisse;

// ── Zustellnachweis (ENT-491) ─────────────────────────────────────────
// Hat der Kunde diesen Rapport gesehen? VIER verschiedene Antworten, und
// keine darf wie eine andere aussehen (CLAUDE.md: „unbekannt darf nie wie
// keine aussehen"):
//
//   nicht_eingerichtet — die Tabelle fehlt, es wird gar nicht mitgeschrieben
//   kein_zugang        — dieses Objekt hat keinen Kundenzugang; es KANN
//                        niemand abgerufen haben
//   nicht_abgerufen    — es gibt einen Zugang, er war nur noch nicht dran
//   abgerufen          — mit Zeitpunkt
//
// „kein_zugang" und „nicht_abgerufen" als dasselbe auszugeben waere der
// schlimmste der vier Fehler: Man wartet auf einen Kunden, der den Rapport
// nie zu sehen bekommen kann.
$zustellung = ['stand' => 'nicht_eingerichtet'];
if (hat_tabelle($pdo, 'portal_abruf')) {
    $kundeStmt = $pdo->prepare(
        'SELECT COUNT(*) FROM kundenzugang z
           JOIN objekte o ON o.kunde_id = z.kunde_id
          WHERE o.id = ? AND z.aktiv = 1'
    );
    $kundeStmt->execute([$objektId]);
    $zugaenge = (int)$kundeStmt->fetchColumn();

    if ($zugaenge === 0) {
        $zustellung = ['stand' => 'kein_zugang'];
    } else {
        // Der frueheste Abruf ueber ALLE Zugaenge dieses Kunden. Wer von
        // mehreren Ansprechpersonen ihn geholt hat, ist fuer die Frage
        // „ist er angekommen" ohne Belang -- und ein Name mehr in der
        // Antwort waere ein Personendatum ohne Zweck.
        $aStmt = $pdo->prepare(
            'SELECT MIN(a.erstmals_am) AS erstmals, MAX(a.zuletzt_am) AS zuletzt,
                    SUM(a.anzahl) AS anzahl, MIN(a.pdf_erstmals_am) AS pdf_erstmals,
                    SUM(a.pdf_anzahl) AS pdf_anzahl, COUNT(*) AS zugaenge
               FROM portal_abruf a
              WHERE a.rundgang_id = ?'
        );
        $aStmt->execute([$rundgangId]);
        $a = $aStmt->fetch(PDO::FETCH_ASSOC);
        if (!$a || $a['erstmals'] === null) {
            $zustellung = ['stand' => 'nicht_abgerufen', 'zugaenge' => $zugaenge];
        } else {
            $zustellung = [
                'stand'        => 'abgerufen',
                'erstmals_am'  => (string)$a['erstmals'],
                'zuletzt_am'   => (string)$a['zuletzt'],
                'anzahl'       => (int)$a['anzahl'],
                // Getrennt ausgewiesen, weil es SCHWAECHER wiegt: Das PDF
                // entsteht im Browser, der Server hat nur die Meldung.
                'pdf_erstmals_am' => $a['pdf_erstmals'] === null ? null : (string)$a['pdf_erstmals'],
                'pdf_anzahl'      => (int)$a['pdf_anzahl'],
                'personen'        => (int)$a['zugaenge'],
            ];
        }
    }
}
$rundgang['zustellung'] = $zustellung;

json_response(['status' => 'ok', 'rundgang' => $rundgang]);
