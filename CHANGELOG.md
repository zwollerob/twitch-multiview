# Changelog

Alle wijzigingen per versie van Twitch MultiView.
Opzet volgens [Keep a Changelog](https://keepachangelog.com/nl/1.1.0/);
versienummers volgens [Semantic Versioning](https://semver.org/lang/nl/):
`MAJOR.MINOR.PATCH`, waarbij PATCH voor fixes is, MINOR voor nieuwe functies
en MAJOR voor grote, niet-compatibele wijzigingen.

## [1.3.0-beta.1] - 2026-10-05 (bèta)

Bèta-versie: de nieuwe castfunctie wordt eerst door een kleinere groep
getest. Op GitHub staat hij als pre-release; de stabiele versie blijft 1.2.0.

### Toegevoegd
- **Op tv tonen (bèta)** in het accountmenu:
  - **Google Cast:** de hele app naar een Chromecast, Nvidia Shield of tv met
    Google TV casten. De app zoekt de apparaten zelf in je netwerk. Je pc
    blijft al het werk doen (alle streams, je login en Turbo); de tv krijgt
    één live videostream van het app-venster (1080p, 8 Mbit/s, met geluid,
    een paar seconden vertraging). Standaard klinkt het geluid alleen op de tv.
  - **Ander scherm:** de app met één klik volledig scherm op een andere
    monitor of een tv via HDMI zetten, en een knop om een draadloos scherm
    (Miracast) te koppelen via Windows.
  - Tijdens het casten staat een paarse knop met de apparaatnaam in de
    bovenbalk; bij afsluiten van de app stopt het casten netjes.
- Knop **Feedback geven** in het castvenster, met een feedbackformulier op
  GitHub.

### Gewijzigd
- Streams blijven nu doorspelen als er een ander venster over de app ligt.

### Technisch
- Cast-protocol (CASTV2) zelf geïmplementeerd in `cast.js`; apparaten zoeken
  via mDNS met `multicast-dns` (nieuwe afhankelijkheid). Afspelen gebeurt met
  Google's standaard "Default Media Receiver", dus zonder registratie.
- Het venster wordt opgenomen met de vensteropname van Windows (de
  tab-opname nam de spelers, die aparte webviews zijn, niet mee) en via
  `MediaRecorder` als live WebM (VP8 + Opus) aangeboden.
- De stream staat alleen tijdens het casten online, op een geheime URL
  (48 tekens willekeurig), en alleen op de netwerkkaart die de tv bereikt.
- Schermopname is alleen toegestaan voor de eigen interface en neemt altijd
  alleen het eigen app-venster op.

## [1.2.0] - 2026-10-05

### Toegevoegd
- **Automatisch aanvullen bij "Kanaal toevoegen".** Vanaf 2 letters verschijnt
  een lijst met maximaal 8 kanalen uit de zoekfunctie van Twitch, ook kanalen
  die je niet volgt en ook zonder login. Per kanaal zie je de profielfoto, de
  naam en of het live is (met game en kijkers).
- Kiezen met de muis of met `↑` `↓` en `Enter`; `Esc` sluit de lijst.
  Kanalen die al open staan krijgen een ✓; kies je zo'n kanaal, dan wordt het
  uitgelicht.
- Typ je een spatie, komma of link, dan verschijnt er geen lijst en werkt
  `Enter` zoals voorheen (meerdere namen of een twitch.tv-link toevoegen).

## [1.1.0] - 2026-10-05

### Toegevoegd
- **Streamlimiet verhogen, op eigen risico.** In het accountmenu staat nu
  "Max. aantal streams" (standaard 16). Je kunt kiezen uit 16, 24, 32 of 48.
  Boven 16 opent een waarschuwingsvenster met een gele driehoek, uitleg over
  de belasting en een verplicht vinkje "Ik begrijp het risico". De keuze wordt
  bewaard.
- Bij een verhoogde limiet staat een gele driehoek naast je naam, en in het
  menu het label "Eigen risico".
- De richtwaarden in het venster komen uit een belastingstest op een Ryzen 9
  5900X met RTX 3060 Ti, 64 GB RAM en 1 Gbit/s internet:

  | Streams | Speelden | Weggevallen beeld | Download |
  |---|---|---|---|
  | 16 | 16/16 | 0% | ca. 57 Mbit/s |
  | 24 | 24/24 | 0% | ca. 85 Mbit/s |
  | 32 | 31/32 | 0,1% | ca. 66 Mbit/s (Twitch kiest 480p voor kleine tegels) |
  | 48 | 42/48 | 38% | ca. 135 Mbit/s |

### Gewijzigd
- De melding bij het bereiken van de limiet van 16 verwijst naar het
  accountmenu.
- Zolang het limietvenster open staat, doen sneltoetsen niets (behalve
  `Esc` om het te sluiten).

## [1.0.2] - 2026-10-05

### Opgelost
- **"Live gevolgd" werkte niet** en gaf "Kon Twitch niet bereiken". Twitch
  beantwoordt de losse GraphQL-vraag naar gevolgde kanalen
  (`followedLiveUsers`, ook `follows`) niet meer en geeft een "service error";
  ook de officiële Helix-API weigert, omdat een website-login geen
  `user:read:follows`-toestemming heeft. De app gebruikt nu dezelfde opgeslagen
  aanvraag als de Twitch-website zelf (`FollowingLive_CurrentUser`).
- Als Twitch die aanvraag bij een website-update verandert, haalt de app de
  nieuwe versie automatisch op van de Twitch-website (onzichtbaar, in je eigen
  sessie) en onthoudt die. Je hoeft daarvoor niet te updaten.
- In het menu "Live gevolgd" kreeg een kanaal een ✓ ook als het niet kon
  worden toegevoegd omdat het maximum van 16 streams al bereikt was.

### Gewijzigd
- Gaat het ophalen toch mis, dan toont het menu nu de echte foutmelding van
  Twitch in plaats van altijd "Kon Twitch niet bereiken".

## [1.0.1] - 2026-10-04

Beveiligingsupdate. Gebruikers van 1.0.0 wordt aangeraden te updaten.
Installeert over 1.0.0 heen; login en instellingen blijven bewaard.

### Beveiliging
- **Hoofdvenster kan niet meer weg-navigeren.** Een link of bestand dat op
  het venster werd gesleept, opende als pagina in de app en kreeg dan de
  interne koppeling (`window.api`): accountgegevens en gevolgde kanalen
  opvragen, uitloggen, instellingen overschrijven. Navigatie, redirects en
  pop-ups vanuit het hoofdvenster worden nu geblokkeerd.
- **IPC alleen vanuit de eigen interface.** Elk verzoek aan het hoofdproces
  wordt gecontroleerd op afzender (`app://ui/index.html`) en op invoer
  (kanaalnamen, grootte van de instellingen, type van parameters).
- **Twitch-login versleuteld opgeslagen.** Electron-fuse
  `EnableCookieEncryption` aan; cookies worden versleuteld met Windows DPAPI.
  Bestaande logins worden automatisch overgezet.
- **Electron-binary dichtgezet** met fuses: `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable` en `EnableNodeCliInspectArguments`
  uit; `EnableEmbeddedAsarIntegrityValidation` en `OnlyLoadAppFromAsar` aan;
  `GrantFileProtocolExtraPrivileges` uit.
- **Permissies beperkt.** Twitch-pagina's mogen alleen nog `fullscreen` en
  `clipboard-sanitized-write`, en alleen vanaf `*.twitch.tv`. Camera en
  microfoon (voorheen toegestaan), locatie, meldingen enz. worden geweigerd.
  De eigen interface krijgt geen enkele permissie.
- **Externe links alleen http(s).** Links uit speler en chat die naar buiten
  gaan, openen alleen nog als ze `http:` of `https:` zijn. Voorheen kon ook
  een ander protocol (bijv. `file:`) worden doorgegeven aan Windows.
- **Inlogvenster blijft op twitch.tv.** Navigatie naar andere sites en
  pop-ups gaan naar de normale browser; sandbox aan.
- **Testopties alleen in ontwikkelmodus.** `--capture-script`, `--capture`,
  `--profile` enz. werken niet meer in de geïnstalleerde app;
  `--capture-script` kon willekeurige JavaScript in de app uitvoeren.
- Webviews expliciet met `sandbox: true`; webviews mogen alleen worden
  toegevoegd vanuit de eigen interface en alleen voor
  `player.twitch.tv` / `www.twitch.tv`.
- Content Security Policy aangescherpt met `object-src 'none'`,
  `base-uri 'none'` en `form-action 'none'`.

### Gewijzigd
- De interface wordt geladen via een eigen protocol `app://ui/` in plaats van
  `file://`. Alleen bestanden uit de map `renderer/` zijn bereikbaar (getest
  tegen path traversal).
- Er draait maximaal één exemplaar tegelijk; opnieuw starten brengt het
  bestaande venster naar voren. Voorkomt beschadiging van het profiel.
- README uitgebreid met een sectie "Veiligheid" en een downloadsectie.

### Verwijderd
- Ongebruikte koppeling `api.openExternal` (en IPC-kanaal `shell:open`).
- MSI-installer van 1.0.0 uit de GitHub-release gehaald.

## [1.0.0] - 2026-10-04

Eerste versie.

### Toegevoegd
- Meerdere Twitch-streams tegelijk in één venster, ingelogd met je eigen
  Twitch-account: alle spelers en de chat delen één sessie, zodat Turbo en
  abonnementen gelden (geen reclame).
- Layouts **Uitgelicht** (één grote stream, de rest klein eromheen; kiest
  automatisch de indeling met de grootste uitgelichte stream), **Raster** en
  **Solo**.
- Volledig scherm met automatisch verbergende menubalk.
- Geluid standaard alleen van de uitgelichte stream; per stream instelbaar;
  alles dempen.
- Chat van de uitgelichte stream in een zijpaneel.
- **Live gevolgd**: gevolgde kanalen die nu live zijn, met één klik toe te
  voegen.
- Live-status, kijkersaantallen en titels per stream.
- Kanalen toevoegen via naam of twitch.tv-link, volgorde aanpassen door te
  slepen.
- Dubbelklik op een video: die stream solo en volledig scherm.
- Sneltoetsen (`F`, `1`–`9`, `←`/`→`, `L`, `U`/`G`/`S`, `C`, `M`, `H`, `R`, `?`).
- Inloggen en uitloggen bij Twitch, met Turbo-badge.
- Kanalen, layout en vensterpositie worden bewaard.
- MSI-installer (per gebruiker, zonder beheerdersrechten) met snelkoppelingen
  op het bureaublad en in het Startmenu.
- "Made with AI · Zw_038_olle" en versienummer in het sneltoetsenvenster.

[1.3.0-beta.1]: https://github.com/zwollerob/twitch-multiview/compare/v1.2.0...v1.3.0-beta.1
[1.2.0]: https://github.com/zwollerob/twitch-multiview/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/zwollerob/twitch-multiview/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/zwollerob/twitch-multiview/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/zwollerob/twitch-multiview/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/zwollerob/twitch-multiview/releases/tag/v1.0.0
