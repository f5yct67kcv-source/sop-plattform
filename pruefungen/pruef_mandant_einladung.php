<?php
// Die Funktionen der Mandanten-Uebergabe (ENT-686) wirklich AUSFUEHREN --
// nicht ihren Quelltext lesen.
//
// Warum diese Datei: Vier Aussagen des Uebergabewegs sind Entscheidungen und
// keine Formulierungen. Eine Textsuche wuerde jede davon uebersehen, sobald
// sich der Wortlaut aendert und die Sache verschwindet:
//
//   1. EIN ABGELAUFENER LINK IST EIN UNGUELTIGER LINK -- und die Frist wird
//      in der Datenbank verglichen, nicht in PHP. Sonst entschiede die Uhr
//      des Webservers, und Betreiber-Datenbank und Webserver sind zwei Uhren
//      (OP-518).
//   2. EIN EINGELOESTER LINK IST EIN UNGUELTIGER LINK. Anders als bei
//      betreiber_einladung wird die Zeile NICHT geloescht -- sie bleibt mit
//      `eingeloest_am` stehen, weil das Konto in einer anderen Datenbank
//      entsteht und es sonst keinen Ort gaebe, an dem die Uebergabe
//      vermerkt ist. Die Sperre gegen doppeltes Einloesen haengt damit an
//      genau diesem Feld.
//   3. DER ROHWERT STEHT NIRGENDS. In der Tabelle liegt ausschliesslich der
//      SHA-256-Abdruck (ENT-501). Wer den Abdruck kennt, kommt damit nicht
//      hinein.
//   4. ZWEI GLEICHZEITIGE EINLOESUNGEN ERGEBEN EIN KONTO, nicht zwei. Das
//      Beanspruchen ist ein Wettlauf, den genau einer gewinnt.
//
// NOW() FUER SQLITE: Die Abfragen vergleichen und setzen NOW(), das SQLite
// nicht kennt. Statt den Produktivcode fuer die Pruefung zu verbiegen, wird
// die Funktion hier nachgereicht -- so laeuft genau die Abfrage, die spaeter
// auch in MySQL laeuft. Das Format 'YYYY-MM-DD HH:MM:SS' vergleicht sich als
// Zeichenkette in derselben Reihenfolge wie als Zeitpunkt.
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
// unbenutzbaren Bereich -- und "nicht eingerichtet" saehe aus wie "kaputt".
$pruef('KRITISCH: ohne Tabelle meldet die Auskunft "keine Einladung", statt zu brechen',
    mandant_einladung_tabelle_da($db) === false
    && mandant_einladung_zu_token($db, 'irgendwas') === null
    && mandant_einladung_eingeloest_am($db, 1) === null);

$db->exec("CREATE TABLE mandant (id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, subdomain TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktiv',
  db_host TEXT NOT NULL DEFAULT '', db_name TEXT NOT NULL DEFAULT '',
  db_user TEXT NOT NULL DEFAULT '', secret_name TEXT NOT NULL DEFAULT '')");
$db->exec("CREATE TABLE mandant_einladung (mandant_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL, anrede TEXT NOT NULL DEFAULT '',
  vorname TEXT NOT NULL DEFAULT '', nachname TEXT NOT NULL,
  email TEXT NOT NULL, gueltig_bis TEXT NOT NULL,
  erstellt_am TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
  erstellt_von INTEGER NOT NULL, eingeloest_am TEXT NULL)");

