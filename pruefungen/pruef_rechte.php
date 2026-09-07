<?php
declare(strict_types=1);
// Echte Ausfuehrung des Rechtekerns (ENT-077, erweitert mit ENT-440).
//
// Die Browser-Suiten taeuschen die Serverantwort vor und kaemen an dieser
// Stelle nie vorbei -- eine Rechteregel, die niemand ausfuehrt, ist eine
// Behauptung. Darum laeuft hier der echte Quelltext, und die
// Datenbankfunktionen laufen gegen eine wirkliche Datenbank (SQLite im
// Arbeitsspeicher) statt gegen einen nachgebauten Ablauf.
//
// ENT-440 hat aus 13 Ja/Nein-Rechten 20 Bereiche mit je zwei oder drei
// Stufen gemacht. Die wichtigste Pruefung hier ist darum nicht mehr "gibt es
// Recht X", sondern: KANN JEDE SYSTEMROLLE NACH DEM UMBAU NOCH GENAU DAS,
// WAS SIE VORHER KONNTE. Diese Liste steht unten ausgeschrieben.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die beiden Funktionen, die rechte.php aus db.php erwartet. hat_tabelle()
// fragt sonst information_schema ab -- das gibt es in SQLite nicht.
//
// Je Tabelle steuerbar (ENT-440): Ein Betrieb kann zwischen den beiden
// Einrichtungen stehen -- Rollen zugeteilt, aber die Profiltabellen noch
// nicht da. Genau dieser Zwischenzustand wird unten geprueft.
$GLOBALS['tabellen'] = ['mitarbeiter_rollen' => true, 'rollen' => true, 'rollen_rechte' => true];
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    return $GLOBALS['tabellen'][$t] ?? true;
}
$GLOBALS['abgewiesen'] = null;
function json_response($data, int $status = 200): void {
    $GLOBALS['abgewiesen'] = ['status' => $status, 'daten' => $data];
    throw new RuntimeException('abgewiesen');
}
// Wird von rechte_setzen() und rolle_speichern() ueber function_exists()
// gesucht. Hier mitgeschrieben, damit sich pruefen laesst, dass eine
// Rechteaenderung tatsaechlich ins Logbuch geht.
$GLOBALS['logbuch'] = [];
function logbuch_schreiben(PDO $pdo, array $akteur, string $bereich, int $objektId,
                           string $feld, ?string $alt, ?string $neu, bool $ohneWerte = false): bool {
    $GLOBALS['logbuch'][] = compact('akteur', 'bereich', 'objektId', 'feld', 'alt', 'neu', 'ohneWerte');
    return true;
}

require __DIR__ . '/../backend/rechte.php';

// ══════════════ DIE BEREICHE
$bereiche = bereiche_katalog();
pruef('Es gibt 20 Bereiche (ENT-440)', count($bereiche) === 20);
pruef('Jeder Bereich nennt Gruppe, Titel, Text und Stufen',
    count(array_filter($bereiche, fn($b) => isset($b['gruppe'], $b['titel'], $b['text'], $b['stufen'])
        && $b['titel'] !== '' && $b['text'] !== '' && $b['stufen'] !== [])) === count($bereiche));
pruef('Jeder Bereich hat mindestens die Stufe "lesen"',
    count(array_filter($bereiche, fn($b) => in_array(STUFE_LESEN, $b['stufen'], true))) === count($bereiche));
pruef('Kein Bereich fuehrt "verborgen" als speicherbare Stufe -- das ist die Abwesenheit einer Zeile',
    count(array_filter($bereiche, fn($b) => in_array(STUFE_VERBORGEN, $b['stufen'], true))) === 0);
$gruppen = array_values(array_unique(array_map(fn($b) => $b['gruppe'], $bereiche)));
pruef('Die Bereiche stehen in sechs Gruppen', count($gruppen) === 6);
pruef('Die Gruppen heissen wie in der Oberflaeche',
    $gruppen === ['Planung', 'Abgleich', 'Kunden', 'Personal', 'Revierdienst', 'Administration']);
