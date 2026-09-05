<?php
declare(strict_types=1);
// Der Kern der Spesen-Belegannahme wird AUSGEFUEHRT, nicht im Quelltext
// gelesen (ENT-413). Zwei Regeln stehen hier auf dem Spiel, und beide sind
// sicherheitsrelevant:
//
// 1. Der Mimetyp entsteht aus den ERSTEN BYTES, nie aus der Angabe des
//    Absenders. Wer eine HTML-Datei als "image/png" schickt, darf sie nicht
//    gespeichert bekommen -- sonst laege im Belegarchiv ausfuehrbarer
//    Inhalt, den ein spaeterer Abruf im Ursprung dieser Anwendung oeffnet.
//
// 2. Ein PDF geht ausschliesslich als Download hinaus. Ein PDF kann
//    Skripte tragen; im Dokument eingebettet liefen sie im Ursprung dieser
//    Anwendung.
require_once __DIR__ . '/../backend/spesen.php';

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── Mimetyp aus den ersten Bytes ──────────────────────────────────────
// Echte Dateikoepfe, keine erfundenen: JPEG beginnt mit FF D8 FF, PNG mit
// der achtstelligen Signatur, PDF mit "%PDF-".
$jpeg = "\xFF\xD8\xFF\xE0" . str_repeat("\x00", 32);
$png  = "\x89PNG\r\n\x1a\n" . str_repeat("\x00", 32);
$pdf  = "%PDF-1.7\n" . str_repeat("a", 32);

check('JPEG wird an seinen ersten Bytes erkannt', spesen_beleg_mime($jpeg) === 'image/jpeg');
check('PNG wird an seinen ersten Bytes erkannt', spesen_beleg_mime($png) === 'image/png');
check('PDF wird an seinen ersten Bytes erkannt', spesen_beleg_mime($pdf) === 'application/pdf');

// Das ist der Kern: Was nicht erkannt wird, wird NICHT angenommen. null
// heisst "abgewiesen", nicht "unbekannt, nehmen wir mal".
check('KRITISCH: HTML wird abgewiesen, auch wenn es sich als Bild ausgibt',
    spesen_beleg_mime('<!DOCTYPE html><script>alert(1)</script>') === null);
check('KRITISCH: ein PHP-Schnipsel wird abgewiesen',
    spesen_beleg_mime("<?php system(\$_GET['c']); ?>") === null);
check('KRITISCH: SVG wird abgewiesen -- es kann Skripte tragen',
    spesen_beleg_mime('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') === null);
check('Reiner Text wird abgewiesen', spesen_beleg_mime('einfach nur Text') === null);
check('Eine leere Datei wird abgewiesen', spesen_beleg_mime('') === null);
// Der Kopf muss am ANFANG stehen. Eine Datei, die die PDF-Kennung erst
// spaeter enthaelt, ist kein PDF -- sonst genuegte es, "%PDF-" irgendwo in
// eine HTML-Datei zu schreiben.
check('KRITISCH: eine Kennung mitten in der Datei zaehlt nicht',
    spesen_beleg_mime('<html>%PDF-1.4</html>') === null);

// ── Auslieferung ──────────────────────────────────────────────────────
$kopfPdf = spesen_beleg_kopfzeilen_liste('application/pdf', 1234, 'Beleg-7');
$kopfBild = spesen_beleg_kopfzeilen_liste('image/jpeg', 1234, 'Beleg-7');

check('KRITISCH: ein PDF geht als Download hinaus, nicht zur Anzeige',
    isset($kopfPdf['Content-Disposition'])
    && str_starts_with($kopfPdf['Content-Disposition'], 'attachment'));
check('Ein Bild darf angezeigt werden (kein erzwungener Download)',
    !isset($kopfBild['Content-Disposition']));
check('KRITISCH: Belege werden nicht zwischengespeichert',
    ($kopfPdf['Cache-Control'] ?? '') === 'private, no-store'
    && ($kopfBild['Cache-Control'] ?? '') === 'private, no-store');
check('Der Mimetyp wird nicht vom Browser erraten (nosniff)',
    ($kopfBild['X-Content-Type-Options'] ?? '') === 'nosniff');
