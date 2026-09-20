<?php
// Die Vertragsverhaeltnisse der Betreiberin, eine Zeile je Gegenueber
// (ENT-637).
//
// WARUM DAS NICHT DIE BELEGLISTE TUT: „Vertrag" heisst hier zweierlei. Am
// Mandanten stehen seit ENT-617 Beginn, Mindestlaufzeit, Frist und
// Verlaengerung -- das laufende Verhaeltnis, oft ohne Papier, weil es aus
// der Zeit vor diesem Bereich stammt. Und seit ENT-637 gibt es das
// unterschriebene Blatt als Beleg, teils fuer Betriebe, die noch gar kein
// Mandant sind. Wer nur das eine zeigt, sieht die Luecken des anderen nicht.
//
// VIER LAGEN, VIER TEXTE (Hausregel: „unbekannt" darf nie wie „keine"
// aussehen). Benannt werden sie hier im Server, nicht in der Oberflaeche
// erraten:
//
//   vollstaendig    Dokument und Mandant stehen beide.
//   ohne_dokument   Der Betrieb laeuft, das Blatt fehlt. Der haeufige
//                   Altfall, kein Fehler.
//   ohne_mandant    Das Blatt ist da, der Betrieb noch nicht aufgeschaltet.
//                   Das ist Arbeit, die ansteht.
//   im_versand      Ein Dokument ist unterwegs und noch nicht angenommen.
//                   Etwas anderes als „nichts da".
//
// DIE LAUFZEIT KOMMT VOM MANDANTEN, wo es einen gibt: Das Blatt sagt, was
// unterschrieben wurde, der Mandant, was heute gilt. Wird nachverhandelt,
// aendert sich der Mandant und nicht das unterschriebene Blatt.
// Gerechnet wird beides mit be_vertrag_lage() aus ENT-617 -- dieselbe
// Funktion, weil die Felder in beiden Tabellen gleich heissen.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../betreiber.php';
require_once __DIR__ . '/../belege.php';

require_betreiber_voll();
$pdo = betreiber_db();

if (!hat_tabelle($pdo, 'be_belege') || !hat_tabelle($pdo, 'mandant')) {
    // Nicht eingerichtet ist etwas anderes als „keine Vertraege".
    json_response(['status' => 'ok', 'eingerichtet' => false,
                   'kennt_laufzeit' => false, 'zeilen' => []]);
}

$heute = date('Y-m-d');
$LAUFZEIT = ['vertrag_beginn', 'mindestlaufzeit_monate',
             'kuendigungsfrist_monate', 'verlaengerung_monate'];
$kenntLaufzeit = hat_spalte($pdo, 'be_belege', 'vertrag_beginn');
$kenntPerioden = hat_spalte($pdo, 'be_belege', 'total_monat_rappen');

// ── Die Dokumente ─────────────────────────────────────────────────────────
// Vorlagen bleiben draussen: Eine Vorlage ist kein Verhaeltnis zu jemandem.
$felder = 'b.id, b.nummer, b.kunde_id, b.titel, b.datum, b.status,
           b.total_rappen, b.entscheidung_am, b.aktiv'
    . ($kenntPerioden ? ', b.total_monat_rappen, b.total_jahr_rappen' : '')
    . ($kenntLaufzeit ? ', b.' . implode(', b.', $LAUFZEIT) : '');
$dokumente = $pdo->query(
    "SELECT {$felder}, k.name AS kunde_name, k.kundennummer, k.mandant_id
       FROM be_belege b
       LEFT JOIN be_kunden k ON k.id = b.kunde_id
      WHERE b.art = 'vertrag' AND b.ist_vorlage = 0
      ORDER BY b.datum DESC, b.id DESC"
)->fetchAll(PDO::FETCH_ASSOC);

// ── Die Mandanten ─────────────────────────────────────────────────────────
// Demo-Plaetze bleiben draussen -- aus demselben Grund wie in der
// Mandantenliste (ENT-627): Eine Demo ist kein Vertragsverhaeltnis.
$mVertrag = array_values(array_filter(
    array_merge($LAUFZEIT, ['gekuendigt_per']),
    fn($f) => hat_spalte($pdo, 'mandant', $f)
));
$mandanten = $pdo->query(
    'SELECT id, name, subdomain, status'
    . ($mVertrag ? ', ' . implode(', ', $mVertrag) : '')
    . ' FROM mandant ORDER BY id'
)->fetchAll(PDO::FETCH_ASSOC);

// Welcher Kunde zeigt auf welchen Mandanten? Nur so laesst sich ein Blatt
// einem laufenden Betrieb zuordnen.
$kundeZuMandant = [];
foreach ($pdo->query('SELECT id, mandant_id FROM be_kunden WHERE mandant_id IS NOT NULL')
              ->fetchAll(PDO::FETCH_ASSOC) as $k) {
    $kundeZuMandant[(int)$k['id']] = (int)$k['mandant_id'];
}

