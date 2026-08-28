<?php
// Unangemeldete Kundenansicht einer Offerte (ENT-192).
//
// Bewusst OHNE require_session(): Der Kunde hat kein Konto. Der 256-Bit-Token
// in der URL ersetzt die Anmeldung -- nicht durch ein Login-Formular, sondern
// dadurch, dass er praktisch nicht zu erraten ist (siehe versand_token in
// planung_einrichten.php).
//
// Web-Ansicht statt PDF: Dieses Projekt bindet keine PDF-Bibliothek ein (kein
// Composer im Deploy, siehe backend/mailer.php). Der Kunde druckt sich die
// Seite ueber die Browser-Funktion "Drucken -> Als PDF speichern" selbst,
// falls er eine Datei braucht.
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
            .karte{max-width:700px;margin:0 auto;background:#fff;border-radius:12px;
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
            @media print{body{background:#fff;padding:0}.karte{box-shadow:none;padding:0}
                         .keindruck{display:none}}
          </style></head><body><div class="karte">' . $inhalt . '</div></body></html>';
    exit;
}

function portal_fehler(string $titel, string $text, int $code = 404): void
{
    http_response_code($code);
    portal_seite($titel, '<h1 style="font-size:18px">' . portal_esc($titel) . '</h1><p>' . portal_esc($text) . '</p>');
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

    $kunde = null;
    if ($b['kunde_id']) {
        $s = $pdo->prepare(
            'SELECT name, zusatzfeld, strasse, hausnummer, adresszusatz, plz, ort
               FROM kunden WHERE id = ?'
        );
        $s->execute([(int)$b['kunde_id']]);
        $kunde = $s->fetch() ?: null;
    }
    $person = null;
    if ($b['person_id']) {
        $s = $pdo->prepare('SELECT anrede, vorname, nachname FROM kunden_person WHERE id = ?');
        $s->execute([(int)$b['person_id']]);
        $person = $s->fetch() ?: null;
    }
    $betrieb = $pdo->query(
        'SELECT firma, qr_iban, qr_strasse, qr_hausnummer, qr_plz, qr_ort FROM betrieb WHERE id = 1'
    )->fetch();
    $firma = trim((string)($betrieb['firma'] ?? ''));

    $b['positionen'] = beleg_positionen_lesen($pdo, (int)$b['id']);
    $summen = beleg_summen($b['positionen'], (int)$b['rabatt_bp']);

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

    $titel = BELEG_ARTEN[$b['art']]['titel'] ?? 'Beleg';

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
    if ($b['status'] === 'bestaetigt' && $entschieden) {
        $hinweis = '<div class="hinweis hinweis-an">Angenommen am ' . portal_dmy(substr((string)$b['entscheidung_am'], 0, 10)) . '.</div>';
    } elseif ($b['status'] === 'abgelehnt' && $entschieden) {
        $hinweis = '<div class="hinweis hinweis-ab">Abgelehnt am ' . portal_dmy(substr((string)$b['entscheidung_am'], 0, 10)) . '.</div>';
    } elseif ($bezahlt) {
        $hinweis = '<div class="hinweis hinweis-an">Bezahlt am ' . portal_dmy($b['bezahlt_am']) . '.</div>';
    } elseif ($abgelaufen) {
        $hinweis = '<div class="hinweis hinweis-versendet">Dieser Link ist abgelaufen. Bitte wenden Sie sich an den Absender.</div>';
    } elseif ($ueberfaellig) {
        $hinweis = '<div class="hinweis hinweis-ab">Diese Rechnung ist seit dem ' . portal_dmy($b['faellig_bis']) . ' überfällig.</div>';
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

    $inhalt = $hinweis
        . '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:40px">'
        . '<div style="line-height:1.45;font-size:13px;color:#6B7280">' . portal_esc($firma !== '' ? $firma : 'Absender') . '</div>'
        . '<button type="button" class="knopf knopf-plain keindruck" onclick="window.print()">Drucken</button>'
        . '</div>'
        . '<div style="display:flex;justify-content:space-between;gap:40px;margin-bottom:40px;flex-wrap:wrap">'
        . '<table style="line-height:1.5;width:auto"><tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">' . portal_esc($titel) . 'nummer</td><td style="padding:2px 0;font-size:12px">' . portal_esc($b['nummer']) . '</td></tr>'
        . '<tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">Datum</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['datum']) . '</td></tr>'
        . (!portal_leeres_datum($b['gueltig_bis']) ? '<tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">Gültig bis</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['gueltig_bis']) . '</td></tr>' : '')
        . (!portal_leeres_datum($b['faellig_bis'] ?? null) ? '<tr><td style="padding:2px 24px 2px 0;color:#6B7280;font-size:12px">Fällig bis</td><td style="padding:2px 0;font-size:12px">' . portal_dmy($b['faellig_bis']) . '</td></tr>' : '')
        . '</table>'
        . '<div style="line-height:1.5;font-size:12px;min-width:200px">' . implode('<br>', array_map('portal_esc', $empfaenger)) . '</div>'
        . '</div>'
        . '<div style="font-size:19px;font-weight:700;margin-bottom:14px">' . portal_esc($b['titel'] ?: $titel) . ' ' . portal_esc($b['nummer']) . '</div>'
        . '<table><thead><tr>'
        . '<th style="padding:7px 8px;text-align:left;font-size:11px;font-weight:700;background:#EDEFF2">Produkt</th>'
        . '<th style="padding:7px 8px;text-align:left;font-size:11px;font-weight:700;background:#EDEFF2">Beschreibung</th>'
        . '<th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;background:#EDEFF2">Einzelpreis</th>'
        . '<th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;background:#EDEFF2">Menge</th>'
        . '<th style="padding:7px 8px;text-align:right;font-size:11px;font-weight:700;background:#EDEFF2">Summe</th>'
        . '</tr></thead><tbody>' . $zeilen . '</tbody></table>'
        . '<table style="margin-left:auto;margin-top:14px;width:auto">' . $summenHtml . '</table>'
        . $qrZahlteil
        . $abschnitt('Notizen', $b['oeffentliche_notizen'])
        . $abschnitt('Bedingungen', $b['bedingungen'])
        . ($b['fusszeile_text'] ? '<div style="margin-top:26px;padding-top:14px;border-top:1px solid #E5E8EC;white-space:pre-line;line-height:1.5;font-size:12px">' . nl2br(portal_esc($b['fusszeile_text'])) . '</div>' : '')
        . $knoepfe;

    portal_seite($titel . ' ' . $b['nummer'], $inhalt);
} catch (Throwable $e) {
    portal_fehler('Fehler', 'Diese Seite lässt sich gerade nicht anzeigen. Bitte versuchen Sie es später erneut.', 500);
}
