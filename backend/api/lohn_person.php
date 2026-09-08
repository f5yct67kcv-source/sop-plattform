<?php
// Lohnstammdaten einer Person (ENT-451).
//
// GET  ?id=<mitarbeiter_id>  -> Ansaetze, Abzugsparameter, Zahlungswege und
//                               die daraus abgeleiteten GAV-Groessen
// POST -> {id, was: 'ansatz'|'abzug'|'zahlung', ...} anlegen/aendern,
//         mit {loeschen:true} entfernen
//
// HISTORISIERT: 'ansatz' und 'abzug' werden nie ueberschrieben, sondern je
// Gueltigkeitsdatum als neue Zeile gefuehrt. Eine Ansatzerhoehung darf
// abgeschlossene Abrechnungen nicht rueckwirkend veraendern (CLAUDE.md
// Teil B). Ein zweites Speichern zum SELBEN gueltig_ab korrigiert die
// bestehende Zeile -- das ist die Tippfehler-Korrektur, kein Ueberschreiben
// eines anderen Zeitraums.
//
// WAS HIER NICHT HERAUSGEHT: das Geburtsdatum. Es ist ein vertrauliches
// Personalfeld (ma_vertrauliche_felder), und der Lohnbereich hat ein
// eigenes Recht. Die Ferienentschaedigung nach Art. 20 Ziff. 2 und die
// BVG-Eintrittsschwelle nach Art. 25 Ziff. 3 haengen daran -- geliefert
// wird darum das ERGEBNIS (Satz, Datum ab wann), nie die Grundlage.
// Dasselbe gilt fuer die AHV-Nummer: Der Lohnbereich erfaehrt nur, OB sie
// erfasst ist, denn ohne sie ist keine Abrechnung moeglich.
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require_once __DIR__ . '/../planung.php';
require_once __DIR__ . '/../mitarbeiter.php';
require_once __DIR__ . '/../lohn.php';
// Fuer die GERECHNETE NBU-Unterstellung (Empfehlung 7/87). Sie steht neben
// der erfassten Uebersteuerung, damit niemand blind uebersteuert: Ohne den
// Vergleich sieht man nicht, ob man der Rechnung widerspricht oder ihr
// zustimmt.
require_once __DIR__ . '/../gavzeit.php';
require_once __DIR__ . '/../lohnlauf.php';

$user = require_session();
require_recht($user, 'lohn_lesen');

function lohn_person_id(): int
{
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) {
        $eingabe = json_decode(file_get_contents('php://input'), true) ?? [];
        $id = (int)($eingabe['id'] ?? 0);
    }
    return $id;
}

