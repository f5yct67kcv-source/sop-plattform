<?php
declare(strict_types=1);
// Echte Ausfuehrung des Rechtekerns (ENT-077).
//
// Die Browser-Suiten taeuschen die Serverantwort vor und kaemen an dieser
// Stelle nie vorbei -- eine Rechteregel, die niemand ausfuehrt, ist eine
// Behauptung. Darum laeuft hier der echte Quelltext, und die
// Datenbankfunktionen laufen gegen eine wirkliche Datenbank (SQLite im
// Arbeitsspeicher) statt gegen einen nachgebauten Ablauf.

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// Die beiden Funktionen, die rechte.php aus db.php erwartet. hat_tabelle()
// fragt sonst information_schema ab -- das gibt es in SQLite nicht.
$GLOBALS['tabelleDa'] = true;
function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool { return $GLOBALS['tabelleDa']; }
$GLOBALS['abgewiesen'] = null;
function json_response($data, int $status = 200): void {
    $GLOBALS['abgewiesen'] = ['status' => $status, 'daten' => $data];
    throw new RuntimeException('abgewiesen');
}
// Wird von rechte_setzen() ueber function_exists() gesucht. Hier
// mitgeschrieben, damit sich pruefen laesst, dass eine Rollenaenderung
// tatsaechlich ins Logbuch geht.
$GLOBALS['logbuch'] = [];
function logbuch_schreiben(PDO $pdo, array $akteur, string $bereich, int $objektId,
                           string $feld, ?string $alt, ?string $neu, bool $ohneWerte = false): bool {
    $GLOBALS['logbuch'][] = compact('akteur', 'bereich', 'objektId', 'feld', 'alt', 'neu', 'ohneWerte');
    return true;
}

require __DIR__ . '/../backend/rechte.php';

// ══════════════ DER KATALOG SELBST
$katalog = rollen_katalog();
pruef('Es gibt die vier urspruenglichen Rollen plus die Waechtersystem-Rolle (ENT-180)',
    count($katalog) === 5);
pruef('Die Rollen heissen wie entschieden',
    array_keys($katalog) === ['mitarbeitend', 'planung', 'personal', 'verwaltung', 'waechter']);
pruef('Jede Rolle hat Titel und erklaerenden Text',
    count(array_filter($katalog, fn($r) => $r['titel'] !== '' && strlen($r['text']) > 30)) === 5);

$alleRechte = array_keys(rechte_katalog());
$benutzt = [];
foreach ($katalog as $r) { $benutzt = array_merge($benutzt, $r['rechte']); }
pruef('Keine Rolle vergibt ein Recht, das es nicht gibt',
    array_diff(array_unique($benutzt), $alleRechte) === []);
pruef('Kein Recht existiert, das keine Rolle je vergibt',
    array_diff($alleRechte, array_unique($benutzt)) === []);
pruef('Jedes Recht ist erklaert',
    count(array_filter(rechte_katalog(), fn($t) => strlen($t) > 10)) === count($alleRechte));

// ══════════════ WER DARF WAS
pruef('KRITISCH: Mitarbeitend darf gar nichts in der Verwaltung',
    rechte_aus_rollen(['mitarbeitend']) === []);

// Seit ENT-169/ENT-180 bedeutet "Verwaltung" nicht mehr woertlich ALLE
// existierenden Rechte: Die Waechtersystem-Rechte sitzen bewusst ausserhalb
// (ENT-169: "nur ausgewaehlte Benutzer"), auch fuer die Verwaltungsrolle.
// Wer beides braucht, bekommt beide Rollen -- das ist der Zweck der
// Mehrfachrollen-Logik weiter unten.
$urspruenglicheAcht = ['plan', 'kunden', 'abgleich', 'personal_lesen',
    'personal_schreiben', 'personal_vertraulich', 'betrieb', 'rechte'];
pruef('KRITISCH: Verwaltung darf alles aus den urspruenglichen acht Rechten (ENT-077)',
    count(array_diff($urspruenglicheAcht, rechte_aus_rollen(['verwaltung']))) === 0);
pruef('KRITISCH: Verwaltung bekommt die Waechtersystem-Rechte NICHT automatisch (ENT-169)',
    count(array_intersect(['rundgang_verwalten', 'rundgang_einsehen', 'alarmempfaenger'],
        rechte_aus_rollen(['verwaltung']))) === 0);

$planung = rechte_aus_rollen(['planung']);
pruef('KRITISCH: Planung sieht Mitarbeitende, aber nicht die vertraulichen Angaben',
    in_array('personal_lesen', $planung, true) && !in_array('personal_vertraulich', $planung, true));
