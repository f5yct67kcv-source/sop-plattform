<?php
declare(strict_types=1);
// Echte Ausfuehrung der Uebernahme-Logik (ENT-340) gegen eine wirkliche
// Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster wie
// pruef_dienstfahrzeug.php.
//
// WARUM AUSGEFUEHRT UND NICHT NACHGEBAUT: fz_bezugsstand() entscheidet, ob
// ein eingetragener Kilometerstand angenommen oder abgewiesen wird. Eine
// nachgebaute Fassung wuerde beweisen, dass der Nachbau stimmt -- nicht,
// dass die Regel stimmt, die im Betrieb laeuft.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die Funktionen, die fahrzeug.php aus db.php erwartet. hat_tabelle() fragt
// sonst information_schema ab -- das gibt es in SQLite nicht.
$GLOBALS['tabellen'] = ['fahrzeuge' => true, 'fahrzeug_uebernahme' => true];
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    return $GLOBALS['tabellen'][$t] ?? false;
}
function hat_spalte(PDO $pdo, string $t, string $s): bool { return true; }

require __DIR__ . '/../backend/fahrzeug.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE fahrzeuge (id INTEGER PRIMARY KEY, kennzeichen TEXT, bezeichnung TEXT NULL, status TEXT,
            tacho_km INT NULL, tacho_am TEXT NULL, qr_kennung TEXT NULL)');
$pdo->exec('CREATE TABLE fahrzeug_uebernahme (id INTEGER PRIMARY KEY, art TEXT, fahrzeug_id INT,
            mitarbeiter_id INT, einsatz_id INT NULL, zeitpunkt TEXT, tacho_km INT NULL,
            quelle TEXT, foto BLOB NULL, bemerkung TEXT NULL)');
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, vorname TEXT, nachname TEXT, name TEXT)');
$pdo->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, kunde_name TEXT NULL, titel TEXT NULL,
            datum TEXT NULL, von TEXT NULL, weg_km REAL NULL)');
$pdo->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INT, mitarbeiter_id INT, zusage TEXT)');
// Erfundene Namen und Kontrollschilder mit hoher Nummer -- kein echtes
// Fahrzeug, keine echte Person.
$pdo->exec("INSERT INTO mitarbeiter VALUES (7, 'Vorname', 'Nachname', 'vn')");
$pdo->exec("INSERT INTO mitarbeiter VALUES (8, 'Andere', 'Person', 'ap')");

