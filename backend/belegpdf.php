<?php
declare(strict_types=1);
// Das unterschriebene Belegblatt als PDF (ENT-688, Schritt 3).
//
// WANN: EINMAL, im Moment der Annahme. Das PDF wird danach gespeichert und
// nie neu erzeugt -- eine spaetere Aenderung an dieser Datei darf ein
// angenommenes Dokument nicht veraendern (dieselbe Haltung wie bei den
// Fassungen und der GAV-Rechnung: nie rueckwirkend).
//
// WORAUS: aus dem Abbild der angenommenen Fassung -- Kopf, Positionen, die
// GERECHNET gespeicherten Summen, Anschrift und Absender --, nicht aus dem
// lebenden Beleg und nicht aus der Datenbank. Diese Datei rechnet nichts
// und liest nichts; sie zeichnet.
//
// ZWEI ZEICHNUNGEN DESSELBEN BLATTS (ENT-688, Risiken): Die oeffentliche
// Seite zeichnet es als HTML, diese Datei als PDF. Was auf beiden stehen
// muss -- Nummer, Positionen, Summen, Empfaenger, Linien, Protokoll --,
// prueft test_beleg_pdf.mjs am erzeugten PDF gegen dasselbe Abbild.
//
// WERKZEUG: FPDF 1.9, unveraendert in backend/fpdf/ (Herkunft dort). Die
// Standardschrift Helvetica kennt nur Windows-1252; darum geht jeder Text
// durch beleg_pdf_text(). Umlaute, ’ und — sind darin enthalten.

require_once __DIR__ . '/fpdf/fpdf.php';
require_once __DIR__ . '/belege.php';

function beleg_pdf_text(?string $s): string
{
    $t = @iconv('UTF-8', 'Windows-1252//TRANSLIT', (string)$s);
    return $t === false ? '' : $t;
}

function beleg_pdf_chf(int $rappen): string
{
    return number_format($rappen / 100, 2, '.', "\u{2019}");
}

function beleg_pdf_zahl(float $n): string
{
    return number_format($n, floor($n) == $n ? 0 : 2, '.', "\u{2019}");
}

function beleg_pdf_datum(?string $d): string
{
    $d = beleg_abbild_datum($d);
    return $d === null ? '–' : implode('.', array_reverse(explode('-', $d)));
}

final class BelegPdf extends FPDF
{
    public string $fussText = '';

    public function Footer(): void
    {
        $this->SetY(-12);
        $this->SetFont('Helvetica', '', 7.5);
        $this->SetTextColor(107, 114, 128);
        $this->Cell(0, 5, beleg_pdf_text($this->fussText . ' · Seite ' . $this->PageNo() . ' von {nb}'), 0, 0, 'R');
    }

    // Zeilen, die ein Text in einer Spalte der Breite $w braucht -- die
    // uebliche Hilfe zu FPDF, damit eine Tabellenzeile mit mehrzeiliger
    // Beschreibung ihre Hoehe VOR dem Zeichnen kennt.
    public function zeilen(float $w, string $txt): int
    {
        $cw = $this->CurrentFont['cw'];
        $wmax = ($w - 2 * $this->cMargin) * 1000 / $this->FontSize;
        $s = str_replace("\r", '', $txt);
        $nb = strlen($s);
        if ($nb > 0 && $s[$nb - 1] === "\n") { $nb--; }
        $sep = -1; $i = 0; $j = 0; $l = 0; $nl = 1;
        while ($i < $nb) {
            $c = $s[$i];
            if ($c === "\n") { $i++; $sep = -1; $j = $i; $l = 0; $nl++; continue; }
            if ($c === ' ') { $sep = $i; }
            $l += $cw[$c] ?? 500;
            if ($l > $wmax) {
                if ($sep === -1) { if ($i === $j) { $i++; } } else { $i = $sep + 1; }
                $sep = -1; $j = $i; $l = 0; $nl++;
            } else {
                $i++;
            }
        }
        return $nl;
    }

    public function platz(float $h): void
    {
        if ($this->GetY() + $h > $this->GetPageHeight() - 16) { $this->AddPage(); }
    }
}

// Ein Bild aus einer data:-URL in eine Datei, die FPDF lesen kann -- oder
// null, wenn es kein Format ist, das FPDF kennt (etwa SVG). Dann steht die
// Firma als Text, statt dass die Erzeugung abbricht.
function beleg_pdf_bild(string $datenUrl): ?array
{
    if (!preg_match('~^data:image/(png|jpe?g|gif|webp);base64,(.+)$~s', $datenUrl, $m)) { return null; }
    $bin = base64_decode($m[2], true);
    if ($bin === false || $bin === '') { return null; }
    $groesse = @getimagesizefromstring($bin);
    if (!$groesse || $groesse[0] <= 0 || $groesse[1] <= 0) { return null; }
    $typ = $m[1] === 'jpeg' ? 'jpg' : $m[1];
    $datei = tempnam(sys_get_temp_dir(), 'bpdf') . '.' . $typ;
    file_put_contents($datei, $bin);
    return ['datei' => $datei, 'typ' => strtoupper($typ), 'b' => (int)$groesse[0], 'h' => (int)$groesse[1]];
}

