# Auto-update setup (self-signed)

**Status:** shipped 2026-06-12
**One-line:** The app updates itself across releases via electron-updater +
GitHub Releases, signed with a self-signed cert (no Apple Developer ID).

## How it works

- electron-builder publishes `latest-mac.yml` + a `.zip` + `.dmg` to the GitHub
  Release for each `v*` tag (`publish:` block in `electron-builder.yml`).
- On launch (and from **Settings → About → Check for updates**), the packaged
  app asks GitHub for `latest-mac.yml`, compares versions, and — if newer —
  **downloads in the background** and **installs on the next quit**
  (`autoInstallOnAppQuit`). No mid-session interruption.
- Wiring: `src/main/updater.ts` (autoUpdater wrapper) → `safeSend` push channels
  (`IPC.updates.*`) → `useUpdates` store + toasts + the About section.
- In dev / any unpackaged run the updater is a **no-op** (reports `disabled`) —
  electron-updater can't run there and throws if asked to.

## Why signing is required

macOS auto-update uses Squirrel.Mac, which **refuses to update an unsigned app**
and requires the new build to share the **same signing identity** as the running
one. So:

- Every release must be signed with the **same** cert.
- The **first** signed release is only a baseline — you can't auto-update *into*
  it from an older unsigned build. The update path is exercisable from the
  **second** signed release onward.
- Self-signed can't be notarized, so a **fresh install** still needs
  right-click → **Open** once to clear Gatekeeper. Auto-updates after that don't
  prompt.

## One-time: generate the cert

In **Keychain Access** → *Certificate Assistant* → *Create a Certificate*:

- Name: `CCTC Self-Signed` (anything stable)
- Identity Type: *Self-Signed Root*
- Certificate Type: **Code Signing**
- Create. It lands in the **login** keychain.

Export it as a `.p12` (right-click → Export, set a password — remember it).

```sh
# base64 the .p12 for the CI secret (copies to clipboard on macOS)
base64 -i CCTC-SelfSigned.p12 | pbcopy
```

## One-time: add GitHub repo secrets

In `grebmann1/command-center` → Settings → Secrets and variables → Actions:

- `CSC_LINK` = the base64 string from above
- `CSC_KEY_PASSWORD` = the `.p12` export password

The release workflow (`.github/workflows/release.yml`) passes both to
electron-builder, which imports the cert into a temporary keychain and signs.

## Local signed builds

With the same cert in your login keychain, `npm run dist:mac` signs
automatically (electron-builder auto-discovers the identity). Verify:

```sh
npm run dist:mac
ls dist/                       # expect .dmg, .zip, .blockmap, latest-mac.yml
codesign -dv "dist/mac-arm64/Claude Code Terminal Center.app"   # not "not signed"
```

## Releasing

```sh
git tag v0.5.0 && git push origin v0.5.0
```

CI builds, signs, and attaches `dmg + zip + blockmap + latest-mac.yml` to the
Release. Installed copies pick it up on next launch.

## Verifying the update path end-to-end

Needs **two** signed releases:

1. Tag `vX`, let CI publish, install the `.dmg`, launch it once (right-click →
   Open).
2. Tag `vX+1`, let CI publish.
3. Relaunch the installed `vX`: it detects the update, toasts
   "Downloading… / ready — installs when you quit", and after quit+relaunch the
   About section shows `vX+1`.
