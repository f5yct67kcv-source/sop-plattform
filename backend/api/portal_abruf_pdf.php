<?php
// Der Kunde meldet, dass er einen Rapport als PDF erstellt hat (ENT-491).
//
// WARUM DAS UEBERHAUPT EIN EIGENER WEG IST: Das PDF entsteht im BROWSER
// (ENT-478, html2pdf). Der Server liefert den Inhalt aus und sieht danach
// nichts mehr. Ohne diese Meldung wuesste er nur, dass der Rapport
// angesehen wurde -- nicht, dass eine Kopie mitgenommen wurde.
//
// WARUM DIE MELDUNG SCHWAECHER WIEGT ALS DER ABRUF: Sie kommt vom Browser.
// Der Server kann sie nicht nachpruefen. Sie steht darum in eigenen
// Spalten (pdf_erstmals_am, pdf_anzahl) und traegt im Cockpit einen
// eigenen Text -- eine schwache Aussage, die wie eine starke aussieht,
// waere schlimmer als gar keine.
//
// WARUM DIESER WEG NICHTS ANLEGEN KANN: kp_abruf_pdf_vermerken() macht
// ausschliesslich ein UPDATE auf eine bestehende Zeile. Ohne vorherigen
// Abruf gibt es keine, und dann passiert nichts. Damit laesst sich hier
// weder ein Nachweis fuer einen nie geholten Rapport erfinden noch
// erfragen, welche Nummern es gibt: Die Antwort ist in beiden Faellen
// dieselbe.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';

$zugang = require_kundensession();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur POST'], 405);
}

$in  = json_decode(file_get_contents('php://input'), true) ?? [];
$art = (string)($in['art'] ?? '');
$id  = (int)($in['id'] ?? 0);

if (!in_array($art, ['rundgang', 'einsatz'], true) || $id <= 0) {
    json_response(['status' => 'error', 'message' => 'art und id erforderlich'], 422);
}

// EINE Antwort fuer alle Faelle -- vermerkt oder nicht. Der Browser hat
// mit dem Unterschied nichts zu tun: Er hat sein PDF, und ob der Vermerk
// eine Zeile gefunden hat, ist keine Auskunft, die ihm zusteht.
kp_abruf_pdf_vermerken(db(), (int)$zugang['id'], $art, $id);
json_response(['status' => 'ok']);
