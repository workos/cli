# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1](https://github.com/workos/cli/compare/v0.7.0...v0.7.1) (2026-02-18)


### Bug Fixes

* ground AI analysis in SDK documentation ([#64](https://github.com/workos/cli/issues/64)) ([db8d6e3](https://github.com/workos/cli/commit/db8d6e32c56f7467c0a041a4de26d24fea50efd1))

## [0.7.0](https://github.com/workos/cli/compare/v0.6.0...v0.7.0) (2026-02-18)


### Features

* add environment, organization, and user management commands ([#59](https://github.com/workos/cli/issues/59)) ([cc590b0](https://github.com/workos/cli/commit/cc590b019831c9d57b17bb64d6b7f31de71a1510))
* major workos doctor overhaul — visual refresh, multi-language, AI analysis ([#62](https://github.com/workos/cli/issues/62)) ([014fbbc](https://github.com/workos/cli/commit/014fbbcfe63959df379f59309caf73adae32f585))


### Bug Fixes

* improve installer skill and remove shell: true from spawn calls ([#63](https://github.com/workos/cli/issues/63)) ([92ff704](https://github.com/workos/cli/commit/92ff7042409435483e0aab9c861bd99c144d6a04))
* replace dotenv devDependency with inline env parser in doctor ([#61](https://github.com/workos/cli/issues/61)) ([4c7553f](https://github.com/workos/cli/commit/4c7553fa8a2adff859c3e2bac63e59352a83bc8f))

## [0.6.0](https://github.com/workos/cli/compare/v0.5.4...v0.6.0) (2026-02-14)


### Features

* agent self-correction via validation feedback loop ([#57](https://github.com/workos/cli/issues/57)) ([920fc87](https://github.com/workos/cli/commit/920fc87874511550d193fc3a903c845baaf1ad0d))

## [0.5.4](https://github.com/workos/cli/compare/v0.5.3...v0.5.4) (2026-02-13)


### Bug Fixes

* restore workflow_call and remove registry-url for OIDC ([1025e57](https://github.com/workos/cli/commit/1025e57bdd4f647d3a7fb054eae11b3fc18016db))

## [0.5.3](https://github.com/workos/cli/compare/v0.5.2...v0.5.3) (2026-02-13)


### Bug Fixes

* remove registry-url from setup-node to unblock OIDC auth ([75a94bb](https://github.com/workos/cli/commit/75a94bb575c338fa4714f81103cff775e615cd05))
* trigger release.yml directly via release event for OIDC match ([b7e737d](https://github.com/workos/cli/commit/b7e737d9fb4df9924951203bc2c6939e673a6ddb))

## [0.5.2](https://github.com/workos/cli/compare/v0.5.1...v0.5.2) (2026-02-13)


### Bug Fixes

* use npm publish for OIDC trusted publishing support ([40fbbf9](https://github.com/workos/cli/commit/40fbbf995d75a3a34e39dcee714153dd2b84511e))

## [0.5.1](https://github.com/workos/cli/compare/v0.5.0...v0.5.1) (2026-02-13)


### Bug Fixes

* prefer existing middleware.ts over proxy.ts for Next.js 16+ ([#52](https://github.com/workos/cli/issues/52)) ([83f3ef0](https://github.com/workos/cli/commit/83f3ef0b2c060647475bd073dc1ed99ec14e48e8))
* remove duplicate release trigger causing publish race condition ([b0935d8](https://github.com/workos/cli/commit/b0935d87460628028b71c29584e7b023db894da8))

## [0.5.0](https://github.com/workos/cli/compare/v0.4.5...v0.5.0) (2026-02-11)


### Features

* add `workos doctor` command for diagnosing integration issues ([#50](https://github.com/workos/cli/issues/50)) ([8c3e093](https://github.com/workos/cli/commit/8c3e09301d358ab6844fa0a55e06bcaf9276b050))
* multi-SDK expansion with auto-discovery registry ([#49](https://github.com/workos/cli/issues/49)) ([0316fe8](https://github.com/workos/cli/commit/0316fe87177e12072c3f78dce7d9ac8dfdc20319))

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
