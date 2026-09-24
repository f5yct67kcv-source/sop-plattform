<?php
// Das unterschriebene PDF und die Bestaetigungen (ENT-688, Schritt 3)
// wirklich AUSFUEHREN: vom Code bis zum gespeicherten PDF und den Mails.
//
// Warum diese Datei: Die Zusagen von Schritt 3 stehen nur im Ablauf:
//
//   1. DAS PDF ENTSTEHT BEI DER ANNAHME UND WIRD GESPEICHERT -- einmal. Ein
//      zweiter Durchlauf ersetzt es nicht.
//   2. ES ZEIGT DAS ANGENOMMENE: Nummer, Positionen, Summen, Empfaenger,
//      Unterzeichner und das Pruefprotokoll mit der Pruefsumme der Fassung.
//      Gelesen wird der Inhalt des erzeugten PDFs, nicht der Quelltext.
//   3. EIN VERAENDERTES PDF WIRD NICHT AUSGELIEFERT (Pruefsumme).
//   4. DIE MAILS TRAGEN DAS PDF, und eine gescheiterte Mail macht die
//      Annahme nicht rueckgaengig.
//   5. IM COCKPIT GEHT DIE INTERNE MAIL AN DIE PERSON, DIE VERSENDET HAT, und
//      die Mail an den Kunden traegt kein GuardOpS-Logo (OP-675).
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

final class Antwort extends Exception
{
    public array $daten; public int $status;
    public function __construct(array $d, int $c) { parent::__construct('antwort'); $this->daten = $d; $this->status = $c; }
}
function json_response($d, int $code = 200): void { throw new Antwort((array)$d, $code); }
function anmeld_adresse(): string { return '192.0.2.20'; }
function anmeld_zaehlen(PDO $pdo, string $name, string $adresse): array { return [0, 0]; }
function anmeld_sperre(int $a, int $b): int { return 0; }
function anmeld_fehlversuch(PDO $pdo, string $name, string $adresse): void {}
$GLOBALS['mails'] = [];
$GLOBALS['mail_kaputt'] = false;
function smtp_konfiguriert(): bool { return true; }
function smtp_senden(string $an, string $name, string $betreff, string $html, string $text, array $anhaenge = [], array $bilder = []): void
{
    if ($GLOBALS['mail_kaputt'] && !str_contains($betreff, 'Bestätigungscode')) { throw new RuntimeException('SMTP weg'); }
    $GLOBALS['mails'][] = compact('an', 'betreff', 'html', 'text', 'anhaenge', 'bilder');
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

// Der Text eines PDFs: alle Inhaltsstroeme entpackt. Genug, um zu sehen,
// was darauf steht -- in der Kodierung, in der es dort steht (Windows-1252).
function pdf_text(string $pdf): string
{
    preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $pdf, $m);
    $t = '';
    foreach ($m[1] as $roh) { $e = @gzuncompress($roh); $t .= ($e === false ? $roh : $e) . "\n"; }
    return $t;
}
$w = static fn(string $s): string => (string)iconv('UTF-8', 'Windows-1252', $s);

$pdo->exec("CREATE TABLE betrieb (id INTEGER PRIMARY KEY, firma TEXT, fusszeile TEXT, fusszeile2 TEXT,
  logo_mime TEXT, logo BLOB, qr_iban TEXT, qr_strasse TEXT, qr_hausnummer TEXT, qr_plz TEXT, qr_ort TEXT)");
