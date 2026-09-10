<?php
// Kundenportal: die Rundgaenge des angemeldeten Kunden (ENT-441).
//
// GET ?von=YYYY-MM-DD&bis=YYYY-MM-DD -> { status, kunde, objekte, zeitraum,
//                                         rundgaenge, leer_grund }
//
// DIE kunde_id KOMMT AUS DER SITZUNG, NIE AUS DER ANFRAGE. Dieser Endpunkt
// nimmt keinen Kunden-, Objekt- oder Zugangsschluessel entgegen; wer etwas
// derartiges mitschickt, aendert damit nichts. Ein Portal-Endpunkt, der
// eine kunde_id laese, waere derselbe Fehler wie ein Zwei-Faktor-Endpunkt,
// der die Person aus der Anfrage nimmt.
//
// NUR ABGESCHLOSSENE RUNDEN (ENT-441 Punkt 5). Was noch laeuft, ist nicht
// sichtbar -- ein Kunde soll den Nachweis sehen, nicht die Person bei der
// Arbeit. Ein ABGEBROCHENER Rundgang erscheint dagegen sehr wohl: Er ist
// beendet, und eine Nichterfuellung zu verschweigen waere das Gegenteil
// eines Nachweises. Ob der Grund dazu sichtbar ist, entscheidet spaeter ein
// Schalter (OP-423).
//
// KEINE PERSONENNAMEN IN DIESER LISTE. Sie beantwortet die Frage "hat die
// Runde stattgefunden", und dafuer braucht es keinen Namen. Was auf der
// Detailseite steht, entscheidet OP-423.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../kundenportal.php';
require_once __DIR__ . '/../rundgang.php';

$zugang = require_kundensession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

