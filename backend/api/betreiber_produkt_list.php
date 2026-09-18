<?php
// Leistungen der Betreiberin: Vorschlagswerte fuer Offertenpositionen
// (ENT-605).
//
// Die Liste steht heute leer da, und das ist kein Mangel: Welche
// Grundgebuehr gilt und ob nach Betriebsgroesse gestaffelt wird, ist nicht
// entschieden (ENT-539 Punkt 7, OP-536). Eine Offerte braucht diese
// Stammdaten auch nicht -- ihre Positionen tragen Text, Menge und Preis
// selbst. Was hier steht, erspart nur das Abtippen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'be_produkte')) {
    json_response(['status' => 'ok', 'eingerichtet' => false, 'produkte' => []]);
}

json_response([
    'status'       => 'ok',
    'eingerichtet' => true,
    'produkte'     => $pdo->query(
        'SELECT id, nummer, name, beschreibung, einzelpreis_rappen, einheit,
                mwst_satz_bp, sortierung, aktiv
           FROM be_produkte ORDER BY sortierung, name'
    )->fetchAll(),
]);
