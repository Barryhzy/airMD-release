# Release checks — v0.4.3

Prepared on 2026-10-27 for `Barryhzy/airMD-release`.

## Source and build

- Source code exported from the 0.4.3 development baseline, including the updated bilingual README and local assets.
- Internal handoff notes, old screenshots, development repository history, local toolchains, dependencies, build caches, and backups excluded from the source tree.
- TypeScript checking and Vite production build passed.
- Unit tests: 143 passed across 11 files.
- macOS release build: Tauri app and DMG built for Apple Silicon / arm64, minimum macOS 11.
- Rust paths remapped to generic `/builder` and `/airmd` prefixes by the macOS build script.

## Distribution checks

- App bundle signature verification passed (`codesign --verify --deep --strict`).
- Signing is ad-hoc; TeamIdentifier is not set. No Apple Developer ID signature or Apple notarization is claimed.
- Project and collected third-party license notices are included in the app's Resources directory.
- App contents checked for the build-machine username, personal home paths, common private-key markers, and credential-file extensions.
- DMG checksum verification, read-only content inspection, embedded app signature check, and app-file hash comparison completed before upload.
- Source archive generated from an explicit file list, with a separate SHA-256 manifest. Build and credential files excluded.

## Scope

A user-supplied Windows x64 NSIS installer was added on 2026-10-28. Its bytes and SHA-256 were checked during upload; it was not rebuilt or executed on this Mac. The user previously reported Windows testing completed. Intel Mac builds were not produced or tested in this release preparation. Full browser E2E and Rust test suites were not rerun during packaging. Known functional limitations remain documented in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

These checks describe what was inspected; they are not a complete security audit of the application or all third-party dependencies.
