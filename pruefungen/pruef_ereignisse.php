<?php
declare(strict_types=1);
// Der Ereignis-Kern (ENT-090), ohne Datenbank: die Abgrenzung, welche Arten
// sich abhaken lassen, und dass ein Fehler eine Art ausfallen laesst statt
// den ganzen Feed.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

require __DIR__ . '/../backend/ereignisse.php';

// ══════════════ WAS SICH ABHAKEN LAESST
pruef('Ein Rapport laesst sich abhaken',            ereignis_abhakbar('rapport'));
pruef('Ein Sperrtag ebenfalls',                     ereignis_abhakbar('sperrtag'));
pruef('Eine Zusage ebenfalls',                      ereignis_abhakbar('zusage'));
pruef('Eine Offerten-Entscheidung ebenfalls (ENT-197)', ereignis_abhakbar('offerte'));
pruef('Ein spontaner Rundgang-Start ebenfalls (ENT-283)', ereignis_abhakbar('rundgang_spontan'));
pruef('Eine Vorfallmeldung ebenfalls (ENT-297)',    ereignis_abhakbar('vorfall'));
// Eine offene, noch nicht abgeglichene Schicht ist KEIN Ereignis, sondern ein
// andauernder Zustand. Sie war bis zum 23.08.2026 eine eigene Art und wurde
// auf ausdrueckliche Ansage des Projektinhabers entfernt: "fehlende, noch
// nicht abgeschlossene Schichten sollen nicht in die Ereignisse kommen. nur
// ereignisse, die neu hinzukommen." Diese Pruefung haelt das fest -- sonst
// kaeme die Art beim naechsten Ausbau geraeuschlos zurueck.
pruef('KRITISCH: der offene Abgleich ist gar keine Art mehr',
    !array_key_exists('abgleich', EREIGNIS_ARTEN) && ereignis_abhakbar('abgleich') === false);
// Die feste Zahl ist Absicht: Eine neue Art soll nicht geraeuschlos
// dazukommen, sondern hier bewusst eingetragen werden -- zusammen mit der
// Frage, ob das Recht 'plan' fuer ihr Abhaken wirklich passt.
pruef('KRITISCH: es gibt genau sechs Arten -- Rapport, Sperrtag, Zusage, Offerte, spontaner Rundgang, Vorfallmeldung',
    count(EREIGNIS_ARTEN) === 6);
pruef('Eine erfundene Art auch nicht',              ereignis_abhakbar('irgendwas') === false);
pruef('Und eine leere erst recht nicht',            ereignis_abhakbar('') === false);

// ══════════════ JEDE ABHAKBARE ART KENNT IHREN SPEICHERORT
foreach (['rapport', 'sperrtag', 'zusage', 'offerte', 'rundgang_spontan'] as $t) {
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

// ══════════════ SPONTANER RUNDGANG: DIE ECHTE JOIN-ABFRAGE (ENT-283)
//
// pruef_sql.php prueft Spaltennamen nur bei Abfragen OHNE JOIN -- diese Art
// hat ihre einzige Abfrage als JOIN ueber drei Tabellen (rundgang, einsaetze,
// mitarbeiter). Ohne einen echten Lauf waere ein Tippfehler in einem
// Spaltennamen (oder ein falscher Alias) erst beim ersten echten Rundgang im
// Betrieb aufgefallen -- genau der Fall, den pruef_sql.php in seinem eigenen
// Kopfkommentar als Anlass nennt (ENT-181/184).
$pdo2 = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo2->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, vorname TEXT, nachname TEXT)');
$pdo2->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, spontan_erzeugt INTEGER NOT NULL DEFAULT 0,
    datum TEXT, von TEXT, bis TEXT, kunde_name TEXT, titel TEXT, ort TEXT)');
$pdo2->exec('CREATE TABLE rundgang (id INTEGER PRIMARY KEY, einsatz_id INTEGER, mitarbeiter_id INTEGER,
    objekt_id INTEGER, status TEXT, vorbereitet_am TEXT, ausnahme_grund TEXT, gesehen_am TEXT)');
// Alle vier weiteren Arten brauchen ihre eigene Tabelle, sonst wirft
// ereignisse_sammeln() beim ersten SELECT gegen eine fehlende Tabelle --
// ereignis_lesen() faengt das zwar ab, aber dann waere auch die spontane
// Art "unvollstaendig" gemeldet und diese Pruefung testete das Falsche.
$pdo2->exec('CREATE TABLE rapporte (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, datum TEXT,
    kunde TEXT, ort TEXT, einsatzart TEXT, netto_h REAL, erfasst_am TEXT)');
