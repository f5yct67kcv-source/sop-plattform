<?php
declare(strict_types=1);
// Echte Ausfuehrung der Login-Namen-Bildung (ENT-376) gegen eine wirkliche
// Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster wie
// pruef_dienstfahrzeug.php und pruef_rechte.php.
//
// WARUM HIER UND NICHT NUR IN EINER BROWSER-SUITE: Die Playwright-Suiten
// taeuschen die Serverantwort vor. Ob zwei Mitarbeitende mit gleichem Namen
// wirklich zwei verschiedene, eindeutige Login-Namen bekommen, haengt an
// einer echten Abfrage gegen den Bestand -- das wird ausgefuehrt, nicht
// nachgebaut.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/mitarbeiter.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT)');

// ── Grundform: klein, ohne Leerzeichen ────────────────────────────────────
pruef('Vorname.Nachname wird klein geschrieben',
    ma_login_generieren('Hans', 'Muster', $pdo) === 'hans.muster');

// ── Das Beispiel des Projektinhabers: ein Leerzeichen IM Nachnamen ────────
pruef('KRITISCH: "Adrian von Arb" wird zu "adrian.vonarb" -- das Leerzeichen im Nachnamen faellt weg',
    ma_login_generieren('Adrian', 'von Arb', $pdo) === 'adrian.vonarb');

// ── Ohne Vor- oder Nachname gibt es keinen Login-Namen ────────────────────
pruef('KRITISCH: ohne Vorname kein Login-Name', ma_login_generieren('', 'Muster', $pdo) === '');
pruef('KRITISCH: ohne Nachname kein Login-Name', ma_login_generieren('Hans', '', $pdo) === '');
pruef('Fuehrende und folgende Leerzeichen stoeren nicht',
    ma_login_generieren('  Hans ', ' Muster  ', $pdo) === 'hans.muster');

// ── Namensgleichheit: eine laufende Nummer, kein Scheitern ────────────────
$pdo->exec("INSERT INTO mitarbeiter (name) VALUES ('max.muster')");
pruef('KRITISCH: bei Namensgleichheit haengt eine laufende Nummer an, statt abzulehnen',
    ma_login_generieren('Max', 'Muster', $pdo) === 'max.muster2');

$pdo->exec("INSERT INTO mitarbeiter (name) VALUES ('max.muster2')");
pruef('KRITISCH: eine dritte Namensgleichheit zaehlt weiter',
    ma_login_generieren('Max', 'Muster', $pdo) === 'max.muster3');

// Gegenprobe: taeucht "max.muster3" ebenfalls schon auf, geht es weiter --
// die Nummer ist keine feste Berechnung, sondern sucht wirklich die naechste
// freie.
$pdo->exec("INSERT INTO mitarbeiter (name) VALUES ('max.muster3')");
pruef('Die Suche nach der naechsten freien Nummer laeuft tatsaechlich weiter',
    ma_login_generieren('Max', 'Muster', $pdo) === 'max.muster4');

// ── Ein anderer Name bleibt von der Kollision unberuehrt ──────────────────
pruef('Ein unverwandter Name kollidiert nicht mit',
    ma_login_generieren('Erika', 'Muster', $pdo) === 'erika.muster');

// ── Von Hand eingetragene Korrektur: dasselbe Muster (ENT-393) ───────────
// Was ma_login_generieren() SELBST erzeugen wuerde, muss ma_login_name_gueltig()
// auch fuer eine von Hand eingetragene Korrektur akzeptieren -- sonst
// wiedersprechen sich Erzeugung und Pruefung.
pruef('KRITISCH: eine automatisch gebildete Form gilt auch als gueltige Korrektur',
    ma_login_name_gueltig(ma_login_generieren('Adrian', 'von Arb', $pdo)));
pruef('KRITISCH: Gross-/Kleinschreibung wird abgelehnt', !ma_login_name_gueltig('Max.Muster'));
pruef('KRITISCH: ein Leerzeichen wird abgelehnt', !ma_login_name_gueltig('max muster'));
pruef('KRITISCH: ohne Punkt (kein vorname.nachname) wird abgelehnt', !ma_login_name_gueltig('maxmuster'));
pruef('Leer wird abgelehnt', !ma_login_name_gueltig(''));
pruef('Eine laufende Nummer am Ende bleibt gueltig', ma_login_name_gueltig('max.muster2'));

echo "$ok Pruefungen bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit($bad ? 1 : 0);
