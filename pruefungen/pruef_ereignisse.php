<?php
declare(strict_types=1);
// Der Ereignis-Kern (ENT-089), ohne Datenbank: die Abgrenzung, welche Arten
// sich abhaken lassen, und dass ein Fehler eine Art ausfallen laesst statt
// den ganzen Feed.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require '/workspace/rapport_cupi24/backend/ereignisse.php';

// ══════════════ WAS SICH ABHAKEN LAESST
pruef('Ein Rapport laesst sich abhaken',            ereignis_abhakbar('rapport'));
pruef('Ein Sperrtag ebenfalls',                     ereignis_abhakbar('sperrtag'));
pruef('Eine Zusage ebenfalls',                      ereignis_abhakbar('zusage'));
pruef('KRITISCH: der offene Abgleich NICHT -- er verschwindet, wenn abgeglichen wurde, und nur dann',
    ereignis_abhakbar('abgleich') === false);
pruef('Eine erfundene Art auch nicht',              ereignis_abhakbar('irgendwas') === false);
pruef('Und eine leere erst recht nicht',            ereignis_abhakbar('') === false);

// ══════════════ JEDE ABHAKBARE ART KENNT IHREN SPEICHERORT
foreach (['rapport', 'sperrtag', 'zusage'] as $t) {
    pruef("Die Art $t nennt Tabelle und Spalte",
        !empty(EREIGNIS_ARTEN[$t]['tabelle']) && !empty(EREIGNIS_ARTEN[$t]['spalte']));
}

// ══════════════ EINE GESCHEITERTE ABFRAGE REISST NICHT ALLES MIT
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE da (id INTEGER PRIMARY KEY, wert TEXT)');
$pdo->exec("INSERT INTO da (wert) VALUES ('x')");

$fehler = [];
$gut = ereignis_lesen($pdo, 'SELECT * FROM da', $fehler, 'da');
pruef('Eine gueltige Abfrage liefert Zeilen',        count($gut) === 1);
pruef('Und meldet keinen Fehler',                    $fehler === []);

$schlecht = ereignis_lesen($pdo, 'SELECT * FROM gibtsnicht', $fehler, 'rapport');
pruef('KRITISCH: eine gescheiterte Abfrage wirft nicht, sondern liefert leer', $schlecht === []);
pruef('KRITISCH: und sie MELDET sich -- eine stille Luecke sieht aus wie "nichts passiert"',
    $fehler === ['rapport']);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
