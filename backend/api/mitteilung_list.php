<?php
declare(strict_types=1);
// Die Mitteilungen aus Sicht der Verwaltung (ENT-421) -- alle, auch die
// abgelaufenen und archivierten, samt Lesestand.
//
// Getrennt von meine_mitteilungen.php und nicht als Zusatzschalter darin:
// Dort gilt "nur was mich angeht", hier "alles". Ein Endpunkt mit einem
// Schalter, der zwischen beidem umlegt, waere die Sorte Stelle, an der eine
// vergessene Rechtepruefung fremde Daten herausgibt.
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../mitteilungen.php';
require_once __DIR__ . '/../push.php';

$user = require_session();
require_recht($user, 'mitteilungen_lesen');

// ── Obergrenze (Lasttest 09.09.2026) ──────────────────────────────────
// Diese Liste holt ausdruecklich ALLES, auch Abgelaufenes und Archiviertes.
// Das ist richtig so -- aber ohne Obergrenze waechst sie mit jedem Jahr, und
// zwar mit vier Unterabfragen je Zeile. Dieselbe Bauart hat die Rapportliste
// im Lasttest mit HTTP 500 sterben lassen. Die Zahlen 'gesamt' und
// 'gekuerzt' daneben sind der wichtigere Teil: Eine gekuerzte Liste darf nie
// wie eine vollstaendige aussehen.
const MITTEILUNG_GRENZE = 2000;

$pdo = db();
if (!hat_tabelle($pdo, 'mitteilungen')) {
    // Nicht eingerichtet ist etwas anderes als "keine Mitteilungen" --
    // die Oberflaeche sagt beides verschieden (Hausregel).
    json_response(['status' => 'ok', 'eingerichtet' => false, 'mitteilungen' => []]);
}

$jetzt = date('Y-m-d H:i:s');

// Nachzuegler-Versand als Rueckfall (ENT-424): Eine vorbereitete Mitteilung,
// deren Zeitpunkt inzwischen erreicht ist, hat beim Speichern noch nichts
// ausgeloest. Verlaesslich holt das der Zeitgeber nach (api/push_versand.php);
// wo keiner eingerichtet ist, geschieht es hier -- beim Oeffnen der
// Mitteilungsseite im Cockpit.
//
// BEWUSST HIER und nicht in meine_mitteilungen.php: Dort wartete jemand
// draussen beim Oeffnen der App darauf, dass sein Telefon dreissig
// Push-Dienste anschreibt.
if (push_konfiguriert() && hat_tabelle($pdo, 'push_abo')) {
    try {
        foreach (push_faellige_mitteilungen($pdo, $jetzt) as $f) {
            push_mitteilung_vermerken($pdo, (int)$f['id'],
                push_fuer_mitteilung($pdo, $f, $jetzt), $jetzt);
        }
    } catch (Throwable $e) {
        // Eine Stoerung beim Versand darf die Liste nicht verhindern --
        // sie ist der Zweck dieses Endpunkts, der Versand die Zugabe.
    }
}

