<?php
// Vorschau einer Kontrollrunde, BEVOR sie gestartet wird (ENT-294).
//
// Rein lesend: Dieser Endpunkt legt weder Einsatz noch Rundgang an. Genau
// das ist sein Zweck -- bis hierher entstand beim Antippen einer Runde
// sofort ein Einsatz samt Zuteilung (mein_rundgang_spontan_starten.php),
// weshalb blosses Nachschauen Karteileichen im Einsatzplan hinterliess.
// Wer nur die Adresse oder die Telefonnummer des Ansprechpartners braucht,
// soll das ohne Nebenwirkung tun koennen.
//
// Die Kontrollpunkt-Anzahl kommt bewusst aus derselben Filterlogik wie
// rundgang_kontrollpunkte_uebrig() (backend/rundgang.php), nur ohne den
// Scan-Abgleich, den es vor dem Start noch nicht geben kann: Eine Runde,
// der keine Punkte zugeordnet sind, meldet hier ehrlich 0 -- statt wie
// bisher erst nach dem Start in einer leeren Checkliste zu enden.
declare(strict_types=1);
require __DIR__ . '/../db.php';

$user = require_session();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['status' => 'error', 'message' => 'nur GET'], 405);
}

$vorlageId = (int)($_GET['vorlage_id'] ?? 0);
if ($vorlageId <= 0) {
    json_response(['status' => 'error', 'message' => 'vorlage_id erforderlich'], 422);
}

$pdo = db();

// Dieselbe Berechtigungsfrage wie in mein_rundgang_vorlagen_alle.php: wer
// nie Revierdienst macht, sieht auch keine Objektdaten fremder Runden.
$chk = $pdo->prepare(
    'SELECT COUNT(*) FROM einsatz_zuteilung z
      JOIN einsaetze e ON e.id = z.einsatz_id
      JOIN kontrollpunkt k ON k.objekt_id = e.objekt_id AND k.aktiv = 1
     WHERE z.mitarbeiter_id = ?'
);
$chk->execute([(int)$user['id']]);
if ((int)$chk->fetchColumn() === 0) {
    json_response(['status' => 'error', 'message' => 'Kein Zugriff auf die Rundgänge-Übersicht'], 403);
}

$stmt = $pdo->prepare(
    'SELECT v.id, v.name, v.fenster_von, v.fenster_bis,
            o.id AS objekt_id, o.name AS objekt_name, o.strasse, o.ort, o.kanton,
            o.bemerkung AS objekt_bemerkung, o.kunde_id, o.kunde_name
       FROM rundgang_vorlage v
       JOIN objekte o ON o.id = v.objekt_id
      WHERE v.id = ? AND v.aktiv = 1 AND o.aktiv = 1'
);
$stmt->execute([$vorlageId]);
$v = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$v) {
    json_response(['status' => 'error', 'message' => 'Diese Kontrollrunde gibt es nicht (mehr)'], 404);
}

// Kontrollpunkte der Runde -- Anzahl UND Bezeichnungen, damit die Vorschau
// zeigen kann, was einen erwartet, ohne dass dafuer ein Rundgang entsteht.
$kpStmt = $pdo->prepare(
    'SELECT k.id, k.bezeichnung, k.typ FROM kontrollpunkt k
       JOIN rundgang_vorlage_punkt p ON p.kontrollpunkt_id = k.id AND p.vorlage_id = ?
      WHERE k.objekt_id = ? AND k.aktiv = 1
      ORDER BY p.reihenfolge, k.id'
);
$kpStmt->execute([$vorlageId, (int)$v['objekt_id']]);
$kontrollpunkte = $kpStmt->fetchAll(PDO::FETCH_ASSOC);

// Laeuft fuer diese Person auf DIESER Vorlage schon eine Runde (ENT-298)?
// Die Seite ist nicht nur Vorschau vor dem Start, sondern auch der Ort, an
// den man waehrend der Runde zurueckkommt -- ohne diese Angabe koennte sie
// weder den Zustand zeigen noch "Rundgang pausieren" anbieten. Dieselbe
// Bedingung wie die Selbstkollisions-Erkennung in
// mein_rundgang_spontan_starten.php (ENT-290): eigene Person, gleiche
// Vorlage, noch nicht endgueltig beendet.
$lfStmt = $pdo->prepare(
    "SELECT id, einsatz_id, status, vorbereitet_am, pausiert_seit
       FROM rundgang
      WHERE mitarbeiter_id = ? AND rundgang_vorlage_id = ?
        AND status NOT IN ('abgeschlossen', 'abgebrochen')
      ORDER BY id DESC LIMIT 1"
);
$lfStmt->execute([(int)$user['id'], $vorlageId]);
$lf = $lfStmt->fetch(PDO::FETCH_ASSOC);
$laufend = $lf ? [
    'id'             => (int)$lf['id'],
    'einsatz_id'     => (int)$lf['einsatz_id'],
    'status'         => $lf['status'],
    'vorbereitet_am' => $lf['vorbereitet_am'],
    'pausiert_seit'  => $lf['pausiert_seit'],
] : null;

