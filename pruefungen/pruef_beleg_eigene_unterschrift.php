<?php
// Unsere Unterschrift in der Fassung (ENT-704) -- wirklich AUSFUEHREN.
//
// Warum diese Datei: Die Zusagen stehen im Zusammenspiel von Fassung,
// Pruefsumme, Kundenseite und PDF:
//
//   1. DIE UNTERSCHRIFT STEHT UNTER DER PRUEFSUMME: Wer sie in der
//      Datenbank austauscht, macht die Fassung unecht.
//   2. SIE ZAEHLT NICHT ZUM INHALT: Eine Erinnerung ohne Aenderung bleibt
//      eine Erinnerung, auch wenn das frisch gelesene Abbild keine
//      Unterschrift traegt.
//   3. DER KUNDE SIEHT SIE SCHON VOR DER ANNAHME, und nur bei einer
//      freigegebenen Fassung.
//   4. IM PDF stehen beide Unterschriften als Bild, 18 mm hoch statt 12.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

final class Antwort extends Exception
{
    public array $daten; public int $status;
    public function __construct(array $d, int $c) { parent::__construct('antwort'); $this->daten = $d; $this->status = $c; }
}
function json_response($d, int $code = 200): void { throw new Antwort((array)$d, $code); }
function anmeld_adresse(): string { return '192.0.2.30'; }
function anmeld_zaehlen(PDO $pdo, string $name, string $adresse): array { return [0, 0]; }
function anmeld_sperre(int $a, int $b): int { return 0; }
function anmeld_fehlversuch(PDO $pdo, string $name, string $adresse): void {}
$GLOBALS['mails'] = [];
function smtp_konfiguriert(): bool { return true; }
function smtp_senden(string $an, string $name, string $betreff, string $html, string $text, array $anhaenge = [], array $bilder = []): void
{
    $GLOBALS['mails'][] = compact('an', 'betreff', 'html', 'text', 'anhaenge');
}

$pdo = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));
function db(): PDO { return $GLOBALS['pdo']; }

require __DIR__ . '/../backend/belege.php';
require __DIR__ . '/../backend/belegpdf.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

// Eine Zeichnung wie aus unterschrift.js: durchsichtiger Grund, dunkler Strich.
function zeichnung(int $b, int $h): string
{
    $im = imagecreatetruecolor($b, $h);
    imagesavealpha($im, true);
    imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
    imagesetthickness($im, 4);
    imageline($im, 5, $h - 10, $b - 5, 10, imagecolorallocate($im, 26, 29, 35));
    ob_start(); imagepng($im); $png = (string)ob_get_clean();
    return 'data:image/png;base64,' . base64_encode($png);
}
$UNSERE = zeichnung(360, 110);
$KUNDE  = zeichnung(300, 90);

$pdo->exec("CREATE TABLE betrieb (id INTEGER PRIMARY KEY, firma TEXT, fusszeile TEXT, fusszeile2 TEXT,
  logo_mime TEXT, logo BLOB, qr_iban TEXT, qr_strasse TEXT, qr_hausnummer TEXT, qr_plz TEXT, qr_ort TEXT)");
$pdo->exec("INSERT INTO betrieb (id, firma, fusszeile) VALUES (1, 'Beispiel Sicherheit GmbH', 'Beispielweg 3')");
$pdo->exec("CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");
$pdo->exec("INSERT INTO mitarbeiter VALUES (7, 'A. Muster', 'verkauf@beispiel.invalid')");
$pdo->exec("CREATE TABLE belege (id INTEGER PRIMARY KEY, art TEXT, nummer TEXT, kunde_id INTEGER,
  person_id INTEGER, titel TEXT DEFAULT '', referenz TEXT DEFAULT '', datum TEXT, gueltig_bis TEXT,
  faellig_bis TEXT, status TEXT, rabatt_bp INTEGER DEFAULT 0, oeffentliche_notizen TEXT, bedingungen TEXT,
  fusszeile_text TEXT, unterschriftsseite INTEGER DEFAULT 0, versand_token TEXT, entscheidung_am TEXT,
  entscheidung_ip TEXT, entscheidung_fassung INTEGER)");
