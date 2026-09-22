<?php
// Die Einladungsfunktionen der Betreiber-Ebene (ENT-663) wirklich
// AUSFUEHREN -- nicht ihren Quelltext lesen.
//
// Warum diese Datei: Drei Aussagen des Einladungswegs sind Entscheidungen
// und keine Formulierungen. Eine Textsuche wuerde jede davon uebersehen,
// sobald sich der Wortlaut aendert und die Sache verschwindet:
//
//   1. EIN ABGELAUFENER LINK IST EIN UNGUELTIGER LINK. Die Frist wird in
//      der Datenbank verglichen, nicht in PHP -- sonst entschiede die Uhr
//      des Webservers, und bei getrennten Datenbanken (OP-518) sind das
//      zwei verschiedene Uhren.
//   2. DER ROHWERT STEHT NIRGENDS. In der Tabelle liegt ausschliesslich der
//      SHA-256-Abdruck (ENT-501). Wer den Abdruck kennt, kommt damit nicht
//      hinein -- geprueft wird das hier ausdruecklich.
//   3. "EINGELADEN" IST EIN EIGENER ZUSTAND, weder aktiv noch stillgelegt.
//
// NOW() FUER SQLITE: Die Abfrage in be_einladung_konto() vergleicht die
// Frist mit NOW(), das SQLite nicht kennt. Statt den Produktivcode fuer die
// Pruefung zu verbiegen, wird die Funktion hier nachgereicht -- so laeuft
// genau die Abfrage, die spaeter auch in MySQL laeuft. Das Format
// 'YYYY-MM-DD HH:MM:SS' vergleicht sich als Zeichenkette in derselben
// Reihenfolge wie als Zeitpunkt; darum traegt der Vergleich.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $s = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
    $s->execute([$t]);
    return (bool)$s->fetchColumn();
}
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
    if (!hat_tabelle($pdo, $tabelle)) { return false; }
    foreach ($pdo->query('PRAGMA table_info(' . $tabelle . ')')->fetchAll() as $z) {
        if (($z['name'] ?? '') === $spalte) { return true; }
    }
    return false;
}

require __DIR__ . '/../backend/betreiber.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

$db = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));

// ── Ohne Tabelle: nichts geht, aber nichts bricht ─────────────────────
//
// Der Zustand zwischen Deploy und Einrichtungslauf. Ein Endpunkt, der hier
// mit einem SQL-Fehler abbricht, macht aus einer fehlenden Tabelle einen
// unbenutzbaren Bereich.
$pruef('KRITISCH: ohne Tabelle meldet die Auskunft "keine Einladung", statt zu brechen',
    be_einladung_tabelle_da($db) === false
    && be_einladung_offen($db, 1) === false
    && be_einladung_konto($db, 'irgendwas') === null);

$db->exec("CREATE TABLE betreiber (id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, anrede TEXT NOT NULL DEFAULT '', vorname TEXT NOT NULL DEFAULT '',
  nachname TEXT NOT NULL DEFAULT '', email TEXT NOT NULL, passwort_hash TEXT NOT NULL,
  aktiv INTEGER NOT NULL DEFAULT 1)");
$db->exec("CREATE TABLE betreiber_einladung (betreiber_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL, gueltig_bis TEXT NOT NULL,
  erstellt_am TEXT NOT NULL DEFAULT '2026-01-01 00:00:00', erstellt_von INTEGER NOT NULL)");

