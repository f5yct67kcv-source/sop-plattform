<?php
declare(strict_types=1);
// E-Mail-Designer des Betriebs (ENT-729).
//
// EINE HUELLE FUER ALLE MAILS, DIE EIN BETRIEB AN SEINE KUNDINNEN UND
// KUNDEN SCHICKT: Beleg-Link (Offerte, Rechnung), Zugang zum
// Kundenportal, Rundgang-Rapport, Bestaetigungscode und Annahmebestaetigung.
// Jede kuenftige Kundenmail kommt hier dazu (MAIL_ARTEN) und erbt damit
// Logo, Farben, Gruss und Antwortadresse -- Entscheid des Projektinhabers:
// "auf alle kuenftigen".
//
// NICHT HIER: die Mails, die die Betreiberin in eigenem Namen schickt
// (mail_vorlage.php) und Mails an Mitarbeitende. Vertraege gibt es nur auf
// der Betreiber-Seite (ENT-637), darum fehlen sie hier.
//
// Gespeichert in betrieb.mail_gestaltung als JSON. Fehlt etwas oder ist die
// Spalte noch nicht eingerichtet, gelten die Vorgaben unten -- eine Mail
// geht immer hinaus, auch ohne Gestaltung.
//
// VORSCHAU UND VERSAND KOMMEN AUS DERSELBEN FUNKTION (mail_betrieb_bauen):
// Eine Vorschau, die im Browser nachgebaut wird, sieht beim naechsten Umbau
// anders aus als die Mail, die wirklich ankommt.
//
// TABELLEN UND INLINE-STYLES aus demselben Grund wie in mail_vorlage.php:
// Outlook rendert ueber Word, Stylesheets im Kopf fallen oft weg.

const MAIL_G_SCHRIFT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// Platzhalter, die in jeder Mail gelten.
const MAIL_G_ALLGEMEIN = ['Firma', 'Telefon', 'E-Mail'];

// Die Mailarten. 'knopf' => true heisst: Die Mail traegt einen Knopf mit
// Link. Knopf und Ersatzlink stehen IMMER in der Mail, nur ihre Beschriftung
// ist aenderbar (Entscheid: "Knopf fest, Platzhalter frei") -- so kann kein
// Link verloren gehen. 'fest' beschreibt, was sonst noch fest dazukommt
// (Code-Block, Hinweis auf eine angepasste Fassung); es steht in der
// Oberflaeche als Erklaerung.
const MAIL_ARTEN = [
    'offerte' => [
        'name' => 'Offerte', 'knopf' => true,
        'platzhalter' => ['Titel', 'Nummer', 'Kunde', 'Fassung'],
        'fest' => 'Knopf zur Offerte. Ab der zweiten Fassung ein Hinweis, dass sie angepasst wurde.',
        'vorgabe' => [
            'betreff' => '{Titel} {Nummer} von {Firma}',
            'kopf'    => '{Titel} {Nummer}',
            'text'    => "Guten Tag\n\n{Firma} hat Ihnen die {Titel} {Nummer} zugestellt. Sie können sie über den Knopf ansehen und direkt annehmen oder ablehnen.",
            'knopf'   => 'Offerte ansehen',
        ],
    ],
    'rechnung' => [
        'name' => 'Rechnung', 'knopf' => true,
        'platzhalter' => ['Titel', 'Nummer', 'Kunde', 'Fassung'],
        'fest' => 'Knopf zur Rechnung. Ab der zweiten Fassung ein Hinweis, dass sie angepasst wurde.',
        'vorgabe' => [
            'betreff' => '{Titel} {Nummer} von {Firma}',
            'kopf'    => '{Titel} {Nummer}',
            'text'    => "Guten Tag\n\n{Firma} hat Ihnen die {Titel} {Nummer} zugestellt. Sie können sie über den Knopf ansehen.",
            'knopf'   => 'Rechnung ansehen',
        ],
    ],
    'portal' => [
        'name' => 'Zugang zum Kundenportal', 'knopf' => true,
        'platzhalter' => ['Kunde', 'Minuten'],
        'fest' => 'Knopf zum Festlegen des Passworts.',
        'vorgabe' => [
            'betreff' => 'Ihr Zugang zum Kundenportal von {Firma}',
            'kopf'    => 'Ihr Zugang zum Kundenportal',
            'text'    => "Guten Tag\n\nÜber den Knopf legen Sie Ihr Passwort für das Kundenportal fest. Der Link gilt {Minuten} Minuten und nur einmal.\n\nHaben Sie ihn nicht angefordert, können Sie diese Nachricht ignorieren. Ohne den Link geschieht nichts.",
            'knopf'   => 'Passwort festlegen',
        ],
    ],
    'rundgang' => [
        'name' => 'Rundgang-Rapport', 'knopf' => false,
        'platzhalter' => ['Objekt', 'Datum', 'Dauer'],
        'fest' => 'Der Rapport liegt als PDF bei.',
        'vorgabe' => [
            'betreff' => 'Rundgang-Rapport {Objekt} vom {Datum}',
            'kopf'    => 'Rundgang-Rapport {Objekt}',
            'text'    => "Guten Tag\n\nIm Anhang finden Sie den Rapport zum Rundgang vom {Datum}.\n\nObjekt: {Objekt}\nDauer: {Dauer}",
            'knopf'   => '',
        ],
    ],
    'code' => [
        'name' => 'Bestätigungscode', 'knopf' => false,
        'platzhalter' => ['Titel', 'Nummer', 'Code', 'Minuten'],
        'fest' => 'Der Code steht gross in einem eigenen Feld.',
        'vorgabe' => [
            'betreff' => 'Ihr Bestätigungscode: {Code}',
            'kopf'    => 'Ihr Bestätigungscode',
            'text'    => "Guten Tag\n\nSie möchten die {Titel} {Nummer} von {Firma} annehmen. Ihr Bestätigungscode gilt {Minuten} Minuten. Geben Sie ihn auf der Seite der {Titel} ein.\n\nHaben Sie nichts angefordert, können Sie diese Mail ignorieren. Ohne den Code wird nichts angenommen.",
            'knopf'   => '',
        ],
    ],
    'annahme' => [
        'name' => 'Annahmebestätigung', 'knopf' => false,
        'platzhalter' => ['Titel', 'Nummer', 'Name', 'Datum', 'Fassung'],
        'fest' => 'Das unterschriebene Dokument liegt als PDF bei.',
        'vorgabe' => [
            'betreff' => 'Bestätigung: {Titel} {Nummer} angenommen',
            'kopf'    => '{Titel} {Nummer} angenommen',
            'text'    => "Guten Tag {Name}\n\nVielen Dank. Sie haben die {Titel} {Nummer} (Fassung {Fassung}) am {Datum} angenommen.\n\nDas unterschriebene Dokument liegt dieser E-Mail bei. Bitte bewahren Sie es auf.",
            'knopf'   => '',
        ],
    ],
];

