<?php
// QR-Rechnung wirklich ausfuehren (ENT-205) -- dieselbe Haltung wie
// pruef_belege.php: eine Zahlungspruefsumme, die an eine echte Bank geht,
// wird nicht nur gelesen, sondern gerechnet und gegen unabhaengig
// veroeffentlichte Beispiele gehalten.
declare(strict_types=1);
require __DIR__ . '/../backend/qrrechnung.php';

// Mit --json liefert diese Datei nur einen echten SPC-Zahlteil als Text,
// damit test_qr.mjs ihn im Browser durch dieselbe QR-Bibliothek schickt, die
// auch beleg_oeffentlich.php einbindet -- die Nahtstelle PHP-Text -> im
// Browser gescannter Code wird so tatsaechlich einmal durchlaufen, nicht nur
// mit einer selbst ausgedachten Testzeichenkette.
if (in_array('--json', $argv ?? [], true)) {
    $betrieb = ['firma' => 'Cupi 24 GmbH', 'qr_iban' => 'CH44 3199 9123 0008 8901 2',
        'qr_strasse' => 'Baslerstrasse', 'qr_hausnummer' => '67', 'qr_plz' => '4632', 'qr_ort' => 'Trimbach'];
    $debitor = ['name' => 'abc consulting gmbh', 'strasse' => 'Hochgasse', 'hausnummer' => '7',
        'plz' => '4632', 'ort' => 'Trimbach'];
    echo json_encode(['spc' => qr_spc_payload($betrieb, 48.65, 'RE0962', $debitor)], JSON_UNESCAPED_UNICODE), "\n";
    exit(0);
}

$ok = 0; $bad = [];
function check(string $name, bool $bedingung): void {
    global $ok, $bad;
    if ($bedingung) { $ok++; } else { $bad[] = $name; }
}

// ── IBAN-Pruefsumme (ISO 7064 Mod-97) ─────────────────────────────────────
// CH93 0076 2011 6238 5295 7 -- das ueberall (u. a. Wikipedia/ISO) als
// Beispiel verwendete, gueltige Schweizer IBAN. IID an Position 5-9 ist
// "00762", also KEINE QR-IBAN.
check('KRITISCH: die bekannte Beispiel-IBAN CH93... besteht die Mod-97-Pruefung',
    iban_ch_li_gueltig('CH93 0076 2011 6238 5295 7'));
check('KRITISCH: sie ist trotzdem KEINE QR-IBAN (IID 00762 liegt ausserhalb 30000-31999)',
    !iban_ist_qr('CH93 0076 2011 6238 5295 7'));
check('KRITISCH: vertauschte Pruefziffern werden erkannt (Mod-97 schlaegt fehl)',
    !iban_ch_li_gueltig('CH39 0076 2011 6238 5295 7'));
check('Eine IBAN mit falscher Laenge wird abgewiesen', !iban_ch_li_gueltig('CH93 0076 2011'));
check('Eine IBAN mit falschem Laenderpraefix wird abgewiesen',
    !iban_ch_li_gueltig('DE93 0076 2011 6238 5295 7'));

// ── Echte QR-IBAN ─────────────────────────────────────────────────────────
// CH44 3199 9123 0008 8901 2 -- oeffentliches Beispiel der Bibliothek
// sprain/php-swiss-qr-bill fuer eine gueltige QR-IBAN (IID 31999, oberes
// Ende des reservierten Bereichs).
check('KRITISCH: das oeffentliche QR-IBAN-Beispiel besteht die Mod-97-Pruefung',
    iban_ch_li_gueltig('CH44 3199 9123 0008 8901 2'));
check('KRITISCH: und wird als QR-IBAN erkannt (IID 31999)',
    iban_ist_qr('CH44 3199 9123 0008 8901 2'));
check('Knapp ausserhalb des Bereichs (32000) ist keine QR-IBAN mehr',
    !iban_ist_qr('CH44 3200 0123 0008 8901 2'));

