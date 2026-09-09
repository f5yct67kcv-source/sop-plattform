<?php
// Erzeugt eine realistische Datenmenge fuer den Lasttest:
// ein Jahr Betrieb eines Sicherheitsdienstes mit 50 Kunden.
// Keine echten Namen -- alles durchnummerierte Platzhalter.
// Alle Daten relativ zu heute, kein festes Datum (test_datumsfest).
declare(strict_types=1);
ini_set('memory_limit', '2G');

$name = getenv('LAST_DB_NAME') ?: 'lasttest';
$benutzer = getenv('LAST_DB_USER') ?: 'lasttest';
$passwort = getenv('LAST_DB_PASS') ?: 'lasttest';
$pdo = new PDO("mysql:host=127.0.0.1;dbname={$name};charset=utf8mb4", $benutzer, $passwort, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);
$pdo->exec('SET FOREIGN_KEY_CHECKS=0');
$pdo->exec('SET unique_checks=0');

function log_schritt(string $t): void { echo date('H:i:s') . '  ' . $t . PHP_EOL; }

// ── Groessen ──────────────────────────────────────────────────────────
// Vorgabe ist ein Betrieb mit 50 Kunden und einem Jahr Historie. Ueber die
// Umgebung laesst sich derselbe Lauf groesser oder kleiner fahren -- das ist
// der Weg, um zu messen, WIE die Kosten mit der Betriebsgroesse wachsen,
// statt es zu behaupten (z. B. LAST_KUNDEN=100 LAST_OBJEKTE=260).
function zahl(string $schluessel, $vorgabe) {
    $w = getenv($schluessel);
    return $w === false || $w === '' ? $vorgabe : (is_float($vorgabe) ? (float)$w : (int)$w);
}
define('N_KUNDEN',        zahl('LAST_KUNDEN', 50));
define('N_OBJEKTE',       zahl('LAST_OBJEKTE', 130));
define('N_MITARBEITER',   zahl('LAST_MITARBEITER', 200));   // davon 180 aktiv
define('TAGE_ZURUECK',    zahl('LAST_TAGE_ZURUECK', 365));
define('TAGE_VORAUS',     zahl('LAST_TAGE_VORAUS', 60));
define('EINS_PRO_TAG',    zahl('LAST_EINSAETZE_PRO_TAG', 105));   // Schichten pro Kalendertag
define('KP_PRO_OBJEKT',   zahl('LAST_KONTROLLPUNKTE', 12));       // Kontrollpunkte je Objekt
// GPS-Punkte je Runde. Eine 45-Minuten-Runde bei 1 Punkt / 15 s waeren 180 --
// 120 ist bewusst der zurueckhaltendere Wert.
define('POS_PRO_RUNDGANG', zahl('LAST_POSITIONEN', 120));
define('FOTO_ANTEIL',     zahl('LAST_FOTO_ANTEIL', 0.02));        // Anteil der Scans mit Foto
define('FOTO_BYTES',      zahl('LAST_FOTO_BYTES', 150000));

$heute = new DateTimeImmutable('today');
$start = $heute->modify('-' . TAGE_ZURUECK . ' days');
$ende  = $heute->modify('+' . TAGE_VORAUS . ' days');

mt_srand((int)(getenv('LAST_SAAT') ?: 20260909));

function einfuegen(PDO $pdo, string $sql, array $zeilen, int $spalten, int $block = 500): void {
    if (!$zeilen) { return; }
    $platz = '(' . implode(',', array_fill(0, $spalten, '?')) . ')';
    foreach (array_chunk($zeilen, $block) as $teil) {
        $st = $pdo->prepare($sql . ' VALUES ' . implode(',', array_fill(0, count($teil), $platz)));
        $flach = [];
        foreach ($teil as $z) { foreach ($z as $w) { $flach[] = $w; } }
        $st->execute($flach);
    }
}

// ── Kunden ────────────────────────────────────────────────────────────
log_schritt('Kunden …');
$pdo->beginTransaction();
$zeilen = [];
for ($i = 1; $i <= N_KUNDEN; $i++) {
    $zeilen[] = [sprintf('Kunde %02d AG', $i), 'Musterweg ' . $i, sprintf('Ort %02d', $i % 20),
                 '032 000 00 ' . sprintf('%02d', $i), sprintf('kunde%02d@beispiel.invalid', $i)];
}
einfuegen($pdo, 'INSERT INTO kunden (name,strasse,ort,telefon,email)', $zeilen, 5);
$pdo->commit();

