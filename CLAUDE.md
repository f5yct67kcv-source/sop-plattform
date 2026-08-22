# CLAUDE.md — Arbeitsregeln für dieses Repository

Internes Werkzeug der CUPI 24 GmbH. Entwickelt unter der Ausnahme aus
ENT-008/ENT-012 (rein interne Nutzung, kein Verkauf). Die Projektregeln,
das Entscheidungsprotokoll und die offenen Punkte liegen im **Projekt-
Repository** (`sop-projekt`), nicht hier.

**Am Projekt arbeiten mehrere Sitzungen gleichzeitig.** Alles unten folgt
daraus.

**Lies zu Beginn ausserdem `STARTPROMPT.md`.** Dort steht, wie die Arbeit auf
mehrere Sitzungen geschnitten wird: ein Chat, eine Aufgabe; welche Bereiche es
gibt und welche Dateien dazugehoeren; was querliegend ist und allein laufen
muss; und was vor dem Schliessen eines Chats zu tun ist. Sagt der Projektinhaber
nur einen Bereich und eine Aufgabe, findest du den Rest dort — frag nicht nach,
was dort schon steht.

---

## Vor der Arbeit

1. `git fetch origin main` und den Rückstand ansehen — **am Anfang**, nicht
   erst vor dem Commit. Wer stundenlang auf einem alten Stand baut, merkt
   den Konflikt zuletzt.
2. Den eigenen **Bereich** klären (steht im Startprompt der Sitzung). Was
   ausserhalb liegt, wird gelesen, nicht geändert.
3. Querliegendes — Rechte, Sitzungen, Datenmodell, Einrichtung, Deploy —
   läuft **nie parallel** zu Bereichsarbeit. Es berührt jeden Bereich.

## Vor jedem Push

```
node pruefungen/alle.mjs
```

**Nicht schieben, solange etwas rot ist.** Jeder Push auf `main` löst den
Deploy aus und geht sofort live — es gibt keine Zwischenstufe.

Ist etwas rot, das man nicht selbst verursacht hat: nachsehen, ob es auf
`origin/main` ohne die eigenen Änderungen auch rot ist. Dann gehört es
jemand anderem und wird gemeldet, nicht heimlich repariert.

## Prüfungen ergänzen — zwei Regeln

1. **Nicht den Quelltext abschreiben.** Eine Prüfung, die nachsieht, ob ein
   Wort im Code steht, bleibt grün, wenn die Formulierung sich ändert und
   die Sache verschwindet. Geprüft wird die Aussage, nicht der Wortlaut.
2. **Gegenprobe machen.** Den behobenen Fehler absichtlich wieder einbauen
   und nachsehen, ob die Prüfung rot wird. Eine Prüfung, die nie
   angeschlagen hat, ist eine Behauptung.

Kein festes Datum nahe beim heutigen Tag in Testdaten — es kippt beim
Datumswechsel. `test_datumsfest.mjs` achtet darauf.

## Regeln, die über Dateien hinweg gelten

Diese sind schon einmal gebrochen worden, jedes Mal beim Bauen von etwas
**Neuem**, das die Regel nicht geerbt hat:

- **`darf()` in `backend/rechte.php` ist die einzige Stelle, die ein Recht
  gewährt.** Kein Endpunkt entscheidet selbst über `ist_admin`. Jeder neue
  Endpunkt braucht `require_recht(...)` oder `require_verwaltung(...)` —
  oder steht namentlich in der Ausnahmeliste in `test_php.mjs`.
- **Eine abgeglichene Schicht ist festgeschrieben (ENT-045).** Jeder
  Schreibweg an `einsaetze`, `einsatz_zuteilung` oder `einsatz_position`
  ruft `einsatz_sperre_pruefen()`. Lesen bleibt erlaubt.
- **Vertrauliche Personalfelder** (`ma_vertrauliche_felder()`) verlassen den
  Server nur mit dem Recht `personal_vertraulich`, und wer sie nicht sehen
  darf, darf sie auch nicht ändern.
- **Sperren gehören in den Server, nicht in die Oberfläche.** Eine Sperre,
  die man am Browser vorbei umgehen kann, ist keine. Was im Browser steht,
  erspart nur den Umweg.

## Gestaltung

- **Gemessen, nicht nachgelesen.** Grössen, Positionen und Abstände am
  gerenderten Zustand prüfen. Eine CSS-Regel kann wirkungslos bleiben, ohne
  dass etwas kaputtgeht — durch eine spätere Regel gleicher oder höherer
  Eigenspezifität.
