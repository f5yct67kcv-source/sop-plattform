<?php
declare(strict_types=1);
require __DIR__ . '/../db.php';
require_once __DIR__ . '/../rechte.php';
require __DIR__ . '/../mitarbeiter.php';

$user = require_session();
require_recht($user, 'personal_lesen');

$pdo = db();

// Gelesen wird dieselbe Feldliste, die auch geschrieben wird (ENT-072) --
// begrenzt auf die Spalten, die es in der Datenbank wirklich gibt. Solange
// die Einrichtung nicht gelaufen ist, fehlen die neuen Felder in der Antwort,
// statt dass die Abfrage scheitert.
// NUR die Felder der Liste, nicht das ganze Dossier. Die Sammelabfrage darf
// keine Personalakte werden -- siehe ma_listenfelder() in mitarbeiter.php.
$vorhanden = ma_vorhandene_felder($pdo);
$felder = array_values(array_intersect(ma_listenfelder(), array_keys($vorhanden)));
$fest = ['id', 'name', 'ist_admin', 'aktiv', 'erstellt_am'];
foreach (['letzter_zugriff', 'passwort_geaendert_am'] as $z) {
    if (ma_spalte_da($pdo, $z)) { $fest[] = $z; }
}

$rows = $pdo->query(
    'SELECT ' . implode(', ', array_merge($fest, $felder)) . '
     FROM mitarbeiter WHERE aktiv = 1 ORDER BY name'
)->fetchAll(PDO::FETCH_ASSOC);

// Die beiden pflegbaren Listen kommen mit, damit die Oberflaeche aus einer
// Id einen Namen machen kann, ohne dafuer eine zweite Anfrage zu stellen.
$listen = [];
foreach (MA_LISTEN as $art => $tabelle) {
    $listen[$art] = hat_tabelle_ma($pdo, $tabelle)
        ? $pdo->query("SELECT id, bezeichnung FROM $tabelle WHERE aktiv = 1
                       ORDER BY sortierung, bezeichnung")->fetchAll(PDO::FETCH_ASSOC)
        : [];
    $listen[$art] = array_map(fn($z) => ['id' => (int)$z['id'], 'bezeichnung' => $z['bezeichnung']], $listen[$art]);
}

// Rollen aller Personen in einer Abfrage -- eine je Zeile waere bei 40
// Mitarbeitenden 40 Abfragen fuer eine Liste (ENT-077).
$rollenKarte = rechte_rollen_alle(db());

$rows = array_map(function ($r) use ($rollenKarte) {
    // id wird fuer die Zuteilung in der Einsatzplanung gebraucht (ENT-020).
    $r['id'] = (int)$r['id'];
    $r['ist_admin'] = (bool)$r['ist_admin'];
    $r['rollen'] = $rollenKarte[$r['id']]
        ?? [$r['ist_admin'] ? ROLLE_VERWALTUNG : ROLLE_MITARBEITEND];
    foreach (['funktion_id', 'abteilung_id', 'anstellungsort_id', 'pensum_stunden'] as $z) {
        if (array_key_exists($z, $r)) { $r[$z] = $r[$z] === null ? null : (int)$r[$z]; }
    }
    return $r;
}, $rows);

json_response(['status' => 'ok', 'mitarbeiter' => $rows, 'listen' => $listen,
    'darf_aendern' => darf($user, 'personal_schreiben'),
    'darf_rollen'  => darf($user, 'rechte_schreiben'),
    // Ohne die Rollentabelle liefert rechte_rollen_alle() nichts, und jede
    // Person bekommt oben den Rueckfallwert aus ist_admin. Das SIEHT AUS
    // wie ein echter Rollenstand -- ist aber nur eine Notannahme. Die
    // Oberflaeche muss den Unterschied hinschreiben koennen, sonst wirkt
    // eine nicht gelaufene Einrichtung wie eine erledigte.
    // Die Profile mit Namen (ENT-440). Ohne sie muesste die Oberflaeche die
    // Titel aus einer eigenen Liste holen -- die kennt aber nur die fuenf
    // Systemrollen und wuerde jedes eigene Profil als rohen Schluessel
    // anzeigen ("disposition_2" statt "Disposition ohne Kundenpflege").
    'profile' => rollen_kurzliste($pdo),
    'rollen_eingerichtet' => rechte_tabelle_da($pdo),
    'eingerichtet' => array_key_exists('ahv_nr', $vorhanden)]);