// Bereiche derselben Gruppe muessen zusammenstehen -- die Oberflaeche
// gruppiert der Reihe nach und wuerde sonst dieselbe Ueberschrift zweimal
// zeichnen.
$folge = array_values(array_map(fn($b) => $b['gruppe'], $bereiche));
$wechsel = 0;
foreach ($folge as $i => $g) { if ($i === 0 || $folge[$i - 1] !== $g) { $wechsel++; } }
pruef('Bereiche derselben Gruppe stehen zusammen -- sonst zeichnet die Oberflaeche dieselbe Ueberschrift zweimal',
    $wechsel === count(array_unique($folge)));

// Bereiche ohne Schreibweg duerfen keine Schreibstufe anbieten. Ein
// Schreibschalter, der nichts oeffnet, ist eine Behauptung.
pruef('KRITISCH: das Logbuch kennt keine Schreibstufe (ENT-077: es ist nur lesend)',
    !stufe_gueltig('logbuch', STUFE_SCHREIBEN) && stufe_gueltig('logbuch', STUFE_LESEN));
pruef('Auslagen und Verfuegbarkeit sind ebenfalls nur lesbar',
    !stufe_gueltig('auslagen', STUFE_SCHREIBEN) && !stufe_gueltig('verfuegbarkeit', STUFE_SCHREIBEN));
pruef('KRITISCH: ein unbekannter Bereich ist nie gueltig',
    !bereich_gueltig('gibtesnicht') && !stufe_gueltig('gibtesnicht', STUFE_LESEN));
pruef('KRITISCH: eine erfundene Stufe ist nie gueltig',
    !stufe_gueltig('kunden', 'alles') && !stufe_gueltig('kunden', STUFE_VERBORGEN));

// ══════════════ STUFEN
pruef('KRITISCH: Schreiben schliesst Lesen ein', stufe_deckt(STUFE_SCHREIBEN, STUFE_LESEN));
pruef('KRITISCH: Lesen schliesst Schreiben NICHT ein', !stufe_deckt(STUFE_LESEN, STUFE_SCHREIBEN));
pruef('Verborgen deckt gar nichts',
    !stufe_deckt(STUFE_VERBORGEN, STUFE_LESEN) && !stufe_deckt(STUFE_VERBORGEN, STUFE_SCHREIBEN));

// ══════════════ DER RECHTEKATALOG
$alleRechte = array_keys(rechte_katalog());
pruef('Der Rechtekatalog wird aus den Bereichen abgeleitet, nicht von Hand gefuehrt',
    count($alleRechte) === array_sum(array_map(fn($b) => count($b['stufen']), $bereiche)));
pruef('Jedes Recht heisst <bereich>_<stufe>',
    count(array_filter($alleRechte, fn($r) => preg_match('/_(lesen|schreiben)$/', $r) === 1)) === count($alleRechte));
pruef('KRITISCH: ein erfundenes Recht steht nicht im Katalog', !recht_gueltig('alles_duerfen'));

// ══════════════ DIE SYSTEMROLLEN -- der Kern der Gegenprobe zu ENT-440
$sys = system_rollen();
pruef('Es gibt die vier urspruenglichen Rollen plus die Waechtersystem-Rolle (ENT-180)',
    count($sys) === 5);
pruef('Die Rollen heissen wie entschieden',
    array_keys($sys) === ['mitarbeitend', 'planung', 'personal', 'verwaltung', 'waechter']);
pruef('KRITISCH: jede Systemrolle nennt nur Bereiche, die es gibt, mit Stufen, die es dort gibt',
    (function () use ($sys) {
        foreach ($sys as $d) {
            foreach ($d['stufen'] as $b => $st) { if (!stufe_gueltig((string)$b, (string)$st)) { return false; } }
        }
        return true;
    })());
pruef('Jede Systemrolle traegt eine Beschreibung',
    count(array_filter($sys, fn($d) => strlen($d['text']) > 40)) === 5);
pruef('KRITISCH: "mitarbeitend" hat kein einziges Recht -- sonst kaeme sie ins Cockpit',
    rechte_aus_rollen(['mitarbeitend']) === []);

