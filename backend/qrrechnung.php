<?php
declare(strict_types=1);
// Schweizer QR-Rechnung (ENT-205): IBAN-Pruefung, QR-Referenz und der
// SPC-Zahlungsteil (Swiss Payments Code) fuer den QR-Code auf der
// oeffentlichen Kundenseite (beleg_oeffentlich.php).
//
// STRENG NUR DER QRR-WEG (QR-IBAN + QR-Referenz), nicht SCOR/NON: Solange
// keine echte QR-IBAN hinterlegt ist, wird HIER NICHTS gerendert -- lieber
// gar kein Zahlteil als ein QR-Code, der in einer Banking-App falsch oder
// gar nicht liest. Siehe ENT-205 im Entscheidungsprotokoll.
//
// Quellen fuer die genauen Formate (offizielle SIX-PDF war vom Sandbox-Netz
// aus nicht erreichbar, darum ueber mehrere unabhaengige Implementierungen
// gegengeprueft -- Tabelle und Feldreihenfolge stimmen an allen Stellen
// exakt ueberein): SIX "Swiss Implementation Guidelines QR-bill" v2.x
// (IID-Bereich 30000-31999 fuer QR-IBAN, Referenzlaenge 27 Ziffern,
// Modulo-10-rekursiv-Tabelle, SPC-Feldreihenfolge mit 31 Zeilen).

// ── IBAN ─────────────────────────────────────────────────────────────────

function iban_normalisieren(string $iban): string
{
    return strtoupper(preg_replace('/\s+/', '', $iban) ?? '');
}

// ISO-7064-Mod-97-Pruefsumme (dieselbe Pruefung wie bei jeder IBAN weltweit,
// nicht Schweiz-spezifisch): die ersten vier Zeichen ans Ende verschieben,
// Buchstaben in Zahlen wandeln (A=10 ... Z=35), das Ganze als Dezimalzahl
// modulo 97 rechnen -- gueltig, wenn der Rest 1 ergibt. Ziffernweise statt
// mit einer grossen Zahl, weil eine IBAN als Zahl weit ausserhalb dessen
// liegt, was ein PHP-int sicher darstellt.
function iban_mod97_gueltig(string $iban): bool
{
    if (!preg_match('/^[A-Z]{2}[0-9A-Z]+$/', $iban) || strlen($iban) < 5) {
        return false;
    }
    $verschoben = substr($iban, 4) . substr($iban, 0, 4);
    $rest = 0;
    for ($i = 0, $n = strlen($verschoben); $i < $n; $i++) {
        $z = $verschoben[$i];
        $wert = ctype_alpha($z) ? (string)(ord($z) - 55) : $z;
        for ($j = 0, $m = strlen($wert); $j < $m; $j++) {
            $rest = ($rest * 10 + (int)$wert[$j]) % 97;
        }
    }
    return $rest === 1;
}

// Formal gueltige Schweizer/liechtensteinische IBAN: Laenge 21, CH/LI-
// Praefix, Mod-97 bestanden. Sagt NICHTS darueber aus, ob es eine QR-IBAN
// ist -- das prueft iban_ist_qr() separat.
function iban_ch_li_gueltig(string $iban): bool
{
    $n = iban_normalisieren($iban);
    if (strlen($n) !== 21 || !in_array(substr($n, 0, 2), ['CH', 'LI'], true)) {
        return false;
    }
    return iban_mod97_gueltig($n);
}

// QR-IID (Institution Identification) liegt an Position 5-9 der IBAN
// (1-basiert, hier also Zeichen 4 bis 8, 0-basiert) im Bereich 30000-31999
// -- dieser Bereich ist von SIX Interbank Clearing ausschliesslich fuer
// QR-IBANs reserviert. Nur mit einer solchen IID ist eine QRR-Referenz
// ueberhaupt zulaessig.
function iban_ist_qr(string $iban): bool
{
    $n = iban_normalisieren($iban);
    if (!iban_ch_li_gueltig($n)) {
        return false;
    }
    $iid = (int)substr($n, 4, 5);
    return $iid >= 30000 && $iid <= 31999;
}

// Nur fuers Anzeigen: IBAN in 4er-Gruppen, wie auf jedem Kontoauszug.
function iban_gruppiert(string $iban): string
{
    return trim((string)preg_replace('/(.{4})/', '$1 ', iban_normalisieren($iban)));
}

// ── QR-Referenz (QRR) ───────────────────────────────────────────────────

