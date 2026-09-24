<?php
// Unangemeldete Kundenansicht einer Offerte (ENT-192).
//
// Bewusst OHNE require_session(): Der Kunde hat kein Konto. Der 256-Bit-Token
// in der URL ersetzt die Anmeldung -- nicht durch ein Login-Formular, sondern
// dadurch, dass er praktisch nicht zu erraten ist (siehe versand_token in
// planung_einrichten.php).
//
// Zwei Wege zu einer Datei (ENT-206): "Drucken" nutzt weiterhin nur den
// Browser-Druckdialog (kein neues Gewicht). "Herunterladen" laedt bei Klick
// -- nicht beim Seitenaufbau -- die vendorte Bibliothek html2pdf.js
// (Kazuhiko Arase... nein: eKoopmans/html2pdf.js, MIT) nach und rastert
// GENAU das bereits gerenderte Dokument-Element in eine PDF-Datei. Damit
// gibt es nur EINE Layout-Wahrheit (dieses HTML/CSS) statt einer zweiten,
// separat gepflegten PDF-Vorlage, die sich vom Bildschirm entkoppeln koennte.
//
// Liefert IMMER HTML, nie JSON -- auch im Fehlerfall. db.php's globaler
// Exception-Handler wuerde sonst rohes JSON an einen Kunden ausliefern, der
// nie eine API-Antwort erwartet. Darum faengt diese Datei ihre eigenen
// Fehler ab, statt sie durchzureichen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require __DIR__ . '/../belege.php';
require __DIR__ . '/../qrrechnung.php';

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