// Die Wirkung, Bereich fuer Bereich ausgeschrieben. Diese Liste ist der
// Beweis, dass ENT-440 keiner Rolle etwas weggenommen und -- bis auf die
// eine dokumentierte Ausnahme -- nichts dazugegeben hat.
$erwartet = [
  'planung' => ['einsaetze_lesen','einsaetze_schreiben','objekte_lesen','objekte_schreiben',
    'masterschichten_lesen','masterschichten_schreiben','verfuegbarkeit_lesen',
    'abgleich_lesen','abgleich_schreiben','auslagen_lesen','kunden_lesen','kunden_schreiben',
    'personal_lesen','abwesenheiten_lesen','fahrzeuge_lesen'],
  'personal' => ['personal_lesen','personal_schreiben','personal_vertraulich_lesen',
    'personal_vertraulich_schreiben','abwesenheiten_lesen','abwesenheiten_schreiben',
    'mitteilungen_lesen','mitteilungen_schreiben'],
  'waechter' => ['kontrollpunkte_lesen','kontrollpunkte_schreiben',
    'rundgaenge_lesen','rundgaenge_schreiben','alarmempfaenger_lesen'],
];
foreach ($erwartet as $rolle => $soll) {
    sort($soll);
    pruef('KRITISCH: die Rolle "' . $rolle . '" hat genau die entschiedenen Rechte',
        rechte_aus_rollen([$rolle]) === $soll);
}
pruef('KRITISCH: Planung sieht Mitarbeitende, aber nie deren vertrauliche Angaben (ENT-077)',
    darf(['rollen' => ['planung']], 'personal_lesen')
    && !darf(['rollen' => ['planung']], 'personal_vertraulich_lesen')
    && !darf(['rollen' => ['planung']], 'personal_vertraulich_schreiben'));
pruef('KRITISCH: Planung darf Mitarbeitende nicht aendern',
    !darf(['rollen' => ['planung']], 'personal_schreiben'));
pruef('KRITISCH: Personal plant nicht und kommt nicht an die Kunden (ENT-077)',
    !darf(['rollen' => ['personal']], 'einsaetze_lesen')
    && !darf(['rollen' => ['personal']], 'kunden_lesen'));
pruef('KRITISCH: Offerten bleiben von den Kunden getrennt (ENT-181)',
    darf(['rollen' => ['planung']], 'kunden_schreiben')
    && !darf(['rollen' => ['planung']], 'offerten_lesen'));
pruef('KRITISCH: die Verwaltung bekommt das Waechtersystem NICHT mit (ENT-169)',
    !darf(['rollen' => ['verwaltung']], 'kontrollpunkte_lesen')
    && !darf(['rollen' => ['verwaltung']], 'rundgaenge_lesen')
    && !darf(['rollen' => ['verwaltung']], 'alarmempfaenger_lesen'));
pruef('KRITISCH: das Waechtersystem kommt an keine Personendaten',
    !darf(['rollen' => ['waechter']], 'personal_lesen')
    && !darf(['rollen' => ['waechter']], 'personal_vertraulich_lesen'));
pruef('KRITISCH: nur die Verwaltung darf Profile vergeben',
    darf(['rollen' => ['verwaltung']], 'rechte_schreiben')
    && !darf(['rollen' => ['planung']], 'rechte_schreiben')
    && !darf(['rollen' => ['personal']], 'rechte_schreiben'));
pruef('KRITISCH: das Logbuch bleibt auch fuer die Verwaltung nur lesbar',
    darf(['rollen' => ['verwaltung']], 'logbuch_lesen')
    && !darf(['rollen' => ['verwaltung']], 'logbuch_schreiben'));

// ── Mehrere Rollen addieren sich, hoechste Stufe gewinnt
$beides = rechte_aus_rollen(['planung', 'personal']);
pruef('KRITISCH: zwei Rollen ergeben die Summe ihrer Rechte',
    in_array('einsaetze_schreiben', $beides, true) && in_array('personal_vertraulich_schreiben', $beides, true));
pruef('Die Reihenfolge der Rollen aendert nichts',
    rechte_aus_rollen(['personal', 'planung']) == $beides);
pruef('KRITISCH: die hoehere Stufe gewinnt, die niedrigere nimmt nichts weg',
    in_array('personal_schreiben', $beides, true));
$stufen = stufen_aus_rollen(['planung', 'personal']);
pruef('Die hoechste Stufe je Bereich laesst sich abfragen',
    $stufen['personal'] === STUFE_SCHREIBEN && $stufen['verfuegbarkeit'] === STUFE_LESEN);

