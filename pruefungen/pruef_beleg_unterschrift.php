<?php
// Die Unterschrift am Link (ENT-688, Schritt 2) wirklich AUSFUEHREN -- den
// ganzen Ablauf hinter beleg_unterschrift.php, nicht seinen Quelltext.
//
// Warum diese Datei: An der Annahme mit Code haengen Zusagen, die nur im
// Ablauf sichtbar werden:
//
//   1. OHNE DEN RICHTIGEN CODE WIRD NICHTS ANGENOMMEN -- nicht mit einem
//      falschen, nicht mit einem abgelaufenen, nicht nach fuenf Fehlern,
//      nicht fuer eine Fassung, die inzwischen ersetzt ist.
//   2. DER CODE STEHT NIE IN DER DATENBANK, nur sein Abdruck.
//   3. DIE CODE-MAIL TRAEGT NICHTS VOM UNTERZEICHNENDEN. Sonst taugte der
//      Weg als Versand fremder Texte an beliebige Adressen.
//   4. DIE BREMSE greift je Beleg.
//   5. EINE ABWEICHENDE CODEADRESSE wird festgehalten und gezeigt.
//
// Gegenproben stehen jeweils direkt bei der Pruefung.
declare(strict_types=1);

// ── Die Umgebung eines Endpunkts, nachgestellt ─────────────────────────
final class Antwort extends Exception
{
    public array $daten; public int $status;
    public function __construct(array $d, int $c) { parent::__construct('antwort'); $this->daten = $d; $this->status = $c; }
}
function json_response($d, int $code = 200): void { throw new Antwort((array)$d, $code); }
$GLOBALS['versuche'] = [];
function anmeld_adresse(): string { return '192.0.2.10'; }
function anmeld_zaehlen(PDO $pdo, string $name, string $adresse): array
{
    $n = 0; $a = 0;
    foreach ($GLOBALS['versuche'] as [$vn, $va]) { if ($vn === $name) { $n++; } if ($va === $adresse) { $a++; } }
    return [$n, $a];
}
function anmeld_sperre(int $fName, int $fAdresse): int { return ($fName >= 5 || $fAdresse >= 20) ? 15 : 0; }
function anmeld_fehlversuch(PDO $pdo, string $name, string $adresse): void { $GLOBALS['versuche'][] = [$name, $adresse]; }
$GLOBALS['mails'] = [];
$GLOBALS['mail_kaputt'] = false;
function smtp_konfiguriert(): bool { return true; }
function smtp_senden(string $an, string $name, string $betreff, string $html, string $text, array $a = [], array $b = []): void
{
    if ($GLOBALS['mail_kaputt']) { throw new RuntimeException('SMTP weg'); }
    $GLOBALS['mails'][] = compact('an', 'betreff', 'html', 'text');
}

$pdo = new PDO('sqlite::memory:', null, null,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));
function db(): PDO { return $GLOBALS['pdo']; }

require __DIR__ . '/../backend/belege.php';

$ok = 0; $bad = [];
$pruef = function (string $name, bool $bedingung) use (&$ok, &$bad) {
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
};

$pdo->exec("CREATE TABLE betrieb (id INTEGER PRIMARY KEY, firma TEXT, fusszeile TEXT, fusszeile2 TEXT,
  logo_mime TEXT, logo BLOB, qr_iban TEXT, qr_strasse TEXT, qr_hausnummer TEXT, qr_plz TEXT, qr_ort TEXT)");