// Ansprechpartner: am Objekt selbst gibt es keine (die objekte-Tabelle
// kennt nur Adressfelder) -- die Personen haengen am Kunden, mit ihren
// Kontaktwegen in einer eigenen Tabelle. Firmen-Kontaktwege (person_id
// NULL) kommen als eigener Eintrag ohne Namen mit: eine allgemeine
// Zentralnummer ist nachts oft der einzige erreichbare Weg.
$ansprechpartner = [];
if ($v['kunde_id'] !== null && hat_tabelle($pdo, 'kunden_person')) {
    $pStmt = $pdo->prepare(
        'SELECT id, anrede, vorname, nachname FROM kunden_person
          WHERE kunde_id = ? ORDER BY sortierung, id'
    );
    $pStmt->execute([(int)$v['kunde_id']]);
    $personen = $pStmt->fetchAll(PDO::FETCH_ASSOC);

    $wege = [];
    if (hat_tabelle($pdo, 'kunden_kontaktweg')) {
        $wStmt = $pdo->prepare(
            'SELECT person_id, art, wert FROM kunden_kontaktweg
              WHERE kunde_id = ? ORDER BY sortierung, id'
        );
        $wStmt->execute([(int)$v['kunde_id']]);
        foreach ($wStmt->fetchAll(PDO::FETCH_ASSOC) as $w) {
            $schluessel = $w['person_id'] === null ? 'firma' : (string)(int)$w['person_id'];
            $wege[$schluessel][] = ['art' => $w['art'], 'wert' => $w['wert']];
        }
    }

    foreach ($personen as $p) {
        $name = trim(($p['vorname'] ?? '') . ' ' . ($p['nachname'] ?? ''));
        if ($name === '') { continue; }
        $ansprechpartner[] = [
            'name'   => $name,
            'anrede' => $p['anrede'] ?: null,
            'wege'   => $wege[(string)(int)$p['id']] ?? [],
        ];
    }
    if (!empty($wege['firma'])) {
        $ansprechpartner[] = ['name' => $v['kunde_name'], 'anrede' => null, 'wege' => $wege['firma']];
    }
}

// Eigene Zentrale (ENT-299): die Pikettnummer aus den Betrieb-Stammdaten,
// nicht die Buero-Nummer vom Briefkopf. Sie steht in der App ueber den
// oeffentlichen Notrufnummern -- wer im Objekt etwas vorfindet, meldet
// zuerst der eigenen Zentrale, ausser es brennt oder jemand ist verletzt.
//
// hat_spalte statt blindem SELECT: Der Endpunkt laeuft auch gegen eine
// Datenbank, in der die Einrichtung nach ENT-299 noch nicht gelaufen ist.
// Ohne diese Pruefung faele dort die ganze Rundgang-Vorschau aus -- wegen
// einer Nebenangabe.
$zentrale = null;
if (hat_tabelle($pdo, 'betrieb') && hat_spalte($pdo, 'betrieb', 'pikett_telefon')) {
    $bz = $pdo->query('SELECT firma, pikett_telefon FROM betrieb WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
    if ($bz && trim((string)$bz['pikett_telefon']) !== '') {
        $zentrale = [
            'name'    => trim((string)$bz['firma']) !== '' ? trim((string)$bz['firma']) : null,
            'telefon' => trim((string)$bz['pikett_telefon']),
        ];
    }
}

json_response(['status' => 'ok',
    'vorlage' => [
        'id'          => (int)$v['id'],
        'name'        => $v['name'],
        'fenster_von' => $v['fenster_von'],
        'fenster_bis' => $v['fenster_bis'],
    ],
    'objekt' => [
        'id'        => (int)$v['objekt_id'],
        'name'      => $v['objekt_name'],
        'strasse'   => $v['strasse'],
        'ort'       => $v['ort'],
        'kanton'    => $v['kanton'],
        'bemerkung' => $v['objekt_bemerkung'],
    ],
    'kunde_name'      => $v['kunde_name'],
    'kontrollpunkte'  => $kontrollpunkte,
    'ansprechpartner' => $ansprechpartner,
    'laufend'         => $laufend,
    'zentrale'        => $zentrale,
]);
