# Twitch MultiView

Meerdere Twitch-streams tegelijk kijken in één venster, ingelogd met je eigen
Twitch-account. Alle streams en de chat delen één sessie, dus je Turbo (of je
abonnementen) geldt overal: geen reclame. Standaard MAX 16 streams tegelijk; meer kan op eigen risico via het accountmenu.

## Downloaden

Download de nieuwste installer (`.msi`) via
**[Releases](https://github.com/zwollerob/twitch-multiview/releases/latest)**
en dubbelklik erop. Werkt op Windows 10 en 11 (64-bit), zonder
beheerdersrechten. Wat er per versie is veranderd, staat in de
[CHANGELOG](CHANGELOG.md).

De installer is niet digitaal ondertekend. Windows SmartScreen toont daarom
"Windows heeft uw pc beschermd": klik op **Meer info** en daarna op
**Toch uitvoeren**.

## Starten

Dubbelklik **Twitch MultiView** op je bureaublad of in het Startmenu.

De eerste keer: klik rechtsboven op **Inloggen** en log in bij Twitch. Het
inlogvenster sluit vanzelf en alle streams laden opnieuw met je account.
Daarna staat bij je naam een **Turbo**-badge. Je login blijft bewaard.

## Gebruik

- **Kanaal toevoegen**: typ een naam of plak een twitch.tv-link (meerdere mag,
  gescheiden door spaties), of kies via **Live gevolgd** uit je gevolgde
  kanalen die nu live zijn.
- **Layouts**
  - *Uitgelicht*: één grote stream, de rest klein ernaast/eronder. Klik op een
    kleine stream om die uit te lichten.
  - *Raster*: alles even groot.
  - *Solo*: alleen de uitgelichte stream.
- **Geluid**: standaard alleen van de uitgelichte stream. De knop
  *Geluid: …* wisselt tussen *uitgelicht*, *alle* en *uit*. Met de
  luidspreker op een stream zet je die apart aan of uit.
- **Chat**: toont de chat van de uitgelichte stream.
- **Lurken** (`K`): wisselt automatisch naar een willekeurige live stream uit
  je overzicht, elke 15 seconden tot 10 minuten. Standaard verbergt hij de
  kleine streams, zodat één stream het hele venster vult.
- **Op tv tonen** (bèta, in het accountmenu): cast de hele app naar een
  Chromecast, Nvidia Shield of Google TV, of zet hem volledig scherm op een
  ander scherm. De eerste keer vraagt Windows Firewall om toestemming: kies
  "Toestaan", anders kan de tv de stream niet ophalen.
- **Dubbelklik op een video**: die stream solo en volledig scherm.
  Nogmaals dubbelklikken (of Esc) brengt je terug.
- Kanalen bovenin kun je **slepen** om de volgorde te veranderen;
  middelklik verwijdert een kanaal.

Je kanalen, layout en instellingen worden bewaard voor de volgende keer.

## Sneltoetsen

| Toets | Actie |
|---|---|
| `F` / `F11` | Volledig scherm aan/uit |
| `Esc` | Volledig scherm verlaten |
| `1`–`9` | Stream 1–9 uitlichten |
| `←` `→` / `N` | Vorige / volgende stream uitlichten |
| `L` | Layout wisselen |
| `U` / `G` / `S` | Uitgelicht / Raster / Solo |
| `C` | Chat aan/uit |
| `K` | Lurken aan/uit |
| `M` | Alles dempen aan/uit |
| `H` | Menubalk automatisch verbergen |
| `R` | Uitgelichte stream herladen |
| `?` | Overzicht sneltoetsen |

In volledig scherm verdwijnt de menubalk; beweeg de muis naar de bovenrand om
hem terug te halen.

## Installer (MSI) bouwen en delen

De installer staat in `dist\Twitch-MultiView-Setup-<versie>.msi`. Die kun je
delen. Installeren kan zonder beheerdersrechten; het programma komt in
`%LOCALAPPDATA%\Programs\Twitch MultiView`, met snelkoppelingen op het
bureaublad en in het Startmenu. Verwijderen gaat via Windows-instellingen >
Apps.

Iedereen logt in met zijn eigen Twitch-account; reclamevrij kijken werkt
alleen voor accounts met Turbo (of bij kanalen waar je op geabonneerd bent).

De installer is niet digitaal ondertekend, dus Windows SmartScreen toont bij
het openen "Windows heeft uw pc beschermd". Klik op **Meer info** en daarna op
**Toch uitvoeren**.

### Na een wijziging opnieuw bouwen

1. Verhoog `version` in `package.json` (bijv. 1.0.2), zodat de nieuwe MSI
   netjes over de oude versie heen installeert.
2. Beschrijf de wijzigingen in [CHANGELOG.md](CHANGELOG.md) onder een nieuw
   kopje met het versienummer en de datum.
3. Bouw de MSI:

   ```powershell
   powershell -ExecutionPolicy Bypass -File "V:\Claud AI\twitch\tools\build-msi.ps1"
   ```

4. Commit en push de wijzigingen, en maak op GitHub een nieuwe Release aan
   met de MSI uit `dist\`. Zet in de release-notes de SHA-256
   (`Get-FileHash .\dist\Twitch-MultiView-Setup-<versie>.msi`).

Het bouwen gebeurt in een tijdelijke map op C:. Het programma kan niet vanaf
de NAS draaien, omdat de beveiligings-sandbox van Chromium niet start vanaf
een netwerkschijf. Je login en instellingen blijven bij een update bewaard
(die staan in `%APPDATA%\Twitch MultiView`).

## Veiligheid

- De interface draait afgeschermd van je pc (sandbox, context isolation,
  geen Node.js in pagina's) en kan nergens anders heen navigeren.
- Twitch-pagina's mogen alleen volledig scherm en kopiëren; geen camera,
  microfoon, locatie of meldingen.
- Je Twitch-login wordt versleuteld opgeslagen (Windows DPAPI) en gaat
  alleen naar Twitch.
- Links uit chat of speler openen alleen als gewone weblink in je browser.
- De Electron-binary is dichtgezet (geen `RunAsNode`, `NODE_OPTIONS` of
  `--inspect`; de app-code wordt bij het starten op wijzigingen gecontroleerd).
- Controleer je download met de SHA-256 uit de release-notes:
  `Get-FileHash .\Twitch-MultiView-Setup-<versie>.msi`

## Bestanden

- `main.js`: hoofdproces (venster, Twitch-sessie, login, sneltoetsen)
- `preload.js`: brug tussen hoofdproces en interface
- `renderer/`: de interface (layouts, spelers, chat)
- `build/`: icoon (gemaakt met `tools/make-icon.js`)
- `tools/build-msi.ps1`: bouwt de MSI-installer naar `dist/`
- `CHANGELOG.md`: wat er per versie is gewijzigd

Made with AI · Zw_038_olle
