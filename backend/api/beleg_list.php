<?php
// Belegliste, heute nur Offerten (ENT-181).
//
// Die Liste braucht KEINE Positionen -- sie zeigt je Beleg nur Kopfdaten und
// die bereits gerechnete Gesamtsumme. Bei zweihundert Offerten mit je fuenf
// Positionen waeren das tausend Zeilen, von denen keine einzige auf den
// Bildschirm kaeme. Positionen holt beleg_lesen.php einzeln beim Oeffnen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../belege.php';

$user = require_session();
require_recht($user, 'offerten');

$art = (string)($_GET['art'] ?? 'offerte');
if (!beleg_art_gueltig($art)) {
    json_response(['status' => 'error', 'message' => 'Unbekannte Belegart'], 400);
}

$pdo = db();
// Aktive UND archivierte in einem Zug, wie bei kunden_list.php -- die
// Oberflaeche hat einen Alle/Archiviert-Umschalter und soll dafuer nicht
// zweimal fragen muessen. Vorlagen bleiben draussen: Sie sind kein Beleg,
// den jemand verschickt, sondern ein Muster.
$s = $pdo->prepare(
    'SELECT b.id, b.art, b.nummer, b.kunde_id, b.person_id, b.titel, b.referenz,
            b.datum, b.gueltig_bis, b.status, b.rabatt_bp,
            b.zwischensumme_rappen, b.rabatt_rappen, b.mwst_rappen,
            b.rundung_rappen, b.total_rappen, b.ist_vorlage, b.aktiv,
            b.erstellt_am, b.geaendert_am,
            k.name AS kunde_name, k.kundennummer
       FROM belege b
       LEFT JOIN kunden k ON k.id = b.kunde_id
      WHERE b.art = ? AND b.ist_vorlage = 0
      ORDER BY b.datum DESC, b.id DESC'
);
$s->execute([$art]);

json_response([
    'status'          => 'ok',
    'belege'          => $s->fetchAll(),
    'naechste_nummer' => beleg_naechste_nummer($pdo, $art),
]);
