<?php
declare(strict_types=1);
// Die Neuerungsliste (ENT-698).
//
// WARUM EINE GEPFLEGTE LISTE und nicht die Einrichtungsschritte: Ein
// Schritt wie "Spalte mitarbeiter.x angelegt" sagt niemandem etwas, und
// eine Fehlerbehebung im Code erzeugt gar keinen Schritt -- sie erschiene
// nie. Was hier steht, ist fuer Menschen geschrieben.
//
// PFLEGE: Jeder Push, den jemand in der Oberflaeche bemerkt, bekommt hier
// einen Eintrag. Oben anfuegen, die Nummer um eins hoeher als die bisher
// hoechste. Nummern werden NIE wiederverwendet oder umgeschrieben: Am Konto
// steht, bis zu welcher Nummer jemand gelesen hat, und eine verschobene
// Nummer zeigte Alten Neues oder verschluckte Neues.
//
// 'fuer' sagt, wo der Eintrag erscheint:
//   cockpit   -- Verwaltungsoberflaeche (Desktop und Handy)
//   app       -- App der Mitarbeitenden
//   betreiber -- Betreiberbereich
// Ohne Datenbank, damit sie sich fuer sich allein pruefen laesst.

const NEUERUNG_ARTEN = [
    'neu'            => 'Neu',
    'verbesserung'   => 'Verbesserung',
    'fehlerbehebung' => 'Fehlerbehebung',
];
const NEUERUNG_ZIELE = ['cockpit', 'app', 'betreiber'];

function neuerungen_katalog(): array
{
    return [
        [
            'nr'    => 11,
            'datum' => '2026-09-24',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Eigener Reiter für den Vorrat',
            'text'  => 'Unter Mandanten → Vorrat legst du vorbereitete Anlagen an, siehst je Platz, ob er bereit ist, und teilst ihn in einem Schritt einem neuen Kunden zu. Ein oranger Punkt am Reiter zeigt, wenn weniger als zwei Plätze bereit sind. Vorratsplätze stehen nicht mehr in der Mandantenliste.',
        ],
        [
            'nr'    => 10,
            'datum' => '2026-09-24',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Deine Unterschrift auf Offerten und Verträgen',
            'text'  => 'Zeichne deine Unterschrift einmal unter Konten → dein Konto. Sie steht danach auf jeder Offerte und jedem Vertrag, die du freigibst. Ohne sie lässt sich nichts freigeben. Die Unterschrift des Kunden erscheint im PDF grösser und kräftiger.',
        ],
        [
            'nr'    => 9,
            'datum' => '2026-09-24',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['betreiber'],
            'titel' => 'Updates erscheinen sofort und vollständig',
            'text'  => 'Das Update-Fenster kommt jetzt gleich beim Öffnen, auch wenn die Prüfung aller Mandanten noch läuft. Es zeigt jede Neuerung, auch die fürs Cockpit oder die App, mit dem Vermerk, wo sie gilt.',
        ],
        [
            'nr'    => 8,
            'datum' => '2026-09-23',
            'art'   => 'neu',
            'fuer'  => ['betreiber'],
            'titel' => 'Zugang per Einladung, Zeilen zum Ausklappen',
            'text'  => 'Den ersten Zugang eines Betriebs gibt es jetzt per Einladungslink an eine benannte Person, sieben Tage gültig. Unter „Einrichtung“ steht, ob die Einladung offen, eingelöst oder abgelaufen ist. Die Knöpfe in den Tabellen liegen neu in der ausgeklappten Zeile – ein Klick auf die Zeile öffnet sie.',
        ],
        [
            'nr'    => 7,
            'datum' => '2026-09-23',
            'art'   => 'neu',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Verlauf an jeder Offerte',
            'text'  => 'Unter dem Formular steht jetzt, wer die Offerte wann gesendet oder geändert hat und was der Empfänger getan hat: Code angefordert, angenommen, abgelehnt, Änderungswunsch.',
        ],
        [
            'nr'    => 6,
            'datum' => '2026-09-23',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => '„Neuer Einsatz“ fragt beim Revierdienst nach',
            'text'  => 'Fehlt einer eingeteilten Person die Revierdienst-Berechtigung, fragt die Maske jetzt nach, wie beim Bearbeiten eines Einsatzes. Mit „Trotzdem zuteilen“ wird der Einsatz angelegt.',
        ],
        [
            'nr'    => 5,
            'datum' => '2026-09-23',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Updates mit Fortschrittsbalken',
            'text'  => '„Jetzt einspielen“ zeigt Schritt für Schritt, wie weit das Update ist. Danach steht nur noch da, was nicht geklappt hat.',
        ],
        [
            'nr'    => 4,
            'datum' => '2026-09-23',
            'art'   => 'verbesserung',
            'fuer'  => ['betreiber'],
            'titel' => 'Demo-Zugänge bekommen alle Rollen',
            'text'  => 'Ein neuer Demo-Zugang erhält jede Rolle. Bestehende Zugänge bekommen die fehlenden Rollen mit dem nächsten Einspielen des Updates.',
        ],
        [
            'nr'    => 3,
            'datum' => '2026-09-23',
            'art'   => 'fehlerbehebung',
            'fuer'  => ['cockpit'],
            'titel' => '„Neuer Einsatz“ nennt den Grund',
            'text'  => 'Lässt sich ein Einsatz nicht anlegen, steht jetzt der Grund da statt nur „Anlegen fehlgeschlagen“.',
        ],
        [
            'nr'    => 2,
            'datum' => '2026-09-23',
            'art'   => 'verbesserung',
            'fuer'  => ['cockpit', 'betreiber'],
            'titel' => 'Fehlende Rechte werden benannt',
            'text'  => 'Fehlt deiner Rolle ein Recht, steht jetzt da, welches, und welche Rolle es mitbringt.',
        ],
        [
            'nr'    => 1,
            'datum' => '2026-09-23',
            'art'   => 'neu',
            'fuer'  => ['cockpit', 'app', 'betreiber'],
            'titel' => 'Neuerungen erscheinen hier',
            'text'  => 'Was sich an GuardOpS ändert, siehst du ab jetzt in diesem Fenster, einmal pro Neuerung.',
        ],
    ];
}