$pdo->exec("CREATE TABLE beleg_positionen (id INTEGER PRIMARY KEY, beleg_id INTEGER, sortierung INTEGER,
  produkt_id INTEGER, produkt_name TEXT, beschreibung TEXT, menge REAL, einheit TEXT,
  einzelpreis_rappen INTEGER, rabatt_bp INTEGER DEFAULT 0, mwst_satz_bp INTEGER DEFAULT 810)");
$pdo->exec("CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT, zusatzfeld TEXT, strasse TEXT,
  hausnummer TEXT, adresszusatz TEXT, plz TEXT, ort TEXT, email TEXT)");
$pdo->exec("CREATE TABLE kunden_person (id INTEGER PRIMARY KEY, anrede TEXT, vorname TEXT, nachname TEXT)");
$pdo->exec("CREATE TABLE beleg_fassung (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, nummer INTEGER,
  abbild TEXT, pruefsumme TEXT, anlass TEXT, versendet_am TEXT, versendet_von TEXT DEFAULT '',
  freigegeben INTEGER DEFAULT 0, versendet_von_id INTEGER)");
$pdo->exec("CREATE TABLE beleg_unterschrift (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, fassung INTEGER,
  art TEXT, name TEXT DEFAULT '', funktion TEXT DEFAULT '', firma TEXT DEFAULT '', email TEXT DEFAULT '',
  zeichnungsberechtigt INTEGER DEFAULT 0, zeichnung TEXT, grund TEXT, empfaenger_email TEXT DEFAULT '',
  code_abdruck TEXT DEFAULT '', code_gesendet_am TEXT, code_versuche INTEGER DEFAULT 0, bestaetigt_am TEXT,
  ip TEXT DEFAULT '', browser TEXT DEFAULT '', erstellt_am TEXT, pdf BLOB, pdf_pruefsumme TEXT DEFAULT '')");
