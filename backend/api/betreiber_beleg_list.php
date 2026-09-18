<?php
// Belegliste der Betreiberin, heute nur Offerten (ENT-605).
//
// Wie beleg_list.php im Cockpit: KEINE Positionen. Die Liste zeigt je Beleg
// nur Kopfdaten und die bereits gerechnete Gesamtsumme; Positionen holt
// betreiber_beleg_lesen.php einzeln beim Oeffnen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();

$art = (string)($_GET['art'] ?? 'offerte');
if (!beleg_art_gueltig($art)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Belegart'], 400);
}

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_belege')) {
    // Nicht eingerichtet ist etwas anderes als "keine Offerten" -- zwei
    // Aussagen, zwei Texte (CLAUDE.md).
    json_response(['status' => 'ok', 'eingerichtet' => false, 'belege' => []]);
}

$s = $pdo->prepare(
    'SELECT b.id, b.art, b.nummer, b.kunde_id, b.person_id, b.titel, b.referenz,
            b.datum, b.gueltig_bis, b.faellig_bis, b.bezahlt, b.bezahlt_am, b.status,
            b.rabatt_bp, b.zwischensumme_rappen, b.rabatt_rappen, b.mwst_rappen,
            b.rundung_rappen, b.total_rappen, b.ist_vorlage, b.aktiv,
            b.erstellt_am, b.geaendert_am,
            k.name AS kunde_name, k.kundennummer
       FROM be_belege b
       LEFT JOIN be_kunden k ON k.id = b.kunde_id
      WHERE b.art = ? AND b.ist_vorlage = 0
      ORDER BY b.datum DESC, b.id DESC'
);
$s->execute([$art]);

json_response([
    'status'          => 'ok',
    'eingerichtet'    => true,
    'belege'          => $s->fetchAll(),
    'naechste_nummer' => beleg_naechste_nummer($pdo, $art, 'be_'),
]);