// ── Zusammenfuehren ───────────────────────────────────────────────────────
// Der Schluessel ist der Mandant, wo es einen gibt, sonst der Kunde. Sonst
// stuende ein Betrieb mit Blatt und Aufschaltung zweimal in der Liste.
$zeilen = [];
$schluessel = static fn(?int $mandantId, ?int $kundeId): string =>
    $mandantId !== null ? 'm' . $mandantId : 'k' . (int)$kundeId;

foreach ($mandanten as $m) {
    if (in_array((string)$m['subdomain'], DEMO_PLAETZE, true)) { continue; }
    $lage = be_vertrag_lage($m, $heute);
    $zeilen[$schluessel((int)$m['id'], null)] = [
        'firma'          => (string)$m['name'],
        'kundennummer'   => null,
        'kunde_id'       => null,
        'mandant_id'     => (int)$m['id'],
        'subdomain'      => (string)$m['subdomain'],
        'mandant_status' => (string)$m['status'],
        'dokument'       => null,
        'laufzeit'       => $lage,
        'laufzeit_quelle' => 'mandant',
        'faellig_90'     => be_vertrag_faellig($lage, 90, $heute),
        'lage'           => 'ohne_dokument',
    ];
}

foreach ($dokumente as $d) {
    $kundeId   = $d['kunde_id'] === null ? null : (int)$d['kunde_id'];
    $mandantId = $d['mandant_id'] !== null ? (int)$d['mandant_id']
               : ($kundeId !== null ? ($kundeZuMandant[$kundeId] ?? null) : null);
    $k = $schluessel($mandantId, $kundeId);

    // Nur das NEUESTE Dokument je Verhaeltnis steht in der Zeile. Die
    // Abfrage liefert absteigend, also gewinnt der erste Treffer -- ein
    // Nachfolgevertrag verdraengt den alten, und der alte bleibt in der
    // Belegliste auffindbar.
    $schonDa = isset($zeilen[$k]) && $zeilen[$k]['dokument'] !== null;

    if (!isset($zeilen[$k])) {
        $zeilen[$k] = [
            'firma'          => (string)($d['kunde_name'] ?? ''),
            'kundennummer'   => $d['kundennummer'],
            'kunde_id'       => $kundeId,
            'mandant_id'     => null,
            'subdomain'      => '',
            'mandant_status' => null,
            'dokument'       => null,
            'laufzeit'       => be_vertrag_lage([], $heute),
            'laufzeit_quelle' => 'dokument',
            'faellig_90'     => false,
            'lage'           => 'ohne_mandant',
        ];
    }
    if ($zeilen[$k]['kunde_id'] === null) {
        $zeilen[$k]['kunde_id']     = $kundeId;
        $zeilen[$k]['kundennummer'] = $d['kundennummer'];
    }
    if ($schonDa) { continue; }

    $zeilen[$k]['dokument'] = [
        'id'                 => (int)$d['id'],
        'nummer'             => (string)$d['nummer'],
        'titel'              => (string)$d['titel'],
        'datum'              => (string)$d['datum'],
        'status'             => (string)$d['status'],
        'aktiv'              => (int)$d['aktiv'] === 1,
        'angenommen_am'      => $d['entscheidung_am'],
        'total_rappen'       => (int)$d['total_rappen'],
        'total_monat_rappen' => $kenntPerioden ? (int)$d['total_monat_rappen'] : 0,
        'total_jahr_rappen'  => $kenntPerioden ? (int)$d['total_jahr_rappen'] : 0,
    ];

    // Ohne Mandant traegt das Blatt die Laufzeit. Mit Mandant bleibt die des
    // Mandanten stehen -- siehe Kopf.
    if ($kenntLaufzeit && $zeilen[$k]['mandant_id'] === null) {
        $lage = be_vertrag_lage($d, $heute);
        $zeilen[$k]['laufzeit']   = $lage;
        $zeilen[$k]['faellig_90'] = be_vertrag_faellig($lage, 90, $heute);
    }

    // Die Lage ergibt sich erst jetzt, wo Blatt und Betrieb beide bekannt
    // sind. „Unterwegs" schlaegt „vollstaendig": Solange niemand
    // unterschrieben hat, ist das Verhaeltnis nicht abgemacht.
    $offen = in_array((string)$d['status'], ['entwurf', 'versendet', 'angeschaut'], true);
    if ($zeilen[$k]['mandant_id'] === null) {
        $zeilen[$k]['lage'] = 'ohne_mandant';
    } elseif ($offen) {
        $zeilen[$k]['lage'] = 'im_versand';
    } else {
        $zeilen[$k]['lage'] = 'vollstaendig';
    }
}

// Was ansteht, zuerst. Danach alphabetisch -- eine Liste, die bei jedem
// Aufruf anders sortiert ist, laesst sich nicht wiederfinden.
$liste = array_values($zeilen);
usort($liste, static function (array $a, array $b): int {
    if ($a['faellig_90'] !== $b['faellig_90']) { return $a['faellig_90'] ? -1 : 1; }
    return strcasecmp($a['firma'], $b['firma']);
});

json_response([
    'status'         => 'ok',
    'eingerichtet'   => true,
    'kennt_laufzeit' => $kenntLaufzeit,
    'kennt_perioden' => $kenntPerioden,
    'zeilen'         => $liste,
]);