$pdo->exec("INSERT INTO kunden VALUES (1, 'Muster Handel AG', '', 'Musterweg', '1', '', '3000', 'Musterstadt', 'einkauf@muster.invalid')");
foreach ([[1, 'tokA'], [2, 'tokB']] as [$id, $tok]) {
    $pdo->exec("INSERT INTO belege (id, art, nummer, kunde_id, titel, datum, gueltig_bis, status, versand_token, unterschriftsseite)
                VALUES ($id, 'offerte', 'OF-08$id', 1, 'Bewachung', '2031-03-01', '2099-12-31', 'versendet', '$tok', 1)");
    $pdo->exec("INSERT INTO beleg_positionen (beleg_id, produkt_name, beschreibung, menge, einheit, einzelpreis_rappen)
                VALUES ($id, 'Objektschutz', '', 40, 'Std.', 6500)");
}
$frisch = fn(int $id) => beleg_abbild_lesen($pdo, $id, '', beleg_absender_betrieb($pdo));

// ── Beleg 1: freigegeben MIT unserer Unterschrift (wie betreiber_beleg_versenden)
$a1 = $frisch(1);
$a1[BELEG_FREIGABE_UNTERSCHRIFT] = ['name' => 'A. Muster', 'bild' => $UNSERE];
beleg_fassung_anlegen($pdo, 1, $a1, 'versand', 'A. Muster', '', true, 7);
$f1 = beleg_letzte_fassung($pdo, 1, '');
$pruef('die Fassung traegt unsere Unterschrift', ($f1['abbild'][BELEG_FREIGABE_UNTERSCHRIFT]['bild'] ?? '') === $UNSERE);
$pruef('KRITISCH: und ist echt -- die Unterschrift steht unter der Pruefsumme', $f1['echt'] === true);

// 2. Nicht zum Inhalt
$n = beleg_fassung_naechste($pdo, 1, $frisch(1), '');
$pruef('KRITISCH: eine Erinnerung ohne Aenderung bleibt eine Erinnerung (keine neue Fassung)', $n['neu'] === false);
$pruef('GEGENPROBE: die ganze Pruefsumme allein haette hier eine neue Fassung verlangt',
    !hash_equals((string)$f1['pruefsumme'], beleg_pruefsumme(beleg_abbild_json($frisch(1)))));
$r = beleg_fassung_anlegen($pdo, 1, $frisch(1), 'versand', 'B. Beispiel', '', true, 8);
$pruef('KRITISCH: auch fassung_anlegen legt dann keine zweite an', $r['neu'] === false
    && (int)$pdo->query('SELECT COUNT(*) FROM beleg_fassung WHERE beleg_id = 1')->fetchColumn() === 1);
$pdo->exec("UPDATE belege SET titel = 'Bewachung neu' WHERE id = 1");
$pruef('GEGENPROBE: eine echte Aenderung verlangt weiterhin eine neue Fassung',
    beleg_fassung_naechste($pdo, 1, $frisch(1), '')['neu'] === true);
$pdo->exec("UPDATE belege SET titel = 'Bewachung' WHERE id = 1");

// 1. Austausch in der Datenbank
$falsch = $f1['abbild']; $falsch[BELEG_FREIGABE_UNTERSCHRIFT]['bild'] = $KUNDE;
$pdo->prepare('UPDATE beleg_fassung SET abbild = ? WHERE beleg_id = 1')->execute([beleg_abbild_json($falsch)]);
$pruef('KRITISCH: eine ausgetauschte Unterschrift macht die Fassung unecht', beleg_letzte_fassung($pdo, 1, '')['echt'] === false);
$pdo->prepare('UPDATE beleg_fassung SET abbild = ? WHERE beleg_id = 1')->execute([beleg_abbild_json($f1['abbild'])]);
$pruef('… und die richtige wieder echt', beleg_letzte_fassung($pdo, 1, '')['echt'] === true);

// Nur eine gepruefte PNG-Zeichnung zaehlt
$pruef('eine PNG-Zeichnung wird gelesen', beleg_freigabe_unterschrift($f1['abbild']) !== null);
$pruef('GEGENPROBE: etwas anderes als eine PNG-Zeichnung nicht',
    beleg_freigabe_unterschrift([BELEG_FREIGABE_UNTERSCHRIFT => ['name' => 'x', 'bild' => 'data:image/svg+xml;base64,PHN2Zz4=']]) === null
    && beleg_freigabe_unterschrift([]) === null);

// 3. Kundenseite
$l = beleg_unterschrift_linien(null, $f1, false);
$pruef('KRITISCH: der Kunde sieht unsere Unterschrift schon vor der Annahme',
    str_contains($l['absender'], '<img') && str_contains($l['absender'], 'data:image/png;base64,') && $l['kunde'] === '');
$ohne = $f1; $ohne['freigegeben'] = false;
$pruef('GEGENPROBE: ohne Freigabe steht sie nicht da', beleg_unterschrift_linien(null, $ohne, false)['absender'] === '');
$u = ['art' => 'annahme', 'zeichnung' => $KUNDE, 'name' => 'Erika Beispiel', 'bestaetigt_am' => '2031-03-02 10:00:00'];
$l2 = beleg_unterschrift_linien($u, $f1, true);
$pruef('nach der Annahme: unsere Zeichnung statt des Namens, die des Kunden daneben',
    str_contains($l2['absender'], '<img') && !str_contains($l2['absender'], 'A. Muster</span>')
    && str_contains($l2['kunde'], '<img'));
$pruef('die Kundenunterschrift bekommt mehr Hoehe (64 px statt 44)', str_contains($l2['kunde'], 'max-height:64px'));

// 4. PDF, der ganze Weg bis zur gespeicherten Fassung
function pdf_bilder(string $pdf): array
{
    preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $pdf, $m);
    $inhalt = '';
    foreach ($m[1] as $roh) { $e = @gzuncompress($roh); $inhalt .= ($e === false ? $roh : $e) . "\n"; }
    preg_match_all('/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/I\d+ Do Q/', $inhalt, $b, PREG_SET_ORDER);
    return array_map(fn($x) => ['b' => (float)$x[1], 'h' => (float)$x[2], 'x' => (float)$x[3]], $b);
}
$rufe = function (string $was, array $in) use ($pdo): array {
    try { beleg_unterschrift_ablauf($was, $pdo, '', $in, 'Beispiel Sicherheit GmbH'); }
    catch (Antwort $a) { return [$a->status, $a->daten]; }
    return [0, []];
};
$annehmen = function (string $tok) use ($rufe, $KUNDE): array {
    $GLOBALS['mails'] = [];
    [, $d] = $rufe('anfordern', ['token' => $tok, 'name' => 'Erika Beispiel', 'funktion' => 'Leiterin', 'firma' => 'Muster Handel AG',
        'email' => 'leitung@muster.invalid', 'zeichnungsberechtigt' => 1, 'zeichnung' => $KUNDE]);
    preg_match('/\b(\d{6})\b/', $GLOBALS['mails'][0]['text'] ?? '', $m);
    return $rufe('bestaetigen', ['token' => $tok, 'id' => (int)($d['id'] ?? 0), 'code' => $m[1] ?? '']);
};
[$c] = $annehmen('tokA');
$pdf1 = (string)$pdo->query('SELECT pdf FROM beleg_unterschrift WHERE beleg_id = 1 AND pdf IS NOT NULL')->fetchColumn();
$bilder = pdf_bilder($pdf1);
$mm = 72 / 25.4;
$pruef('KRITISCH: das PDF entsteht', $c === 200 && str_starts_with($pdf1, '%PDF'));
$pruef('KRITISCH: im PDF stehen beide Unterschriften als Bild', count($bilder) === 2);
$pruef('KRITISCH: beide 18 mm hoch (vorher 12)',
    count($bilder) === 2 && abs($bilder[0]['h'] - 18 * $mm) < 0.6 && abs($bilder[1]['h'] - 18 * $mm) < 0.6);
$pruef('unsere steht rechts, die des Kunden links',
    count($bilder) === 2 && min($bilder[0]['x'], $bilder[1]['x']) < 30 * $mm && max($bilder[0]['x'], $bilder[1]['x']) > 100 * $mm);

// Gegenprobe: eine Fassung aus der Zeit davor, ohne unsere Unterschrift
beleg_fassung_anlegen($pdo, 2, $frisch(2), 'versand', 'A. Muster', '', true, 7);
$annehmen('tokB');
$pdf2 = (string)$pdo->query('SELECT pdf FROM beleg_unterschrift WHERE beleg_id = 2 AND pdf IS NOT NULL')->fetchColumn();
$pruef('GEGENPROBE: ohne unsere Unterschrift nur das Bild des Kunden, unser Name in Schreibschrift',
    count(pdf_bilder($pdf2)) === 1 && str_contains($pdf2 . implode('', array_map(fn($s) => (string)@gzuncompress($s),
        (preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $pdf2, $mm2) ? $mm2[1] : []))), '(A. Muster)'));