// Absender, Kontakt und Fusszeile aus dem Absenderteil des Abbilds -- der
// sieht auf beiden Seiten anders aus (be_briefkopf gegen betrieb).
function beleg_pdf_absender(array $a): array
{
    $zeilen = static fn(string $t): array => array_values(array_filter(array_map('trim', explode("\n", $t))));
    if (array_key_exists('absender', $a)) {
        // Betreiberin (be_briefkopf).
        $abs = $zeilen((string)$a['absender']);
        if (!$abs && trim((string)$a['firma']) !== '') { $abs = [trim((string)$a['firma'])]; }
        $kontakt = array_values(array_filter([trim((string)($a['telefon'] ?? '')), trim((string)($a['email'] ?? '')),
                                              trim((string)($a['webseite'] ?? ''))]));
        $recht = [];
        foreach ([['UID', 'uid'], ['MWST-Nr.', 'mwst_nr'], ['IBAN', 'iban']] as [$l, $f]) {
            if (trim((string)($a[$f] ?? '')) !== '') { $recht[] = $l . ' ' . trim((string)$a[$f]); }
        }
        return ['firma' => trim((string)$a['firma']), 'zeilen' => $abs,
                'fuss_links' => implode(' · ', $kontakt), 'fuss_rechts' => implode(' · ', $recht)];
    }
    // Mandantin (betrieb): Die erste Fusszeile ist die Anschrift.
    return ['firma' => trim((string)($a['firma'] ?? '')), 'zeilen' => array_slice($zeilen((string)($a['fusszeile'] ?? '')), 0, 4),
            'fuss_links' => implode(' · ', $zeilen((string)($a['fusszeile'] ?? ''))),
            'fuss_rechts' => implode(' · ', $zeilen((string)($a['fusszeile2'] ?? '')))];
}