// Alles zu einer Person: erfasste Stammdaten und die daraus abgeleiteten
// GAV-Groessen. Die Ableitungen stehen bewusst NEBEN den erfassten Werten
// und nicht in sie hineingerechnet -- sonst liesse sich spaeter nicht mehr
// sagen, was jemand eingegeben und was das Regelwerk beigesteuert hat.
function lohn_person_lesen(int $id, string $stichtag): array
{
    $pdo = db();
    $st = $pdo->prepare(
        'SELECT id, vorname, nachname, name, personalnummer, anstellungskategorie,
                pensum_stunden, eintritt, austritt, geburtsdatum, ahv_nr
         FROM mitarbeiter WHERE id = ?'
    );
    $st->execute([$id]);
    $ma = $st->fetch();
    if (!$ma) { return ['status' => 'error', 'message' => 'Person nicht gefunden']; }

    $kategorie = kategorie_pruefen($ma['anstellungskategorie']);
    $pensum    = $ma['pensum_stunden'] === null ? null : (int)$ma['pensum_stunden'];
    $form      = lohn_form($kategorie);

    $mindest = lohn_mindestlohn($kategorie, $ma['eintritt'], $stichtag);
    $mindest = lohn_mindestlohn_pensum($mindest, $pensum);
    $ferien  = lohn_ferienentschaedigung_bp($ma['geburtsdatum'], $stichtag);

    $ansaetze = $pdo->prepare(
        'SELECT * FROM lohn_ansatz WHERE mitarbeiter_id = ? ORDER BY gueltig_ab DESC'
    );
    $ansaetze->execute([$id]);
    $abzuege = $pdo->prepare(
        'SELECT * FROM lohn_person WHERE mitarbeiter_id = ? ORDER BY gueltig_ab DESC'
    );
    $abzuege->execute([$id]);
    $zahlungen = $pdo->prepare(
        'SELECT * FROM lohn_zahlung WHERE mitarbeiter_id = ? ORDER BY aktiv DESC, reihenfolge'
    );
    $zahlungen->execute([$id]);

    $ansatzListe = array_map(function ($r) {
        foreach (['id','mitarbeiter_id','ansatz_rappen','ferien_laufend','ml13_bp',
                  'zuschlag_fachausweis_rappen','zuschlag_hund_rappen',
                  'zuschlag_waffe_rappen'] as $f) {
            if (isset($r[$f]) && $r[$f] !== null) { $r[$f] = (int)$r[$f]; }
        }
        return $r;
    }, $ansaetze->fetchAll());

    // Der zum Stichtag geltende Ansatz -- die juengste Zeile, die nicht in
    // der Zukunft liegt. Ein kuenftiger Ansatz ist erfasst, aber noch nicht
    // gueltig; er darf den heutigen nicht verdraengen.
    $aktuell = null;
    foreach ($ansatzListe as $a) {
        if ($a['gueltig_ab'] <= $stichtag) { $aktuell = $a; break; }
    }

    // Mindestlohnpruefung. Sie WARNT und blockiert nicht: Ein Ansatz unter
    // dem Mindestlohn kann eine Fehleingabe sein, aber auch ein Fall, den
    // der GAV zulaesst (Anhang 1, Anmerkung 2 zu Kategorie A: bis CHF 150
    // pro Monat weniger fuer unter 25-Jaehrige -- eine Kann-Bestimmung, die
    // das Werkzeug nie von sich aus anwendet). Wer sie wegklickt, hat sie
    // gesehen; wer sie nie sieht, zahlt unter Tarif, ohne es zu merken.
    $warnung = null;
    if ($aktuell && $mindest['wert'] !== null) {
        $gleicheEinheit = ($mindest['einheit'] === 'stunde' && $form === LOHN_FORM_STUNDE)
                       || ($mindest['einheit'] === 'jahr'   && $form === LOHN_FORM_MONAT);
        if ($gleicheEinheit) {
            // Beim Monatslohn wird der Jahresmindestlohn auf den Monat
            // heruntergebrochen, weil der Ansatz ein Monatsbetrag ist.
            $vergleich = $mindest['einheit'] === 'jahr'
                ? lohn_rappen($mindest['wert'] / 12) : $mindest['wert'];
            if ($aktuell['ansatz_rappen'] < $vergleich) {
                $warnung = [
                    'art' => 'unter_mindestlohn',
                    'text' => 'Der erfasste Ansatz liegt unter dem GAV-Mindestlohn ('
                            . number_format($vergleich / 100, 2, '.', '\'') . ' CHF '
                            . ($mindest['einheit'] === 'jahr' ? 'pro Monat' : 'pro Stunde') . ').',
                    'mindest_rappen' => $vergleich,
                ];
            }
        }
    }

    // Die Unterstellung, wie sie das Werkzeug HEUTE rechnet -- unabhaengig
    // davon, ob jemand sie uebersteuert hat. lohnlauf_nbu() liefert bei
    // gesetzter Uebersteuerung diese zurueck; fuer den Vergleich in der
    // Maske wird darum die reine Rechnung gebraucht. Sie entsteht nur, wenn
    // es fuer das Jahr ein UVG-Regelwerk gibt.
    $nbuGerechnet = null;
    $uvgRw = lohn_uvg($stichtag);
    if ($uvgRw !== null) {
        $fenster = [];
        foreach (LOHN_NBU_FENSTER_MONATE as $monate) {
            $w = lohnlauf_nbu_wochen($pdo, $id, $stichtag, $monate);
            $e = lohn_nbu_ermittlung($w['liste'], $uvgRw, (int)($w['ausfalltage'] ?? 0));
            $e['zeitraum'] = ['von' => $w['von'], 'bis' => $w['bis'], 'monate' => $monate];
            $fenster[$monate] = $e;
        }
        $nbuGerechnet = lohn_nbu_unterstellung($fenster, $uvgRw);
    }

    return [
        'status' => 'ok',
        'nbu' => $nbuGerechnet,
        'person' => [
            'id' => (int)$ma['id'],
            'name' => trim(($ma['vorname'] ?? '') . ' ' . ($ma['nachname'] ?? '')) ?: $ma['name'],
            'personalnummer' => $ma['personalnummer'],
            'kategorie' => $kategorie,
            'pensum_stunden' => $pensum,
            'eintritt' => $ma['eintritt'],
            'austritt' => $ma['austritt'],
            // Nur ob, nicht was. Ohne AHV-Nummer ist keine Abrechnung
            // moeglich -- das muss der Lohnbereich wissen, ohne die Nummer
            // selbst zu bekommen.
            'ahv_erfasst' => (string)($ma['ahv_nr'] ?? '') !== '',
        ],
        'abgeleitet' => [
            'stichtag' => $stichtag,
            'lohnform' => $form,
            'lohnform_text' => $form === LOHN_FORM_MONAT
                ? 'Monatslohn (Art. 8: Kategorie ' . $kategorie . ')'
                : ($form === LOHN_FORM_STUNDE
                    ? 'Stundenlohn (Art. 8: Kategorie C)'
                    : 'Unbekannt — ohne Anstellungskategorie nach Art. 8 keine Lohnform'),
            'dienstjahr' => lohn_dienstjahr($ma['eintritt'], $stichtag),
            'mindestlohn' => $mindest,
            'ferienentschaedigung' => $ferien,
            'bvg_pflichtig_ab' => lohn_bvg_pflichtig_ab($ma['geburtsdatum']),
        ],
        'ansaetze' => $ansatzListe,
        'ansatz_aktuell' => $aktuell,
        'abzuege' => $abzuege->fetchAll(),
        'zahlungen' => $zahlungen->fetchAll(),
        'warnung' => $warnung,
    ];
}

