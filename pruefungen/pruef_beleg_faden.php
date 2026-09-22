<?php
// Der Faden am Beleg (ENT-677) wirklich AUSFUEHREN -- nicht seinen
// Quelltext lesen.
//
// Warum diese Datei: Vier Aussagen des Rueckkanals sind Entscheidungen und
// keine Formulierungen. Eine Textsuche wuerde jede davon uebersehen, sobald
// sich die Schreibweise aendert und die Sache verschwindet:
//
//   1. OHNE TABELLE BRICHT NICHTS. Zwischen Deploy und Einrichtungslauf
//      steht sie nicht. Ein Beleg muss sich trotzdem ansehen lassen -- und
//      "nicht eingerichtet" darf nicht wie "noch nichts geschrieben"
//      aussehen, sonst boete die Oberflaeche ein Feld an, das nichts
//      entgegennimmt.
//   2. OHNE NAMEN WIRD DIE HERKUNFT GENANNT, kein Absender behauptet. Die
//      oeffentliche Seite kennt nur den Token, und der Link kann
//      weitergeleitet worden sein.
//   3. EIN ZU LANGER TEXT WIRD GEKUERZT, nicht abgewiesen: Ein Versehen
//      darf den Empfaenger nicht seinen ganzen Absatz kosten.
//   4. DIE BEIDEN MAILS TRAGEN DIE GEMEINSAME GESTALTUNG (ENT-674) und den
//      Link zurueck an den Beleg.
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
require __DIR__ . '/../backend/belege.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

$db = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));

// ── 1. Ohne Tabelle bricht nichts ─────────────────────────────────────
$pruef('KRITISCH: ohne Tabelle ist der Faden leer, statt zu brechen',
    be_beleg_nachricht_tabelle_da($db) === false
    && be_beleg_nachrichten($db, 1) === []
    && be_beleg_nachricht_anlegen($db, 1, 'kunde', '', 'Text') === 0);

$db->exec("CREATE TABLE be_beleg_nachricht (id INTEGER PRIMARY KEY AUTOINCREMENT,
  beleg_id INTEGER NOT NULL, seite TEXT NOT NULL, autor TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL, erstellt_am TEXT NOT NULL)");

$pruef('… und mit Tabelle meldet dieselbe Auskunft, dass es sie gibt',
    be_beleg_nachricht_tabelle_da($db) === true);

// ── 2. Schreiben und lesen ────────────────────────────────────────────
$n1 = be_beleg_nachricht_anlegen($db, 7, 'kunde', '', 'Bitte zwei Lizenzen statt einer.');
$n2 = be_beleg_nachricht_anlegen($db, 7, 'betreiber', 'A. Muster', 'Gerne, wir passen das an.');
$n3 = be_beleg_nachricht_anlegen($db, 7, 'kunde', 'R. Beispiel', 'Danke.');
$pruef('KRITISCH: Nachrichten werden abgelegt', $n1 > 0 && $n2 > 0 && $n3 > 0);

$faden = be_beleg_nachrichten($db, 7);
$pruef('KRITISCH: der Faden gehoert dem Beleg und sonst niemandem',
    count($faden) === 3 && be_beleg_nachrichten($db, 8) === []);
$pruef('KRITISCH: er liest sich von alt nach neu, wie ein Gespraech',
    (int)$faden[0]['id'] === $n1 && (int)$faden[2]['id'] === $n3);
$pruef('KRITISCH: beide Seiten sind unterscheidbar',
    $faden[0]['seite'] === 'kunde' && $faden[1]['seite'] === 'betreiber');

// Leeres und Unsinniges wird gar nicht erst abgelegt.
$pruef('KRITISCH: eine leere Nachricht entsteht nicht',
    be_beleg_nachricht_anlegen($db, 7, 'kunde', '', '   ') === 0
    && count(be_beleg_nachrichten($db, 7)) === 3);
