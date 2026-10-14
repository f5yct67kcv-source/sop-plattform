<?php
// Ereignis-Feed der Uebersicht (ENT-090).
//
// Vom Projektinhaber bestellt als "Info box mit den neusten Ereignissen",
// die den bisherigen Sperrtage-Feed ERSETZT. Sein eigener Einwand gegen zwei
// Listen nebeneinander gab den Ausschlag: dieselbe Art Information zweimal im
// Bild ist Doppelung, nicht Komfort.
//
// Drei Festlegungen, die den Aufbau erklaeren:
//
//  1. NICHTS WIRD PROTOKOLLIERT. Die Ereignisse werden beim Lesen aus den
//     vorhandenen Tabellen abgeleitet. Eine eigene Ereignistabelle muesste
//     von jedem schreibenden Endpunkt mitgepflegt werden -- wer einen
//     vergisst, hat ein Ereignis, das nie erscheint, und niemand merkt es.
//     Abgeleitet kann das nicht passieren.
//
//  2. "GESEHEN" STEHT AM DATENSATZ SELBST, als Zeitstempel. Genauso macht es
//     verfuegbarkeiten.gesehen_am seit ENT-033. Und es gilt FUER ALLE, nicht
//     je Person -- das ist der Bestand, nicht eine neue Entscheidung. Mit dem
//     Rollenmodell arbeiten womoeglich mehrere an der Planung; ob das so
//     bleiben soll, ist offen (OP-90).
//
//  3. NUR WAS NEU HINZUKOMMT. Ein Ereignis ist etwas, das GESCHEHEN ist:
//     ein Rapport ist eingegangen, jemand hat sich einen Tag gesperrt, jemand
//     hat auf eine Schicht geantwortet. Ein andauernder Zustand -- etwa eine
//     Schicht ohne Abgleich -- gehoert nicht hierher. Er stand bis zum
//     23.08.2026 mit drin und wurde auf ausdrueckliche Ansage des
//     Projektinhabers entfernt: "fehlende, noch nicht abgeschlossene
//     Schichten sollen nicht in die Ereignisse kommen. nur ereignisse, die
//     neu hinzukommen." Fuer offene Abgleiche gibt es die Ansicht Abgleich;
//     im Feed haetten sie taeglich dieselbe Meldung erzeugt und die
//     tatsaechlichen Neuigkeiten verdraengt.
declare(strict_types=1);

// Welche Arten es gibt und ob sie sich abhaken lassen. EINE Liste --
// der Endpunkt zum Abhaken befragt sie, statt eine zweite zu fuehren.
const EREIGNIS_ARTEN = [
    'rapport'  => ['tabelle' => 'rapporte',          'spalte' => 'gesehen_am'],
    'sperrtag' => ['tabelle' => 'verfuegbarkeiten',  'spalte' => 'gesehen_am'],
    'zusage'   => ['tabelle' => 'einsatz_zuteilung', 'spalte' => 'zusage_gesehen_am'],
    // Kundenentscheidung zu einer Offerte (ENT-192/ENT-197).
    'offerte'  => ['tabelle' => 'belege',            'spalte' => 'entscheidung_gesehen_am'],
    // Spontaner Rundgang-Start (ENT-283, Fortsetzung von ENT-282): gesehen_am
    // sitzt am rundgang-Datensatz, nicht am Einsatz -- er ist das konkrete,
    // einmalige Geschehnis.
    'rundgang_spontan' => ['tabelle' => 'rundgang',  'spalte' => 'gesehen_am'],
    // Vorfallmeldung aus dem Revierdienst (ENT-297, Fortsetzung von
    // ENT-295). Gehoert in den Feed und nicht nur in die eigene Liste: Eine
    // Brandgefahr-Meldung darf nicht darauf warten, dass jemand zufaellig
    // eine Liste oeffnet. Abhakbar wie die uebrigen -- der Feed sagt "habe
    // ich gesehen", nicht "ist erledigt"; was daraus folgt, entscheidet der
    // Planer ausserhalb.
    'vorfall'  => ['tabelle' => 'ereignis_meldung', 'spalte' => 'gesehen_am'],
    // "abwesenheit" bewusst NICHT hier eingetragen: ereignis_erledigt.php
    // prueft nur das Recht 'plan', nicht 'personal_schreiben'. Eine
    // Planungs-Person koennte einen unentschiedenen Antrag sonst aus dem
    // Feed abhaken, ohne ihn entscheiden zu duerfen -- dasselbe Problem, vor
    // dem der Kommentar zum offenen Abgleich weiter unten warnt. gesehen_am
    // wird stattdessen ausschliesslich von abwesenheit_entscheiden.php
    // gesetzt, zusammen mit der eigentlichen Entscheidung.
    // Mehr nicht. Ein andauernder Zustand ist kein Ereignis -- Festlegung 3.
];

