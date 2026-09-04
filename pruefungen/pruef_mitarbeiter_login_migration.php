<?php
declare(strict_types=1);
// Echte Ausfuehrung der Umstellung bestehender Login-Namen (ENT-381) gegen
// eine wirkliche Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster
// wie pruef_mitarbeiter_login.php und pruef_dienstfahrzeug.php.
//
// WARUM HIER UND NICHT NUR IN EINER BROWSER-SUITE: Das ist ein harter
// Schnitt an echten Zugangsdaten -- wer danach falsch umbenannt wird oder
// dessen Sitzung faelschlich stehen bleibt, ist ein Sicherheitsproblem, kein
// Kosmetikfehler. Das wird ausgefuehrt, nicht nachgebaut.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// logbuch.php ruft hat_tabelle() aus db.php auf -- hier durch eine Fassung
// ersetzt, die die SQLite-Tabelle tatsaechlich abfragt, damit die Pruefung
// auch das ECHTE Schreiben ins Logbuch mitprueft, nicht nur die
// Umbenennung selbst.
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $r = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name=" . $pdo->quote($t));
    return (bool)$r->fetch();
}

require __DIR__ . '/../backend/mitarbeiter.php';

function neueDb(): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                                   PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, vorname TEXT, nachname TEXT,
                personalnummer TEXT, aktiv INTEGER DEFAULT 1, erstellt_am TEXT)');
    $pdo->exec('CREATE TABLE sessions (token TEXT PRIMARY KEY, mitarbeiter_id INT)');
    $pdo->exec('CREATE TABLE aenderungslog (id INTEGER PRIMARY KEY, zeitpunkt TEXT, akteur_id INT,
                akteur_name TEXT, bereich TEXT, objekt_id INT, feld TEXT, wert_alt TEXT, wert_neu TEXT,
                werte_verborgen INT)');
    return $pdo;
}

$akteur = ['id' => 99, 'name' => 'verwaltung-test'];

// ── Der Plan: Reihenfolge, Namensgleichheit, Uebersprungene ───────────────
{
    $pdo = neueDb();
    // Genau das Beispiel des Projektinhabers, unter dem alten, frei
    // getippten Namen ohne Punkt.
    $pdo->exec("INSERT INTO mitarbeiter VALUES (1, 'adrianvonarb', 'Adrian', 'von Arb', 'P-001', 1, '2025-01-05 10:00:00')");
    // Zwei Namensgleiche -- id 2 war zuerst da, bekommt die saubere Form.
    // Eine davon INAKTIV: genau der Fall, der beim ersten echten Einsatz
    // dieser Funktion auffiel -- eine Karteileiche, die in der normalen
    // Liste (mitarbeiter_list.php, WHERE aktiv = 1) gar nicht auftaucht,
    // hier aber trotzdem umbenannt wird, weil sie noch einen Login-Namen
    // vergeben hat, der sonst niemandem sonst weggenommen werden darf.
    $pdo->exec("INSERT INTO mitarbeiter VALUES (2, 'mm-alt-a', 'Max', 'Muster', 'P-002', 0, '2024-03-01 09:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (3, 'mm-alt-b', 'Max', 'Muster', 'P-003', 1, '2025-06-01 09:00:00')");
    // KRITISCH: Ein Konto ohne Nachname (Systemkonto, unvollstaendige
    // Altdaten) traegt zufaellig genau den Namen, den Max Muster durch die
    // Vorreservierung eigentlich zuerst haette -- die Vorreservierung muss
    // verhindern, dass Max Muster (id 2, unten weiter oben in der Tabelle)
    // ihm den Namen wegnimmt.
    $pdo->exec("INSERT INTO mitarbeiter VALUES (4, 'max.muster', 'Systemkonto', '', NULL, 1, '2024-01-01 00:00:00')");
    // Bereits im neuen Muster -- soll als "unveraendert" durchgehen.
    $pdo->exec("INSERT INTO mitarbeiter VALUES (5, 'erika.muster', 'Erika', 'Muster', 'P-005', 1, '2025-02-02 08:00:00')");

    $plan = ma_login_migrationsplan($pdo);
    $von = fn($id) => current(array_filter($plan, fn($p) => $p['id'] === $id));

    pruef('Genau 5 Zeilen im Plan, eine je Person', count($plan) === 5);
    pruef('KRITISCH: "Adrian von Arb" wird zu "adrian.vonarb"',
        $von(1)['neu'] === 'adrian.vonarb' && $von(1)['status'] === 'umbenannt');
    // "max.muster" selbst ist durch das Systemkonto (id 4) fest belegt --
    // beide Max Muster muessen sich also schon mit einer Nummer begnuegen,
    // in der Reihenfolge ihres Anlegens.
    pruef('KRITISCH: das Systemkonto ohne Nachname wird uebersprungen, nicht umbenannt',
        $von(4)['neu'] === null && $von(4)['status'] === 'uebersprungen');
    pruef('KRITISCH: "max.muster" bleibt dem Systemkonto vorbehalten -- das zuerst angelegte Max Muster bekommt "max.muster2"',
        $von(2)['neu'] === 'max.muster2' && $von(2)['status'] === 'umbenannt');
    pruef('KRITISCH: das zweite Max Muster bekommt die naechste freie Nummer, nicht dieselbe wie das erste',
        $von(3)['neu'] === 'max.muster3' && $von(3)['status'] === 'umbenannt');
    pruef('Bereits passender Name gilt als unveraendert, nicht als umbenannt',
        $von(5)['neu'] === 'erika.muster' && $von(5)['status'] === 'unveraendert');

    // ── Personalnummer, Status und Anlegedatum kommen mit (ENT-383) ──────
    pruef('Die Personalnummer kommt unveraendert mit', $von(1)['personalnummer'] === 'P-001');
    pruef('Eine fehlende Personalnummer kommt als null mit, nicht als leerer Text',
        $von(4)['personalnummer'] === null);
    pruef('KRITISCH: der Status unterscheidet die beiden gleichnamigen Konten -- eines ist inaktiv',
        $von(2)['aktiv'] === false && $von(3)['aktiv'] === true);
    pruef('Das Anlegedatum kommt mit -- daran erkennt man, welches der beiden das aeltere Konto ist',
        $von(2)['erstellt_am'] === '2024-03-01 09:00:00' && $von(3)['erstellt_am'] === '2025-06-01 09:00:00');
}

