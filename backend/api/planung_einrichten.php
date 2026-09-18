<?php
// Legt die Tabellen der Einsatzplanung an (ENT-020, ENT-021).
//
// Ersetzt das Kopieren von schema_planung.sql in phpMyAdmin. Der Lauf
// prueft selbst, was bereits vorhanden ist, und ergaenzt nur das Fehlende --
// er laesst sich also gefahrlos mehrfach aufrufen und deckt beide Faelle ab:
// vollstaendige Neuanlage und Nachtrag zur ersten Fassung.
//
// Er legt ausschliesslich an. Es wird nichts geloescht und nichts geleert.
//
// GET ist ein reiner Pruefmodus (kein exec) -- das Dashboard nutzt ihn, um
// den bestehenden Einrichten-Knopf farblich hervorzuheben, wenn seit dem
// letzten Aufruf neue Tabellen/Spalten hinzugekommen sind (ENT-033). Es
// entsteht dadurch kein zweiter Mechanismus: dieselbe Liste, derselbe Knopf.
//
// NUR NOCH DIE ANMELDE-HUELLE (seit ENT-612): Die eigentliche Einrichtung
// steht in planung_einrichten_kern.php, weil sie seither ZWEI Aufrufer hat
// -- diesen Endpunkt (ein Mandant richtet sich selbst ein, ueber die
// eigene Sitzung) und api/betreiber_schema_pruefen.php (der Betreiber
// richtet zentral mehrere Mandanten-Datenbanken ein, ueber die
// Betreiber-Sitzung). "Eine Definition, nicht zwei" -- derselbe Rechenkern,
// nur mit unterschiedlicher Verbindung aufgerufen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung_einrichten_kern.php';

$user = require_session();
require_recht($user, 'betrieb_schreiben');
$methode = $_SERVER['REQUEST_METHOD'];
if ($methode !== 'GET' && $methode !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

json_response(planung_einrichten_ausfuehren(db(), $methode === 'GET'));