// ── Unbekanntes wirkt nie
pruef('KRITISCH: erfundene Rollen geben kein einziges Recht',
    rechte_aus_rollen(['chef', 'superadmin', 'root']) === []);
pruef('Eine erfundene Rolle neben einer echten aendert die echte nicht',
    rechte_aus_rollen(['erfunden', 'planung']) == rechte_aus_rollen(['planung']));
pruef('Eine leere Rollenliste gibt kein Recht', rechte_aus_rollen([]) === []);
pruef('KRITISCH: eine Rolle mit erfundenem Bereich gibt dafuer kein Recht',
    rechte_aus_rollen(['x'], ['x' => ['stufen' => ['gibtesnicht' => STUFE_SCHREIBEN]]]) === []);
pruef('KRITISCH: eine Rolle mit unmoeglicher Stufe gibt dafuer kein Recht',
    rechte_aus_rollen(['x'], ['x' => ['stufen' => ['logbuch' => STUFE_SCHREIBEN]]]) === []);

// ══════════════ darf() -- die einzige Pruefstelle
pruef('KRITISCH: darf() richtet sich nach den Rollen',
    darf(['rollen' => ['planung']], 'einsaetze_lesen')
    && !darf(['rollen' => ['planung']], 'personal_vertraulich_lesen'));
pruef('KRITISCH: ein mitgeschicktes ist_admin sticht die Rollen NICHT',
    !darf(['rollen' => ['mitarbeitend'], 'ist_admin' => true], 'betrieb_lesen'));
pruef('KRITISCH: eine mitgeschickte Rechteliste sticht ein mitgeschicktes ist_admin NICHT',
    !darf(['rechte' => [], 'ist_admin' => true], 'betrieb_lesen'));
pruef('Ohne Rollen- und Rechteliste gilt der alte Stand (Einrichtung noch nicht gelaufen)',
    darf(['ist_admin' => true], 'betrieb_lesen') && !darf(['ist_admin' => false], 'betrieb_lesen'));
pruef('KRITISCH: ein unbekanntes Recht wird nie gewaehrt',
    !darf(['rollen' => ['verwaltung']], 'gibtesnicht'));

// require_recht weist mit 403 ab, nicht mit 401
try {
    $GLOBALS['abgewiesen'] = null;
    require_recht(['rollen' => ['planung']], 'betrieb_schreiben');
    pruef('KRITISCH: require_recht laesst ein fehlendes Recht nicht durch', false);
} catch (RuntimeException $e) {
    $a = $GLOBALS['abgewiesen'];
    pruef('KRITISCH: require_recht weist ab', $a !== null);
    pruef('Es antwortet 403 (angemeldet, aber nicht befugt) statt 401', $a['status'] === 403);
    pruef('Die Meldung nennt das fehlende Recht', ($a['daten']['recht'] ?? '') === 'betrieb_schreiben');
}
$GLOBALS['abgewiesen'] = null;
require_recht(['rollen' => ['verwaltung']], 'betrieb_schreiben');
pruef('Wer das Recht hat, wird nicht abgewiesen', $GLOBALS['abgewiesen'] === null);

// ── Pruefung nach Methode: der Kern der Stufe "lesen"
$leser = ['rechte' => ['objekte_lesen']];
foreach ([['GET', true], ['HEAD', true], ['POST', false], ['DELETE', false], ['PUT', false]] as [$m, $durch]) {
    $_SERVER['REQUEST_METHOD'] = $m;
    $GLOBALS['abgewiesen'] = null;
    try { require_recht_nach_methode($leser, 'objekte'); } catch (RuntimeException $e) {}
    pruef('KRITISCH: wer nur lesen darf, kommt mit ' . $m . ($durch ? ' durch' : ' NICHT durch'),
        ($GLOBALS['abgewiesen'] === null) === $durch);
}
// Eine unbekannte Methode faellt auf die STRENGERE Seite -- nicht auf die
// bequeme. Sonst waere jede neue HTTP-Methode ein offenes Tor.
$_SERVER['REQUEST_METHOD'] = 'PATCH';
$GLOBALS['abgewiesen'] = null;
try { require_recht_nach_methode($leser, 'objekte'); } catch (RuntimeException $e) {}
pruef('KRITISCH: eine unbekannte Methode gilt als Schreiben, nicht als Lesen',
    $GLOBALS['abgewiesen'] !== null);
