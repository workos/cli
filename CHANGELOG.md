# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0](https://github.com/workos/cli/compare/v0.4.5...v0.5.0) (2026-02-04)


### ⚠ BREAKING CHANGES

* Environment variables, analytics keys, and CLI messages renamed.

### Features

* add --direct flag to bypass llm-gateway ([#22](https://github.com/workos/cli/issues/22)) ([dee8330](https://github.com/workos/cli/commit/dee8330cadd0d2a6db2a0aad216e480687a41ed8))
* add credential proxy with token refresh for extended sessions ([#23](https://github.com/workos/cli/issues/23)) ([def14c7](https://github.com/workos/cli/commit/def14c7f57d3e572667fd930374f5657a186ee36))
* add install subcommand and CLI restructure ([#18](https://github.com/workos/cli/issues/18)) ([9e096ae](https://github.com/workos/cli/commit/9e096aef3bc7fe9b48711fd3e3166940418a7e14))
* add OpenTelemetry telemetry for wizard sessions ([#8](https://github.com/workos/cli/issues/8)) ([5bbcfad](https://github.com/workos/cli/commit/5bbcfada0f4801512f3890322fa8421f25d89975))
* add post-installation validation for wizard ([#12](https://github.com/workos/cli/issues/12)) ([7c67e6d](https://github.com/workos/cli/commit/7c67e6df86f1cd57e741bd982757efff9e552ae6))
* add release-please for automated changelog and releases ([#27](https://github.com/workos/cli/issues/27)) ([574cc42](https://github.com/workos/cli/commit/574cc42ca9c06c6d619d03b9fce904997b0d69d6))
* add startup auth guard with automatic token refresh ([#24](https://github.com/workos/cli/issues/24)) ([45f8f71](https://github.com/workos/cli/commit/45f8f711db43622954541d86d0531c2fd311eacd))
* add startup version check to warn users of outdated CLI ([#35](https://github.com/workos/cli/issues/35)) ([dd90280](https://github.com/workos/cli/commit/dd902809f98cb1fb456881e0deaa0868fb78ff97))
* **agent:** implement agent-skill architecture (Phases 1-3) ([#3](https://github.com/workos/cli/issues/3)) ([1146ff9](https://github.com/workos/cli/commit/1146ff9e63f70968d362bb3f734c034dca3b6bfd))
* **auth:** add --skip-auth flag and LOCAL_MODE for local development ([083e3ce](https://github.com/workos/cli/commit/083e3cecde116fa9f2b21bb01fd004735e158275))
* auto-commit and PR creation after wizard completion ([#21](https://github.com/workos/cli/issues/21)) ([e4569d5](https://github.com/workos/cli/commit/e4569d5463941c706c917329eb656b2ce91dc4f0))
* auto-configure WorkOS dashboard settings via API ([1798039](https://github.com/workos/cli/commit/1798039cd12fb9722bdc6385f518952ca1557b98))
* auto-fetch WorkOS credentials via device auth ([#20](https://github.com/workos/cli/issues/20)) ([a1e44b0](https://github.com/workos/cli/commit/a1e44b01bcfc39248e29909d8b7155785d5c2fe9))
* CLI authentication with WorkOS ([#5](https://github.com/workos/cli/issues/5)) ([01f0283](https://github.com/workos/cli/commit/01f028373e2b6a6aa85d6c2901d3b89f4a8e5209))
* CLI UI redesign - cleaner output and simplified flags ([#15](https://github.com/workos/cli/issues/15)) ([9e9fbb3](https://github.com/workos/cli/commit/9e9fbb3f29b654771bb476ff2e3febf19103a192))
* **cli:** add dashboard foundation with event-based architecture ([7865cf1](https://github.com/workos/cli/commit/7865cf19f0c799df588825ea2a700e4d571cf7e4))
* **cli:** add dashboard TUI with diff viewer and event system ([90375b9](https://github.com/workos/cli/commit/90375b92eb32833210077f8f3f13ac7ad5e74e3b))
* **cli:** add install-skill command ([#6](https://github.com/workos/cli/issues/6)) ([a23f5dc](https://github.com/workos/cli/commit/a23f5dcd7ae42e6f189e2ddc7ceba108b470c5bb))
* **cli:** implement Phase 2 dashboard panels and logo animation ([458f00a](https://github.com/workos/cli/commit/458f00a9f0101334930bd43c6961fd385961a8bb))
* improve debug logging with session-based log files ([#16](https://github.com/workos/cli/issues/16)) ([8542c17](https://github.com/workos/cli/commit/8542c17e1b2f41b013de3108efb5c0f4c2a6b75f))
* **llm-gateway:** add OTel metrics for token usage tracking ([#11](https://github.com/workos/cli/issues/11)) ([eb3d6ab](https://github.com/workos/cli/commit/eb3d6ab3a368d7efdb634d623f699fb3549d3d62))
* migrate CLI auth from User Management to Connect OAuth ([#10](https://github.com/workos/cli/issues/10)) ([10bdb28](https://github.com/workos/cli/commit/10bdb28862b69c81c9d4a4d78be564c30546275b))
* secure keyring credential storage ([#41](https://github.com/workos/cli/issues/41)) ([7d33735](https://github.com/workos/cli/commit/7d337357a791f840ecb68602db05fc6356f62aac))


### Bug Fixes

* add Next.js 15+ async cookies guards to skill ([33244a2](https://github.com/workos/cli/commit/33244a2f50e7a36abe6cc543b9ae7ff616d97041))
* add repository URL for npm provenance publishing ([#33](https://github.com/workos/cli/issues/33)) ([e02d6d5](https://github.com/workos/cli/commit/e02d6d59c52be1a39308d6380eae625a4240705f))
* correct SDK APIs and make README fetch blocking ([#17](https://github.com/workos/cli/issues/17)) ([0321e20](https://github.com/workos/cli/commit/0321e20a0b48bf87d485d300e6e3bb1c1ee7988b))
* **dashboard:** proper error handling and post-TUI summary ([f6da2b8](https://github.com/workos/cli/commit/f6da2b81a27af907d28ace9159af70f36632c927))
* dynamic import @statelyai/inspect to prevent npm runtime error ([a3d2a5f](https://github.com/workos/cli/commit/a3d2a5f974ee4dfca27e31d934c4fb091caf7422))
* generate version at build time instead of importing package.json ([5acadef](https://github.com/workos/cli/commit/5acadef4efe2f6d63f3fe6f74ad92c551b7b4b6c))
* **nextjs:** improve skill guidance for middleware composition ([#39](https://github.com/workos/cli/issues/39)) ([7121b63](https://github.com/workos/cli/commit/7121b63d48a505eab7b366292078745f23313d7b))
* override org NODE_AUTH_TOKEN to enable trusted publishing ([dd31ec5](https://github.com/workos/cli/commit/dd31ec598de03f477ea7a11593b57696089a3b4f))
* properly configure and run prettier ([ab14f75](https://github.com/workos/cli/commit/ab14f754ba26ed851a83310e554101ab4689ae1c))
* remove bump-patch-for-minor-pre-major so feat: bumps minor ([654cb75](https://github.com/workos/cli/commit/654cb75dfb2dcdcd9bf7ebd8c759e4cc6e8e2720))
* remove environment to prevent org secret injection ([4c3e673](https://github.com/workos/cli/commit/4c3e6735d834cb93dc2293d3bc6b39c7a604873d))
* remove registry-url to enable OIDC trusted publishing ([efdbd80](https://github.com/workos/cli/commit/efdbd804e2a96f5ff79ca4747e557af57102a56e))
* run prettier from root to respect .prettierignore ([#7](https://github.com/workos/cli/issues/7)) ([09dc0ce](https://github.com/workos/cli/commit/09dc0cef98d6bc744d01f4d004af07542545ee13))
* strip _authToken from npmrc to force OIDC auth ([8b11ceb](https://github.com/workos/cli/commit/8b11ceb49cc0fce09b98198366e43c694b557df8))
* trigger npm publish when release-please creates a release ([#31](https://github.com/workos/cli/issues/31)) ([c68f990](https://github.com/workos/cli/commit/c68f99015009d100b27b4905150ec22de4af6776))
* unset NODE_AUTH_TOKEN env var to force OIDC auth ([a419fbb](https://github.com/workos/cli/commit/a419fbbe27360679f5f9993fd5226229746eb03b))
* use correct npmrc path from NPM_CONFIG_USERCONFIG ([50322b8](https://github.com/workos/cli/commit/50322b810062cd8f57543384fffffb25c976e08b))
* use v0.x.x tag format instead of workos-v0.x.x ([#30](https://github.com/workos/cli/issues/30)) ([67b21ba](https://github.com/workos/cli/commit/67b21ba4bb435335369492413a0af4bbd71db4ac))


### Reverts

* remove empty NODE_AUTH_TOKEN override ([9aca30a](https://github.com/workos/cli/commit/9aca30a83aa1910ad4e19300762f9dca432f5f78))


### Code Refactoring

* rename Wizard to Installer ([#26](https://github.com/workos/cli/issues/26)) ([fcef664](https://github.com/workos/cli/commit/fcef6648da50ed478f4d44885f85d1f75e721c54))

## [0.4.5](https://github.com/workos/cli/compare/v0.4.4...v0.4.5) (2026-02-04)


### Bug Fixes

* use correct npmrc path from NPM_CONFIG_USERCONFIG ([50322b8](https://github.com/workos/cli/commit/50322b810062cd8f57543384fffffb25c976e08b))

## [0.4.4](https://github.com/workos/cli/compare/v0.4.3...v0.4.4) (2026-02-04)


### Bug Fixes

* strip _authToken from npmrc to force OIDC auth ([8b11ceb](https://github.com/workos/cli/commit/8b11ceb49cc0fce09b98198366e43c694b557df8))

## [0.4.3](https://github.com/workos/cli/compare/v0.4.2...v0.4.3) (2026-02-04)


### Bug Fixes

* remove environment to prevent org secret injection ([4c3e673](https://github.com/workos/cli/commit/4c3e6735d834cb93dc2293d3bc6b39c7a604873d))

## [0.4.2](https://github.com/workos/cli/compare/v0.4.1...v0.4.2) (2026-02-04)


### Bug Fixes

* remove registry-url to enable OIDC trusted publishing ([efdbd80](https://github.com/workos/cli/commit/efdbd804e2a96f5ff79ca4747e557af57102a56e))


### Reverts

* remove empty NODE_AUTH_TOKEN override ([9aca30a](https://github.com/workos/cli/commit/9aca30a83aa1910ad4e19300762f9dca432f5f78))

## [0.4.1](https://github.com/workos/cli/compare/v0.4.0...v0.4.1) (2026-02-04)


### Bug Fixes

* override org NODE_AUTH_TOKEN to enable trusted publishing ([dd31ec5](https://github.com/workos/cli/commit/dd31ec598de03f477ea7a11593b57696089a3b4f))

## [0.4.0](https://github.com/workos/cli/compare/v0.3.3...v0.4.0) (2026-02-04)


### Features

* secure keyring credential storage ([#41](https://github.com/workos/cli/issues/41)) ([7d33735](https://github.com/workos/cli/commit/7d337357a791f840ecb68602db05fc6356f62aac))


### Bug Fixes

* remove bump-patch-for-minor-pre-major so feat: bumps minor ([654cb75](https://github.com/workos/cli/commit/654cb75dfb2dcdcd9bf7ebd8c759e4cc6e8e2720))

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