// Kleine, in sich geschlossene HTML-Seite -- fuer Fehlermeldungen wie fuer den
// eigentlichen Inhalt, damit beide dieselbe Kopfzeile tragen (Titel, Zeichensatz,
// Grundschrift) und nicht an zwei Stellen gepflegt werden muessen.
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
            @media print{body{background:#fff;padding:0}.buehne{display:block}
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

    $pdo = db();
    $s = $pdo->prepare('SELECT * FROM belege WHERE versand_token = ?');
    $s->execute([$token]);
    $b = $s->fetch();
    if (!$b) {
        portal_fehler('Link ungültig', 'Dieser Link ist nicht (mehr) gültig. '
            . 'Bitte wenden Sie sich an den Absender.');
    }

    // WAS DER KUNDE SIEHT, IST DIE LETZTE VERSENDETE FASSUNG (ENT-688) --
    // Begruendung in belege.php und betreiber_beleg_oeffentlich.php. Ohne
    // Fassung (versendet vor ENT-688, oder vor dem Einrichtungslauf) zeigt
    // die Seite den Beleg wie bisher.
    $fassung = beleg_letzte_fassung($pdo, (int)$b['id']);
    if ($fassung && !$fassung['echt']) {
        portal_fehler('Dokument nicht verfügbar', 'Dieses Dokument lässt sich gerade nicht '
            . 'anzeigen. Bitte wenden Sie sich an den Absender.', 500);
    }
    $abbild = $fassung
        ? $fassung['abbild']
        : beleg_abbild_lesen($pdo, (int)$b['id'], '', beleg_absender_betrieb($pdo));
    $kunde   = $abbild['kunde'] ?? null;
    $person  = $abbild['person'] ?? null;
    $betrieb = (array)($abbild['absender'] ?? []);
    $b       = array_merge($b, (array)($abbild['beleg'] ?? []));
    $firma = trim((string)($betrieb['firma'] ?? ''));
    // Dieselbe Quelle und dasselbe Bild wie im internen Ausdruck (ofBlatt()
    // in dashboard.html, ENT-192) -- ein Kunde, der dieselbe Rechnung einmal
    // von innen und einmal ueber den Portal-Link sieht, soll nicht zwei
    // verschiedene Kopfzeilen bekommen (ENT-206).
    $absenderZeilen = array_values(array_filter(array_map('trim',
        explode("\n", (string)($betrieb['fusszeile'] ?? '')))));
    // Im Abbild steht das Logo schon als data:-URL (beleg_absender_betrieb()).
    $logoDatenUrl = !empty($betrieb['logo']) ? (string)$betrieb['logo'] : null;
    // Betriebs-Fusszeile am unteren Blattrand (Adresse/Bankverbindung/UID) --
    // dasselbe Muster wie bkFusszeile() in dashboard.html: zwei Bloecke
    // nebeneinander, nur wenn wenigstens einer gefuellt ist (ENT-206). Das
    // ist NICHT dasselbe Feld wie b.fusszeile_text (die freie Fusszeile
    // dieses einen Belegs) -- beide koennen nebeneinander bestehen.
    // white-space:pre-line rendert einen rohen Zeilenumbruch bereits selbst
    // -- KEIN zusaetzliches nl2br() hier, sonst kommt (br-Element + der noch
    // vorhandene rohe Umbruch danach) zu zwei sichtbaren Umbruechen je Zeile.
    // Genau das Muster aus bkFusszeile() in dashboard.html.
    $betriebFusszeile = '';
    if ($betrieb['fusszeile'] || $betrieb['fusszeile2']) {
        $betriebFusszeile = '<div style="margin-top:30px;padding-top:10px;border-top:1px solid #E5E8EC;'
            . 'display:flex;align-items:center;justify-content:space-between;gap:32px;'
            . 'font-size:10.5px;color:#6B7280;line-height:1.5">'
            . ($betrieb['fusszeile'] ? '<div style="white-space:pre-line">' . portal_esc($betrieb['fusszeile']) . '</div>' : '')
            . ($betrieb['fusszeile2'] ? '<div style="white-space:pre-line">' . portal_esc($betrieb['fusszeile2']) . '</div>' : '')
            . '</div>';
    }

    // Gerechnet gespeichert, hier nicht neu gerechnet (ENT-688).
    $summen = (array)$abbild['summen'];

    $entschieden = !empty($b['entscheidung_am']);
    $heute = date('Y-m-d');
    $abgelaufen = !$entschieden && !empty($b['gueltig_bis']) && !portal_leeres_datum($b['gueltig_bis'])
        && substr((string)$b['gueltig_bis'], 0, 10) < $heute;

    // Rechnungen haben kein Gueltig-bis/Annehmen-Ablehnen, dafuer Bezahlt und
    // ein Faellig-bis, dessen Ueberschreiten dem Kunden ebenso deutlich
    // angezeigt wird wie ein abgelaufener Offerten-Link (Projektinhaber-
    // Entscheidung 2026-08-28).
    $bezahlt = $b['art'] === 'rechnung' && !empty($b['bezahlt']);
    $ueberfaellig = $b['art'] === 'rechnung' && !$bezahlt
        && !empty($b['faellig_bis']) && !portal_leeres_datum($b['faellig_bis'])
        && substr((string)$b['faellig_bis'], 0, 10) < $heute;

    // 'angeschaut' ist ohne Kundenportal von Hand gesetzt worden (siehe
    // belege.php) -- jetzt WEISS das System es, wenn diese Seite zum ersten
    // Mal aufgerufen wird. Eine bereits getroffene Entscheidung oder ein
    // abgelaufener Link wird dadurch nicht ueberschrieben.
    if (!$entschieden && !$abgelaufen && $b['status'] === 'versendet') {
        $pdo->prepare("UPDATE belege SET status = 'angeschaut' WHERE id = ?")->execute([(int)$b['id']]);
        $b['status'] = 'angeschaut';
    }

    // Die Unterschrift am Link (ENT-688, Schritt 2). Fehlt die Tabelle, bleibt
    // es beim bisherigen Annehmen per Klick -- bis zum Einrichtungslauf.
    $unterschriftDa = beleg_unterschrift_tabelle_da($pdo);
    $unterschrift   = beleg_unterschrift_letzte($pdo, '', (int)$b['id']);

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
        $zeilen .= '<tr>'
            . '<td style="padding:9px 8px;border-bottom:1px solid #E5E8EC;font-size:12px">' . portal_esc($p['produkt_name']) . '</td>'
            . '<td style="padding:9px 8px;border-bottom:1px solid #E5E8EC;font-size:12px;white-space:pre-line">' . portal_esc($p['beschreibung']) . '</td>'
            . '<td style="padding:9px 8px;border-bottom:1px solid #E5E8EC;font-size:12px;text-align:right;white-space:nowrap">' . portal_chf((int)$p['einzelpreis_rappen']) . '</td>'
            . '<td style="padding:9px 8px;border-bottom:1px solid #E5E8EC;font-size:12px;text-align:right;white-space:nowrap">' . portal_nf($mengeD, floor($mengeD) === $mengeD ? 0 : 2) . ' ' . portal_esc($p['einheit']) . '</td>'
            . '<td style="padding:9px 8px;border-bottom:1px solid #E5E8EC;font-size:12px;text-align:right;white-space:nowrap">' . portal_chf((int)$z['zwischen_rappen']) . ' CHF</td>'
            . '</tr>';
    }

    $sz = function (string $label, string $wert, bool $stark = false): string {
        $fs = $stark ? '13px' : '12px';
        $fw = $stark ? ';font-weight:700' : '';
        return '<tr><td style="padding:4px 8px;text-align:right;font-size:12px' . $fw . '">' . $label . '</td>'
            . '<td style="padding:4px 8px;text-align:right;font-size:' . $fs . ';white-space:nowrap' . $fw . '">' . $wert . '</td></tr>';
    };
    $summenHtml = $sz('Zwischensumme', portal_chf($summen['zwischensumme_rappen']) . ' CHF');
    if ($summen['rabatt_rappen'] > 0) {
        $summenHtml .= $sz(portal_bp($summen['rabatt_bp']) . '% Rabatt', '-' . portal_chf($summen['rabatt_rappen']) . ' CHF');
    }
    foreach ($summen['mwst'] as $m) {
        $summenHtml .= $sz(portal_chf($m['grundlage_rappen']) . ' CHF ' . portal_bp($m['satz_bp']) . '% MWST',
            portal_chf($m['betrag_rappen']) . ' CHF');
    }
    if ($summen['rundung_rappen'] !== 0) {
        $summenHtml .= $sz('Rundungsdifferenz',
            ($summen['rundung_rappen'] > 0 ? '' : '-') . portal_chf(abs($summen['rundung_rappen'])) . ' CHF');
    }
    $summenHtml .= $sz('Total', portal_chf($summen['total_rappen']) . ' CHF', true);

    $abschnitt = function (string $label, ?string $text): string {
        if (!$text) { return ''; }
        return '<div style="margin-top:22px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;'
            . 'letter-spacing:.4px;color:#6B7280;margin-bottom:4px">' . portal_esc($label) . '</div>'
            . '<div style="white-space:pre-line;line-height:1.5">' . nl2br(portal_esc($text)) . '</div></div>';
    };

    // Hinweisleiste: Reihenfolge nach Verbindlichkeit -- eine getroffene
    // Entscheidung ueberschreibt die Anzeige "abgelaufen" oder "angeschaut"
    // IMMER, ein abgelaufener Link ueberschreibt "versendet"/"angeschaut".
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
    } elseif ($bezahlt) {
        $hinweis = '<div class="hinweis hinweis-an">Bezahlt am ' . portal_dmy($b['bezahlt_am']) . '.</div>';
    } elseif ($abgelaufen) {
        $hinweis = '<div class="hinweis hinweis-versendet">Dieser Link ist abgelaufen. Bitte wenden Sie sich an den Absender.</div>';
    } elseif ($ueberfaellig) {
        $hinweis = '<div class="hinweis hinweis-ab">Diese Rechnung ist seit dem ' . portal_dmy($b['faellig_bis']) . ' überfällig.</div>';
    } elseif ($b['art'] === 'offerte' && $unterschriftDa) {
        // Annehmen oeffnet den Unterschriftsdialog, Ablehnen den Dialog mit
        // Name und Grund (ENT-688, Punkte 4 bis 6).
        $hinweis = '<div class="hinweis hinweis-versendet">Bitte prüfen Sie die Offerte und teilen Sie uns Ihre Entscheidung mit.</div>';
        $knoepfe = '<div class="keindruck" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">'
            . '<button type="button" class="knopf knopf-ab" onclick="uzAblehnen()">Ablehnen</button>'
            . '<button type="button" class="knopf knopf-an" onclick="uzAnnehmen()">Annehmen</button>'
            . '</div>'
            . beleg_unterschrift_dialog_html([
                'art' => 'offerte', 'nummer' => (string)$b['nummer'],
                'fassung' => $fassung ? (int)$fassung['nummer'] : 1,
                'firma' => (string)($kunde['name'] ?? ''),
                'endpunkt' => 'beleg_unterschrift.php',
                'entscheid' => 'beleg_entscheidung.php', 'token' => $token,
                'empfaenger' => beleg_empfaenger_email($pdo, '', $b['kunde_id'] ?? null),
            ])
            . (($_GET['lage'] ?? '') === 'name_fehlt'
                ? '<div class="hinweis hinweis-ab" style="margin:20px 0 0">Bitte geben Sie Ihren Namen an, um abzulehnen.</div>'
                : '');
    } elseif ($b['art'] === 'offerte') {
        $hinweis = '<div class="hinweis hinweis-versendet">Bitte prüfen Sie die Offerte und teilen Sie uns Ihre Entscheidung mit.</div>';
        $knoepfe = '<form method="post" action="beleg_entscheidung.php" class="keindruck" style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">'
            . '<input type="hidden" name="token" value="' . portal_esc($token) . '">'
            . '<button type="submit" name="entscheidung" value="ablehnen" class="knopf knopf-ab">Ablehnen</button>'
            . '<button type="submit" name="entscheidung" value="annehmen" class="knopf knopf-an">Annehmen</button>'
            . '</form>';
    }

    // QR-Zahlteil (ENT-205): nur bei einer offenen, unbezahlten Rechnung MIT
    // gueltig hinterlegter QR-IBAN -- solange die Bank noch keine zugewiesen
    // hat oder die Absenderadresse unvollstaendig ist, bleibt dieser Block
    // schlicht weg (kein kaputter/nicht scannbarer Code, siehe ENT-205).
    // NICHT "keindruck": das ist genau der Teil, der auf dem Papier landen
    // soll, wenn der Kunde die Seite ausdruckt.
    $qrZahlteil = '';
    if ($b['art'] === 'rechnung' && !$bezahlt && $summen['total_rappen'] > 0
        && !empty($betrieb['qr_iban']) && iban_ist_qr((string)$betrieb['qr_iban'])
        && !empty($betrieb['qr_strasse']) && !empty($betrieb['qr_plz']) && !empty($betrieb['qr_ort'])
    ) {
        $referenz = qrr_referenz((string)$b['nummer']);
        $referenzGruppiert = trim((string)preg_replace('/(.{5})/', '$1 ', $referenz));
        $debitor = $kunde ? [
            'name' => (string)($kunde['name'] ?? ''), 'strasse' => (string)($kunde['strasse'] ?? ''),
            'hausnummer' => (string)($kunde['hausnummer'] ?? ''), 'plz' => (string)($kunde['plz'] ?? ''),
            'ort' => (string)($kunde['ort'] ?? ''),
        ] : null;
        $spc = qr_spc_payload($betrieb, $summen['total_rappen'] / 100, (string)$b['nummer'], $debitor);
        $qrZahlteil = '<div style="margin-top:32px;padding-top:20px;border-top:1px solid #E5E8EC">'
            . '<div style="font-size:15px;font-weight:700;margin-bottom:14px">Zahlung per QR-Rechnung</div>'
            . '<div style="display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start">'
            . '<div id="qrRechnungCode" data-spc="' . portal_esc($spc) . '" style="flex:0 0 auto"></div>'
            . '<table style="line-height:1.7;width:auto;font-size:12px">'
            . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">IBAN</td><td>' . portal_esc(iban_gruppiert((string)$betrieb['qr_iban'])) . '</td></tr>'
            . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">Referenz</td><td>' . portal_esc($referenzGruppiert) . '</td></tr>'
            . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280">Betrag</td><td>' . portal_chf($summen['total_rappen']) . ' CHF</td></tr>'
            . '</table></div></div>'
            . '<script src="/qrcode.js"></script>'
            . '<script>(function(){var el=document.getElementById("qrRechnungCode");'
            . 'if(!el||typeof qrcode==="undefined"){return;}'
            . 'var q=qrcode(0,"M");q.addData(el.getAttribute("data-spc"));q.make();'
            . 'el.innerHTML=q.createSvgTag({cellSize:4,margin:8});})();</script>';
    }

    // Links eine kompakte Zusammenfassung (Absender, Details, Total) neben
    // dem eigentlichen Dokument rechts -- Vorbild eines vom Projektinhaber
    // gezeigten Fremdsystems, nicht 1:1 nachgebaut, aber demselben Aufbau
    // folgend (ENT-206). Wichtig: JEDES Detail, das rechtsverbindlich zum
    // Dokument gehoert (Datum, Adresse, Positionen, Summen), bleibt
    // vollstaendig im rechten "Dokument"-Bereich -- links stehen dieselben
    // Kernangaben nur ZUSAETZLICH, zum schnellen Ueberblick.
    // Ab der zweiten Fassung sagt die Seite, welche sie zeigt (ENT-688).
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
        . '<div class="zf-label">Details</div>'
        . '<div style="line-height:1.7;font-size:13px">'
        . portal_esc($datumLabel) . '<br><span style="color:#6B7280">' . portal_dmy($b['datum']) . '</span>'
        . (!portal_leeres_datum($b['gueltig_bis']) ? '<br><br>Gültig bis<br><span style="color:#6B7280">' . portal_dmy($b['gueltig_bis']) . '</span>' : '')
        . (!portal_leeres_datum($b['faellig_bis'] ?? null) ? '<br><br>Fällig bis<br><span style="color:#6B7280">' . portal_dmy($b['faellig_bis']) . '</span>' : '')
        . '</div>'
        . '<div class="zf-label">' . ($bezahlt ? 'Bezahlt' : ($b['art'] === 'rechnung' ? 'Offener Betrag' : 'Total')) . '</div>'
        . '<div style="font-size:20px;font-weight:700">' . portal_chf($bezahlt ? 0 : $summen['total_rappen']) . ' CHF</div>'
        . $knoepfe;

    // Immer eine ganze Seite, kein Ausschnitt: die Buehne bekommt eine
    // A4-aehnliche Mindesthoehe und ordnet ihren Inhalt in einer Spalte an,
    // damit die Fusszeile am UNTEREN Rand steht -- auch wenn ein Beleg nur
    // eine einzige, kurze Position hat (Projektinhaber-Vorgabe, ENT-206).
    $logoHtml = $logoDatenUrl
        ? '<img src="' . portal_esc($logoDatenUrl) . '" alt="" style="max-height:96px;max-width:200px;display:block;margin-left:auto">'
        : '';

    // Unterschriftsblock (ENT-187 intern, ENT-207 hier nachgezogen): der
    // Haken "Unterschriftsseite hinzufügen" im Formular (of_unterschriftsseite)
    // wurde bisher nur im internen Ausdruck (ofBlatt() in dashboard.html)
    // beruecksichtigt -- auf der oeffentlichen Kundenseite, ueber die der
    // Kunde die Datei tatsaechlich druckt/herunterlaedt, hatte er GAR KEINE
    // Wirkung. Gleiche Feldnamen/Aufbau wie im internen Ausdruck, damit ein
    // Beleg von innen und ueber den Portal-Link denselben Block zeigt --
    // seit ENT-425 einschliesslich der Platzierung: im normalen Fluss am
    // Ende des Blattes, nicht mehr auf einer erzwungenen zweiten Seite.
    // Wer hier etwas aendert, aendert es auch in ofBlatt().
    $unterschriftsseite = '';
    if (!empty($b['unterschriftsseite'])) {
        $auftraggeber = trim((string)($kunde['name'] ?? ''));
        $auftraggeber = $auftraggeber !== '' ? $auftraggeber : 'Auftraggeber';
        $auftragnehmer = $firma !== '' ? $firma : 'Auftragnehmer';
        // Nach einer Annahme am Link stehen die Linien nicht leer (ENT-688).
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

    // Das Pruefprotokoll (ENT-688, Punkt 8) -- nur nach einer Annahme mit Code.
    $protokoll = ($unterschrift && $unterschrift['art'] === 'annahme' && $fassung
                  && $b['status'] === 'bestaetigt' && $entschieden)
        ? beleg_pruefprotokoll_html(beleg_pruefprotokoll_zeilen($b, $fassung, $unterschrift))
        : '';

    $dokument = '<div class="keindruck" style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:24px">'
        . '<button type="button" class="knopf knopf-plain" onclick="window.print()">Drucken</button>'
        // Nach einer Annahme laedt "Herunterladen" das GESPEICHERTE,
        // unterschriebene PDF (ENT-688, Schritt 3) -- nicht eine Kopie aus dem
        // Browser, die vom angenommenen Dokument abweichen koennte.
        . (($unterschrift && $unterschrift['art'] === 'annahme' && !empty($unterschrift['pdf_da']) && $entschieden)
            ? '<a class="knopf knopf-plain" id="btnHerunterladen" style="line-height:20px" href="beleg_pdf.php?token='
              . portal_esc(rawurlencode($token)) . '">Herunterladen</a>'
            : '<button type="button" class="knopf knopf-plain" id="btnHerunterladen" onclick="portalHerunterladen()">Herunterladen</button>')
        . '</div>'
        . '<div id="dokumentGanz">'
        . '<div id="dokumentSeite" style="display:flex;flex-direction:column;min-height:960px">'
        . '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:40px">'
        . '<div style="line-height:1.45;font-size:12px">' . implode('<br>', array_map('portal_esc', $absenderZeilen)) . '</div>'
        . '<div>' . $logoHtml . '</div>'
        . '</div>'
        . '<div style="display:flex;justify-content:space-between;gap:40px;margin-bottom:40px;flex-wrap:wrap">'
        . '<table style="line-height:1.5;width:auto"><tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">' . portal_esc($titel) . 'nummer</td><td style="padding:2px 0;font-size:12px">' . portal_esc($b['nummer']) . '</td></tr>'
        . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">Datum</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['datum']) . '</td></tr>'
        . (!portal_leeres_datum($b['gueltig_bis']) ? '<tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">Gültig bis</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['gueltig_bis']) . '</td></tr>' : '')
        . (!portal_leeres_datum($b['faellig_bis'] ?? null) ? '<tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">Fällig bis</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['faellig_bis']) . '</td></tr>' : '')
        . '</table>'
        . '<div style="line-height:1.5;font-size:12px;min-width:200px;text-align:right;margin-left:auto">' . implode('<br>', array_map('portal_esc', $empfaenger)) . '</div>'
        . '</div>'
        . '<div style="font-size:19px;font-weight:700;margin-bottom:14px">' . portal_esc($b['titel'] ?: $titel) . ' ' . portal_esc($b['nummer']) . '</div>'
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
        // margin-top:auto auf dem LETZTEN Flex-Kind schiebt es an den
        // unteren Rand der Seite, egal wie wenig Inhalt darueber steht --
        // auch wenn die Beleg-Fusszeile selbst leer ist, bleibt so die
        // Mindesthoehe der Seite gewahrt.
        . '<div style="margin-top:auto;padding-top:14px">'
        . ($b['fusszeile_text'] ? '<div style="border-top:1px solid #E5E8EC;padding-top:14px;white-space:pre-line;line-height:1.5;font-size:12px">' . nl2br(portal_esc($b['fusszeile_text'])) . '</div>' : '')
        . $betriebFusszeile
        . '</div>'
        . '</div>'
        . '</div>';

    // Herunterladen laedt html2pdf.js erst BEIM KLICK nach (946 KB, fast
    // eine ganze QR-Bibliothek schwerer) -- wer nie herunterlaedt, zahlt das
    // Gewicht nicht beim blossen Ansehen der Seite.
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
