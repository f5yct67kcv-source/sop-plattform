<?php
declare(strict_types=1);
// Woran der Betrieb merkt, dass der Betreiber geantwortet hat (ENT-685) --
// wirklich ausgefuehrt, gegen eine echte Datenbank.
//
// ANLASS: Der Projektinhaber schrieb als Betreiber eine Antwort. Im Cockpit
// stand davon nichts ausser dem Wort "Antwort erhalten" in einer Liste, die
// man erst aufsuchen muss. Keine Glocke, keine Mail.
//
// DIE ENTSCHEIDUNG, die hier geprueft wird: "Ungelesen" haengt an der
// letzten NACHRICHT und am Zeitpunkt des Lesens -- nicht am Status. Der
// Status sagt, wer am Zug ist, und bleibt auch dann stehen, wenn die
// Antwort laengst gelesen wurde. Wer beides verwechselt, baut eine Glocke,
// die nie aufhoert zu laeuten.
$ok = 0; $bad = [];
function pruef(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

class RueckPdo extends PDO {
    private function um(string $q): string { return str_replace('NOW()', "datetime('now')", $q); }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare($this->um($query), $options);
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$args): PDOStatement|false {
        return parent::query($this->um($query));
    }
}

function hat_tabelle(PDO $pdo, string $t, bool $frisch = false): bool {
    $s = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
    $s->execute([$t]);
    return (bool)$s->fetchColumn();
}
// Ehrlich statt pauschal: Die Spaltenauskunft entscheidet hier mit, ob es
// ueberhaupt eine Aussage gibt -- ein Stub, der immer "ja" sagt, koennte den
// Fall "noch nicht eingerichtet" nicht pruefen.
function hat_spalte(PDO $pdo, string $tabelle, string $spalte): bool {
    if (!hat_tabelle($pdo, $tabelle)) { return false; }
    foreach ($pdo->query("PRAGMA table_info($tabelle)")->fetchAll(PDO::FETCH_ASSOC) as $z) {
        if (strcasecmp((string)$z['name'], $spalte) === 0) { return true; }
    }
    return false;
}

// Stellvertreter fuer den Mailversand: Geprueft wird, WANN ueberhaupt
// verschickt wird und was gemeldet wird -- nicht SMTP. Ohne sie faende
// sv_kunde_benachrichtigen() keine Versandfunktion und meldete immer
// 'kein_versand'; die Entscheidung ueber die Adresse bliebe ungeprueft.
$GLOBALS['gesendet'] = [];
function smtp_konfiguriert(): bool { return true; }
function smtp_senden(string $an, string $name, string $betreff, string $html, string $text): void {
    $GLOBALS['gesendet'][] = ['an' => $an, 'betreff' => $betreff, 'text' => $text];
}

require __DIR__ . '/../backend/supportvorgang.php';

