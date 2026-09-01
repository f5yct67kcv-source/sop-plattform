<?php
declare(strict_types=1);
// Echte Ausfuehrung des TOTP-Rechenkerns (ENT-076).
//
// DAS WICHTIGE AN DIESER PRUEFUNG: Sie vergleicht nicht mit sich selbst,
// sondern mit den TESTVEKTOREN AUS DEM STANDARD (RFC 6238, Anhang B). Eine
// selbstgebaute Berechnung, die gegen sich selbst geprueft wird, ist immer
// gruen -- auch wenn kein Authenticator der Welt sie versteht.
require __DIR__ . '/../backend/zweifaktor.php';

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// ── Base32 gegen RFC 4648, Anhang
foreach ([['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'],
          ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']] as [$roh, $soll]) {
    pruef("Base32 von '$roh' ist '$soll'", zf_base32_kodieren($roh) === $soll);
}
pruef('Base32 rueckwaerts ergibt wieder den Ausgangswert',
    zf_base32_dekodieren(zf_base32_kodieren('foobar')) === 'foobar');
pruef('Ein ungueltiges Zeichen ergibt nichts statt Unsinn',
    zf_base32_dekodieren('MZXW6YTB!!') === '');

// ── TOTP gegen RFC 6238, Anhang B (SHA-1, Geheimnis "12345678901234567890")
$geheim = zf_base32_kodieren('12345678901234567890');
$vektoren = [
    [59,          '287082'],
    [1111111109,  '081804'],
    [1111111111,  '050471'],
    [1234567890,  '005924'],
    [2000000000,  '279037'],
    [20000000000, '353130'],
];
foreach ($vektoren as [$zeit, $soll]) {
    $ist = zf_code($geheim, intdiv($zeit, ZF_FENSTER));
    pruef("KRITISCH: Standard-Testvektor bei $zeit ergibt $soll", $ist === $soll);
}

// ── Die Pruefung selbst
$jetzt = 1_800_000_000;
$fenster = intdiv($jetzt, ZF_FENSTER);
$aktuell = zf_code($geheim, $fenster);
pruef('Der aktuelle Code wird angenommen', zf_pruefen($geheim, $aktuell, $jetzt) === $fenster);
pruef('Der Code des vorigen Fensters wird noch angenommen -- Uhren gehen ungenau',
    zf_pruefen($geheim, zf_code($geheim, $fenster - 1), $jetzt) === $fenster - 1);
pruef('KRITISCH: ein zu alter Code wird abgewiesen',
    zf_pruefen($geheim, zf_code($geheim, $fenster - 5), $jetzt) === null);
pruef('KRITISCH: ein falscher Code wird abgewiesen',
    zf_pruefen($geheim, '000000', $jetzt) === null || $aktuell === '000000');
pruef('KRITISCH: ein zu kurzer Code wird abgewiesen',
    zf_pruefen($geheim, '12345', $jetzt) === null);
pruef('Leerzeichen und Bindestriche stoeren nicht',
    zf_pruefen($geheim, substr($aktuell, 0, 3) . ' ' . substr($aktuell, 3), $jetzt) === $fenster);
pruef('KRITISCH: die Toleranz ist eng -- hoechstens ein Fenster in jede Richtung',
    ZF_TOLERANZ <= 1);

// ── Geheimnis und Adresse
$g = zf_geheimnis_erzeugen();
pruef('Das Geheimnis ist lang genug (160 Bit)', strlen($g) === 32);
pruef('Zwei Geheimnisse sind nicht gleich', zf_geheimnis_erzeugen() !== zf_geheimnis_erzeugen());
pruef('Das Geheimnis besteht nur aus Base32-Zeichen', strspn($g, ZF_B32) === strlen($g));
$adr = zf_adresse('hansmuster', $g);
pruef('Die Adresse fuer die App hat die richtige Form',
    str_starts_with($adr, 'otpauth://totp/') && str_contains($adr, 'secret=' . $g)
    && str_contains($adr, 'digits=6') && str_contains($adr, 'period=30'));
pruef('Der Betriebsname steht darin -- sonst steht im Handy nur ein Login-Name',
    str_contains($adr, 'issuer=CUPI%2024'));
pruef('Zum Abtippen in Vierergruppen', zf_lesbar('ABCDEFGH') === 'ABCD EFGH');

// ── Notfallcodes
$codes = [];
for ($i = 0; $i < 200; $i++) { $codes[] = zf_notfallcode(); }
pruef('Notfallcodes haben die Form abcd-efgh',
    count(array_filter($codes, fn($c) => (bool)preg_match('/^[a-z2-9]{4}-[a-z2-9]{4}$/', $c))) === 200);
pruef('KRITISCH: sie wiederholen sich nicht', count(array_unique($codes)) === 200);
pruef('Keine verwechselbaren Zeichen (0/O, 1/l/I)',
    !preg_match('/[01ilo]/', implode('', $codes)));
pruef('Es gibt genug davon', ZF_NOTFALLCODES >= 8);
pruef('Abgetippt ohne Bindestrich und in Grossbuchstaben wird trotzdem erkannt',
    zf_code_normalisieren('ABCD EFGH') === 'abcd-efgh'
    && zf_code_normalisieren('abcdefgh') === 'abcd-efgh');

// ── Die Entscheidung des Projektinhabers
pruef('Ein Geraet wird 14 Tage gemerkt, wie entschieden', ZF_GERAET_TAGE === 14);

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
