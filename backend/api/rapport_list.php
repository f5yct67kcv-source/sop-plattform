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
// Kundenstammdaten fuer den Ausdruck kommen MIT dem Rapport (ENT-155) und
// werden nicht in der Oberflaeche aus einsaetze/kunden zusammengesucht: beide
// Listen werden dort erst beim Oeffnen ihrer Ansicht geladen. Wer direkt
// unter "Rapporte" druckt, haette sonst je nach zuvor besuchter Ansicht mal
// eine Kundennummer auf dem Blatt und mal nicht -- ein Unterschied, den
// niemand sieht und niemand erklaeren kann.
//
// Der Weg ist ausschliesslich r.einsatz_id -> einsaetze.kunde_id. Ueber den
// Kundennamen zu verknuepfen waere bequem und falsch: Namen wiederholen sich
// und aendern sich, und der Treffer landet als Rechnungsadresse auf einem
// Beleg, der Richtung Rechnung geht. Ein manuell erfasster Rapport bleibt
// darum ohne Kundenstamm -- und das Blatt laesst die Zeilen dann weg.
$kundenFelder = ', e.kunde_id AS kunde_id, k.kundennummer AS kunde_nr,
        k.name AS k_name, k.strasse AS k_strasse, k.hausnummer AS k_hausnummer,
        k.adresszusatz AS k_adresszusatz, k.plz AS k_plz, k.ort AS k_ort,
        k.re_name, k.re_zusatz, k.re_strasse, k.re_hausnummer, k.re_plz, k.re_ort';
$kundenJoin = ' LEFT JOIN einsaetze e ON e.id = r.einsatz_id
                LEFT JOIN kunden k ON k.id = e.kunde_id';

$basis = 'SELECT r.id, r.datum, r.mitarbeiter_id, r.einsatz_id, m.name AS mitarbeiter, r.kunde, r.strasse, r.ort, r.auftrag_nr,
               r.einsatzart, r.von, r.bis, r.pause_min, r.netto_h, r.unterzeichner, r.bemerkung, r.erfasst_am';

// Die Unterschrift geht NICHT mit der Liste mit, nur ob eine da ist. Sie
// liegt als Bild-Text in rapporte.unterschrift, oft 10-30 KB pro Rapport,
// und die Liste wird bei jedem Start des Cockpits geladen -- ohne Zeitraum.
// Mit jedem erfassten Rapport wurde so jeder Start langsamer, fuer Bilder,
// die man erst beim Oeffnen, Drucken oder Teilen EINES Rapports braucht.
// Die holt die Oberflaeche dann einzeln ueber ?id= (weiter unten).
$hatUnterschrift = ", (r.unterschrift IS NOT NULL AND r.unterschrift <> '') AS hat_unterschrift";
$von = ' FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id';

// Wer die Ist-Zeiten abgleicht, sieht alle Rapporte. Alle anderen sehen
// ausschliesslich die eigenen -- auch die Personalrolle, denn ein Rapport
// ist Arbeitszeit und keine Personalakte (ENT-077).
//
// Die Kundenstammdaten haengen an derselben Grenze: Sie gehen nur an den
// Zugang, der ohnehin alle Rapporte sieht und Kundenberichte druckt. Ein
// einzelner Mitarbeitender braucht die Rechnungsadresse seines Einsatzortes
// nicht -- und was nicht ausgeliefert wird, kann auch nicht abfliessen.
$alle = darf($user, 'abgleich_lesen');

// Ein einzelner Rapport MIT Unterschrift. Dieselbe Grenze wie bei der Liste:
// Wer nicht alle sieht, bekommt nur einen eigenen -- ein fremder Rapport
// antwortet wie ein nicht vorhandener, damit sich fremde Nummern nicht
// abtasten lassen.
if (isset($_GET['id'])) {
    $id = (int)$_GET['id'];
    if ($alle) {
        $stmt = db()->prepare($basis . ', r.unterschrift' . $kundenFelder . $von . $kundenJoin . ' WHERE r.id = ?');
        $stmt->execute([$id]);
    } else {
        $stmt = db()->prepare($basis . ', r.unterschrift' . $von . ' WHERE r.id = ? AND r.mitarbeiter_id = ?');
        $stmt->execute([$id, $user['id']]);
    }
    $row = $stmt->fetch();
    if (!$row) {
        json_response(['status' => 'error', 'message' => 'Rapport nicht gefunden.'], 404);
    }
    json_response(['status' => 'ok', 'rapport' => $row]);
}

if ($alle) {
    $rows = db()->query($basis . $hatUnterschrift . $kundenFelder . $von . $kundenJoin
        . ' ORDER BY r.datum DESC, r.id DESC')->fetchAll();
} else {
    $stmt = db()->prepare($basis . $hatUnterschrift . $von . ' WHERE r.mitarbeiter_id = ? ORDER BY r.datum DESC, r.id DESC');
    $stmt->execute([$user['id']]);
    $rows = $stmt->fetchAll();
}

json_response(['status' => 'ok', 'rapporte' => $rows]);