// Drei Konten: eingeladen, eingeladen-aber-abgelaufen, gewoehnlich.
$db->exec("INSERT INTO betreiber (id, name, email, passwort_hash, aktiv) VALUES
  (1, 'Frisch Eingeladen', 'frisch@example.org', '', 0),
  (2, 'Zu Spaet',          'spaet@example.org',  '', 0),
  (3, 'Laengst Drin',      'drin@example.org',   '\$2y\$12\$abcdefghijklmnopqrstuv', 1)");

$tokenGut  = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888';
$tokenAlt  = '9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff';
$in = $db->prepare('INSERT INTO betreiber_einladung (betreiber_id, token, gueltig_bis, erstellt_von)
                    VALUES (?, ?, ?, 3)');
// Kein festes Datum nahe beim heutigen Tag (CLAUDE.md, test_datumsfest.mjs):
// beide Fristen werden aus der aktuellen Zeit gerechnet.
$in->execute([1, hash('sha256', $tokenGut), date('Y-m-d H:i:s', time() + 3600)]);
$in->execute([2, hash('sha256', $tokenAlt), date('Y-m-d H:i:s', time() - 3600)]);

// ── 1. Der gueltige Link findet sein Konto ────────────────────────────
$treffer = be_einladung_konto($db, $tokenGut);
$pruef('ein gueltiger Link findet sein Konto',
    $treffer !== null && (int)$treffer['id'] === 1);
$pruef('und liefert Name und Adresse, damit die Seite zeigen kann, wofuer das Passwort gilt',
    $treffer !== null && $treffer['name'] === 'Frisch Eingeladen'
    && $treffer['email'] === 'frisch@example.org');

// Gegenprobe zur Frist: Dasselbe Konto, derselbe Token, nur die Frist
// zurueckgestellt -- und der Treffer muss verschwinden. Ohne diese Probe
// bestuende die Pruefung oben auch dann, wenn die Frist gar nicht
// verglichen wuerde.
$db->prepare('UPDATE betreiber_einladung SET gueltig_bis = ? WHERE betreiber_id = 1')
   ->execute([date('Y-m-d H:i:s', time() - 60)]);
$pruef('KRITISCH: GEGENPROBE — derselbe Link gilt nicht mehr, sobald die Frist zurueckliegt',
    be_einladung_konto($db, $tokenGut) === null);
$db->prepare('UPDATE betreiber_einladung SET gueltig_bis = ? WHERE betreiber_id = 1')
   ->execute([date('Y-m-d H:i:s', time() + 3600)]);
$pruef('… und gilt wieder, sobald sie in der Zukunft liegt',
    be_einladung_konto($db, $tokenGut) !== null);

// ── 2. Abgelaufen, erfunden und leer sind DASSELBE ────────────────────
//
// Nicht aus Bequemlichkeit: "Dieser Link ist abgelaufen" bestaetigte, dass
// es ihn einmal gab -- und damit, dass es dieses Konto gibt.
$pruef('KRITISCH: ein abgelaufener Link gibt dasselbe wie ein erfundener: nichts',
    be_einladung_konto($db, $tokenAlt) === null
    && be_einladung_konto($db, 'gibtesnicht') === null
    && be_einladung_konto($db, '') === null);

// ── 3. Der Abdruck ist kein Schluessel ────────────────────────────────
//
// Die wichtigste Pruefung dieser Datei. Wer die Tabelle lesen kann -- ein
// Datenbank-Backup, ein Dump, ein Blick ueber die Schulter -- haelt den
// Abdruck in der Hand. Er darf damit nicht hineinkommen.
$abdruck = hash('sha256', $tokenGut);
$pruef('KRITISCH: der Abdruck selbst oeffnet die Einladung NICHT',
    be_einladung_konto($db, $abdruck) === null);
$roh = $db->query('SELECT token FROM betreiber_einladung WHERE betreiber_id = 1')->fetchColumn();
$pruef('KRITISCH: in der Tabelle steht der Abdruck, nie der Rohwert',
    $roh === $abdruck && $roh !== $tokenGut);
$pruef('… und der Abdruck hat die Laenge eines SHA-256 in Hexdarstellung',
    strlen((string)$roh) === 64);

// ── 4. "Eingeladen" ist ein eigener Zustand ───────────────────────────
$pruef('ein eingeladenes Konto meldet eine offene Einladung',
    be_einladung_offen($db, 1) === true);
$pruef('KRITISCH: auch ein ABGELAUFENES gilt als eingeladen, nicht als gewoehnlich',
    be_einladung_offen($db, 2) === true);
$pruef('ein eingeloestes Konto hat keine offene Einladung',
    be_einladung_offen($db, 3) === false);

// Der Unterschied, auf den es ankommt: Konto 2 hat einen abgelaufenen Link.
// Es ist damit NICHT wieder ein gewoehnliches, stillgelegtes Konto --
// sonst liesse es sich von Hand freischalten und stuende danach aktiv da,
// ohne Passwort.
$pruef('KRITISCH: ein abgelaufener Link macht das Konto nicht zu einem gewoehnlichen',
    be_einladung_offen($db, 2) === true && be_einladung_konto($db, $tokenAlt) === null);

// ── 5. Das Einloesen beendet die Einladung ────────────────────────────
//
// Nachgestellt wie in betreiber_einladung_einloesen.php. Der Punkt ist die
// Gegenprobe danach: Bliebe die Zeile stehen, setzte derselbe Link das
// Passwort ein zweites Mal -- und jeder, der die Nachricht noch im Postfach
// hat, koennte das Konto jederzeit uebernehmen.
$db->prepare('UPDATE betreiber SET passwort_hash = ?, aktiv = 1 WHERE id = 1')
   ->execute(['$2y$12$neuerhashneuerhashneuer']);
$db->prepare('DELETE FROM betreiber_einladung WHERE betreiber_id = ?')->execute([1]);
$pruef('KRITISCH: GEGENPROBE — nach dem Einloesen traegt derselbe Link nicht mehr',
    be_einladung_konto($db, $tokenGut) === null);
$pruef('… und das Konto gilt nicht mehr als eingeladen',
    be_einladung_offen($db, 1) === false);

// ── 6. Die Frist steht an einer Stelle ────────────────────────────────
//
// Keine Pruefung auf die Zahl selbst -- die darf sich aendern. Geprueft
// wird, dass sie ueberhaupt eine benannte Groesse ist und in einem Bereich
// liegt, der zur Sache passt: kuerzer als eine Stunde waere fuer eine
// unangekuendigte Nachricht unbrauchbar, laenger als eine Woche macht aus
// dem Link einen dauerhaft offenen Zugang.
$pruef('die Gueltigkeit ist eine benannte Groesse in vertretbarer Hoehe',
    defined('BE_EINLADUNG_STUNDEN')
    && BE_EINLADUNG_STUNDEN >= 1 && BE_EINLADUNG_STUNDEN <= 168);

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