// 5. Auf der Linie (ENT-706): Das Bild ragt unter die Linie, die
// Beschriftung steht tiefer als diese Unterlaenge.
$pruef('KRITISCH: auf der Kundenseite ragen beide Unterschriften ueber die Linie hinaus',
    substr_count($l2['kunde'] . $l2['absender'], 'margin-bottom:-12px') === 2);
$linieY = null;
preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $pdf1, $st);
$inh = '';
foreach ($st[1] as $roh) { $e = @gzuncompress($roh); $inh .= ($e === false ? $roh : $e) . "\n"; }
// FPDF: Linie "x1 y1 m x2 y2 l S" in Punkten, y von unten; Bild "q w 0 0 h x y cm".
preg_match_all('/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/', $inh, $li, PREG_SET_ORDER);
preg_match_all('/q [\d.]+ 0 0 ([\d.]+) [\d.]+ ([\d.]+) cm \/I\d+ Do Q/', $inh, $bi, PREG_SET_ORDER);
// Die Unterschriftslinien sind 80 mm lang, waagrecht; Trennstriche gehen ueber die ganze Breite.
$linien = array_values(array_filter($li, fn($x) => abs((float)$x[2] - (float)$x[4]) < 0.01 && abs((float)$x[3] - (float)$x[1] - 80 * 72 / 25.4) < 1));
$linieY = $linien ? (float)$linien[count($linien) - 1][2] : null;
$unten = array_map(fn($x) => (float)$x[2], $bi);
$pruef('KRITISCH: im PDF beginnt jede Unterschrift unter der Linie (ein Fuenftel der Hoehe)',
    $linieY !== null && count($unten) === 2
    && count(array_filter($unten, fn($u) => $u < $linieY - 2 && $u > $linieY - 18)) === 2);