$pruef('KRITISCH: eine erfundene Seite entsteht nicht',
    be_beleg_nachricht_anlegen($db, 7, 'irgendwer', '', 'Text') === 0
    && count(be_beleg_nachrichten($db, 7)) === 3);

// ── 3. Ein zu langer Text wird gekuerzt ───────────────────────────────
be_beleg_nachricht_anlegen($db, 9, 'kunde', str_repeat('N', 300), str_repeat('x', 9000));
$lang = be_beleg_nachrichten($db, 9)[0];
$pruef('KRITISCH: ein zu langer Text wird gekuerzt, nicht abgewiesen',
    mb_strlen((string)$lang['text']) === BE_NACHRICHT_ZEICHEN);
$pruef('… und ein zu langer Name ebenso',
    mb_strlen((string)$lang['autor']) === 120);

// ── 4. Ohne Namen wird die Herkunft genannt ───────────────────────────
//
// Nicht "Unbekannt" und nicht leer: Was feststeht, ist, dass die Nachricht
// ueber den Link zu genau diesem Beleg kam.
$ohne = be_beleg_nachricht_absender(['seite' => 'kunde', 'autor' => '']);
$mit  = be_beleg_nachricht_absender(['seite' => 'kunde', 'autor' => 'R. Beispiel']);
$vonUns = be_beleg_nachricht_absender(['seite' => 'betreiber', 'autor' => 'A. Muster']);
$pruef('KRITISCH: ohne Namen nennt die Zeile die Herkunft, statt einen Absender zu behaupten',
    $ohne !== '' && stripos($ohne, 'Link') !== false && stripos($ohne, 'Unbekannt') === false);
$pruef('… mit Namen steht der Name da, und die Herkunft bleibt daneben',
    str_contains($mit, 'R. Beispiel') && stripos($mit, 'Link') !== false);
$pruef('… und die eigene Seite wird nicht als Link-Herkunft ausgegeben',
    $vonUns === 'A. Muster' && stripos(
        be_beleg_nachricht_absender(['seite' => 'betreiber', 'autor' => '']), 'Link') === false);

// ── 5. Die beiden Mails ───────────────────────────────────────────────
$beleg = ['art' => 'offerte', 'nummer' => 'OF-0001'];
$LINK  = 'https://betreiber.guardops.ch/api/betreiber_beleg_oeffentlich.php?token=' . str_repeat('a', 64);

$anUns = beleg_nachricht_mail_betreiber($beleg, 'Musterbetrieb AG', $ohne,
    'Bitte zwei Lizenzen statt einer.', 'https://betreiber.guardops.ch/');
$pruef('KRITISCH: die Meldung an uns traegt die gemeinsame Gestaltung',
    str_starts_with($anUns['html'], '<!DOCTYPE html>')
    && str_contains($anUns['html'], 'pzu consulting gmbh'));
$pruef('KRITISCH: sie nennt Beleg, Herkunft und den Wunsch im Wortlaut',
    str_contains($anUns['betreff'], 'OF-0001')
    && str_contains($anUns['text'], 'zwei Lizenzen')
    && str_contains($anUns['html'], 'zwei Lizenzen'));
// Sie geht an die EIGENEN Konten -- eine Signatur mit Logo waere Post an
// sich selbst mit Briefkopf.
$pruef('… und kommt ohne Signaturbild aus', $anUns['bilder'] === []);

$anKunde = beleg_nachricht_mail_kunde($beleg, 'GuardOpS', 'Muster Kontakt',
    'Gerne, wir passen das an.', $LINK, ['Vorname Name', 'Geschäftsführer']);
$pruef('KRITISCH: die Antwort an den Kunden traegt den Link zurueck zum Beleg',
    str_contains($anKunde['text'], $LINK)
    && str_contains($anKunde['html'], htmlspecialchars($LINK, ENT_QUOTES, 'UTF-8')));
