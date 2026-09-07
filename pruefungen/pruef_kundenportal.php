<?php
declare(strict_types=1);
// Echte Ausfuehrung der Kundenportal-Regeln (ENT-441).
//
// Geprueft wird die AUSSAGE, nicht der Wortlaut: Ob eine Sitzung ablaeuft,
// ob ein Code noch gilt, ob ein Code sechsstellig ist. Wuerde man statt
// dessen nachsehen, ob ein Wort im Quelltext steht, bliebe die Pruefung
// gruen, sobald jemand die Formulierung aendert und die Sache verschwindet.
//
// kundenportal.php laesst sich nicht einbinden: require_kundensession()
// braucht db() und json_response(), die zu einer echten Anfrage gehoeren.
// Darum werden Konstanten und die REINEN Funktionen aus der Datei gelesen
// und ausgefuehrt -- so laeuft der echte Text und keine Kopie davon.
// Genau dafuer stehen diese Regeln dort ohne Datenbankzugriff.
$quelle = file_get_contents(__DIR__ . '/../backend/kundenportal.php');

preg_match_all('/^const (KP_\w+)\s*=\s*(\d+);/m', $quelle, $k, PREG_SET_ORDER);
foreach ($k as $c) { define($c[1], (int)$c[2]); }

foreach (['kp_sitzung_abgelaufen', 'kp_code_zustand', 'kp_code_erzeugen', 'kp_email_normal'] as $fn) {
    if (!preg_match('/function ' . $fn . '\(.*?\n\}/s', $quelle, $m)) {
        echo "- Funktion $fn nicht gefunden\n";
        exit(1);
    }
    eval($m[0]);
}

$ok = 0; $bad = [];
function pruef(string $name, bool $c): void { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

// ── Die Konstanten muessen ueberhaupt da sein ─────────────────────────
// Ohne sie liefe alles Weitere gegen undefinierte Werte und waere gruen,
// ohne etwas zu bedeuten.
foreach (['KP_CODE_MINUTEN', 'KP_CODE_VERSUCHE', 'KP_CODE_PRO_STUNDE',
          'KP_SITZUNG_MAX_TAGE', 'KP_SITZUNG_RUHE_TAGE'] as $c) {
    pruef("Konstante $c ist gesetzt", defined($c));
}

// ── Sitzungsablauf ────────────────────────────────────────────────────
$jetzt = 1_800_000_000;
$T = 86400;
// tot(alterTage, ruheTage)
$tot = fn(float $alter, float $ruhe): bool => kp_sitzung_abgelaufen(
    (int)round($jetzt - $alter * $T), (int)round($jetzt - $ruhe * $T), $jetzt);

pruef('Eine frische Sitzung lebt', !$tot(0, 0));
pruef('Kurz vor beiden Grenzen lebt sie noch',
    !$tot(KP_SITZUNG_MAX_TAGE - 1, KP_SITZUNG_RUHE_TAGE - 1));
pruef('KRITISCH: zu alt laeuft ab, auch wenn eben noch genutzt',
    $tot(KP_SITZUNG_MAX_TAGE + 1, 0));
pruef('KRITISCH: zu lange ungenutzt laeuft ab, auch wenn frisch angelegt',
    $tot(0.1, KP_SITZUNG_RUHE_TAGE + 1));
// Eine Sitzung, die nie ablaeuft, waere ein Dauerzugang fuer einen
// Betriebsfremden. Beide Grenzen muessen wirken, nicht nur eine.
pruef('KRITISCH: es gibt ueberhaupt eine absolute Grenze', KP_SITZUNG_MAX_TAGE > 0);
pruef('KRITISCH: es gibt ueberhaupt eine Ruhegrenze', KP_SITZUNG_RUHE_TAGE > 0);
pruef('Die Ruhegrenze ist nicht groesser als die absolute Grenze',
    KP_SITZUNG_RUHE_TAGE <= KP_SITZUNG_MAX_TAGE);

// ── Einmal-Code ───────────────────────────────────────────────────────
$frisch = $jetzt + 600;   // gueltig_bis liegt in der Zukunft
$alt    = $jetzt - 60;    // gueltig_bis liegt in der Vergangenheit

pruef('Ein frischer, unbenutzter Code ist offen',
    kp_code_zustand(null, $frisch, 0, $jetzt) === 'offen');
pruef('KRITISCH: ein eingeloester Code gilt nicht mehr',
    kp_code_zustand($jetzt - 5, $frisch, 0, $jetzt) === 'verbraucht');
pruef('KRITISCH: ein eingeloester Code gilt auch dann nicht, wenn er noch frisch ist',
    kp_code_zustand($jetzt, $frisch, 0, $jetzt) !== 'offen');
pruef('KRITISCH: nach zu vielen Fehlversuchen ist der Code tot',
    kp_code_zustand(null, $frisch, KP_CODE_VERSUCHE, $jetzt) === 'zu_viele');
pruef('Ein Versuch unter der Grenze laesst den Code offen',
    kp_code_zustand(null, $frisch, KP_CODE_VERSUCHE - 1, $jetzt) === 'offen');
pruef('KRITISCH: ein abgelaufener Code gilt nicht mehr',
    kp_code_zustand(null, $alt, 0, $jetzt) === 'abgelaufen');
// Sechs Stellen sind eine Million Moeglichkeiten. Ohne wirksame Begrenzung
// waeren sie durchprobiert, bevor der Code ablaeuft.
pruef('KRITISCH: die Fehlversuche sind eng begrenzt',
    KP_CODE_VERSUCHE > 0 && KP_CODE_VERSUCHE <= 10);
pruef('KRITISCH: der Code lebt nicht laenger als eine Stunde',
    KP_CODE_MINUTEN > 0 && KP_CODE_MINUTEN <= 60);

// ── Codeerzeugung ─────────────────────────────────────────────────────
// Fuehrende Nullen sind der Fallstrick: Als Zahl gefuehrt waere "042315"
// zu 42315 geworden -- fuenf Stellen, und der Vergleich schluege fehl.
$laengen = []; $mitNull = 0; $verschieden = [];
for ($i = 0; $i < 3000; $i++) {
    $c = kp_code_erzeugen();
    $laengen[strlen($c)] = true;
    if ($c[0] === '0') { $mitNull++; }
    $verschieden[$c] = true;
}
pruef('KRITISCH: jeder Code hat genau sechs Stellen', array_keys($laengen) === [6]);
pruef('KRITISCH: Codes mit fuehrender Null entstehen und bleiben sechsstellig', $mitNull > 0);
// Ein Zufall, der sich wiederholt, ist keiner. Bei 3000 Ziehungen aus einer
// Million sind Doubletten selten -- deutlich weniger als die Haelfte waere
// ein Zeichen fuer einen kaputten Generator.
pruef('Die Codes sind nicht vorhersagbar gleich', count($verschieden) > 2900);

// ── E-Mail-Normalisierung ─────────────────────────────────────────────
// Ohne sie meldet sich niemand an, der seine Adresse gross tippt -- und der
// Fehler saehe aus wie "diesen Zugang gibt es nicht".
pruef('KRITISCH: Grossschreibung verhindert die Anmeldung nicht',
    kp_email_normal('Name@Beispiel.CH') === 'name@beispiel.ch');
pruef('Leerzeichen aus der Zwischenablage stoeren nicht',
    kp_email_normal('  name@beispiel.ch  ') === 'name@beispiel.ch');

foreach ($bad as $b) { echo "- $b\n"; }
echo "geprueft: $ok, beanstandet: " . count($bad) . "\n";
exit($bad ? 1 : 0);