$_SERVER['REQUEST_METHOD'] = 'GET';

// ── Cockpit-Zugang wird abgeleitet (ENT-440)
pruef('KRITISCH: wer kein einziges Recht hat, kommt nicht ins Cockpit',
    !darf_verwaltung(['rechte' => []]) && !darf_verwaltung(['rollen' => ['mitarbeitend']]));
pruef('Wer irgendetwas lesen darf, kommt ins Cockpit',
    darf_verwaltung(['rechte' => ['auslagen_lesen']])
    && darf_verwaltung(['rollen' => ['waechter']]));

// ══════════════ DATENBANKTEIL -- gegen eine echte Datenbank
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, ist_admin INT, aktiv INT)');
$pdo->exec('CREATE TABLE mitarbeiter_rollen (id INTEGER PRIMARY KEY AUTOINCREMENT,
            mitarbeiter_id INT, rolle TEXT, UNIQUE (mitarbeiter_id, rolle))');
$pdo->exec('CREATE TABLE rollen (id INTEGER PRIMARY KEY AUTOINCREMENT, schluessel TEXT UNIQUE,
            titel TEXT, text TEXT, system INT DEFAULT 0)');
$pdo->exec('CREATE TABLE rollen_rechte (id INTEGER PRIMARY KEY AUTOINCREMENT, rolle_id INT,
            bereich TEXT, stufe TEXT, UNIQUE (rolle_id, bereich))');
$pdo->exec("INSERT INTO mitarbeiter VALUES (1,'chefin',1,1),(2,'planer',0,1),(3,'hilfe',0,1),(4,'weg',1,0)");
$pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES
            (1,'verwaltung'),(2,'planung'),(3,'mitarbeitend'),(4,'verwaltung')");
$chefin = ['id' => 1, 'name' => 'chefin'];

// Die Systemrollen so saeen, wie es die Einrichtung tut.
$ein = $pdo->prepare('INSERT INTO rollen (schluessel, titel, text, system) VALUES (?, ?, ?, 1)');
$einR = $pdo->prepare('INSERT INTO rollen_rechte (rolle_id, bereich, stufe) VALUES (?, ?, ?)');
foreach (system_rollen() as $schluessel => $d) {
    $ein->execute([$schluessel, $d['titel'], $d['text']]);
    $id = (int)$pdo->lastInsertId();
    foreach ($d['stufen'] as $b => $st) { $einR->execute([$id, $b, $st]); }
}

// ── Die Definitionen aus der Datenbank muessen dasselbe sagen wie der Code
$defs = rollen_definitionen($pdo);
pruef('KRITISCH: die gesaeten Systemrollen aus der Datenbank ergeben dieselben Rechte wie der Code',
    (function () use ($defs) {
        foreach (array_keys(system_rollen()) as $r) {
            if (rechte_aus_rollen([$r], $defs) !== rechte_aus_rollen([$r])) { return false; }
        }
        return true;
    })());
pruef('Die Datenbank kennzeichnet sie als Systemrollen',
    count(array_filter($defs, fn($d) => $d['system'])) === 5);

// ── Der Zwischenzustand: Rollen zugeteilt, Profiltabellen noch nicht da
$GLOBALS['tabellen']['rollen'] = false;
$GLOBALS['tabellen']['rollen_rechte'] = false;
$rueckfall = rollen_definitionen($pdo);
pruef('KRITISCH: ohne die Profiltabellen gilt der Code-Katalog, nicht "keine Rechte"',
    array_keys($rueckfall) === array_keys(system_rollen())
    && rechte_aus_rollen(['verwaltung'], $rueckfall) === rechte_aus_rollen(['verwaltung']));
pruef('Ohne die Profiltabellen laesst sich kein Profil anlegen, statt still nichts zu tun',
    str_contains((string)(rolle_speichern($pdo, null, 'Neu', '', [], $chefin)['fehler'] ?? ''), 'Einrichtung'));
$GLOBALS['tabellen']['rollen'] = true;
$GLOBALS['tabellen']['rollen_rechte'] = true;