// ── Die Ausfuehrung: schreibt wirklich, loescht nur die richtigen Sitzungen,
//    protokolliert nur echte Aenderungen ───────────────────────────────────
{
    $pdo = neueDb();
    $pdo->exec("INSERT INTO mitarbeiter VALUES (1, 'adrianvonarb', 'Adrian', 'von Arb', 'P-001', 1, '2025-01-05 10:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (4, 'max.muster', 'Systemkonto', '', NULL, 1, '2024-01-01 00:00:00')");
    $pdo->exec("INSERT INTO mitarbeiter VALUES (5, 'erika.muster', 'Erika', 'Muster', 'P-005', 1, '2025-02-02 08:00:00')");
    // Je eine Sitzung fuer alle drei -- nur die von id 1 (wird umbenannt)
    // darf danach weg sein.
    $pdo->exec("INSERT INTO sessions VALUES ('tok-1', 1)");
    $pdo->exec("INSERT INTO sessions VALUES ('tok-4', 4)");
    $pdo->exec("INSERT INTO sessions VALUES ('tok-5', 5)");

    ma_login_migrieren($pdo, $akteur);

    $name = fn($id) => $pdo->query("SELECT name FROM mitarbeiter WHERE id=$id")->fetch()['name'];
    pruef('KRITISCH: der Name steht in der Datenbank wirklich um',
        $name(1) === 'adrian.vonarb');
    pruef('Das uebersprungene Konto behaelt seinen Namen', $name(4) === 'max.muster');
    pruef('Das bereits passende Konto behaelt seinen Namen', $name(5) === 'erika.muster');

    $sitzungDa = fn($tok) => (bool)$pdo->query("SELECT 1 FROM sessions WHERE token='$tok'")->fetch();
    pruef('KRITISCH: die Sitzung des umbenannten Kontos ist beendet -- der alte Name gilt nicht mehr',
        !$sitzungDa('tok-1'));
    pruef('KRITISCH: die Sitzung eines UNVERAENDERTEN Kontos bleibt unberuehrt (id 4)',
        $sitzungDa('tok-4'));
    pruef('KRITISCH: die Sitzung eines bereits passenden Kontos bleibt unberuehrt (id 5)',
        $sitzungDa('tok-5'));

    $log = $pdo->query('SELECT * FROM aenderungslog')->fetchAll();
    pruef('KRITISCH: genau EIN Logbuch-Eintrag -- nur fuer die tatsaechliche Umbenennung',
        count($log) === 1);
    pruef('Der Eintrag nennt alten und neuen Namen und wen es betraf',
        count($log) === 1 && (int)$log[0]['objekt_id'] === 1
        && $log[0]['wert_alt'] === 'adrianvonarb' && $log[0]['wert_neu'] === 'adrian.vonarb'
        && $log[0]['akteur_name'] === 'verwaltung-test');

    // ── Idempotenz: ein zweiter Lauf veraendert nichts mehr ───────────────
    $plan2 = ma_login_migrationsplan($pdo);
    pruef('KRITISCH: ein zweiter Lauf findet nichts mehr zu tun',
        !array_filter($plan2, fn($p) => $p['status'] === 'umbenannt'));
}

echo "$ok Pruefungen bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit($bad ? 1 : 0);
