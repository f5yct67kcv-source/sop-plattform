<?php
declare(strict_types=1);
// Echte Ausfuehrung der Uebernahme-Logik (ENT-335) gegen eine wirkliche
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
$pdo->exec('CREATE TABLE fahrzeuge (id INTEGER PRIMARY KEY, kennzeichen TEXT, status TEXT,
            tacho_km INT NULL, tacho_am TEXT NULL, qr_kennung TEXT NULL)');
$pdo->exec('CREATE TABLE fahrzeug_uebernahme (id INTEGER PRIMARY KEY, art TEXT, fahrzeug_id INT,
            mitarbeiter_id INT, einsatz_id INT NULL, zeitpunkt TEXT, tacho_km INT NULL,
            quelle TEXT, bemerkung TEXT NULL)');
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, vorname TEXT, nachname TEXT, name TEXT)');
// Erfundene Namen und Kontrollschilder mit hoher Nummer -- kein echtes
// Fahrzeug, keine echte Person.
$pdo->exec("INSERT INTO mitarbeiter VALUES (7, 'Vorname', 'Nachname', 'vn')");

$neu = function (int $id) use ($pdo) {
    $pdo->prepare("INSERT INTO fahrzeuge (id, kennzeichen, status) VALUES (?, ?, 'aktiv')")
        ->execute([$id, 'SO 9990' . $id]);
};
$stamm = function (int $id, ?int $km, ?string $am) use ($pdo) {
    $pdo->prepare('UPDATE fahrzeuge SET tacho_km = ?, tacho_am = ? WHERE id = ?')->execute([$km, $am, $id]);
};
$kette = function (int $fz, string $art, ?int $km, string $zeit) use ($pdo) {
    $pdo->prepare("INSERT INTO fahrzeug_uebernahme (art, fahrzeug_id, mitarbeiter_id, zeitpunkt, tacho_km, quelle)
                   VALUES (?, ?, 7, ?, ?, 'qr')")->execute([$art, $fz, $zeit, $km]);
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

echo $ok . " Pruefungen bestanden\n";
if ($bad) { foreach ($bad as $b3) { echo "  X $b3\n"; } exit(1); }
echo "Keine Beanstandung.\n";
