<?php
// EINEN Rapport samt Unterschriftsbild (Lasttest 09.09.2026).
//
// Warum es diesen Endpunkt gibt: rapport_list.php liefert das
// Unterschriftsbild nicht mehr mit. Es ist im Mittel 2,8 kB Base64 je
// Rapport und wurde in der Uebersicht nur als Ja/Nein gebraucht -- ueber
// einen Jahrgang hinweg waren das 88 der 108 MB, an denen der Endpunkt
// erstickt ist. Gebraucht wird das Bild an genau drei Stellen: Schublade,
// Ausdruck und PDF. Alle drei betreffen EINEN Rapport, und den holt man
// dann eben einzeln.
//
// Dieselbe Rechtegrenze wie in der Liste: Wer die Ist-Zeiten abgleicht,
// sieht jeden Rapport; alle anderen ausschliesslich die eigenen. Die
// Kundenstammdaten fuer das Blatt (ENT-155) haengen an derselben Grenze --
// eine Rechnungsadresse geht einen einzelnen Mitarbeitenden nichts an.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) {
    json_response(['status' => 'error', 'message' => 'id erforderlich'], 422);
}

$alle = darf($user, 'abgleich_lesen');

$kundenFelder = ', e.kunde_id AS kunde_id, k.kundennummer AS kunde_nr,
        k.name AS k_name, k.strasse AS k_strasse, k.hausnummer AS k_hausnummer,
        k.adresszusatz AS k_adresszusatz, k.plz AS k_plz, k.ort AS k_ort,
        k.re_name, k.re_zusatz, k.re_strasse, k.re_hausnummer, k.re_plz, k.re_ort';
$kundenJoin = ' LEFT JOIN einsaetze e ON e.id = r.einsatz_id
                LEFT JOIN kunden k ON k.id = e.kunde_id';

$sql = 'SELECT r.id, r.datum, r.mitarbeiter_id, r.einsatz_id, m.name AS mitarbeiter,
               r.kunde, r.strasse, r.ort, r.auftrag_nr, r.einsatzart, r.von, r.bis,
               r.pause_min, r.netto_h, r.unterzeichner, r.unterschrift, r.bemerkung,
               r.erfasst_am'
     . ($alle ? $kundenFelder : '')
     . ' FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id'
     . ($alle ? $kundenJoin : '')
     . ' WHERE r.id = ?';
$werte = [$id];
if (!$alle) {
    $sql .= ' AND r.mitarbeiter_id = ?';
    $werte[] = (int)$user['id'];
}

$stmt = db()->prepare($sql);
$stmt->execute($werte);
$rapport = $stmt->fetch();

// Ein fremder Rapport und ein geloeschter geben dieselbe Antwort. Wer nicht
// hinsehen darf, soll auch nicht erfahren, ob es die Nummer gibt.
if (!$rapport) {
    json_response(['status' => 'error', 'message' => 'Diesen Rapport gibt es für dich nicht.'], 404);
}

// Die Liste liefert hat_unterschrift; hier soll dasselbe Feld danebenstehen,
// damit die Oberflaeche nicht zwei verschiedene Formen kennen muss.
$rapport['hat_unterschrift'] = $rapport['unterschrift'] !== null;

json_response(['status' => 'ok', 'rapport' => $rapport]);