// Werte, mit denen die Vorschau und die Testmail rechnen. Keine echten
// Namen (CLAUDE.md, Vertraulichkeit).
const MAIL_MUSTER = [
    'Titel' => 'Offerte', 'Nummer' => 'OF-0001', 'Kunde' => 'Muster AG', 'Fassung' => '1',
    'Minuten' => '30', 'Objekt' => 'Lager Beispiel', 'Datum' => '01.01.2026', 'Dauer' => '1:15 Stunden',
    'Code' => '483 920', 'Name' => 'Maria Muster',
];
const MAIL_MUSTER_TITEL = ['offerte' => 'Offerte', 'rechnung' => 'Rechnung',
                           'code' => 'Offerte', 'annahme' => 'Offerte'];

function mail_g_vorgabe(): array
{
    $texte = [];
    foreach (MAIL_ARTEN as $art => $a) { $texte[$art] = $a['vorgabe']; }
    return [
        'farben' => ['primaer' => '#2F5BD7', 'kopf_hg' => '#2F5BD7', 'kopf_text' => '#FFFFFF',
                     'link' => '#2F5BD7', 'knopf' => '#2F5BD7', 'knopf_text' => '#FFFFFF'],
        'logo'   => ['an' => true, 'breite' => 140, 'hoehe' => 0, 'ausrichtung' => 'links'],
        'gruss'  => "Freundliche Grüsse\n{Firma}",
        'hinweis' => true,
        'texte'  => $texte,
    ];
}