- Jede Änderung am Handy-Layout **zusätzlich am Desktop** prüfen, und
  umgekehrt.
- Überschrift oben, Wert darunter. Gleiches Muster auf beiden Seiten.
  Mittiges gehört in die Mitte des Containers (`1fr auto 1fr`), nicht
  zwischen zwei ungleich lange Texte.
- Bedienelemente auf dem Handy mindestens **44 px** hoch, Eingabefelder
  mindestens **16 px** Schrift.
- **Einheiten nie vermischen.** „Einsätze" zählt Schichten, „offen" zählt
  unbesetzte Plätze darin.
- **„Unbekannt" darf nie wie „keine" aussehen.** Nicht eingerichtet, kein
  Zugriff, nichts vorhanden und kein Treffer sind vier verschiedene
  Aussagen und brauchen vier verschiedene Texte. Diese Regel ist hier
  mehrfach verletzt worden — sie ist die wichtigste auf dieser Liste.

## GAV

Keine eigenständige Auslegung. Wo der Wortlaut nicht eindeutig ist, gehört
ein Eintrag ins Auslegungsregister im Projekt-Repository — keine Annahme in
den Code. Rohzeit, bewertete Zeit, Zeitbonus und Zeitzuschlag bleiben
getrennt nachvollziehbar; nie nur ein fertiger Stundenwert.

## Vertraulichkeit

Keine echten Kunden-, Objekt- oder Personennamen — nicht im Code, nicht in
Testdaten, nicht in Commit-Nachrichten, nicht in Bildschirmfotos. Keine
Zugangsdaten, keine echten Personendaten.

## Skizzenmodus

`skizze.js` ist die lesbare Quelle; derselbe Code liegt inline in
`dashboard.html`, weil der Deploy nur namentlich gelistete Dateien kopiert.
Nach jeder Änderung an `skizze.js`:

```
python3 skizze-einbetten.py
```

`test_php.mjs` schlägt an, wenn die beiden auseinanderlaufen.

## Entscheidungen und Nummern

ENT- und OP-Nummern werden **nie wiederverwendet**. Eine Entscheidung ist erst
eine Entscheidung, wenn sie im Protokoll steht — Vorschläge und
Diskussionsstände sind keine.

**Vor der Vergabe alle Branches prüfen, nicht nur den eigenen (ENT-080).** Im
Projekt-Repository nur in die eigene Arbeitskopie zu sehen genügt **nicht**: Es
wird in mehreren Chats parallel gearbeitet, und ein Merge deckt die
Doppelvergabe nicht auf — werden beide Einträge oben eingefügt, verschmilzt Git
sie geräuschlos, und die Nummer steht danach zweimal da. Zweimal passiert:
ENT-043 am 19.08.2026, OP-49/OP-50 am 20.08.2026.

Im Projekt-Repository ausführen:

```bash
git fetch origin --prune
for br in $(git branch -r | grep -v HEAD); do
  git show $br:00-projekt/entscheidungsprotokoll.md 2>/dev/null | grep -o '^## ENT-[0-9]*'
  git show $br:00-projekt/offene-punkte.md          2>/dev/null | grep -o 'OP-[0-9]*'
done | grep -o '[0-9]*' | sort -n | tail -1
```

Ist eine Nummer doch doppelt vergeben: **behalten darf sie, wer sie zuerst
vergeben hat** (Commit-Zeitpunkt). Der spätere Eintrag wird auf die nächste
freie Nummer umgehängt, Inhalt und Datum bleiben unverändert, beide Einträge
verweisen aufeinander, und die Umhängung kommt in den Abschnitt „Korrektur der
Nummerierung" in `offene-punkte.md`.

## Erst fragen, dann bauen

Vor jeder Umsetzung so lange nachfragen, bis alles geklärt ist, was sich
später nur mit Umbau ändern lässt — insbesondere alles, was das Datenmodell
festlegt. Was im Code nachschlagbar ist, wird nachgeschlagen und **nicht**
gefragt. Fragen einzeln und mit einer Empfehlung.

## Commits

Aussagekräftig und auf Deutsch: `Interview Firma C dokumentiert`, nicht
`update`. Ein Commit pro inhaltlicher Einheit. Vor dem Commit kurz
zusammenfassen, was geändert wurde.

## Grundsatz

Generierter Code gilt als **ungeprüft**. Die Prüfungen hier ersetzen weder
eine menschliche Codeprüfung noch eine Datenschutzbetrachtung noch die
Verantwortung für den Betrieb.