// ── QRR-Pruefziffer (Modulo 10 rekursiv) ──────────────────────────────────
// 210000000003139471430009017 -- unabhaengig veroeffentlichtes, vollstaendiges
// Beispiel einer gueltigen QRR-Referenz (26-stellige Basis + Pruefziffer).
check('KRITISCH: die Pruefziffer des veroeffentlichten QRR-Beispiels stimmt',
    qrr_pruefziffer('21000000000313947143000901') === 7);
check('Alle Nullen ergeben Pruefziffer 0 (Fixpunkt der Tabelle)',
    qrr_pruefziffer(str_repeat('0', 26)) === 0);

$refA = qrr_referenz('RE0950');
check('KRITISCH: qrr_referenz() liefert 27 Ziffern', strlen($refA) === 27 && ctype_digit($refA));
check('KRITISCH: die Rechnungsnummer steckt rechtsbuendig in der Basis',
    substr($refA, 22, 4) === '0950');
check('KRITISCH: die eigene Pruefziffer stimmt mit der separat gerechneten ueberein',
    (int)substr($refA, 26, 1) === qrr_pruefziffer(substr($refA, 0, 26)));
check('Dieselbe Rechnungsnummer ergibt immer dieselbe Referenz (keine versteckte Zufallskomponente)',
    qrr_referenz('RE0950') === $refA);
check('Verschiedene Rechnungsnummern ergeben verschiedene Referenzen',
    qrr_referenz('RE0951') !== $refA);

// ── SPC-Zahlungsteil ──────────────────────────────────────────────────────
$betrieb = ['firma' => 'Cupi 24 GmbH', 'qr_iban' => 'CH44 3199 9123 0008 8901 2',
    'qr_strasse' => 'Baslerstrasse', 'qr_hausnummer' => '67', 'qr_plz' => '4632', 'qr_ort' => 'Trimbach'];
$zeilen = qr_spc_zeilen($betrieb, 48.65, 'RE0962', null);

check('KRITISCH: der SPC-Zahlungsteil hat genau 31 Zeilen (SIX-Vorgabe)', count($zeilen) === 31);
check('KRITISCH: Kopf ist SPC/0200/1', array_slice($zeilen, 0, 3) === ['SPC', '0200', '1']);
check('KRITISCH: Zeile 4 ist die (leerzeichenfreie) IBAN', $zeilen[3] === 'CH4431999123000889012');
check('KRITISCH: Betrag mit Punkt und zwei Nachkommastellen', $zeilen[18] === '48.65');
check('Waehrung ist CHF', $zeilen[19] === 'CHF');
check('KRITISCH: Referenztyp QRR', $zeilen[27] === 'QRR');
check('KRITISCH: die Referenz in Zeile 29 ist dieselbe wie qrr_referenz() liefert',
    $zeilen[28] === qrr_referenz('RE0962'));
check('KRITISCH: letzte Zeile ist der Trailer EPD', end($zeilen) === 'EPD');
check('Ohne bekannten Debitor bleibt dessen Adresstyp leer, nicht "S"', $zeilen[20] === '');

$mitDebitor = qr_spc_zeilen($betrieb, 48.65, 'RE0962',
    ['name' => 'abc consulting gmbh', 'strasse' => 'Hochgasse', 'hausnummer' => '7', 'plz' => '4632', 'ort' => 'Trimbach']);
check('KRITISCH: mit bekanntem Debitor steht "S" als Adresstyp', $mitDebitor[20] === 'S');
check('Und der Name des Debitors an der richtigen Stelle', $mitDebitor[21] === 'abc consulting gmbh');