// Prueft und vervollstaendigt eine Gestaltung. Gibt [gestaltung, fehler]
// zurueck; fehler ist eine Liste lesbarer Saetze. Unbekannte Schluessel
// fallen weg, fehlende kommen aus der Vorgabe -- so kann ein aelterer
// Stand nie eine halbe Mail ergeben.
function mail_g_pruefen($roh): array
{
    $v = mail_g_vorgabe();
    $roh = is_array($roh) ? $roh : [];
    $fehler = [];
    $farbe = static function ($w, string $was, string $vorgabe) use (&$fehler): string {
        if ($w === null || $w === '') { return $vorgabe; }
        if (!is_string($w) || !preg_match('/^#[0-9A-Fa-f]{6}$/', $w)) {
            $fehler[] = "$was ist keine gültige Farbe (#RRGGBB).";
            return $vorgabe;
        }
        return strtoupper($w);
    };
    $namen = ['primaer' => 'Primärfarbe', 'kopf_hg' => 'Kopfband-Hintergrund', 'kopf_text' => 'Kopfband-Text',
              'link' => 'Linkfarbe', 'knopf' => 'Knopffarbe', 'knopf_text' => 'Knopftext'];
    $f = is_array($roh['farben'] ?? null) ? $roh['farben'] : [];
    $farben = [];
    foreach ($namen as $k => $n) { $farben[$k] = $farbe($f[$k] ?? null, $n, $v['farben'][$k]); }

    $l = is_array($roh['logo'] ?? null) ? $roh['logo'] : [];
    $groesse = static function ($w, int $vorgabe, string $was) use (&$fehler): int {
        if ($w === null || $w === '') { return $vorgabe; }
        if (!is_numeric($w) || (int)$w != $w || (int)$w < 0 || (int)$w > 400) {
            $fehler[] = "$was muss zwischen 0 und 400 Pixel liegen.";
            return $vorgabe;
        }
        return (int)$w;
    };
    $logo = [
        'an' => array_key_exists('an', $l) ? (bool)$l['an'] : $v['logo']['an'],
        'breite' => $groesse($l['breite'] ?? null, $v['logo']['breite'], 'Die Logobreite'),
        'hoehe'  => $groesse($l['hoehe'] ?? null, $v['logo']['hoehe'], 'Die Logohöhe'),
        'ausrichtung' => in_array($l['ausrichtung'] ?? null, ['links', 'mitte', 'rechts'], true)
            ? $l['ausrichtung'] : $v['logo']['ausrichtung'],
    ];
    if ($logo['breite'] === 0 && $logo['hoehe'] === 0) { $logo['breite'] = $v['logo']['breite']; }

    $gruss = isset($roh['gruss']) && is_string($roh['gruss']) ? mail_g_text($roh['gruss'], 300) : $v['gruss'];
    foreach (mail_g_unbekannt($gruss, MAIL_G_ALLGEMEIN) as $p) {
        $fehler[] = "Im Gruss steht der unbekannte Platzhalter {{$p}}.";
    }

    $texte = [];
    $t = is_array($roh['texte'] ?? null) ? $roh['texte'] : [];
    $grenzen = ['betreff' => 150, 'kopf' => 120, 'text' => 3000, 'knopf' => 60];
    foreach (MAIL_ARTEN as $art => $a) {
        $eigen = is_array($t[$art] ?? null) ? $t[$art] : [];
        $erlaubt = array_merge(MAIL_G_ALLGEMEIN, $a['platzhalter']);
        foreach ($grenzen as $feld => $max) {
            if (!$a['knopf'] && $feld === 'knopf') { $texte[$art][$feld] = ''; continue; }
            $w = isset($eigen[$feld]) && is_string($eigen[$feld]) ? $eigen[$feld] : $a['vorgabe'][$feld];
            $w = mail_g_text($w, $max);
            if ($feld !== 'text') { $w = trim(preg_replace('/\s+/u', ' ', $w) ?? ''); }
            // Ohne Betreff oder Knopfbeschriftung geht keine brauchbare Mail
            // hinaus -- dann gilt wieder die Vorgabe, statt eines leeren Felds.
            if ($w === '' && in_array($feld, ['betreff', 'knopf'], true)) { $w = $a['vorgabe'][$feld]; }
            foreach (mail_g_unbekannt($w, $erlaubt) as $p) {
                $fehler[] = "{$a['name']}: unbekannter Platzhalter {{$p}}.";
            }
            $texte[$art][$feld] = $w;
        }
    }
    return [['farben' => $farben, 'logo' => $logo, 'gruss' => $gruss,
             'hinweis' => array_key_exists('hinweis', $roh) ? (bool)$roh['hinweis'] : $v['hinweis'],
             'texte' => $texte], array_values(array_unique($fehler))];
}

// Reiner Text, ohne Steuerzeichen ausser Zeilenumbruch, gekuerzt.
function mail_g_text(string $w, int $max): string
{
    $w = str_replace(["\r\n", "\r"], "\n", $w);
    $w = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', $w) ?? '';
    return trim(mb_substr($w, 0, $max));
}

function mail_g_unbekannt(string $w, array $erlaubt): array
{
    preg_match_all('/\{([^{}]{1,40})\}/u', $w, $m);
    return array_values(array_diff(array_unique($m[1]), $erlaubt));
}