$stichtag = (string)($_GET['stichtag'] ?? date('Y-m-d'));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $stichtag)) { $stichtag = date('Y-m-d'); }

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = lohn_person_id();
    if ($id <= 0) { json_response(['status' => 'error', 'message' => 'id fehlt'], 400); }
    json_response(lohn_person_lesen($id, $stichtag));
}

require_recht($user, 'lohn_schreiben');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['status' => 'error', 'message' => 'nur GET oder POST'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id  = (int)($input['id'] ?? 0);
$was = (string)($input['was'] ?? '');
if ($id <= 0)  { json_response(['status' => 'error', 'message' => 'id fehlt'], 400); }
if (!in_array($was, ['ansatz', 'abzug', 'zahlung'], true)) {
    json_response(['status' => 'error', 'message' => 'was: ansatz, abzug oder zahlung'], 400);
}
$pdo = db();

// Rappen aus einer Eingabe. Erlaubt sind "25.00", "25", "25,00" -- was ein
// Mensch tippt. Leer und null bleiben null; 0 ist ein Wert, keine Leere.
function lohn_rappen_aus($roh): ?int
{
    if ($roh === null || $roh === '') { return null; }
    $t = str_replace(["'", ' ', ','], ['', '', '.'], (string)$roh);
    if (!is_numeric($t)) { return null; }
    return lohn_rappen((float)$t * 100);
}

$loeschen = !empty($input['loeschen']);
$eintragId = (int)($input['eintrag_id'] ?? 0);

if ($loeschen) {
    $tabelle = ['ansatz' => 'lohn_ansatz', 'abzug' => 'lohn_person', 'zahlung' => 'lohn_zahlung'][$was];
    if ($eintragId <= 0) { json_response(['status' => 'error', 'message' => 'eintrag_id fehlt'], 400); }
    $del = $pdo->prepare("DELETE FROM $tabelle WHERE id = ? AND mitarbeiter_id = ?");
    $del->execute([$eintragId, $id]);
    json_response(lohn_person_lesen($id, $stichtag));
}

if ($was === 'ansatz') {
    $ab = (string)($input['gueltig_ab'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $ab)) {
        json_response(['status' => 'error', 'message' => 'Gültig ab: Datum erforderlich'], 400);
    }
    $rappen = lohn_rappen_aus($input['ansatz'] ?? null);
    if ($rappen === null || $rappen <= 0) {
        json_response(['status' => 'error', 'message' => 'Ansatz: Betrag erforderlich'], 400);
    }
    // Die Kategorie wird als Schnappschuss mitgeschrieben, nicht vom
    // Bedienenden erfragt: Sie steht in der Akte, und zwei Eingabestellen
    // fuer dieselbe Angabe waeren zwei Wahrheiten.
    $kat = $pdo->prepare('SELECT anstellungskategorie FROM mitarbeiter WHERE id = ?');
    $kat->execute([$id]);
    $kategorie = kategorie_pruefen($kat->fetchColumn() ?: null);

    // Art. 19: 'monat' oder 'stunde'. Was der GAV mit "oder" offen laesst,
    // steht im Vertrag und wird erfasst statt hergeleitet (GAV-AUS-014).
    $art = function ($w) { $w = strtolower(trim((string)$w)); 
        return in_array($w, ['monat', 'stunde'], true) ? $w : null; };

    $sql = 'INSERT INTO lohn_ansatz
              (mitarbeiter_id, gueltig_ab, kategorie, ansatz_rappen, ferien_laufend, ml13_bp,
               zuschlag_fachausweis_art, zuschlag_fachausweis_rappen,
               zuschlag_hund_art, zuschlag_hund_rappen,
               zuschlag_waffe_art, zuschlag_waffe_rappen, bemerkung, erfasst_von)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
              kategorie = VALUES(kategorie), ansatz_rappen = VALUES(ansatz_rappen),
              ferien_laufend = VALUES(ferien_laufend), ml13_bp = VALUES(ml13_bp),
              zuschlag_fachausweis_art = VALUES(zuschlag_fachausweis_art),
              zuschlag_fachausweis_rappen = VALUES(zuschlag_fachausweis_rappen),
              zuschlag_hund_art = VALUES(zuschlag_hund_art),
              zuschlag_hund_rappen = VALUES(zuschlag_hund_rappen),
              zuschlag_waffe_art = VALUES(zuschlag_waffe_art),
              zuschlag_waffe_rappen = VALUES(zuschlag_waffe_rappen),
              bemerkung = VALUES(bemerkung), erfasst_von = VALUES(erfasst_von)';
    $pdo->prepare($sql)->execute([
        $id, $ab, $kategorie, $rappen,
        !empty($input['ferien_laufend']) ? 1 : 0,
        isset($input['ml13_bp']) && $input['ml13_bp'] !== '' ? (int)$input['ml13_bp'] : null,
        $art($input['zuschlag_fachausweis_art'] ?? null),
        lohn_rappen_aus($input['zuschlag_fachausweis'] ?? null),
        $art($input['zuschlag_hund_art'] ?? null),
        lohn_rappen_aus($input['zuschlag_hund'] ?? null),
        $art($input['zuschlag_waffe_art'] ?? null),
        lohn_rappen_aus($input['zuschlag_waffe'] ?? null),
        trim((string)($input['bemerkung'] ?? '')) ?: null,
        (int)$user['id'],
    ]);
    json_response(lohn_person_lesen($id, $stichtag));
}

if ($was === 'abzug') {
    $ab = (string)($input['gueltig_ab'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $ab)) {
        json_response(['status' => 'error', 'message' => 'Gültig ab: Datum erforderlich'], 400);
    }
    $qstPflichtig = !empty($input['qst_pflichtig']);
    $qstKanton = strtoupper(trim((string)($input['qst_kanton'] ?? ''))) ?: null;
    // Quellensteuer ohne Kanton und Tarifcode ist nicht rechenbar. Lieber
    // hier abweisen als spaeter im Lohnlauf mit einem Nullabzug weiterlaufen
    // -- "unbekannt" darf nie wie "keine" aussehen.
    if ($qstPflichtig && (!$qstKanton || trim((string)($input['qst_tarifcode'] ?? '')) === '')) {
        json_response(['status' => 'error',
            'message' => 'Quellensteuerpflichtig: Kanton und Tarifcode sind erforderlich'], 400);
    }
    // Die NBU-Unterstellung ist DREIWERTIG: null heisst "automatisch nach
    // Empfehlung 7/87 aus den geleisteten Stunden", 1 und 0 sind eine
    // Uebersteuerung von Hand.
    //
    // Bis Etappe 4 stand hier ein blosses Haekchen mit `!empty(...) ? 1 : 0`.
    // Das schrieb bei JEDEM Speichern eine Uebersteuerung, vorbelegt auf
    // "versichert" -- also in Richtung Abzug, bei jeder Person, ohne dass es
    // jemand gewollt haette. Genau das Denken, das BGer 8C_644/2025 E. 5.4
    // verwirft: nicht die Vereinbarung zaehlt, sondern die geleisteten
    // Stunden.
    $nbuWahl = (string)($input['nbu_pflichtig'] ?? 'automatisch');
    $nbuGrund = trim((string)($input['nbu_grund'] ?? ''));
    if (!in_array($nbuWahl, ['automatisch', 'versichert', 'nicht'], true)) {
        json_response(['status' => 'error',
            'message' => 'Unterstellung: automatisch, versichert oder nicht'], 400);
    }
    // Eine Uebersteuerung ohne Begruendung ist spaeter nicht nachvollziehbar.
    // Art. 12 Ziff. 5 GAV verlangt eine nachvollziehbare Abrechnung -- und
    // wer eine gerechnete Unterstellung von Hand aendert, schuldet den Grund.
    if ($nbuWahl !== 'automatisch' && $nbuGrund === '') {
        json_response(['status' => 'error',
            'message' => 'Wer die Unterstellung von Hand setzt, muss sie begründen'], 400);
    }
    $nbuWert = $nbuWahl === 'automatisch' ? null : ($nbuWahl === 'versichert' ? 1 : 0);

    $sql = 'INSERT INTO lohn_person
              (mitarbeiter_id, gueltig_ab, nbu_pflichtig, nbu_grund, nbu_von, nbu_am,
               ktg_pflichtig, bvg_angeschlossen, bvg_beitrag_rappen,
               qst_pflichtig, qst_kanton, qst_tarifcode, qst_kinder, bemerkung, erfasst_von)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
              nbu_pflichtig = VALUES(nbu_pflichtig), nbu_grund = VALUES(nbu_grund),
              nbu_von = VALUES(nbu_von), nbu_am = VALUES(nbu_am),
              ktg_pflichtig = VALUES(ktg_pflichtig),
              bvg_angeschlossen = VALUES(bvg_angeschlossen),
              bvg_beitrag_rappen = VALUES(bvg_beitrag_rappen),
              qst_pflichtig = VALUES(qst_pflichtig), qst_kanton = VALUES(qst_kanton),
              qst_tarifcode = VALUES(qst_tarifcode), qst_kinder = VALUES(qst_kinder),
              bemerkung = VALUES(bemerkung), erfasst_von = VALUES(erfasst_von)';
    $pdo->prepare($sql)->execute([
        $id, $ab,
        $nbuWert,
        // Wer automatisch waehlt, loescht die Begruendung samt Protokoll mit
        // -- ein stehengebliebener Grund ohne Uebersteuerung waere eine
        // Aussage ueber etwas, das nicht mehr gilt.
        $nbuWert === null ? null : $nbuGrund,
        $nbuWert === null ? null : (int)$user['id'],
        $nbuWert === null ? null : date('Y-m-d H:i:s'),
        !empty($input['ktg_pflichtig']) ? 1 : 0,
        !empty($input['bvg_angeschlossen']) ? 1 : 0,
        lohn_rappen_aus($input['bvg_beitrag'] ?? null),
        $qstPflichtig ? 1 : 0,
        $qstPflichtig ? $qstKanton : null,
        $qstPflichtig ? (trim((string)($input['qst_tarifcode'] ?? '')) ?: null) : null,
        $qstPflichtig && $input['qst_kinder'] !== '' ? (int)($input['qst_kinder'] ?? 0) : null,
        trim((string)($input['bemerkung'] ?? '')) ?: null,
        (int)$user['id'],
    ]);
    json_response(lohn_person_lesen($id, $stichtag));
}

// ── Zahlung ──────────────────────────────────────────────────────────────
$iban = iban_pruefen((string)($input['iban'] ?? ''));
if ($iban === null) {
    json_response(['status' => 'error',
        'message' => 'IBAN: Prüfsumme stimmt nicht — bitte die Nummer kontrollieren'], 400);
}
$zart = strtolower(trim((string)($input['art'] ?? 'rest')));
if (!in_array($zart, ['fix', 'rest'], true)) { $zart = 'rest'; }
$betrag = $zart === 'fix' ? lohn_rappen_aus($input['betrag'] ?? null) : null;
if ($zart === 'fix' && ($betrag === null || $betrag <= 0)) {
    json_response(['status' => 'error',
        'message' => 'Fester Betrag: Zahl erforderlich'], 400);
}
// Genau ein Empfaenger bekommt den Rest. Zwei Rest-Zeilen liessen offen,
// wohin das Geld geht, und das faellt erst beim Zahlungslauf auf.
if ($zart === 'rest') {
    $andere = $pdo->prepare(
        "SELECT COUNT(*) FROM lohn_zahlung
         WHERE mitarbeiter_id = ? AND art = 'rest' AND aktiv = 1 AND id <> ?"
    );
    $andere->execute([$id, $eintragId]);
    if ((int)$andere->fetchColumn() > 0) {
        json_response(['status' => 'error',
            'message' => 'Es gibt bereits einen Empfänger für den Restbetrag — '
                       . 'weitere Empfänger brauchen einen festen Betrag'], 400);
    }
}
$felder = [
    $id, (int)($input['reihenfolge'] ?? 1), $zart, $betrag, $iban,
    trim((string)($input['empfaenger'] ?? '')) ?: null,
    trim((string)($input['bank'] ?? '')) ?: null,
    isset($input['aktiv']) && !$input['aktiv'] ? 0 : 1,
    trim((string)($input['bemerkung'] ?? '')) ?: null,
    (int)$user['id'],
];
if ($eintragId > 0) {
    $felder[] = $eintragId;
    $pdo->prepare(
        'UPDATE lohn_zahlung SET mitarbeiter_id = ?, reihenfolge = ?, art = ?, betrag_rappen = ?,
             iban = ?, empfaenger = ?, bank = ?, aktiv = ?, bemerkung = ?,
             geaendert_von = ?, geaendert_am = NOW()
         WHERE id = ?'
    )->execute($felder);
} else {
    $pdo->prepare(
        'INSERT INTO lohn_zahlung
           (mitarbeiter_id, reihenfolge, art, betrag_rappen, iban, empfaenger, bank,
            aktiv, bemerkung, geaendert_von, geaendert_am)
         VALUES (?,?,?,?,?,?,?,?,?,?,NOW())'
    )->execute($felder);
}
json_response(lohn_person_lesen($id, $stichtag));