$pdo2->exec('CREATE TABLE sperrtage (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, datum TEXT,
    bemerkung TEXT, erstellt_am TEXT)');
$pdo2->exec('CREATE TABLE einsatz_zuteilung (id INTEGER PRIMARY KEY, einsatz_id INTEGER, mitarbeiter_id INTEGER,
    zusage TEXT, zusage_gesehen_am TEXT)');
$pdo2->exec('CREATE TABLE belege (id INTEGER PRIMARY KEY, art TEXT, nummer TEXT, kunde_id INTEGER,
    status TEXT, entscheidung_am TEXT, entscheidung_gesehen_am TEXT)');
$pdo2->exec('CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT)');
$pdo2->exec('CREATE TABLE abwesenheiten (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, typ TEXT,
    von TEXT, bis TEXT, bemerkung TEXT, status TEXT, beantragt_am TEXT, gesehen_am TEXT)');

$pdo2->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname) VALUES (1, 'anna', 'Anna', 'Muster')");
// Einsatz 10: spontan erzeugt, Rundgang noch nicht gesehen -- MUSS erscheinen.
$pdo2->exec("INSERT INTO einsaetze (id, spontan_erzeugt, datum, von, bis, kunde_name, titel, ort)
             VALUES (10, 1, '2026-09-01', '08:15:00', '12:00:00', 'Muster AG', 'Spontaner Rundgang: Nachtkontrolle', 'Musterstadt')");
$pdo2->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, vorbereitet_am, ausnahme_grund, gesehen_am)
             VALUES (100, 10, 1, 1, 'vorbereitet', '2026-09-01 08:14:00', 'planer_freigabe', NULL)");
// Einsatz 11: spontan erzeugt, aber sein Rundgang wurde bereits abgehakt --
// darf NICHT erscheinen (dieselbe gesehen_am-Sperre wie bei allen anderen
// Arten).
$pdo2->exec("INSERT INTO einsaetze (id, spontan_erzeugt, datum, von, bis, kunde_name, titel, ort)
             VALUES (11, 1, '2026-09-01', '06:00:00', '06:30:00', 'Muster AG', 'Spontaner Rundgang: Fruehkontrolle', 'Musterstadt')");
$pdo2->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, vorbereitet_am, ausnahme_grund, gesehen_am)
             VALUES (101, 11, 1, 1, 'vorbereitet', '2026-09-01 06:00:00', NULL, '2026-09-01 09:00:00')");
// Einsatz 12: ganz normal vom Planer angelegt (spontan_erzeugt = 0). Sein
// Rundgang ist ungesehen -- darf trotzdem NICHT erscheinen, das ist genau
// die Abgrenzung, die e.spontan_erzeugt = 1 in der Abfrage leistet.
$pdo2->exec("INSERT INTO einsaetze (id, spontan_erzeugt, datum, von, bis, kunde_name, titel, ort)
             VALUES (12, 0, '2026-09-01', '14:00:00', '18:00:00', 'Muster AG', NULL, 'Musterstadt')");
$pdo2->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, objekt_id, status, vorbereitet_am, ausnahme_grund, gesehen_am)
             VALUES (102, 12, 1, 1, 'vorbereitet', '2026-09-01 14:00:00', NULL, NULL)");

$ergebnis = ereignisse_sammeln($pdo2);
pruef('KRITISCH: die Abfrage laeuft ueberhaupt durch -- keine unvollstaendige Art gemeldet',
    !in_array('rundgang_spontan', $ergebnis['unvollstaendig'], true));
$treffer = array_values(array_filter($ergebnis['ereignisse'], fn($x) => $x['typ'] === 'rundgang_spontan'));
pruef('KRITISCH: genau der eine ungesehene spontane Rundgang erscheint -- nicht der abgehakte, nicht der normal geplante',
    count($treffer) === 1 && $treffer[0]['id'] === 100);
pruef('Die Zeile traegt Person, Kunde, Zeiten und Ausnahme-Grund aus der echten Abfrage',
    $treffer !== [] && $treffer[0]['person']['name'] === 'anna'
    && $treffer[0]['kunde'] === 'Muster AG' && $treffer[0]['von'] === '08:15:00'
    && $treffer[0]['ausnahme_grund'] === 'planer_freigabe');

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