// Das PDF als Zeichenkette. $fassung und $u wie in
// beleg_pruefprotokoll_zeilen(); $u darf null sein (dann ohne Protokoll).
function beleg_pdf(array $abbild, array $fassung, ?array $u, bool $komprimiert = true): string
{
    $b      = (array)($abbild['beleg'] ?? []);
    $art    = (string)($b['art'] ?? 'offerte');
    $titel  = (string)(BELEG_ARTEN[$art]['titel'] ?? 'Beleg');
    $abs    = beleg_pdf_absender((array)($abbild['absender'] ?? []));
    $kunde  = (array)($abbild['kunde'] ?? []);
    $person = (array)($abbild['person'] ?? []);
    $perioden = (array)($abbild['perioden'] ?? []);
    if (!$perioden) { $perioden = ['einmalig' => (array)$abbild['summen']]; }
    $mehr = count($perioden) > 1;
    $T = 'beleg_pdf_text';

    $pdf = new BelegPdf('P', 'mm', 'A4');
    $pdf->SetCompression($komprimiert);
    $pdf->SetMargins(20, 20, 20);
    $pdf->SetAutoPageBreak(true, 20);
    $pdf->AliasNbPages();
    $pdf->SetTitle($titel . ' ' . ($b['nummer'] ?? ''), true);
    $pdf->SetCreator('GuardOpS', true);
    $pdf->fussText = $titel . ' ' . ($b['nummer'] ?? '') . ' · Fassung ' . (int)($fassung['nummer'] ?? 0);
    $pdf->AddPage();
    $pdf->SetTextColor(20, 22, 26);

    // ── Kopf: Logo und Absender links ──────────────────────────────────
    $bilder = [];
    $logo = !empty($abbild['absender']['logo']) ? beleg_pdf_bild((string)$abbild['absender']['logo']) : null;
    if ($logo) {
        $bilder[] = $logo['datei'];
        // Hoechstens 34 mm breit und 16 mm hoch -- dieselbe Groesse wie auf
        // der Seite (130 x 60 px).
        $w = 34; $h = $w * $logo['h'] / $logo['b'];
        if ($h > 16) { $h = 16; $w = $h * $logo['b'] / $logo['h']; }
        $pdf->Image($logo['datei'], 20, 20, $w, $h, $logo['typ']);
        $pdf->SetY(20 + $h + 4);
    } elseif ($abs['firma'] !== '') {
        $pdf->SetFont('Helvetica', 'B', 12);
        $pdf->Cell(0, 6, $T($abs['firma']), 0, 1);
        $pdf->Ln(1);
    }
    $pdf->SetFont('Helvetica', '', 9);
    foreach ($abs['zeilen'] as $z) { $pdf->Cell(0, 4.3, $T($z), 0, 1); }
    $pdf->Ln(9);

    // ── Kopfangaben links, Empfaenger rechts ───────────────────────────
    $yKopf = $pdf->GetY();
    $meta = [[(string)(BELEG_ARTEN[$art]['nummer_label'] ?? 'Nummer'), (string)($b['nummer'] ?? '')],
             ['Datum', beleg_pdf_datum($b['datum'] ?? null)]];
    if (beleg_abbild_datum($b['gueltig_bis'] ?? null) !== null) { $meta[] = ['Gültig bis', beleg_pdf_datum($b['gueltig_bis'])]; }
    if (beleg_abbild_datum($b['faellig_bis'] ?? null) !== null) { $meta[] = ['Fällig bis', beleg_pdf_datum($b['faellig_bis'])]; }
    if ($art === 'vertrag') {
        $monate = static fn(int $n): string => $n === 1 ? '1 Monat' : $n . ' Monate';
        if (beleg_abbild_datum($b['vertrag_beginn'] ?? null) !== null) { $meta[] = ['Beginn', beleg_pdf_datum($b['vertrag_beginn'])]; }
        if (($b['mindestlaufzeit_monate'] ?? null) !== null) { $meta[] = ['Mindestlaufzeit', $monate((int)$b['mindestlaufzeit_monate'])]; }
        if (($b['kuendigungsfrist_monate'] ?? null) !== null) { $meta[] = ['Kündigungsfrist', $monate((int)$b['kuendigungsfrist_monate'])]; }
        if (($b['verlaengerung_monate'] ?? null) !== null) {
            $meta[] = ['Verlängerung', (int)$b['verlaengerung_monate'] === 0
                ? 'keine automatische Verlängerung' : 'um jeweils ' . $monate((int)$b['verlaengerung_monate'])];
        }
    }
    $pdf->SetFont('Helvetica', '', 9);
    foreach ($meta as [$l, $w]) {
        $pdf->SetTextColor(107, 114, 128);
        $pdf->Cell(32, 5, $T($l), 0, 0);
        $pdf->SetTextColor(20, 22, 26);
        $pdf->Cell(60, 5, $T($w), 0, 1);
    }
    $yNachMeta = $pdf->GetY();
    $empf = array_values(array_filter([
        (string)($kunde['name'] ?? ''),
        $person ? trim(($person['anrede'] ?? '') . ' ' . ($person['vorname'] ?? '') . ' ' . ($person['nachname'] ?? '')) : '',
        trim(($kunde['strasse'] ?? '') . ' ' . ($kunde['hausnummer'] ?? '')),
        (string)($kunde['adresszusatz'] ?? ''),
        trim(($kunde['plz'] ?? '') . ' ' . ($kunde['ort'] ?? '')),
    ], static fn($t) => trim((string)$t) !== ''));
    $pdf->SetXY(120, $yKopf);
    foreach ($empf as $z) { $pdf->SetX(120); $pdf->Cell(70, 5, $T($z), 0, 1); }
    $pdf->SetY(max($yNachMeta, $pdf->GetY()) + 10);

    // ── Titel ──────────────────────────────────────────────────────────
    $pdf->SetFont('Helvetica', 'B', 15);
    $pdf->MultiCell(0, 7, $T(trim((string)($b['titel'] ?? '')) !== '' ? (string)$b['titel'] : $titel));
    $pdf->Ln(3);

    // ── Positionen ─────────────────────────────────────────────────────
    $sp = [36, 64, 24, 20, 26];
    $kopfZeile = function () use ($pdf, $sp, $T): void {
        $pdf->SetFont('Helvetica', 'B', 8);
        $pdf->SetFillColor(237, 239, 242);
        foreach ([['Leistung', 'L'], ['Beschreibung', 'L'], ['Einzelpreis', 'R'], ['Menge', 'R'], ['Summe', 'R']] as $i => [$t, $a]) {
            $pdf->Cell($sp[$i], 7, $T($t), 0, 0, $a, true);
        }
        $pdf->Ln();
    };
    $kopfZeile();
    $summen = (array)($abbild['summen'] ?? []);
    foreach ((array)($b['positionen'] ?? []) as $i => $p) {
        $pdf->SetFont('Helvetica', '', 8.5);
        $name = $T((string)$p['produkt_name']);
        $text = $T((string)$p['beschreibung']);
        $menge = (float)$p['menge'];
        $zeile = (int)($summen['zeilen'][$i]['zwischen_rappen'] ?? 0);
        // Mehrere Perioden: Die Summe traegt ihren Zusatz ("pro Monat") --
        // sonst liesse sich am Betrag nicht erkennen, wie oft er anfaellt.
        $zusatz = $mehr ? beleg_periode_zusatz((string)($p['periode'] ?? 'einmalig')) : '';
        $n = max($pdf->zeilen($sp[0], $name), $pdf->zeilen($sp[1], $text), $zusatz !== '' ? 2 : 1);
        $h = 4.2 * $n + 3;
        if ($pdf->GetY() + $h > $pdf->GetPageHeight() - 20) { $pdf->AddPage(); $kopfZeile(); $pdf->SetFont('Helvetica', '', 8.5); }
        $x = $pdf->GetX(); $y = $pdf->GetY();
        $pdf->SetXY($x, $y + 1.5); $pdf->MultiCell($sp[0], 4.2, $name, 0, 'L');
        $pdf->SetXY($x + $sp[0], $y + 1.5); $pdf->MultiCell($sp[1], 4.2, $text, 0, 'L');
        $pdf->SetXY($x + $sp[0] + $sp[1], $y + 1.5);
        $pdf->Cell($sp[2], 4.2, $T(beleg_pdf_chf((int)$p['einzelpreis_rappen'])), 0, 0, 'R');
        $pdf->Cell($sp[3], 4.2, $T(beleg_pdf_zahl($menge) . ' ' . $p['einheit']), 0, 0, 'R');
        $pdf->Cell($sp[4], 4.2, $T(beleg_pdf_chf($zeile) . ' CHF'), 0, 2, 'R');
        if ($zusatz !== '') {
            $pdf->SetFont('Helvetica', '', 7);
            $pdf->SetTextColor(107, 114, 128);
            $pdf->Cell($sp[4], 3.6, $T($zusatz), 0, 0, 'R');
            $pdf->SetTextColor(20, 22, 26);
        }
        $pdf->SetDrawColor(229, 232, 236);
        $pdf->Line($x, $y + $h, $x + array_sum($sp), $y + $h);
        $pdf->SetXY($x, $y + $h);
    }
    $pdf->Ln(4);

    // ── Summen, je Periode ein Block (ENT-637) ─────────────────────────
    $sz = function (string $l, string $w, bool $stark = false) use ($pdf, $T): void {
        $pdf->SetFont('Helvetica', $stark ? 'B' : '', $stark ? 9.5 : 8.5);
        $pdf->SetX(90);
        $pdf->Cell(70, 5, $T($l), 0, 0, 'R');
        $pdf->Cell(30, 5, $T($w), 0, 1, 'R');
    };
    foreach ($perioden as $periode => $ps) {
        $pdf->platz(30);
        $zusatz = beleg_periode_zusatz((string)$periode);
        if ($mehr) {
            $pdf->SetFont('Helvetica', 'B', 7);
            $pdf->SetTextColor(107, 114, 128);
            $pdf->SetX(90);
            $pdf->Cell(100, 5, $T(mb_strtoupper($zusatz !== '' ? $zusatz : 'einmalig')), 0, 1, 'R');
            $pdf->SetTextColor(20, 22, 26);
        }
        $sz('Zwischensumme', beleg_pdf_chf((int)$ps['zwischensumme_rappen']) . ' CHF');
        if ((int)$ps['rabatt_rappen'] > 0) {
            $sz(beleg_pdf_zahl((int)$ps['rabatt_bp'] / 100) . '% Rabatt', '-' . beleg_pdf_chf((int)$ps['rabatt_rappen']) . ' CHF');
        }
        foreach ((array)$ps['mwst'] as $m) {
            $sz(beleg_pdf_chf((int)$m['grundlage_rappen']) . ' CHF ' . beleg_pdf_zahl((int)$m['satz_bp'] / 100) . '% MWST',
                beleg_pdf_chf((int)$m['betrag_rappen']) . ' CHF');
        }
        if ((int)$ps['rundung_rappen'] !== 0) {
            $sz('Rundungsdifferenz', ((int)$ps['rundung_rappen'] > 0 ? '' : '-') . beleg_pdf_chf(abs((int)$ps['rundung_rappen'])) . ' CHF');
        }
        $sz($mehr && $zusatz !== '' ? 'Total ' . $zusatz : 'Total', beleg_pdf_chf((int)$ps['total_rappen']) . ' CHF', true);
        $pdf->Ln(2);
    }

    // ── Notizen und Bedingungen ────────────────────────────────────────
    $abschnitt = function (string $l, ?string $text) use ($pdf, $T): void {
        if (trim((string)$text) === '') { return; }
        $pdf->platz(16);
        $pdf->Ln(4);
        $pdf->SetFont('Helvetica', 'B', 7.5);
        $pdf->SetTextColor(107, 114, 128);
        $pdf->Cell(0, 5, $T(mb_strtoupper($l)), 0, 1);
        $pdf->SetTextColor(20, 22, 26);
        $pdf->SetFont('Helvetica', '', 9);
        $pdf->MultiCell(0, 4.6, $T((string)$text), 0, 'L');
    };
    $abschnitt('Notizen', $b['oeffentliche_notizen'] ?? '');
    $abschnitt('Bedingungen', $b['bedingungen'] ?? '');

    // ── Unterschriften ─────────────────────────────────────────────────
    $angenommen = $u !== null && ($u['art'] ?? '') === 'annahme';
    if (!empty($b['unterschriftsseite']) || $angenommen) {
        $pdf->platz(68);
        $pdf->Ln(8);
        $pdf->SetFont('Helvetica', 'B', 7.5);
        $pdf->SetTextColor(107, 114, 128);
        $pdf->Cell(0, 5, 'UNTERSCHRIFTEN', 0, 1);
        $pdf->SetFont('Helvetica', '', 8.5);
        $pdf->Cell(0, 5, 'Ort, Datum', 0, 1);
        $pdf->SetTextColor(20, 22, 26);
        $t = $angenommen ? strtotime((string)$u['bestaetigt_am']) : false;
        $pdf->Cell(70, 6, $angenommen ? $T('Elektronisch angenommen am ' . ($t ? date('d.m.Y', $t) : '–')) : '', 'B', 1);
        // 18 mm Hoehe fuer die Unterschriften (ENT-704). Mit 12 mm wurde eine
        // Zeichnung vom ganzen Bildschirm zum Haarstrich.
        $pdf->Ln(20);
        $y = $pdf->GetY();
        $links = 20; $rechts = 110; $breite = 80;
        $unten = 0.0;   // wie weit eine Unterschrift unter die Linie reicht, in mm
        $unterschriftSetzen = function (array $bild, float $x, string $url) use ($pdf, $y, $breite, &$bilder, &$unten): void {
            $bilder[] = $bild['datei'];
            $h = 18; $w = $h * $bild['b'] / $bild['h'];
            if ($w > $breite) { $w = $breite; $h = $w * $bild['h'] / $bild['b']; }
            // Die Grundlinie der Schrift auf die Linie (ENT-706), erkannt im
            // Bild: Luft und Unterlaengen reichen darunter.
            $anteil = beleg_unterschrift_grundlinie($url);
            $pdf->Image($bild['datei'], $x, $y - $h * (1 - $anteil), $w, $h, $bild['typ']);
            $unten = max($unten, $h * $anteil);
        };
        // Unsere Unterschrift aus der Freigabe (ENT-704), fest in der Fassung.
        $fu = !empty($fassung['freigegeben']) ? beleg_freigabe_unterschrift($abbild) : null;
        $fuBild = $fu ? beleg_pdf_bild($fu['bild']) : null;
        if ($fuBild) { $unterschriftSetzen($fuBild, $rechts, $fu['bild']); }
        if ($angenommen) {
            $zeichnung = !empty($u['zeichnung']) ? beleg_pdf_bild((string)$u['zeichnung']) : null;
            if ($zeichnung) {
                $unterschriftSetzen($zeichnung, $links, (string)$u['zeichnung']);
            } else {
                $pdf->SetFont('Helvetica', 'I', 14);
                $pdf->SetXY($links, $y - 8);
                $pdf->Cell($breite, 7, $T((string)$u['name']), 0, 0);
            }
            if (!$fuBild && !empty($fassung['freigegeben']) && trim((string)($fassung['versendet_von'] ?? '')) !== '') {
                $pdf->SetFont('Helvetica', 'I', 14);
                $pdf->SetXY($rechts, $y - 8);
                $pdf->Cell($breite, 7, $T((string)$fassung['versendet_von']), 0, 0);
            }
        }
        $pdf->SetDrawColor(20, 22, 26);
        $pdf->Line($links, $y, $links + $breite, $y);
        $pdf->Line($rechts, $y, $rechts + $breite, $y);
        // Unter die tiefste Unterlaenge der Unterschriften (ENT-706).
        $pdf->SetXY($links, $y + max(1.5, $unten + 1.5));
        $pdf->SetFont('Helvetica', '', 7.5);
        $pdf->SetTextColor(107, 114, 128);
        $auftraggeber = trim((string)($kunde['name'] ?? '')) ?: 'Auftraggeber';
        $auftragnehmer = $abs['firma'] !== '' ? $abs['firma'] : 'Auftragnehmer';
        $pdf->Cell($breite, 4, $T('Unterschrift ' . $auftraggeber), 0, 0);
        $pdf->SetX($rechts);
        $pdf->Cell($breite, 4, $T('Unterschrift ' . $auftragnehmer), 0, 1);
        $pdf->SetTextColor(20, 22, 26);
    }

    // ── Fusszeile des Belegs und des Absenders ─────────────────────────
    $fuss = trim((string)($b['fusszeile_text'] ?? ''));
    if ($fuss !== '' || $abs['fuss_links'] !== '' || $abs['fuss_rechts'] !== '') {
        $pdf->platz(20);
        $pdf->Ln(8);
        $pdf->SetDrawColor(229, 232, 236);
        $pdf->Line(20, $pdf->GetY(), 190, $pdf->GetY());
        $pdf->Ln(3);
        if ($fuss !== '') { $pdf->SetFont('Helvetica', '', 8.5); $pdf->MultiCell(0, 4.4, $T($fuss), 0, 'L'); $pdf->Ln(1); }
        $pdf->SetFont('Helvetica', '', 7.5);
        $pdf->SetTextColor(107, 114, 128);
        if ($abs['fuss_links'] !== '') { $pdf->MultiCell(0, 3.8, $T($abs['fuss_links']), 0, 'L'); }
        if ($abs['fuss_rechts'] !== '') { $pdf->MultiCell(0, 3.8, $T($abs['fuss_rechts']), 0, 'L'); }
        $pdf->SetTextColor(20, 22, 26);
    }

    // ── Pruefprotokoll (ENT-688, Punkt 8) ──────────────────────────────
    if ($angenommen) {
        // Das Protokoll bleibt beisammen. Seine Hoehe wird GERECHNET, nicht
        // geschaetzt: Eine geschaetzte Hoehe liess den letzten Satz allein
        // auf die naechste Seite rutschen (gemessen am gerenderten PDF).
        $zeilenP = beleg_pruefprotokoll_zeilen($b, $fassung, $u);
        $pdf->SetFont('Helvetica', '', 8);
        $hoehe = 8 + 3 + 5 + 2 + 2 * 3.8 + 2;
        foreach ($zeilenP as [, $w]) { $hoehe += 4.4 * $pdf->zeilen(130, $T($w)); }
        $pdf->SetFont('Helvetica', '', 7.5);
        $hoehe += 3.8 * max(0, $pdf->zeilen(170, $T('Einfache elektronische Signatur mit Bestätigungscode per E-Mail. '
            . 'Die Prüfsumme weist nach, dass das angenommene Dokument seit der Annahme unverändert ist.')) - 2);
        $pdf->platz($hoehe);
        $pdf->Ln(8);
        $pdf->SetDrawColor(229, 232, 236);
        $pdf->Line(20, $pdf->GetY(), 190, $pdf->GetY());
        $pdf->Ln(3);
        $pdf->SetFont('Helvetica', 'B', 7.5);
        $pdf->SetTextColor(107, 114, 128);
        $pdf->Cell(0, 5, $T(mb_strtoupper('Prüfprotokoll der elektronischen Annahme')), 0, 1);
        foreach ($zeilenP as [$l, $w]) {
            $pdf->SetFont('Helvetica', '', 8);
            $pdf->SetTextColor(107, 114, 128);
            $y = $pdf->GetY();
            $pdf->Cell(40, 4.4, $T($l), 0, 0);
            $pdf->SetTextColor(20, 22, 26);
            $pdf->SetFont($l === 'Prüfsumme (SHA-256)' ? 'Courier' : 'Helvetica', '', $l === 'Prüfsumme (SHA-256)' ? 7.5 : 8);
            $pdf->SetXY(60, $y);
            $pdf->MultiCell(130, 4.4, $T($w), 0, 'L');
        }
        $pdf->Ln(2);
        $pdf->SetFont('Helvetica', '', 7.5);
        $pdf->SetTextColor(107, 114, 128);
        $pdf->MultiCell(0, 3.8, $T('Einfache elektronische Signatur mit Bestätigungscode per E-Mail. Die Prüfsumme '
            . 'weist nach, dass das angenommene Dokument seit der Annahme unverändert ist.'), 0, 'L');
    }

    $raus = $pdf->Output('S');
    foreach ($bilder as $d) { @unlink($d); @unlink(preg_replace('/\.[a-z]+$/', '', $d)); }
    return $raus;
}