// Nur die Nummer? Dann mit den Namen derer, die gelesen haben. Bewusst ein
// eigener Zweig statt Namen an jeder Zeile der Liste: Bei 40 Mitteilungen
// mal 30 Personen waeren das 1200 Zeilen fuer eine Ansicht, in der man
// jeweils EINE Mitteilung aufklappt.
$detail = isset($_GET['id']) ? (int)$_GET['id'] : 0;
if ($detail > 0) {
    $art = $pdo->prepare('SELECT art, zielgruppe FROM mitteilungen WHERE id = ?');
    $art->execute([$detail]);
    $kopf = $art->fetch() ?: ['art' => 'info', 'zielgruppe' => 'alle'];
    $istTermin = mitteilung_ist_termin($kopf);

    // Bei einem TERMIN werden ALLE Empfaenger aufgezaehlt, nicht nur die,
    // die schon geoeffnet haben (ENT-436). Sonst beantwortete die Liste
    // die eigentliche Frage nicht: "Wen muss ich noch anrufen?" Wer nicht
    // geantwortet hat, taucht sonst gar nicht auf -- und Fehlen sieht aus
    // wie Nichtvorhandensein.
    //
    // Bei einer Mitteilung bleibt es bei den Lesern: Dort gibt es nichts
    // zu beantworten, und eine Liste aller Nichtleser waere eine
    // Anwesenheitskontrolle, die niemand bestellt hat.
    $wo = $istTermin ? mitteilung_empfaenger_wo($pdo, (string)$kopf['zielgruppe']) : null;
    if ($istTermin && $wo !== null) {
        $st = $pdo->prepare(
            "SELECT p.vorname, p.nachname, p.name, g.gelesen_am, g.bestaetigt_am,
                    g.antwort, g.antwort_am
               FROM mitarbeiter p
               LEFT JOIN mitteilung_gelesen g
                      ON g.mitarbeiter_id = p.id AND g.mitteilung_id = ?
              WHERE $wo
              ORDER BY p.nachname, p.vorname, p.name"
        );
        $st->execute([$detail]);
    } else {
        $st = $pdo->prepare(
            'SELECT p.vorname, p.nachname, p.name, g.gelesen_am, g.bestaetigt_am,
                    g.antwort, g.antwort_am
               FROM mitteilung_gelesen g
               JOIN mitarbeiter p ON p.id = g.mitarbeiter_id
              WHERE g.mitteilung_id = ?
              ORDER BY g.gelesen_am'
        );
        $st->execute([$detail]);
    }
    json_response(['status' => 'ok', 'eingerichtet' => true,
        'ist_termin' => $istTermin,
        // Steht der Empfaengerkreis nicht fest (Revier ohne die Spalte),
        // ist die Liste unvollstaendig -- und sagt das, statt Vollstaendig-
        // keit vorzutaeuschen.
        'vollzaehlig' => !$istTermin || $wo !== null,
        'leser' => $st->fetchAll()]);
}