function neuerungen_neueste(): int
{
    $hoechste = 0;
    foreach (neuerungen_katalog() as $n) { $hoechste = max($hoechste, (int)$n['nr']); }
    return $hoechste;
}

// Alles Ungelesene, gleich fuer welche Oberflaeche -- fuer den Betreiber
// (2026-09-24, Anordnung des Projektinhabers): Als Betreiberin der
// Plattform muss die pzu jedes ausgerollte Update sehen, auch eines, das
// nur im Cockpit oder in der App gilt. 'fuer' bleibt am Eintrag, damit das
// Fenster sagen kann, wo es gilt.
function neuerungen_alle(int $gesehenBis): array
{
    $aus = [];
    foreach (neuerungen_katalog() as $n) {
        if ((int)$n['nr'] <= $gesehenBis) { continue; }
        $aus[] = $n + ['art_titel' => NEUERUNG_ARTEN[$n['art']] ?? $n['art']];
    }
    usort($aus, static fn($a, $b) => (int)$b['nr'] <=> (int)$a['nr']);
    return $aus;
}

// Was diese Person noch nicht gesehen hat, fuer diese Oberflaeche, das
// Neueste zuerst. Mit dem Anzeigenamen der Art, damit keine Oberflaeche
// ihn ein zweites Mal fuehren muss.
function neuerungen_fuer(string $ziel, int $gesehenBis): array
{
    $aus = [];
    foreach (neuerungen_katalog() as $n) {
        if ((int)$n['nr'] <= $gesehenBis) { continue; }
        if (!in_array($ziel, $n['fuer'], true)) { continue; }
        $aus[] = $n + ['art_titel' => NEUERUNG_ARTEN[$n['art']] ?? $n['art']];
    }
    usort($aus, static fn($a, $b) => (int)$b['nr'] <=> (int)$a['nr']);
    return $aus;
}