// ── Mitarbeitende ─────────────────────────────────────────────────────
log_schritt('Mitarbeitende …');
$hash = password_hash(getenv('LAST_PASSWORT') ?: 'Lasttest-Kennwort', PASSWORD_DEFAULT);
$pdo->beginTransaction();
$zeilen = [];
// 90 % aktiv, der Rest ausgetreten -- ein Personalstamm besteht nie nur aus
// aktiven Leuten, und die Endpunkte filtern darauf.
$letzterAktive = 1 + (int)round(N_MITARBEITER * 0.9);
for ($i = 2; $i <= N_MITARBEITER + 1; $i++) {
    $aktiv = $i <= $letzterAktive ? 1 : 0;
    $zeilen[] = ['ma' . $i, $hash, 0, $aktiv, sprintf('P%04d', $i),
                 'Vorname' . $i, 'Nachname' . $i, sprintf('ma%03d@beispiel.invalid', $i), 1];
}
einfuegen($pdo, 'INSERT INTO mitarbeiter (name,password_hash,ist_admin,aktiv,personalnummer,vorname,nachname,email,revierdienst_berechtigt)', $zeilen, 9);
$pdo->commit();
$maIds = $pdo->query('SELECT id FROM mitarbeiter WHERE aktiv=1 AND id>1')->fetchAll(PDO::FETCH_COLUMN);
log_schritt('  aktive Mitarbeitende: ' . count($maIds));

// ── Sitzungen fuer alle aktiven Mitarbeitenden (fuer den Lasttest) ────
$pdo->beginTransaction();
$zeilen = [];
foreach ($maIds as $id) { $zeilen[] = ['tok-ma-' . $id, (int)$id]; }
einfuegen($pdo, 'INSERT INTO sessions (token,mitarbeiter_id)', $zeilen, 2);
$pdo->commit();

// ── Objekte + Kontrollpunkte + Rundgangvorlagen ───────────────────────
log_schritt('Objekte, Kontrollpunkte, Vorlagen …');
$pdo->beginTransaction();
$zeilen = [];
for ($i = 1; $i <= N_OBJEKTE; $i++) {
    $kunde = (($i - 1) % N_KUNDEN) + 1;
    $zeilen[] = [$kunde, sprintf('Kunde %02d AG', $kunde), sprintf('Objekt %03d', $i),
                 'Musterstrasse ' . $i, sprintf('Ort %02d', $i % 20), 'SO', 'Revierdienst', 'sicherheit', 1];
}
einfuegen($pdo, 'INSERT INTO objekte (kunde_id,kunde_name,name,strasse,ort,kanton,einsatzart,sparte,aktiv)', $zeilen, 9);

$zeilen = [];
for ($o = 1; $o <= N_OBJEKTE; $o++) {
    for ($k = 1; $k <= KP_PRO_OBJEKT; $k++) {
        $zeilen[] = [$o, 'Kontrollpunkt ' . $k, 'Beschreibung zum Punkt ' . $k, $k,
                     $k % 3 === 0 ? 'geo' : 'qr', 'CHIP-' . $o . '-' . $k,
                     47.2 + $o * 0.001 + $k * 0.0001, 7.5 + $o * 0.001, 20, 1];
    }
}
einfuegen($pdo, 'INSERT INTO kontrollpunkt (objekt_id,bezeichnung,beschreibung,reihenfolge,typ,chip_id,lat,lng,geofence_radius_m,aktiv)', $zeilen, 10);

$zeilen = [];
for ($o = 1; $o <= N_OBJEKTE; $o++) {
    $zeilen[] = [$o, 'Nachtrunde Objekt ' . $o, 'Standardrunde', 'Ansprechperson ' . $o, '032 111 00 00', '22:00:00', '05:00:00', 1];
}
einfuegen($pdo, 'INSERT INTO rundgang_vorlage (objekt_id,name,beschreibung,ansprechpartner_name,ansprechpartner_telefon,fenster_von,fenster_bis,aktiv)', $zeilen, 8);

$zeilen = [];
for ($o = 1; $o <= N_OBJEKTE; $o++) {
    for ($k = 1; $k <= KP_PRO_OBJEKT; $k++) {
        $zeilen[] = [$o, ($o - 1) * KP_PRO_OBJEKT + $k, $k];
    }
}
einfuegen($pdo, 'INSERT INTO rundgang_vorlage_punkt (vorlage_id,kontrollpunkt_id,reihenfolge)', $zeilen, 3);
$pdo->commit();