// Modulo 10 rekursiv -- dieselbe Pruefziffer wie beim frueheren Schweizer
// Einzahlungsschein (ESR/BVR), von SIX fuer die QRR-Referenz uebernommen.
// Die Tabelle ist eine feste, oeffentlich dokumentierte Konstante (keine
// bankspezifische Grosse) -- unabhaengig gegen zwei Implementierungen
// (Ruby- und PHP-Referenzcode) geprueft, beide liefern exakt diese Werte.
const QRR_MOD10_TABELLE = [
    [0, 9, 4, 6, 8, 2, 7, 1, 3, 5],
    [9, 4, 6, 8, 2, 7, 1, 3, 5, 0],
    [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
    [6, 8, 2, 7, 1, 3, 5, 0, 9, 4],
    [8, 2, 7, 1, 3, 5, 0, 9, 4, 6],
    [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
    [7, 1, 3, 5, 0, 9, 4, 6, 8, 2],
    [1, 3, 5, 0, 9, 4, 6, 8, 2, 7],
    [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
    [5, 0, 9, 4, 6, 8, 2, 7, 1, 3],
];

function qrr_pruefziffer(string $ziffern): int
{
    $stand = 0;
    foreach (str_split($ziffern) as $z) {
        $stand = QRR_MOD10_TABELLE[$stand][(int)$z];
    }
    return (10 - $stand) % 10;
}

// 27-stellige QRR-Referenz aus der Rechnungsnummer: deren Ziffern (z. B.
// "RE0950" -> "0950") rechtsbuendig auf 26 Stellen mit Nullen aufgefuellt,
// dahinter die Pruefziffer. Rein aus der bereits eindeutigen Rechnungs-
// nummer abgeleitet, keine zweite, separat zu pflegende Zaehlung -- und
// deshalb jederzeit reproduzierbar, auch ohne sie zu speichern.
function qrr_referenz(string $rechnungsnummer): string
{
    $ziffern = preg_replace('/\D/', '', $rechnungsnummer) ?? '';
    $basis = str_pad(substr($ziffern, -26), 26, '0', STR_PAD_LEFT);
    return $basis . qrr_pruefziffer($basis);
}

// ── SPC-Zahlungsteil (Swiss Payments Code) ─────────────────────────────

// Baut die 31 Zeilen des QR-Code-Inhalts, in der von SIX vorgegebenen,
// fixen Reihenfolge. Wird nur aufgerufen, wenn iban_ist_qr() bereits
// bestaetigt hat, dass eine QR-Referenz ueberhaupt zulaessig ist --
// diese Funktion selbst prueft das nicht nochmals.
//
// $betrieb: Zeile aus der Tabelle betrieb (firma, qr_iban, qr_strasse,
//   qr_hausnummer, qr_plz, qr_ort).
// $empfaenger: ['name'=>, 'strasse'=>, 'hausnummer'=>, 'plz'=>, 'ort'=>] des
//   Kunden, oder null, wenn unbekannt -- der Debitor-Block bleibt dann leer,
//   was der Standard ausdruecklich erlaubt.
function qr_spc_zeilen(array $betrieb, float $betragChf, string $rechnungsnummer, ?array $empfaenger): array
{
    $iban = iban_normalisieren((string)$betrieb['qr_iban']);
    $leer7 = ['', '', '', '', '', '', ''];
    $debitor = $empfaenger ? [
        'S',
        mb_substr((string)$empfaenger['name'], 0, 70),
        mb_substr((string)$empfaenger['strasse'], 0, 70),
        mb_substr((string)($empfaenger['hausnummer'] ?? ''), 0, 16),
        mb_substr((string)$empfaenger['plz'], 0, 16),
        mb_substr((string)$empfaenger['ort'], 0, 35),
        'CH',
    ] : $leer7;

    return array_merge([
        'SPC', '0200', '1',
        $iban,
        'S',
        mb_substr((string)$betrieb['firma'], 0, 70),
        mb_substr((string)$betrieb['qr_strasse'], 0, 70),
        mb_substr((string)($betrieb['qr_hausnummer'] ?? ''), 0, 16),
        mb_substr((string)$betrieb['qr_plz'], 0, 16),
        mb_substr((string)$betrieb['qr_ort'], 0, 35),
        'CH',
    ], $leer7, [
        number_format($betragChf, 2, '.', ''),
        'CHF',
    ], $debitor, [
        'QRR',
        qrr_referenz($rechnungsnummer),
        '',
        'EPD',
    ]);
}

function qr_spc_payload(array $betrieb, float $betragChf, string $rechnungsnummer, ?array $empfaenger): string
{
    return implode("\n", qr_spc_zeilen($betrieb, $betragChf, $rechnungsnummer, $empfaenger));
}
