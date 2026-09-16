<?php
declare(strict_types=1);
// Echte Ausfuehrung der Austritts-Erinnerung (ENT-598) gegen eine wirkliche
// Datenbank (SQLite im Arbeitsspeicher) -- gleiches Muster wie
// pruef_mitarbeiter_login.php und pruef_rechte.php.
//
// WORUM ES GEHT: Deaktivieren nach einem Austritt geschieht heute nur von
// Hand. Vergisst das jemand im Tagesgeschaeft, bleibt ein Zugang bestehen,
// obwohl die Person nicht mehr im Betrieb ist. Geprueft wird hier sowohl
// das Finden solcher Konten als auch die taegliche Selbstbegrenzung der
// Erinnerung (kein Spam bei jedem Lauf des Zeitgebers). Das eigentliche
// Verschicken (Empfaenger suchen, Mail zusammensetzen, senden) steht in
// push_versand.php und wird dort nur strukturell geprueft (test_php.mjs) --
// smtp_senden() ist Netzwerk, kein PHP-Unit-Test.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// hat_tabelle() (db.php) fragt information_schema.TABLES ab -- MySQL-Syntax,
// die SQLite nicht kennt. Gleicher Stub wie in pruef_logbuch.php: VOR dem
// Einbinden definiert, das echte db.php uebernimmt es dank function_exists()
// nicht mehr. Die Tabelle wird in diesem Lauf immer selbst angelegt, darum
// immer true.
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return true; }

require __DIR__ . '/../backend/mitarbeiter.php';
require __DIR__ . '/../backend/rechte.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec(
    'CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, vorname TEXT, nachname TEXT,
     email TEXT, aktiv INTEGER NOT NULL DEFAULT 1, austritt TEXT, austritt_erinnerung_am TEXT)'
);
$pdo->exec('CREATE TABLE mitarbeiter_rollen (mitarbeiter_id INTEGER, rolle TEXT)');

$heute    = date('Y-m-d');
$gestern  = date('Y-m-d', strtotime('-1 day'));
$morgen   = date('Y-m-d', strtotime('+1 day'));
$vorMonat = date('Y-m-d', strtotime('-40 days'));

// ══════════ ma_ausgetreten_aber_aktiv() ══════════════════════════════════
$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname, email, aktiv, austritt)
            VALUES (1, 'mueller.hans', 'Hans', 'Müller', 'hans@example.ch', 1, '$vorMonat')");
pruef('KRITISCH: ein aktives Konto mit vergangenem Austritt wird gefunden',
    count(ma_ausgetreten_aber_aktiv($pdo)) === 1);

$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname, email, aktiv, austritt)
            VALUES (2, 'zweitfall', 'X', 'Y', 'x@example.ch', 0, '$vorMonat')");
pruef('KRITISCH: ein bereits deaktiviertes Konto wird NICHT gemeldet',
    !in_array(2, array_column(ma_ausgetreten_aber_aktiv($pdo), 'id'), true));

$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname, email, aktiv, austritt)
            VALUES (3, 'drittfall', 'A', 'B', 'a@example.ch', 1, '$morgen')");
pruef('KRITISCH: ein Austritt in der Zukunft wird NICHT gemeldet',
    !in_array(3, array_column(ma_ausgetreten_aber_aktiv($pdo), 'id'), true));

$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname, email, aktiv, austritt)
            VALUES (4, 'viertfall', 'C', 'D', 'c@example.ch', 1, NULL)");
pruef('Ohne Austrittsdatum wird nichts gemeldet',
    !in_array(4, array_column(ma_ausgetreten_aber_aktiv($pdo), 'id'), true));

// ══════════ rechte_mitarbeiter_mit_recht() ═══════════════════════════════
// Rolle 'personal' (Personaladministration) traegt 'personal_schreiben'
// (rechte.php, system_rollen()) -- dieselbe Rolle, die der Projektinhaber
// als Empfaengerkreis der Erinnerung bestimmt hat.
$pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (1, 'personal')");
$empf = rechte_mitarbeiter_mit_recht($pdo, 'personal_schreiben');
pruef('KRITISCH: wer die Rolle Personaladministration traegt, gilt als Empfaenger',
    count($empf) === 1 && (int)$empf[0]['id'] === 1);

$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname, email, aktiv)
            VALUES (5, 'fuenftfall', 'E', 'F', 'e@example.ch', 1)");
$pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (5, 'waechter')");
$empf2 = rechte_mitarbeiter_mit_recht($pdo, 'personal_schreiben');
pruef('KRITISCH: eine Rolle ohne dieses Recht zaehlt nicht als Empfaenger',
    !in_array(5, array_column($empf2, 'id'), true));

$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname, email, aktiv)
            VALUES (6, 'sechstfall', 'G', 'H', '', 1)");
$pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (6, 'personal')");
$empf3 = rechte_mitarbeiter_mit_recht($pdo, 'personal_schreiben');
pruef('KRITISCH: eine berechtigte Person ohne E-Mail-Adresse wird uebersprungen',
    !in_array(6, array_column($empf3, 'id'), true));

// ══════════ ma_austritt_erinnerung_faellige(): Anspruch, kein Spam ═══════
$vorher = $pdo->query('SELECT austritt_erinnerung_am FROM mitarbeiter WHERE id = 1')->fetchColumn();
pruef('Vor der ersten Erinnerung ist austritt_erinnerung_am leer', $vorher === null);

$faellig1 = ma_austritt_erinnerung_faellige($pdo);
pruef('KRITISCH: der Lauf meldet genau die eine faellige Person',
    count($faellig1) === 1 && (int)$faellig1[0]['id'] === 1);

$nachher = $pdo->query('SELECT austritt_erinnerung_am FROM mitarbeiter WHERE id = 1')->fetchColumn();
pruef('KRITISCH: austritt_erinnerung_am steht danach auf heute',
    $nachher === $heute);

// Gegenprobe im selben Sinn wie sv_erinnerung_merken() in supportvorgang.php:
// ein zweiter Lauf am selben Tag darf dieselbe Person NICHT nochmals als
// faellig zaehlen -- der Zeitgeber laeuft mehrmals stuendlich.
$faellig2 = ma_austritt_erinnerung_faellige($pdo);
pruef('KRITISCH: ein zweiter Lauf am selben Tag meldet niemanden mehr -- kein taeglicher Spam',
    count($faellig2) === 0);

// Ein neuer Tag setzt die Sperre zurueck -- die Erinnerung hoert nicht auf,
// nur weil sie einmal verschickt wurde, solange das Konto weiterhin aktiv
// bleibt.
$pdo->exec("UPDATE mitarbeiter SET austritt_erinnerung_am = '$gestern' WHERE id = 1");
$faellig3 = ma_austritt_erinnerung_faellige($pdo);
pruef('KRITISCH: an einem neuen Tag ist dieselbe Person wieder faellig',
    count($faellig3) === 1);

// Wird das Konto zwischenzeitlich korrekt deaktiviert, verschwindet es aus
// der Erinnerung -- die Deaktivierung selbst ist der eigentliche Ausweg,
// nicht die Mail.
$pdo->exec("UPDATE mitarbeiter SET aktiv = 0, austritt_erinnerung_am = '$gestern' WHERE id = 1");
$faellig4 = ma_austritt_erinnerung_faellige($pdo);
pruef('KRITISCH: ein inzwischen deaktiviertes Konto faellt aus der Erinnerung',
    count($faellig4) === 0);

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