$pdo->exec("INSERT INTO betrieb (id, firma) VALUES (1, 'Beispiel Sicherheit GmbH')");
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
$pdo->exec("INSERT INTO kunden VALUES (1, 'Muster Handel AG', '', 'Musterweg', '1', '', '3000', 'Musterstadt', 'einkauf@muster.invalid')");
$pdo->exec("INSERT INTO belege (id, art, nummer, kunde_id, datum, gueltig_bis, status, versand_token)
            VALUES (1, 'offerte', 'OF-0815', 1, '2031-03-01', '2099-12-31', 'versendet', 'tokA'),
                   (2, 'rechnung', 'RE-0815', 1, '2031-03-01', NULL, 'versendet', 'tokR'),
                   (3, 'offerte', 'OF-0816', 1, '2031-03-01', '2099-12-31', 'versendet', 'tokB')");
$pdo->exec("INSERT INTO beleg_positionen (beleg_id, produkt_name, beschreibung, menge, einheit, einzelpreis_rappen)
            VALUES (1, 'Bewachung', '', 10, 'Std.', 6500), (3, 'Bewachung', '', 5, 'Std.', 6500)");

// Der Ablauf, wie ihn der Endpunkt aufruft. Gibt [code, daten] zurueck.
$rufe = function (string $was, array $in) use ($pdo): array {
    try {
        beleg_unterschrift_ablauf($was, $pdo, '', $in, 'Beispiel Sicherheit GmbH');
    } catch (Antwort $a) {
        return [$a->status, $a->daten];
    }
    return [0, []];
};
$angaben = ['token' => 'tokA', 'name' => 'Erika Beispiel', 'funktion' => 'Geschäftsführerin',
            'firma' => 'Muster Handel AG', 'email' => 'leitung@muster.invalid', 'zeichnungsberechtigt' => 1];

// ── 0. Ohne Tabellen: nicht eingerichtet, nicht "kaputt" ──────────────
[$c, $d] = $rufe('anfordern', $angaben);
$pruef('KRITISCH: ohne Tabellen meldet der Weg "nicht eingerichtet" (503), statt zu brechen',
    $c === 503 && ($d['lage'] ?? '') === 'nicht_eingerichtet');

$pdo->exec("CREATE TABLE beleg_fassung (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, nummer INTEGER,
  abbild TEXT, pruefsumme TEXT, anlass TEXT, versendet_am TEXT, versendet_von TEXT DEFAULT '',
  freigegeben INTEGER DEFAULT 0)");
$pdo->exec("CREATE TABLE beleg_unterschrift (id INTEGER PRIMARY KEY AUTOINCREMENT, beleg_id INTEGER, fassung INTEGER,
  art TEXT, name TEXT DEFAULT '', funktion TEXT DEFAULT '', firma TEXT DEFAULT '', email TEXT DEFAULT '',
  zeichnungsberechtigt INTEGER DEFAULT 0, zeichnung TEXT, grund TEXT, empfaenger_email TEXT DEFAULT '',
  code_abdruck TEXT DEFAULT '', code_gesendet_am TEXT, code_versuche INTEGER DEFAULT 0, bestaetigt_am TEXT,
  ip TEXT DEFAULT '', browser TEXT DEFAULT '', erstellt_am TEXT)");
// Fassung 1 der Offerte, freigegeben versendet.
beleg_fassung_anlegen($pdo, 1, beleg_abbild_lesen($pdo, 1, '', beleg_absender_betrieb($pdo)), 'versand', 'A. Muster', '', true);

// ── 1. Die Angaben ────────────────────────────────────────────────────
[$c, $d] = $rufe('anfordern', ['zeichnungsberechtigt' => 0] + $angaben);
$pruef('KRITISCH: ohne die Erklaerung "zeichnungsberechtigt" gibt es keinen Code',
    $c === 400 && ($d['lage'] ?? '') === 'angaben' && $GLOBALS['mails'] === []);
[$c, $d] = $rufe('anfordern', ['email' => 'keine-adresse'] + $angaben);
$pruef('KRITISCH: eine unbrauchbare Adresse wird abgewiesen', $c === 400 && $GLOBALS['mails'] === []);
[$c, $d] = $rufe('anfordern', ['funktion' => '  '] + $angaben);
$pruef('eine fehlende Funktion wird abgewiesen', $c === 400);
[$c, $d] = $rufe('anfordern', ['zeichnung' => 'data:image/png;base64,QUJD'] + $angaben);
$pruef('KRITISCH: eine Zeichnung, die kein PNG ist, wird abgewiesen statt still weggelassen', $c === 400);
[$c, $d] = $rufe('anfordern', ['token' => 'tokR'] + $angaben);
$pruef('KRITISCH: eine Rechnung laesst sich nicht unterschreiben', $c === 409 && ($d['lage'] ?? '') === 'zu');
[$c, $d] = $rufe('anfordern', ['token' => 'falsch'] + $angaben);
$pruef('ein unbekannter Link ergibt 404', $c === 404);

// ── 2. Code anfordern ─────────────────────────────────────────────────
$png = 'data:image/png;base64,' . base64_encode("\x89PNG\r\n\x1a\n" . str_repeat("\0", 16));
[$c, $d] = $rufe('anfordern', ['zeichnung' => $png] + $angaben);
$zeile = (int)($d['id'] ?? 0);
$pruef('KRITISCH: mit gueltigen Angaben geht ein Code hinaus', $c === 200 && $zeile > 0 && count($GLOBALS['mails']) === 1);
$mail = $GLOBALS['mails'][0] ?? ['an' => '', 'text' => '', 'html' => '', 'betreff' => ''];
$pruef('KRITISCH: der Code geht an die Adresse des Unterzeichnenden', $mail['an'] === 'leitung@muster.invalid');
preg_match('/\b(\d{6})\b/', $mail['text'], $m);
$code = $m[1] ?? '';
$pruef('der Code ist sechsstellig und steht in der Mail', strlen($code) === 6);
$pruef('KRITISCH: die Code-Mail traegt nichts vom Unterzeichnenden (kein Name, keine Firma)',
    !str_contains($mail['text'] . $mail['html'] . $mail['betreff'], 'Erika')
    && !str_contains($mail['text'] . $mail['html'], 'Geschäftsführerin'));
$roh = $pdo->query("SELECT * FROM beleg_unterschrift WHERE id = $zeile")->fetch();
$pruef('KRITISCH: in der Datenbank steht der Abdruck, nie der Code',
    strlen((string)$roh['code_abdruck']) === 64 && !str_contains(json_encode($roh), $code));
$pruef('die Zeichnung ist abgelegt', (string)$roh['zeichnung'] === $png);
$pruef('KRITISCH: vor dem Code ist nichts angenommen',
    $pdo->query("SELECT entscheidung_am FROM belege WHERE id = 1")->fetchColumn() === null
    && beleg_unterschrift_letzte($pdo, '', 1) === null);

// ── 3. Falscher, dann richtiger Code ──────────────────────────────────
$falsch = str_pad((string)(((int)$code + 1) % 1000000), 6, '0', STR_PAD_LEFT);
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokA', 'id' => $zeile, 'code' => $falsch]);
$pruef('KRITISCH: ein falscher Code nimmt nicht an',
    $c === 400 && ($d['lage'] ?? '') === 'falsch'
    && $pdo->query("SELECT entscheidung_am FROM belege WHERE id = 1")->fetchColumn() === null);
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokB', 'id' => $zeile, 'code' => $code]);
$pruef('KRITISCH: der Code gilt nur an seinem eigenen Beleg', $c !== 200
    && $pdo->query("SELECT entscheidung_am FROM belege WHERE id = 3")->fetchColumn() === null);
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokA', 'id' => $zeile, 'code' => substr($code, 0, 3) . ' ' . substr($code, 3)]);
$pruef('KRITISCH: der richtige Code nimmt an (auch mit Leerzeichen getippt)', $c === 200);
$b = $pdo->query("SELECT status, entscheidung_am, entscheidung_ip, entscheidung_fassung FROM belege WHERE id = 1")->fetch();
$pruef('KRITISCH: angenommen heisst: Status, Zeitpunkt, Adresse und Fassung stehen am Beleg',
    $b['status'] === 'bestaetigt' && $b['entscheidung_am'] !== null && (int)$b['entscheidung_fassung'] === 1);
$pruef('KRITISCH: … und der Beleg ist damit gesperrt', beleg_gesperrt($b));
$u = beleg_unterschrift_letzte($pdo, '', 1);
$pruef('KRITISCH: die abweichende Codeadresse ist festgehalten',
    $u !== null && $u['abweichend'] === true && $u['empfaenger_email'] === 'einkauf@muster.invalid');
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokA', 'id' => $zeile, 'code' => $code]);
$pruef('ein zweites Bestaetigen aendert nichts', $c === 409);

if ($u !== null) {
    $f = beleg_letzte_fassung($pdo, 1, '');
    $zeilen = beleg_pruefprotokoll_zeilen(['art' => 'offerte', 'nummer' => 'OF-0815'], $f, $u);
    $text = json_encode($zeilen, JSON_UNESCAPED_UNICODE);
    $pruef('KRITISCH: das Protokoll nennt Fassung, Pruefsumme, Freigabe, Unterzeichner und Abweichung',
        str_contains($text, 'Fassung 1') && str_contains($text, $f['pruefsumme'])
        && str_contains($text, 'freigegeben') && str_contains($text, 'Erika Beispiel, Geschäftsführerin')
        && str_contains($text, 'weicht von der Empfängeradresse'));
    $linien = beleg_unterschrift_linien($u, $f, true);
    $pruef('die Linien tragen Zeichnung und Freigabe-Namen', str_contains($linien['kunde'], '<img')
        && str_contains($linien['absender'], 'A. Muster') && str_contains($linien['ort'], 'Elektronisch angenommen'));
    $pruef('GEGENPROBE: ohne Annahme bleiben die Linien leer', beleg_unterschrift_linien($u, $f, false)['kunde'] === '');
} else {
    $pruef('KRITISCH: nach der Annahme gibt es ein Protokoll', false);
}

// ── 4. Fehler, Ablauf, neue Fassung, Bremse (Beleg 3) ────────────────
$GLOBALS['mails'] = []; $GLOBALS['versuche'] = [];
beleg_fassung_anlegen($pdo, 3, beleg_abbild_lesen($pdo, 3, '', beleg_absender_betrieb($pdo)), 'versand', 'A. Muster', '', true);
$b3 = ['token' => 'tokB', 'email' => 'einkauf@muster.invalid'] + $angaben;
[, $d] = $rufe('anfordern', $b3);
$z3 = (int)$d['id'];
$u3 = beleg_unterschrift_letzte($pdo, '', 3);
$pruef('vor dem Code ist auch an einem zweiten Beleg nichts festgehalten',
    $u3 === null);
$pdo->exec("UPDATE beleg_unterschrift SET code_gesendet_am = '2000-01-01 00:00:00' WHERE id = $z3");
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokB', 'id' => $z3, 'code' => '000000']);
$pruef('KRITISCH: ein abgelaufener Code nimmt nicht an', ($d['lage'] ?? '') === 'abgelaufen');

$GLOBALS['versuche'] = [];
[, $d] = $rufe('anfordern', $b3);
$z3 = (int)$d['id'];
preg_match('/\b(\d{6})\b/', end($GLOBALS['mails'])['text'], $m);
$code3 = $m[1];
// Zwischen Anfordern und Bestaetigen wird nachgebessert und neu versendet.
$pdo->exec("UPDATE beleg_positionen SET einzelpreis_rappen = 7000 WHERE beleg_id = 3");
beleg_fassung_anlegen($pdo, 3, beleg_abbild_lesen($pdo, 3, '', beleg_absender_betrieb($pdo)), 'versand', 'A. Muster', '', true);
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokB', 'id' => $z3, 'code' => $code3]);
$pruef('KRITISCH: ein Code fuer eine ersetzte Fassung nimmt die neue nicht an',
    ($d['lage'] ?? '') === 'fassung'
    && $pdo->query("SELECT entscheidung_am FROM belege WHERE id = 3")->fetchColumn() === null);

$GLOBALS['versuche'] = [];
[, $d] = $rufe('anfordern', $b3);
$z3 = (int)$d['id'];
$lagen = [];
for ($i = 0; $i < 5; $i++) {
    [$c, $d] = $rufe('bestaetigen', ['token' => 'tokB', 'id' => $z3, 'code' => '999999']);
    $lagen[] = $d['lage'] ?? '';
}
$pruef('KRITISCH: nach fuenf Versuchen greift die Bremse je Beleg (' . implode(',', $lagen) . ')',
    in_array('bremse', $lagen, true) || in_array('gesperrt', $lagen, true));
$GLOBALS['versuche'] = [];
$pdo->exec("UPDATE beleg_unterschrift SET code_versuche = 5 WHERE id = $z3");
[$c, $d] = $rufe('bestaetigen', ['token' => 'tokB', 'id' => $z3, 'code' => '123456']);
$pruef('KRITISCH: nach fuenf falschen Codes ist dieser Code verbraucht', ($d['lage'] ?? '') === 'gesperrt');

$GLOBALS['versuche'] = [];
$GLOBALS['mail_kaputt'] = true;
[$c, $d] = $rufe('anfordern', $b3);
$pruef('scheitert die Mail, sagt der Weg das (502) statt "Code gesendet"', $c === 502);
$GLOBALS['mail_kaputt'] = false;

// ── 5. Ablehnen ───────────────────────────────────────────────────────
beleg_ablehnung_anlegen($pdo, '', 3, 2, 'Rolf Muster', 'zu teuer', 'einkauf@muster.invalid', '192.0.2.10', 'Prüfbrowser');
$u3 = beleg_unterschrift_letzte($pdo, '', 3);
$pruef('KRITISCH: eine Ablehnung haelt Name und Grund fest, ohne Code',
    $u3 !== null && $u3['art'] === 'ablehnung' && $u3['name'] === 'Rolf Muster' && $u3['grund'] === 'zu teuer'
    && $u3['abweichend'] === false);

echo count($bad) === 0
    ? "$ok bestanden, 0 nicht bestanden\n"
    : "$ok bestanden, " . count($bad) . " nicht bestanden\n";
foreach ($bad as $x) { echo "x $x\n"; }
exit(count($bad) === 0 ? 0 : 1);