pruef('Die Rollen einer Person werden gelesen', rechte_rollen($pdo, 2) === ['planung']);
pruef('KRITISCH: eine erfundene Rolle in der Datenbank gibt kein einziges Recht',
    (function () use ($pdo, $defs) {
        $pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (3,'superadmin')");
        $r = rechte_aus_rollen(rechte_rollen($pdo, 3), $defs);
        $pdo->exec("DELETE FROM mitarbeiter_rollen WHERE rolle='superadmin'");
        return $r === [];
    })());
pruef('Wer noch keinen Eintrag hat, behaelt den alten Stand statt rechtlos zu sein',
    rechte_rollen($pdo, 99, true) === ['verwaltung'] && rechte_rollen($pdo, 99, false) === ['mitarbeitend']);

$GLOBALS['tabellen']['mitarbeiter_rollen'] = false;
pruef('KRITISCH: ohne Tabelle faellt es auf den alten Stand zurueck, statt alle auszusperren',
    rechte_rollen($pdo, 2, true) === ['verwaltung']);
pruef('Ohne Tabelle wird nichts gesetzt, sondern auf die Einrichtung hingewiesen',
    str_contains((string)rechte_setzen($pdo, 2, ['personal'], $chefin), 'Einrichtung'));
$GLOBALS['tabellen']['mitarbeiter_rollen'] = true;

// ── Setzen
$GLOBALS['logbuch'] = [];
pruef('Rollen lassen sich setzen', rechte_setzen($pdo, 2, ['planung', 'personal'], $chefin) === null);
pruef('KRITISCH: beide Rollen stehen danach da',
    rechte_rollen($pdo, 2) == ['planung', 'personal'] || rechte_rollen($pdo, 2) == ['personal', 'planung']);
pruef('Die Aenderung steht im Logbuch', count($GLOBALS['logbuch']) === 1);
pruef('Im Logbuch steht, WER es war', ($GLOBALS['logbuch'][0]['akteur']['name'] ?? '') === 'chefin');
pruef('Im Logbuch steht der alte und der neue Stand',
    $GLOBALS['logbuch'][0]['alt'] === 'planung'
    && str_contains((string)$GLOBALS['logbuch'][0]['neu'], 'personal'));

$GLOBALS['logbuch'] = [];
rechte_setzen($pdo, 2, ['personal', 'planung'], $chefin);
pruef('KRITISCH: dieselben Rollen in anderer Reihenfolge sind keine Aenderung',
    count($GLOBALS['logbuch']) === 0);

pruef('KRITISCH: eine erfundene Rolle wird nicht gespeichert',
    rechte_setzen($pdo, 3, ['mitarbeitend', 'superadmin'], $chefin) === null
    && rechte_rollen($pdo, 3) === ['mitarbeitend']);
pruef('KRITISCH: gar keine gueltige Rolle wird abgewiesen',
    rechte_setzen($pdo, 3, ['erfunden'], $chefin) !== null);
pruef('Eine leere Liste wird abgewiesen', rechte_setzen($pdo, 3, [], $chefin) !== null);

// ── ist_admin wird nachgefuehrt -- seit ENT-440 am RECHT, nicht am Namen
rechte_setzen($pdo, 3, ['verwaltung'], $chefin);
pruef('Wer Profile vergeben darf, hat danach auch ist_admin gesetzt',
    (int)$pdo->query('SELECT ist_admin FROM mitarbeiter WHERE id=3')->fetchColumn() === 1);
rechte_setzen($pdo, 3, ['mitarbeitend'], $chefin);
pruef('Wer es verliert, verliert auch ist_admin',
    (int)$pdo->query('SELECT ist_admin FROM mitarbeiter WHERE id=3')->fetchColumn() === 0);

// ══════════════ EIGENE PROFILE (ENT-440)
$erg = rolle_speichern($pdo, null, 'Disposition ohne Kundenpflege',
    'Plant Einsätze, sieht Kunden nur an.',
    ['einsaetze' => STUFE_SCHREIBEN, 'kunden' => STUFE_LESEN], $chefin);
pruef('Ein eigenes Profil laesst sich anlegen', isset($erg['schluessel']) && $erg['schluessel'] !== '');
$disp = $erg['schluessel'];
pruef('Der Schluessel wird aus dem Titel gebildet und ist maschinenlesbar',
    preg_match('/^[a-z0-9_]+$/', $disp) === 1);
