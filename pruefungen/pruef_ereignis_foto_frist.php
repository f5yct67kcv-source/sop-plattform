<?php
declare(strict_types=1);
// Aufbewahrungsfrist fuer Ereignisfotos (ENT-545), WIRKLICH ausgefuehrt --
// gegen eine echte Datenbank (SQLite im Arbeitsspeicher), gleiches Muster
// wie pruef_wachbuch.php.
//
// Warum das hier laufen MUSS: Eine Frist, die nur im Quelltext steht, ist
// eine Absichtserklaerung. Geprueft gehoert, was nach dem Aufraeumen
// TATSAECHLICH in der Tabelle steht -- und zwar alle vier Aussagen:
//   1. Das alte Foto ist weg.
//   2. Die MELDUNG ist noch da. Sie ist der Nachweis; nur das Bild hat eine
//      Frist. Ein DELETE statt eines UPDATE waere der schwerste denkbare
//      Fehler an dieser Stelle und faellt sonst niemandem auf.
//   3. Es bleibt festgehalten, DASS es ein Foto gab. Ohne das saehe eine
//      alte Meldung aus wie eine, zu der nie jemand fotografiert hat --
//      "geloescht" und "gab es nie" duerfen nicht gleich aussehen.
//   4. Ein junges Foto bleibt unberuehrt. Eine Frist, die zu frueh greift,
//      vernichtet Nachweise.
$GLOBALS['tabellen'] = ['ereignis_meldung' => true];
$GLOBALS['spalten'] = ['ereignis_meldung.foto_geloescht_am' => true];
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
$pdo->exec('CREATE TABLE ereignis_meldung (id INTEGER PRIMARY KEY, objekt_id INT,
            mitarbeiter_id INT, erfasst_am TEXT, bemerkung TEXT,
            foto BLOB, foto_mime TEXT, foto_geloescht_am TEXT)');

// Relative Zeitpunkte, kein festes Datum nahe beim heutigen Tag (CLAUDE.md).
$tage = static fn(int $n): string => date('Y-m-d H:i:s', strtotime("-$n days"));

$alt   = $tage(EREIGNIS_FOTO_TAGE + 10);   // deutlich ueber der Frist
$knapp = $tage(EREIGNIS_FOTO_TAGE - 1);    // einen Tag DAVOR -- muss bleiben
$neu   = $tage(1);

$ein = $pdo->prepare('INSERT INTO ereignis_meldung
    (id, objekt_id, mitarbeiter_id, erfasst_am, bemerkung, foto, foto_mime, foto_geloescht_am)
    VALUES (?, 1, 5, ?, ?, ?, ?, NULL)');
$ein->execute([1, $alt,   'Alte Meldung mit Foto',   'BILDDATEN', 'image/jpeg']);
$ein->execute([2, $knapp, 'Knapp innerhalb der Frist', 'BILDDATEN', 'image/jpeg']);
$ein->execute([3, $neu,   'Junge Meldung mit Foto',  'BILDDATEN', 'image/jpeg']);
// Eine alte Meldung, zu der es NIE ein Foto gab -- sie darf hinterher nicht
// aussehen wie eine, deren Foto geloescht wurde.
$ein->execute([4, $alt,   'Alte Meldung ohne Foto',  null, null]);

ereignis_fotos_aufraeumen($pdo);

$holen = static function (PDO $pdo, int $id): array {
    $s = $pdo->prepare('SELECT * FROM ereignis_meldung WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch() ?: [];
};
$a = $holen($pdo, 1); $b = $holen($pdo, 2); $c = $holen($pdo, 3); $d = $holen($pdo, 4);

pruef('KRITISCH: das abgelaufene Foto ist wirklich weg',
    $a && $a['foto'] === null && $a['foto_mime'] === null);
pruef('KRITISCH: die MELDUNG bleibt -- nur das Bild hat eine Frist, nicht der Nachweis',
    $a && (int)$a['id'] === 1 && $a['bemerkung'] === 'Alte Meldung mit Foto'
    && $a['erfasst_am'] === $alt);
pruef('KRITISCH: es bleibt festgehalten, DASS es ein Foto gab',
    $a && $a['foto_geloescht_am'] !== null);
pruef('KRITISCH: eine alte Meldung OHNE Foto bekommt keinen Loeschvermerk -- '
    . '"geloescht" und "gab es nie" sind verschiedene Aussagen',
    $d && $d['foto_geloescht_am'] === null && $d['foto'] === null);
pruef('KRITISCH: ein Foto einen Tag VOR der Frist bleibt unberuehrt',
    $b && $b['foto'] !== null && $b['foto_mime'] === 'image/jpeg'
    && $b['foto_geloescht_am'] === null);
pruef('KRITISCH: ein junges Foto bleibt unberuehrt',
    $c && $c['foto'] !== null && $c['foto_geloescht_am'] === null);

// Die Zahl ist eine Entscheidung, keine Zufaelligkeit -- und dieselbe wie
// bei der Bewegungsspur (Vorgabe des Projektinhabers: "wie die Spur").
pruef('Die Frist betraegt 90 Tage, wie die Bewegungsspur',
    EREIGNIS_FOTO_TAGE === 90 && RUNDGANG_SPUR_TAGE === 90);

// Zweimal aufraeumen darf nichts kaputtmachen: Der Vermerk bleibt stehen,
// und aus einer geleerten Meldung wird nicht nochmals eine "faellige".
$vorher = $holen($pdo, 1)['foto_geloescht_am'];
ereignis_fotos_aufraeumen($pdo);
pruef('Ein zweiter Lauf aendert nichts mehr',
    $holen($pdo, 1)['foto_geloescht_am'] === $vorher
    && $holen($pdo, 3)['foto'] !== null);

// Fehlt die Spalte noch (Einrichtung nicht gelaufen), wird NICHT geloescht:
// Sonst verschwaende das Foto, ohne dass irgendwo staende, dass es eines gab.
$GLOBALS['spalten'] = [];
$pdo->exec("UPDATE ereignis_meldung SET foto = 'BILDDATEN', foto_mime = 'image/jpeg',
            foto_geloescht_am = NULL WHERE id = 1");
ereignis_fotos_aufraeumen($pdo);
pruef('KRITISCH: ohne die Vermerk-Spalte wird gar nicht geloescht -- '
    . 'ein Foto spurlos zu entfernen waere schlimmer als es zu behalten',
    $holen($pdo, 1)['foto'] !== null);
$GLOBALS['spalten'] = ['ereignis_meldung.foto_geloescht_am' => true];

// Und wenn die Abfrage selbst scheitert? Das Aufraeumen ist Beiwerk seines
// Aufrufers -- es darf ihn nie mitreissen. Hier wird die Tabelle unter der
// Funktion weggezogen, waehrend die Vorabtests sie noch melden: Die Funktion
// muss das schlucken. Ohne diese Zusage brauechte mein_rundgang_position.php
// ein eigenes try/catch um den Aufruf herum.
$pdo->exec('DROP TABLE ereignis_meldung');
$geworfen = false;
try { ereignis_fotos_aufraeumen($pdo); } catch (Throwable $e) { $geworfen = true; }
pruef('KRITISCH: ein Fehler beim Aufraeumen reisst den Aufrufer nicht mit',
    $geworfen === false);

echo "$ok Pruefungen bestanden\n";
if ($bad) { foreach ($bad as $b2) { echo "  - $b2\n"; } exit(1); }
echo "Keine Beanstandung.\n";