$pdo->exec("INSERT INTO betrieb (id, firma, fusszeile) VALUES (1, 'Beispiel Sicherheit GmbH', 'Beispielweg 3\n9999 Musterhausen')");
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
$pdo->exec("INSERT INTO belege (id, art, nummer, kunde_id, titel, datum, gueltig_bis, status, versand_token, unterschriftsseite, bedingungen)
            VALUES (1, 'offerte', 'OF-0815', 1, 'Bewachung Frühling', '2031-03-01', '2099-12-31', 'versendet', 'tokP', 1, 'Zahlbar in 30 Tagen')");
$pdo->exec("INSERT INTO beleg_positionen (beleg_id, produkt_name, beschreibung, menge, einheit, einzelpreis_rappen)
            VALUES (1, 'Objektschutz', 'Nächte, Wochenende', 40, 'Std.', 6500)");
beleg_fassung_anlegen($pdo, 1, beleg_abbild_lesen($pdo, 1, '', beleg_absender_betrieb($pdo)),
    'versand', 'A. Muster', '', true, 7);

$rufe = function (string $was, array $in) use ($pdo): array {
    try { beleg_unterschrift_ablauf($was, $pdo, '', $in, 'Beispiel Sicherheit GmbH'); }
    catch (Antwort $a) { return [$a->status, $a->daten]; }
    return [0, []];
};

// ── Annehmen bis zum Ende ─────────────────────────────────────────────
[, $d] = $rufe('anfordern', ['token' => 'tokP', 'name' => 'Erika Beispiel', 'funktion' => 'Geschäftsführerin',
    'firma' => 'Muster Handel AG', 'email' => 'leitung@muster.invalid', 'zeichnungsberechtigt' => 1]);
preg_match('/\b(\d{6})\b/', $GLOBALS['mails'][0]['text'] ?? '', $m);
$GLOBALS['mails'] = [];
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokP', 'id' => (int)$d['id'], 'code' => $m[1] ?? '']);
$pruef('KRITISCH: die Annahme gelingt und meldet den Abschluss', $c === 200 && is_array($d['abschluss'] ?? null));
$pruef('KRITISCH: … mit PDF und Mail an den Unterzeichnenden',
    ($d['abschluss']['pdf'] ?? false) === true && ($d['abschluss']['kunde'] ?? false) === true);

$pdf = beleg_pdf_gespeichert($pdo, '', 1);
$pruef('KRITISCH: das PDF ist gespeichert und beginnt als PDF', is_string($pdf) && str_starts_with($pdf, '%PDF-'));
$text = pdf_text((string)$pdf);
$f = beleg_letzte_fassung($pdo, 1, '');
$pruef('KRITISCH: das PDF zeigt Nummer, Titel, Position und Total des Angenommenen',
    str_contains($text, 'OF-0815') && str_contains($text, $w('Bewachung Frühling'))
    && str_contains($text, 'Objektschutz')
    && str_contains($text, $w(beleg_pdf_chf((int)$f['abbild']['summen']['total_rappen']) . ' CHF'))
    && (int)$f['abbild']['summen']['total_rappen'] === 281060);
$pruef('KRITISCH: das PDF traegt den Empfaenger aus der Fassung', str_contains($text, 'Muster Handel AG') && str_contains($text, 'Musterweg 1'));
$pruef('KRITISCH: das PDF traegt das Pruefprotokoll mit der Pruefsumme der Fassung',
    str_contains($text, $w('PRÜFPROTOKOLL')) && str_contains($text, (string)$f['pruefsumme'])
    && str_contains($text, $w('Erika Beispiel, Geschäftsführerin, Muster Handel AG')));
$pruef('das PDF traegt die elektronische Annahme auf der Linie', str_contains($text, 'Elektronisch angenommen am'));
$pruef('die Seitenfusszeile nennt Nummer und Fassung', str_contains($text, $w('OF-0815 · Fassung 1')));

// ── Mails ─────────────────────────────────────────────────────────────
$anKunde = array_values(array_filter($GLOBALS['mails'], fn($x) => $x['an'] === 'leitung@muster.invalid'));
$anIntern = array_values(array_filter($GLOBALS['mails'], fn($x) => $x['an'] === 'verkauf@beispiel.invalid'));
$pruef('KRITISCH: der Unterzeichnende bekommt die Bestaetigung mit dem PDF',
    count($anKunde) === 1 && ($anKunde[0]['anhaenge'][0]['inhalt'] ?? '') === $pdf
    && str_ends_with((string)($anKunde[0]['anhaenge'][0]['name'] ?? ''), '.pdf'));
$pruef('KRITISCH: im Cockpit bekommt die Person, die versendet hat, die interne Bestaetigung mit PDF',
    count($anIntern) === 1 && ($anIntern[0]['anhaenge'][0]['inhalt'] ?? '') === $pdf
    && str_contains($anIntern[0]['betreff'], 'Angenommen'));
$pruef('KRITISCH: im Cockpit traegt die Kundenmail kein GuardOpS-Logo (OP-675)',
    ($anKunde[0]['bilder'] ?? ['x']) === [] && !str_contains($anKunde[0]['html'] ?? 'cid:', 'cid:'));
$pruef('die interne Mail nennt die abweichende Codeadresse', str_contains($anIntern[0]['text'] ?? '', 'nicht an die Empfängeradresse'));

// ── Einmal, und nur unveraendert ──────────────────────────────────────
$vorher = hash('sha256', (string)$pdf);
// Eine Sekunde warten: Das Erstellungsdatum im PDF ist sekundengenau. Ein
// neu erzeugtes PDF unterschiede sich danach sicher vom ersten -- sonst
// koennte diese Pruefung nie anschlagen.
sleep(1);
beleg_annahme_abschliessen($pdo, '', 1, ['art' => 'offerte', 'nummer' => 'OF-0815'], 'Beispiel Sicherheit GmbH');
$pruef('KRITISCH: ein zweiter Abschluss ersetzt das gespeicherte PDF nicht',
    hash('sha256', (string)beleg_pdf_gespeichert($pdo, '', 1)) === $vorher);
$pdo->exec("UPDATE beleg_unterschrift SET pdf = pdf || 'x' WHERE beleg_id = 1");
$pruef('KRITISCH: ein veraendertes PDF wird nicht ausgeliefert', beleg_pdf_gespeichert($pdo, '', 1) === null);

// ── Eine gescheiterte Mail macht die Annahme nicht rueckgaengig ──────
$pdo->exec("INSERT INTO belege (id, art, nummer, kunde_id, datum, gueltig_bis, status, versand_token)
            VALUES (2, 'offerte', 'OF-0816', 1, '2031-03-01', '2099-12-31', 'versendet', 'tokQ')");
$pdo->exec("INSERT INTO beleg_positionen (beleg_id, produkt_name, beschreibung, menge, einheit, einzelpreis_rappen)
            VALUES (2, 'Objektschutz', '', 1, 'Std.', 6500)");
beleg_fassung_anlegen($pdo, 2, beleg_abbild_lesen($pdo, 2, '', beleg_absender_betrieb($pdo)), 'versand', 'A. Muster', '', true, 7);
// Ueber die Empfaengeradresse: seit ENT-708 ohne Code, sofort angenommen.
$GLOBALS['mails'] = [];
$GLOBALS['mail_kaputt'] = true;
[$c, $d] = $rufe('anfordern', ['token' => 'tokQ', 'name' => 'Rolf Muster', 'funktion' => 'Leitung',
    'firma' => '', 'email' => 'einkauf@muster.invalid', 'zeichnungsberechtigt' => 1]);
$GLOBALS['mail_kaputt'] = false;
$pruef('KRITISCH: scheitert die Bestaetigungsmail, bleibt der Beleg angenommen',
    $c === 200 && ($d['abschluss']['kunde'] ?? true) === false
    && $pdo->query("SELECT status FROM belege WHERE id = 2")->fetchColumn() === 'bestaetigt');
$pruef('… und das PDF ist trotzdem gespeichert', beleg_pdf_gespeichert($pdo, '', 2) !== null);
$pruef('GEGENPROBE: dieselbe Adresse wie beim Versand gilt nicht als abweichend',
    beleg_unterschrift_letzte($pdo, '', 2)['abweichend'] === false);

// ── Die Mail der Betreiberin traegt ihr Logo, sofern es eines gibt ───
$mailBe = beleg_bestaetigung_mail(['art' => 'offerte', 'nummer' => 'OF-1'], beleg_unterschrift_letzte($pdo, '', 2),
    1, 'Beispiel Software GmbH', false, ['A. Muster', 'Beispiel Software GmbH'], true);
$logoDa = mail_logo() !== null;
$pruef('die Mail der Betreiberin zeichnet mit Signatur (und Logo, wenn eines vorliegt)',
    str_contains($mailBe['text'], 'A. Muster') && (!$logoDa || count($mailBe['bilder']) > 0));

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $x) { echo "x $x\n"; }
exit(count($bad) === 0 ? 0 : 1);