// ══════════════════════════════════════════════════════════════════════════
// Nach der Annahme: PDF ablegen, Bestaetigungen verschicken (Schritt 3)
// ══════════════════════════════════════════════════════════════════════════
//
// Laeuft im Kontext von beleg_unterschrift_ablauf(), NACHDEM der Beleg
// angenommen ist. Nichts hier darf die Annahme rueckgaengig machen oder
// scheitern lassen: Angenommen ist mit dem richtigen Code, nicht mit einer
// zugestellten Mail. Jeder Teil steht darum fuer sich in try/catch, und das
// Ergebnis sagt, was geklappt hat.

// Die Bestaetigung an den Unterzeichnenden und an die eigene Seite. Mit
// Anhang, darum ohne Link: Das Dokument ist dabei.
//
// $mitLogo: nur die Betreiberin zeichnet mit dem GuardOpS-Logo. Im Cockpit
// schreibt die Mandantin an IHRE Kunden -- deren Briefkopf in der Mail ist
// eine eigene Frage (OP-675), und bis dahin steht dort kein fremdes Logo.
function beleg_bestaetigung_mail(array $beleg, array $u, int $fassung, string $firma,
                                 bool $intern, array $signaturZeilen = [], bool $mitLogo = true): array
{
    $art    = (string)($beleg['art'] ?? 'offerte');
    $titel  = (string)(BELEG_ARTEN[$art]['titel'] ?? 'Beleg');
    $nummer = (string)($beleg['nummer'] ?? '');
    $am     = beleg_zeitpunkt($u['bestaetigt_am'] ?? null);
    $wer    = implode(', ', array_filter([(string)$u['name'], (string)$u['funktion'], (string)$u['firma']],
        static fn($t) => trim($t) !== ''));

    if ($intern) {
        $betreff = "Angenommen: $titel $nummer";
        $felder = [['Angenommen von', $wer], ['Am', $am], ['Fassung', (string)$fassung],
                   ['Bestätigungscode an', (string)$u['email']]];
        $hinweis = !empty($u['abweichend'])
            ? 'Achtung: Der Code ging nicht an die Empfängeradresse des Belegs ('
              . ((string)$u['empfaenger_email'] !== '' ? $u['empfaenger_email'] : 'keine hinterlegt') . ').'
            : '';
        $text = "Guten Tag\n\nDie $titel $nummer ist elektronisch angenommen.\n\n";
        foreach ($felder as [$l, $w]) { $text .= "$l: $w\n"; }
        $text .= ($hinweis !== '' ? "\n$hinweis\n" : '') . "\nDas unterschriebene Dokument mit Prüfprotokoll liegt bei.\n";
        $block = '';
        foreach ($felder as [$l, $w]) { $block .= mail_feld($l, mail_e($w), false, true); }
        $inhalt = mail_absatz('Guten Tag')
            . mail_absatz('Die <b>' . mail_e("$titel $nummer") . '</b> ist elektronisch angenommen.')
            . mail_block($block, true)
            . ($hinweis !== '' ? mail_absatz('<b>' . mail_e($hinweis) . '</b>') : '')
            . mail_absatz('Das unterschriebene Dokument mit Prüfprotokoll liegt bei.');
        return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt), 'bilder' => []];
    }

    $gruss = $signaturZeilen === [] ? [$firma !== '' ? $firma : 'Ihr Ansprechpartner'] : $signaturZeilen;
    $anrede = 'Guten Tag ' . trim((string)$u['name']) . ',';
    $betreff = "Bestätigung: $titel $nummer angenommen";
    $text = "$anrede\n\n"
        . "vielen Dank. Sie haben die $titel $nummer (Fassung $fassung) am $am angenommen.\n\n"
        . "Das unterschriebene Dokument mit Prüfprotokoll liegt dieser E-Mail bei. Bitte bewahren Sie es auf.\n\n"
        . "Mit freundlichen Grüssen\n" . implode("\n", $gruss);
    $logo = $mitLogo ? mail_logo() : null;
    $logoHell = $mitLogo ? mail_logo_hell() : null;
    $inhalt = mail_absatz(mail_e($anrede))
        . mail_absatz('vielen Dank. Sie haben die <b>' . mail_e("$titel $nummer") . '</b> (Fassung ' . $fassung
            . ') am ' . mail_e($am) . ' angenommen.')
        . mail_absatz('Das unterschriebene Dokument mit Prüfprotokoll liegt dieser E-Mail bei. Bitte bewahren Sie es auf.')
        . mail_signatur($gruss, $logo === null ? '' : (string)$logo['cid'], $logoHell === null ? '' : (string)$logoHell['cid']);
    return ['betreff' => $betreff, 'text' => $text, 'html' => mail_rahmen($inhalt),
            'bilder' => array_values(array_filter([$logo, $logoHell]))];
}

