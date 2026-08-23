<?php
// Ereignis-Feed der Uebersicht (ENT-089).
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
//  3. EIN EREIGNIS, DAS SICH VON SELBST ERLEDIGT, BRAUCHT KEINE MARKIERUNG.
//     Der offene Abgleich verschwindet, sobald abgeglichen wurde. Ihn
//     zusaetzlich abhaken zu koennen, hiesse: er ist weg, obwohl die Arbeit
//     noch aussteht. Genau das darf ein Feed nicht koennen.
declare(strict_types=1);

// Welche Arten es gibt und ob sie sich abhaken lassen. EINE Liste --
// der Endpunkt zum Abhaken befragt sie, statt eine zweite zu fuehren.
const EREIGNIS_ARTEN = [
    'rapport'  => ['tabelle' => 'rapporte',          'spalte' => 'gesehen_am'],
    'sperrtag' => ['tabelle' => 'verfuegbarkeiten',  'spalte' => 'gesehen_am'],
    'zusage'   => ['tabelle' => 'einsatz_zuteilung', 'spalte' => 'zusage_gesehen_am'],
    // 'abgleich' fehlt hier mit Absicht -- siehe Festlegung 3.
];

function ereignis_abhakbar(string $typ): bool
{
    return isset(EREIGNIS_ARTEN[$typ]);
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

function ereignisse_sammeln(PDO $pdo, int $grenze = 12): array
{
    $fehler = [];
    $liste  = [];

    // ── Rapport eingegangen. Der Hauptfall: Der Mitarbeitende hat gemeldet,
    // die Verwaltung muss es ansehen.
    foreach (ereignis_lesen($pdo,
        "SELECT r.id, r.datum, r.kunde, r.ort, r.einsatzart, r.netto_h, r.erfasst_am,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM rapporte r JOIN mitarbeiter m ON m.id = r.mitarbeiter_id
          WHERE r.gesehen_am IS NULL
          ORDER BY r.erfasst_am DESC, r.id DESC LIMIT 20", $fehler, 'rapport') as $r) {
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
    foreach (ereignis_lesen($pdo,
        "SELECT v.id, v.datum, v.bemerkung, v.erfasst_am,
                m.id AS mitarbeiter_id, m.name, m.vorname, m.nachname
           FROM verfuegbarkeiten v JOIN mitarbeiter m ON m.id = v.mitarbeiter_id
          WHERE v.datum >= CURDATE() AND v.gesehen_am IS NULL
          ORDER BY v.erfasst_am DESC LIMIT 20", $fehler, 'sperrtag') as $v) {
        $liste[] = [
            'typ' => 'sperrtag', 'id' => (int)$v['id'], 'zeit' => $v['erfasst_am'],
            'person' => ['id' => (int)$v['mitarbeiter_id'], 'name' => $v['name'],
                         'vorname' => $v['vorname'], 'nachname' => $v['nachname']],
            'titel' => 'Tag gesperrt',
            'datum' => $v['datum'], 'bemerkung' => $v['bemerkung'],
        ];
    }

    // ── Zusage oder Absage zu einer Schicht.
    foreach (ereignis_lesen($pdo,
        "SELECT z.einsatz_id, z.mitarbeiter_id, z.zusage, z.zugeteilt_am,
                e.datum, e.von, e.bis, e.kunde_name, e.titel AS einsatz_titel, e.ort,
                m.name, m.vorname, m.nachname
           FROM einsatz_zuteilung z
           JOIN einsaetze e   ON e.id = z.einsatz_id
           JOIN mitarbeiter m ON m.id = z.mitarbeiter_id
          WHERE z.zusage <> 'offen' AND z.zusage_gesehen_am IS NULL
          ORDER BY z.zugeteilt_am DESC LIMIT 20", $fehler, 'zusage') as $z) {
        $liste[] = [
            'typ' => 'zusage', 'id' => (int)$z['einsatz_id'],
            'mitarbeiter_id' => (int)$z['mitarbeiter_id'], 'zeit' => $z['zugeteilt_am'],
            'person' => ['id' => (int)$z['mitarbeiter_id'], 'name' => $z['name'],
                         'vorname' => $z['vorname'], 'nachname' => $z['nachname']],
            'titel' => $z['zusage'] === 'abgesagt' ? 'Schicht abgesagt' : 'Schicht zugesagt',
            'zusage' => $z['zusage'], 'datum' => $z['datum'],
            'von' => $z['von'], 'bis' => $z['bis'],
            'kunde' => $z['kunde_name'], 'einsatz_titel' => $z['einsatz_titel'], 'ort' => $z['ort'],
        ];
    }

    // ── Schicht vorbei, aber nicht abgeglichen. Kein Abhaken moeglich: Der
    // Eintrag verschwindet, wenn abgeglichen wurde, und nur dann.
    foreach (ereignis_lesen($pdo,
        "SELECT e.id, e.datum, e.von, e.bis, e.kunde_name, e.titel AS einsatz_titel, e.ort
           FROM einsaetze e
          WHERE e.datum < CURDATE() AND e.status <> 'abgesagt' AND e.ist_status = 'offen'
          ORDER BY e.datum DESC LIMIT 20", $fehler, 'abgleich') as $e) {
        $liste[] = [
            'typ' => 'abgleich', 'id' => (int)$e['id'], 'zeit' => $e['datum'] . ' 23:59:59',
            'titel' => 'Abgleich offen',
            'datum' => $e['datum'], 'von' => $e['von'], 'bis' => $e['bis'],
            'kunde' => $e['kunde_name'], 'einsatz_titel' => $e['einsatz_titel'], 'ort' => $e['ort'],
        ];
    }

    // Neueste zuerst. Ein leerer Zeitstempel sortiert nach hinten statt eine
    // Ausnahme zu werfen.
    usort($liste, fn($a, $b) => strcmp((string)($b['zeit'] ?? ''), (string)($a['zeit'] ?? '')));
    $gesamt = count($liste);

    return [
        'ereignisse' => array_slice($liste, 0, $grenze),
        'gesamt'     => $gesamt,
        // Wurde die Liste abgeschnitten? Eine stillschweigend gekuerzte Liste
        // liest sich wie eine vollstaendige.
        'gekuerzt'   => $gesamt > $grenze,
        // Welche Arten gar nicht abgefragt werden konnten. Leer ist gut;
        // nicht leer heisst: hier fehlt etwas, und zwar bekannt.
        'unvollstaendig' => $fehler,
    ];
}
