<?php
declare(strict_types=1);
// Sichtbarkeit und Lesestand der Mitteilungen (ENT-421).
//
// Warum diese Pruefung gegen eine ECHTE Datenbank laeuft und nicht nur
// gegen die PHP-Funktion: mitteilungen.php beschreibt dieselbe Regel
// ZWEIMAL -- einmal als reine Funktion (mitteilung_sichtbar_fuer, fuer den
// einzelnen Datensatz) und einmal als SQL-Bedingung (mitteilung_sql_
// sichtbar, fuer die Liste). Eine Doppelung ist die Sorte Fehler, die still
// bleibt: Die Liste zeigte etwas anderes als die Einzelabfrage, und beides
// saehe fuer sich genommen richtig aus.
//
// Darum wird hier jeder Fall durch BEIDE Wege geschickt und das Ergebnis
// verglichen. Laufen sie auseinander, schlaegt es hier an.
//
// Kein festes Datum nahe beim heutigen Tag (Projektregel, test_datumsfest):
// Alle Zeitpunkte werden relativ zu einem frei gewaehlten "jetzt" gebildet,
// das mitgegeben und nicht aus der Uhr geholt wird.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die beiden Funktionen aus db.php, die mitteilungen.php erwartet.
$GLOBALS['spalteDa'] = true;
function hat_spalte(PDO $pdo, string $t, string $s): bool { return $GLOBALS['spalteDa']; }
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return true; }
function json_response($data, int $status = 200): void { throw new RuntimeException('unerwartet'); }

require __DIR__ . '/../backend/mitteilungen.php';

// ══════════════ KATALOGE
pruef('Es gibt genau zwei Zielgruppen',
    MITTEILUNG_ZIELGRUPPEN === ['alle', 'revier']);
pruef('Es gibt genau zwei Stufen',
    MITTEILUNG_STUFEN === ['normal', 'wichtig']);
pruef('Eine erfundene Zielgruppe gilt nicht', !mitteilung_zielgruppe_gueltig('abteilung'));
pruef('Eine erfundene Stufe gilt nicht', !mitteilung_stufe_gueltig('dringend'));

// ══════════════ DIE DATENBANK
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('CREATE TABLE mitteilungen (
  id INTEGER PRIMARY KEY, titel TEXT, text TEXT, zielgruppe TEXT, stufe TEXT,
  sichtbar_ab TEXT, sichtbar_bis TEXT, verfasser_id INTEGER, verfasser_name TEXT,
  erstellt_am TEXT, archiviert_am TEXT)');
$pdo->exec('CREATE TABLE mitteilung_gelesen (
  mitteilung_id INTEGER, mitarbeiter_id INTEGER, gelesen_am TEXT, bestaetigt_am TEXT,
  PRIMARY KEY (mitteilung_id, mitarbeiter_id))');
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, aktiv INTEGER,
  revierdienst_berechtigt INTEGER)');

// "Jetzt" ist frei gewaehlt und liegt weit weg vom heutigen Tag -- diese
// Pruefung kippt darum an keinem Datumswechsel.
$jetzt = '2031-06-15 12:00:00';
$frueher = '2031-06-01 08:00:00';
$spaeter = '2031-07-01 08:00:00';