$defs = rollen_definitionen($pdo);
pruef('KRITISCH: das eigene Profil wirkt genau so, wie es gesetzt wurde',
    rechte_aus_rollen([$disp], $defs) === ['einsaetze_lesen', 'einsaetze_schreiben', 'kunden_lesen']);
pruef('KRITISCH: OP-74 ist damit loesbar -- Kunden ansehen ohne bearbeiten zu duerfen',
    in_array('kunden_lesen', rechte_aus_rollen([$disp], $defs), true)
    && !in_array('kunden_schreiben', rechte_aus_rollen([$disp], $defs), true));
pruef('Das Profil ist keine Systemrolle', ($defs[$disp]['system'] ?? true) === false);
pruef('Die Profilaenderung steht im Logbuch',
    count(array_filter($GLOBALS['logbuch'], fn($z) => $z['bereich'] === 'rollen')) >= 1);

// ── Was NICHT gehen darf
pruef('KRITISCH: eine Systemrolle laesst sich nicht aendern',
    str_contains((string)(rolle_speichern($pdo, 'verwaltung', 'Alles', '', [], $chefin)['fehler'] ?? ''),
        'Systemrollen'));
pruef('KRITISCH: und sie steht danach unveraendert da',
    rechte_aus_rollen(['verwaltung'], rollen_definitionen($pdo)) === rechte_aus_rollen(['verwaltung']));
pruef('KRITISCH: eine Systemrolle laesst sich nicht loeschen',
    str_contains((string)rolle_loeschen($pdo, 'waechter', $chefin), 'Systemrollen'));
pruef('Ein Profil ohne Namen wird abgewiesen',
    isset(rolle_speichern($pdo, null, '   ', '', [], $chefin)['fehler']));
pruef('KRITISCH: ein erfundener Bereich wird abgewiesen, nicht still verschluckt',
    str_contains((string)(rolle_speichern($pdo, $disp, 'x', '', ['gibtesnicht' => STUFE_LESEN], $chefin)['fehler'] ?? ''),
        'Unbekannter Bereich'));
pruef('KRITISCH: eine Schreibstufe, die es im Bereich nicht gibt, wird abgewiesen',
    str_contains((string)(rolle_speichern($pdo, $disp, 'x', '', ['logbuch' => STUFE_SCHREIBEN], $chefin)['fehler'] ?? ''),
        'Logbuch'));
pruef('KRITISCH: nach einer abgewiesenen Aenderung steht das Profil unveraendert da',
    rechte_aus_rollen([$disp], rollen_definitionen($pdo)) === ['einsaetze_lesen', 'einsaetze_schreiben', 'kunden_lesen']);

// ── Zwei Profile mit demselben Titel bekommen verschiedene Schluessel
$zweit = rolle_speichern($pdo, null, 'Disposition ohne Kundenpflege', '', ['objekte' => STUFE_LESEN], $chefin);
pruef('Zwei Profile mit gleichem Titel bekommen verschiedene Schluessel',
    ($zweit['schluessel'] ?? '') !== '' && $zweit['schluessel'] !== $disp);

// ── Loeschen nur, solange es niemand traegt
rechte_setzen($pdo, 3, [$disp], $chefin);
pruef('KRITISCH: ein zugeteiltes Profil laesst sich nicht loeschen',
    str_contains((string)rolle_loeschen($pdo, $disp, $chefin), 'zugeteilt'));
pruef('Die Meldung nennt die Zahl der Betroffenen',
    str_contains((string)rolle_loeschen($pdo, $disp, $chefin), '1 Person'));
rechte_setzen($pdo, 3, ['mitarbeitend'], $chefin);
pruef('Ohne Traeger laesst es sich loeschen', rolle_loeschen($pdo, $disp, $chefin) === null);
pruef('Danach ist es weg', !isset(rollen_definitionen($pdo)[$disp]));
pruef('Ein Profil, das es nicht gibt, laesst sich nicht loeschen',
    rolle_loeschen($pdo, 'gibtesnichtmehr', $chefin) !== null);

