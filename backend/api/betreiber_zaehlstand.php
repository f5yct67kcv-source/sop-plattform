<?php
// Wie gross ist ein Mandant, und wie gross war er? (ENT-539)
//
// GET  -- die heutigen Zahlen aller Mandanten, live aus deren Datenbanken,
//         dazu die festgehaltenen Staende der letzten Monate.
// POST -- den Stand des laufenden Monats festhalten, hoechstens einmal je
//         Mandant und Monat.
//
// WARUM SCHREIBEN NUR AUF POST: Ein GET, der nebenbei schreibt, ist von
// aussen nicht als Schreibweg erkennbar -- weder fuer einen Menschen noch
// fuer die Rechtepruefung. Die Trennung ist dieselbe wie bei
// planung_einrichten.php.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();

$pdo = betreiber_db();
if (!hat_tabelle($pdo, 'mandant')) {
    json_response(['status' => 'error',
        'message' => 'Der Mandantenstamm ist noch nicht eingerichtet.'], 503);
}
// Die Tabelle kann fehlen, wenn die Einrichtung vor ENT-539 gelaufen ist.
// "Noch nicht eingerichtet" ist etwas anderes als "keine Staende vorhanden"
// und bekommt einen eigenen Text (Hausregel).
$tabelleDa = hat_tabelle($pdo, 'mandant_zaehlstand');

$mandanten = $pdo->query(
    'SELECT id, name, status, db_host, db_name, db_user, secret_name FROM mandant ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC);

$schreiben = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$festgehalten = 0;
if ($schreiben && $tabelleDa) {
    foreach ($mandanten as $m) {
        // KEIN ZAEHLSTAND FUER DEN VORRAT (ENT-686). Ein festgehaltener Stand
        // ist die Grundlage der Abrechnung; fuer eine Anlage, die noch keinem
        // Kunden gehoert, waere er ein Abrechnungsvermerk ohne Kunden. Die
        // Tagesanzeige darunter nimmt sie weiterhin mit -- "nie benutzt"
        // stimmt fuer sie, und die Mandantentabelle zeigt sie.
        if (mandant_ist_vorrat($m)) { continue; }
        $r = zaehlstand_festhalten($pdo, (int)$m['id'], mandant_groesse($m));
        if ($r && !empty($r['neu'])) { $festgehalten++; }
    }
}

// Die heutigen Zahlen -- getrennt von den festgehaltenen. Ein Mandant, der
// gerade nicht erreichbar ist, liefert null und heisst dann "nicht
// feststellbar", nicht "null Mitarbeitende".
$heute = [];
foreach ($mandanten as $m) {
    $g = mandant_groesse($m);
    $heute[] = [
        'id'    => (int)$m['id'],
        'name'  => $m['name'],
        'zahlen' => $g,   // null = nicht feststellbar
        // Wie lange in dieser Anlage nichts geschah (ENT-619). Drei
        // Antworten, drei Bedeutungen: eine Zahl in Tagen, 'nie' fuer eine
        // erreichbare, aber noch nie benutzte Anlage, und null fuer "nicht
        // feststellbar". Gerechnet im Server, damit Liste und Kennzahl
        // dieselbe Auskunft bekommen.
        'stille' => mandant_stille($g),
    ];
}

$verlauf = [];
if ($tabelleDa) {
    $verlauf = $pdo->query(
        'SELECT mandant_id, monat, stichtag, ma_gesamt, ma_aktiv, ma_im_einsatz
           FROM mandant_zaehlstand ORDER BY monat DESC, mandant_id LIMIT 200'
    )->fetchAll(PDO::FETCH_ASSOC);
}

json_response([
    'status'        => 'ok',
    'eingerichtet'  => $tabelleDa,
    'monat'         => date('Y-m'),
    'heute'         => $heute,
    'verlauf'       => $verlauf,
    'festgehalten'  => $schreiben ? $festgehalten : null,
]);
