# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3](https://github.com/workos/cli/compare/v0.3.2...v0.3.3) (2026-02-03)


### Features

* add startup version check to warn users of outdated CLI ([#35](https://github.com/workos/cli/issues/35)) ([dd90280](https://github.com/workos/cli/commit/dd902809f98cb1fb456881e0deaa0868fb78ff97))


### Bug Fixes

* **nextjs:** improve skill guidance for middleware composition ([#39](https://github.com/workos/cli/issues/39)) ([7121b63](https://github.com/workos/cli/commit/7121b63d48a505eab7b366292078745f23313d7b))

## [0.3.2](https://github.com/workos/cli/compare/v0.2.1...v0.3.2) (2026-01-31)


### ⚠ BREAKING CHANGES

* Environment variables, analytics keys, and CLI messages renamed.
  - `WIZARD_DEV` → `INSTALLER_DEV`
  - `WIZARD_DISABLE_PROXY` → `INSTALLER_DISABLE_PROXY`
  - `WORKOS_WIZARD_*` → `WORKOS_INSTALLER_*`
  - Analytics keys renamed from `wizard.*` to `installer.*`
  - CLI messages now reference "installer" instead of "wizard"

### Features

* add --direct flag to bypass llm-gateway ([#22](https://github.com/workos/cli/issues/22)) ([dee8330](https://github.com/workos/cli/commit/dee8330cadd0d2a6db2a0aad216e480687a41ed8))
* add credential proxy with token refresh for extended sessions ([#23](https://github.com/workos/cli/issues/23)) ([def14c7](https://github.com/workos/cli/commit/def14c7f57d3e572667fd930374f5657a186ee36))
* add release-please for automated changelog and releases ([#27](https://github.com/workos/cli/issues/27)) ([574cc42](https://github.com/workos/cli/commit/574cc42ca9c06c6d619d03b9fce904997b0d69d6))
* add startup auth guard with automatic token refresh ([#24](https://github.com/workos/cli/issues/24)) ([45f8f71](https://github.com/workos/cli/commit/45f8f711db43622954541d86d0531c2fd311eacd))


### Bug Fixes

* add repository URL for npm provenance publishing ([#33](https://github.com/workos/cli/issues/33)) ([e02d6d5](https://github.com/workos/cli/commit/e02d6d59c52be1a39308d6380eae625a4240705f))
* trigger npm publish when release-please creates a release ([#31](https://github.com/workos/cli/issues/31)) ([c68f990](https://github.com/workos/cli/commit/c68f99015009d100b27b4905150ec22de4af6776))
* use v0.x.x tag format instead of workos-v0.x.x ([#30](https://github.com/workos/cli/issues/30)) ([67b21ba](https://github.com/workos/cli/commit/67b21ba4bb435335369492413a0af4bbd71db4ac))


### Code Refactoring

* rename Wizard to Installer ([#26](https://github.com/workos/cli/issues/26)) ([fcef664](https://github.com/workos/cli/commit/fcef6648da50ed478f4d44885f85d1f75e721c54))

## [0.2.1] - 2026-01-28

### Fixed

- Generate version at build time instead of importing package.json (fixes ERR_MODULE_NOT_FOUND)
- Auto-commit and PR creation after installer completion (#21)
- Auto-fetch WorkOS credentials via device auth (#20)
- Branch protection detection in installer flow

## [0.2.0] - 2026-01-28 [DEPRECATED]

### Added

- Auto-commit and PR creation after installer completion (#21)
- Auto-fetch WorkOS credentials via device auth (#20)
- Branch protection detection in installer flow

## [0.1.2] - 2026-01-23

### Fixed

- Next.js 15+ async cookies guards in skill

## [0.1.1] - 2026-01-23

### Fixed

- Dynamic import @statelyai/inspect to prevent npm runtime error

## [0.1.0] - 2026-01-23

### Added

- Initial release
- AI-powered CLI installer for installing WorkOS AuthKit
- Support for Next.js, React SPA, React Router, TanStack Start, and Vanilla JS
- Interactive TUI dashboard with real-time progress
- Claude Agent SDK integration for intelligent code generation
- Framework auto-detection
- Skill-based architecture for framework-specific installation

[Unreleased]: https://github.com/workos/installer/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/workos/installer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/workos/installer/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/workos/installer/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/workos/installer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/workos/installer/releases/tag/v0.1.0