pruef('KRITISCH: Planung darf Mitarbeitende nicht aendern',
    !in_array('personal_schreiben', $planung, true));
pruef('KRITISCH: Planung kommt nicht an die Rollenvergabe',
    !in_array('rechte', $planung, true) && !in_array('betrieb', $planung, true));
pruef('Planung darf planen', in_array('plan', $planung, true));

$personal = rechte_aus_rollen(['personal']);
pruef('Personal sieht die vertraulichen Angaben',
    in_array('personal_vertraulich', $personal, true));
pruef('KRITISCH: Personal darf nicht planen und nicht an die Kunden',
    !in_array('plan', $personal, true) && !in_array('kunden', $personal, true));
pruef('KRITISCH: Personal kommt nicht an die Rollenvergabe',
    !in_array('rechte', $personal, true));

// Waechtersystem (ENT-169/ENT-180) -- quer zu den vier ursprünglichen
// Rollen, siehe Kommentar bei ROLLE_WAECHTER in rechte.php.
$waechter = rechte_aus_rollen(['waechter']);
pruef('Waechtersystem darf Kontrollpunkte verwalten, Rundgaenge einsehen und Alarmempfaenger sein',
    in_array('rundgang_verwalten', $waechter, true)
    && in_array('rundgang_einsehen', $waechter, true)
    && in_array('alarmempfaenger', $waechter, true));
pruef('KRITISCH: Waechtersystem kommt an nichts ausserhalb seiner drei Rechte heran',
    count(array_diff($waechter, ['rundgang_verwalten', 'rundgang_einsehen', 'alarmempfaenger'])) === 0);

// Mehrfachrollen -- der Grund, warum es die Tabelle gibt
$beides = rechte_aus_rollen(['planung', 'personal']);
pruef('KRITISCH: zwei Rollen ergeben die Summe beider Rechte',
    in_array('plan', $beides, true) && in_array('personal_vertraulich', $beides, true));
pruef('KRITISCH: zwei Rollen ergeben NICHT mehr als die Summe',
    !in_array('betrieb', $beides, true) && !in_array('rechte', $beides, true));
pruef('KRITISCH: Planung plus Waechtersystem ergibt beide Rechtesets, keine Rolle verdraengt die andere',
    (function () use ($planung, $waechter) {
        $kombiniert = rechte_aus_rollen(['planung', 'waechter']);
        return count(array_diff($planung, $kombiniert)) === 0
            && count(array_diff($waechter, $kombiniert)) === 0;
    })());
pruef('Die Reihenfolge der Rollen aendert nichts',
    rechte_aus_rollen(['personal', 'planung']) == $beides);

// Erfundene Rollen sind wirkungslos, nicht allmaechtig
pruef('KRITISCH: eine erfundene Rolle gibt kein einziges Recht',
    rechte_aus_rollen(['chef', 'superadmin', 'root']) === []);
pruef('Eine erfundene Rolle hebt eine echte nicht auf',
    rechte_aus_rollen(['erfunden', 'planung']) == $planung);
pruef('Eine leere Rollenliste gibt kein Recht', rechte_aus_rollen([]) === []);

// ══════════════ darf() -- die einzige Pruefstelle
pruef('KRITISCH: darf() richtet sich nach den Rollen',
    darf(['rollen' => ['planung']], 'plan')
    && !darf(['rollen' => ['planung']], 'personal_vertraulich'));
pruef('KRITISCH: ein mitgeschicktes ist_admin sticht die Rollen NICHT',
    !darf(['rollen' => ['mitarbeitend'], 'ist_admin' => true], 'betrieb'));
pruef('Ohne Rollenliste gilt der alte Stand (Einrichtung noch nicht gelaufen)',
    darf(['ist_admin' => true], 'betrieb') && !darf(['ist_admin' => false], 'betrieb'));
pruef('KRITISCH: ein unbekanntes Recht wird nie gewaehrt',
    !darf(['rollen' => ['verwaltung']], 'gibtesnicht'));

// require_recht weist mit 403 ab, nicht mit 401
try {
    $GLOBALS['abgewiesen'] = null;
    require_recht(['rollen' => ['planung']], 'betrieb');
    pruef('KRITISCH: require_recht laesst ein fehlendes Recht nicht durch', false);
} catch (RuntimeException $e) {
    $a = $GLOBALS['abgewiesen'];
    pruef('KRITISCH: require_recht weist ab', $a !== null);
    pruef('Es antwortet 403 (angemeldet, aber nicht befugt) statt 401', $a['status'] === 403);
    pruef('Die Meldung nennt das fehlende Recht', ($a['daten']['recht'] ?? '') === 'betrieb');
}
$GLOBALS['abgewiesen'] = null;
require_recht(['rollen' => ['verwaltung']], 'betrieb');
pruef('Wer das Recht hat, wird nicht abgewiesen', $GLOBALS['abgewiesen'] === null);

