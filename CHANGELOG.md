# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.2](https://github.com/workos/cli/compare/v0.13.1...v0.13.2) (2026-04-28)


### Bug Fixes

* webhook list empty URL column and truncate long event lists ([#134](https://github.com/workos/cli/issues/134)) ([643f483](https://github.com/workos/cli/commit/643f4836a7cef449f949b2540b94ca43ee9225bc))

## [0.13.1](https://github.com/workos/cli/compare/v0.13.0...v0.13.1) (2026-04-27)


### Bug Fixes

* **deps:** bump @workos/skills to 0.5.0 ([653b97b](https://github.com/workos/cli/commit/653b97b499dffa63285c9b957cce3d748314f2be))

## [0.13.0](https://github.com/workos/cli/compare/v0.12.3...v0.13.0) (2026-04-26)


### Features

* complete WorkOS skill install + refresh loop with doctor --fix ([#130](https://github.com/workos/cli/issues/130)) ([c61f5a4](https://github.com/workos/cli/commit/c61f5a42d842adab64a199e85951a2259d6d4042))

## [0.12.3](https://github.com/workos/cli/compare/v0.12.2...v0.12.3) (2026-04-24)


### Bug Fixes

* improve installer auth recovery ([#128](https://github.com/workos/cli/issues/128)) ([64928cf](https://github.com/workos/cli/commit/64928cf7029c784d4a894e4dbfd0f13067c57f6f))
* prevent SDK "Not logged in" error before reaching gateway ([#127](https://github.com/workos/cli/issues/127)) ([69c2d7d](https://github.com/workos/cli/commit/69c2d7dd940ac7d23f2ca41994e44958b40a1682))

## [0.12.2](https://github.com/workos/cli/compare/v0.12.1...v0.12.2) (2026-04-23)


### Bug Fixes

* detect service unavailability and fail fast with clear error ([#118](https://github.com/workos/cli/issues/118)) ([524c709](https://github.com/workos/cli/commit/524c709ee864149190f79947a241f3f2c5e6367d))
* unbreak non-JS integration install flow (Django, .NET, Kotlin + others) ([#125](https://github.com/workos/cli/issues/125)) ([bd9e068](https://github.com/workos/cli/commit/bd9e068642afad706376ff316fdc9c050d757977))

## [0.12.1](https://github.com/workos/cli/compare/v0.12.0...v0.12.1) (2026-04-01)


### Bug Fixes

* skip device auth when unclaimed environment is active ([#115](https://github.com/workos/cli/issues/115)) ([3c95642](https://github.com/workos/cli/commit/3c956429b6d1913195bac31534cfdd7736f25779))

## [0.12.0](https://github.com/workos/cli/compare/v0.11.2...v0.12.0) (2026-03-31)


### Features

* full WorkOS API emulator (emulate, dev, RBAC, webhooks, events, 84% API coverage) ([#100](https://github.com/workos/cli/issues/100)) ([55371a9](https://github.com/workos/cli/commit/55371a9a2121b91dd48189752efc3c96681e1dee))


### Bug Fixes

* add NextjsGrader check for getSignInUrl in Server Components ([#110](https://github.com/workos/cli/issues/110)) ([f2a6ec2](https://github.com/workos/cli/commit/f2a6ec29a88c4a769de57e879dfb4dbd0cbc6978))
* add tag_name input to workflow_dispatch trigger ([0924a4b](https://github.com/workos/cli/commit/0924a4bd7f3d6ebe44762e78273bcfa65933a3fe))
* enforce OIDC-only beta publish path ([f8e74d6](https://github.com/workos/cli/commit/f8e74d61d2eade4af13b91db33837382dedb7da7))
* prevent registerSubcommand from injecting false positional args ([#111](https://github.com/workos/cli/issues/111)) ([effe187](https://github.com/workos/cli/commit/effe187629eecaf166542002115457c6933cf0eb))
* remove environment to prevent org secret injection breaking OIDC ([28f0564](https://github.com/workos/cli/commit/28f05649b1a3df3b926830d4e885dfa6b80def83))
* restore OIDC auth setup for npm trusted publishing ([d0f8b53](https://github.com/workos/cli/commit/d0f8b537d9a473adb65e3d4d60659457fa25fc32))
* set release-please manifest to last stable tag (v0.11.2) ([850eee3](https://github.com/workos/cli/commit/850eee39c88fe344f3e0b7de6ff309c18ef81418))
* stop reading WORKOS_CLIENT_ID for CLI auth ([#113](https://github.com/workos/cli/issues/113)) ([7bdd851](https://github.com/workos/cli/commit/7bdd851ab202173438f330522a2a32b743cf8708))
* use pnpm publish to match working auth setup ([d79cf16](https://github.com/workos/cli/commit/d79cf163cabee593f21c8cf9030c46f7348a4657))
* use prerelease versioning strategy for beta releases ([#104](https://github.com/workos/cli/issues/104)) ([8385201](https://github.com/workos/cli/commit/8385201ef25472be950e8ca1d4570fee0b7b31ea))

## [0.12.0-beta.1](https://github.com/workos/cli/compare/v0.12.0-beta...v0.12.0-beta.1) (2026-03-26)


### Bug Fixes

* add tag_name input to workflow_dispatch trigger ([0924a4b](https://github.com/workos/cli/commit/0924a4bd7f3d6ebe44762e78273bcfa65933a3fe))
* enforce OIDC-only beta publish path ([f8e74d6](https://github.com/workos/cli/commit/f8e74d61d2eade4af13b91db33837382dedb7da7))
* remove environment to prevent org secret injection breaking OIDC ([28f0564](https://github.com/workos/cli/commit/28f05649b1a3df3b926830d4e885dfa6b80def83))
* restore OIDC auth setup for npm trusted publishing ([d0f8b53](https://github.com/workos/cli/commit/d0f8b537d9a473adb65e3d4d60659457fa25fc32))
* use pnpm publish to match working auth setup ([d79cf16](https://github.com/workos/cli/commit/d79cf163cabee593f21c8cf9030c46f7348a4657))

## [0.12.0-beta](https://github.com/workos/cli/compare/v0.11.2...v0.12.0-beta) (2026-03-26)


### Features

* full WorkOS API emulator (emulate, dev, RBAC, webhooks, events, 84% API coverage) ([#100](https://github.com/workos/cli/issues/100)) ([55371a9](https://github.com/workos/cli/commit/55371a9a2121b91dd48189752efc3c96681e1dee))


### Bug Fixes

* use prerelease versioning strategy for beta releases ([#104](https://github.com/workos/cli/issues/104)) ([8385201](https://github.com/workos/cli/commit/8385201ef25472be950e8ca1d4570fee0b7b31ea))

## [0.11.2](https://github.com/workos/cli/compare/v0.11.1...v0.11.2) (2026-03-17)


### Bug Fixes

* add `workos seed --init` to scaffold example seed file ([#97](https://github.com/workos/cli/issues/97)) ([a8ea743](https://github.com/workos/cli/commit/a8ea74372d5a627e5b876df2222a57549431fec0))

## [0.11.1](https://github.com/workos/cli/compare/v0.11.0...v0.11.1) (2026-03-16)


### Bug Fixes

* auto-install skills to coding agents after install ([#94](https://github.com/workos/cli/issues/94)) ([ae5e5cd](https://github.com/workos/cli/commit/ae5e5cd46e96081d3960462292b13cfe0563de26))

## [0.11.0](https://github.com/workos/cli/compare/v0.10.1...v0.11.0) (2026-03-13)


### Features

* add zero-auth install flow with claim command ([#91](https://github.com/workos/cli/issues/91)) ([d1b0039](https://github.com/workos/cli/commit/d1b0039c051cd8fccb2a655aa97ad7017998ff2e))

## [0.10.1](https://github.com/workos/cli/compare/v0.10.0...v0.10.1) (2026-03-10)


### Bug Fixes

* **auth:** auto-provision staging environment after login ([#89](https://github.com/workos/cli/issues/89)) ([19b34e2](https://github.com/workos/cli/commit/19b34e27d5c516e0439904da9bc8b0a9b33ea892))

## [0.10.0](https://github.com/workos/cli/compare/v0.9.0...v0.10.0) (2026-03-09)


### ⚠ BREAKING CHANGES

* `workos install-skill` and `workos uninstall-skill` are replaced by `workos skills install`, `workos skills uninstall`, and `workos skills list`.

### Features

* add `workos skills` subcommand group (install, uninstall, list) ([#86](https://github.com/workos/cli/issues/86)) ([c008b72](https://github.com/workos/cli/commit/c008b724b035e57d857f32b998c0e240cffa73da))
* consume skills from @workos/skills package ([#88](https://github.com/workos/cli/issues/88)) ([2ec4c18](https://github.com/workos/cli/commit/2ec4c18b1eeb3bc44d18868f56bf6e7f4ce0cac2))


### Bug Fixes

* only load authkit-base reference for JavaScript integrations ([fc95a09](https://github.com/workos/cli/commit/fc95a09f0522f18bc9251b9f6cef64a6e26ea49b))

## [0.9.0](https://github.com/workos/cli/compare/v0.8.2...v0.9.0) (2026-03-05)


### ⚠ BREAKING CHANGES

* `workos login` and `workos logout` are now `workos auth login` and `workos auth logout`.

### Features

* move login/logout to auth subcommand, add auth status ([#84](https://github.com/workos/cli/issues/84)) ([b86c39b](https://github.com/workos/cli/commit/b86c39bfe6724b9a8e56a710426074127eedd6de))

## [0.8.2](https://github.com/workos/cli/compare/v0.8.1...v0.8.2) (2026-03-05)


### Bug Fixes

* auth credential storage and transient error handling ([#81](https://github.com/workos/cli/issues/81)) ([ac7922d](https://github.com/workos/cli/commit/ac7922da33ac613b9794b9a8b0bd304d9b95c497))
* improve TanStack Start skill to reduce first-attempt build failures ([#83](https://github.com/workos/cli/issues/83)) ([6b935ce](https://github.com/workos/cli/commit/6b935ce7b880f3f82b17e86a082206464d16154a))
* TanStack Start friction log fixes for middleware and doctor checks ([#77](https://github.com/workos/cli/issues/77)) ([7b857f9](https://github.com/workos/cli/commit/7b857f9c06a79fdbfb50a4b57eec97860876461b))

## [0.8.1](https://github.com/workos/cli/compare/v0.8.0...v0.8.1) (2026-03-05)


### Bug Fixes

* correct skills directory path resolution in getSkillsDir ([#79](https://github.com/workos/cli/issues/79)) ([732bcaa](https://github.com/workos/cli/commit/732bcaa98ffd911c478e067528d6db483a0cfa14))

## [0.8.0](https://github.com/workos/cli/compare/v0.7.3...v0.8.0) (2026-03-04)


### Features

* CLI management commands for all WorkOS resources ([#76](https://github.com/workos/cli/issues/76)) ([7c05f87](https://github.com/workos/cli/commit/7c05f87953084f91bb88a92cdf35092c15de0d60))
* non-TTY mode for agent-friendly CLI ([#75](https://github.com/workos/cli/issues/75)) ([df09d1e](https://github.com/workos/cli/commit/df09d1ec2151a11d0af289f6dbe1e59f766b0a6e))
* upgrade @anthropic-ai/claude-agent-sdk from 0.2.19 to 0.2.62 ([44fc4c2](https://github.com/workos/cli/commit/44fc4c2fbcc68c5ef8a6a18f6ce22987e8b54d4a))

## [0.7.3](https://github.com/workos/cli/compare/v0.7.2...v0.7.3) (2026-02-24)


### Bug Fixes

* **doctor:** warn when AuthKitProvider missing apiHostname prop ([#68](https://github.com/workos/cli/issues/68)) ([3dfb3ca](https://github.com/workos/cli/commit/3dfb3cad73193f36fc4bac244c3f73ca2a49ee65))
* ensure .env.local is added to .gitignore during install ([#69](https://github.com/workos/cli/issues/69)) ([a21bfdc](https://github.com/workos/cli/commit/a21bfdc32b9eef9e1095c9d1a6c4ac47a7f7f2a5))
* redact sensitive info in logs and fix strict type violations ([#70](https://github.com/workos/cli/issues/70)) ([707193b](https://github.com/workos/cli/commit/707193bc079e725ebf695f400e749f1c9d5c28cd))

## [0.7.2](https://github.com/workos/cli/compare/v0.7.1...v0.7.2) (2026-02-19)


### Bug Fixes

* Correct issue submission links ([#66](https://github.com/workos/cli/issues/66)) ([8c3e026](https://github.com/workos/cli/commit/8c3e0267afcb78afa15df3ffd2ce1c5b2984a3cd))

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