check('Die Laenge wird mitgegeben', ($kopfBild['Content-Length'] ?? '') === '1234');

// Ein Dateiname mit Anfuehrungszeichen oder Zeilenumbruch waere eine
// Kopfzeilen-Einschleusung. Er kommt zwar heute nur aus einer eigenen id,
// aber die Funktion darf das nicht voraussetzen.
$boes = spesen_beleg_kopfzeilen_liste('application/pdf', 1, "x\"\r\nSet-Cookie: a=b");
check('KRITISCH: der Dateiname kann keine zweite Kopfzeile einschleusen',
    !str_contains($boes['Content-Disposition'], "\n")
    && !str_contains($boes['Content-Disposition'], "\r")
    && substr_count($boes['Content-Disposition'], '"') === 2);

// ── Kategorien und Grenzen ────────────────────────────────────────────
check('Die Kategorien sind eine feste Liste, kein Freitext',
    spesen_kategorie_gueltig('tanken') && spesen_kategorie_gueltig('sonstiges'));
check('KRITISCH: eine erfundene Kategorie wird abgewiesen',
    !spesen_kategorie_gueltig('phantasie') && !spesen_kategorie_gueltig(''));
// Die Abgrenzung aus OP-392 als Pruefung: Der Auslagenersatz nach Art. 18
// GAV ist KEINE Spesenkategorie. Taucht hier je eine auf, die danach
// klingt, ist die Grenze zwischen Quittungsablage und GAV-Abrechnung
// verwischt -- genau der Fehler, den OP-392 benennt.
$verboten = ['fahrzeit', 'fahrkosten', 'auslagen', 'auslagenersatz', 'wegzeit', 'zone'];
$treffer = array_filter(array_keys(SPESEN_KATEGORIEN),
    static fn($k) => in_array($k, $verboten, true));
check('KRITISCH: keine Kategorie vermengt Quittungsbelege mit dem Auslagenersatz (OP-392)',
    $treffer === []);

check('Die vier Zustaende sind vollstaendig und in der Reihenfolge des Ablaufs',
    SPESEN_STATUS === ['erfasst', 'eingereicht', 'freigegeben', 'abgelehnt']);
check('Die Beleggrenze ist gesetzt und nicht unbegrenzt',
    SPESEN_BELEG_MAX > 0 && SPESEN_BELEG_MAX <= 8 * 1024 * 1024);

// ══════════════════════════════════════════════════════════════════════════
// DIE ZUSTANDSREGELN GEGEN EINE ECHTE DATENBANK
// ══════════════════════════════════════════════════════════════════════════
//
// SQLite im Arbeitsspeicher, gleiches Muster wie pruef_dienstfahrzeug.php.
// Bis hierher wurden die Regeln nur GELESEN -- wer darf einen Beleg aendern,
// ab wann sieht ihn die Verwaltung, was passiert nach einem Entscheid. Eine
// Pruefung, die dafuer den Quelltext durchsucht, bleibt gruen, wenn die
// Formulierung sich aendert und die Sache verschwindet (CLAUDE.md).
//
// Die Tabelle wird hier in SQLite-Schreibweise angelegt; die MySQL-Fassung
// steht in planung_einrichten.php. Dass beide dieselben SPALTEN haben,
// prueft test_spesen.mjs -- sonst liefe diese Reihe gegen eine Tabelle, die
// es so auf dem Server gar nicht gibt.
const SPESEN_TESTSPALTEN = [
    'id', 'mitarbeiter_id', 'datum', 'kategorie', 'betrag_rappen', 'notiz',
    'beleg', 'beleg_mime', 'status', 'erfasst_am', 'eingereicht_am',
    'ablehnung_grund', 'entschieden_von', 'entschieden_am', 'geaendert_am',
];

$pdo = new PDO('sqlite::memory:', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT,
    vorname TEXT, nachname TEXT)');