// 6. Hochladen (ENT-706): ein Bild wird zur Zeichnung
function bild_url(int $grund, bool $leer = false, string $typ = 'jpeg'): string
{
    $im = imagecreatetruecolor(1200, 500);
    imagefill($im, 0, 0, imagecolorallocate($im, $grund, $grund, max(0, $grund - 5)));
    if (!$leer) {
        imagesetthickness($im, 6);
        $c = imagecolorallocate($im, 20, 20, 60);
        imageline($im, 300, 350, 700, 150, $c); imageline($im, 700, 150, 800, 380, $c);
    }
    ob_start(); $typ === 'jpeg' ? imagejpeg($im, null, 85) : imagepng($im);
    return 'data:image/' . $typ . ';base64,' . base64_encode((string)ob_get_clean());
}
function alpha_an(string $url, int $x, int $y): int
{
    $im = imagecreatefromstring(base64_decode(substr($url, strpos($url, ',') + 1)));
    return (imagecolorat($im, $x, $y) >> 24) & 0x7F;
}
foreach (['weisses Papier (JPG)' => bild_url(250), 'graues Papier, Foto' => bild_url(170), 'Bildschirmfoto (PNG)' => bild_url(255, false, 'png')] as $n => $url) {
    $r = beleg_unterschrift_aus_bild($url);
    $ok1 = isset($r['bild']) && beleg_zeichnung_pruefen($r['bild']) !== null;
    $pruef("KRITISCH: $n wird eine gepruefte PNG-Zeichnung", $ok1);
    if ($ok1) {
        [$b, $h] = getimagesizefromstring(base64_decode(substr($r['bild'], 22)));
        $pruef("$n: Hintergrund durchsichtig, auf die Unterschrift zugeschnitten",
            alpha_an($r['bild'], 0, 0) === 127 && $b < 1200 && $h < 500 && $b <= BELEG_UPLOAD_BREITE);
        $mitte = alpha_an($r['bild'], (int)($b * 0.5), (int)($h * 0.5));
        $pruef("$n: die Schrift bleibt deckend", (function () use ($r, $b, $h) {
            $im = imagecreatefromstring(base64_decode(substr($r['bild'], 22)));
            for ($y = 0; $y < $h; $y++) { for ($x = 0; $x < $b; $x++) { if ((((imagecolorat($im, $x, $y) >> 24) & 0x7F)) < 20) { return true; } } }
            return false;
        })());
    }
}
$pruef('KRITISCH: ein leeres Blatt wird abgewiesen, mit Grund', str_contains((string)(beleg_unterschrift_aus_bild(bild_url(250, true))['fehler'] ?? ''), 'keine Unterschrift'));
$pruef('KRITISCH: nur PNG und JPG', isset(beleg_unterschrift_aus_bild('data:image/gif;base64,R0lGODlhAQABAAAAACw=')['fehler'])
    && isset(beleg_unterschrift_aus_bild('data:image/jpeg;base64,' . base64_encode('<svg/>'))['fehler']));
$pruef('KRITISCH: zu gross wird abgewiesen, bevor etwas gelesen wird',
    str_contains((string)(beleg_unterschrift_aus_bild('data:image/png;base64,' . str_repeat('A', BELEG_UPLOAD_MAX))['fehler'] ?? ''), 'zu gross'));

echo "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $b) { echo "  ✗ $b\n"; }
exit($bad ? 1 : 0);
