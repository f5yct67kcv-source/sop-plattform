<?php
declare(strict_types=1);
// Echte Ausfuehrung der Sitzungs-Ablaufregel (ENT-075, verschaerft in ENT-293).
//
// Bis ENT-075 lief eine Sitzung nie ab. Diese Pruefung stellt sicher, dass
// beide Grenzen wirklich greifen -- das absolute Alter UND die Untaetigkeit --
// und seit ENT-293, dass die kurze Bueroschutzfrist die Richtigen trifft:
// den Bildschirm mit der Personalakte, nicht das Handy im Nachtdienst.
//
// db.php laesst sich nicht einbinden (es baut beim Laden nichts auf, aber
// der Fehlerbehandler und json_response gehoeren zu einer Anfrage). Darum
// werden Konstanten und Funktionen aus der Datei gelesen und ausgefuehrt --
// so wird der ECHTE Text geprueft und keine Kopie davon.
$quelle = file_get_contents(__DIR__ . '/../backend/db.php');
preg_match_all('/^const (SITZUNG_\w+)\s*=\s*(\d+);/m', $quelle, $k, PREG_SET_ORDER);
foreach ($k as $c) { define($c[1], (int)$c[2]); }
preg_match('/^const SITZUNG_RECHTE_IM_FELD\s*=\s*\[[^\]]*\];/m', $quelle, $l);
eval($l[0]);
preg_match('/function sitzung_buero.*?\n\}/s', $quelle, $b);
eval($b[0]);
preg_match('/function sitzung_abgelaufen.*?\n\}/s', $quelle, $f);
eval($f[0]);
// Der Stempel wird nicht bei jedem Aufruf geschrieben, sondern erst nach
// dieser Ruhezeit. Eine Untaetigkeitsfrist, die nicht deutlich groesser ist,
// misst Rauschen statt Untaetigkeit -- darum wird die Zahl mitgelesen.
preg_match('/\$jetzt - \$gesehen > (\d+)/', $quelle, $st);
$stempelAbstand = (int)($st[1] ?? 0);

$ok = 0; $bad = [];
function pruef(string $name, bool $c) { global $ok, $bad; if ($c) { $ok++; } else { $bad[] = $name; } }

$jetzt = 1_800_000_000;
$T = 86400; $H = 3600; $M = 60;
// tot(rechte, alterTage, ruheTage)
$tot = fn(array $r, float $alter, float $ruhe) => sitzung_abgelaufen(
    $r, (int)round($jetzt - $alter * $T), (int)round($jetzt - $ruhe * $T), $jetzt);

// Rechte, wie sie in rechte.php wirklich vorkommen.
$feld  = ['rundgang_einsehen'];                    // Waechter im Revierdienst
$buero = ['personal_lesen'];                       // Planung/Personal/Verwaltung
$beides = ['rundgang_einsehen', 'personal_lesen']; // Waechter MIT Planungsrolle

pruef('Es gibt ueberhaupt Fristen', defined('SITZUNG_MAX_TAGE') && SITZUNG_MAX_TAGE > 0);
pruef('KRITISCH: wer Rechte hat, hat kuerzere Fristen als wer keine hat',
    SITZUNG_ADMIN_MAX_TAGE < SITZUNG_MAX_TAGE
    && SITZUNG_FELD_RUHE_STD * $H < SITZUNG_RUHE_TAGE * $T);
pruef('KRITISCH: der Bueroarbeitsplatz ist strenger als das Feld',
    SITZUNG_BUERO_RUHE_MIN * $M < SITZUNG_FELD_RUHE_STD * $H);

// ── Wen trifft die kurze Frist? ──────────────────────────────────────
pruef('Ohne Rechte gilt sie nicht -- das ist die App', !sitzung_buero([]));
pruef('KRITISCH: reine Feldrechte loesen sie NICHT aus -- sonst steht der Waechter nachts vor der Anmeldemaske',
    !sitzung_buero($feld) && !sitzung_buero(SITZUNG_RECHTE_IM_FELD));
pruef('KRITISCH: wer fremde Personendaten sehen darf, faellt darunter', sitzung_buero($buero));
pruef('KRITISCH: Feldrecht PLUS Buerorecht ergibt die kurze Frist, nicht die lange',
    sitzung_buero($beides));
pruef('KRITISCH: ein neu erfundenes Recht faellt von selbst unter die kurze Frist',
    sitzung_buero(['irgendein_kuenftiges_recht']));

// ── Ohne Rechte (App): unveraendert lange Fristen ────────────────────
pruef('Frische Sitzung lebt', !$tot([], 0, 0));
pruef('Nach einem Tag lebt sie noch', !$tot([], 1, 1));
pruef('Kurz vor der absoluten Frist lebt sie', !$tot([], SITZUNG_MAX_TAGE - 0.5, 0));
pruef('KRITISCH: nach der absoluten Frist ist sie tot -- auch bei taeglicher Nutzung',
    $tot([], SITZUNG_MAX_TAGE + 0.5, 0));
