<?php
// Spaltennamen in SQL gegen das tatsaechliche Schema pruefen (ENT-185).
//
// ANLASS: Die Playwright-Suiten bilden jede Serverantwort nach, PHP laeuft
// dabei nie. pruef_php.php schliesst zwei Luecken (unbekannte Funktion,
// ungesetzte Variable), aber nicht diese: Ein Tippfehler in einem
// SPALTENNAMEN kommt an jeder statischen Pruefung vorbei und faellt erst
// beim ersten echten Aufruf auf -- beim Kunden, mitten im Betrieb.
//
// Beim Bau des Offerten-Moduls (ENT-181/184) entstanden neun Endpunkte, die
// bis zum Deploy nie ausgefuehrt wurden. Genau dafuer ist diese Datei da.
//
// WAS SIE PRUEFT:
//   - INSERT INTO t (a, b, c): gibt es a, b, c in t? Und passt die Zahl der
//     WERTE zur Zahl der Spalten? (Werte, nicht Fragezeichen -- in einer
//     VALUES-Liste stehen auch NOW() und CURDATE().)
//   - UPDATE t SET a = ?, b = ?: gibt es a und b in t?
//   - SELECT a, b FROM t (nur EINE Tabelle, ohne JOIN): gibt es a und b?
//   - ... WHERE a = ? AND b IS NULL: gibt es a und b? Eine falsche Spalte im
//     WHERE ist die gefaehrlichere Sorte -- sie entscheidet bei UPDATE und
//     DELETE darueber, welche Zeilen getroffen werden.
//
// WAS SIE BEWUSST NICHT PRUEFT:
//   - Tabellen, deren CREATE TABLE in keiner der vier Schemaquellen steht.
//     Ueber sie weiss diese Datei nichts, und eine Pruefung, die raet, ist
//     schlimmer als keine. Welche uebersprungen wurden, wird ausgegeben --
//     stillschweigend weglassen waere eine Pruefung, die mehr verspricht,
//     als sie haelt. (Derzeit ist die Liste leer: seit die .sql-Dateien
//     mitgelesen werden, sind alle benutzten Tabellen bekannt.)
//   - Abfragen mit JOIN: dort ist ohne Alias-Aufloesung nicht entscheidbar,
//     zu welcher Tabelle eine Spalte gehoert.
//   - Zusammengesetzte SQL-Zeichenketten (Variablen im String). Sie stehen
//     hier nicht zur Debatte, weil ihr Inhalt erst zur Laufzeit feststeht.
//   - Abfragen mit Unterabfragen: dort gehoert ein WHERE nicht zwingend zur
//     aeusseren Tabelle. Siehe die Klammer-Schranke weiter unten.
//   - Datentypen, NULL-Zulaessigkeit, Fremdschluessel -- und natuerlich nicht,
//     ob eine Abfrage fachlich das Richtige tut. Diese Datei ersetzt keinen
//     Lauf gegen eine echte Datenbank (OP-110); sie schliesst genau eine
//     Luecke, diese dafuer vollstaendig.
declare(strict_types=1);

$wurzel = dirname(__DIR__);
$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// Entfernt PHP-Kommentare, BEVOR nach SQL gesucht wird.
//
// ANLASS: Der Kommentar, der einen Fehler ERKLAERT, hat ihn zugedeckt. Ueber
// der reparierten Abfrage in einsatz_position.php stand die Erklaerung
// "... bis ENT-185 stand hier `SELECT id`". Das Muster fand das Wort SELECT
// im Kommentar, las von dort bis zum echten FROM weiter -- und verwarf den
// Treffer dann als "enthaelt eine Variable", weil unterwegs $pdo stand. Die
// Abfrage darunter wurde nie geprueft. Aufgefallen ist das nur, weil die
// Gegenprobe den alten Fehler wieder einbaute und gruen blieb.
//
// Hier ist token_get_all() richtig und ein eigenes Muster falsch: Nur der
// PHP-Zerteiler weiss sicher, was Kommentar ist und was bloss in einer
// Zeichenkette steht (ein // in einer URL etwa).
function ohne_kommentare(string $text): string {
    $raus = '';
    foreach (token_get_all($text) as $t) {
        if (is_array($t)) {
            if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) {
                // Zeilenumbrueche bleiben stehen, damit nicht zwei getrennte
                // Abfragen ueber die vormalige Kommentargrenze hinweg
                // zusammenwachsen.
                $raus .= str_repeat("\n", substr_count($t[1], "\n"));
                continue;
            }
            $raus .= $t[1];
        } else {
            $raus .= $t;
        }
    }
    return $raus;
}

