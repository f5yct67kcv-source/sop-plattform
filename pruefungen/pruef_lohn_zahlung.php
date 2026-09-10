<?php
declare(strict_types=1);
// Die Zahlungsangaben einer Person gehoeren dieser Person -- geprueft gegen
// das ECHTE Schema aus dem Einrichtungslauf und die ECHTE Abfrage aus
// lohn_person.php, nicht gegen eine nachgetippte Fassung.
//
// Warum diese Pruefung besteht: Der Schreibweg fuer 'zahlung' band den
// UPDATE nur an die id der Zeile und setzte mitarbeiter_id aus der Anfrage
// mit. Eine veraltete eintrag_id im Formular -- etwa nach einem Wechsel der
// ausgewaehlten Person ohne Neuladen -- hing damit die Zahlungszeile einer
// ANDEREN Person auf die gerade offene um und ueberschrieb deren IBAN.
// Beim naechsten Zahlungslauf waere der Lohn auf ein fremdes Konto
// gegangen. Der Loeschweg derselben Datei band von Anfang an an beide
// Werte; nur der Schreibweg tat es nicht.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$einr = file_get_contents(__DIR__ . '/../backend/api/planung_einrichten.php');
preg_match("/'lohn_zahlung' => \"(.*?)\",\n/s", $einr, $mSchema);
pruef('Das Schema fuer lohn_zahlung ist im Einrichtungslauf auffindbar', !empty($mSchema[1]));

$quelle = file_get_contents(__DIR__ . '/../backend/api/lohn_person.php');
preg_match("/'(UPDATE lohn_zahlung SET.*?)'/s", $quelle, $mUpd);
pruef('Der Schreibweg fuer Zahlungsangaben ist in lohn_person.php auffindbar', !empty($mUpd[1]));

if (!empty($mSchema[1]) && !empty($mUpd[1])) {
    // Nur so viel umschreiben, wie SQLite braucht -- Spalten und Reihenfolge
    // bleiben unangetastet, sonst pruefte man die Umschrift.
    $ddl = $mSchema[1];
    $ddl = preg_replace('/\bINT AUTO_INCREMENT PRIMARY KEY\b/', 'INTEGER PRIMARY KEY', $ddl);
    $ddl = preg_replace('/,\s*KEY \w+ \([^)]*\)/', '', $ddl);
    $ddl = preg_replace('/,\s*FOREIGN KEY \([^)]*\) REFERENCES \w+\([^)]*\)[^,)]*/', '', $ddl);
    $ddl = preg_replace('/\) ENGINE=\w+ DEFAULT CHARSET=\w+/', ')', $ddl);

    $sql = str_replace('NOW()', "datetime('now')", $mUpd[1]);

    $q = new PDO('sqlite::memory:', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $fehler = null;
    try { $q->exec($ddl); } catch (Throwable $e) { $fehler = $e->getMessage(); }
    pruef('KRITISCH: das echte Schema laesst sich anlegen', $fehler === null);

    if ($fehler === null) {
        // Zwei Personen, je eine Zahlungszeile. Zeile 77 gehoert Person 9.
        $q->exec("INSERT INTO lohn_zahlung (id, mitarbeiter_id, reihenfolge, art, betrag_rappen,
                    iban, empfaenger, bank, aktiv, bemerkung)
                  VALUES (55,5,1,'rest',NULL,'CH9300762011623852957','Person 5',NULL,1,NULL)");
        $q->exec("INSERT INTO lohn_zahlung (id, mitarbeiter_id, reihenfolge, art, betrag_rappen,
                    iban, empfaenger, bank, aktiv, bemerkung)
                  VALUES (77,9,1,'rest',NULL,'CH5604835012345678009','Person 9',NULL,1,NULL)");

        // Person 5 schickt die eintrag_id von Person 9 mit -- genau der Fall,
        // der die fremde Zeile umhing. Feldreihenfolge wie im Endpunkt.
        //
        // Die Werteliste richtet sich nach der Zahl der Platzhalter in der
        // ECHTEN Anweisung: Faellt die Bindung an mitarbeiter_id weg, laeuft
        // die Anweisung trotzdem -- und die Pruefungen unten zeigen dann die
        // WIRKUNG, statt an einer falschen Parameterzahl abzustuerzen.
        $werte = [5, 1, 'rest', null, 'CH2909000000100013997', 'Fremd', null, 1, null, 1, 77];
        if (substr_count($sql, '?') > count($werte)) { $werte[] = 5; }
        pruef('Die Anweisung bindet an zwei Werte, nicht nur an die id',
            substr_count($sql, '?') === 12);
        $st = $q->prepare($sql);
        $st->execute($werte);

        $fremd = $q->query('SELECT * FROM lohn_zahlung WHERE id = 77')->fetch();
        pruef('KRITISCH: die Zeile einer anderen Person bleibt bei fremder eintrag_id unberuehrt',
            $fremd !== false && (int)$fremd['mitarbeiter_id'] === 9);
        pruef('KRITISCH: ihre IBAN wird nicht ueberschrieben',
            $fremd !== false && $fremd['iban'] === 'CH5604835012345678009');
        pruef('Und ihr Empfaenger bleibt ebenfalls stehen',
            $fremd !== false && $fremd['empfaenger'] === 'Person 9');

        // Gegenprobe in die andere Richtung: der EIGENE Eintrag laesst sich
        // sehr wohl aendern -- die Bindung sperrt nicht die normale Arbeit.
        $werte2 = [5, 2, 'fix', 50000, 'CH2909000000100013997', 'Person 5 neu', 'Bank', 1, null, 1, 55];
        if (substr_count($sql, '?') > count($werte2)) { $werte2[] = 5; }
        $st2 = $q->prepare($sql);
        $st2->execute($werte2);
        $eigen = $q->query('SELECT * FROM lohn_zahlung WHERE id = 55')->fetch();
        pruef('KRITISCH: die eigene Zahlungszeile laesst sich weiterhin aendern',
            $eigen !== false && $eigen['iban'] === 'CH2909000000100013997'
            && (int)$eigen['betrag_rappen'] === 50000);
    }
}

echo "$ok Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
