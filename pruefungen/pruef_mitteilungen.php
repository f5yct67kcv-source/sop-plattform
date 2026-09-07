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
  art TEXT DEFAULT \'info\', beginn TEXT, ende TEXT, ort TEXT,
  sichtbar_ab TEXT, sichtbar_bis TEXT, verfasser_id INTEGER, verfasser_name TEXT,
  erstellt_am TEXT, archiviert_am TEXT)');
$pdo->exec('CREATE TABLE mitteilung_gelesen (
  mitteilung_id INTEGER, mitarbeiter_id INTEGER, gelesen_am TEXT, bestaetigt_am TEXT,
  antwort TEXT DEFAULT \'offen\', antwort_am TEXT,
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

// ══════════════ DAS ARCHIV -- UND DAMIT DIE LOESCHSPERRE (ENT-433)
// mitteilung_im_archiv() entscheidet zweierlei zugleich: welche Ansicht im
// Cockpit eine Mitteilung zeigt UND ob sie endgueltig geloescht werden
// darf. Ein Fehler hier loeschte also nicht bloss falsch einsortiert --
// er gaebe eine laufende Mitteilung zum Loeschen frei.
pruef('KRITISCH: eine zurueckgezogene Mitteilung steht im Archiv',
    mitteilung_im_archiv($holen(7), $jetzt));
pruef('KRITISCH: eine abgelaufene steht im Archiv, auch ohne Zurueckziehen',
    mitteilung_im_archiv($holen(5), $jetzt));
pruef('KRITISCH: eine laufende steht NICHT im Archiv -- sie waere sonst loeschbar',
    !mitteilung_im_archiv($holen(1), $jetzt));
pruef('KRITISCH: eine GEPLANTE steht nicht im Archiv -- sie war noch gar nicht draussen',
    !mitteilung_im_archiv($holen(4), $jetzt));
pruef('Eine mit offenem Fenster steht nicht im Archiv',
    !mitteilung_im_archiv($holen(6), $jetzt));
// Der Zeitpunkt ist auch hier ein Parameter: derselbe Datensatz wandert
// mit der Zeit ins Archiv, ohne dass jemand etwas anfasst.
pruef('KRITISCH: dieselbe Mitteilung ist vor ihrem Ablauf nicht im Archiv und danach schon',
    !mitteilung_im_archiv($holen(6), $jetzt)
    && mitteilung_im_archiv($holen(6), '2031-07-02 08:00:00'));
// Genau am Ablaufzeitpunkt ist sie noch sichtbar -- und darf darum auch
// noch nicht im Archiv stehen. Die beiden Grenzen muessen dieselbe sein,
// sonst gaebe es einen Moment, in dem eine Mitteilung in der App steht und
// sich gleichzeitig loeschen liesse.
$grenze = $holen(5)['sichtbar_bis'];
pruef('KRITISCH: am Ablaufzeitpunkt selbst ist sie sichtbar UND nicht im Archiv',
    mitteilung_sichtbar_fuer($holen(5), true, $grenze)
    && !mitteilung_im_archiv($holen(5), $grenze));

// Die Gegenprobe zur Sperre: Kein Fall darf gleichzeitig sichtbar und
// loeschbar sein. Ohne diese Schleife koennte eine der beiden Bedingungen
// eine Zeile verlieren, ohne dass etwas rot wird.
$widerspruch = [];
foreach ($faelle as $f) {
    $m = $holen($f[0]);
    foreach ([$frueher, $jetzt, $spaeter] as $zeitpunkt) {
        foreach ([false, true] as $revier) {
            if (mitteilung_sichtbar_fuer($m, $revier, $zeitpunkt)
                && mitteilung_im_archiv($m, $zeitpunkt)) {
                $widerspruch[] = $f[0] . '@' . $zeitpunkt;
            }
        }
    }
}
pruef('KRITISCH: keine Mitteilung ist gleichzeitig in der App sichtbar und loeschbar',
    $widerspruch === []);

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
        $pdo->prepare('INSERT INTO mitteilung_gelesen
                         (mitteilung_id, mitarbeiter_id, gelesen_am, bestaetigt_am)
                       VALUES (?, ?, ?, ?)')
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

// ══════════════ TERMINE (ENT-436)
// Ein Termin ist eine Mitteilung, die eine Antwort verlangt. Die
// gefaehrliche Verwechslung ist "offen" mit "abgesagt": Wer nicht
// geantwortet hat, hat NICHT abgesagt (CLAUDE.md).
pruef('Es gibt genau zwei Arten', MITTEILUNG_ARTEN === ['info', 'termin']);
pruef('Eine erfundene Art gilt nicht', !mitteilung_art_gueltig('einladung'));
pruef('KRITISCH: "offen" ist keine Antwort, die sich abgeben laesst',
    !termin_antwort_gueltig('offen'));
pruef('Zusagen und Absagen sind gueltige Antworten',
    termin_antwort_gueltig('zugesagt') && termin_antwort_gueltig('abgesagt'));
pruef('Eine erfundene Antwort gilt nicht', !termin_antwort_gueltig('vielleicht'));

pruef('Ohne Art ist es eine Mitteilung, kein Termin',
    !mitteilung_ist_termin(['titel' => 'x']));
pruef('Mit art=termin ist es einer', mitteilung_ist_termin(['art' => 'termin']));

pruef('KRITISCH: keine Zeile heisst "offen", nicht "abgesagt"',
    termin_antwort(['art' => 'termin', 'antwort' => null]) === 'offen');
pruef('KRITISCH: ein unbekannter Wert in der Spalte heisst ebenfalls "offen"',
    termin_antwort(['antwort' => 'vielleicht']) === 'offen');
pruef('Eine abgegebene Antwort kommt unveraendert zurueck',
    termin_antwort(['antwort' => 'abgesagt']) === 'abgesagt');

// Das Fenster: Ein Termin fragt, bis geantwortet ist -- unabhaengig von
// der Stufe. Eine Mitteilung fragt nur bei "wichtig".
pruef('KRITISCH: ein unbeantworteter Termin unterbricht, auch mit Stufe normal',
    mitteilung_unterbricht(['art' => 'termin', 'stufe' => 'normal', 'antwort' => null]));
pruef('KRITISCH: ein beantworteter Termin unterbricht nicht mehr',
    !mitteilung_unterbricht(['art' => 'termin', 'stufe' => 'normal', 'antwort' => 'zugesagt']));
pruef('KRITISCH: auch eine Absage beendet das Fragen -- sie ist eine Antwort',
    !mitteilung_unterbricht(['art' => 'termin', 'stufe' => 'wichtig', 'antwort' => 'abgesagt']));
pruef('Blosses Lesen beendet das Fragen beim Termin NICHT',
    mitteilung_unterbricht(['art' => 'termin', 'gelesen_am' => $frueher,
                            'bestaetigt_am' => $frueher, 'antwort' => 'offen']));

// ── Die Antwort festhalten, gegen die echte Datenbank
$pdo->exec("INSERT INTO mitteilungen (id, titel, zielgruppe, stufe, art, beginn, erstellt_am)
            VALUES (20, 'Sitzung', 'alle', 'normal', 'termin', '2031-07-01 17:00:00', '$frueher')");
termin_antwort_merken($pdo, 20, 5, 'zugesagt', $frueher);
$z = $pdo->query('SELECT * FROM mitteilung_gelesen WHERE mitteilung_id = 20 AND mitarbeiter_id = 5')->fetch();
pruef('Die erste Antwort legt die Zeile an', $z && $z['antwort'] === 'zugesagt');
pruef('KRITISCH: die Antwort gilt zugleich als gelesen -- wer aus dem Fenster '
    . 'antwortet, hat die Liste nie geoeffnet',
    $z['gelesen_am'] === $frueher);

termin_antwort_merken($pdo, 20, 5, 'abgesagt', $spaeter);
$z2 = $pdo->query('SELECT * FROM mitteilung_gelesen WHERE mitteilung_id = 20 AND mitarbeiter_id = 5')->fetch();
pruef('KRITISCH: eine geaenderte Meinung ueberschreibt die Antwort',
    $z2['antwort'] === 'abgesagt');
pruef('KRITISCH: und legt keine zweite Zeile an',
    (int)$pdo->query('SELECT COUNT(*) FROM mitteilung_gelesen WHERE mitteilung_id = 20')->fetchColumn() === 1);
pruef('antwort_am folgt der letzten Entscheidung', $z2['antwort_am'] === $spaeter);
pruef('KRITISCH: gelesen_am bleibt trotzdem der ERSTE Kontakt',
    $z2['gelesen_am'] === $frueher);

// Wer die Liste geoeffnet, aber nicht geantwortet hat: Die Zeile besteht
// schon, die Antwort kommt spaeter dazu.
$merken(20, 6, false, $frueher);
$vorher = $pdo->query('SELECT * FROM mitteilung_gelesen WHERE mitteilung_id = 20 AND mitarbeiter_id = 6')->fetch();
pruef('Wer nur geoeffnet hat, steht auf "offen"',
    termin_antwort($vorher) === 'offen' && $vorher['gelesen_am'] === $frueher);
termin_antwort_merken($pdo, 20, 6, 'zugesagt', $spaeter);
$nachher = $pdo->query('SELECT * FROM mitteilung_gelesen WHERE mitteilung_id = 20 AND mitarbeiter_id = 6')->fetch();
pruef('KRITISCH: die spaetere Antwort verschiebt den Lesezeitpunkt nicht',
    $nachher['antwort'] === 'zugesagt' && $nachher['gelesen_am'] === $frueher);

// ── Empfaengerkreis: EINE Bedingung fuer Zahl und Liste
$wo = mitteilung_empfaenger_wo($pdo, 'alle');
$ausListe = (int)$pdo->query("SELECT COUNT(*) FROM mitarbeiter WHERE $wo")->fetchColumn();
pruef('KRITISCH: die Empfaengerliste zaehlt dieselben Personen wie der Nenner',
    $ausListe === mitteilung_empfaengerzahl($pdo, 'alle'));
$GLOBALS['spalteDa'] = false;
pruef('KRITISCH: ohne die Revier-Spalte ist der Kreis UNBEKANNT (null), nicht leer',
    mitteilung_empfaenger_wo($pdo, 'revier') === null);
$GLOBALS['spalteDa'] = true;

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
