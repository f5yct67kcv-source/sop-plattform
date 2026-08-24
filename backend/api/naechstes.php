<?php
// Kurzueberblick fuers Begruessungs-Widget (ENT-032): der naechste
// anstehende Einsatz, dazu zwei Zaehler. Reine Leseoperation, kein neues
// Datenmodell.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_verwaltung($user);

$heute = date('Y-m-d');

// Zuerst ein Einsatz mit offener Stelle, sonst der naechste ueberhaupt --
// eine unbesetzte Schicht ist dringlicher als eine bereits volle.
$sql = "SELECT e.id, e.kunde_name, e.titel, e.ort, e.datum, e.von, e.bis, e.bedarf, o.name AS objekt_name,
               (SELECT COUNT(*) FROM einsatz_zuteilung z
                 WHERE z.einsatz_id = e.id AND z.zusage <> 'abgelehnt') AS zugeteilt
        FROM einsaetze e
        LEFT JOIN objekte o ON o.id = e.objekt_id
        WHERE e.status <> 'abgesagt' AND e.datum >= ?
        ORDER BY
          (SELECT COUNT(*) FROM einsatz_zuteilung z WHERE z.einsatz_id = e.id) < e.bedarf DESC,
          e.datum, e.von
        LIMIT 1";
$stmt = db()->prepare($sql);
$stmt->execute([$heute]);
$naechster = $stmt->fetch() ?: null;
if ($naechster) {
    $naechster['id'] = (int)$naechster['id'];
    $naechster['bedarf'] = (int)$naechster['bedarf'];
    $naechster['zugeteilt'] = (int)$naechster['zugeteilt'];
}

$stmt2 = db()->prepare(
    "SELECT COUNT(*) FROM einsatz_zuteilung z
     JOIN einsaetze e ON e.id = z.einsatz_id
     WHERE z.zusage = 'offen' AND e.status <> 'abgesagt' AND e.datum >= ?"
);
$stmt2->execute([$heute]);
$offeneZusagen = (int)$stmt2->fetchColumn();

// Die Tabelle kann fehlen, solange OP-29 nicht erledigt ist -- dann zaehlt
// dieser Teil einfach als 0, statt den ganzen Aufruf scheitern zu lassen.
$neueSperrtage = 0;
try {
    $stmt3 = db()->prepare('SELECT COUNT(*) FROM verfuegbarkeiten WHERE datum >= ?');
    $stmt3->execute([$heute]);
    $neueSperrtage = (int)$stmt3->fetchColumn();
} catch (Throwable $e) {
    $neueSperrtage = 0;
}

json_response([
    'status' => 'ok',
    'naechster_einsatz' => $naechster,
    'offene_zusagen' => $offeneZusagen,
    'neue_sperrtage' => $neueSperrtage,
]);