function ereignis_abhakbar(string $typ): bool
{
    return isset(EREIGNIS_ARTEN[$typ]);
}

// "Alle als gelesen" aus der Glocke (14.10.2026).
//
// Je Art dieselbe Bedingung wie in ereignisse_sammeln() -- und NUR die: Ein
// Stempel an einer Zeile, die gar nicht im Feed stand, wuerde sie
// unsichtbar machen, bevor sie je erscheint (etwa eine noch offene Zusage,
// die morgen beantwortet wird, oder ein normal geplanter Rundgang).
//
// $bis ist der Stand, zu dem die Liste geladen wurde. Was danach eingeht,
// hat niemand gesehen und bleibt offen. Verglichen wird mit derselben
// Zeitspalte, nach der der Feed sortiert. Bei der Zusage ist das der
// Zeitpunkt der Zuteilung, nicht der Antwort -- eine Antwort auf eine alte
// Zuteilung, die genau zwischen Laden und Klick eingeht, geht mit. Das ist
// dieselbe Unschaerfe, die der Feed bei der Sortierung schon hat.
//
// Abwesenheit und Supportantwort fehlen absichtlich, wie in EREIGNIS_ARTEN.
const EREIGNIS_ALLE_ABHAKEN = [
    'rapport'  => ['tabelle' => 'rapporte', 'spalte' => 'gesehen_am', 'zeit' => 'erfasst_am', 'wo' => '1 = 1'],
    'sperrtag' => ['tabelle' => 'verfuegbarkeiten', 'spalte' => 'gesehen_am', 'zeit' => 'erfasst_am', 'wo' => '1 = 1'],
    'zusage'   => ['tabelle' => 'einsatz_zuteilung', 'spalte' => 'zusage_gesehen_am', 'zeit' => 'zugeteilt_am',
                   'wo' => "zusage <> 'offen'"],
    'offerte'  => ['tabelle' => 'belege', 'spalte' => 'entscheidung_gesehen_am', 'zeit' => 'entscheidung_am',
                   'wo' => 'entscheidung_am IS NOT NULL'],
    'rundgang_spontan' => ['tabelle' => 'rundgang', 'spalte' => 'gesehen_am', 'zeit' => 'vorbereitet_am',
                   'wo' => 'einsatz_id IN (SELECT id FROM einsaetze WHERE spontan_erzeugt = 1)'],
    'vorfall'  => ['tabelle' => 'ereignis_meldung', 'spalte' => 'gesehen_am', 'zeit' => 'erfasst_am', 'wo' => '1 = 1'],
];