// ── Kundenzugaenge (Portal) ───────────────────────────────────────────
log_schritt('Kundenzugaenge …');
$pdo->beginTransaction();
$zeilen = [];
for ($i = 1; $i <= N_KUNDEN; $i++) {
    $zeilen[] = [$i, 'Ansprechperson Kunde ' . $i, sprintf('portal%02d@beispiel.invalid', $i), 'Verwaltung', $hash, 1];
}
einfuegen($pdo, 'INSERT INTO kundenzugang (kunde_id,name,email,funktion,password_hash,aktiv)', $zeilen, 6);
$pdo->commit();
$zgIds = $pdo->query('SELECT id FROM kundenzugang')->fetchAll(PDO::FETCH_COLUMN);
$pdo->beginTransaction();
$zeilen = [];
foreach ($zgIds as $z) { $zeilen[] = ['tok-portal-' . $z, (int)$z, date('Y-m-d H:i:s'), date('Y-m-d H:i:s')]; }
einfuegen($pdo, 'INSERT INTO kunden_sessions (token,zugang_id,erstellt_am,letzte_nutzung)', $zeilen, 4);
$pdo->commit();

// ── Einsaetze + Zuteilungen ───────────────────────────────────────────
log_schritt('Einsaetze und Zuteilungen …');
$unterschrift = 'data:image/png;base64,' . str_repeat('iVBORw0KGgoAAAANSUhEUg', 130); // ≈ 3 KB
$tag = $start;
$einsatzId = 0;
$anzZut = 0;
while ($tag <= $ende) {
    $datum = $tag->format('Y-m-d');
    $vergangen = $tag < $heute;
    $pdo->beginTransaction();
    $eins = []; $zut = [];
    for ($n = 0; $n < EINS_PRO_TAG; $n++) {
        $einsatzId++;
        $o = mt_rand(1, N_OBJEKTE);
        $kunde = (($o - 1) % N_KUNDEN) + 1;
        $vonH = [6, 14, 22][$n % 3];
        $bedarf = mt_rand(1, 10) > 8 ? 2 : 1;
        $eins[] = [$einsatzId, $kunde, sprintf('Kunde %02d AG', $kunde), $o,
            sprintf('Objekt %03d', $o), 'Musterstrasse ' . $o, sprintf('Ort %02d', $o % 20), 'SO',
            'Revierdienst', 'sicherheit', $datum,
            sprintf('%02d:00:00', $vonH), sprintf('%02d:00:00', ($vonH + 8) % 24), $bedarf,
            $vergangen ? 'erledigt' : 'geplant',
            $vergangen ? (mt_rand(1, 10) > 3 ? 'abgeglichen' : 'offen') : 'offen',
            $vergangen ? sprintf('%02d:00:00', $vonH) : null,
            $vergangen ? sprintf('%02d:00:00', ($vonH + 8) % 24) : null,
            $vergangen && mt_rand(1, 10) > 6 ? $unterschrift : null,
            $vergangen && mt_rand(1, 10) > 6 ? 'Unterzeichner ' . $o : null];
        $anzMa = $bedarf;
        for ($m = 0; $m < $anzMa; $m++) {
            $ma = $maIds[array_rand($maIds)];
            $zut[$einsatzId . '-' . $ma] = [$einsatzId, (int)$ma,
                $vergangen ? 'zugesagt' : ['offen', 'zugesagt', 'zugesagt'][mt_rand(0, 2)],
                $vergangen ? 'abgeglichen' : 'offen',
                $vergangen ? sprintf('%02d:00:00', $vonH) : null,
                $vergangen ? sprintf('%02d:00:00', ($vonH + 8) % 24) : null];
        }
    }
    einfuegen($pdo, 'INSERT INTO einsaetze (id,kunde_id,kunde_name,objekt_id,titel,strasse,ort,kanton,einsatzart,sparte,datum,von,bis,bedarf,status,ist_status,ist_von,ist_bis,unterschrift,unterzeichner)', $eins, 20, 200);
    $zutW = array_values($zut);
    $anzZut += count($zutW);
    einfuegen($pdo, 'INSERT INTO einsatz_zuteilung (einsatz_id,mitarbeiter_id,zusage,ist_status,ist_von,ist_bis)', $zutW, 6, 400);
    $pdo->commit();
    if ((int)$tag->format('d') === 1) { log_schritt('  … ' . $datum . ' (' . $einsatzId . ' Einsaetze)'); }
    $tag = $tag->modify('+1 day');
}
log_schritt('  Einsaetze: ' . $einsatzId . ', Zuteilungen: ' . $anzZut);