pruef('Kurz vor der Untaetigkeitsfrist lebt sie', !$tot([], 0, SITZUNG_RUHE_TAGE - 0.5));
pruef('KRITISCH: nach zu langer Untaetigkeit ist sie tot -- auch wenn sie jung ist',
    $tot([], 0, SITZUNG_RUHE_TAGE + 0.5));

// ── Feldrechte: absolute Frist wie bisher, Untaetigkeit in Stunden ───
pruef('Feld-Sitzung lebt frisch', !$tot($feld, 0, 0));
pruef('KRITISCH: Feld-Sitzung stirbt nach ' . SITZUNG_ADMIN_MAX_TAGE . ' Tagen',
    $tot($feld, SITZUNG_ADMIN_MAX_TAGE + 0.5, 0));
pruef('KRITISCH: ein ganzer Nachtdienst laeuft dem Waechter nicht davon',
    !$tot($feld, 0, 8 / 24));
pruef('KRITISCH: Feld-Sitzung stirbt nach ' . SITZUNG_FELD_RUHE_STD . ' Stunden Untaetigkeit',
    $tot($feld, 0, (SITZUNG_FELD_RUHE_STD + 1) / 24));

// ── Bueroarbeitsplatz: Minuten statt Stunden ─────────────────────────
pruef('Buero-Sitzung lebt frisch', !$tot($buero, 0, 0));
pruef('Kurz vor der Frist lebt sie noch',
    !$tot($buero, 0, (SITZUNG_BUERO_RUHE_MIN - 1) / 1440));
pruef('KRITISCH: Buero-Sitzung stirbt nach ' . SITZUNG_BUERO_RUHE_MIN . ' Minuten Untaetigkeit',
    $tot($buero, 0, (SITZUNG_BUERO_RUHE_MIN + 1) / 1440));
pruef('KRITISCH: was im Feld noch lebt, ist am Buerobildschirm tot',
    !$tot($feld, 0, 2 / 24) && $tot($buero, 0, 2 / 24));
pruef('KRITISCH: die absolute Frist gilt auch am Buerobildschirm',
    $tot($buero, SITZUNG_ADMIN_MAX_TAGE + 0.5, 0));

// ── Die Grenzen sind alltagstauglich, nicht nur sicher ───────────────
pruef('Mitarbeitende muessen sich nicht taeglich neu anmelden', SITZUNG_RUHE_TAGE >= 7);
// Die alte Aussage hiess "ein Arbeitstag laeuft der Verwaltung nicht davon"
// (>= 8 Stunden). Sie ist mit ENT-293 bewusst aufgehoben worden -- ersetzt,
// nicht geloescht: Was sie schuetzte, war eine unbrauchbar kurze Frist.
// Diese Untergrenze bleibt, sie liegt nur tiefer.
pruef('KRITISCH: die Bueroschutzfrist ist nicht unbrauchbar kurz gesetzt',
    SITZUNG_BUERO_RUHE_MIN >= 15);
pruef('KRITISCH: der Nutzungsstempel ist deutlich feiner als die kuerzeste Frist -- sonst misst sie Rauschen',
    $stempelAbstand > 0 && SITZUNG_BUERO_RUHE_MIN * $M >= $stempelAbstand * 3);

// ── Der Browser muss dieselbe Frist kennen wie der Server ────────────
// Die Vorwarnung in dashboard.html rechnet mit eigenen Zahlen. Laufen sie
// auseinander, warnt sie vor einer Abmeldung, die nicht kommt -- oder sie
// schweigt vor einer, die kommt. Beides ist schlimmer als keine Warnung.
$dash = file_get_contents(__DIR__ . '/../dashboard.html');
preg_match('/const UT_FRIST_MS\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/', $dash, $u);
$browserMin = $u ? (int)$u[1] : 0;
pruef('Die Frist der Oberflaeche ist ueberhaupt auffindbar', $browserMin > 0);
pruef('KRITISCH: Oberflaeche und Server rechnen mit derselben Frist',
    $browserMin === SITZUNG_BUERO_RUHE_MIN);

preg_match('/const UT_WARNUNG_MS\s*=\s*(\d+)\s*\*\s*(\d+)/', $dash, $w);
$warnSek = $w ? (int)$w[1] : 0;
pruef('KRITISCH: gewarnt wird VOR dem Ablauf, nicht danach',
    $warnSek > 0 && $warnSek < SITZUNG_BUERO_RUHE_MIN * $M);

// Dieselbe Feldrechte-Liste auf beiden Seiten -- sonst wirft die
// Oberflaeche den Waechter hinaus, den der Server weiterlaufen laesst.
preg_match('/const UT_RECHTE_IM_FELD\s*=\s*\[([^\]]*)\]/', $dash, $r);
preg_match_all("/'([a-z_]+)'/", $r[1] ?? '', $rr);
$browserFeld = $rr[1] ?? [];
pruef('Die Feldrechte der Oberflaeche sind auffindbar', $browserFeld !== []);
pruef('KRITISCH: Oberflaeche und Server kennen dieselben Feldrechte',
    $browserFeld === SITZUNG_RECHTE_IM_FELD);

echo count($bad) === 0 ? "$ok Pruefungen bestanden\n" : '';
foreach ($bad as $b) { echo "X $b\n"; }
exit(count($bad) === 0 ? 0 : 1);