// Wer auf der eigenen Seite die Bestaetigung bekommt.
//   Betreiberin: die aktiven Konten und das Sammelpostfach -- dieselbe Liste
//                wie beim Aenderungswunsch (be_melde_empfaenger()).
//   Mandantin:   die Person, die die Fassung versendet hat, an ihre
//                hinterlegte Adresse (Entscheid des Projektinhabers). Fehlt
//                sie, bekommt niemand eine Mail; die Annahme steht dann wie
//                bisher nur in der Uebersicht.
function beleg_bestaetigung_empfaenger(PDO $pdo, string $tabPraefix, array $fassung): array
{
    if ($tabPraefix === 'be_') {
        return function_exists('be_melde_empfaenger') ? be_melde_empfaenger($pdo) : [];
    }
    $vonId = (int)($fassung['versendet_von_id'] ?? 0);
    if ($vonId <= 0) { return []; }
    try {
        $s = $pdo->prepare('SELECT name, email FROM mitarbeiter WHERE id = ?');
        $s->execute([$vonId]);
        $m = $s->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        return [];
    }
    $mail = trim((string)($m['email'] ?? ''));
    return ($mail !== '' && filter_var($mail, FILTER_VALIDATE_EMAIL))
        ? [['name' => (string)$m['name'], 'email' => $mail]] : [];
}