// Ohne Zeitraum der laufende Monat. Anders als bei rundgang_liste.php
// (dort: heute) -- ein Kunde sucht nicht den heutigen Tag, sondern die
// letzten Wochen, und ein Portal, das beim Oeffnen leer aussieht, ist ein
// schlechter erster Eindruck.
$heute = date('Y-m-d');
$von = trim((string)($_GET['von'] ?? '')) ?: date('Y-m-01');
$bis = trim((string)($_GET['bis'] ?? '')) ?: $heute;
// Unsinnige Eingaben nicht stillschweigend uebernehmen: Ein falsch
// formatiertes Datum ergaebe in MySQL einen leeren Zeitraum, und leer sieht
// aus wie "nichts passiert".
$gueltig = static fn(string $d): bool => (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
if (!$gueltig($von)) { $von = date('Y-m-01'); }
if (!$gueltig($bis)) { $bis = $heute; }
if ($von > $bis) { [$von, $bis] = [$bis, $von]; }

$pdo = db();
$objektIds = kp_objekt_ids($pdo, $zugang['kunde_id']);

$antwort = [
    'status'   => 'ok',
    'kunde'    => $zugang['kunde_name'],
    'person'   => $zugang['name'],
    'zeitraum' => ['von' => $von, 'bis' => $bis],
    'objekte'  => [],
    'rundgaenge' => [],
    // Von Anfang an dabei, nicht erst nach der Schleife: Der fruehe Ausstieg
    // "kein Revierdienst" antwortet sonst ohne dieses Feld, und die
    // Oberflaeche muesste sein Fehlen von einer Null unterscheiden.
    'kennzahlen' => ['runden' => 0, 'abgebrochen' => 0,
                     'punkte_gesamt' => 0, 'punkte_erledigt' => 0, 'punkte_fotobeleg' => 0],
    // Der Verlauf (ENT-500): je Zeitabschnitt die Zahl der Runden, fuer die
    // kleine Kurve in der Kachel. Aus demselben Grund wie die Kennzahlen im
    // SERVER gebuendelt und nicht im Browser aus der Liste gerechnet: Die
    // Liste ist der gewaehlte Zeitraum, und wuerde sie je gekuerzt, zeigte
    // eine im Browser gerechnete Kurve die gekuerzte Menge und saehe aus wie
    // das Ganze (ENT-490).
    'verlauf' => ['einheit' => null, 'punkte' => []],
];

// Vier verschiedene Aussagen, vier verschiedene Antworten (Hausregel:
// „unbekannt darf nie wie keine aussehen"). Der Server sagt, WARUM die
// Liste leer ist -- die Oberflaeche soll das nicht aus einer Anzahl 0
// erraten muessen, denn dabei entsteht regelmaessig der Satz „keine
// Rundgaenge", wo „kein Revierdienst eingerichtet" richtig waere.
// „Gibt es ueberhaupt je einen" wird OHNE Zeitraum gefragt. Die Oberflaeche
// entscheidet daran, ob sie den Revierdienst-Teil ueberhaupt anbietet
// (ENT-482) -- und das darf sich nicht aendern, nur weil jemand den Zeitraum
// verstellt.
$antwort['je_vorhanden'] = false;

if (!$objektIds) {
    $antwort['leer_grund'] = 'kein_revierdienst';
    json_response($antwort);
}

$platz = implode(',', array_fill(0, count($objektIds), '?'));

$os = $pdo->prepare("SELECT id, name, strasse, ort FROM objekte WHERE id IN ($platz) ORDER BY name");
$os->execute($objektIds);
$antwort['objekte'] = array_map(static fn(array $o): array => [
    'id'      => (int)$o['id'],
    'name'    => (string)$o['name'],
    'strasse' => (string)($o['strasse'] ?? ''),
    'ort'     => (string)($o['ort'] ?? ''),
], $os->fetchAll(PDO::FETCH_ASSOC));

$offen = implode(',', array_fill(0, count(RUNDGANG_OFFENE_STATUS), '?'));

$je = $pdo->prepare("SELECT 1 FROM rundgang WHERE objekt_id IN ($platz)
                       AND status NOT IN ($offen) LIMIT 1");
$je->execute([...$objektIds, ...RUNDGANG_OFFENE_STATUS]);
$antwort['je_vorhanden'] = (bool)$je->fetchColumn();

$sql = "SELECT r.id, r.objekt_id, r.status, r.rundgang_vorlage_id,
               r.rohzeit_start, r.rohzeit_ende, r.pause_minuten,
               e.datum, o.name AS objekt_name,
               (SELECT MAX(s.erfasst_am) FROM rundgang_scan s WHERE s.rundgang_id = r.id) AS letzter_scan
          FROM rundgang r
          JOIN einsaetze e ON e.id = r.einsatz_id
          JOIN objekte o ON o.id = r.objekt_id
         WHERE r.objekt_id IN ($platz)
           AND r.status NOT IN ($offen)
           AND e.datum BETWEEN ? AND ?
         ORDER BY e.datum DESC, r.rohzeit_start DESC";
$stmt = $pdo->prepare($sql);
$stmt->execute([...$objektIds, ...RUNDGANG_OFFENE_STATUS, $von, $bis]);
$zeilen = $stmt->fetchAll(PDO::FETCH_ASSOC);

/* Kennzahlen zum Zeitraum (ENT-490). Fuenf ROHE Zahlen, keine fertigen
   Prozente: Wie sie dargestellt werden -- und ob ueberhaupt, wenn der
   Nenner null ist -- entscheidet die Oberflaeche. Ein Prozentwert aus dem
   Server waere eine zweite Stelle, an der ueber "0 von 0" befunden wird.

   Alles stammt aus DENSELBEN Zeilen, die unten die Liste fuellen. Eine
   eigene Abfrage waere eine zweite Wahrheit ueber denselben Zeitraum, und
   sie liefe irgendwann auseinander -- der Kunde saehe dann ein Band, das
   der Liste darunter widerspricht.

   BEWUSST OHNE Ereignisse: Die zaehlt das Wachbuch bereits, und zwar nach
   einer eigenen Regel (nur Meldungen an einer beendeten Runde, ENT-484).
   Sie hier ein zweites Mal zu zaehlen hiesse, zwei Zahlen fuer dieselbe
   Sache zu haben. */
$kz = $antwort['kennzahlen'];

/* Der Verlauf (ENT-500).
   TAGE ODER WOCHEN, entschieden am Zeitraum und nicht am Geschmack: Bis
   einschliesslich 31 Tagen je Tag, darueber je Woche. Andernfalls haette
   ein Jahresbereich 365 Striche (unlesbar) und eine Woche einen einzigen
   (keine Kurve).
   LUECKEN GEHOEREN DAZU: Vorbelegt wird JEDER Abschnitt mit null, auch der
   ohne Runde. Nur die vorhandenen aneinanderzureihen ergaebe eine Kurve
   ohne Zeitachse -- drei Runden an drei aufeinanderfolgenden Tagen saehen
   aus wie drei Runden ueber drei Monate. */
$vonTag = new DateTimeImmutable($von);
$bisTag = new DateTimeImmutable($bis);
$tage   = (int)$vonTag->diff($bisTag)->days + 1;
$jeTag  = $tage <= 31;
$schluessel = static function (string $datum) use ($jeTag): string {
    $d = new DateTimeImmutable($datum);
    // Wochen beginnen am Montag (ISO 8601) -- die Schweiz zaehlt so, und
    // eine Woche, die am Erfassungstag beginnt, waere bei jedem Aufruf eine
    // andere.
    return $jeTag ? $d->format('Y-m-d')
                  : $d->modify('monday this week')->format('Y-m-d');
};
$eimer = [];
for ($t = $vonTag; $t <= $bisTag; $t = $t->modify('+1 day')) {
    $eimer[$schluessel($t->format('Y-m-d'))] = 0;
}

// Fortschritt fuer alle Runden auf einmal statt zwei Abfragen je Zeile
// (Lasttest 09.09.2026) -- dieselbe Umstellung wie in rundgang_liste.php.
// Hier faellt sie noch staerker ins Gewicht: Das Portal zeigt Zeitraeume
// ueber Wochen, nicht einen Tag.
$fortschritte = rundgang_fortschritt_viele($pdo, array_map(fn($r) => [
    'id'         => (int)$r['id'],
    'objekt_id'  => (int)$r['objekt_id'],
    'vorlage_id' => $r['rundgang_vorlage_id'] !== null ? (int)$r['rundgang_vorlage_id'] : null,
], $zeilen));

foreach ($zeilen as $r) {
    $dauer = rundgang_dauer($r['rohzeit_start'], $r['rohzeit_ende'], $r['letzter_scan'],
        (int)$r['pause_minuten'], (string)$r['status']);
    $fortschritt = $fortschritte[(int)$r['id']];
    $antwort['rundgaenge'][] = [
        'id'           => (int)$r['id'],
        'datum'        => (string)$r['datum'],
        'objekt_id'    => (int)$r['objekt_id'],
        'objekt_name'  => (string)$r['objekt_name'],
        'status'       => (string)$r['status'],
        'beginn'       => $r['rohzeit_start'],
        'dauer'        => $dauer,
        'fortschritt'  => $fortschritt,
    ];

    $kz['runden']++;
    if ((string)$r['status'] === 'abgebrochen') { $kz['abgebrochen']++; }
    // Punkte einer Runde OHNE hinterlegte Kontrollpunkte zaehlen mit null
    // mit -- sie druecken den Erledigungsgrad nicht, sie sind schlicht nicht
    // gemessen. Genau darum liefert der Server den Nenner mit: Ist er null,
    // gibt es keinen Grad, und die Oberflaeche sagt das statt "100 %".
    $kz['punkte_gesamt']    += (int)$fortschritt['gesamt'];
    $kz['punkte_erledigt']  += (int)$fortschritt['erledigt'];
    $kz['punkte_fotobeleg'] += (int)$fortschritt['ersatzscan'];

    $k = $schluessel((string)$r['datum']);
    // Sollte eine Runde ausserhalb des Zeitraums stehen, waere das ein
    // Fehler in der Abfrage -- sie bekommt dann KEINEN eigenen Eimer,
    // sondern faellt auf. Ein stillschweigend angelegter Eimer verschoebe
    // die Zeitachse.
    if (isset($eimer[$k])) { $eimer[$k]++; }
}
$antwort['kennzahlen'] = $kz;
$antwort['verlauf'] = [
    'einheit' => $jeTag ? 'tag' : 'woche',
    'punkte'  => array_map(
        static fn(string $ab, int $n): array => ['ab' => $ab, 'runden' => $n],
        array_keys($eimer), array_values($eimer)),
];

if (!$antwort['rundgaenge']) {
    // Zwei verschiedene Gruende, zwei verschiedene Texte: Hat es je einen
    // Rundgang gegeben, ist der Zeitraum schuld -- dann darf dort nicht
    // stehen, es sei nie etwas erfasst worden.
    $antwort['leer_grund'] = $antwort['je_vorhanden']
        ? 'kein_treffer_im_zeitraum' : 'noch_nichts_erfasst';
}

json_response($antwort);