$neu = function (int $id) use ($pdo) {
    $pdo->prepare("INSERT INTO fahrzeuge (id, kennzeichen, status) VALUES (?, ?, 'aktiv')")
        ->execute([$id, 'SO 9990' . $id]);
};
$stamm = function (int $id, ?int $km, ?string $am) use ($pdo) {
    $pdo->prepare('UPDATE fahrzeuge SET tacho_km = ?, tacho_am = ? WHERE id = ?')->execute([$km, $am, $id]);
};
$kette = function (int $fz, string $art, ?int $km, string $zeit, int $ma = 7) use ($pdo) {
    $pdo->prepare("INSERT INTO fahrzeug_uebernahme (art, fahrzeug_id, mitarbeiter_id, zeitpunkt, tacho_km, quelle)
                   VALUES (?, ?, ?, ?, ?, 'qr')")->execute([$art, $fz, $ma, $zeit, $km]);
};

// ── Gar nichts bekannt ────────────────────────────────────────────────────
// "Kein Stand" ist etwas anderes als "0 km" -- darum null und nicht 0.
$neu(1);
pruef('KRITISCH: ohne jede Ablesung gibt es keinen Bezugswert, auch nicht 0',
    fz_bezugsstand($pdo, 1) === null);

// ── Nur Stammdaten ────────────────────────────────────────────────────────
$neu(2); $stamm(2, 50000, '2026-01-10');
$b = fz_bezugsstand($pdo, 2);
pruef('Ohne Kette gilt der Stammdatenwert',
    $b !== null && $b['tacho_km'] === 50000 && $b['quelle'] === 'stammdaten');

// ── Nur die Kette ─────────────────────────────────────────────────────────
$neu(3); $kette(3, 'uebernahme', 61000, '2026-02-01 07:00:00');
$b = fz_bezugsstand($pdo, 3);
pruef('Ohne Stammdatenwert gilt die letzte Uebernahme',
    $b !== null && $b['tacho_km'] === 61000 && $b['quelle'] === 'uebernahme');
pruef('Die letzte Uebernahme nennt die Person, die sie eingetragen hat',
    $b['person'] === 'Vorname Nachname');

// ── Die juengere Uebernahme gewinnt gegen einen aelteren Stammdatenwert ───
$neu(4); $stamm(4, 70000, '2026-01-01'); $kette(4, 'uebernahme', 71000, '2026-03-01 07:00:00');
$b = fz_bezugsstand($pdo, 4);
pruef('KRITISCH: eine spaetere Uebernahme schlaegt den aelteren Stammdatenwert',
    $b['tacho_km'] === 71000 && $b['quelle'] === 'uebernahme');

// ── Der Bueroeingriff loest die Sperre ────────────────────────────────────
// Der Fall, um den es geht: In der Kette steht ein Vertipper (1'234'567
// statt 123'456). Ohne Vorrang des juengeren Bueroeingriffs laege JEDE
// weitere Uebernahme darunter und wuerde fuer immer abgewiesen.
$neu(5); $kette(5, 'uebernahme', 1234567, '2026-03-01 07:00:00');
$stamm(5, 123456, '2026-03-02');
$b = fz_bezugsstand($pdo, 5);
pruef('KRITISCH: eine spaetere Korrektur im Buero schlaegt einen Vertipper in der Kette',
    $b['tacho_km'] === 123456 && $b['quelle'] === 'stammdaten');

// ── Gleiches Datum: der Stammdatenwert gewinnt ────────────────────────────
// Jede Uebernahme schreibt den Stammdatenwert selbst mit; steht dort am
// selben Tag etwas anderes, hat jemand danach von Hand eingegriffen.
$neu(6); $kette(6, 'uebernahme', 90000, '2026-04-01 07:00:00');
$stamm(6, 88000, '2026-04-01');
pruef('KRITISCH: am selben Tag gewinnt der Stammdatenwert -- die Korrektur ist der spaetere Vorgang',
    fz_bezugsstand($pdo, 6)['tacho_km'] === 88000);

// ── Stammdatenwert ohne Ablesedatum ───────────────────────────────────────
// Er laesst sich zeitlich nicht einordnen und gilt darum als der aeltere.
$neu(7); $kette(7, 'uebernahme', 30000, '2026-04-01 07:00:00'); $stamm(7, 99999, null);
pruef('Ein Stammdatenwert ohne Ablesedatum verdraengt die datierte Kette nicht',
    fz_bezugsstand($pdo, 7)['tacho_km'] === 30000);

// ── "Kein Dienstfahrzeug" ist kein Kilometerstand ─────────────────────────
// Die Zeile traegt hier ABSICHTLICH eine Kilometerzahl, obwohl der Endpunkt
// bei dieser Art keine schreibt. Sonst pruefte der Fall nur die Bedingung
// "tacho_km IS NOT NULL" mit und bliebe gruen, wenn der art-Filter
// verschwindet -- eine Pruefung, die nicht anschlaegt, ist eine Behauptung.
$neu(8); $kette(8, 'uebernahme', 40000, '2026-04-01 07:00:00');
$kette(8, 'ohne_fahrzeug', 999999, '2026-05-01 07:00:00');
pruef('KRITISCH: eine Antwort "kein Dienstfahrzeug" verdraengt den letzten Stand nicht',
    fz_bezugsstand($pdo, 8)['tacho_km'] === 40000);

// ── Die juengste Uebernahme zaehlt, nicht die hoechste ────────────────────
// Der Fall entsteht echt: Nach dem Vertipper 1'234'567 korrigiert das Buero
// auf 123'456, danach wird regulaer bei 123'500 uebernommen. Zaehlte die
// HOECHSTE Zahl statt der juengsten, kaeme der Vertipper zurueck und die
// Sperre mit ihm -- die Korrektur waere umsonst gewesen.
$neu(9); $kette(9, 'uebernahme', 1234567, '2026-04-01 07:00:00');
$kette(9, 'uebernahme', 123500, '2026-04-05 07:00:00');
pruef('KRITISCH: es zaehlt die juengste Uebernahme, nicht die hoechste Zahl',
    fz_bezugsstand($pdo, 9)['tacho_km'] === 123500);

// ── Ohne Tabelle bleibt der Stammdatenwert ────────────────────────────────
// Vor dem Einrichtungslauf gibt es die Kette nicht. Das darf keinen Fehler
// werfen -- und es ist auch nicht dasselbe wie "keine Uebernahme".
$GLOBALS['tabellen']['fahrzeug_uebernahme'] = false;
pruef('Ohne eingerichtete Uebernahme-Tabelle bleibt der Stammdatenwert die Auskunft',
    fz_bezugsstand($pdo, 2)['quelle'] === 'stammdaten');
$GLOBALS['tabellen']['fahrzeug_uebernahme'] = true;

// ── Annahme und Abweisung eines Kilometerstands ───────────────────────────
// Fahrzeug 4: Bezug ist die Uebernahme bei 71'000.
$bez4 = fz_bezugsstand($pdo, 4);
pruef('KRITISCH: ein kleinerer Kilometerstand als der bekannte wird abgewiesen',
    fz_stand_pruefen($bez4, 70999) !== null);
pruef('Derselbe Stand noch einmal ist keine Abweisung -- zwei Personen koennen dasselbe Auto '
    . 'nacheinander nehmen, ohne dass dazwischen gefahren wurde',
    fz_stand_pruefen($bez4, 71000) === null);
pruef('Ein hoeherer Stand wird angenommen', fz_stand_pruefen($bez4, 71300) === null);
pruef('KRITISCH: die Abweisung NENNT den zuletzt bekannten Stand -- sonst weiss niemand, '
    . 'wogegen er verstossen hat',
    str_contains((string)fz_stand_pruefen($bez4, 100), '71'));

// Ohne Bezug gibt es nichts zu vergleichen: Der erste Eintrag eines
// Fahrzeugs darf nicht an einer Regel scheitern, fuer die die Grundlage
// fehlt.
pruef('Ohne bekannten Stand wird der erste Eintrag angenommen',
    fz_stand_pruefen(null, 12345) === null);

// Der Vertipper mit einer Ziffer zu viel -- dieselbe Grenze wie im
// Stammdatenformular.
pruef('KRITISCH: ein unmoeglich hoher Stand wird abgewiesen',
    fz_stand_pruefen(null, 30000000) !== null);
pruef('Ein negativer Stand wird abgewiesen', fz_stand_pruefen(null, -1) !== null);

// ── Aufkleber-Schluessel ──────────────────────────────────────────────────
$a = fz_kennung_neu(); $b2 = fz_kennung_neu();
pruef('KRITISCH: der Aufkleber-Schluessel ist lang genug, um nicht erraten zu werden',
    strlen($a) === 32 && ctype_xdigit($a));
pruef('KRITISCH: zwei Schluessel sind nicht derselbe', $a !== $b2);

// Nachtragen vergibt nur, wo nichts steht -- ein geklebter Aufkleber darf
// nicht im naechsten Einrichtungslauf ungueltig werden.
$pdo->exec("UPDATE fahrzeuge SET qr_kennung = 'bereitsgeklebt' WHERE id = 1");
$vergeben = fz_kennungen_nachtragen($pdo);
$nachher = $pdo->query('SELECT id, qr_kennung FROM fahrzeuge ORDER BY id')->fetchAll();
pruef('KRITISCH: ein bestehender Aufkleber-Schluessel wird nie ueberschrieben',
    $nachher[0]['qr_kennung'] === 'bereitsgeklebt');
pruef('Jedes uebrige Fahrzeug bekommt einen Schluessel',
    $vergeben === 8 && count(array_filter($nachher, fn($r) => ($r['qr_kennung'] ?? '') === '')) === 0
    && count(array_unique(array_column($nachher, 'qr_kennung'))) === count($nachher));

// Ein zweiter Lauf vergibt nichts mehr -- der Nachtrag ist wiederholbar.
pruef('Ein zweiter Einrichtungslauf vergibt keine neuen Schluessel',
    fz_kennungen_nachtragen($pdo) === 0);

// ── fz_bezugsstand() mit eigener ID (ENT-354) ─────────────────────────────
// Neue Fahrzeuge ab hier, NACH dem Nachtragen oben -- sonst verschoebe sich
// dessen Zaehlung ("8" bereits vergebene Schluessel).
$neu(10); $kette(10, 'uebernahme', 50000, '2026-05-01 07:00:00');
$bezEigen = fz_bezugsstand($pdo, 10, 7);
pruef('KRITISCH: die eigene ID erkennt die eigene letzte Uebernahme',
    ($bezEigen['eigene'] ?? null) === true);
$bezFremd = fz_bezugsstand($pdo, 10, 8);
pruef('KRITISCH: eine andere ID erkennt dieselbe Uebernahme als NICHT eigene',
    ($bezFremd['eigene'] ?? null) === false);
pruef('Ohne mitgegebene eigene ID bleibt "eigene" unbesetzt -- kein stiller Vorgabewert',
    !array_key_exists('eigene', fz_bezugsstand($pdo, 10)));

$neu(11); $stamm(11, 20000, '2026-05-01');
pruef('Beim Stammdatenwert (keine Uebernahme in der Kette) bleibt "eigene" unbesetzt',
    !array_key_exists('eigene', fz_bezugsstand($pdo, 11, 7)));

// ── fz_meine_aktiv() (ENT-354) ─────────────────────────────────────────────
// Rein informativ fuer die eigene Maske -- siehe Kommentar in fahrzeug.php.
pruef('Ohne jede Uebernahme gibt es kein aktives Fahrzeug',
    fz_meine_aktiv($pdo, 999) === null);

$neu(12); $kette(12, 'uebernahme', 1000, '2026-05-01 08:00:00', 7);
$aktiv12 = fz_meine_aktiv($pdo, 7);
pruef('KRITISCH: die eigene letzte Uebernahme gilt als aktives Fahrzeug',
    $aktiv12 !== null && $aktiv12['id'] === 12);
pruef('Eine andere Person meldet dieses Fahrzeug NICHT als ihr eigenes aktives',
    fz_meine_aktiv($pdo, 8) === null);

// Uebernimmt jemand anders dasselbe Fahrzeug, erlischt meine Anzeige --
// auch ohne dass ich je "abgegeben" haette.
$neu(13); $kette(13, 'uebernahme', 2000, '2026-05-01 08:00:00', 7);
$kette(13, 'uebernahme', 2100, '2026-05-01 09:00:00', 8);
pruef('KRITISCH: uebernimmt jemand anders dasselbe Fahrzeug, gilt es fuer mich nicht mehr als aktiv',
    fz_meine_aktiv($pdo, 7) === null);
pruef('...und gilt stattdessen bei der Person, die es zuletzt uebernommen hat',
    ($x = fz_meine_aktiv($pdo, 8)) !== null && $x['id'] === 13);

// Abgabe beendet die eigene Anzeige, auch ohne dass jemand anders uebernimmt.
$neu(14); $kette(14, 'uebernahme', 3000, '2026-05-01 08:00:00', 7);
pruef('Vor der Abgabe gilt das Fahrzeug als aktiv',
    ($x = fz_meine_aktiv($pdo, 7)) !== null && $x['id'] === 14);
$kette(14, 'abgabe', null, '2026-05-01 10:00:00', 7);
pruef('KRITISCH: nach der eigenen Abgabe gilt kein Fahrzeug mehr als aktiv',
    fz_meine_aktiv($pdo, 7) === null);
pruef('KRITISCH: eine Abgabe aendert den Bezugsstand der Kette NICHT -- '
    . 'fz_bezugsstand() zaehlt weiterhin nur "uebernahme" (ENT-340 bleibt unberuehrt)',
    fz_bezugsstand($pdo, 14)['tacho_km'] === 3000);

// Nimmt dieselbe Person ein zweites Fahrzeug, ohne das erste abzugeben, gilt
// nur das zweite (das juengere) als aktiv.
$neu(15); $neu(16);
$kette(15, 'uebernahme', 500, '2026-05-01 11:00:00', 8);
$kette(16, 'uebernahme', 700, '2026-05-01 12:00:00', 8);
pruef('KRITISCH: nimmt dieselbe Person ein zweites Fahrzeug, ohne das erste abzugeben, '
    . 'gilt nur das zweite (juengere) als aktiv',
    ($x = fz_meine_aktiv($pdo, 8)) !== null && $x['id'] === 16);

// ── fz_uebernahme_feststellungen() (ENT-356/ENT-361) -- reine Funktion, keine DB ──
pruef('Ohne Vorwert (erste Uebernahme eines Fahrzeugs) und ohne Einsaetze im Fenster gibt es keine Feststellung',
    fz_uebernahme_feststellungen(50000, null, null, 7) === ['km_seither' => null, 'auffaellig' => false,
        'wiederholt' => false, 'soll_km' => null, 'soll_unvollstaendig' => false,
        'abweichung_km' => null, 'abweichend' => false]);
pruef('Ein kleiner, normaler Zuwachs ist weder auffaellig noch wiederholt',
    ($f = fz_uebernahme_feststellungen(50050, 50000, 7, 8))['km_seither'] === 50
    && $f['auffaellig'] === false && $f['wiederholt'] === false);
pruef('KRITISCH: ein Sprung ueber FZ_SPRUNG_AUFFAELLIG wird als auffaellig erkannt',
    fz_uebernahme_feststellungen(50000 + FZ_SPRUNG_AUFFAELLIG + 1, 50000, 7, 8)['auffaellig'] === true);
pruef('Ein Sprung GENAU auf der Grenze gilt noch nicht als auffaellig',
    fz_uebernahme_feststellungen(50000 + FZ_SPRUNG_AUFFAELLIG, 50000, 7, 8)['auffaellig'] === false);
pruef('KRITISCH: derselbe Stand durch dieselbe Person gilt als wiederholt',
    fz_uebernahme_feststellungen(50000, 50000, 7, 7)['wiederholt'] === true);
pruef('KRITISCH: derselbe Stand durch eine ANDERE Person gilt NICHT als wiederholt '
    . '-- ENT-340 erlaubt das ausdruecklich (Fahrzeug ohne Fahrt weitergereicht)',
    fz_uebernahme_feststellungen(50000, 50000, 7, 8)['wiederholt'] === false);
pruef('Ein sinkender Stand (fz_stand_pruefen weist ihn ohnehin ab) ist nicht "auffaellig"',
    fz_uebernahme_feststellungen(49000, 50000, 7, 8)['auffaellig'] === false);

// ── fz_uebernahme_feststellungen(): "abweichend"/"soll_km" (ENT-361) ──────
// 70 km erwartet (5 Einsaetze mit weg_km, komplett), 68 km gefahren -- innerhalb
// der Toleranz.
$f3 = fz_uebernahme_feststellungen(50068, 50000, 7, 8, 1, 1, 70.0);
pruef('Eine kleine Abweichung innerhalb der Toleranz (FZ_ABWEICHUNG_TOLERANZ_KM) ist nicht "abweichend"',
    $f3['soll_km'] === 70.0 && $f3['abweichung_km'] === -2.0 && $f3['abweichend'] === false);

// 70 km erwartet, 100 km gefahren -- ueber der Toleranz (das Beispiel des
// Projektinhabers selbst).
$f4 = fz_uebernahme_feststellungen(50100, 50000, 7, 8, 1, 1, 70.0);
pruef('KRITISCH: eine Abweichung ueber der Toleranz wird erkannt (Beispiel: 70 erwartet, 100 gefahren)',
    $f4['abweichung_km'] === 30.0 && $f4['abweichend'] === true);

// Genau auf der Toleranzgrenze zaehlt noch nicht als abweichend (dieselbe
// "> nicht >=" Konvention wie bei "auffaellig").
$f5 = fz_uebernahme_feststellungen(50000 + FZ_ABWEICHUNG_TOLERANZ_KM, 50000, 7, 8, 1, 1, 0.0);
pruef('Eine Abweichung GENAU auf der Toleranzgrenze gilt noch nicht als abweichend',
    $f5['abweichend'] === false);

// Ohne jeden Einsatz im Fenster gibt es nichts zu vergleichen -- weder
// abweichend noch unvollstaendig, einfach kein Vergleichswert.
$f6 = fz_uebernahme_feststellungen(50999, 50000, 7, 8, 0, 0, null);
pruef('KRITISCH: ohne Einsaetze im Fenster gibt es keine Soll-Distanz und keine Abweichungs-Feststellung',
    $f6['soll_km'] === null && $f6['abweichend'] === false && $f6['soll_unvollstaendig'] === false);

// Fehlt bei MINDESTENS EINEM Einsatz im Fenster die Wegstrecke, ist die
// Summe unvollstaendig -- KEIN Vergleich auf Basis einer zu niedrigen Zahl.
$f7 = fz_uebernahme_feststellungen(50999, 50000, 7, 8, 3, 2, 40.0);
pruef('KRITISCH: fehlt bei einem Einsatz im Fenster die Wegstrecke, gilt die Soll-Distanz als '
    . 'unvollstaendig -- kein stiller Vergleich gegen eine zu niedrige Zahl',
    $f7['soll_unvollstaendig'] === true && $f7['soll_km'] === null && $f7['abweichend'] === false);

// ── FZ_UEBERNAHME_LISTE_SQL: "soll_*" (ENT-361) -- echte Ausfuehrung ──────
// Zwei Einsaetze mit weg_km=15 (Hin+Rueck macht das Fenster 07:00-13:00 aus,
// vor der zweiten Uebernahme) -- Soll = 2*15 + 2*15 = 60 km, gefahren 61200-
// 61100 = 100 km -- eine echte Abweichung ueber die volle Kette gerechnet.
$neu(19);
$kette(19, 'uebernahme', 61100, '2026-07-01 06:00:00', 7);
$pdo->exec("INSERT INTO einsaetze (id, datum, von, weg_km) VALUES (101, '2026-07-01', '07:00:00', 15.0)");
$pdo->exec("INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage) VALUES (101, 7, 'zugesagt')");
$pdo->exec("INSERT INTO einsaetze (id, datum, von, weg_km) VALUES (102, '2026-07-01', '11:00:00', 15.0)");
$pdo->exec("INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage) VALUES (102, 7, 'zugesagt')");
// Ein DRITTER Einsatz existiert, gehoert aber einer ANDEREN Person -- darf
// die Summe fuer Mitarbeiter 7 nicht mitzaehlen.
$pdo->exec("INSERT INTO einsaetze (id, datum, von, weg_km) VALUES (103, '2026-07-01', '09:00:00', 999.0)");
$pdo->exec("INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage) VALUES (103, 8, 'zugesagt')");
// Ein VIERTER Einsatz gehoert Mitarbeiter 7, ist aber 'entfallen' -- zaehlt
// nicht mit (gleiche Ausnahme wie ENT-350).
$pdo->exec("INSERT INTO einsaetze (id, datum, von, weg_km) VALUES (104, '2026-07-01', '10:00:00', 999.0)");
$pdo->exec("INSERT INTO einsatz_zuteilung (einsatz_id, mitarbeiter_id, zusage) VALUES (104, 7, 'entfallen')");
$kette(19, 'uebernahme', 61200, '2026-07-01 14:00:00', 7);

$stmt2 = $pdo->prepare(FZ_UEBERNAHME_LISTE_SQL . ' WHERE u.fahrzeug_id = ? AND u.tacho_km = ?');
$stmt2->execute([19, 61200]);
$zeile19 = $stmt2->fetch();
pruef('KRITISCH: die Soll-Summe zaehlt nur die eigenen, nicht entfallenen Einsaetze im Fenster',
    $zeile19 !== false && (int)$zeile19['soll_einsaetze'] === 2
    && (int)$zeile19['soll_einsaetze_mit_weg_km'] === 2 && (float)$zeile19['soll_km_summe'] === 60.0);
$f8 = fz_uebernahme_feststellungen((int)$zeile19['tacho_km'], (int)$zeile19['voriger_km'],
    (int)$zeile19['voriger_mitarbeiter_id'], (int)$zeile19['eigene_mitarbeiter_id'],
    (int)$zeile19['soll_einsaetze'], (int)$zeile19['soll_einsaetze_mit_weg_km'],
    (float)$zeile19['soll_km_summe']);
pruef('KRITISCH: end-to-end (SQL + Funktion) erkennt die Kette 61100->61200 gegen Soll 60 km als abweichend',
    $f8['soll_km'] === 60.0 && $f8['km_seither'] === 100 && $f8['abweichend'] === true);

// ── FZ_UEBERNAHME_LISTE_SQL (ENT-356) -- echte Ausfuehrung gegen SQLite ────
// Dieselbe Konstante, die auch fahrzeug_uebernahme_liste.php verwendet --
// ein Nachbau wuerde nur beweisen, dass der Nachbau stimmt.
$neu(17); $neu(18);
$kette(17, 'uebernahme', 60000, '2026-06-01 07:00:00', 7);   // erste, kein Vorwert
$kette(17, 'uebernahme', 60050, '2026-06-01 12:00:00', 7);   // normaler Zuwachs
$kette(17, 'uebernahme', 60050, '2026-06-02 07:00:00', 7);   // dieselbe Person, gleicher Stand
$kette(17, 'uebernahme', 60050, '2026-06-02 12:00:00', 8);   // ANDERE Person, gleicher Stand -- erlaubt
$kette(17, 'uebernahme', 61200, '2026-06-03 07:00:00', 8);   // grosser Sprung
$kette(18, 'uebernahme', 10000, '2026-06-01 07:00:00', 7);   // anderes Fahrzeug, eigene Kette

$stmt = $pdo->prepare(FZ_UEBERNAHME_LISTE_SQL . ' WHERE u.fahrzeug_id = ? ORDER BY u.zeitpunkt ASC, u.id ASC');
$stmt->execute([17]);
$zeilen = $stmt->fetchAll();
pruef('KRITISCH: FZ_UEBERNAHME_LISTE_SQL liefert alle fuenf Zeilen dieses Fahrzeugs',
    count($zeilen) === 5);
pruef('KRITISCH: die erste Zeile hat keinen Vorwert (erste Uebernahme des Fahrzeugs)',
    $zeilen[0]['voriger_km'] === null && $zeilen[0]['voriger_mitarbeiter_id'] === null);
pruef('KRITISCH: die zweite Zeile bezieht sich auf die erste, nicht auf ein anderes Fahrzeug',
    (int)$zeilen[1]['voriger_km'] === 60000 && (int)$zeilen[1]['voriger_mitarbeiter_id'] === 7);
pruef('KRITISCH: die vierte Zeile (andere Person) bezieht den Vorwert trotzdem korrekt -- '
    . 'der Personenwechsel aendert an "voriger" nichts, nur an "wiederholt" spaeter',
    (int)$zeilen[3]['voriger_km'] === 60050 && (int)$zeilen[3]['voriger_mitarbeiter_id'] === 7);
pruef('Das zweite Fahrzeug (18) taucht in der Filterung auf Fahrzeug 17 nicht auf',
    !in_array(18, array_column($zeilen, 'fahrzeug_id')));

// Und zusammengesetzt mit fz_uebernahme_feststellungen(), wie der Endpunkt es tut:
$f1 = fz_uebernahme_feststellungen((int)$zeilen[2]['tacho_km'],
    $zeilen[2]['voriger_km'] !== null ? (int)$zeilen[2]['voriger_km'] : null,
    $zeilen[2]['voriger_mitarbeiter_id'] !== null ? (int)$zeilen[2]['voriger_mitarbeiter_id'] : null,
    (int)$zeilen[2]['eigene_mitarbeiter_id']);
pruef('KRITISCH: Zeile 3 (dieselbe Person, gleicher Stand am Folgetag) wird end-to-end als wiederholt erkannt',
    $f1['wiederholt'] === true);
$f2 = fz_uebernahme_feststellungen((int)$zeilen[4]['tacho_km'],
    $zeilen[4]['voriger_km'] !== null ? (int)$zeilen[4]['voriger_km'] : null,
    $zeilen[4]['voriger_mitarbeiter_id'] !== null ? (int)$zeilen[4]['voriger_mitarbeiter_id'] : null,
    (int)$zeilen[4]['eigene_mitarbeiter_id']);
pruef('KRITISCH: Zeile 5 (Sprung von 60050 auf 61200) wird end-to-end als auffaellig erkannt',
    $f2['auffaellig'] === true && $f2['km_seither'] === 1150);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { foreach ($bad as $b3) { echo "  X $b3\n"; } exit(1); }
echo "Keine Beanstandung.\n";
