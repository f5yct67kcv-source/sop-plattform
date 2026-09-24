<?php
declare(strict_types=1);
// Neuerungen fuer das Update-Fenster im Betreiberbereich (ENT-698).
// Gleiche Bauart wie api/neuerungen_stand.php, aber gegen das Betreiber-Konto.
//
// GET         -- was dieses Konto noch nicht gesehen hat, und zwar JEDE
//                Neuerung, nicht nur die fuer den Betreiberbereich
//                (neuerungen_alle(), Begruendung dort)
// POST {bis}  -- "gelesen bis Nummer n"
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../neuerungen.php';

$ich = require_betreiber_voll();
$pdo = betreiber_db();
$id  = (int)$ich['id'];

$spalteDa = hat_spalte($pdo, 'betreiber', 'neuerungen_gesehen_bis');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!$spalteDa) {
        json_response(['status' => 'error',
            'message' => 'Die Einrichtung ist noch nicht auf dem neusten Stand.'], 400);
    }
    $in  = json_decode((string)file_get_contents('php://input'), true) ?? [];
    $bis = max(0, min((int)($in['bis'] ?? 0), neuerungen_neueste()));
    $pdo->prepare('UPDATE betreiber SET neuerungen_gesehen_bis = GREATEST(COALESCE(neuerungen_gesehen_bis, 0), ?)
                    WHERE id = ?')->execute([$bis, $id]);
    json_response(['status' => 'ok', 'gesehen_bis' => $bis]);
}

$antwort = ['status' => 'ok', 'ziel' => 'betreiber', 'neueste' => neuerungen_neueste()];
if ($spalteDa) {
    $s = $pdo->prepare('SELECT neuerungen_gesehen_bis FROM betreiber WHERE id = ?');
    $s->execute([$id]);
    $gesehen = (int)($s->fetchColumn() ?: 0);   // NULL = noch nichts gelesen, siehe be_spalten()
    $antwort['gesehen_bis'] = $gesehen;
    $antwort['neuerungen']  = neuerungen_alle($gesehen);
} else {
    // Unbekannt ist nicht "nichts Neues": Ohne Spalte zeigt das Fenster die
    // ganze Liste, damit das Update, das die Spalte bringt, nicht
    // verschwiegen wird.
    $antwort['gesehen_bis'] = null;
    $antwort['neuerungen']  = neuerungen_alle(0);
    $antwort['stand_unbekannt'] = true;
}
json_response($antwort);
