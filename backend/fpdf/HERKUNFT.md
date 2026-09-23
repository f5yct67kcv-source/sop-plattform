# FPDF — Herkunft

Unverändert übernommen aus dem offiziellen Repository
`https://github.com/Setasign/FPDF`, Tag **1.9.0**, Commit
`051b70e4c57dedc88df41b1eff1c62894e5f9ed0` (2026-05-31), Autor Olivier
Plathey. Lizenz: frei (siehe `LIZENZ.txt`, gleichwertig MIT).

Übernommen sind nur `fpdf.php`, die vier Helvetica-Schnitte und Courier
(für die Prüfsumme) aus `font/`.
Mehr braucht das Belegblatt nicht (ENT-688, Schritt 3).

**Nicht verändern.** Eine Anpassung gehört in `backend/belegpdf.php`, nicht
hierher — sonst lässt sich die Datei nicht mehr gegen das Original prüfen.
`test_beleg_pdf.mjs` vergleicht die Prüfsumme von `fpdf.php` mit der hier
genannten:

    sha256(fpdf.php) = d1ea5c753979a28396af2a0c7ea43af16e6e5510171704d650d5d68fb5cd6a56