// Neun Faelle, die zusammen jede Weiche abdecken.
$faelle = [
    [1, 'alle',   'normal',  null,     null,     null,     'immer sichtbar'],
    [2, 'revier', 'normal',  null,     null,     null,     'nur fuer Revier'],
    [3, 'alle',   'wichtig', null,     null,     null,     'wichtig, sichtbar'],
    [4, 'alle',   'normal',  $spaeter, null,     null,     'noch nicht begonnen'],
    [5, 'alle',   'normal',  null,     $frueher, null,     'abgelaufen'],
    [6, 'alle',   'normal',  $frueher, $spaeter, null,     'Fenster offen'],
    [7, 'alle',   'normal',  null,     null,     $frueher, 'zurueckgezogen'],
    [8, 'revier', 'wichtig', $frueher, $spaeter, null,     'Revier, Fenster offen'],
    // Bewusst ungueltige Zielgruppe: Ein Tippfehler in der Datenbank darf
    // NICHT dazu fuehren, dass eine Mitteilung fuer wenige plotzlich alle
    // erreicht. Im Zweifel wird nichts gezeigt.
    [9, 'abteilung', 'normal', null,   null,     null,     'unbekannte Zielgruppe'],
];
$st = $pdo->prepare('INSERT INTO mitteilungen
  (id, titel, text, zielgruppe, stufe, sichtbar_ab, sichtbar_bis, archiviert_am, erstellt_am, verfasser_name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
foreach ($faelle as $f) {
    $st->execute([$f[0], 'Titel ' . $f[0], 'Text ' . $f[0], $f[1], $f[2], $f[3], $f[4], $f[5],
        $frueher, 'Eine Verfasserin']);
}

// ══════════════ DIE EINZELNE REGEL
$holen = function (int $id) use ($pdo): array {
    $s = $pdo->prepare('SELECT * FROM mitteilungen WHERE id = ?');
    $s->execute([$id]);
    return $s->fetch();
};

pruef('Ohne Grenzen ist eine Mitteilung sichtbar',
    mitteilung_sichtbar_fuer($holen(1), false, $jetzt));
pruef('KRITISCH: eine Revier-Mitteilung erreicht niemanden ohne Revierdienst',
    !mitteilung_sichtbar_fuer($holen(2), false, $jetzt));
pruef('Mit Revierdienst schon',
    mitteilung_sichtbar_fuer($holen(2), true, $jetzt));
pruef('KRITISCH: was erst spaeter beginnt, erscheint jetzt nicht',
    !mitteilung_sichtbar_fuer($holen(4), true, $jetzt));
pruef('KRITISCH: was abgelaufen ist, erscheint nicht mehr',
    !mitteilung_sichtbar_fuer($holen(5), true, $jetzt));
pruef('Ein offenes Fenster zeigt sie',
    mitteilung_sichtbar_fuer($holen(6), true, $jetzt));
pruef('KRITISCH: eine zurueckgezogene Mitteilung erscheint nicht',
    !mitteilung_sichtbar_fuer($holen(7), true, $jetzt));
pruef('KRITISCH: eine unbekannte Zielgruppe zeigt NICHTS (im Zweifel weniger, nicht mehr)',
    !mitteilung_sichtbar_fuer($holen(9), true, $jetzt));

// Der Zeitpunkt ist ein Parameter, kein Blick auf die Uhr: derselbe
// Datensatz vor Beginn unsichtbar, danach sichtbar.
pruef('Dieselbe Mitteilung ist vor ihrem Beginn unsichtbar und danach sichtbar',
    !mitteilung_sichtbar_fuer($holen(4), true, $jetzt)
    && mitteilung_sichtbar_fuer($holen(4), true, '2031-07-02 08:00:00'));

// ══════════════ GEGENPROBE: SQL GEGEN PHP
// Beide Wege muessen bei jedem Fall und bei beiden Personenarten dasselbe
// sagen. Ohne diese Schleife koennte die SQL-Bedingung eine Bedingung
// verlieren, ohne dass irgendetwas rot wird.
foreach ([false, true] as $revier) {
    $sql = $pdo->prepare('SELECT m.id FROM mitteilungen m WHERE ' . mitteilung_sql_sichtbar());
    $sql->execute(mitteilung_sql_werte($revier, $jetzt));
    $ausSql = array_map('intval', array_column($sql->fetchAll(), 'id'));
    $ausPhp = [];
    foreach ($faelle as $f) {
        if (mitteilung_sichtbar_fuer($holen($f[0]), $revier, $jetzt)) { $ausPhp[] = $f[0]; }
    }
    sort($ausSql); sort($ausPhp);
    pruef('KRITISCH: SQL-Bedingung und PHP-Regel stimmen ueberein (Revierdienst: '
        . ($revier ? 'ja' : 'nein') . ')', $ausSql === $ausPhp);
}

// Eine Ausnahme gibt es, und sie ist gewollt: Die unbekannte Zielgruppe
// faellt in BEIDEN Wegen heraus -- in SQL, weil sie weder 'alle' noch
// 'revier' ist, in PHP durch die ausdrueckliche Pruefung. Genau das belegt
// die Zeile darueber.
pruef('Die unbekannte Zielgruppe faellt auch in SQL heraus',
    !in_array(9, (function () use ($pdo, $jetzt) {
        $s = $pdo->prepare('SELECT m.id FROM mitteilungen m WHERE ' . mitteilung_sql_sichtbar());
        $s->execute(mitteilung_sql_werte(true, $jetzt));
        return array_map('intval', array_column($s->fetchAll(), 'id'));
    })(), true));

// ══════════════ DAS UNTERBRECHENDE FENSTER
pruef('KRITISCH: nur "wichtig" unterbricht',
    mitteilung_unterbricht(['stufe' => 'wichtig', 'bestaetigt_am' => null])
    && !mitteilung_unterbricht(['stufe' => 'normal', 'bestaetigt_am' => null]));
pruef('KRITISCH: eine bestaetigte Mitteilung unterbricht nicht mehr',
    !mitteilung_unterbricht(['stufe' => 'wichtig', 'bestaetigt_am' => $frueher]));
pruef('Blosses Lesen loescht die Unterbrechung NICHT -- nur die Bestaetigung tut das',
    mitteilung_unterbricht(['stufe' => 'wichtig', 'gelesen_am' => $frueher, 'bestaetigt_am' => null]));

// ══════════════ LESESTAND
// SQLite kennt kein "ON DUPLICATE KEY UPDATE" -- die Funktion selbst laeuft
// darum hier nicht. Geprueft wird stattdessen ihre AUSSAGE: erstes Lesen
// setzt den Zeitpunkt, zweites Lesen aendert ihn nicht, und eine spaetere
// Bestaetigung kommt hinzu, ohne den Lesezeitpunkt zu verschieben.
$merken = function (int $id, int $person, bool $bestaetigt, string $zeit) use ($pdo) {
    $da = $pdo->prepare('SELECT gelesen_am, bestaetigt_am FROM mitteilung_gelesen
                          WHERE mitteilung_id = ? AND mitarbeiter_id = ?');
    $da->execute([$id, $person]);
    $alt = $da->fetch();
    if (!$alt) {
        $pdo->prepare('INSERT INTO mitteilung_gelesen VALUES (?, ?, ?, ?)')
            ->execute([$id, $person, $zeit, $bestaetigt ? $zeit : null]);
        return;
    }
    $pdo->prepare('UPDATE mitteilung_gelesen SET gelesen_am = ?, bestaetigt_am = ?
                    WHERE mitteilung_id = ? AND mitarbeiter_id = ?')
        ->execute([$alt['gelesen_am'] ?? $zeit,
                   $alt['bestaetigt_am'] ?? ($bestaetigt ? $zeit : null), $id, $person]);
};
$merken(3, 7, false, $frueher);
$merken(3, 7, false, $spaeter);
$stand = $pdo->query('SELECT * FROM mitteilung_gelesen WHERE mitteilung_id = 3 AND mitarbeiter_id = 7')->fetch();
pruef('KRITISCH: gelesen_am bleibt der ERSTE Kontakt, nicht der letzte',
    $stand['gelesen_am'] === $frueher);
pruef('Ohne ausdrueckliche Bestaetigung bleibt bestaetigt_am leer',
    $stand['bestaetigt_am'] === null);
$merken(3, 7, true, $spaeter);
$stand = $pdo->query('SELECT * FROM mitteilung_gelesen WHERE mitteilung_id = 3 AND mitarbeiter_id = 7')->fetch();
pruef('Eine spaetere Bestaetigung kommt hinzu',
    $stand['bestaetigt_am'] === $spaeter);
pruef('KRITISCH: und verschiebt den Lesezeitpunkt nicht',
    $stand['gelesen_am'] === $frueher);
pruef('Zweimal lesen legt keine zweite Zeile an',
    (int)$pdo->query('SELECT COUNT(*) FROM mitteilung_gelesen WHERE mitteilung_id = 3')->fetchColumn() === 1);

// ══════════════ DER NENNER ZU "12 VON 18"
$pdo->exec('INSERT INTO mitarbeiter VALUES (1, 1, 1), (2, 1, 0), (3, 1, 1), (4, 0, 1)');
pruef('Der Nenner "alle" zaehlt nur aktive Konten',
    mitteilung_empfaengerzahl($pdo, 'alle') === 3);
pruef('Der Nenner "revier" zaehlt nur aktive mit Revierdienst',
    mitteilung_empfaengerzahl($pdo, 'revier') === 2);
$GLOBALS['spalteDa'] = false;
pruef('KRITISCH: ohne die Spalte ist der Revier-Nenner UNBEKANNT (-1) und nicht 0',
    mitteilung_empfaengerzahl($pdo, 'revier') === -1);
$GLOBALS['spalteDa'] = true;

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