// ══════════════ AUSSPERRSCHUTZ -- seit ENT-440 am Recht, nicht am Rollennamen
pruef('Eine inaktive Person zaehlt nicht als vorhandene Verwaltung',
    rechte_verwaltung_zahl($pdo, 1) === 0);
$fehler = rechte_setzen($pdo, 1, ['personal'], $chefin);
pruef('KRITISCH: die letzte Person, die Profile vergeben darf, kann sich das nicht wegnehmen',
    $fehler !== null);
pruef('Die Meldung sagt, was zu tun ist', str_contains((string)$fehler, 'Rollen & Berechtigungen'));
pruef('KRITISCH: und das Recht steht danach unveraendert da',
    in_array('rechte_schreiben', rechte_aus_rollen(rechte_rollen($pdo, 1), rollen_definitionen($pdo)), true));

// Der eigentliche Fortschritt: Auch ein EIGENES Profil mit dem Recht zaehlt.
// Am Rollennamen festgemacht haette die Sperre hier zugeschlagen, obwohl
// jemand anders sehr wohl noch Profile vergeben kann.
$vertret = rolle_speichern($pdo, null, 'Rechteverwaltung', 'Nur Profile vergeben.',
    ['rechte' => STUFE_SCHREIBEN], $chefin)['schluessel'];
rechte_setzen($pdo, 3, [$vertret], $chefin);
pruef('KRITISCH: ein eigenes Profil mit "Rollen & Berechtigungen: schreiben" zaehlt als Vertretung',
    rechte_verwaltung_zahl($pdo, 1) === 1);
pruef('KRITISCH: damit darf die Verwaltung ihre Rolle abgeben',
    rechte_setzen($pdo, 1, ['personal'], $chefin) === null);
pruef('KRITISCH: es bleibt immer mindestens eine Person uebrig, die Profile vergeben kann',
    rechte_verwaltung_zahl($pdo, 0) >= 1);

// Und der Fall, der die beiden Bauarten des Aussperrschutzes UNTERSCHEIDET.
// Ohne ihn bliebe die Pruefung auch dann gruen, wenn die Sperre wieder am
// Rollennamen "verwaltung" haengt statt am Recht -- gefunden durch eine
// Gegenprobe, die nicht anschlug (CLAUDE.md: eine Pruefung, die nie
// angeschlagen hat, ist eine Behauptung).
//
// Stand hier: Person 1 hat nur noch 'personal', Person 3 traegt das eigene
// Profil mit 'rechte: schreiben' und ist damit die EINZIGE aktive Person,
// die noch Profile vergeben kann -- ohne jemals die Systemrolle
// "verwaltung" gehabt zu haben.
pruef('Vorbedingung: genau eine Person kann noch Profile vergeben, und zwar ueber ein eigenes Profil',
    rechte_verwaltung_zahl($pdo, 0) === 1
    && !in_array(ROLLE_VERWALTUNG, rechte_rollen($pdo, 3), true)
    && in_array('rechte_schreiben', rechte_aus_rollen(rechte_rollen($pdo, 3), rollen_definitionen($pdo)), true));
$fehler2 = rechte_setzen($pdo, 3, ['mitarbeitend'], $chefin);
pruef('KRITISCH: auch wer das Recht nur ueber ein EIGENES Profil hat, kann sich nicht selbst aussperren',
    $fehler2 !== null);
pruef('KRITISCH: und das Profil steht danach unveraendert da',
    in_array('rechte_schreiben', rechte_aus_rollen(rechte_rollen($pdo, 3), rollen_definitionen($pdo)), true));

// ── Sammelabfrage
$alle = rechte_rollen_alle($pdo);
pruef('Die Sammelabfrage liefert je Person eine Liste',
    isset($alle[1]) && isset($alle[3]) && is_array($alle[1]));
pruef('Die Sammelabfrage stimmt mit der Einzelabfrage ueberein',
    $alle[3] == rechte_rollen($pdo, 3));
$kurz = rollen_kurzliste($pdo);
pruef('Die Kurzliste nennt jedes Profil mit Titel und Systemkennzeichen',
    count($kurz) === count(rollen_definitionen($pdo))
    && count(array_filter($kurz, fn($p) => isset($p['schluessel'], $p['titel'], $p['system']))) === count($kurz));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