// ── Rapporte ──────────────────────────────────────────────────────────
log_schritt('Rapporte …');
$st = $pdo->query('SELECT e.id, e.datum, e.von, e.bis, e.kunde_name, e.strasse, e.ort, z.mitarbeiter_id
                   FROM einsaetze e JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
                   WHERE e.datum < CURDATE()');
$zeilen = []; $anz = 0;
$pdo->beginTransaction();
while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
    if (mt_rand(1, 10) > 7) { continue; }   // 70 % der Schichten rapportiert
    $zeilen[] = [(int)$r['mitarbeiter_id'], (int)$r['id'], $r['datum'], $r['kunde_name'],
                 $r['strasse'], $r['ort'], 'Revierdienst', $r['von'], $r['bis'], 30, 7.5,
                 'Unterzeichner', $unterschrift, 'Bemerkung zum Einsatz'];
    if (count($zeilen) >= 2000) {
        einfuegen($pdo, 'INSERT INTO rapporte (mitarbeiter_id,einsatz_id,datum,kunde,strasse,ort,einsatzart,von,bis,pause_min,netto_h,unterzeichner,unterschrift,bemerkung)', $zeilen, 14, 200);
        $anz += count($zeilen); $zeilen = [];
    }
}
einfuegen($pdo, 'INSERT INTO rapporte (mitarbeiter_id,einsatz_id,datum,kunde,strasse,ort,einsatzart,von,bis,pause_min,netto_h,unterzeichner,unterschrift,bemerkung)', $zeilen, 14, 200);
$anz += count($zeilen);
$pdo->commit();
log_schritt('  Rapporte: ' . $anz);

// ── Rundgaenge, Scans, GPS-Spur ───────────────────────────────────────
log_schritt('Rundgaenge, Scans und GPS-Spur …');
$foto = random_bytes(FOTO_BYTES);
$st = $pdo->query('SELECT e.id, e.datum, e.objekt_id, e.von, z.mitarbeiter_id
                   FROM einsaetze e JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
                   WHERE e.datum < CURDATE() AND e.datum > DATE_SUB(CURDATE(), INTERVAL 365 DAY)');
$rgId = 0; $anzScan = 0; $anzPos = 0; $anzFoto = 0;
$rgZ = []; $scZ = []; $poZ = [];
$pdo->beginTransaction();
while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
    if (mt_rand(1, 100) > 55) { continue; }   // gut die Haelfte der Schichten mit Runden
    $runden = mt_rand(1, 3);
    for ($x = 0; $x < $runden; $x++) {
        $rgId++;
        $startZeit = $r['datum'] . ' ' . sprintf('%02d:%02d:00', ((int)substr($r['von'], 0, 2) + $x) % 24, mt_rand(0, 59));
        $rgZ[] = [$rgId, (int)$r['id'], (int)$r['mitarbeiter_id'], (int)$r['objekt_id'], (int)$r['objekt_id'],
                  'beendet', $startZeit, $startZeit, 0];
        $basisKp = ((int)$r['objekt_id'] - 1) * KP_PRO_OBJEKT;
        for ($k = 1; $k <= KP_PRO_OBJEKT; $k++) {
            $mitFoto = mt_rand(1, 10000) <= (int)(FOTO_ANTEIL * 10000);
            $scZ[] = [$rgId, $basisKp + $k, 'ok', $startZeit, $startZeit,
                      $mitFoto ? 'Auffaelligkeit dokumentiert' : null,
                      $mitFoto ? $foto : null, $mitFoto ? 'image/jpeg' : null];
            if ($mitFoto) { $anzFoto++; }
        }
        for ($p = 0; $p < POS_PRO_RUNDGANG; $p++) {
            $poZ[] = [$rgId, 47.2 + $p * 0.00005, 7.5 + $p * 0.00005, mt_rand(5, 30), $startZeit];
        }
    }
    if (count($rgZ) >= 400) {
        einfuegen($pdo, 'INSERT INTO rundgang (id,einsatz_id,mitarbeiter_id,objekt_id,rundgang_vorlage_id,status,rohzeit_start,rohzeit_ende,pause_minuten)', $rgZ, 9, 200);
        einfuegen($pdo, 'INSERT INTO rundgang_scan (rundgang_id,kontrollpunkt_id,status,erfasst_am,uebermittelt_am,beschreibung,foto,foto_mime)', $scZ, 8, 20);
        einfuegen($pdo, 'INSERT INTO rundgang_position (rundgang_id,lat,lng,genauigkeit_m,erfasst_am)', $poZ, 5, 800);
        $anzScan += count($scZ); $anzPos += count($poZ);
        $rgZ = []; $scZ = []; $poZ = [];
        $pdo->commit();
        $pdo->beginTransaction();
        if ($rgId % 4000 < 400) { log_schritt('  … ' . $rgId . ' Runden, ' . $anzPos . ' Positionen'); }
    }
}
einfuegen($pdo, 'INSERT INTO rundgang (id,einsatz_id,mitarbeiter_id,objekt_id,rundgang_vorlage_id,status,rohzeit_start,rohzeit_ende,pause_minuten)', $rgZ, 9, 200);
einfuegen($pdo, 'INSERT INTO rundgang_scan (rundgang_id,kontrollpunkt_id,status,erfasst_am,uebermittelt_am,beschreibung,foto,foto_mime)', $scZ, 8, 20);
einfuegen($pdo, 'INSERT INTO rundgang_position (rundgang_id,lat,lng,genauigkeit_m,erfasst_am)', $poZ, 5, 800);
$anzScan += count($scZ); $anzPos += count($poZ);
$pdo->commit();
log_schritt('  Runden: ' . $rgId . ', Scans: ' . $anzScan . ' (davon ' . $anzFoto . ' mit Foto), Positionen: ' . $anzPos);