$pdo->exec("INSERT INTO mitarbeiter (id, name, vorname, nachname)
    VALUES (7, 'dario.beispiel', 'Dario', 'Beispiel'),
           (8, 'anna.beispiel', NULL, NULL),
           (9, 'verwaltung.beispiel', 'Vera', 'Beispiel')");
$pdo->exec("CREATE TABLE spesen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mitarbeiter_id INTEGER NOT NULL,
    datum TEXT NOT NULL,
    kategorie TEXT NOT NULL,
    betrag_rappen INTEGER NOT NULL,
    notiz TEXT NULL,
    beleg BLOB NULL,
    beleg_mime TEXT NULL,
    status TEXT NOT NULL DEFAULT 'erfasst',
    erfasst_am TEXT NULL,
    eingereicht_am TEXT NULL,
    ablehnung_grund TEXT NULL,
    entschieden_von INTEGER NULL,
    entschieden_am TEXT NULL,
    geaendert_am TEXT NULL)");

$ICH = 7; $ANDERE = 8; $VERWALTUNG = 9;
$feld = fn(array $u = []) => array_merge(
    ['datum' => '2026-03-20', 'kategorie' => 'tanken', 'betrag_rappen' => 8540, 'notiz' => 'Tankstelle'], $u);

// ── Anlegen ───────────────────────────────────────────────────────────
$id = spesen_anlegen($pdo, $ICH, $feld(['beleg' => $jpeg, 'beleg_mime' => 'image/jpeg']));
check('Ein neuer Beleg bekommt eine id', $id > 0);
$eigene = spesen_eigene($pdo, $ICH);
check('Er steht danach in der eigenen Liste', count($eigene) === 1);
check('KRITISCH: er beginnt im Zustand "erfasst" -- nicht eingereicht',
    $eigene[0]['status'] === 'erfasst');
check('Die Liste traegt den Beleg NICHT mit, nur den Hinweis darauf',
    !array_key_exists('beleg', $eigene[0]) && $eigene[0]['hat_beleg'] === true
    && $eigene[0]['beleg_ist_pdf'] === false);
check('Der Betrag kommt als ganze Zahl zurueck, nicht als Text',
    $eigene[0]['betrag_rappen'] === 8540);

// ── Die Verwaltung sieht einen erfassten Beleg NICHT ──────────────────
// Das ist der ganze Zweck der Trennung. Bis hierher stand diese Regel nur
// als Zeichenkette im Quelltext.
check('KRITISCH: ein erfasster Beleg erscheint nicht in der Verwaltungsliste',
    spesen_liste_verwaltung($pdo, 'alle') === []);
check('KRITISCH: und sein Beleg wird der Verwaltung nicht herausgegeben',
    spesen_beleg_verwaltung($pdo, $id) === null);
check('Der eigenen Person schon', spesen_beleg_eigen($pdo, $ICH, $id) !== null);
check('KRITISCH: einer FREMDEN Person nicht -- auch nicht mit richtiger id',
    spesen_beleg_eigen($pdo, $ANDERE, $id) === null);

// ── Aendern, solange er in der eigenen Mappe liegt ────────────────────
check('Ein erfasster Beleg laesst sich aendern',
    spesen_aendern($pdo, $ICH, $id, $feld(['betrag_rappen' => 1250]), false, null, null) === 'ok');
check('Die Aenderung steht auch wirklich da',
    spesen_eigene($pdo, $ICH)[0]['betrag_rappen'] === 1250);
check('KRITISCH: der Beleg bleibt dabei erhalten -- Aendern wirft ihn nicht weg',
    spesen_eigene($pdo, $ICH)[0]['hat_beleg'] === true);
check('KRITISCH: eine fremde Person kann ihn nicht aendern',
    spesen_aendern($pdo, $ANDERE, $id, $feld(['betrag_rappen' => 1]), false, null, null) === 'nicht_gefunden');
check('Und der Betrag steht danach unveraendert da',
    spesen_eigene($pdo, $ICH)[0]['betrag_rappen'] === 1250);
check('Ein ausdrueckliches Entfernen loescht den Beleg dann doch',
    spesen_aendern($pdo, $ICH, $id, $feld(['betrag_rappen' => 1250]), true, null, null) === 'ok'
    && spesen_eigene($pdo, $ICH)[0]['hat_beleg'] === false);

// ── Einreichen ────────────────────────────────────────────────────────
check('Einreichen geht aus "erfasst"', spesen_einreichen($pdo, $ICH, $id) === 'ok');
check('Der Zustand steht danach auf "eingereicht"',
    spesen_eigene($pdo, $ICH)[0]['status'] === 'eingereicht');
check('Und der Zeitpunkt ist vermerkt', spesen_eigene($pdo, $ICH)[0]['eingereicht_am'] !== null);
check('KRITISCH: ein zweites Einreichen prallt ab',
    spesen_einreichen($pdo, $ICH, $id) === 'nicht_mehr_erfasst');

// DIE Regel, um die es geht: Ab dem Einreichen ist der Beleg fuer die
// Verwaltung eine feste Groesse. Liesse er sich noch umschreiben, waere die
// Freigabe auf einen anderen Betrag erteilt worden als den, der danach
// dasteht.
check('KRITISCH: ein eingereichter Beleg laesst sich NICHT mehr aendern',
    spesen_aendern($pdo, $ICH, $id, $feld(['betrag_rappen' => 999999]), false, null, null) === 'nicht_mehr_erfasst');
check('Und der Betrag ist wirklich unveraendert geblieben',
    spesen_eigene($pdo, $ICH)[0]['betrag_rappen'] === 1250);
check('KRITISCH: ein eingereichter Beleg laesst sich NICHT loeschen',
    spesen_loeschen($pdo, $ICH, $id) === 'nicht_mehr_erfasst');
check('Er steht danach noch da', count(spesen_eigene($pdo, $ICH)) === 1);

// Jetzt sieht die Verwaltung ihn -- und erst jetzt.
$vw = spesen_liste_verwaltung($pdo, 'eingereicht');
check('KRITISCH: jetzt erscheint er in der Verwaltungsliste', count($vw) === 1);
check('Mit einem fertigen Anzeigenamen aus dem Stamm', ($vw[0]['person'] ?? '') === 'Dario Beispiel');
check('Der Filter greift: unter "freigegeben" steht er nicht',
    spesen_liste_verwaltung($pdo, 'freigegeben') === []);

// ── Zurueckziehen ─────────────────────────────────────────────────────
check('Zurueckziehen geht, solange nicht entschieden ist',
    spesen_zurueckziehen($pdo, $ICH, $id) === 'ok');
check('Danach liegt er wieder in der eigenen Mappe',
    spesen_eigene($pdo, $ICH)[0]['status'] === 'erfasst');
check('Und der Einreiche-Zeitpunkt ist wieder leer',
    spesen_eigene($pdo, $ICH)[0]['eingereicht_am'] === null);
check('KRITISCH: die Verwaltung sieht ihn danach wieder NICHT',
    spesen_liste_verwaltung($pdo, 'alle') === []);
check('Ein erfasster Beleg laesst sich nicht zurueckziehen',
    spesen_zurueckziehen($pdo, $ICH, $id) === 'nicht_eingereicht');

// ── Entscheiden ───────────────────────────────────────────────────────
check('KRITISCH: ein erfasster Beleg laesst sich nicht entscheiden -- auch nicht mit Recht',
    spesen_entscheiden($pdo, $VERWALTUNG, $id, 'freigegeben', null) === 'nicht_eingereicht');
spesen_einreichen($pdo, $ICH, $id);
check('KRITISCH: eine Ablehnung ohne Begruendung wird abgewiesen',
    spesen_entscheiden($pdo, $VERWALTUNG, $id, 'abgelehnt', '   ') === 'grund_fehlt');
check('Und der Beleg ist danach unveraendert eingereicht',
    spesen_eigene($pdo, $ICH)[0]['status'] === 'eingereicht');
check('Ein erfundener Status wird abgewiesen',
    spesen_entscheiden($pdo, $VERWALTUNG, $id, 'genehmigt', null) === 'status_unbekannt');
check('Eine Ablehnung mit Begruendung geht durch',
    spesen_entscheiden($pdo, $VERWALTUNG, $id, 'abgelehnt', 'Bitte über den Materialantrag.') === 'ok');
$nachher = spesen_eigene($pdo, $ICH)[0];
check('Der Grund steht bei der Person', $nachher['ablehnung_grund'] === 'Bitte über den Materialantrag.');
check('Und wer entschieden hat, ist vermerkt',
    (int)$pdo->query("SELECT entschieden_von FROM spesen WHERE id = $id")->fetchColumn() === $VERWALTUNG);

// Erneutes Entscheiden ueberschreibt bewusst -- aber der Ablehnungsgrund
// darf nicht stehenbleiben, sonst traegt ein freigegebener Beleg einen Text,
// der ihn ablehnt.
// Der Grund wird hier ABSICHTLICH mitgeschickt, obwohl freigegeben wird --
// die Oberflaeche tut das auch (sie sendet das Feld immer mit). Wuerde die
// Regel ihn einfach uebernehmen, traege ein freigegebener Beleg einen Text,
// der ihn ablehnt. Mit einem leeren Grund zu pruefen waere wertlos gewesen:
// Die Gegenprobe blieb damit gruen.
check('Ein Entscheid laesst sich korrigieren',
    spesen_entscheiden($pdo, $VERWALTUNG, $id, 'freigegeben', 'versehentlich mitgeschickt') === 'ok');
check('KRITISCH: bei der Freigabe verschwindet der Ablehnungsgrund, auch wenn einer mitkommt',
    spesen_eigene($pdo, $ICH)[0]['ablehnung_grund'] === null);

// Nach dem Entscheid ist Schluss: Ein Entscheid ist ein Beleg, keine Notiz.
check('KRITISCH: ein entschiedener Beleg laesst sich nicht zurueckziehen',
    spesen_zurueckziehen($pdo, $ICH, $id) === 'nicht_eingereicht');
check('KRITISCH: und nicht loeschen', spesen_loeschen($pdo, $ICH, $id) === 'nicht_mehr_erfasst');
check('KRITISCH: und nicht aendern',
    spesen_aendern($pdo, $ICH, $id, $feld(), false, null, null) === 'nicht_mehr_erfasst');

// ── Loeschen, wo es erlaubt ist ───────────────────────────────────────
$id2 = spesen_anlegen($pdo, $ICH, $feld());
check('Ein erfasster Beleg laesst sich loeschen', spesen_loeschen($pdo, $ICH, $id2) === 'ok');
check('Und ist danach weg', count(spesen_eigene($pdo, $ICH)) === 1);
check('Ein zweites Loeschen findet ihn nicht mehr',
    spesen_loeschen($pdo, $ICH, $id2) === 'nicht_gefunden');

// ── Trennung der Personen ─────────────────────────────────────────────
$fremd = spesen_anlegen($pdo, $ANDERE, $feld(['betrag_rappen' => 4200]));
check('KRITISCH: die eigene Liste zeigt keine fremden Belege',
    count(spesen_eigene($pdo, $ICH)) === 1 && count(spesen_eigene($pdo, $ANDERE)) === 1);
spesen_einreichen($pdo, $ANDERE, $fremd);
$alle = spesen_liste_verwaltung($pdo, 'alle');
check('Die Verwaltung sieht beide Personen', count($alle) === 2);
check('Auch ohne Vor-/Nachnamen steht ein Name da, nicht eine leere Zelle',
    in_array('anna.beispiel', array_column($alle, 'person'), true));

// ── Sortierung ────────────────────────────────────────────────────────
$alt = spesen_anlegen($pdo, $ICH, $feld(['datum' => '2026-01-05']));
$neu = spesen_anlegen($pdo, $ICH, $feld(['datum' => '2026-05-05']));
$reihe = array_column(spesen_eigene($pdo, $ICH), 'datum');
check('Die neuesten Belege stehen oben',
    $reihe[0] === '2026-05-05' && $reihe[count($reihe) - 1] === '2026-01-05');

echo ($ok + count($bad)) . " Pruefungen ausgefuehrt, $ok bestanden\n";
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) ? 1 : 0);
