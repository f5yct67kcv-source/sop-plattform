<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();

// Admins sehen alle Rapporte (Uebersicht/Rechnungsstellung), normale
// Mitarbeitende nur die eigenen -- Kundendaten anderer Einsaetze gehen
// einen einzelnen Mitarbeitenden nichts an.
// einsatz_id/mitarbeiter_id werden mitgeliefert, damit App und Dashboard
// einen Schicht-Rapport seiner Zuteilung zuordnen koennen (ENT-082). Ein
// manueller Rapport traegt einsatz_id weiterhin als NULL.
$sql = 'SELECT r.id, r.datum, r.mitarbeiter_id, r.einsatz_id, m.name AS mitarbeiter, r.kunde, r.strasse, r.ort, r.auftrag_nr,
               r.einsatzart, r.von, r.bis, r.pause_min, r.netto_h, r.unterzeichner, r.unterschrift, r.bemerkung, r.erfasst_am
        FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id';

// Wer die Ist-Zeiten abgleicht, sieht alle Rapporte. Alle anderen sehen
// ausschliesslich die eigenen -- auch die Personalrolle, denn ein Rapport
// ist Arbeitszeit und keine Personalakte (ENT-077).
if (darf($user, 'abgleich')) {
    $rows = db()->query($sql . ' ORDER BY r.datum DESC, r.id DESC')->fetchAll();
} else {
    $stmt = db()->prepare($sql . ' WHERE r.mitarbeiter_id = ? ORDER BY r.datum DESC, r.id DESC');
    $stmt->execute([$user['id']]);
    $rows = $stmt->fetchAll();
}

json_response(['status' => 'ok', 'rapporte' => $rows]);
