<?php
// Unangemeldete Ansicht einer Offerte der Betreiberin (ENT-605).
//
// Bewusst OHNE Anmeldung: Der Empfaenger ist ein Betrieb, der diese
// Plattform noch nicht nutzt -- er hat kein Konto und soll fuer eine Offerte
// auch keines anlegen muessen. Der 256-Bit-Token in der URL ersetzt die
// Anmeldung, nicht durch ein Formular, sondern dadurch, dass er praktisch
// nicht zu erraten ist. Dieselbe Bauart wie beleg_oeffentlich.php im
// Cockpit; dieser Endpunkt steht darum ebenfalls namentlich in der Liste
// OHNE_ANMELDUNG in test_php.mjs.
//
// Liefert IMMER HTML, nie JSON -- auch im Fehlerfall. Der globale
// Exception-Handler aus db.php wuerde sonst rohes JSON an jemanden
// ausliefern, der nie eine API-Antwort erwartet.
//
// KEIN QR-ZAHLTEIL: Der Betreiber-Bereich kennt heute nur Offerten. Eine
// Offerte wird nicht bezahlt, und ein Zahlteil ohne Rechnung waere eine
// Aufforderung ohne Forderung. Kommt die Rechnungsseite dazu, gehoert er
// hierher -- mit der QR-IBAN aus dem Briefkopf.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';
require_once __DIR__ . '/../qrrechnung.php';

