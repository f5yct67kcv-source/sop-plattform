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

// ══════════════ DIE ZAHL AN DER GLOCKE IST DIE ECHTE
// Bis zum 14.10.2026 war "gesamt" die Laenge der Liste, und die ist je Art
// bei 20 abgeschnitten. Bei 30 offenen Rapporten stand an der Glocke 20;
// jeder Haken holte den naechsten nach, nach dem Neuladen stand wieder 20
// da -- als bliebe das Abhaken nicht haengen. Zwei Arten, damit die
// Summierung ueber die Arten mitgeprueft ist und nicht nur eine Zaehlung.
$pdo3 = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo3->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, vorname TEXT, nachname TEXT)');
$pdo3->exec('CREATE TABLE rapporte (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, datum TEXT,
    kunde TEXT, ort TEXT, einsatzart TEXT, netto_h REAL, erfasst_am TEXT, gesehen_am TEXT)');
$pdo3->exec('CREATE TABLE belege (id INTEGER PRIMARY KEY, nummer TEXT, kunde_id INTEGER,
    status TEXT, entscheidung_am TEXT, entscheidung_gesehen_am TEXT)');
$pdo3->exec('CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT)');
$pdo3->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname) VALUES (1, 'anna', 'Anna', 'Muster')");
for ($i = 1; $i <= 35; $i++) {
    // 30 offen, 5 schon gesehen -- die gesehenen duerfen nicht mitzaehlen.
    $gesehen = $i > 30 ? "'2026-09-02 08:00:00'" : 'NULL';
    $pdo3->exec("INSERT INTO rapporte (id, mitarbeiter_id, datum, kunde, erfasst_am, gesehen_am)
                 VALUES ($i, 1, '2026-09-01', 'Muster AG', '2026-09-01 " . sprintf('%02d', $i % 24) . ":00:00', $gesehen)");
}
for ($i = 1; $i <= 3; $i++) {
    $pdo3->exec("INSERT INTO belege (id, nummer, status, entscheidung_am)
                 VALUES ($i, 'OF-$i', 'bestaetigt', '2026-09-01 12:00:00')");
}
$e3 = ereignisse_sammeln($pdo3);
pruef('KRITISCH: gesamt zaehlt ALLE offenen (30 Rapporte + 3 Offerten), nicht die bei 20 abgeschnittene Liste',
    $e3['gesamt'] === 33);
pruef('Die Liste selbst bleibt auf die Grenze gekuerzt und sagt das',
    count($e3['ereignisse']) === 12 && $e3['gekuerzt'] === true);
$pdo3->exec("UPDATE rapporte SET gesehen_am = '2026-09-03 08:00:00' WHERE id = 1");
pruef('KRITISCH: ein Haken senkt die Zahl wirklich -- 32, nicht wieder dieselbe',
    ereignisse_sammeln($pdo3)['gesamt'] === 32);

// ══════════════ GLOCKE NUR FUER HANDLUNGSBEDARF (ENT-720) UND "ALLE ALS GELESEN"
// Die Glocke bekommt eine eigene Liste: abgelehnte Schicht, Sperrtag mit
// Konflikt, Offerte, Vorfall, spontaner Rundgang, Abwesenheitsantrag.
// Rapporte, Zusagen und Sperrtage ohne Konflikt stehen nur in der Kachel.
// "Alle als gelesen" hakt nur ab, was die Glocke zeigt, und nur bis zum
// Stand der geladenen Liste.
$pdo4 = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
// CURDATE() gibt es in SQLite nicht; der Sperrtag-Block braucht es.
$pdo4->sqliteCreateFunction('CURDATE', fn() => date('Y-m-d'), 0);
$pdo4->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, vorname TEXT, nachname TEXT)');
$pdo4->exec('CREATE TABLE rapporte (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, datum TEXT,
    kunde TEXT, ort TEXT, einsatzart TEXT, netto_h REAL, erfasst_am TEXT, gesehen_am TEXT)');
$pdo4->exec('CREATE TABLE verfuegbarkeiten (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, datum TEXT,
    bemerkung TEXT, erfasst_am TEXT, gesehen_am TEXT)');
$pdo4->exec('CREATE TABLE einsaetze (id INTEGER PRIMARY KEY, spontan_erzeugt INTEGER NOT NULL DEFAULT 0,
    datum TEXT, von TEXT, bis TEXT, kunde_name TEXT, titel TEXT, ort TEXT, status TEXT NOT NULL DEFAULT "geplant")');
$pdo4->exec('CREATE TABLE einsatz_zuteilung (einsatz_id INTEGER, mitarbeiter_id INTEGER, zusage TEXT,
    zugeteilt_am TEXT, zusage_gesehen_am TEXT)');
$pdo4->exec('CREATE TABLE belege (id INTEGER PRIMARY KEY, nummer TEXT, kunde_id INTEGER, status TEXT,
    entscheidung_am TEXT, entscheidung_gesehen_am TEXT)');
$pdo4->exec('CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT)');
$pdo4->exec('CREATE TABLE rundgang (id INTEGER PRIMARY KEY, einsatz_id INTEGER, mitarbeiter_id INTEGER,
    objekt_id INTEGER, status TEXT, vorbereitet_am TEXT, ausnahme_grund TEXT, gesehen_am TEXT)');
$pdo4->exec('CREATE TABLE objekte (id INTEGER PRIMARY KEY, name TEXT, kunde_name TEXT)');
$pdo4->exec('CREATE TABLE ereignisart (id INTEGER PRIMARY KEY, bezeichnung TEXT)');
$pdo4->exec('CREATE TABLE ereignis_meldung (id INTEGER PRIMARY KEY, objekt_id INTEGER, mitarbeiter_id INTEGER,
    ereignisart_id INTEGER, erfasst_am TEXT, vorfall_am TEXT, bemerkung TEXT, foto_mime TEXT, gesehen_am TEXT)');
$pdo4->exec('CREATE TABLE abwesenheiten (id INTEGER PRIMARY KEY, mitarbeiter_id INTEGER, typ TEXT,
    von TEXT, bis TEXT, bemerkung TEXT, status TEXT, beantragt_am TEXT, gesehen_am TEXT)');
$pdo4->exec("INSERT INTO mitarbeiter VALUES (1, 'anna', 'Anna', 'Muster'), (2, 'beat', 'Beat', 'Beispiel')");
$pdo4->exec("INSERT INTO objekte VALUES (1, 'Lager Beispiel', 'Muster AG')");
$vor = '2026-09-01 08:00:00'; $stand = '2026-09-01 12:00:00'; $nach = '2026-09-01 12:05:00';
// Ein kuenftiger Tag, relativ zu heute (kein festes Datum nahe beim heutigen).
$tag = date('Y-m-d', strtotime('+10 days'));
$pdo4->exec("INSERT INTO rapporte (id, mitarbeiter_id, datum, kunde, erfasst_am) VALUES (1, 1, '2026-09-01', 'Muster AG', '$vor')");
$pdo4->exec("INSERT INTO rapporte (id, mitarbeiter_id, datum, kunde, erfasst_am) VALUES (2, 1, '2026-09-01', 'Muster AG', '$nach')");
// Einsatz 20 an $tag: Anna eingeteilt (zugesagt), Beat hat ABGELEHNT.
// Einsatz 21 an $tag: abgesagt, Beat zugeteilt -- zaehlt nicht als Konflikt.
$pdo4->exec("INSERT INTO einsaetze (id, datum, von, bis, kunde_name, status) VALUES
    (20, '$tag', '07:00:00', '16:00:00', 'Beispiel AG', 'geplant'),
    (21, '$tag', '18:00:00', '22:00:00', 'Muster AG', 'abgesagt')");
$pdo4->exec("INSERT INTO einsatz_zuteilung VALUES (20, 1, 'zugesagt', '$vor', NULL), (20, 2, 'abgelehnt', '$vor', NULL),
    (21, 2, 'zugesagt', '$vor', '$vor')");
// Sperrtag 1: Anna an $tag -- eingeteilt, also KONFLIKT. Sperrtag 2: Beat
// an $tag -- hat abgelehnt bzw. die Schicht ist abgesagt, KEIN Konflikt.
$pdo4->exec("INSERT INTO verfuegbarkeiten (id, mitarbeiter_id, datum, erfasst_am) VALUES (1, 1, '$tag', '$vor'), (2, 2, '$tag', '$vor')");
$pdo4->exec("INSERT INTO belege (id, nummer, status, entscheidung_am) VALUES (1, 'OF-1', 'bestaetigt', '$vor'), (2, 'OF-2', 'offen', NULL)");
$pdo4->exec("INSERT INTO einsaetze (id, spontan_erzeugt, datum) VALUES (10, 1, '2026-09-01'), (11, 0, '2026-09-01')");
$pdo4->exec("INSERT INTO rundgang (id, einsatz_id, mitarbeiter_id, vorbereitet_am) VALUES (100, 10, 1, '$vor'), (101, 11, 1, '$vor')");
$pdo4->exec("INSERT INTO ereignis_meldung (id, objekt_id, mitarbeiter_id, erfasst_am) VALUES (1, 1, 1, '$vor')");
$pdo4->exec("INSERT INTO abwesenheiten (id, mitarbeiter_id, typ, von, bis, status, beantragt_am) VALUES (1, 1, 'ferien', '$tag', '$tag', 'beantragt', '$vor')");

$schluessel = fn(array $l) => (function () use ($l) {
    $k = array_map(fn($x) => $x['typ'] . ':' . $x['id'] . (isset($x['mitarbeiter_id']) ? '/' . $x['mitarbeiter_id'] : ''), $l);
    sort($k); return $k;
})();
$vorher4 = ereignisse_sammeln($pdo4);
pruef('Vorbedingung: alle Arten sind abfragbar', $vorher4['unvollstaendig'] === []);
pruef('KRITISCH: die Kachel zeigt weiter ALLES -- auch Rapporte, Zusagen und Sperrtage ohne Konflikt',
    $schluessel($vorher4['ereignisse']) === ['abwesenheit:1', 'offerte:1', 'rapport:1', 'rapport:2',
        'rundgang_spontan:100', 'sperrtag:1', 'sperrtag:2', 'vorfall:1', 'zusage:20/1', 'zusage:20/2']);
pruef('KRITISCH: die Glocke zeigt nur Handlungsbedarf -- Ablehnung, Sperrtag mit Konflikt, Offerte, Rundgang, Vorfall, Antrag',
    $schluessel($vorher4['glocke']) === ['abwesenheit:1', 'offerte:1', 'rundgang_spontan:100',
        'sperrtag:1', 'vorfall:1', 'zusage:20/2']);
pruef('Die Zahl der Glocke stimmt mit ihrer Liste ueberein (6)', array_sum($vorher4['glocke_je_art']) === 6);
$sp = array_values(array_filter($vorher4['glocke'], fn($x) => $x['typ'] === 'sperrtag'));
pruef('KRITISCH: der Sperrtag in der Glocke nennt die betroffene Schicht',
    $sp !== [] && ($sp[0]['konflikt']['kunde'] ?? '') === 'Beispiel AG' && ($sp[0]['konflikt']['von'] ?? '') === '07:00:00');
pruef('Ohne das Recht, Abwesenheiten zu entscheiden, kein Antrag -- weder Liste noch Zahl',
    (function () use ($pdo4) {
        $e = ereignisse_sammeln($pdo4, 12, null, null, false);
        return !array_filter($e['ereignisse'], fn($x) => $x['typ'] === 'abwesenheit')
            && !isset($e['glocke_je_art']['abwesenheit']) && !isset($e['je_art']['abwesenheit']);
    })());

$r4 = ereignisse_alle_abhaken($pdo4, $stand, '2026-09-01 12:10:00');
pruef('Alle Arten liessen sich abhaken', $r4['fehler'] === []);
$nach4 = ereignisse_sammeln($pdo4);
pruef('KRITISCH: "alle" leert die Glocke bis auf den Antrag (der braucht einen Entscheid)',
    $schluessel($nach4['glocke']) === ['abwesenheit:1']);
pruef('KRITISCH: und laesst auf der Kachel stehen, was die Glocke nie gezeigt hat',
    $schluessel($nach4['ereignisse']) === ['abwesenheit:1', 'rapport:1', 'rapport:2', 'sperrtag:2', 'zusage:20/1']);
pruef('KRITISCH: eine offene Zusage bekommt keinen Stempel (sonst erschiene ihre spaetere Antwort nie)',
    $pdo4->query("SELECT COUNT(*) FROM einsatz_zuteilung WHERE zusage = 'zugesagt' AND einsatz_id = 20 AND zusage_gesehen_am IS NULL")->fetchColumn() == 1);
pruef('KRITISCH: ein normal geplanter Rundgang bekommt keinen Stempel',
    $pdo4->query('SELECT gesehen_am FROM rundgang WHERE id = 101')->fetchColumn() === null);
pruef('Eine noch nicht entschiedene Offerte bekommt keinen Stempel',
    $pdo4->query('SELECT entscheidung_gesehen_am FROM belege WHERE id = 2')->fetchColumn() === null);
pruef('Die Zahl stimmt: 5 Zeilen markiert', $r4['geaendert'] === 5);

// Was NACH dem Laden einging, bleibt -- auch wenn es in die Glocke gehoert.
$pdo4->exec("INSERT INTO ereignis_meldung (id, objekt_id, mitarbeiter_id, erfasst_am) VALUES (2, 1, 1, '$nach')");
ereignisse_alle_abhaken($pdo4, $stand, '2026-09-01 12:10:00');
pruef('KRITISCH: ein Vorfall, der nach dem Laden einging, bleibt in der Glocke',
    in_array('vorfall:2', $schluessel(ereignisse_sammeln($pdo4)['glocke']), true));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