function beleg_annahme_abschliessen(PDO $pdo, string $tabPraefix, int $belegId, array $beleg,
                                    string $firma, array $signaturZeilen = []): array
{
    $raus = ['pdf' => false, 'kunde' => false, 'intern' => 0];
    $u = beleg_unterschrift_letzte($pdo, $tabPraefix, $belegId);
    $f = beleg_letzte_fassung($pdo, $belegId, $tabPraefix);
    if (!$u || $u['art'] !== 'annahme' || !$f || !$f['echt']) { return $raus; }

    $pdf = null;
    try {
        $pdf = beleg_pdf($f['abbild'], $f, $u);
        // EINMAL: Steht schon ein PDF da, bleibt es. Ein zweiter Aufruf
        // erzeugt keines, das vom ersten abweicht.
        $s = $pdo->prepare('UPDATE ' . beleg_tabelle($tabPraefix, 'beleg_unterschrift')
            . ' SET pdf = ?, pdf_pruefsumme = ? WHERE id = ? AND pdf IS NULL');
        $s->bindValue(1, $pdf, PDO::PARAM_LOB);
        $s->bindValue(2, hash('sha256', $pdf));
        $s->bindValue(3, (int)$u['id'], PDO::PARAM_INT);
        $s->execute();
        $raus['pdf'] = true;
    } catch (Throwable $e) {
        $pdf = null;
    }

    $titel = (string)(BELEG_ARTEN[(string)$beleg['art']]['titel'] ?? 'Beleg');
    $anhang = $pdf !== null
        ? [['name' => preg_replace('/[^A-Za-z0-9._-]/', '-', "$titel-{$beleg['nummer']}-angenommen") . '.pdf',
            'mime' => 'application/pdf', 'inhalt' => $pdf]]
        : [];
    try {
        $m = beleg_bestaetigung_mail($beleg, $u, (int)$f['nummer'], $firma, false, $signaturZeilen,
                                     $tabPraefix === 'be_');
        smtp_senden((string)$u['email'], (string)$u['name'], $m['betreff'], $m['html'], $m['text'], $anhang, $m['bilder']);
        $raus['kunde'] = true;
    } catch (Throwable $e) {
        // Angenommen ist angenommen -- siehe Kopf.
    }
    foreach (beleg_bestaetigung_empfaenger($pdo, $tabPraefix, $f) as $e) {
        try {
            $m = beleg_bestaetigung_mail($beleg, $u, (int)$f['nummer'], $firma, true);
            smtp_senden((string)$e['email'], (string)($e['name'] ?? ''), $m['betreff'], $m['html'], $m['text'], $anhang, []);
            $raus['intern']++;
        } catch (Throwable $x) {
            // Eine unzustellbare Adresse haelt die uebrigen nicht auf.
        }
    }
    return $raus;
}