// Die gespeicherte Gestaltung des Betriebs. Ohne Spalte oder ohne Eintrag:
// die Vorgabe. Ein kaputter Eintrag ebenso -- die Mail geht trotzdem.
function mail_g_laden(PDO $pdo): array
{
    try {
        if (!hat_spalte($pdo, 'betrieb', 'mail_gestaltung')) { return mail_g_vorgabe(); }
        $roh = $pdo->query('SELECT mail_gestaltung FROM betrieb WHERE id = 1')->fetchColumn();
        $daten = is_string($roh) && $roh !== '' ? json_decode($roh, true) : null;
        return mail_g_pruefen($daten)[0];
    } catch (Throwable $e) {
        return mail_g_vorgabe();
    }
}

// Was vom Betrieb in jede Mail kommt: Name, Kontakt, Logo.
function mail_g_betrieb(PDO $pdo): array
{
    try {
        $spalten = ['firma', 'logo', 'logo_mime'];
        foreach (['domizil_strasse', 'domizil_plz', 'domizil_ort', 'telefon', 'email'] as $s) {
            if (hat_spalte($pdo, 'betrieb', $s)) { $spalten[] = $s; }
        }
        $z = $pdo->query('SELECT ' . implode(', ', $spalten) . ' FROM betrieb WHERE id = 1')
                 ->fetch(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        $z = [];
    }
    $mime = (string)($z['logo_mime'] ?? '');
    // Nur Bilder, die jedes Mailprogramm zeigt. Ein altes SVG-Logo
    // (ENT-501) bleibt draussen.
    $logo = (!empty($z['logo']) && in_array($mime, ['image/png', 'image/jpeg'], true))
        ? ['mime' => $mime, 'inhalt' => (string)$z['logo']] : null;
    $email = trim((string)($z['email'] ?? ''));
    return [
        'firma'   => trim((string)($z['firma'] ?? '')),
        'strasse' => trim((string)($z['domizil_strasse'] ?? '')),
        'ort'     => trim(trim((string)($z['domizil_plz'] ?? '')) . ' ' . trim((string)($z['domizil_ort'] ?? ''))),
        'telefon' => trim((string)($z['telefon'] ?? '')),
        'email'   => filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '',
        'logo'    => $logo,
        'logo_webp' => !empty($z['logo']) && $mime === 'image/webp',
    ];
}

// Setzt die Platzhalter ein. Die Werte sind roher Text; maskiert wird erst
// beim Zusammensetzen des HTML.
function mail_g_einsetzen(string $vorlage, array $werte): string
{
    return preg_replace_callback('/\{([^{}]{1,40})\}/u', static function ($m) use ($werte) {
        return array_key_exists($m[1], $werte) ? (string)$werte[$m[1]] : $m[0];
    }, $vorlage) ?? $vorlage;
}

function mail_g_e(string $w): string
{
    return htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
}

// Baut eine Mail des Betriebs.
//   $art      Schluessel aus MAIL_ARTEN
//   $werte    Platzhalter-Werte dieser Mail (ohne Firma/Telefon/E-Mail)
//   $extra    'link' (Pflicht bei Arten mit Knopf), 'code', 'fassung' (int)
//   $vorschau true: Logo als data:-Adresse statt eingebettet (fuer die
//             Vorschau im Browser, die keine cid:-Bilder kennt)
// Rueckgabe: betreff, html, text, bilder, antwort_an
function mail_betrieb_bauen(array $g, array $betrieb, string $art, array $werte, array $extra = [],
                            bool $vorschau = false): array
{
    $a = MAIL_ARTEN[$art] ?? MAIL_ARTEN['offerte'];
    $t = $g['texte'][$art] ?? $a['vorgabe'];
    $f = $g['farben'];
    $firma = $betrieb['firma'] !== '' ? $betrieb['firma'] : 'Ihr Ansprechpartner';
    $alle = array_merge(['Firma' => $firma, 'Telefon' => $betrieb['telefon'], 'E-Mail' => $betrieb['email']], $werte);

    $betreff = trim(preg_replace('/\s+/u', ' ', mail_g_einsetzen($t['betreff'], $alle)) ?? '');
    $kopf    = trim(mail_g_einsetzen($t['kopf'], $alle));
    $text    = mail_g_einsetzen($t['text'], $alle);
    $knopf   = mail_g_einsetzen($t['knopf'], $alle);
    $gruss   = array_values(array_filter(array_map('trim',
                   explode("\n", mail_g_einsetzen($g['gruss'], $alle))), fn($z) => $z !== ''));
    $link    = (string)($extra['link'] ?? '');
    $fassung = (int)($extra['fassung'] ?? 1);
    $s = 'font-family:' . MAIL_G_SCHRIFT . ';';

    // ── Logo ───────────────────────────────────────────────────────────
    $bilder = [];
    $logoHtml = '';
    if ($g['logo']['an'] && $betrieb['logo'] !== null) {
        $quelle = $vorschau
            ? 'data:' . $betrieb['logo']['mime'] . ';base64,' . base64_encode($betrieb['logo']['inhalt'])
            : 'cid:betrieb-logo';
        if (!$vorschau) {
            $bilder[] = ['cid' => 'betrieb-logo', 'mime' => $betrieb['logo']['mime'], 'inhalt' => $betrieb['logo']['inhalt']];
        }
        $b = (int)$g['logo']['breite']; $h = (int)$g['logo']['hoehe'];
        $masse = ($b > 0 ? ' width="' . $b . '"' : '') . ($h > 0 ? ' height="' . $h . '"' : '');
        $stil = 'display:inline-block;border:0;outline:none;'
              . ($b > 0 ? 'width:' . $b . 'px;' : '') . ($h > 0 ? 'height:' . $h . 'px;' : 'height:auto;');
        $ausr = ['links' => 'left', 'mitte' => 'center', 'rechts' => 'right'][$g['logo']['ausrichtung']];
        $logoHtml = '<tr><td align="' . $ausr . '" style="padding:28px 32px 20px 32px;text-align:' . $ausr . ';">'
            . '<img src="' . mail_g_e($quelle) . '" alt="' . mail_g_e($firma) . '"' . $masse
            . ' style="' . $stil . '"></td></tr>';
    }

    // ── Kopfband ───────────────────────────────────────────────────────
    $kopfHtml = $kopf === '' ? '' :
        '<tr><td style="' . $s . 'background:' . $f['kopf_hg'] . ';padding:22px 32px;font-size:20px;'
        . 'font-weight:700;line-height:1.3;color:' . $f['kopf_text'] . ';">' . mail_g_e($kopf) . '</td></tr>';

    // ── Inhalt: Absaetze an Leerzeilen, einfache Umbrueche bleiben ──────
    $absatz = static fn(string $h): string =>
        '<p style="' . $s . 'margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#14161A;">' . $h . '</p>';
    $inhalt = '';
    foreach (preg_split('/\n\s*\n/u', trim($text)) ?: [] as $teil) {
        if (trim($teil) === '') { continue; }
        $inhalt .= $absatz(nl2br(mail_g_e(trim($teil)), false));
    }
    if ($fassung > 1 && in_array($art, ['offerte', 'rechnung'], true)) {
        $inhalt .= $absatz('<span style="color:#545B67;">Dies ist eine angepasste Fassung (Fassung '
            . $fassung . '). Sie ersetzt die vorherige.</span>');
    }
    if ($art === 'code') {
        $inhalt .= '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;">'
            . '<tr><td style="' . $s . 'background:#F2F4F8;border:1px solid #E5E8EC;border-radius:6px;'
            . 'padding:14px 22px;font-size:26px;font-weight:700;letter-spacing:4px;color:#14161A;'
            . "font-family:'SF Mono',Menlo,Consolas,monospace;\">" . mail_g_e((string)($extra['code'] ?? '')) . '</td></tr></table>';
    }
    if ($a['knopf']) {
        $inhalt .= '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"'
            . ' style="margin:8px auto 22px auto;"><tr>'
            . '<td align="center" style="background:' . $f['knopf'] . ';border-radius:6px;">'
            . '<a href="' . mail_g_e($link) . '" style="' . $s . 'display:inline-block;padding:14px 28px;'
            . 'font-size:16px;font-weight:700;line-height:1.2;color:' . $f['knopf_text'] . ';text-decoration:none;">'
            . mail_g_e($knopf) . '</a></td></tr></table>'
            . '<p style="' . $s . 'margin:0 0 22px 0;font-size:11px;line-height:1.55;color:#6B7280;">'
            . 'Funktioniert der Knopf nicht? Diese Adresse in den Browser kopieren:<br>'
            . '<a href="' . mail_g_e($link) . '" style="' . $s . 'color:' . $f['link'] . ';word-break:break-all;">'
            . mail_g_e($link) . '</a></p>';
    }
    if ($gruss !== []) {
        $inhalt .= '<p style="' . $s . 'margin:10px 0 0 0;font-size:15px;line-height:1.5;color:#14161A;">'
            . implode('<br>', array_map('mail_g_e', $gruss)) . '</p>';
    }

    // ── Fusszeile: Angaben des Betriebs ───────────────────────────────
    $fuss = array_values(array_filter([$betrieb['firma'], $betrieb['strasse'], $betrieb['ort']]));
    $kontakt = [];
    if ($betrieb['telefon'] !== '') { $kontakt[] = mail_g_e($betrieb['telefon']); }
    if ($betrieb['email'] !== '') {
        $kontakt[] = '<a href="mailto:' . mail_g_e($betrieb['email']) . '" style="' . $s . 'color:' . $f['link']
            . ';text-decoration:none;">' . mail_g_e($betrieb['email']) . '</a>';
    }
    $fussHtml = '';
    if ($fuss !== [] || $kontakt !== []) {
        $fussHtml .= '<p style="' . $s . 'margin:0 0 6px 0;font-size:12px;line-height:1.6;color:#6B7280;text-align:center;">'
            . implode(' · ', array_map('mail_g_e', $fuss))
            . ($kontakt !== [] ? ($fuss !== [] ? '<br>' : '') . implode(' · ', $kontakt) : '') . '</p>';
    }
    if ($g['hinweis']) {
        $fussHtml .= '<p style="' . $s . 'margin:0;font-size:11px;line-height:1.6;color:#9BA3AF;text-align:center;">'
            . 'Versendet mit <a href="https://guardops.ch" style="' . $s . 'color:#9BA3AF;">GuardOpS</a></p>';
    }

    $html = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' . mail_g_e($betreff) . '</title></head>'
        . '<body style="margin:0;padding:0;background:#F2F4F8;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F4F8;">'
        . '<tr><td align="center" style="padding:24px 12px;">'
        . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"'
        . ' style="width:100%;max-width:600px;background:#FFFFFF;border-radius:8px;">'
        . $logoHtml . $kopfHtml
        . '<tr><td style="padding:28px 32px 24px 32px;">' . $inhalt . '</td></tr>'
        . '</table>'
        . ($fussHtml !== '' ? '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"'
            . ' style="width:100%;max-width:600px;"><tr><td style="padding:18px 32px 0 32px;">' . $fussHtml . '</td></tr></table>' : '')
        . '</td></tr></table></body></html>';

    // ── Reiner Text: dieselben Angaben, ohne Gestaltung ───────────────
    $klar = trim($text) . "\n\n";
    if ($fassung > 1 && in_array($art, ['offerte', 'rechnung'], true)) {
        $klar .= "Dies ist eine angepasste Fassung (Fassung $fassung). Sie ersetzt die vorherige.\n\n";
    }
    if ($art === 'code') { $klar .= (string)($extra['code'] ?? '') . "\n\n"; }
    if ($a['knopf']) { $klar .= "$knopf:\n$link\n\n"; }
    $klar .= implode("\n", $gruss);
    $fussText = implode(', ', array_filter([implode(', ', $fuss), $betrieb['telefon'], $betrieb['email']]));
    if ($fussText !== '') { $klar .= "\n\n--\n" . $fussText; }

    return ['betreff' => $betreff !== '' ? $betreff : $a['name'], 'html' => $html, 'text' => $klar,
            'bilder' => $bilder, 'antwort_an' => $betrieb['email']];
}

// Kurzweg fuer die Versandstellen: laedt Gestaltung und Betrieb selbst.
// 'server' ist der eigene Mailserver des Betriebs (ENT-730) oder null; die
// Versandstelle reicht ihn an smtp_senden() weiter.
function mail_betrieb(PDO $pdo, string $art, array $werte, array $extra = []): array
{
    $b = mail_g_betrieb($pdo);
    $m = mail_betrieb_bauen(mail_g_laden($pdo), $b, $art, $werte, $extra);
    $m['server'] = mail_v_fuer_versand($pdo, $b['firma']);
    return $m;
}

// Musterwerte einer Art fuer Vorschau und Testmail.
function mail_g_muster(string $art): array
{
    $w = MAIL_MUSTER;
    $w['Titel'] = MAIL_MUSTER_TITEL[$art] ?? 'Offerte';
    $w['Nummer'] = $art === 'rechnung' ? 'RE-0001' : 'OF-0001';
    return $w;
}

// ── Eigener Mailserver des Betriebs (ENT-730) ────────────────────────
//
// Statt ueber GuardOpS gehen die Kundenmails oben (MAIL_ARTEN) ueber den
// Mailserver des Betriebs hinaus, mit seiner Absenderadresse. Mails an
// Mitarbeitende bleiben bei GuardOpS: Ein falsches Passwort hier soll
// niemanden aus dem eigenen Konto aussperren (Entscheid des
// Projektinhabers).
//
// Gespeichert in betrieb.mail_versand als JSON. Das Passwort steht dort nur
// verschluesselt; der Schluessel kommt aus dem Deploy (Secret
// MAIL_SCHLUESSEL), nie aus der Datenbank. Wer nur die Datenbank hat, hat
// kein Passwort. Fehlt der Schluessel, laesst sich kein eigener Server
// einrichten, und ein gespeicherter wird nicht benutzt -- dann scheitert
// der Versand mit einer Meldung statt still ueber GuardOpS zu gehen
// (Entscheid: "Fehler melden, kein Ausweichen").

// Nur die ueblichen Ports fuer Mailversand. Der Server verbindet sich auf
// Zuruf des Betriebs -- ohne Grenze liesse sich damit von aussen
// ausprobieren, welche Dienste im Rechenzentrum offen sind.
const MAIL_V_PORTS = [25, 465, 587, 2525];

// 32 Bytes, base64. null, solange der Deploy keinen gueltigen Wert
// eingesetzt hat.
function mail_v_schluessel(?string $roh = null): ?string
{
    $roh ??= '__MAIL_SCHLUESSEL__';
    // Wie platzhalter_offen() in mailer.php, aber ohne mailer.php: Diese
    // Datei wird auch dort geladen, wo mailer.php fehlt.
    if ($roh === '' || str_contains($roh, '__MAIL_SCHLUESSEL')) { return null; }
    $k = base64_decode(trim($roh), true);
    return is_string($k) && strlen($k) === 32 ? $k : null;
}

function mail_v_verschluesseln(string $klar, string $schluessel): string
{
    $iv = random_bytes(12);
    $tag = '';
    $roh = openssl_encrypt($klar, 'aes-256-gcm', $schluessel, OPENSSL_RAW_DATA, $iv, $tag);
    return 'v1:' . base64_encode($iv . $tag . $roh);
}

// null, wenn der Wert nicht mit diesem Schluessel verschluesselt wurde
// oder veraendert ist (GCM prueft beides).
function mail_v_entschluesseln(string $wert, string $schluessel): ?string
{
    if (!str_starts_with($wert, 'v1:')) { return null; }
    $b = base64_decode(substr($wert, 3), true);
    if (!is_string($b) || strlen($b) < 29) { return null; }
    $klar = openssl_decrypt(substr($b, 28), 'aes-256-gcm', $schluessel, OPENSSL_RAW_DATA,
                            substr($b, 0, 12), substr($b, 12, 16));
    return $klar === false ? null : $klar;
}

// Prueft die Eingabe aus dem Formular. $alt ist der gespeicherte Stand:
// Ein leeres Passwortfeld heisst "unveraendert", weil das Passwort nie an
// den Browser zurueckgeht. Rueckgabe [stand, fehler]; das Passwort steht im
// Stand noch im Klartext unter 'passwort_klar'.
function mail_v_pruefen(array $roh, array $alt = []): array
{
    $fehler = [];
    $typ = ($roh['typ'] ?? '') === 'eigen' ? 'eigen' : 'guardops';
    if ($typ === 'guardops') { return [['typ' => 'guardops'], []]; }

    $zeile = fn($w) => trim(preg_replace('/[\x00-\x1F\x7F]/', '', (string)$w));
    $absender = $zeile($roh['absender'] ?? '');
    $benutzer = $zeile($roh['benutzer'] ?? '');
    $server = strtolower($zeile($roh['server'] ?? ''));
    $port = (int)($roh['port'] ?? 0);
    $versch = ($roh['verschluesselung'] ?? '') === 'starttls' ? 'starttls' : 'ssl';
    $pw = (string)($roh['passwort'] ?? '');

    if (!filter_var($absender, FILTER_VALIDATE_EMAIL)) { $fehler[] = 'Die Absenderadresse ist keine gültige E-Mail-Adresse.'; }
    if ($benutzer === '' || strlen($benutzer) > 254) { $fehler[] = 'Der Benutzername fehlt.'; }
    if (!preg_match('/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $server)) {
        $fehler[] = 'Der Server muss ein Name wie mail.beispiel.ch sein.';
    }
    if (!in_array($port, MAIL_V_PORTS, true)) {
        $fehler[] = 'Erlaubt sind die Ports ' . implode(', ', MAIL_V_PORTS) . '.';
    }
    if ($pw === '' && ($alt['passwort'] ?? '') === '') { $fehler[] = 'Das Passwort fehlt.'; }
    if (preg_match('/[\r\n]/', $pw) || strlen($pw) > 500) { $fehler[] = 'Das Passwort enthält unzulässige Zeichen.'; }

    return [['typ' => 'eigen', 'absender' => $absender, 'benutzer' => $benutzer, 'server' => $server,
             'port' => $port, 'verschluesselung' => $versch, 'passwort_klar' => $pw], $fehler];
}

// Der gespeicherte Stand, so wie er in der Datenbank steht (Passwort
// verschluesselt). Leer, solange nichts eingerichtet ist.
function mail_v_laden(PDO $pdo): array
{
    try {
        if (!hat_spalte($pdo, 'betrieb', 'mail_versand')) { return []; }
        $roh = $pdo->query('SELECT mail_versand FROM betrieb WHERE id = 1')->fetchColumn();
        $d = is_string($roh) && $roh !== '' ? json_decode($roh, true) : null;
        return is_array($d) ? $d : [];
    } catch (Throwable $e) {
        return [];
    }
}

function mail_v_schreiben(PDO $pdo, array $stand): void
{
    $pdo->prepare('UPDATE betrieb SET mail_versand = ? WHERE id = 1')
        ->execute([json_encode($stand, JSON_UNESCAPED_UNICODE)]);
}

// Was der Browser sehen darf: alles ausser dem Passwort.
function mail_v_oeffentlich(array $stand): array
{
    $raus = ['typ' => ($stand['typ'] ?? '') === 'eigen' ? 'eigen' : 'guardops'];
    foreach (['absender', 'benutzer', 'server', 'port', 'verschluesselung', 'letzter_fehler', 'zuletzt_ok'] as $k) {
        if (isset($stand[$k])) { $raus[$k] = $stand[$k]; }
    }
    $raus['passwort_hinterlegt'] = ($stand['passwort'] ?? '') !== '';
    return $raus;
}

// Baut aus dem Stand die Angaben fuer smtp_senden(). null heisst: ueber
// GuardOpS. Ein eigener Server, der sich nicht benutzen laesst, liefert
// ['fehler' => ...] -- smtp_senden() bricht dann ab, statt auszuweichen.
function mail_v_server(array $stand, string $firma, ?string $schluessel, ?string $klarPasswort = null): ?array
{
    if (($stand['typ'] ?? '') !== 'eigen') { return null; }
    if ($klarPasswort === null) {
        if ($schluessel === null) {
            return ['fehler' => 'Der eigene Mailserver ist eingerichtet, aber auf dieser Anlage fehlt der Schlüssel '
                . 'für das Passwort. Bitte der Betreiberin melden.'];
        }
        $klarPasswort = mail_v_entschluesseln((string)($stand['passwort'] ?? ''), $schluessel);
        if ($klarPasswort === null) {
            return ['fehler' => 'Das Passwort des eigenen Mailservers lässt sich nicht mehr lesen. '
                . 'Bitte unter Betrieb › E-Mail-Versand neu eingeben.'];
        }
    }
    return ['eigen' => true, 'host' => (string)$stand['server'], 'port' => (int)$stand['port'],
            'verschluesselung' => (string)$stand['verschluesselung'], 'user' => (string)$stand['benutzer'],
            'pass' => $klarPasswort, 'absender' => (string)$stand['absender'], 'name' => $firma];
}

// Fuer die Versandstellen: der Server des Betriebs samt Rueckmeldung. Ein
// Fehler beim Versand wird am Betrieb vermerkt und unter E-Mail-Versand
// angezeigt -- viele dieser Mails gehen ohne jemanden vor dem Bildschirm
// hinaus (Annahmebestaetigung, Portal-Link), und eine Stoerung soll nicht
// unbemerkt bleiben.
function mail_v_fuer_versand(PDO $pdo, string $firma): ?array
{
    $stand = mail_v_laden($pdo);
    $s = mail_v_server($stand, $firma, mail_v_schluessel());
    if ($s === null) { return null; }
    $s['rueckmeldung'] = function (?string $fehler) use ($pdo): void {
        try {
            $st = mail_v_laden($pdo);
            if (($st['typ'] ?? '') !== 'eigen') { return; }
            $jetzt = date('Y-m-d H:i:s');
            if ($fehler === null) {
                if (empty($st['letzter_fehler']) && ($st['zuletzt_ok'] ?? '') > date('Y-m-d H:i:s', time() - 3600)) { return; }
                unset($st['letzter_fehler']);
                $st['zuletzt_ok'] = $jetzt;
            } else {
                $st['letzter_fehler'] = ['am' => $jetzt, 'text' => mb_substr($fehler, 0, 300)];
            }
            mail_v_schreiben($pdo, $st);
        } catch (Throwable $e) {
            // Die Rueckmeldung darf den Versand nicht stoeren.
        }
    };
    return $s;
}
