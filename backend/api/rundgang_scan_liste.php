<?php
// Einzelne Kontrollpunkt-Scans fuer die Auswertung "Kontrollpunktscans"
// (ENT-243) -- feinere Koernung als rundgang_liste.php, das nur den ganzen
// Rundgang zeigt. Reine Anzeige, keine Berechnung.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'rundgang_einsehen');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Ohne Zeitraum: der heutige Tag -- gleiche Regel wie rundgang_liste.php.
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-d');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $von;
$objektId = isset($_GET['objekt_id']) && $_GET['objekt_id'] !== '' ? (int)$_GET['objekt_id'] : null;

$sql = 'SELECT s.id, s.erfasst_am, s.status, s.beschreibung,
               k.bezeichnung AS kontrollpunkt_name,
               e.kunde_name, o.name AS objekt_name, e.titel,
               m.vorname, m.nachname
          FROM rundgang_scan s
          JOIN rundgang r ON r.id = s.rundgang_id
          JOIN einsaetze e ON e.id = r.einsatz_id
          JOIN objekte o ON o.id = r.objekt_id
          JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          LEFT JOIN kontrollpunkt k ON k.id = s.kontrollpunkt_id
         WHERE DATE(s.erfasst_am) BETWEEN ? AND ?';
$params = [$von, $bis];
if ($objektId !== null) {
    $sql .= ' AND r.objekt_id = ?';
    $params[] = $objektId;
}
$sql .= ' ORDER BY s.erfasst_am DESC';

$stmt = db()->prepare($sql);
$stmt->execute($params);

// Erledigte Aufgaben derselben Zeitspanne (ENT-305). Eigene Abfrage statt
// eines JOIN auf die Scans: Eine Aufgabe haengt am Rundgang und am
// Kontrollpunkt, nicht am einzelnen Scan -- und sie kann Minuten nach dem
// Scan beantwortet worden sein (der Waechter geht erst zur Tuer, dann tippt
// er). Ein JOIN ueber den Scan wuerde sie entweder verdoppeln oder verlieren.
//
// bezeichnung kommt aus rundgang_aufgabe, NICHT aus dem Katalog: Der Text ist
// dort zum Zeitpunkt der Erledigung kopiert worden. Eine spaetere Umbenennung
// im Katalog darf den Beleg von letzter Nacht nicht rueckwirkend aendern.
$aufgaben = [];
if (hat_tabelle(db(), 'rundgang_aufgabe')) {
    $aSql = 'SELECT ra.id, ra.erfasst_am, ra.uebermittelt_am, ra.status, ra.grund,
                    ra.bezeichnung, k.bezeichnung AS kontrollpunkt_name,
                    e.kunde_name, o.name AS objekt_name, e.titel,
                    m.vorname, m.nachname
               FROM rundgang_aufgabe ra
               JOIN rundgang r ON r.id = ra.rundgang_id
               JOIN einsaetze e ON e.id = r.einsatz_id
               JOIN objekte o ON o.id = r.objekt_id
               JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
               LEFT JOIN kontrollpunkt k ON k.id = ra.kontrollpunkt_id
              WHERE DATE(ra.erfasst_am) BETWEEN ? AND ?';
    $aWerte = [$von, $bis];
    if ($objektId !== null) { $aSql .= ' AND r.objekt_id = ?'; $aWerte[] = $objektId; }
    $aSql .= ' ORDER BY ra.erfasst_am DESC, ra.id DESC';
    $aStmt = db()->prepare($aSql);
    $aStmt->execute($aWerte);
    $aufgaben = $aStmt->fetchAll();
}

// UNBEANTWORTETE Aufgaben (ENT-311). Sie haben keine eigene Zeile -- eine
// nicht beantwortete Aufgabe ist genau das Fehlen eines Eintrags. Deshalb
// laesst sie sich nur finden, indem man die Kontrollpunkte einer beendeten
// Runde gegen den Katalog haelt.
//
// Warum das noetig ist: Der Projektinhaber wollte, dass eine nicht erledigte
// Aufgabe auffaellt. "Nicht moeglich" faellt seit ENT-311 im Meldeweg auf --
// aber der Fall "niemand hat je geantwortet" blieb unsichtbar, weil nichts
// da ist, was man anzeigen koennte. Er ist der stillere und darum
// gefaehrlichere von beiden: Bei "nicht moeglich" weiss man wenigstens, dass
// jemand hingeschaut hat.
//
// Nur BEENDETE Runden: Bei einer laufenden ist eine offene Aufgabe kein
// Mangel, sondern Arbeit, die noch aussteht. Das eine als das andere
// auszugeben waere dieselbe Verwechslung wie "unbekannt" mit "keine".
$offene = [];
if (hat_tabelle(db(), 'rundgang_aufgabe') && hat_tabelle(db(), 'kontrollpunkt_aufgabe')
    && hat_tabelle(db(), 'objekt_aufgabe')) {
    $oSql = "SELECT r.id AS rundgang_id, s.kontrollpunkt_id, k.bezeichnung AS kontrollpunkt_name,
                    a.id AS aufgabe_id, a.bezeichnung,
                    MIN(s.erfasst_am) AS erfasst_am,
                    e.kunde_name, o.name AS objekt_name, e.titel,
                    m.vorname, m.nachname
               FROM rundgang_scan s
               JOIN rundgang r ON r.id = s.rundgang_id
                    AND r.status IN ('abgeschlossen', 'abgebrochen')
               JOIN einsaetze e ON e.id = r.einsatz_id
               JOIN objekte o ON o.id = r.objekt_id
               JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
               JOIN kontrollpunkt k ON k.id = s.kontrollpunkt_id
               JOIN kontrollpunkt_aufgabe ka ON ka.kontrollpunkt_id = s.kontrollpunkt_id
               JOIN objekt_aufgabe a ON a.id = ka.aufgabe_id AND a.aktiv = 1
               LEFT JOIN rundgang_aufgabe ra ON ra.rundgang_id = r.id
                    AND ra.kontrollpunkt_id = s.kontrollpunkt_id
                    AND ra.aufgabe_id = a.id
              WHERE ra.id IS NULL AND DATE(s.erfasst_am) BETWEEN ? AND ?";
    $oWerte = [$von, $bis];
    if ($objektId !== null) { $oSql .= ' AND r.objekt_id = ?'; $oWerte[] = $objektId; }
    $oSql .= ' GROUP BY r.id, s.kontrollpunkt_id, k.bezeichnung, a.id, a.bezeichnung,
                        e.kunde_name, o.name, e.titel, m.vorname, m.nachname
               ORDER BY erfasst_am DESC, a.id';
    try {
        $oStmt = db()->prepare($oSql);
        $oStmt->execute($oWerte);
        $offene = $oStmt->fetchAll();
    } catch (Throwable $e) {
        // Die Auswertung faellt nicht wegen einer Zusatzangabe aus.
        $offene = [];
    }
}

json_response(['status' => 'ok', 'scans' => $stmt->fetchAll(), 'aufgaben' => $aufgaben,
    'offene_aufgaben' => $offene]);