// Drei Mandanten: frisch eingeladen, abgelaufen, gesperrt.
// KEINE ECHTEN NAMEN (CLAUDE.md, Vertraulichkeit) -- erfundene Betriebe.
$db->exec("INSERT INTO mandant (id, name, subdomain, status, db_host, db_name, db_user, secret_name) VALUES
  (1, 'Beispielwache AG',   'platz1', 'aktiv',     'localhost', 'anlage1', 'nutzer1', 'S1'),
  (2, 'Musterdienst GmbH',  'platz2', 'aktiv',     'localhost', 'anlage2', 'nutzer2', 'S2'),
  (3, 'Probeschutz AG',     'platz3', 'gesperrt',  'localhost', 'anlage3', 'nutzer3', 'S3')");

$tokenGut = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888';
$tokenAlt = '9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff';
$tokenGes = '1234123412341234123412341234123412341234123412341234123412341234';
$in = $db->prepare('INSERT INTO mandant_einladung
    (mandant_id, token, vorname, nachname, email, gueltig_bis, erstellt_von)
    VALUES (?, ?, ?, ?, ?, ?, 7)');
// Kein festes Datum nahe beim heutigen Tag (CLAUDE.md, test_datumsfest.mjs):
// beide Fristen werden aus der aktuellen Zeit gerechnet.
$in->execute([1, hash('sha256', $tokenGut), 'Alex', 'Beispiel', 'alex@example.org',
              date('Y-m-d H:i:s', time() + 3600)]);
$in->execute([2, hash('sha256', $tokenAlt), 'Kim', 'Muster', 'kim@example.org',
              date('Y-m-d H:i:s', time() - 3600)]);
$in->execute([3, hash('sha256', $tokenGes), 'Sam', 'Probe', 'sam@example.org',
              date('Y-m-d H:i:s', time() + 3600)]);

// ── 1. Der gueltige Link findet seine Einladung ───────────────────────
$treffer = mandant_einladung_zu_token($db, $tokenGut);
$pruef('ein gueltiger Link findet seine Einladung',
    $treffer !== null && (int)$treffer['mandant_id'] === 1);
// DIE MANDANTENZEILE KOMMT MIT: Ohne db_host/db_name/secret_name kaeme der
// Einloeseweg nicht an die Anlage, in der das Konto entstehen soll -- er
// muesste ein zweites Mal suchen.
$pruef('und liefert die Angaben, mit denen der Einloeseweg an die Anlage kommt',
    $treffer !== null && $treffer['mandant_name'] === 'Beispielwache AG'
    && $treffer['db_name'] === 'anlage1' && $treffer['secret_name'] === 'S1'
    && $treffer['mandant_status'] === 'aktiv');
// Und die benannte Person, damit die Seite zeigen kann, wofuer das Passwort
// gilt -- ohne dass jemand danach fragen muss.
$pruef('und die benannte Person, an die der Link ging',
    $treffer !== null && $treffer['nachname'] === 'Beispiel'
    && $treffer['email'] === 'alex@example.org');

// Gegenprobe zur Frist: derselbe Link, nur die Frist zurueckgestellt -- der
// Treffer muss verschwinden. Ohne diese Probe bestuende die Pruefung oben
// auch dann, wenn die Frist gar nicht verglichen wuerde.
$db->prepare('UPDATE mandant_einladung SET gueltig_bis = ? WHERE mandant_id = 1')
   ->execute([date('Y-m-d H:i:s', time() - 60)]);
$pruef('KRITISCH: GEGENPROBE — derselbe Link gilt nicht mehr, sobald die Frist zurueckliegt',
    mandant_einladung_zu_token($db, $tokenGut) === null);
$db->prepare('UPDATE mandant_einladung SET gueltig_bis = ? WHERE mandant_id = 1')
   ->execute([date('Y-m-d H:i:s', time() + 3600)]);
$pruef('… und gilt wieder, sobald sie in der Zukunft liegt',
    mandant_einladung_zu_token($db, $tokenGut) !== null);

// ── 2. Abgelaufen, erfunden und leer sind DASSELBE ────────────────────
//
// Nicht aus Bequemlichkeit: "Dieser Link ist abgelaufen" bestaetigte, dass es
// ihn einmal gab -- und damit, dass es diesen Mandanten gibt.
$pruef('KRITISCH: ein abgelaufener Link gibt dasselbe wie ein erfundener: nichts',
    mandant_einladung_zu_token($db, $tokenAlt) === null
    && mandant_einladung_zu_token($db, 'gibtesnicht') === null
    && mandant_einladung_zu_token($db, '') === null);

// ── 3. Der Abdruck ist kein Schluessel ────────────────────────────────
//
// Die wichtigste Pruefung dieser Datei. Wer die Tabelle lesen kann -- ein
// Backup, ein Dump, ein Blick ueber die Schulter -- haelt den Abdruck in der
// Hand. Er darf damit nicht hineinkommen, und dieser Link legt den
// Verwaltungszugang einer ganzen Anlage an.
$abdruck = hash('sha256', $tokenGut);
$pruef('KRITISCH: wer den Abdruck aus der Tabelle kennt, kommt damit NICHT hinein',
    mandant_einladung_zu_token($db, $abdruck) === null);
// Gegenprobe: Der Rohwert zum selben Abdruck kommt hinein. Ohne sie waere die
// Pruefung oben auch gruen, wenn ueberhaupt nichts mehr funktioniert.
$pruef('… waehrend der Rohwert zum selben Abdruck es tut (GEGENPROBE)',
    mandant_einladung_zu_token($db, $tokenGut) !== null);
// Und der Rohwert liegt nirgends in der Tabelle.
$rohTreffer = $db->query("SELECT COUNT(*) FROM mandant_einladung WHERE token = '$tokenGut'")
                 ->fetchColumn();
$pruef('KRITISCH: der Rohwert steht in keiner Zeile der Tabelle',
    (int)$rohTreffer === 0);

// ── 4. Eingeloest ist verbraucht ──────────────────────────────────────
//
// Die Zeile bleibt stehen (ENT-686, Klaerung 3) -- der Link darf trotzdem
// nicht mehr gelten. Beides haengt an `eingeloest_am`, und genau darum wird
// es hier einzeln geprueft: Faellt die Bedingung aus der Abfrage, bleibt die
// Einladung fuer immer gueltig, und niemand sieht es.
$pruef('vor dem Einloesen gibt es keinen Uebergabe-Vermerk',
    mandant_einladung_eingeloest_am($db, 1) === null);
$pruef('KRITISCH: das Beanspruchen gelingt genau einmal',
    mandant_einladung_beanspruchen($db, 1) === true
    && mandant_einladung_beanspruchen($db, 1) === false);
$pruef('KRITISCH: der eingeloeste Link gilt nicht mehr',
    mandant_einladung_zu_token($db, $tokenGut) === null);
// … und die Zeile ist noch da. Das ist die bewusste Abweichung von
// betreiber_einladung, wo sie geloescht wird: Das Konto entsteht in einer
// ANDEREN Datenbank, und ohne diese Zeile gaebe es in der
// Betreiber-Datenbank keine Stelle, an der die Uebergabe steht.
$pruef('KRITISCH: die Zeile bleibt stehen und traegt den Zeitpunkt der Uebergabe',
    (int)$db->query('SELECT COUNT(*) FROM mandant_einladung WHERE mandant_id = 1')
            ->fetchColumn() === 1
    && mandant_einladung_eingeloest_am($db, 1) !== null);

// ── 5. Die Gegenbuchung gibt die Einladung wieder frei ────────────────
//
// Zwei Datenbanken haben keine gemeinsame Transaktion. Scheitert das Anlegen
// in der Anlage, muss die Einladung zurueck auf offen -- sonst stuende beim
// Betreiber "eingeloest", und der Kunde kaeme nie hinein.
mandant_einladung_freigeben($db, 1);
$pruef('KRITISCH: nach der Freigabe gilt der Link wieder',
    mandant_einladung_zu_token($db, $tokenGut) !== null
    && mandant_einladung_eingeloest_am($db, 1) === null);
$pruef('… und das Beanspruchen gelingt danach erneut (GEGENPROBE)',
    mandant_einladung_beanspruchen($db, 1) === true);

// ── 6. Die Frist ist laenger als die der Betreiber-Ebene ──────────────
//
// GEPRUEFT WIRD DIE AUSSAGE, NICHT DIE ZAHL: Entschieden ist, dass der
// Empfaenger hier NICHT im Haus sitzt (ENT-686, Klaerung 2) -- er ist die
// benannte Person eines Kunden. Eine Frist wie unter Kollegen laesst den
// ersten Versuch regelmaessig verfallen, und dann ist die Uebergabe wieder
// Handarbeit. Wer die Zahl aendert, darf das; wer sie unter die der
// Betreiber-Ebene setzt, nimmt die Entscheidung zurueck.
$pruef('KRITISCH: die Uebergabefrist ist laenger als die der Betreiber-Ebene',
    MANDANT_EINLADUNG_TAGE * 24 > BE_EINLADUNG_STUNDEN);

// ── 7. Ein gesperrter Mandant wird nicht vom Token entschieden ────────
//
// Der Token FINDET die Einladung auch dann -- der Status ist kein Teil der
// Suche. Das ist Absicht: Die Endpunkte sollen "dieser Betrieb ist nicht
// freigeschaltet" sagen koennen und nicht "dieser Link gilt nicht mehr".
// Zwei verschiedene Aussagen brauchen zwei verschiedene Texte (Hausregel),
// und dafuer muss der Status mitkommen.
$ges = mandant_einladung_zu_token($db, $tokenGes);
$pruef('ein gesperrter Mandant liefert seinen Status mit, statt den Link zu verschweigen',
    $ges !== null && $ges['mandant_status'] === 'gesperrt');

echo count($bad) === 0
    ? "$ok bestanden\n\nAlle Pruefungen bestanden.\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n\n  ✗ "
      . implode("\n  ✗ ", $bad) . "\n";
exit(count($bad) === 0 ? 0 : 1);
