<?php
// Produkt-Stammdaten fuer Offerten und spaeter Rechnungen (ENT-181).
//
// Aktive und archivierte kommen in einem Zug -- wie bei kunden_list.php
// filtert die Oberflaeche selbst, statt einen zweiten Aufruf zu brauchen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';

$user = require_session();
require_recht($user, 'offerten');

$rows = db()->query(
    'SELECT id, name, beschreibung, einzelpreis_rappen, einheit, mwst_satz_bp,
            sortierung, aktiv
       FROM produkte ORDER BY sortierung, name'
)->fetchAll();

json_response(['status' => 'ok', 'produkte' => $rows]);