// ── ZWEITE REFERENZART: normale IBAN (ENT-616) ────────────────────────────
//
// Eine QR-IBAN verlangt QRR, eine normale IBAN VERBIETET sie. Wer beides
// gleich behandelt, erzeugt einen Code, den die Bank zurueckweist -- und das
// merkt man erst, wenn eine Zahlung nicht ankommt. Darum gerechnet, nicht
// nachgelesen.
//
// Die IBAN unten ist das ueberall veroeffentlichte ISO-Beispiel, keine
// echte Bankverbindung.
$normal = ['firma' => 'Muster GmbH', 'qr_iban' => 'CH93 0076 2011 6238 5295 7',
    'qr_strasse' => 'Musterweg', 'qr_hausnummer' => '1', 'qr_plz' => '9999', 'qr_ort' => 'Musterhausen'];
$zn = qr_spc_zeilen($normal, 48.65, 'RE0962', null);

check('KRITISCH: auch mit normaler IBAN sind es genau 31 Zeilen', count($zn) === 31);
check('KRITISCH: normale IBAN traegt NON, nicht QRR', $zn[27] === 'NON');
check('KRITISCH: und dann KEINE Referenz -- eine QR-Referenz waere hier unzulaessig',
    $zn[28] === '');
check('KRITISCH: die Rechnungsnummer steht stattdessen in der Mitteilung',
    strpos($zn[29], 'RE0962') !== false);
check('Der Trailer bleibt EPD', end($zn) === 'EPD');
check('KRITISCH: die QR-IBAN bleibt unberuehrt bei QRR',
    qr_spc_zeilen($betrieb, 1.0, 'RE0001', null)[27] === 'QRR');

check('KRITISCH: eine QR-IBAN wird als solche erkannt, eine normale nicht',
    iban_ist_qr('CH44 3199 9123 0008 8901 2') && !iban_ist_qr('CH93 0076 2011 6238 5295 7'));

// qr_referenzteil() liefert immer drei Felder -- sonst verschoebe sich der
// Rest des Codes um eine Zeile, und der Trailer stuende an falscher Stelle.
check('Der Referenzteil hat beide Male drei Felder',
    count(qr_referenzteil('CH44 3199 9123 0008 8901 2', 'RE1')) === 3
    && count(qr_referenzteil('CH93 0076 2011 6238 5295 7', 'RE1')) === 3);
check('Die Mitteilung bleibt innerhalb der 140 Zeichen des Standards',
    mb_strlen(qr_referenzteil('CH93 0076 2011 6238 5295 7', str_repeat('X', 400))[2]) <= 140);

// ── Wann ist ein Zahlteil ueberhaupt moeglich ─────────────────────────────
//
// EINE Stelle beantwortet das, sonst geben Cockpit und Betreiber-Bereich
// zwei verschiedene Antworten auf dieselbe Frage.
check('KRITISCH: mit gueltiger IBAN und vollstaendiger Adresse ist er moeglich',
    qr_zahlteil_moeglich($betrieb) && qr_zahlteil_moeglich($normal));
check('KRITISCH: ohne IBAN nicht',
    !qr_zahlteil_moeglich(['qr_iban' => ''] + $normal));
check('KRITISCH: mit unbrauchbarer IBAN nicht -- ein Code, den die Bank abweist, ist schlimmer als keiner',
    !qr_zahlteil_moeglich(['qr_iban' => 'CH93 0076 2011 6238 5295 8'] + $normal));
check('KRITISCH: ohne Strasse nicht', !qr_zahlteil_moeglich(['qr_strasse' => ''] + $normal));
check('KRITISCH: ohne PLZ nicht',     !qr_zahlteil_moeglich(['qr_plz' => ''] + $normal));
check('KRITISCH: ohne Ort nicht',     !qr_zahlteil_moeglich(['qr_ort' => ''] + $normal));
check('Eine Hausnummer ist nicht Pflicht -- es gibt Adressen ohne',
    qr_zahlteil_moeglich(['qr_hausnummer' => ''] + $normal));
check('Eine auslaendische IBAN taugt nicht fuer einen Schweizer Zahlteil',
    !qr_zahlteil_moeglich(['qr_iban' => 'DE89 3704 0044 0532 0130 00'] + $normal));

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
