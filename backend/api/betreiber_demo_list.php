<?php
// Die Demo-Zugänge und die Belegung des Vorrats (ENT-600).
//
// Liefert bewusst KEINE Daten aus den Demo-Instanzen selbst -- der
// Betreiber-Bereich sieht, WER einen Zugang hat und wie lange, nicht was
// dieser jemand darin erfasst hat. Dieselbe Grenze wie bei den Mandanten
// (betreiber_mandant_list.php).
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'demo_zugang')) {
    // "Nicht eingerichtet" ist etwas anderes als "keine Zugänge" (Hausregel).
    json_response(['status' => 'error',
        'message' => 'Das Register der Demo-Zugänge ist noch nicht eingerichtet.'], 503);
}

$jetzt = date('Y-m-d H:i:s');

// Der Vermerk „nachgefasst" (ENT-622) kam nach der Tabelle. Steht die
// Spalte auf dieser Anlage noch nicht, wird sie nicht abgefragt -- sonst
// faellt die ganze Liste aus, weil EIN Feld fehlt. Nachgetragen wird sie
// vom Zahnrad (be_spalten_anlegen()); bis dahin sagt die Oberflaeche „noch
// nicht nachgeruestet" statt „noch nie nachgefasst". Das sind zwei
// verschiedene Aussagen (Hausregel).
$kenntNachfassen = hat_spalte($pdo, 'demo_zugang', 'nachgefasst_am');
// Dasselbe fuer den Weg zurueck (ENT-628). Steht die Spalte noch nicht,
// sagt die Oberflaeche nichts ueber Weitermachen -- und nicht "niemand
// will weitermachen". Das sind zwei verschiedene Aussagen.
$kenntWeiter = hat_spalte($pdo, 'demo_zugang', 'weiter_am')
    && hat_spalte($pdo, 'demo_zugang', 'weiter_groesse');
$felder = 'id, platz, firma, person, email, telefon, login, status,
           freigegeben_am, freigegeben_von, laeuft_ab_am, beendet_am'
        . ($kenntNachfassen ? ', nachgefasst_am, nachgefasst_von' : '')
        . ($kenntWeiter ? ', weiter_am, weiter_groesse' : '');

$zeilen = $pdo->query("SELECT $felder FROM demo_zugang ORDER BY id DESC")
              ->fetchAll(PDO::FETCH_ASSOC);

$liste = array_map(static function (array $z) use ($jetzt, $kenntNachfassen, $kenntWeiter): array {
    $z['id'] = (int)$z['id'];
    // Drei Zustaende, nicht zwei: nachgefasst, noch nicht nachgefasst, und
    // „wir koennen es nicht wissen" (Spalte fehlt). Der dritte wird nicht
    // als der zweite ausgegeben.
    $z['nachgefasst_am']  = $kenntNachfassen ? ($z['nachgefasst_am'] ?? null) : null;
    $z['nachgefasst_von'] = $kenntNachfassen ? (string)($z['nachgefasst_von'] ?? '') : '';
    // Drei Zustaende, wieder: hat geklickt (mit Datum), hat nicht geklickt
    // (null) und "koennen wir nicht wissen" (Spalte fehlt, dann ebenfalls
    // null -- unterschieden wird es an kennt_weiter in der Antwort).
    $z['weiter_am'] = $kenntWeiter ? ($z['weiter_am'] ?? null) : null;
    // Der Text der Groessenklasse kommt vom Server: Welche Klassen es gibt,
    // steht in DEMO_GROESSE_KLASSEN und nicht zweimal.
    $z['weiter_groesse'] = $kenntWeiter ? (string)($z['weiter_groesse'] ?? '') : '';
    $z['weiter_groesse_text'] = ($z['weiter_groesse'] === '')
        ? '' : demo_groesse_text((string)$z['weiter_groesse']);
    // Der Zustand wird HIER benannt und nicht in der Oberfläche gerechnet:
    // Ein Zugang, dessen Frist um ist, den der Zeitgeber aber noch nicht
    // angefasst hat, steht in der Datenbank auf "aktiv" und ist trotzdem
    // keiner. Wer das in der Oberfläche rechnet, rechnet es beim nächsten
    // Bildschirm wieder -- oder eben nicht.
    $z['abgelaufen'] = $z['status'] === 'aktiv'
        && demo_zugang_abgelaufen((string)$z['laeuft_ab_am'], $jetzt);
    $z['resttage']   = $z['status'] === 'aktiv'
        ? demo_zugang_resttage((string)$z['laeuft_ab_am'], $jetzt) : null;
    $z['adresse']    = demo_platz_adresse((string)$z['platz']);
    return $z;
}, $zeilen);