// Gibt je Art zurueck, wie viele Zeilen den Stempel bekamen. Scheitert eine
// Art (Spalte fehlt), steht sie in 'fehler' -- die uebrigen laufen trotzdem.
function ereignisse_alle_abhaken(PDO $pdo, string $bis, string $jetzt): array
{
    $geaendert = 0;
    $fehler = [];
    foreach (EREIGNIS_ALLE_ABHAKEN as $typ => $a) {
        try {
            $st = $pdo->prepare("UPDATE {$a['tabelle']} SET {$a['spalte']} = ?
                                  WHERE {$a['spalte']} IS NULL AND {$a['wo']}
                                    AND ({$a['zeit']} IS NULL OR {$a['zeit']} <= ?)");
            $st->execute([$jetzt, $bis]);
            $geaendert += $st->rowCount();
        } catch (Throwable $e) {
            $fehler[] = $typ;
        }
    }
    return ['geaendert' => $geaendert, 'fehler' => $fehler];
}

// Eine Abfrage, die an einer fehlenden Spalte oder Tabelle scheitert, liefert
// eine leere Liste statt den ganzen Feed mitzureissen. Nach dem Grundsatz aus
// ENT-024: lieber ehrlich unvollstaendig als ein Fehler, der alles blockiert.
// Der Aufrufer erfaehrt ueber $fehler, dass etwas fehlt -- eine stillschweigend
// gekuerzte Liste sieht sonst aus wie "nichts passiert".
function ereignis_lesen(PDO $pdo, string $sql, array &$fehler, string $art): array
{
    try {
        return $pdo->query($sql)->fetchAll();
    } catch (Throwable $e) {
        $fehler[] = $art;
        return [];
    }
}

// Wie viele Ereignisse einer Art insgesamt offen sind -- OHNE die Grenze der
// Liste. Bis zum 14.10.2026 stand als "gesamt" die Laenge der Liste, und die
// war je Art bei 20 abgeschnitten: Bei 300 offenen Zusagen zeigte die Glocke
// 20, jeder Haken holte die naechste nach, und nach dem Neuladen stand wieder
// 20 da -- es sah aus, als bleibe das Abhaken nicht haengen. Gezaehlt wird
// mit derselben Bedingung wie die Liste. Scheitert die Zaehlung, steht die Art
// schon ueber ereignis_lesen() in $fehler; gezaehlt wird dann die gelesene
// Laenge, keine erfundene Zahl.
function ereignis_zaehlen(PDO $pdo, string $sql, int $gelesen): int
{
    try {
        return max($gelesen, (int)$pdo->query($sql)->fetchColumn());
    } catch (Throwable $e) {
        return $gelesen;
    }
}

// $stamm und $mandantId kommen fuer die Supportantwort dazu (ENT-685).
// OPTIONAL und nicht Pflicht: Der Feed ist der Herzschlag der Uebersicht --
// er darf nicht davon abhaengen, dass die Betreiber-Ebene erreichbar ist.
// Fehlt sie, fehlt genau diese eine Art, und das steht in 'unvollstaendig'.
function ereignisse_sammeln(PDO $pdo, int $grenze = 12,
                            ?PDO $stamm = null, ?int $mandantId = null): array
{
    $fehler = [];
    $liste  = [];
    $jeArt  = [];  // alle offenen je Art, nicht nur die gelesenen (ereignis_zaehlen)

    // ── Rapport eingegangen. Der Hauptfall: Der Mitarbeitende hat gemeldet,
    // die Verwaltung muss es ansehen.
    $zeilen = ereignis_lesen($pdo,
        "SELECT r.id, r.datum, r.kunde, r.ort, r.einsatzart, r.netto_h, r.erfasst_am,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE r.gesehen_am IS NULL
          ORDER BY r.erfasst_am DESC, r.id DESC LIMIT 20", $fehler, 'rapport');
    $jeArt['rapport'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE r.gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $r) {
        $liste[] = [
            'typ' => 'rapport', 'id' => (int)$r['id'], 'zeit' => $r['erfasst_am'],
            'person' => ['id' => (int)$r['mitarbeiter_id'], 'name' => $r['name'],
                         'vorname' => $r['vorname'], 'nachname' => $r['nachname']],
            'titel' => 'Rapport eingegangen',
            'datum' => $r['datum'], 'kunde' => $r['kunde'], 'ort' => $r['ort'],
            'einsatzart' => $r['einsatzart'], 'netto_h' => $r['netto_h'],
        ];
    }

    // ── Sperrtag gemeldet. Nur kuenftige oder heutige Tage: eine Sperre fuer
    // gestern ist kein Ereignis mehr, das jemanden zum Handeln bringt.
    $zeilen = ereignis_lesen($pdo,
        "SELECT v.id, v.datum, v.bemerkung, v.erfasst_am,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM verfuegbarkeiten v JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
          WHERE v.datum >= CURDATE() AND v.gesehen_am IS NULL
          ORDER BY v.erfasst_am DESC LIMIT 20", $fehler, 'sperrtag');
    $jeArt['sperrtag'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM verfuegbarkeiten v JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
          WHERE v.datum >= CURDATE() AND v.gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $v) {
        $liste[] = [
            'typ' => 'sperrtag', 'id' => (int)$v['id'], 'zeit' => $v['erfasst_am'],
            'person' => ['id' => (int)$v['mitarbeiter_id'], 'name' => $v['name'],
                         'vorname' => $v['vorname'], 'nachname' => $v['nachname']],
            'titel' => 'Tag gesperrt',
            'datum' => $v['datum'], 'bemerkung' => $v['bemerkung'],
        ];
    }

    // ── Zusage oder Absage zu einer Schicht.
    $zeilen = ereignis_lesen($pdo,
        "SELECT z.einsatz_id, z.mitarbeiter_id, z.zusage, z.zugeteilt_am,
                e.datum, e.von, e.bis, e.kunde_name, e.titel AS einsatz_titel, e.ort,
                m.name, m.vorname, m.nachname
           FROM einsatz_zuteilung z
           JOIN einsaetze e   ON e.id = z.einsatz_id
           JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
          WHERE z.zusage <> 'offen' AND z.zusage_gesehen_am IS NULL
          ORDER BY z.zugeteilt_am DESC LIMIT 20", $fehler, 'zusage');
    $jeArt['zusage'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM einsatz_zuteilung z
           JOIN einsaetze e   ON e.id = z.einsatz_id
           JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
          WHERE z.zusage <> 'offen' AND z.zusage_gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $z) {
        $liste[] = [
            'typ' => 'zusage', 'id' => (int)$z['einsatz_id'],
            'mitarbeiter_id' => (int)$z['mitarbeiter_id'], 'zeit' => $z['zugeteilt_am'],
            'person' => ['id' => (int)$z['mitarbeiter_id'], 'name' => $z['name'],
                         'vorname' => $z['vorname'], 'nachname' => $z['nachname']],
            // 'abgesagt' gibt es nicht: meine_zusage.php kennt nur
            // offen | zugesagt | abgelehnt. Der Vergleich traf darum nie zu,
            // und JEDE Ablehnung stand hier als Zusage -- das Gegenteil
            // dessen, was passiert war (ENT-113).
            'titel' => $z['zusage'] === 'abgelehnt' ? 'Schicht abgelehnt' : 'Schicht zugesagt',
            'zusage' => $z['zusage'], 'datum' => $z['datum'],
            'von' => $z['von'], 'bis' => $z['bis'],
            'kunde' => $z['kunde_name'], 'einsatz_titel' => $z['einsatz_titel'], 'ort' => $z['ort'],
        ];
    }

    // ── Kunde hat im Portal ueber eine Offerte entschieden (ENT-192). Ohne
    // Rueckruf vom Portal ins Dashboard war das bislang leicht zu uebersehen
    // (ENT-197) -- derselbe Grund, aus dem der Rapport-Fall oben existiert.
    $zeilen = ereignis_lesen($pdo,
        "SELECT b.id, b.nummer, b.status, b.entscheidung_am,
                k.name AS kunde_name
           FROM belege b LEFT JOIN kunden k ON k.id = b.kunde_id
          WHERE b.entscheidung_am IS NOT NULL AND b.entscheidung_gesehen_am IS NULL
          ORDER BY b.entscheidung_am DESC LIMIT 20", $fehler, 'offerte');
    $jeArt['offerte'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM belege b LEFT JOIN kunden k ON k.id = b.kunde_id
          WHERE b.entscheidung_am IS NOT NULL AND b.entscheidung_gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $o) {
        $liste[] = [
            'typ' => 'offerte', 'id' => (int)$o['id'], 'zeit' => $o['entscheidung_am'],
            'titel' => $o['status'] === 'abgelehnt' ? 'Offerte abgelehnt' : 'Offerte angenommen',
            'nummer' => $o['nummer'], 'kunde' => $o['kunde_name'], 'status' => $o['status'],
        ];
    }

    // ── Abwesenheitsantrag wartet auf Entscheidung (ENT-255). Nicht
    // abhakbar wie die Faelle oben (siehe EREIGNIS_ARTEN) -- verschwindet
    // erst, wenn abwesenheit_entscheiden.php tatsaechlich entschieden hat.
    $zeilen = ereignis_lesen($pdo,
        "SELECT a.id, a.typ, a.von, a.bis, a.bemerkung, a.beantragt_am,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM abwesenheiten a JOIN mitarbeiter m ON m.id = a.mitarbeiter_id
          WHERE a.status = 'beantragt' AND a.gesehen_am IS NULL
          ORDER BY a.beantragt_am DESC LIMIT 20", $fehler, 'abwesenheit');
    $jeArt['abwesenheit'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM abwesenheiten a JOIN mitarbeiter m ON m.id = a.mitarbeiter_id
          WHERE a.status = 'beantragt' AND a.gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $a) {
        $liste[] = [
            'typ' => 'abwesenheit', 'id' => (int)$a['id'], 'zeit' => $a['beantragt_am'],
            'person' => ['id' => (int)$a['mitarbeiter_id'], 'name' => $a['name'],
                         'vorname' => $a['vorname'], 'nachname' => $a['nachname']],
            'titel' => 'Abwesenheit beantragt',
            'abwesenheitstyp' => $a['typ'], 'von' => $a['von'], 'bis' => $a['bis'],
            'bemerkung' => $a['bemerkung'],
        ];
    }

    // ── Spontaner Rundgang gestartet (ENT-283, Fortsetzung von ENT-282): ein
    // Einsatz, der nicht vom Planer angelegt wurde, sondern durch die eigene
    // Wahl einer Person in der App entstanden ist. Immer ein Ereignis,
    // unabhaengig davon, ob dabei ein Ausnahme-Grund noetig war (ausdrueckliche
    // Vorgabe Projektinhaber: "alle spontanen", nicht nur die Grenzfaelle).
    $zeilen = ereignis_lesen($pdo,
        "SELECT r.id, r.ausnahme_grund, r.vorbereitet_am,
                e.datum, e.von, e.bis, e.kunde_name, e.titel AS einsatz_titel, e.ort,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM rundgang r
           JOIN einsaetze e   ON e.id = r.einsatz_id
           JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE e.spontan_erzeugt = 1 AND r.gesehen_am IS NULL
          ORDER BY r.vorbereitet_am DESC LIMIT 20", $fehler, 'rundgang_spontan');
    $jeArt['rundgang_spontan'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM rundgang r
           JOIN einsaetze e   ON e.id = r.einsatz_id
           JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE e.spontan_erzeugt = 1 AND r.gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $r) {
        $liste[] = [
            'typ' => 'rundgang_spontan', 'id' => (int)$r['id'], 'zeit' => $r['vorbereitet_am'],
            'person' => ['id' => (int)$r['mitarbeiter_id'], 'name' => $r['name'],
                         'vorname' => $r['vorname'], 'nachname' => $r['nachname']],
            'titel' => 'Spontaner Rundgang gestartet',
            'datum' => $r['datum'], 'von' => $r['von'], 'bis' => $r['bis'],
            'kunde' => $r['kunde_name'], 'einsatz_titel' => $r['einsatz_titel'], 'ort' => $r['ort'],
            'ausnahme_grund' => $r['ausnahme_grund'],
        ];
    }

    // ── Vorfallmeldung aus dem Revierdienst (ENT-297). Anders als die
    // uebrigen Arten haengt sie an einem OBJEKT, nicht an einem Einsatz:
    // Gemeldet werden kann auch ohne laufende Runde. Die Ereignisart kommt
    // aus den Stammdaten und kann geloescht worden sein (ON DELETE SET
    // NULL), darum LEFT JOIN -- ein INNER JOIN wuerde die Meldung samt
    // ihrem Inhalt aus dem Feed verschwinden lassen, nur weil jemand eine
    // Art aus dem Katalog genommen hat.
    // Kein eigener hat_tabelle()-Vorabtest: Der lebt in db.php, das diese
    // Datei bewusst NICHT einbindet (sie laeuft in pruef_ereignisse.php
    // isoliert gegen SQLite). ereignis_lesen() faengt eine fehlende Tabelle
    // ohnehin ab und meldet die Art als unvollstaendig -- genau derselbe
    // Weg wie bei allen anderen Bloecken hier.
    $zeilen = ereignis_lesen($pdo,
        "SELECT v.id, v.erfasst_am, v.vorfall_am, v.bemerkung, v.foto_mime,
                v.objekt_id, o.name AS objekt_name, o.kunde_name,
                a.bezeichnung AS art,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM ereignis_meldung v
           JOIN objekte o     ON o.id = v.objekt_id
           JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
           LEFT JOIN ereignisart a ON a.id = v.ereignisart_id
          WHERE v.gesehen_am IS NULL
          ORDER BY v.erfasst_am DESC LIMIT 20", $fehler, 'vorfall');
    $jeArt['vorfall'] = ereignis_zaehlen($pdo,
        "SELECT COUNT(*)
           FROM ereignis_meldung v
           JOIN objekte o     ON o.id = v.objekt_id
           JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
           LEFT JOIN ereignisart a ON a.id = v.ereignisart_id
          WHERE v.gesehen_am IS NULL", count($zeilen));
    foreach ($zeilen as $r) {
        $liste[] = [
            'typ' => 'vorfall', 'id' => (int)$r['id'], 'zeit' => $r['erfasst_am'],
            'person' => ['id' => (int)$r['mitarbeiter_id'], 'name' => $r['name'],
                         'vorname' => $r['vorname'], 'nachname' => $r['nachname']],
            'titel' => 'Ereignis gemeldet',
            'art' => $r['art'],
            'objekt_id' => (int)$r['objekt_id'], 'objekt' => $r['objekt_name'],
            'kunde' => $r['kunde_name'],
            'bemerkung' => $r['bemerkung'],
            'vorfall_am' => $r['vorfall_am'],
            'hat_foto' => $r['foto_mime'] !== null,
        ];
    }

    // ── Der Support hat geantwortet (ENT-685) ─────────────────────────
    //
    // Die einzige Art in diesem Feed, die NICHT aus den Betriebstabellen
    // kommt: Der Supportkanal liegt beim Betreiber (bei einem Mandanten mit
    // eigener Datenbank in seiner eigenen -- ENT-681). Darum die zweite
    // Verbindung, und darum sauber abgefangen: Ist sie nicht da, fehlt
    // diese Art und der Rest des Feeds steht trotzdem.
    //
    // NICHT ABHAKBAR ueber den Feed (kein Eintrag in EREIGNIS_ARTEN):
    // Gelesen ist eine Supportantwort erst, wenn jemand sie geoeffnet hat.
    // Ein Haken in der Glocke hiesse "weg damit", ohne dass der Text je
    // jemand gesehen haette -- genau der Fehler, den ein Fenster beim
    // Anmelden macht.
    if ($stamm !== null) {
        try {
            $zeilen = sv_kunde_ungelesen($stamm, $mandantId);
            $jeArt['support_antwort'] = count($zeilen);
            foreach ($zeilen as $v) {
                $liste[] = [
                    'typ'   => 'support_antwort',
                    'id'    => (int)$v['id'],
                    'zeit'  => $v['antwort_am'],
                    // Ohne Person: Geantwortet hat der Hersteller, nicht
                    // jemand aus dem Betrieb. Eine Personenzeile mit einem
                    // fremden Namen liesse den Feed so aussehen, als sei
                    // hier jemand aus der Mannschaft taetig gewesen.
                    'person' => ['id' => 0, 'name' => 'GuardOpS Support',
                                 'vorname' => '', 'nachname' => ''],
                    'titel' => 'Support hat geantwortet',
                    'betreff' => (string)$v['betreff'],
                    'status'  => (string)$v['status'],
                ];
            }
        } catch (Throwable $e) {
            $fehler[] = 'support';
        }
    }

    // Hier stand bis zum 23.08.2026 eine vierte Abfrage: vergangene Schichten
    // ohne Abgleich. Sie ist mit Absicht weg -- siehe Festlegung 3.

    // Neueste zuerst. Ein leerer Zeitstempel sortiert nach hinten statt eine
    // Ausnahme zu werfen.
    usort($liste, fn($a, $b) => strcmp((string)($b['zeit'] ?? ''), (string)($a['zeit'] ?? '')));
    // Die echte Zahl, nicht die Laenge der je Art abgeschnittenen Liste
    // (siehe ereignis_zaehlen).
    $gesamt = max(array_sum($jeArt), count($liste));

    return [
        'ereignisse' => array_slice($liste, 0, $grenze),
        'gesamt'     => $gesamt,
        // Wurde die Liste abgeschnitten? Eine stillschweigend gekuerzte Liste
        // liest sich wie eine vollstaendige.
        'gekuerzt'   => $gesamt > $grenze,
        // Dieselbe Zahl je Art. Die Glocke zaehlt daraus nur die Arten, die
        // sie auch anzeigen kann -- eine Art, die gezaehlt, aber nie als Zeile
        // gezeigt wird, ergibt eine Zahl ueber einer leeren Liste.
        'je_art'     => $jeArt,
        // Welche Arten gar nicht abgefragt werden konnten. Leer ist gut;
        // nicht leer heisst: hier fehlt etwas, und zwar bekannt.
        'unvollstaendig' => $fehler,
    ];
}
