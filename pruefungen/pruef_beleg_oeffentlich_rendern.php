<?php
// Rendert beleg_oeffentlich.php WIRKLICH, gegen eine In-Memory-SQLite-
// Datenbank -- ohne die echte db.php zu benoetigen oder zu veraendern
// (ENT-206). Bis dahin hatte diese Datei ueberhaupt keine funktionale
// Pruefung: alle anderen Suiten taeuschen die Serverantwort nur vor. Eine
// oeffentliche Kundenseite, die nie wirklich lief, waere in genau dem
// PHP-Fehler haengengeblieben, der Kunden anstelle ihrer Rechnung angezeigt
// haette -- ohne dass eine Suite es gemerkt haette.
//
// Aufruf: php pruef_beleg_oeffentlich_rendern.php <variante>
//   rechnung_offen        Rechnung, kein QR-Zahlteil (keine QR-IBAN hinterlegt)
//   rechnung_qr           Rechnung MIT gueltiger QR-IBAN -> QR-Zahlteil sichtbar
//   offerte_offen         Offerte, noch keine Entscheidung -> Annehmen/Ablehnen
//   offerte_entschieden   Offerte, bereits angenommen
//   offerte_unterschrift  Offerte MIT angehaktem of_unterschriftsseite (ENT-207)
//
// Gibt das fertige HTML auf stdout aus; test_beleg_oeffentlich.mjs liest es
// ueber einen lokalen HTTP-Server in einen echten Browser ein.
declare(strict_types=1);

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec("CREATE TABLE betrieb (id INTEGER PRIMARY KEY, firma TEXT, fusszeile TEXT, fusszeile2 TEXT, logo_mime TEXT, logo BLOB, qr_iban TEXT, qr_strasse TEXT, qr_hausnummer TEXT, qr_plz TEXT, qr_ort TEXT)");
$pdo->exec("CREATE TABLE belege (id INTEGER PRIMARY KEY, versand_token TEXT, art TEXT, nummer TEXT, kunde_id INTEGER, person_id INTEGER, titel TEXT, referenz TEXT, datum TEXT, gueltig_bis TEXT, faellig_bis TEXT, rabatt_bp INTEGER, status TEXT, bezahlt INTEGER, bezahlt_am TEXT, entscheidung_am TEXT, oeffentliche_notizen TEXT, bedingungen TEXT, fusszeile_text TEXT, unterschriftsseite INTEGER)");
$pdo->exec("CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT, zusatzfeld TEXT, strasse TEXT, hausnummer TEXT, adresszusatz TEXT, plz TEXT, ort TEXT)");
$pdo->exec("CREATE TABLE kunden_person (id INTEGER PRIMARY KEY, anrede TEXT, vorname TEXT, nachname TEXT)");
$pdo->exec("CREATE TABLE beleg_positionen (id INTEGER PRIMARY KEY, beleg_id INTEGER, sortierung INTEGER, produkt_id INTEGER, produkt_name TEXT, beschreibung TEXT, menge REAL, einheit TEXT, einzelpreis_rappen INTEGER, rabatt_bp INTEGER, mwst_satz_bp INTEGER)");

$argVariante = $argv[1] ?? 'rechnung_offen';

// 1x1-PNG, kleinstes gueltige Bild -- reicht, um zu pruefen, dass ein Logo
// ueberhaupt eingebettet wird (dieselbe Quelle wie test_briefkopf.mjs).
$png1x1 = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
$fusszeile = "Musterweg 1\n4600 Olten\n062 000 00 00";
$fusszeile2 = "info@cupi24.ch\nwww.cupi24.ch\nCHE-255.301.179 MWST";
$hatQr = $argVariante === 'rechnung_qr';
$stmt = $pdo->prepare('INSERT INTO betrieb VALUES (1,?,?,?,?,?,?,?,?,?,?)');
$stmt->bindValue(1, 'Cupi 24 GmbH');
$stmt->bindValue(2, $fusszeile);
$stmt->bindValue(3, $fusszeile2);
$stmt->bindValue(4, 'image/png');
$stmt->bindValue(5, $png1x1, PDO::PARAM_LOB);
$stmt->bindValue(6, $hatQr ? 'CH44 3199 9123 0008 8901 2' : null);
$stmt->bindValue(7, $hatQr ? 'Baslerstrasse' : null);
$stmt->bindValue(8, $hatQr ? '67' : null);
$stmt->bindValue(9, $hatQr ? '4632' : null);
$stmt->bindValue(10, $hatQr ? 'Trimbach' : null);
$stmt->execute();
$art = str_starts_with($argVariante, 'offerte') ? 'offerte' : 'rechnung';
$status = $argVariante === 'offerte_entschieden' ? 'bestaetigt' : 'versendet';
$entscheidung = $argVariante === 'offerte_entschieden' ? date('Y-m-d H:i:s') : null;
$unterschriftsseite = $argVariante === 'offerte_unterschrift' ? 1 : 0;
$pdo->exec("INSERT INTO belege VALUES (1,'tok123','$art','" . ($art === 'offerte' ? 'OF-0127' : 'RE-0002')
    . "',1,1,'Ladenüberwachung RE-0002',NULL,'2026-08-28',"
    . ($art === 'offerte' ? "'2026-09-27'" : 'NULL') . ","
    . ($art === 'rechnung' ? "'2026-09-27'" : 'NULL')
    . ",0,'$status',0,NULL," . ($entscheidung ? "'$entscheidung'" : 'NULL') . ",NULL,NULL,NULL,$unterschriftsseite)");
$pdo->exec("INSERT INTO kunden VALUES (1,'abc consulting gmbh',NULL,'Hochgasse','7',NULL,'4632','Trimbach')");
$pdo->exec("INSERT INTO kunden_person VALUES (1,'Herr','Adrian','Muster')");
$pdo->exec("INSERT INTO beleg_positionen VALUES (1,1,1,NULL,'Filiale Oerlikon','',40,'Std.',4500,0,810)");

function db(): PDO { global $pdo; return $pdo; }
function json_response($data, int $status = 200): void { http_response_code($status); echo json_encode($data); exit; }

require __DIR__ . '/../backend/belege.php';
require __DIR__ . '/../backend/qrrechnung.php';

// Die eigentliche Datei einlesen und ihre eigenen require-Zeilen entfernen
// (db.php/belege.php/qrrechnung.php sind oben schon geladen) -- der Rest
// laeuft unveraendert per eval(), damit genau der echte Code entsteht, der
// auch produktiv laeuft.
$quelle = file_get_contents(__DIR__ . '/../backend/api/beleg_oeffentlich.php');
$quelle = preg_replace('/^<\?php\s*/', '', $quelle, 1);
$quelle = preg_replace('/^declare\(strict_types=1\);\s*$/m', '', $quelle);
$quelle = preg_replace('/^require __DIR__ \. .*$/m', '', $quelle);

$_GET['token'] = 'tok123';
$_SERVER['HTTP_HOST'] = 'lokal.test';
eval($quelle);