$pruef('KRITISCH: sie ist gezeichnet wie die uebrigen Mails an Kunden',
    str_contains($anKunde['html'], 'Mit freundlichen Grüssen')
    && str_contains($anKunde['html'], 'Vorname Name')
    && count($anKunde['bilder']) >= 1);
$pruef('KRITISCH: sie gruesst mit der Kontaktperson und traegt die Antwort',
    str_contains($anKunde['text'], 'Guten Tag Muster Kontakt,')
    && str_contains($anKunde['text'], 'wir passen das an'));
// GEGENPROBE: Ohne Kontaktperson steht kein halber Name da.
$ohnePerson = beleg_nachricht_mail_kunde($beleg, 'GuardOpS', '', 'Antwort', $LINK, []);
$pruef('GEGENPROBE — ohne Kontaktperson gruesst sie ohne Namen',
    str_starts_with($ohnePerson['text'], "Guten Tag,\n"));
$pruef('… und ohne hinterlegte Signatur zeichnet die Firma',
    str_contains($ohnePerson['text'], "Mit freundlichen Grüssen\nGuardOpS"));
// Kein Betrag in einer Mail, die nach aussen geht -- gleiche Zusage wie bei
// der Versandmail (ENT-674).
$pruef('KRITISCH: auch diese Mail traegt keinen Betrag',
    !preg_match('/\d+[.,]\d\d/', $anKunde['text']));

// ── 6. Wer eine Meldung bekommt ───────────────────────────────────────
//
// Konten UND Sammelpostfach (ENT-677, Nachtrag): Wer ein Konto hat,
// arbeitet am Vorrat; das Sammelpostfach faengt auf, wenn gerade niemand
// hineinschaut. Und zwar ohne Doppel.
$db->exec("CREATE TABLE betreiber (id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT NOT NULL, aktiv INTEGER NOT NULL DEFAULT 1)");
$db->exec("INSERT INTO betreiber (name, email, aktiv) VALUES
  ('Eins', 'eins@example.org', 1),
  ('Zwei', 'zwei@example.org', 1),
  ('Stillgelegt', 'weg@example.org', 0)");

$empf = be_melde_empfaenger($db);
$adressen = array_column($empf, 'email');
$pruef('KRITISCH: nur aktive Konten bekommen Post',
    in_array('eins@example.org', $adressen, true)
    && in_array('zwei@example.org', $adressen, true)
    && !in_array('weg@example.org', $adressen, true));

$db->exec("CREATE TABLE be_briefkopf (id INTEGER PRIMARY KEY, firma TEXT, email TEXT)");
$db->exec("INSERT INTO be_briefkopf (id, firma, email) VALUES (1, 'Musterfirma', 'sammel@example.org')");
$adressen = array_column(be_melde_empfaenger($db), 'email');
$pruef('KRITISCH: das Sammelpostfach aus dem Briefkopf bekommt es auch',
    in_array('sammel@example.org', $adressen, true) && count($adressen) === 3);

// GEGENPROBE: Dieselbe Adresse an Konto und Briefkopf ergibt EINE Mail.
$db->exec("UPDATE be_briefkopf SET email = 'EINS@example.org' WHERE id = 1");
$adressen = array_column(be_melde_empfaenger($db), 'email');
$pruef('KRITISCH: GEGENPROBE — dieselbe Adresse zweimal ergibt eine Mail, nicht zwei',
    count($adressen) === 2);

// Eine unbrauchbare Adresse im Briefkopf faellt weg, statt den Versand zu
// zerlegen -- und die Konten bekommen ihre Post trotzdem.
$db->exec("UPDATE be_briefkopf SET email = 'kein-postfach' WHERE id = 1");
$adressen = array_column(be_melde_empfaenger($db), 'email');
$pruef('KRITISCH: eine unbrauchbare Briefkopf-Adresse haelt die uebrigen nicht auf',
    count($adressen) === 2 && !in_array('kein-postfach', $adressen, true));

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "x $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