// ── Mitteilungen ──────────────────────────────────────────────────────
log_schritt('Mitteilungen …');
$pdo->beginTransaction();
$zeilen = [];
for ($i = 1; $i <= 400; $i++) {
    $zeilen[] = ['Mitteilung ' . $i, str_repeat('Text der Mitteilung. ', 20), 'alle', 'info', 'info',
                 1, 'Verwaltung', $heute->modify('-' . mt_rand(0, 300) . ' days')->format('Y-m-d H:i:s')];
}
einfuegen($pdo, 'INSERT INTO mitteilungen (titel,text,zielgruppe,stufe,art,verfasser_id,verfasser_name,erstellt_am)', $zeilen, 8);
$pdo->commit();

// ── Je aktivem Mitarbeitenden eine LAUFENDE Runde ─────────────────────
// Ohne sie weist mein_rundgang_position.php jeden Punkt mit 409 ab, und der
// Lasttest misst die Abweisung statt des Speicherwegs. Die Zuordnung
// Mitarbeitende -> Runde landet in runden.json, damit der Lastgenerator
// weiss, welche Runde zu welchem Token gehoert.
log_schritt('Laufende Runden fuer den Lastlauf …');
$karte = [];
$pdo->beginTransaction();
$sucheEinsatz = $pdo->prepare(
    'SELECT e.id, e.objekt_id FROM einsaetze e
      JOIN einsatz_zuteilung z ON z.einsatz_id = e.id
     WHERE z.mitarbeiter_id = ? AND e.datum = CURDATE() LIMIT 1'
);
$neuerEinsatz = $pdo->prepare(
    'INSERT INTO einsaetze (kunde_id,kunde_name,objekt_id,ort,einsatzart,datum,von,bis,bedarf,status)
     VALUES (?,?,?,?,\'Revierdienst\',CURDATE(),\'22:00:00\',\'06:00:00\',1,\'geplant\')'
);
$neueZuteilung = $pdo->prepare('INSERT INTO einsatz_zuteilung (einsatz_id,mitarbeiter_id,zusage) VALUES (?,?,\'zugesagt\')');
$neueRunde = $pdo->prepare(
    'INSERT INTO rundgang (einsatz_id,mitarbeiter_id,objekt_id,rundgang_vorlage_id,status,rohzeit_start)
     VALUES (?,?,?,?,\'laeuft\',NOW())'
);
$i = 0;
foreach ($maIds as $ma) {
    $sucheEinsatz->execute([(int)$ma]);
    $r = $sucheEinsatz->fetch(PDO::FETCH_ASSOC);
    if (!$r) {
        $o = ($i % N_OBJEKTE) + 1;
        $neuerEinsatz->execute([(($o - 1) % N_KUNDEN) + 1, sprintf('Kunde %02d AG', (($o - 1) % N_KUNDEN) + 1),
                                $o, sprintf('Ort %02d', $o % 20)]);
        $eid = (int)$pdo->lastInsertId();
        $neueZuteilung->execute([$eid, (int)$ma]);
        $r = ['id' => $eid, 'objekt_id' => $o];
    }
    $neueRunde->execute([(int)$r['id'], (int)$ma, (int)$r['objekt_id'], (int)$r['objekt_id']]);
    $karte[(int)$ma] = (int)$pdo->lastInsertId();
    $i++;
}
$pdo->commit();
file_put_contents(__DIR__ . '/runden.json', json_encode($karte));
log_schritt('  laufende Runden: ' . count($karte));

$pdo->exec('SET FOREIGN_KEY_CHECKS=1');
$pdo->exec('SET unique_checks=1');
log_schritt('FERTIG');
