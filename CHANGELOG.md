# Changelog

Alle wijzigingen per versie van Twitch MultiView.
Opzet volgens [Keep a Changelog](https://keepachangelog.com/nl/1.1.0/);
versienummers volgens [Semantic Versioning](https://semver.org/lang/nl/):
`MAJOR.MINOR.PATCH`, waarbij PATCH voor fixes is, MINOR voor nieuwe functies
en MAJOR voor grote, niet-compatibele wijzigingen.

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

[1.1.0]: https://github.com/zwollerob/twitch-multiview/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/zwollerob/twitch-multiview/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/zwollerob/twitch-multiview/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/zwollerob/twitch-multiview/releases/tag/v1.0.0
