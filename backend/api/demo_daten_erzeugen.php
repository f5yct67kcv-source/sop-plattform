<?php
declare(strict_types=1);
// Verdrahtung fuer den Musterbetrieb-Aufbau (ENT-523). Der Rechenkern
// steht in backend/demo_daten.php -- getrennt, damit er sich echt gegen
// eine Datenbank pruefen laesst, ohne require_session() und
// require_demo_umgebung() im Weg zu haben (gleiches Prinzip wie
// rundgang.php/api/rundgang_*.php). Diese Datei tut nur noch: die Wache
// pruefen, die Rechte pruefen, aufrufen.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../demo_daten.php';

// Wache VOR jeder anderen Pruefung (siehe require_demo_umgebung() in
// db.php): In Produktion und Staging existiert dieser Endpunkt aus Sicht
// eines Aufrufers nicht -- ein 403 vor dieser Wache wuerde schon
// verraten, dass der Pfad in Produktion etwas Bekanntes ist.
require_demo_umgebung();

$user = require_session();
require_recht($user, 'betrieb_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

demo_daten_erzeugen_ausfuehren(db());