function anlage(bool $mitSpalte = true): PDO {
    $pdo = new RueckPdo('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE support_vorgang (id INTEGER PRIMARY KEY AUTOINCREMENT,
        mandant_id INTEGER, betreff TEXT, art TEXT, status TEXT,
        melder_name TEXT, melder_rolle TEXT, melder_email TEXT DEFAULT \'\','
        . ($mitSpalte ? ' kunde_gelesen_am TEXT NULL,' : '') . '
        bildschirm TEXT, umgebung TEXT,
        eroeffnet_am TEXT DEFAULT (datetime(\'now\')), geaendert_am TEXT NULL,
        erledigt_am TEXT NULL, erinnert_am TEXT NULL)');
    $pdo->exec('CREATE TABLE support_nachricht (id INTEGER PRIMARY KEY AUTOINCREMENT,
        vorgang_id INTEGER, seite TEXT, autor TEXT, text TEXT,
        erstellt_am TEXT DEFAULT (datetime(\'now\')))');
    return $pdo;
}

// Zeiten IMMER relativ zum Lauf. Ein festes Datum nahe beim heutigen Tag
// kippt beim Datumswechsel -- und hier zusaetzlich zur falschen Tageszeit,
// weil sv_kunde_gesehen() mit der echten Uhr stempelt (CLAUDE.md,
// test_datumsfest.mjs).
function zeit(string $versatz): string {
    return date('Y-m-d H:i:s', strtotime($versatz));
}

function vorgang(PDO $pdo, int $mandant, string $betreff): int {
    $pdo->prepare('INSERT INTO support_vorgang (mandant_id, betreff, art, status,
        melder_name, melder_rolle, bildschirm, umgebung)
        VALUES (?, ?, \'frage\', \'neu\', \'Wir\', \'\', \'\', \'\')')->execute([$mandant, $betreff]);
    return (int)$pdo->lastInsertId();
}
function nachricht(PDO $pdo, int $id, string $seite, string $zeit): void {
    $pdo->prepare('INSERT INTO support_nachricht (vorgang_id, seite, autor, text, erstellt_am)
                   VALUES (?, ?, \'x\', \'y\', ?)')->execute([$id, $seite, $zeit]);
}

// ── Die Kernfaelle ───────────────────────────────────────────────────
$pdo = anlage();
$a = vorgang($pdo, 1, 'Rundgaenge fehlen');
nachricht($pdo, $a, 'kunde', zeit('-3 hours'));
pruef('eine Anfrage ohne Antwort meldet nichts', sv_kunde_ungelesen($pdo) === []);

nachricht($pdo, $a, 'betreiber', zeit('-2 hours'));
$offen = sv_kunde_ungelesen($pdo);
pruef('KRITISCH: die Antwort des Betreibers gilt als ungelesen', count($offen) === 1);
pruef('und sie traegt den Betreff mit', ($offen[0]['betreff'] ?? '') === 'Rundgaenge fehlen');

// Gelesen heisst gelesen.
sv_kunde_gesehen($pdo, $a);
pruef('KRITISCH: nach dem Oeffnen meldet sie nichts mehr', sv_kunde_ungelesen($pdo) === []);

// Und eine ZWEITE Antwort danach zaehlt wieder -- sonst erfaehrt der Betrieb
// von jedem Nachtrag nichts, nur weil er den Vorgang einmal offen hatte.
nachricht($pdo, $a, 'betreiber', zeit('+1 hour'));
pruef('KRITISCH: eine spaetere Antwort zaehlt wieder', count(sv_kunde_ungelesen($pdo)) === 1);

// Die eigene Rueckfrage des Betriebs ist keine Antwort an ihn.
sv_kunde_gesehen($pdo, $a);
nachricht($pdo, $a, 'kunde', zeit('+2 hours'));
pruef('KRITISCH: die eigene Nachricht laesst die Glocke nicht laeuten',
    sv_kunde_ungelesen($pdo) === []);

// ── Fremde Vorgaenge bleiben fremd ───────────────────────────────────
$b = vorgang($pdo, 2, 'Anderer Betrieb');
nachricht($pdo, $b, 'betreiber', zeit('+3 hours'));
// Ohne Eingrenzung steht genau der zweite Vorgang da: Beim ersten ist die
// letzte Nachricht die eigene Rueckfrage, er zaehlt zu Recht nicht mit.
pruef('ohne Eingrenzung steht der offene Vorgang da', count(sv_kunde_ungelesen($pdo)) === 1);
pruef('KRITISCH: mit Mandant sieht jeder nur den eigenen',
    count(sv_kunde_ungelesen($pdo, 1)) === 0 && count(sv_kunde_ungelesen($pdo, 2)) === 1);

// ── Ohne die Spalte gibt es keine Aussage ────────────────────────────
// Eine Anlage vor dem Einrichtungslauf WEISS nicht, was gelesen wurde. Sie
// meldet darum nichts -- und der Aufrufer sagt "nicht feststellbar" statt
// "nichts Neues". Ein Rueckfall auf "alles ungelesen" liesse die Glocke bei
// jedem alten Vorgang laeuten.
$alt = anlage(false);
$c = vorgang($alt, 1, 'Alt');
nachricht($alt, $c, 'betreiber', zeit('-2 hours'));
pruef('ohne die Spalte wird nichts behauptet', sv_kunde_ungelesen($alt) === []);
pruef('und der Stempel meldet ehrlich, dass er nicht greifen konnte',
    sv_kunde_gesehen($alt, $c) === false);

// ── Die Mail ─────────────────────────────────────────────────────────
// Ohne Adresse ist die Lage "keine_adresse" und nicht "fehlgeschlagen":
// Zwei verschiedene Aussagen, zwei verschiedene Handgriffe.
$lage = sv_kunde_benachrichtigen(['betreff' => 'X', 'melder_email' => ''], 'Support', null);
pruef('ohne Adresse meldet die Rueckmeldung genau das',
    $lage['lage'] === 'keine_adresse' && $lage['gesendet'] === 0);
$lage2 = sv_kunde_benachrichtigen(['betreff' => 'X', 'melder_email' => 'kein-email'], 'Support', null);
pruef('eine unbrauchbare Adresse zaehlt wie keine', $lage2['lage'] === 'keine_adresse');

$lage3 = sv_kunde_benachrichtigen(
    ['betreff' => 'Rundgaenge fehlen', 'melder_email' => 'melder@example.org',
     'melder_name' => 'Wir'], 'Support', 'https://beispiel.example.org');
pruef('mit Adresse geht die Rueckmeldung raus',
    $lage3['lage'] === 'ok' && $lage3['gesendet'] === 1);
$mail = $GLOBALS['gesendet'][0] ?? [];
pruef('sie geht an die hinterlegte Adresse', ($mail['an'] ?? '') === 'melder@example.org');
pruef('der Betreff nennt die Anfrage', str_contains((string)($mail['betreff'] ?? ''), 'Rundgaenge fehlen'));
// DER TEXT DER ANTWORT GEHOERT NICHT IN DIE MAIL: Sie wandert durch fremde
// Server. Sie sagt, DASS etwas da ist, und nennt den Weg dorthin.
pruef('KRITISCH: der Link fuehrt zur Anlage des Betriebs',
    str_contains((string)($mail['text'] ?? ''), 'https://beispiel.example.org/dashboard.html'));

echo "$ok bestanden\n";
foreach ($bad as $b2) { echo "x $b2\n"; }
exit($bad ? 1 : 0);
