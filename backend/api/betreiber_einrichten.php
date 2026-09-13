<?php
// Legt die Tabellen der Betreiber-Ebene an (ENT-524).
//
// Ergaenzt nur Fehlendes, loescht nichts, leert nichts -- gefahrlos
// mehrfach aufrufbar, dasselbe Muster wie planung_einrichten.php.
//
// WER DARF DAS: Die Verwaltung dieses Betriebs (require_verwaltung).
//
// Das ist eine bewusste Wahl gegen die naheliegende Alternative "laeuft
// ohne Anmeldung, solange noch kein Betreiber existiert". Ein Endpunkt,
// der sich selbst freischaltet, solange eine Tabelle leer ist, ist genau
// so lange offen, bis ihn jemand findet -- und wer ihn zuerst findet,
// legt sich als Betreiber der ganzen Anlage an. Der Einstieg laeuft darum
// ueber die Anmeldung, die es heute schon gibt: Der Cockpit-Admin richtet
// die Betreiber-Ebene ein, danach steht sie eigenstaendig und braucht das
// Cockpit nie wieder.
//
// GET ist reiner Pruefmodus (kein exec) -- wie beim Einrichtungsknopf der
// Planung, damit sich der Stand anzeigen laesst, ohne etwas zu aendern.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../betreiber.php';

$user = require_session();
require_verwaltung($user);

$pdo    = betreiber_db();

// Dieselbe Grenze wie beim ersten Konto: Sobald mehr als ein Mandant
// eingetragen ist, läuft die Einrichtung nur noch über ein Betreiber-Konto.
// Sie trägt den aufrufenden Betrieb als Mandant 1 ein -- ein fremder Betrieb
// dürfte das nicht.
if (!be_bootstrap_offen($pdo)) {
    require_betreiber_voll();
}
$nurPruefen = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);
$getan  = [];
$fehler = [];
$offen  = [];

// ── Die Tabellen ──────────────────────────────────────────────────────
// Die Tabellendefinitionen stehen seit ENT-529 im Modul (be_tabellen),
// weil sie von zwei Stellen angelegt werden -- hier und vom
// Einrichtungsknopf des Cockpits. Zwei Kopien liefen irgendwann
// auseinander.
$ergebnis = be_tabellen_anlegen($pdo, $nurPruefen);
$getan  = $ergebnis['getan'];
$offen  = $ergebnis['offen'];
$fehler = $ergebnis['fehler'];

// ── Der Bestandsmandant ───────────────────────────────────────────────
//
// Der Betrieb, der heute läuft, wird Mandant 1 -- ohne dass eine einzige
// Zeile seiner Daten bewegt wird. Genau das war die Überlegung hinter der
// Wahl "je Mandant eine eigene Datenbank": Der Bestand bleibt liegen, wo er
// liegt, und bekommt nur einen Eintrag im Stamm.
if (!$nurPruefen) {
    $name = be_bestandsmandant_eintragen($pdo, db());
    if ($name !== null) { $getan[] = 'Bestandsbetrieb als Mandant 1 eingetragen'; }
} elseif (hat_tabelle($pdo, 'mandant')
       && (int)$pdo->query('SELECT COUNT(*) FROM mandant')->fetchColumn() === 0) {
    $offen[] = 'Bestandsbetrieb als Mandant 1';
}


// ── Stand melden ──────────────────────────────────────────────────────
//
// "Noch kein Konto" ist eine eigene Aussage und nicht dasselbe wie "nicht
// eingerichtet" -- die Tabellen koennen stehen, ohne dass sich jemand
// anmelden kann. Beides wird getrennt gemeldet.
$konten = null;
if (hat_tabelle($pdo, 'betreiber')) {
    $konten = (int)$pdo->query('SELECT COUNT(*) FROM betreiber')->fetchColumn();
}

json_response([
    'status'      => $fehler ? 'error' : 'ok',
    'modus'       => $nurPruefen ? 'pruefung' : 'ausgefuehrt',
    'getan'       => $getan,
    'offen'       => $offen,
    'fehler'      => $fehler,
    'konten'      => $konten,
    'hinweis'     => $konten === 0
        ? 'Tabellen stehen, aber es gibt noch kein Betreiber-Konto. Erstes Konto über betreiber_konto_anlegen.php.'
        : null,
]);