function portal_esc(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function portal_nf(float $n, int $d): string
{
    return number_format($n, $d, '.', "\u{2019}");
}

function portal_leeres_datum(?string $d): bool
{
    return !$d || substr($d, 0, 10) === '0000-00-00';
}

function portal_dmy(?string $d): string
{
    if (portal_leeres_datum($d)) { return '–'; }
    return implode('.', array_reverse(explode('-', substr((string)$d, 0, 10))));
}

function portal_chf(int $rappen): string
{
    return portal_nf($rappen / 100, 2);
}

function portal_bp(int $bp): string
{
    $p = $bp / 100;
    return portal_nf($p, (fmod($p, 1.0) === 0.0) ? 0 : 2);
}

// Kleine, in sich geschlossene Seite -- fuer Fehlermeldungen wie fuer den
// Inhalt, damit beide dieselbe Kopfzeile tragen und nicht an zwei Stellen
// gepflegt werden muessen.
function portal_seite(string $titel, string $inhalt): void
{
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="de"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex, nofollow">'
        . '<title>' . portal_esc($titel) . '</title>'
        . '<style>
            body{font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#14161A;
                 background:#F4F5F7;margin:0;padding:32px 16px}
            .buehne{max-width:1040px;margin:0 auto;display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap}
            .zusammenfassung{flex:0 0 300px;background:#fff;border-radius:12px;
                   padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
            .karte{flex:1 1 480px;min-width:0;background:#fff;border-radius:12px;
                   padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
            table{border-collapse:collapse;width:100%}
            .knopf{display:inline-block;padding:12px 24px;border-radius:8px;font-size:14px;
                   font-weight:700;text-decoration:none;border:none;cursor:pointer;min-height:44px}
            .knopf-an{background:#1C7C3E;color:#fff}
            .knopf-ab{background:#fff;color:#B3261E;border:1px solid #B3261E}
            .knopf-plain{background:#fff;color:#14161A;border:1px solid #D6DAE0;min-height:36px;padding:8px 16px}
            .hinweis{padding:14px 18px;border-radius:8px;margin-bottom:24px;font-size:14px}
            .hinweis-versendet{background:#EFF3FF;color:#1F3A8A}
            .hinweis-an{background:#E8F5E9;color:#1C7C3E}
            .hinweis-ab{background:#FDECEA;color:#B3261E}
            .zf-titel{font-size:19px;font-weight:700;margin-bottom:14px}
            .zf-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
                      color:#6B7280;margin:18px 0 6px}
            .zf-label:first-of-type{margin-top:0}
            /* Der Faden am Beleg (ENT-677). Der dritte Weg ist bewusst
               zurueckhaltend gesetzt: Annehmen und Ablehnen bleiben die
               beiden Hauptwege. */
            .knopf-still{background:#fff;color:#14161A;border:1px solid #D6DAE0;
                   font-weight:600}
            .faden{margin-top:24px;border-top:1px solid #E5E8EC;padding-top:18px}
            .nachricht{margin-bottom:14px;font-size:13px;line-height:1.5}
            .nachricht .wer{font-size:11px;color:#6B7280;margin-bottom:2px}
            .nachricht .was{white-space:pre-line}
            .nachricht-betreiber .was{background:#F4F5F7;border-radius:8px;padding:10px 12px}
            .faden textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;
                   border:1px solid #D6DAE0;border-radius:8px;padding:10px;min-height:110px}
            .faden input[type=text]{width:100%;box-sizing:border-box;font:inherit;font-size:16px;
                   border:1px solid #D6DAE0;border-radius:8px;padding:10px;margin-bottom:8px}
            @media print{body{background:#fff;padding:0}.buehne{display:block}
                         #dokumentSeite{min-height:960px}
                         .zusammenfassung{display:none}.karte{box-shadow:none;padding:0}
                         .keindruck{display:none}}
            .pos-rahmen{overflow-x:auto;-webkit-overflow-scrolling:touch}
            @media print{.pos-rahmen{overflow:visible}}
            @media (max-width:720px){.buehne{display:block}.zusammenfassung{margin-bottom:20px}
                                     .karte,.zusammenfassung{padding:22px 16px}
                                     .pos-rahmen td,.pos-rahmen th{padding-left:4px!important;padding-right:4px!important;font-size:11px!important}}
          ' . beleg_unterschrift_css() . '</style></head><body><div class="buehne">' . $inhalt . '</div></body></html>';
    exit;
}

function portal_fehler(string $titel, string $text, int $code = 404): void
{
    http_response_code($code);
    portal_seite($titel, '<div class="karte" style="flex:1 1 auto;margin:0 auto;max-width:520px">'
        . '<h1 style="font-size:18px">' . portal_esc($titel) . '</h1><p>' . portal_esc($text) . '</p></div>');
}

try {
    $token = (string)($_GET['token'] ?? '');
    if ($token === '') {
        portal_fehler('Link unvollständig', 'Diesem Link fehlt ein notwendiger Bestandteil.', 400);
    }

    $pdo = betreiber_db();
    if (!hat_tabelle($pdo, 'be_belege')) {
        portal_fehler('Link ungültig', 'Dieser Link ist nicht (mehr) gültig. '
            . 'Bitte wenden Sie sich an den Absender.');
    }

    $s = $pdo->prepare('SELECT * FROM be_belege WHERE versand_token = ?');
    $s->execute([$token]);
    $b = $s->fetch();
    if (!$b) {
        portal_fehler('Link ungültig', 'Dieser Link ist nicht (mehr) gültig. '
            . 'Bitte wenden Sie sich an den Absender.');
    }

    // WAS DER EMPFAENGER SIEHT, IST DIE LETZTE VERSENDETE FASSUNG (ENT-688),
    // nicht der Beleg, wie er gerade im Formular steht. Kopf, Positionen,
    // Summen, Anschrift und Briefkopf kommen aus ihrem Abbild; aus der
    // lebenden Zeile bleiben nur Status, Entscheidung und Token.
    //
    // Gibt es noch keine Fassung (versendet vor ENT-688, oder die Tabelle
    // fehlt bis zum Einrichtungslauf), zeigt die Seite den Beleg wie bisher.
    $fassung = beleg_letzte_fassung($pdo, (int)$b['id'], 'be_');
    if ($fassung && !$fassung['echt']) {
        // Die Pruefsumme passt nicht mehr zum Abbild. Dann wird nichts
        // angezeigt: Eine veraenderte Fassung als echt auszugeben waere
        // schlimmer als gar keine.
        portal_fehler('Dokument nicht verfügbar', 'Dieses Dokument lässt sich gerade nicht '
            . 'anzeigen. Bitte wenden Sie sich an den Absender.', 500);
    }
    $abbild = $fassung
        ? $fassung['abbild']
        : beleg_abbild_lesen($pdo, (int)$b['id'], 'be_', be_beleg_absender($pdo));
    $kunde  = $abbild['kunde'] ?? null;
    $person = $abbild['person'] ?? null;
    $bk     = (array)($abbild['absender'] ?? []);
    $b      = array_merge($b, (array)($abbild['beleg'] ?? []));

    $firma = trim((string)($bk['firma'] ?? ''));
    $absenderZeilen = array_values(array_filter(array_map('trim',
        explode("\n", (string)($bk['absender'] ?? '')))));
    if (!$absenderZeilen && $firma !== '') { $absenderZeilen = [$firma]; }
    $logoDatenUrl = !empty($bk['logo']) ? (string)$bk['logo'] : null;

    // Fusszeile am unteren Blattrand: die Angaben, die zu einem Beleg
    // gehoeren, wenn sie erfasst sind. Leere Felder erscheinen nicht --
    // "UID: " ohne Nummer waere eine leere Behauptung.
    $fussTeile = [];
    foreach ([['UID', 'uid'], ['MWST-Nr.', 'mwst_nr'], ['IBAN', 'iban']] as [$label, $feld]) {
        if (trim((string)($bk[$feld] ?? '')) !== '') {
            $fussTeile[] = $label . ' ' . trim((string)$bk[$feld]);
        }
    }
    $kontaktTeile = [];
    foreach (['telefon', 'email', 'webseite'] as $feld) {
        if (trim((string)($bk[$feld] ?? '')) !== '') { $kontaktTeile[] = trim((string)$bk[$feld]); }
    }
    $betriebFusszeile = '';
    if ($fussTeile || $kontaktTeile) {
        $betriebFusszeile = '<div style="margin-top:30px;padding-top:10px;border-top:1px solid #E5E8EC;'
            . 'display:flex;align-items:center;justify-content:space-between;gap:32px;'
            . 'font-size:10.5px;color:#6B7280;line-height:1.5">'
            . ($kontaktTeile ? '<div>' . portal_esc(implode(' · ', $kontaktTeile)) . '</div>' : '')
            . ($fussTeile ? '<div>' . portal_esc(implode(' · ', $fussTeile)) . '</div>' : '')
            . '</div>';
    }

    // Positionen und Summen aus dem Abbild -- GERECHNET gespeichert und hier
    // nicht neu gerechnet: Eine spaetere Aenderung der Formel darf eine
    // versendete Offerte nicht veraendern.
    $summen = (array)$abbild['summen'];
    // Ein Vertrag rechnet je Periode (ENT-637). Offerte und Rechnung haben
    // genau eine, und fuer sie sieht das Blatt danach aus wie vorher.
    $perioden = (array)($abbild['perioden'] ?? []);
    if (!$perioden) { $perioden = ['einmalig' => $summen]; }
    $mehrPerioden = count($perioden) > 1;
    // Der Betrag in der Seitenspalte. Bei einem Vertrag OHNE einmalige
    // Position waere das bisherige $summen['total_rappen'] eine Null -- und
    // "Total 0.00 CHF" ueber einer Monatsgebuehr von 450 Franken waere die
    // falscheste Zahl, die dort stehen koennte. Darum die erste tatsaechlich
    // vorhandene Periode, mit ihrem Zusatz daneben.
    $leitPeriode = (string)array_key_first($perioden);
    $leitBetrag  = (int)$perioden[$leitPeriode]['total_rappen'];
    $leitLabel   = beleg_periode_zusatz($leitPeriode) !== ''
                 ? 'Total ' . beleg_periode_zusatz($leitPeriode) : 'Total';

    $entschieden = !empty($b['entscheidung_am']);
    $heute = date('Y-m-d');
    $abgelaufen = !$entschieden && !empty($b['gueltig_bis']) && !portal_leeres_datum($b['gueltig_bis'])
        && substr((string)$b['gueltig_bis'], 0, 10) < $heute;

    // 'angeschaut' wird hier gesetzt, weil das System es an dieser Stelle
    // WEISS -- anders als beim Status von Hand. Eine bereits getroffene
    // Entscheidung oder ein abgelaufener Link wird dadurch nicht
    // ueberschrieben.
    if (!$entschieden && !$abgelaufen && $b['status'] === 'versendet') {
        $pdo->prepare("UPDATE be_belege SET status = 'angeschaut' WHERE id = ?")->execute([(int)$b['id']]);
        $b['status'] = 'angeschaut';
    }

    // Der Faden am Beleg (ENT-677). Fehlt die Tabelle, ist er leer -- und
    // dann wird auch kein Eingabefeld angeboten, statt eines zu zeigen, das
    // nichts entgegennimmt.
    $fadenDa      = be_beleg_nachricht_tabelle_da($pdo);
    $nachrichten  = be_beleg_nachrichten($pdo, (int)$b['id']);

    // Die Unterschrift am Link (ENT-688, Schritt 2). Fehlt die Tabelle, bleibt
    // es beim bisherigen Annehmen per Klick -- bis zum Einrichtungslauf.
    $unterschriftDa = beleg_unterschrift_tabelle_da($pdo, 'be_');
    $unterschrift   = beleg_unterschrift_letzte($pdo, 'be_', (int)$b['id']);

    $titel = BELEG_ARTEN[$b['art']]['titel'] ?? 'Beleg';
    $datumLabel  = BELEG_ARTEN[$b['art']]['datum_label'] ?? 'Datum';
    $nummerLabel = BELEG_ARTEN[$b['art']]['nummer_label'] ?? 'Nummer';

    $empfaenger = array_values(array_filter([
        $kunde['name'] ?? '',
        $person ? trim(($person['anrede'] ?? '') . ' ' . ($person['vorname'] ?? '') . ' ' . ($person['nachname'] ?? '')) : '',
        $kunde ? trim(($kunde['strasse'] ?? '') . ' ' . ($kunde['hausnummer'] ?? '')) : '',
        $kunde['adresszusatz'] ?? '',
        $kunde ? trim(($kunde['plz'] ?? '') . ' ' . ($kunde['ort'] ?? '')) : '',
    ]));

    $zeilen = '';
    foreach ($b['positionen'] as $i => $p) {
        $z = $summen['zeilen'][$i] ?? ['zwischen_rappen' => 0];
        $mengeD = (float)$p['menge'];
        $td = 'padding:9px 8px;border-bottom:1px solid #E5E8EC;font-size:12px';
        $zeilen .= '<tr>'
            . '<td style="' . $td . '">' . portal_esc($p['produkt_name']) . '</td>'
            . '<td style="' . $td . ';white-space:pre-line">' . portal_esc($p['beschreibung']) . '</td>'
            . '<td style="' . $td . ';text-align:right;white-space:nowrap">' . portal_chf((int)$p['einzelpreis_rappen']) . '</td>'
            . '<td style="' . $td . ';text-align:right;white-space:nowrap">' . portal_nf($mengeD, floor($mengeD) === $mengeD ? 0 : 2) . ' ' . portal_esc($p['einheit']) . '</td>'
            // Sobald ein Blatt mehrere Perioden traegt, steht sie an JEDER
            // Zeile. Ohne sie liesse sich am Betrag nicht erkennen, ob er
            // einmal oder jeden Monat faellig wird -- und genau das ist die
            // Frage, die der Empfaenger an diese Tabelle hat.
            . '<td style="' . $td . ';text-align:right;white-space:nowrap">' . portal_chf((int)$z['zwischen_rappen']) . ' CHF'
            . ($mehrPerioden && beleg_periode_zusatz((string)($p['periode'] ?? 'einmalig')) !== ''
               ? '<div style="font-size:10.5px;color:#6B7280">'
                 . portal_esc(beleg_periode_zusatz((string)($p['periode'] ?? 'einmalig'))) . '</div>'
               : '')
            . '</td>'
            . '</tr>';
    }

    $sz = function (string $label, string $wert, bool $stark = false): string {
        $fs = $stark ? '13px' : '12px';
        $fw = $stark ? ';font-weight:700' : '';
        return '<tr><td style="padding:4px 8px;text-align:right;font-size:12px' . $fw . '">' . $label . '</td>'
            . '<td style="padding:4px 8px;text-align:right;font-size:' . $fs . ';white-space:nowrap' . $fw . '">' . $wert . '</td></tr>';
    };
    // JE PERIODE EIN EIGENER BLOCK, und keine Zahl darueber (ENT-637): Eine
    // einmalige Einrichtung und eine Monatsgebuehr in einer Summe waere ein
    // Betrag, den niemand bezahlt (Hausregel: Einheiten nie vermischen).
    // Am Total steht, wofuer es gilt -- aber nur, wenn es mehr als eine
    // Periode gibt; auf einer Offerte hiesse „Total einmalig" nichts.
    $summenHtml = '';
    foreach ($perioden as $periode => $ps) {
        $zusatz = beleg_periode_zusatz((string)$periode);
        if ($mehrPerioden) {
            $summenHtml .= '<tr><td colspan="2" style="padding:10px 8px 2px;text-align:right;'
                . 'font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#6B7280">'
                . portal_esc($zusatz !== '' ? $zusatz : 'einmalig') . '</td></tr>';
        }
        $summenHtml .= $sz('Zwischensumme', portal_chf($ps['zwischensumme_rappen']) . ' CHF');
        if ($ps['rabatt_rappen'] > 0) {
            $summenHtml .= $sz(portal_bp($ps['rabatt_bp']) . '% Rabatt', '-' . portal_chf($ps['rabatt_rappen']) . ' CHF');
        }
        foreach ($ps['mwst'] as $m) {
            $summenHtml .= $sz(portal_chf($m['grundlage_rappen']) . ' CHF ' . portal_bp($m['satz_bp']) . '% MWST',
                portal_chf($m['betrag_rappen']) . ' CHF');
        }
        if ($ps['rundung_rappen'] !== 0) {
            $summenHtml .= $sz('Rundungsdifferenz',
                ($ps['rundung_rappen'] > 0 ? '' : '-') . portal_chf(abs($ps['rundung_rappen'])) . ' CHF');
        }
        $summenHtml .= $sz($mehrPerioden && $zusatz !== '' ? 'Total ' . $zusatz : 'Total',
            portal_chf($ps['total_rappen']) . ' CHF', true);
    }

    // ── QR-Zahlteil (ENT-616) ─────────────────────────────────────────
    //
    // Nur bei einer offenen, unbezahlten Rechnung mit hinterlegter, gueltiger
    // IBAN und vollstaendiger Adresse. Fehlt etwas davon, bleibt der Block
    // schlicht weg -- ein nicht scannbarer Code waere schlimmer als keiner,
    // weil er aussieht, als koenne man ihn benutzen (so schon ENT-205).
    //
    // NICHT "keindruck": Genau dieser Teil soll auf dem Papier landen.
    //
    // ZWEI REFERENZARTEN (Unterschied zur Mandantenseite): Eine QR-IBAN
    // traegt eine Referenznummer, eine normale IBAN die Rechnungsnummer als
    // Mitteilung. Beides ist ein gueltiger Einzahlungsschein; welcher es
    // wird, entscheidet qr_referenzteil().
    $qrZahlteil = '';
    $bezahlt = (int)($b['bezahlt'] ?? 0) === 1;
    if ($b['art'] === 'rechnung' && !$bezahlt && $summen['total_rappen'] > 0
        && qr_zahlteil_moeglich($bk)
    ) {
        $debitor = $kunde ? [
            'name' => (string)($kunde['name'] ?? ''), 'strasse' => (string)($kunde['strasse'] ?? ''),
            'hausnummer' => (string)($kunde['hausnummer'] ?? ''), 'plz' => (string)($kunde['plz'] ?? ''),
            'ort' => (string)($kunde['ort'] ?? ''),
        ] : null;
        $spc  = qr_spc_payload($bk, $summen['total_rappen'] / 100, (string)$b['nummer'], $debitor);
        $teil = qr_referenzteil((string)$bk['qr_iban'], (string)$b['nummer']);

        // Die Zeile unter der IBAN heisst, was sie ist: eine Referenz oder
        // eine Mitteilung. Beides "Referenz" zu nennen waere bequem und
        // falsch -- der Empfaenger tippt sie in verschiedene Felder.
        $zusatz = $teil[0] === 'QRR'
            ? '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">Referenz</td><td>'
              . portal_esc(trim((string)preg_replace('/(.{5})/', '$1 ', $teil[1]))) . '</td></tr>'
            : '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">Mitteilung</td><td>'
              . portal_esc($teil[2]) . '</td></tr>';

        $qrZahlteil = '<div style="margin-top:32px;padding-top:20px;border-top:1px solid #E5E8EC">'
            . '<div style="font-size:15px;font-weight:700;margin-bottom:14px">Zahlung per QR-Rechnung</div>'
            . '<div style="display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start">'
            . '<div id="qrRechnungCode" data-spc="' . portal_esc($spc) . '" style="flex:0 0 auto"></div>'
            . '<table style="line-height:1.7;width:auto;font-size:12px">'
            . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">IBAN</td><td>'
            . portal_esc(iban_gruppiert((string)$bk['qr_iban'])) . '</td></tr>'
            . $zusatz
            . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">Betrag</td><td>'
            . portal_chf($summen['total_rappen']) . ' CHF</td></tr>'
            . '</table></div></div>'
            . '<script src="/qrcode.js"></script>'
            . '<script>(function(){var el=document.getElementById("qrRechnungCode");'
            . 'if(!el||typeof qrcode==="undefined"){return;}'
            . 'var q=qrcode(0,"M");q.addData(el.getAttribute("data-spc"));q.make();'
            . 'el.innerHTML=q.createSvgTag({cellSize:4,margin:8});})();</script>';
    }

    $abschnitt = function (string $label, ?string $text): string {
        if (!$text) { return ''; }
        return '<div style="margin-top:22px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;'
            . 'letter-spacing:.4px;color:#6B7280;margin-bottom:4px">' . portal_esc($label) . '</div>'
            . '<div style="white-space:pre-line;line-height:1.5">' . nl2br(portal_esc($text)) . '</div></div>';
    };

    // Reihenfolge nach Verbindlichkeit: Eine getroffene Entscheidung
    // ueberschreibt "abgelaufen" oder "angeschaut" IMMER, ein abgelaufener
    // Link ueberschreibt "versendet"/"angeschaut".
    $hinweis = '';
    $knoepfe = '';
    // Wer entschieden hat, steht dabei, sobald es festgehalten ist (ENT-688).
    $durch = ($unterschrift && $entschieden)
        ? ' von ' . portal_esc(implode(', ', array_filter([(string)$unterschrift['name'],
            (string)($unterschrift['art'] === 'annahme' ? $unterschrift['funktion'] : '')],
            static fn($t) => trim($t) !== '')))
        : '';
    if ($b['status'] === 'bestaetigt' && $entschieden) {
        $hinweis = '<div class="hinweis hinweis-an">Angenommen am ' . portal_dmy(substr((string)$b['entscheidung_am'], 0, 10)) . $durch . '.</div>';
    } elseif ($b['status'] === 'abgelehnt' && $entschieden) {
        $hinweis = '<div class="hinweis hinweis-ab">Abgelehnt am ' . portal_dmy(substr((string)$b['entscheidung_am'], 0, 10)) . $durch . '.</div>';
    } elseif ($abgelaufen) {
        $hinweis = '<div class="hinweis hinweis-versendet">Dieser Link ist abgelaufen. Bitte wenden Sie sich an den Absender.</div>';
    } elseif (beleg_unterschreibbar((string)$b['art'])) {
        $hinweis = '<div class="hinweis hinweis-versendet">Bitte prüfen Sie ' . ($b['art'] === 'vertrag' ? 'den Vertrag' : 'die Offerte')
            . ' und teilen Sie uns Ihre Entscheidung mit.</div>';
        if ($unterschriftDa) {
            // Annehmen oeffnet den Unterschriftsdialog, Ablehnen den Dialog mit
            // Name und Grund (ENT-688, Punkte 4 bis 6).
            $knoepfe = '<div class="keindruck" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">'
                . '<button type="button" class="knopf knopf-ab" onclick="uzAblehnen()">Ablehnen</button>'
                . '<button type="button" class="knopf knopf-an" onclick="uzAnnehmen()">Annehmen</button>'
                . '</div>'
                . beleg_unterschrift_dialog_html([
                    'art' => (string)$b['art'], 'nummer' => (string)$b['nummer'],
                    'fassung' => $fassung ? (int)$fassung['nummer'] : 1,
                    'firma' => (string)($kunde['name'] ?? ''),
                    'endpunkt' => 'betreiber_beleg_unterschrift.php',
                    'entscheid' => 'betreiber_beleg_entscheidung.php', 'token' => $token,
                'empfaenger' => beleg_empfaenger_email($pdo, 'be_', $b['kunde_id'] ?? null),
                ]);
        } else {
            $knoepfe = '<form method="post" action="betreiber_beleg_entscheidung.php" class="keindruck" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">'
                . '<input type="hidden" name="token" value="' . portal_esc($token) . '">'
                . '<button type="submit" name="entscheidung" value="ablehnen" class="knopf knopf-ab">Ablehnen</button>'
                . '<button type="submit" name="entscheidung" value="annehmen" class="knopf knopf-an">Annehmen</button>'
                . '</form>';
        }
    }

    // ── Der Faden in der Entscheidungskarte (ENT-677) ─────────────────
    //
    // Geschrieben werden darf, solange nicht entschieden und nicht
    // abgelaufen ist -- dieselbe Bedingung wie im Endpunkt, der die
    // Nachricht entgegennimmt. Die Wache dort ist die, die traegt; was hier
    // steht, erspart nur den Weg (CLAUDE.md).
    $schreibenOffen = $fadenDa && !$entschieden && !$abgelaufen;

    // Die Rueckmeldung nach dem Abschicken. Vier Lagen, vier Texte -- "leer"
    // und "nicht eingerichtet" sind verschiedene Aussagen und duerfen nicht
    // beide wie "nichts passiert" aussehen (Hausregel).
    $lageText = [
        'gesendet' => ['hinweis-an', 'Ihre Rückmeldung ist angekommen. Wir melden uns.'],
        'leer' => ['hinweis-versendet', 'Es war kein Text im Feld — bitte noch einmal.'],
        'name_fehlt' => ['hinweis-ab', 'Bitte geben Sie Ihren Namen an, um abzulehnen.'],
        'nicht_eingerichtet' => ['hinweis-versendet',
            'Rückmeldungen sind hier gerade nicht möglich. Bitte antworten Sie auf die E-Mail.'],
    ][(string)($_GET['lage'] ?? '')] ?? null;

    $fadenHtml = '';
    if ($fadenDa && ($nachrichten || $schreibenOffen)) {
        $liste = '';
        foreach ($nachrichten as $n) {
            $liste .= '<div class="nachricht nachricht-' . portal_esc((string)$n['seite']) . '">'
                . '<div class="wer">' . portal_esc(be_beleg_nachricht_absender($n))
                . ' · ' . portal_dmy(substr((string)$n['erstellt_am'], 0, 10)) . '</div>'
                . '<div class="was">' . nl2br(portal_esc((string)$n['text'])) . '</div>'
                . '</div>';
        }
        // Das Formular steht im Quelltext, aber zugeklappt: Ein Feld, das
        // immer offen dasteht, ruecke sich neben Annehmen und Ablehnen als
        // gleichwertiger dritter Weg. Ohne JavaScript bleibt es offen --
        // dann ist es sichtbar statt unerreichbar.
        $formular = '';
        if ($schreibenOffen) {
            $formular = '<div id="fadenForm" class="keindruck">'
                . '<form method="post" action="betreiber_beleg_nachricht_oeffentlich.php">'
                . '<input type="hidden" name="token" value="' . portal_esc($token) . '">'
                . '<input type="text" name="name" maxlength="120" placeholder="Ihr Name (freiwillig)">'
                . '<textarea name="text" maxlength="' . BE_NACHRICHT_ZEICHEN . '" required '
                . 'placeholder="Was soll geändert werden?"></textarea>'
                . '<div style="margin-top:10px"><button type="submit" class="knopf knopf-still">Absenden</button></div>'
                . '</form></div>'
                . '<button type="button" id="fadenAuf" class="knopf knopf-still keindruck" '
                . 'style="display:none;width:100%" onclick="fadenOeffnen()">Änderungen anbringen</button>'
                . '<script>(function(){var f=document.getElementById("fadenForm");'
                . 'var k=document.getElementById("fadenAuf");if(!f||!k){return;}'
                . 'f.style.display="none";k.style.display="";'
                . 'window.fadenOeffnen=function(){f.style.display="";k.style.display="none";'
                . 'var t=f.querySelector("textarea");if(t){t.focus();}};})();</script>';
        }
        $fadenHtml = '<div class="faden">'
            . ($liste !== '' ? '<div class="zf-label" style="margin-top:0">Verlauf</div>' . $liste : '')
            . $formular
            . '</div>';
    }

    // Ab der zweiten Fassung sagt die Seite, welche sie zeigt. Bei der
    // ersten waere "Fassung 1" ein Wort ohne Nutzen -- es gibt keine andere.
    $fassungZeile = ($fassung && (int)$fassung['nummer'] > 1)
        ? '<div style="font-size:12px;color:#6B7280;margin:-8px 0 14px">Fassung '
          . (int)$fassung['nummer'] . ' vom ' . portal_dmy(substr((string)$fassung['versendet_am'], 0, 10))
          . '</div>'
        : '';

    $zusammenfassung = '<div class="zf-titel">' . portal_esc($titel) . ' ' . portal_esc($b['nummer']) . '</div>'
        . $fassungZeile
        . $hinweis
        . '<div class="zf-label">Absender</div>'
        . '<div style="line-height:1.5;font-size:13px">' . portal_esc($firma !== '' ? $firma : 'Absender') . '</div>'
        // Zwei Angaben, zwei Beschriftungen -- jede mit ihrer eigenen
        // Beschriftung oben und dem Wert darunter, wie ueberall im Haus.
        // Vorher hingen beide unter einer Sammelueberschrift "Details" und
        // waren nur durch einen doppelten Zeilenumbruch getrennt.
        . '<div class="zf-label">' . portal_esc($datumLabel) . '</div>'
        . '<div style="font-size:13px">' . portal_dmy($b['datum']) . '</div>'
        . (!portal_leeres_datum($b['gueltig_bis'])
            ? '<div class="zf-label">Gültig bis</div>'
              . '<div style="font-size:13px">' . portal_dmy($b['gueltig_bis']) . '</div>'
            : '')
        . (!portal_leeres_datum($b['faellig_bis'] ?? null)
            ? '<div class="zf-label">Fällig bis</div>'
              . '<div style="font-size:13px">' . portal_dmy($b['faellig_bis']) . '</div>'
            : '')
        . '<div class="zf-label">' . portal_esc($leitLabel) . '</div>'
        . '<div style="font-size:20px;font-weight:700">' . portal_chf($leitBetrag) . ' CHF</div>'
        // Bei mehreren Perioden sagt die Seitenspalte, dass sie nicht alles
        // zeigt. Eine Zahl allein saehe sonst aus wie der ganze Preis.
        . ($mehrPerioden ? '<div style="font-size:11.5px;color:#6B7280;margin-top:2px">'
            . 'Weitere Beträge im Dokument</div>' : '')
        . $knoepfe
        . ($lageText !== null
            ? '<div class="hinweis ' . $lageText[0] . '" style="margin:20px 0 0">'
              . portal_esc($lageText[1]) . '</div>'
            : '')
        . $fadenHtml;

    // Das Logo steht links aussen und traegt 130 px Breite -- dieselbe
    // Groesse wie die Wortmarke in der E-Mail-Signatur, damit Mail und
    // Dokument die Marke gleich gross zeigen. Vorher stand es rechts und
    // war mit bis zu 200 px so gross, dass es den Brief dominierte
    // (Befund des Projektinhabers, 2026-09-22, an der Ansicht, die ein
    // Interessent bekommt).
    //
    // max-width statt width: Ein Mandantenlogo kann schmaler sein als 130
    // px; dann wird es nicht kuenstlich aufgezogen. max-height begrenzt
    // zusaetzlich ein hochformatiges Zeichen.
    $logoHtml = $logoDatenUrl
        ? '<img src="' . portal_esc($logoDatenUrl) . '" alt="" style="max-width:130px;max-height:60px;'
          . 'display:block;margin-bottom:14px">'
        : '';

    // Unterschriftsblock, gleiche Feldnamen und gleicher Aufbau wie im
    // internen Ausdruck (ENT-425): im normalen Fluss am Ende des Blattes,
    // nicht auf einer erzwungenen zweiten Seite. Wer hier etwas aendert,
    // aendert es auch in ofBlatt() in betreiber.html.
    $unterschriftsseite = '';
    if (!empty($b['unterschriftsseite'])) {
        $auftraggeber  = trim((string)($kunde['name'] ?? '')) ?: 'Auftraggeber';
        $auftragnehmer = $firma !== '' ? $firma : 'Auftragnehmer';
        // Nach einer Annahme am Link stehen die Linien nicht leer (ENT-688):
        // beim Empfaenger die gezeichnete Unterschrift oder sein getippter
        // Name, beim Absender der Name aus der Freigabe beim Versenden.
        $linien = beleg_unterschrift_linien($unterschrift, $fassung, $entschieden && $b['status'] === 'bestaetigt');
        $unterschriftsseite = '<div style="margin-top:34px;page-break-inside:avoid;break-inside:avoid">'
            . '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6B7280;margin-bottom:18px">Unterschriften</div>'
            . '<div style="color:#6B7280;margin-bottom:' . ($linien['ort'] !== '' ? '6' : '34') . 'px;font-size:12px">Ort, Datum</div>'
            . ($linien['ort'] !== '' ? '<div style="font-size:12px;margin-bottom:6px">' . $linien['ort'] . '</div>' : '')
            . '<div style="border-bottom:1px solid #14161A;width:260px;margin-bottom:40px"></div>'
            . '<div style="display:flex;gap:60px">'
            . '<div style="flex:1">'
            . '<div style="border-bottom:1px solid #14161A;height:70px;display:flex;align-items:flex-end">' . $linien['kunde'] . '</div>'
            . '<div style="margin-top:' . (int)($linien['abstand'] ?? 16) . 'px;font-size:11px;color:#6B7280">Unterschrift ' . portal_esc($auftraggeber) . '</div>'
            . '</div>'
            . '<div style="flex:1">'
            . '<div style="border-bottom:1px solid #14161A;height:70px;display:flex;align-items:flex-end">' . $linien['absender'] . '</div>'
            . '<div style="margin-top:' . (int)($linien['abstand'] ?? 16) . 'px;font-size:11px;color:#6B7280">Unterschrift ' . portal_esc($auftragnehmer) . '</div>'
            . '</div>'
            . '</div>'
            . '</div>';
    }

    // Das Pruefprotokoll (ENT-688, Punkt 8) -- nur nach einer Annahme mit
    // Code, und nur wenn die Fassung dazu passt.
    $protokoll = ($unterschrift && $unterschrift['art'] === 'annahme' && $fassung
                  && $b['status'] === 'bestaetigt' && $entschieden)
        ? beleg_pruefprotokoll_html(beleg_pruefprotokoll_zeilen($b, $fassung, $unterschrift))
        : '';

    $spalte = 'padding:2px 24px 2px 0;color:#6B7280;font-size:12px';

    // Die Laufzeitzeilen fuer den Dokumentkopf. Nur beim Vertrag, und nur
    // die Felder, die tatsaechlich gefuellt sind.
    $laufzeitZeilen = '';
    if ($b['art'] === 'vertrag') {
        $monate = static fn(?int $n): string => $n === 1 ? '1 Monat' : $n . ' Monate';
        $kopfzeile = static fn(string $l, string $w): string =>
            '<tr><td style="' . $spalte . '">' . portal_esc($l) . '</td>'
            . '<td style="padding:2px 0;font-size:12px">' . portal_esc($w) . '</td></tr>';
        if (!portal_leeres_datum($b['vertrag_beginn'] ?? null)) {
            $laufzeitZeilen .= $kopfzeile('Beginn', portal_dmy($b['vertrag_beginn']));
        }
        if (($b['mindestlaufzeit_monate'] ?? null) !== null) {
            $laufzeitZeilen .= $kopfzeile('Mindestlaufzeit', $monate((int)$b['mindestlaufzeit_monate']));
        }
        if (($b['kuendigungsfrist_monate'] ?? null) !== null) {
            $laufzeitZeilen .= $kopfzeile('Kündigungsfrist', $monate((int)$b['kuendigungsfrist_monate']));
        }
        // Eine Verlaengerung von 0 ist eine Abmachung und kein leeres Feld:
        // Der Vertrag endet dann und verlaengert sich NICHT. Das gehoert
        // ausgeschrieben, sonst liest es sich wie nicht geregelt.
        if (($b['verlaengerung_monate'] ?? null) !== null) {
            $laufzeitZeilen .= $kopfzeile('Verlängerung',
                (int)$b['verlaengerung_monate'] === 0
                    ? 'keine automatische Verlängerung'
                    : 'um jeweils ' . $monate((int)$b['verlaengerung_monate']));
        }
    }

    $dokument = '<div class="keindruck" style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:24px">'
        . '<button type="button" class="knopf knopf-plain" onclick="window.print()">Drucken</button>'
        // Nach einer Annahme laedt "Herunterladen" das GESPEICHERTE,
        // unterschriebene PDF (ENT-688, Schritt 3) -- nicht eine Kopie aus dem
        // Browser, die vom angenommenen Dokument abweichen koennte.
        . (($unterschrift && $unterschrift['art'] === 'annahme' && !empty($unterschrift['pdf_da']) && $entschieden)
            ? '<a class="knopf knopf-plain" id="btnHerunterladen" style="line-height:20px" href="betreiber_beleg_pdf.php?token='
              . portal_esc(rawurlencode($token)) . '">Herunterladen</a>'
            : '<button type="button" class="knopf knopf-plain" id="btnHerunterladen" onclick="portalHerunterladen()">Herunterladen</button>')
        . '</div>'
        . '<div id="dokumentGanz">'
        // Die Mindesthoehe gilt nur noch im DRUCK (siehe @media print):
        // Am Bildschirm riss sie bei einem kurzen Beleg eine Luecke
        // zwischen Inhalt und Fusszeile auf, die wie ein Fehler aussah.
        . '<div id="dokumentSeite" style="display:flex;flex-direction:column">'
        // Logo und Absender stehen untereinander, links aussen.
        . '<div style="margin-bottom:36px">'
        . $logoHtml
        . '<div style="line-height:1.45;font-size:12px">' . implode('<br>', array_map('portal_esc', $absenderZeilen)) . '</div>'
        . '</div>'
        . '<div style="display:flex;justify-content:space-between;gap:40px;margin-bottom:40px;flex-wrap:wrap">'
        . '<table style="line-height:1.5;width:auto"><tr><td style="' . $spalte . '">' . portal_esc($titel) . 'nummer</td><td style="padding:2px 0;font-size:12px">' . portal_esc($b['nummer']) . '</td></tr>'
        . '<tr><td style="' . $spalte . '">Datum</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['datum']) . '</td></tr>'
        . (!portal_leeres_datum($b['gueltig_bis']) ? '<tr><td style="' . $spalte . '">Gültig bis</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['gueltig_bis']) . '</td></tr>' : '')
        // Die Frist einer Rechnung. Sie stand auf dem Blatt der Mandantin
        // schon, auf diesem nicht -- ein Beleg, der eine Zahlung verlangt
        // und nicht sagt bis wann, ist keine Rechnung.
        . (!portal_leeres_datum($b['faellig_bis'] ?? null) ? '<tr><td style="' . $spalte . '">Fällig bis</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['faellig_bis']) . '</td></tr>' : '')
        // Die Laufzeit eines Vertrags (ENT-637). Sie gehoert auf das Blatt,
        // das unterschrieben wird -- wer zustimmt, muss dort lesen koennen,
        // worauf er sich einlaesst. Was leer blieb, steht gar nicht da:
        // Eine Zeile "Mindestlaufzeit --" saehe aus wie "keine", und das ist
        // etwas anderes als "nicht vereinbart".
        . $laufzeitZeilen
        . '</table>'
        // Der Block steht rechts (Schweizer Anordnung, Fensterkuvert), sein
        // TEXT aber linksbuendig: Eine Anschrift im rechten Flattersatz
        // bricht an jeder Zeile anders und liest sich unruhig.
        . '<div style="line-height:1.5;font-size:12px;min-width:200px;margin-left:auto">' . implode('<br>', array_map('portal_esc', $empfaenger)) . '</div>'
        . '</div>'
        // OHNE die Nummer: Sie steht drei Zeilen darueber in der
        // Kopftabelle. Traegt der Beleg keinen eigenen Titel, bleibt die
        // Art stehen ("Offerte") -- das ist eine Ueberschrift, keine
        // Wiederholung.
        . '<div style="font-size:19px;font-weight:700;margin-bottom:14px">' . portal_esc($b['titel'] ?: $titel) . '</div>'
        // Die Positionstabelle in einem eigenen Rahmen, der am Handy seitlich
        // rollt, statt die ganze Seite breiter zu machen als den Bildschirm
        // (Befund vom 2026-09-23: 414 px auf 390 px). Beim Drucken gilt der
        // Rahmen nicht (@media print).
        . '<div class="pos-rahmen"><table><thead><tr>'
        . '<th style="padding:7px 8px;text-align:left;font-size:11px;font-weight:700;background:#EDEFF2">Leistung</th>'
        . '<th style="padding:7px 8px;text-align:left;font-size:11px;font-weight:700;background:#EDEFF2">Beschreibung</th>'
        . '<th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;background:#EDEFF2">Einzelpreis</th>'
        . '<th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;background:#EDEFF2">Menge</th>'
        . '<th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;background:#EDEFF2">Summe</th>'
        . '</tr></thead><tbody>' . $zeilen . '</tbody></table></div>'
        . '<table style="margin-left:auto;margin-top:14px;width:auto">' . $summenHtml . '</table>'
        . $qrZahlteil
        . $abschnitt('Notizen', $b['oeffentliche_notizen'])
        . $abschnitt('Bedingungen', $b['bedingungen'])
        . $unterschriftsseite
        . $protokoll
        . '<div style="margin-top:auto;padding-top:14px">'
        . ($b['fusszeile_text'] ? '<div style="border-top:1px solid #E5E8EC;padding-top:14px;white-space:pre-line;line-height:1.5;font-size:12px">' . nl2br(portal_esc($b['fusszeile_text'])) . '</div>' : '')
        . $betriebFusszeile
        . '</div>'
        . '</div>'
        . '</div>';

    // Herunterladen laedt html2pdf.js erst BEIM KLICK nach -- wer nie
    // herunterlaedt, zahlt das Gewicht nicht beim blossen Ansehen.
    $dateiname = preg_replace('/[^A-Za-z0-9 _.-]/', '', $titel . ' ' . $b['nummer']) . '.pdf';
    $dokument .= '<script>function portalHerunterladen(){'
        . 'var btn=document.getElementById("btnHerunterladen");var alt=btn.textContent;'
        . 'function starten(){btn.textContent=alt;'
        . 'html2pdf().set({filename:' . json_encode($dateiname, JSON_UNESCAPED_UNICODE) . ',margin:10,'
        . 'html2canvas:{scale:2},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}})'
        . '.from(document.getElementById("dokumentGanz")).save();}'
        . 'if(typeof html2pdf!=="undefined"){starten();return;}'
        . 'btn.textContent="Lädt …";var s=document.createElement("script");'
        . 's.src="/html2pdf.bundle.min.js";s.onload=starten;'
        . 's.onerror=function(){btn.textContent=alt;alert("Herunterladen ist gerade nicht möglich.");};'
        . 'document.head.appendChild(s);}</script>';

    $inhalt = '<div class="zusammenfassung">' . $zusammenfassung . '</div>'
        . '<div class="karte">' . $dokument . '</div>';

    portal_seite($titel . ' ' . $b['nummer'], $inhalt);
} catch (Throwable $e) {
    portal_fehler('Fehler', 'Diese Seite lässt sich gerade nicht anzeigen. Bitte versuchen Sie es später erneut.', 500);
}