// Das gespeicherte PDF einer Annahme -- oder null.
function beleg_pdf_gespeichert(PDO $pdo, string $tabPraefix, int $belegId): ?string
{
    if (!beleg_unterschrift_tabelle_da($pdo, $tabPraefix)
        || !beleg_spalte_da_portabel($pdo, beleg_tabelle($tabPraefix, 'beleg_unterschrift'), 'pdf')) {
        return null;
    }
    $s = $pdo->prepare('SELECT pdf, pdf_pruefsumme FROM ' . beleg_tabelle($tabPraefix, 'beleg_unterschrift')
        . " WHERE beleg_id = ? AND art = 'annahme' AND bestaetigt_am IS NOT NULL AND pdf IS NOT NULL
          ORDER BY id DESC LIMIT 1");
    $s->execute([$belegId]);
    $z = $s->fetch(PDO::FETCH_ASSOC);
    if (!$z) { return null; }
    $pdf = is_resource($z['pdf']) ? stream_get_contents($z['pdf']) : (string)$z['pdf'];
    // Die Pruefsumme stimmt, oder es gibt kein PDF -- dieselbe Haltung wie
    // bei den Fassungen.
    return hash_equals((string)$z['pdf_pruefsumme'], hash('sha256', $pdf)) ? $pdf : null;
}