// ══════════════ DATENBANKTEIL -- gegen eine echte Datenbank
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                                               PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, ist_admin INT, aktiv INT)');
$pdo->exec('CREATE TABLE mitarbeiter_rollen (id INTEGER PRIMARY KEY AUTOINCREMENT,
            mitarbeiter_id INT, rolle TEXT, UNIQUE (mitarbeiter_id, rolle))');
$pdo->exec("INSERT INTO mitarbeiter VALUES (1,'chefin',1,1),(2,'planer',0,1),(3,'hilfe',0,1),(4,'weg',1,0)");
$pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES
            (1,'verwaltung'),(2,'planung'),(3,'mitarbeitend'),(4,'verwaltung')");
$chefin = ['id' => 1, 'name' => 'chefin'];

pruef('Die Rollen einer Person werden gelesen', rechte_rollen($pdo, 2) === ['planung']);
pruef('KRITISCH: eine erfundene Rolle in der Datenbank wird beim Lesen verworfen',
    (function () use ($pdo) {
        $pdo->exec("INSERT INTO mitarbeiter_rollen (mitarbeiter_id, rolle) VALUES (3,'superadmin')");
        $r = rechte_rollen($pdo, 3);
        $pdo->exec("DELETE FROM mitarbeiter_rollen WHERE rolle='superadmin'");
        return $r === ['mitarbeitend'];
    })());
pruef('Wer noch keinen Eintrag hat, behaelt den alten Stand statt rechtlos zu sein',
    rechte_rollen($pdo, 99, true) === ['verwaltung'] && rechte_rollen($pdo, 99, false) === ['mitarbeitend']);

$GLOBALS['tabelleDa'] = false;
pruef('KRITISCH: ohne Tabelle faellt es auf den alten Stand zurueck, statt alle auszusperren',
    rechte_rollen($pdo, 2, true) === ['verwaltung']);
pruef('Ohne Tabelle wird nichts gesetzt, sondern auf die Einrichtung hingewiesen',
    str_contains((string)rechte_setzen($pdo, 2, ['personal'], $chefin), 'Einrichtung'));
$GLOBALS['tabelleDa'] = true;

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

// ── ist_admin wird nachgefuehrt
rechte_setzen($pdo, 3, ['verwaltung'], $chefin);
pruef('Wer die Verwaltung bekommt, hat danach auch ist_admin gesetzt',
    (int)$pdo->query('SELECT ist_admin FROM mitarbeiter WHERE id=3')->fetchColumn() === 1);
rechte_setzen($pdo, 3, ['mitarbeitend'], $chefin);
pruef('Wer sie verliert, verliert auch ist_admin',
    (int)$pdo->query('SELECT ist_admin FROM mitarbeiter WHERE id=3')->fetchColumn() === 0);

// ── Aussperrschutz
pruef('Eine inaktive Person zaehlt nicht als vorhandene Verwaltung',
    rechte_verwaltung_zahl($pdo, 1) === 0);
$fehler = rechte_setzen($pdo, 1, ['personal'], $chefin);
pruef('KRITISCH: die letzte Verwaltung kann sich die Rolle nicht wegnehmen', $fehler !== null);
pruef('Die Meldung sagt, was zu tun ist', str_contains((string)$fehler, 'Verwaltung'));
pruef('KRITISCH: und die Rolle steht danach unveraendert da',
    in_array('verwaltung', rechte_rollen($pdo, 1), true));

rechte_setzen($pdo, 3, ['verwaltung'], $chefin);
pruef('Mit einer zweiten Verwaltung geht es dann doch',
    rechte_setzen($pdo, 1, ['personal'], $chefin) === null);
pruef('KRITISCH: es bleibt immer mindestens eine Verwaltung uebrig',
    rechte_verwaltung_zahl($pdo, 0) >= 1);

// ── Sammelabfrage
$alle = rechte_rollen_alle($pdo);
pruef('Die Sammelabfrage liefert je Person eine Liste',
    isset($alle[1]) && isset($alle[3]) && is_array($alle[1]));
pruef('Die Sammelabfrage stimmt mit der Einzelabfrage ueberein',
    $alle[3] == rechte_rollen($pdo, 3));

echo $ok . " Pruefungen bestanden\n";
if ($bad) { echo count($bad) . " FEHLGESCHLAGEN:\n - " . implode("\n - ", $bad) . "\n"; exit(1); }