// Zaehlt die Werte einer VALUES-Liste: an Kommas trennen, aber nur auf
// oberster Ebene -- NOW(), CURDATE() und CONCAT(a, b) tragen eigene Kommas,
// die keine Werttrennung sind.
function werte_zaehlen(string $liste): int {
    $tiefe = 0; $anzahl = 1;
    for ($i = 0, $n = strlen($liste); $i < $n; $i++) {
        $c = $liste[$i];
        if ($c === '(') { $tiefe++; }
        elseif ($c === ')') { $tiefe--; }
        elseif ($c === ',' && $tiefe === 0) { $anzahl++; }
    }
    return trim($liste) === '' ? 0 : $anzahl;
}

// ── 1. Das Schema aus den CREATE TABLE-Anweisungen lesen ──────────────────
//
// Vier Quellen, weil das Schema historisch gewachsen ist: Die aeltesten
// Tabellen (mitarbeiter, sessions, kunden, rapporte) stehen in schema.sql und
// werden von Hand in phpMyAdmin ausgefuehrt, die juengeren legt
// planung_einrichten.php zur Laufzeit an. Ohne die .sql-Dateien blieben genau
// die am laengsten benutzten Tabellen ungeprueft.
$schema = [];

// Spalten werden VEREINIGT, nicht ersetzt. Steht eine Tabelle in zwei Quellen,
// ist die eine meist aelter -- und die Vereinigung irrt dann hoechstens zu
// milde (eine entfernte Spalte gilt weiter als bekannt). Ein Ersetzen koennte
// dagegen eine nachtraeglich ergaenzte Spalte verschlucken und reihenweise
// gueltige Abfragen anmeckern. Eine Pruefung mit Fehlalarmen wird ignoriert;
// das ist der teurere Fehler.
$schema_lesen = static function (string $text) use (&$schema): void {
    if (preg_match_all('/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\((.*?)\n\)\s*ENGINE/s',
                       $text, $treffer, PREG_SET_ORDER)) {
        foreach ($treffer as $t) {
            $tabelle = strtolower($t[1]);
            $spalten = [];
            foreach (explode("\n", $t[2]) as $zeile) {
                $zeile = trim($zeile);
                // Kommentare, Schluessel und Fremdschluessel sind keine Spalten.
                if ($zeile === '' || str_starts_with($zeile, '--')) { continue; }
                if (preg_match('/^(PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CONSTRAINT)\b/i', $zeile)) { continue; }
                if (preg_match('/^`?(\w+)`?\s+/', $zeile, $s)) { $spalten[] = strtolower($s[1]); }
            }
            if ($spalten) {
                $schema[$tabelle] = array_values(array_unique(
                    array_merge($schema[$tabelle] ?? [], $spalten)));
            }
        }
    }
    // Spalten, die spaeter per ALTER TABLE dazugekommen sind, gehoeren genauso
    // zum Schema -- ohne sie wuerde diese Pruefung reihenweise gueltige
    // Abfragen anmeckern.
    if (preg_match_all('/ALTER TABLE (\w+) ADD COLUMN `?(\w+)`?/i', $text, $alt, PREG_SET_ORDER)) {
        foreach ($alt as $a) {
            $t = strtolower($a[1]);
            if (isset($schema[$t])) { $schema[$t][] = strtolower($a[2]); }
        }
    }
};

// Reihenfolge: erst die .sql-Grundlagen, dann die Einrichtung -- deren
// ALTER TABLE sollen auf die vollstaendig gelesenen Tabellen treffen.
$quellen = [
    '/backend/schema.sql',
    '/backend/schema_planung.sql',
    '/backend/schema_verfuegbarkeit.sql',
    '/backend/api/planung_einrichten.php',
];
foreach ($quellen as $q) {
    $pfad = $wurzel . $q;
    // Fehlt eine Quelle, ist das ein Befund und keine Nebensache: die
    // Pruefung wuerde dann stillschweigend weniger pruefen.
    check("Die Schemaquelle $q ist vorhanden", is_file($pfad));
    if (is_file($pfad)) { $schema_lesen((string)file_get_contents($pfad)); }
}

check('Das Schema wird ueberhaupt gelesen', count($schema) >= 15);
// Die vier aeltesten Tabellen kommen aus schema.sql. Faellt diese Quelle weg,
// prueft die Datei 82 Abfragen weniger -- 230 statt 312, nachgemessen -- und
// bliebe ohne diese Bedingung trotzdem gruen.
foreach (['kunden', 'mitarbeiter', 'rapporte', 'sessions'] as $t) {
    check("Die Tabelle $t aus schema.sql ist erfasst", isset($schema[$t]));
}
check('Eine bekannte Tabelle ist vollstaendig erfasst',
    isset($schema['einsaetze']) && in_array('kunde_name', $schema['einsaetze'], true));