$st = $pdo->query(
    'SELECT m.id, m.titel, m.text, m.zielgruppe, m.stufe,
            m.art, m.beginn, m.ende, m.ort,
            m.sichtbar_ab, m.sichtbar_bis, m.erstellt_am, m.archiviert_am,
            m.verfasser_name,
            (SELECT COUNT(*) FROM mitteilung_gelesen g WHERE g.mitteilung_id = m.id) AS gelesen_anzahl,
            (SELECT COUNT(*) FROM mitteilung_gelesen g WHERE g.mitteilung_id = m.id AND g.bestaetigt_am IS NOT NULL) AS bestaetigt_anzahl,
            (SELECT COUNT(*) FROM mitteilung_gelesen g WHERE g.mitteilung_id = m.id AND g.antwort = \'zugesagt\') AS zugesagt_anzahl,
            (SELECT COUNT(*) FROM mitteilung_gelesen g WHERE g.mitteilung_id = m.id AND g.antwort = \'abgesagt\') AS abgesagt_anzahl,
            m.push_gesendet_am, m.push_bilanz
       FROM mitteilungen m
      ORDER BY m.erstellt_am DESC, m.id DESC
      LIMIT ' . MITTEILUNG_GRENZE
);
$liste = $st->fetchAll();
$gesamt = (int)$pdo->query('SELECT COUNT(*) FROM mitteilungen')->fetchColumn();

// Der Nenner zu "12 von 18". Zwei Werte, einer je Zielgruppe -- einmal
// gezaehlt statt einmal je Zeile.
$nenner = [];
foreach (MITTEILUNG_ZIELGRUPPEN as $z) { $nenner[$z] = mitteilung_empfaengerzahl($pdo, $z); }

foreach ($liste as &$m) {
    $m['gelesen_anzahl']     = (int)$m['gelesen_anzahl'];
    $m['bestaetigt_anzahl']  = (int)$m['bestaetigt_anzahl'];
    // Die Antworten auf einen Termin (ENT-436). "offen" wird NICHT
    // mitgeschickt, sondern in der Oberflaeche aus dem Nenner gerechnet --
    // und nur dort, wo der Nenner bekannt ist. Eine Zahl "0 offen" bei
    // unbekanntem Empfaengerkreis waere eine Behauptung.
    $m['ist_termin']      = mitteilung_ist_termin($m);
    $m['zugesagt_anzahl'] = (int)$m['zugesagt_anzahl'];
    $m['abgesagt_anzahl'] = (int)$m['abgesagt_anzahl'];
    // -1 bedeutet unbekannt (siehe mitteilung_empfaengerzahl) und bleibt
    // -1: Die Oberflaeche muss den Unterschied zu 0 zeigen koennen.
    $m['empfaenger_anzahl']  = $nenner[$m['zielgruppe']] ?? -1;
    // Laeuft diese Mitteilung gerade? Aus derselben Regel wie in der App
    // (mitteilung_sichtbar_fuer), nur ohne Personenbezug: Die Verwaltung
    // sieht den Zustand der Mitteilung, nicht ihre eigene Sicht darauf.
    $m['archiviert'] = $m['archiviert_am'] !== null;
    $m['laeuft']     = mitteilung_sichtbar_fuer(
        // Zielgruppe fuer diese Frage ausklammern: Ob eine Revier-
        // Mitteilung laeuft, haengt am Zeitfenster, nicht daran, ob die
        // gerade angemeldete Person selbst Revierdienst macht.
        ['archiviert_am' => $m['archiviert_am'], 'zielgruppe' => 'alle',
         'sichtbar_ab' => $m['sichtbar_ab'], 'sichtbar_bis' => $m['sichtbar_bis']],
        true, $jetzt
    );
    $m['geplant'] = !$m['archiviert'] && $m['sichtbar_ab'] !== null && $m['sichtbar_ab'] > $jetzt;
    // Archiv heisst: nicht mehr in der App -- zurueckgezogen ODER
    // abgelaufen (ENT-433). Die Antwort kommt aus mitteilung_im_archiv()
    // und wird im Cockpit NICHT noch einmal aus den drei Marken
    // zusammengesetzt: Dieselbe Grenze entscheidet ueber die Ansicht und
    // ueber das Loeschen, und sie steht an einer Stelle.
    $m['im_archiv'] = mitteilung_im_archiv($m, $jetzt);
    // Abgelaufen ist NICHT dasselbe wie zurueckgezogen: Eine
    // zurueckgezogene Mitteilung holt "Wieder aufnehmen" zurueck, eine
    // abgelaufene nicht -- da muesste das Datum geaendert werden. Das
    // Cockpit braucht den Unterschied, um keinen Knopf anzubieten, der
    // nichts bewirkt.
    $m['abgelaufen'] = $m['sichtbar_bis'] !== null && $m['sichtbar_bis'] < $jetzt;
    // Der Push-Zustand (ENT-424). Die Bilanz kommt als fertige Zahlen
    // heraus, nicht als Text -- die Oberflaeche soll sie nicht auseinander-
    // nehmen muessen. Fehlt sie, ist das "noch nicht verschickt" und NICHT
    // "an null Geraete verschickt": zwei verschiedene Aussagen.
    $m['push_bilanz'] = $m['push_bilanz'] !== null
        ? (json_decode((string)$m['push_bilanz'], true) ?: null) : null;
}
unset($m);

json_response(['status' => 'ok', 'eingerichtet' => true, 'mitteilungen' => $liste, 'jetzt' => $jetzt,
    'gesamt' => $gesamt,
    'grenze' => MITTEILUNG_GRENZE,
    'gekuerzt' => $gesamt > count($liste),
    // Damit die Verwaltungsseite den Unterschied zwischen "niemand hat
    // Benachrichtigungen eingeschaltet" und "Push ist gar nicht
    // eingerichtet" zeigen kann (ENT-424).
    'push_eingerichtet' => push_konfiguriert() && hat_tabelle($pdo, 'push_abo'),
    // WARUM nicht eingerichtet -- damit die Oberflaeche den noetigen
    // Handgriff nennen kann statt nur "fehlt" (ENT-424). Nennt nie den
    // Schluessel selbst.
    'push_grund' => hat_tabelle($pdo, 'push_abo') ? push_grund() : 'keine_tabelle',
    'push_geraete' => hat_tabelle($pdo, 'push_abo')
        ? (int)$pdo->query('SELECT COUNT(*) FROM push_abo WHERE abgemeldet_am IS NULL')->fetchColumn()
        : -1,
]);
