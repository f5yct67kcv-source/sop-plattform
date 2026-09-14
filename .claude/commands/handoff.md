---
description: Schreibt eine Uebergabe-Datei mit den Learnings der Session auf die Platte
allowed-tools: Bash, Read, Write, Glob
---

# Handoff schreiben

Ziel: die Substanz dieser Session als Markdown-Datei sichern, damit eine
kuenftige Claude-Instanz nahtlos weiterarbeiten kann – ohne dass alles im
Kontextfenster gehalten werden muss.

## Ablauf

1. **Speicherort bestimmen.** Wenn wir in einem Git-Repo / Projekt sind:
   `.claude/handoffs/`. Sonst das aktuelle Verzeichnis. Ordner bei Bedarf
   anlegen. Dateiname mit Zeitstempel:
   ```bash
   mkdir -p .claude/handoffs 2>/dev/null
   date "+%Y-%m-%d-%H%M"
   ```
   Datei: `.claude/handoffs/handoff-<zeitstempel>.md`

2. **Datei nach diesem Template schreiben.** Fokus liegt bewusst NICHT auf der
   Aufgabenliste oder den Arbeitsschritten – die kann eine kuenftige Instanz aus
   Code und Git-Historie selbst rekonstruieren. Festgehalten wird nur das, was
   sonst nirgends landet:

   ```markdown
   # Handoff – <kurzer Titel der Aufgabe>
   _Datum: <zeitstempel> · Modell: <aktuelles Modell>_

   ## Ziel
   Woran arbeiten wir, und was ist das eigentliche Ergebnis?

   ## Aktueller Stand
   Was ist erledigt, was laeuft gerade, was ist offen? (kurz)

   ## Learnings & Erkenntnisse
   Was haben wir in dieser Session herausgefunden, das nicht offensichtlich im
   Code steht?

   ## Fehlannahmen & Sackgassen
   Was hatten wir falsch angenommen? Welche Wege haben nicht funktioniert – damit
   sie niemand nochmal geht?

   ## Was haette besser laufen koennen
   Reibungspunkte, unklare Stellen, Dinge fuer naechstes Mal.

   ## Naechste Schritte
   Konkret, wo weitergemacht wird.

   ## Wichtige Dateien
   Pfade, die fuer den Wiedereinstieg zentral sind.
   ```

3. **Fuellen aus dem Gespraech.** Nutze den bisherigen Verlauf dieser Session.
   Halte dich kurz und konkret – lieber wenige echte Erkenntnisse als
   aufgeblaehter Text. Keine erfundenen Details; was du nicht weisst, laesst du
   weg oder markierst es als offen.

4. **Bestaetigen.** Gib dem User am Ende den Pfad der geschriebenen Datei aus.

$ARGUMENTS