// Belegung des Vorrats. Ein Platz gilt als belegt, solange ein Zugang
// darauf im Register aktiv ist -- auch wenn dessen Frist schon um ist:
// Bis der Zeitgeber die Instanz geleert hat, liegen dort noch die Daten
// des Vorgängers, und ein zweiter Interessent hätte sie vor Augen.
$belegt = array_values(array_unique(array_map(
    static fn (array $z): string => (string)$z['platz'],
    array_filter($liste, static fn (array $z): bool => $z['status'] === 'aktiv')
)));

$plaetze = array_map(static function (string $platz) use ($belegt, $liste): array {
    $drauf = null;
    foreach ($liste as $z) {
        if ($z['platz'] === $platz && $z['status'] === 'aktiv') { $drauf = $z; break; }
    }
    return [
        'platz'   => $platz,
        'adresse' => demo_platz_adresse($platz),
        'frei'    => !in_array($platz, $belegt, true),
        'firma'   => $drauf['firma'] ?? null,
        'laeuft_ab_am' => $drauf['laeuft_ab_am'] ?? null,
    ];
}, DEMO_PLAETZE);

json_response([
    'status'   => 'ok',
    'zugaenge' => $liste,
    'plaetze'  => $plaetze,
    // Vier Aussagen, vier Zahlen -- "Plätze" zählt Instanzen, "Zugänge"
    // zählt Interessenten. Einheiten werden nicht vermischt (Hausregel).
    'plaetze_frei'  => count(array_filter($plaetze, static fn (array $p): bool => $p['frei'])),
    'plaetze_total' => count(DEMO_PLAETZE),
    'aktive'        => count(array_filter($liste, static fn (array $z): bool => $z['status'] === 'aktiv')),
    'laufzeit_tage' => DEMO_ZUGANG_TAGE,
    // Sagt der Oberflaeche, ob die Frage ueberhaupt beantwortbar ist --
    // ohne die Spalte gibt es kein Abzeichen und keinen Knopf, statt eines
    // Abzeichens, das immer null zeigt.
    'kennt_nachfassen' => $kenntNachfassen,
    // Wie kennt_nachfassen: Sagt der Oberflaeche, ob die Frage ueberhaupt
    // beantwortbar ist (ENT-628).
    'kennt_weiter' => $kenntWeiter,
    // Die Zahl fuer die Uebersicht: Wie viele Interessenten nach dem Ablauf
    // gesagt haben, dass es weitergehen soll.
    'weiter_offen' => $kenntWeiter
        ? count(array_filter($liste, static fn (array $z): bool => $z['weiter_am'] !== null))
        : 0,
    // Die Zahl fuer das Abzeichen am Reiter. Sie zaehlt Interessenten, bei
    // denen noch niemand nachgefasst hat -- laufende UND beendete: Wer sich
    // den Zugang geholt hat und nie angesprochen wurde, bleibt eine
    // verpasste Gelegenheit, auch wenn die vierzehn Tage um sind.
    'nachfassen_offen' => $kenntNachfassen
        ? count(array_filter($liste, static fn (array $z): bool => $z['nachgefasst_am'] === null))
        : 0,
]);
