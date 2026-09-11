<?php
// Stand des zweiten Faktors am eigenen Konto (OP-517).
//
// require_betreiber() und NICHT require_betreiber_voll(): Wer den Faktor
// noch einrichten muss, muss zuerst erfahren duerfen, dass er ihn einrichten
// muss. Ein Statusendpunkt hinter der Vollwache waere ein Schloss, dessen
// Schluessel dahinter liegt.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

$ich = require_betreiber();
$pdo = betreiber_db();

$an = be_zf_ist_an($pdo, (int)$ich['id']);
json_response([
    'status'          => 'ok',
    'eingerichtet'    => $an,
    // Nicht eingerichtet und keine Tabelle sind verschiedene Aussagen --
    // die Oberflaeche darf sie nicht als dasselbe anzeigen (Hausregel).
    'tabelle_da'      => be_zf_tabelle_da($pdo),
    'notfallcodes'    => $an ? be_zf_notfallcodes_offen($pdo, (int)$ich['id']) : null,
    'pflicht'         => true,
]);
