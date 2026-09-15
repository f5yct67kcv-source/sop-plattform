<?php
declare(strict_types=1);
// Aufbewahrungsfrist fuer Fotobelege/Ersatzscans (ENT-584), WIRKLICH
// ausgefuehrt -- gegen eine echte Datenbank (SQLite im Arbeitsspeicher),
// gleiches Muster wie pruef_ereignis_foto_frist.php (ENT-545), dem dieser
// Fotobeleg bisher als einzige Ausnahme ohne jede Frist gegenueberstand.
//
// Dieselben vier Aussagen, diesmal fuer rundgang_scan statt ereignis_meldung:
//   1. Das alte Foto ist weg.
//   2. Der SCAN bleibt da. Er ist der Nachweis, dass der Kontrollpunkt per
//      Ersatzscan bestaetigt wurde; nur das Bild hat eine Frist.
//   3. Es bleibt festgehalten, DASS es ein Foto gab.
//   4. Ein junges Foto bleibt unberuehrt.
$GLOBALS['tabellen'] = ['rundgang_scan' => true];
$GLOBALS['spalten'] = ['rundgang_scan.foto_geloescht_am' => true];
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    return $GLOBALS['tabellen'][$t] ?? false;
}
function hat_spalte(PDO $pdo, string $t, string $s): bool {
    return $GLOBALS['spalten'][$t . '.' . $s] ?? false;
}

require __DIR__ . '/../backend/rundgang.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE rundgang_scan (id INTEGER PRIMARY KEY, rundgang_id INT,
            kontrollpunkt_id INT, status TEXT, erfasst_am TEXT, beschreibung TEXT,
            foto BLOB, foto_mime TEXT, foto_geloescht_am TEXT)');

// Relative Zeitpunkte, kein festes Datum nahe beim heutigen Tag (CLAUDE.md).
$tage = static fn(int $n): string => date('Y-m-d H:i:s', strtotime("-$n days"));

$alt   = $tage(RUNDGANG_SCAN_FOTO_TAGE + 10);   // deutlich ueber der Frist
$knapp = $tage(RUNDGANG_SCAN_FOTO_TAGE - 1);    // einen Tag DAVOR -- muss bleiben
$neu   = $tage(1);

$ein = $pdo->prepare('INSERT INTO rundgang_scan
    (id, rundgang_id, kontrollpunkt_id, status, erfasst_am, beschreibung, foto, foto_mime, foto_geloescht_am)
    VALUES (?, 1, 2, ?, ?, ?, ?, ?, NULL)');
$ein->execute([1, 'ersatzscan', $alt,   'Alter Ersatzscan',   'BILDDATEN', 'image/jpeg']);
$ein->execute([2, 'ersatzscan', $knapp, 'Knapp innerhalb der Frist', 'BILDDATEN', 'image/jpeg']);
$ein->execute([3, 'ersatzscan', $neu,   'Junger Ersatzscan',  'BILDDATEN', 'image/jpeg']);
// Ein alter Scan OHNE Foto (regulaerer Scan) -- er darf hinterher nicht
// aussehen wie ein Ersatzscan, dessen Foto geloescht wurde.
$ein->execute([4, 'bestaetigt', $alt,   'Regulaerer Scan, kein Foto', null, null]);

rundgang_scan_fotos_aufraeumen($pdo);

$holen = static function (PDO $pdo, int $id): array {
    $s = $pdo->prepare('SELECT * FROM rundgang_scan WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch() ?: [];
};
$a = $holen($pdo, 1); $b = $holen($pdo, 2); $c = $holen($pdo, 3); $d = $holen($pdo, 4);

pruef('KRITISCH: das abgelaufene Foto ist wirklich weg',
    $a && $a['foto'] === null && $a['foto_mime'] === null);
pruef('KRITISCH: der SCAN bleibt -- nur das Bild hat eine Frist, nicht der Nachweis',
    $a && (int)$a['id'] === 1 && $a['beschreibung'] === 'Alter Ersatzscan'
    && $a['erfasst_am'] === $alt);
pruef('KRITISCH: es bleibt festgehalten, DASS es ein Foto gab',
    $a && $a['foto_geloescht_am'] !== null);
pruef('KRITISCH: ein regulaerer Scan OHNE Foto bekommt keinen Loeschvermerk -- '
    . '"geloescht" und "gab es nie" sind verschiedene Aussagen',
    $d && $d['foto_geloescht_am'] === null && $d['foto'] === null);
pruef('KRITISCH: ein Foto einen Tag VOR der Frist bleibt unberuehrt',
    $b && $b['foto'] !== null && $b['foto_mime'] === 'image/jpeg'
    && $b['foto_geloescht_am'] === null);
pruef('KRITISCH: ein junges Foto bleibt unberuehrt',
    $c && $c['foto'] !== null && $c['foto_geloescht_am'] === null);

// Die Frist ist eine eigene Entscheidung (ENT-584), keine Zufaelligkeit --
// auch wenn die Zahl mit den beiden anderen Fristen uebereinstimmt.
pruef('Die Frist betraegt 90 Tage, wie Ereignisfotos und die Bewegungsspur',
    RUNDGANG_SCAN_FOTO_TAGE === 90 && EREIGNIS_FOTO_TAGE === 90 && RUNDGANG_SPUR_TAGE === 90);

// Zweimal aufraeumen darf nichts kaputtmachen.
$vorher = $holen($pdo, 1)['foto_geloescht_am'];
rundgang_scan_fotos_aufraeumen($pdo);
pruef('Ein zweiter Lauf aendert nichts mehr',
    $holen($pdo, 1)['foto_geloescht_am'] === $vorher
    && $holen($pdo, 3)['foto'] !== null);

// Fehlt die Spalte noch (Einrichtung nicht gelaufen), wird NICHT geloescht.
$GLOBALS['spalten'] = [];
$pdo->exec("UPDATE rundgang_scan SET foto = 'BILDDATEN', foto_mime = 'image/jpeg',
            foto_geloescht_am = NULL WHERE id = 1");
rundgang_scan_fotos_aufraeumen($pdo);
pruef('KRITISCH: ohne die Vermerk-Spalte wird gar nicht geloescht -- '
    . 'ein Foto spurlos zu entfernen waere schlimmer als es zu behalten',
    $holen($pdo, 1)['foto'] !== null);
$GLOBALS['spalten'] = ['rundgang_scan.foto_geloescht_am' => true];

// Und wenn die Abfrage selbst scheitert? Das Aufraeumen ist Beiwerk seines
// Aufrufers -- es darf ihn nie mitreissen.
$pdo->exec('DROP TABLE rundgang_scan');
$geworfen = false;
try { rundgang_scan_fotos_aufraeumen($pdo); } catch (Throwable $e) { $geworfen = true; }
pruef('KRITISCH: ein Fehler beim Aufraeumen reisst den Aufrufer nicht mit',
    $geworfen === false);

echo "$ok Pruefungen bestanden\n";
if ($bad) { foreach ($bad as $b2) { echo "  - $b2\n"; } exit(1); }
echo "Keine Beanstandung.\n";