check('Nachtraeglich ergaenzte Spalten zaehlen mit',
    isset($schema['einsaetze']) && in_array('serie_id', $schema['einsaetze'], true));

// ── 2. Alle Backend-Dateien einsammeln ────────────────────────────────────
$dateien = array_merge(
    glob($wurzel . '/backend/*.php') ?: [],
    glob($wurzel . '/backend/api/*.php') ?: []
);

$geprueft = 0; $uebersprungen = [];

// Eine Spalte gilt als bekannt, wenn sie im Schema steht. `*` und Ausdruecke
// mit Klammern (COUNT(...), NOW()) werden uebergangen.
$kennt = static function (string $tabelle, string $spalte) use ($schema): bool {
    return in_array(strtolower($spalte), $schema[strtolower($tabelle)] ?? [], true);
};

foreach ($dateien as $datei) {
    $kurz = basename(dirname($datei)) . '/' . basename($datei);
    $text = ohne_kommentare((string)file_get_contents($datei));

    // ── INSERT INTO tabelle (spalten) VALUES (...)
    // Die VALUES-Liste wird KLAMMERNBEWUSST gelesen, nicht bis zur naechsten
    // schliessenden Klammer: CURDATE() und NOW() bringen eigene Klammern mit,
    // und ein Muster, das dort abbricht, meldete eine korrekte Abfrage als
    // "5 Werte gegen 7 Spalten".
    if (preg_match_all("/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(/is",
                       $text, $ins, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
        foreach ($ins as $roh) {
            // Offsets zurueck in reine Zeichenketten, plus die Werteliste ab
            // der oeffnenden Klammer bis zu ihrer echten Entsprechung.
            $start = $roh[0][1] + strlen($roh[0][0]);
            $tiefe = 1; $ende = $start;
            for ($k = $start, $n = strlen($text); $k < $n && $tiefe > 0; $k++) {
                if ($text[$k] === '(') { $tiefe++; }
                elseif ($text[$k] === ')') { $tiefe--; if ($tiefe === 0) { $ende = $k; } }
            }
            $i = [$roh[0][0], $roh[1][0], $roh[2][0], substr($text, $start, $ende - $start)];
            $tabelle = strtolower($i[1]);
            if (!isset($schema[$tabelle])) { $uebersprungen[$tabelle] = true; continue; }
            // Ein Spaltenteil mit einer Variablen darin (implode) ist erst zur
            // Laufzeit bekannt -- nicht pruefbar, also uebergehen.
            if (str_contains($i[2], '$') || str_contains($i[2], '.')) { continue; }
            $spalten = array_map('trim', explode(',', $i[2]));
            $geprueft++;
            foreach ($spalten as $sp) {
                $sp = trim($sp, '`');
                check("$kurz: INSERT in $tabelle kennt die Spalte \"$sp\"", $kennt($tabelle, $sp));
            }
            // Zahl der WERTE gegen Zahl der Spalten -- nicht der Fragezeichen:
            // In einer VALUES-Liste stehen auch Literale (NOW(), CURDATE(), 0),
            // und die sind so gueltig wie ein Platzhalter. Eine Zaehlung der
            // Fragezeichen meldete hier vier bestehende, korrekte Abfragen als
            // Fehler. Eine Spalte zuwenig heisst zur Laufzeit nur
            // "SQLSTATE[21S01]" und sonst nichts.
            if (!str_contains($i[3], '$') && !str_contains($i[3], 'repeat')) {
                $werte = werte_zaehlen($i[3]);
                check("$kurz: INSERT in $tabelle hat so viele Werte wie Spalten"
                      . " ($werte gegen " . count($spalten) . ")",
                      $werte === count($spalten));
            }
        }
    }

    // ── UPDATE tabelle SET a = ?, b = ?
    if (preg_match_all("/UPDATE\s+(\w+)\s+SET\s+(.*?)(?:\s+WHERE|\s*['\"])/is",
                       $text, $upd, PREG_SET_ORDER)) {
        foreach ($upd as $u) {
            $tabelle = strtolower($u[1]);
            if (!isset($schema[$tabelle])) { $uebersprungen[$tabelle] = true; continue; }
            if (str_contains($u[2], '$')) { continue; }   // zusammengesetzt
            $geprueft++;
            foreach (explode(',', $u[2]) as $teil) {
                if (!preg_match('/^\s*`?(\w+)`?\s*=/', $teil, $s)) { continue; }
                check("$kurz: UPDATE $tabelle kennt die Spalte \"{$s[1]}\"", $kennt($tabelle, $s[1]));
            }
        }
    }

    // ── Spalten in WHERE-Bedingungen (nur EINE Tabelle, kein JOIN)
    //
    // Die zweite Haelfte des Fehlers, der diese Datei ausgeloest hat, stand
    // genau hier: `UPDATE einsatz_zuteilung SET position_id = ? WHERE id = ?`.
    // Die SET-Spalte war richtig, die WHERE-Spalte nicht -- und nur ueber SET
    // zu pruefen haette den halben Fehler stehen lassen. Eine falsche Spalte
    // im WHERE ist ausserdem die gefaehrlichere Sorte: Bei einem DELETE oder
    // UPDATE entscheidet sie darueber, WELCHE Zeilen getroffen werden.
    // Zwei Muster, nicht eines: Bei UPDATE steht zwischen Tabellenname und
    // WHERE noch die SET-Liste. Ein Muster, das WHERE direkt hinter dem
    // Tabellennamen erwartet, findet nur FROM und DELETE FROM -- und liess
    // damit ausgerechnet die Form ungeprueft, in der die zweite Haelfte des
    // Ausloesefehlers stand. Aufgefallen ist das erst in der Gegenprobe.
    //
    // Im SET-Teil steht [^'\"()]*? statt .*?, und das aus zwei Gruenden:
    //   - ohne die Anfuehrungszeichen-Schranke koennte ein UPDATE ohne WHERE
    //     bis zum WHERE einer voellig anderen Abfrage weiterlesen und deren
    //     Spalten der falschen Tabelle zuschreiben;
    //   - ohne die Klammer-Schranke greift das Muster in eine Unterabfrage
    //     hinein. Genau das passierte bei
    //       UPDATE einsaetze SET bedarf = (SELECT COUNT(*) FROM
    //         einsatz_position WHERE einsatz_id = ?) WHERE id = ?
    //     Das WHERE der Unterabfrage gehoert zu einsatz_position, wurde aber
    //     einsaetze zugeschrieben -- ein Fehlalarm auf voellig korrektem
    //     Code. Steht eine Klammer im SET-Teil, ist die Zuordnung nicht mehr
    //     entscheidbar, und dann wird nicht geraten.
    $whereMuster = [
        "/(?:FROM|DELETE FROM)\s+(\w+)\s+WHERE\s+(.*?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|['\"])/is",
        "/UPDATE\s+(\w+)\s+SET\s+[^'\"()]*?\s+WHERE\s+(.*?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|['\"])/is",
    ];
    foreach ($whereMuster as $muster) {
        if (!preg_match_all($muster, $text, $wh, PREG_SET_ORDER)) { continue; }
        foreach ($wh as $w) {
            $tabelle = strtolower($w[1]);
            if (!isset($schema[$tabelle])) { $uebersprungen[$tabelle] = true; continue; }
            // Variablen, Unterabfragen und Funktionen: erst zur Laufzeit klar.
            // Eine Klammer in JEDE Richtung zaehlt: Eine schliessende allein
            // heisst, dass der Treffer aus einer Unterabfrage herausragt.
            if (str_contains($w[2], '$') || str_contains($w[2], '(')
                || str_contains($w[2], ')')) { continue; }
            if (preg_match('/\bJOIN\b/i', $w[2])) { continue; }
            $geprueft++;
            preg_match_all('/`?(\w+)`?\s*(?:=|<=|>=|<>|!=|<|>|\bIS\b|\bIN\b|\bLIKE\b|\bBETWEEN\b)/i',
                           $w[2], $sp, PREG_SET_ORDER);
            foreach ($sp as $x) {
                $n = strtolower($x[1]);
                // Verknuepfungen und Literale sind keine Spalten.
                if (in_array($n, ['and', 'or', 'not', 'null', 'true', 'false'], true)) { continue; }
                if (is_numeric($n)) { continue; }
                check("$kurz: WHERE auf $tabelle kennt die Spalte \"$n\"", $kennt($tabelle, $n));
            }
        }
    }

    // ── SELECT spalten FROM tabelle  (nur EINE Tabelle, kein JOIN, kein Alias)
    if (preg_match_all("/SELECT\s+((?:(?!\bFROM\b).)*?)\s+FROM\s+(\w+)\s*(?:WHERE|ORDER|GROUP|LIMIT|['\"])/is",
                       $text, $sel, PREG_SET_ORDER)) {
        foreach ($sel as $s0) {
            $tabelle = strtolower($s0[2]);
            if (!isset($schema[$tabelle])) { $uebersprungen[$tabelle] = true; continue; }
            $liste = $s0[1];
            // Ausdruecke, Aliasse, Sternchen und Variablen: nicht pruefbar.
            if (preg_match('/[(*$]| AS | JOIN /i', $liste)) { continue; }
            $geprueft++;
            foreach (explode(',', $liste) as $sp) {
                $sp = trim(trim($sp), '`');
                if ($sp === '' || str_contains($sp, '.')) { continue; }
                // "SELECT 1 FROM ..." ist eine Existenzpruefung, keine Spalte.
                if (is_numeric($sp) || preg_match("/^['\"]/", $sp)) { continue; }
                check("$kurz: SELECT aus $tabelle kennt die Spalte \"$sp\"", $kennt($tabelle, $sp));
            }
        }
    }
}

check('Es wurden ueberhaupt Abfragen geprueft', $geprueft >= 10);

// ── 3. Selbstpruefung ─────────────────────────────────────────────────────
// Eine Pruefung, die nichts mehr findet, meldet fuer immer "bestanden". Genau
// das ist hier einmal passiert (siehe ohne_kommentare()). Die folgenden Proben
// halten fest, dass die Pruefung ihre eigene Arbeit noch tut -- sie pruefen
// nicht den Betriebscode, sondern das Werkzeug.
$SELMUSTER = "/SELECT\s+((?:(?!\bFROM\b).)*?)\s+FROM\s+(\w+)\s*(?:WHERE|ORDER|GROUP|LIMIT|['\"])/is";

$spalten_aus = static function (string $php) use ($SELMUSTER): array {
    preg_match_all($SELMUSTER, ohne_kommentare($php), $m, PREG_SET_ORDER);
    return array_map(static fn($x) => trim(preg_replace('/\s+/', ' ', $x[1])), $m);
};

// (a) Ein Kommentar, der dieselben SQL-Woerter enthaelt, darf die Abfrage
//     darunter nicht verschlucken.
$probeKommentar = <<<'PHP'
<?php
// Bis ENT-185 stand hier `SELECT id`, und die Tabelle hat keine Spalte id.
$z = $pdo->prepare('SELECT mitarbeiter_id FROM einsatz_zuteilung WHERE einsatz_id = ?');
PHP;
check('Ein Kommentar mit SQL-Woertern verdeckt die Abfrage darunter nicht',
    $spalten_aus($probeKommentar) === ['mitarbeiter_id']);

// (b) Und der Fehlerfall wird als solcher sichtbar -- sonst prueft (a) nur,
//     dass irgendetwas gefunden wird, nicht dass das Richtige gefunden wird.
//
//     Der Kommentar darf hier KEIN zweites Wort FROM enthalten. Steht eines
//     darin, endet der Treffer schon im Kommentar, die Abfrage darunter wird
//     ohnehin sauber gelesen -- und die Probe waere gruen, auch wenn das
//     Kommentar-Entfernen gar nicht arbeitet. Genau so war sie zuerst
//     geschrieben, und genau deshalb blieb sie in der Gegenprobe gruen.
$probeFehler = <<<'PHP'
<?php
// Bis ENT-185 stand hier `SELECT id`, und das war falsch.
$z = $pdo->prepare('SELECT id FROM einsatz_zuteilung WHERE einsatz_id = ?');
PHP;
$gefunden = $spalten_aus($probeFehler);
check('Eine unbekannte Spalte wird trotz Kommentar davor gefunden',
    $gefunden === ['id'] && !$kennt('einsatz_zuteilung', 'id'));

// (c) Ein // in einer Zeichenkette ist kein Kommentar. Ein selbstgebautes
//     Muster haette hier den Rest der Zeile weggeworfen.
$probeZeichenkette = <<<'PHP'
<?php
$u = 'https://beispiel.test/pfad';
$s = $pdo->prepare('SELECT nr FROM einsatz_position WHERE einsatz_id = ?');
PHP;
check('Ein // in einer Zeichenkette wird nicht fuer einen Kommentar gehalten',
    $spalten_aus($probeZeichenkette) === ['nr']
    && str_contains(ohne_kommentare($probeZeichenkette), 'beispiel.test'));

// Ehrlich ausweisen, was NICHT geprueft wurde -- eine Pruefung, die ihre
// Luecken verschweigt, liest sich wie eine Garantie, die sie nicht ist.
$namen = array_keys($uebersprungen);
sort($namen);
echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
echo count($schema) . " Tabellen im Schema, $geprueft Abfragen geprueft.\n";
if ($namen) {
    echo "Uebersprungen (Schema nicht in planung_einrichten.php): "
       . implode(', ', $namen) . "\n";
}
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
