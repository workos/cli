# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-01-28

### Fixed

- Generate version at build time instead of importing package.json (fixes ERR_MODULE_NOT_FOUND)
- Auto-commit and PR creation after wizard completion (#21)
- Auto-fetch WorkOS credentials via device auth (#20)
- Branch protection detection in wizard flow

## [0.2.0] - 2026-01-28 [DEPRECATED]

### Added

- Auto-commit and PR creation after wizard completion (#21)
- Auto-fetch WorkOS credentials via device auth (#20)
- Branch protection detection in wizard flow

## [0.1.2] - 2026-01-23

### Fixed

- Next.js 15+ async cookies guards in skill

## [0.1.1] - 2026-01-23

### Fixed

- Dynamic import @statelyai/inspect to prevent npm runtime error

## [0.1.0] - 2026-01-23

### Added

- Initial release
- AI-powered CLI wizard for installing WorkOS AuthKit
- Support for Next.js, React SPA, React Router, TanStack Start, and Vanilla JS
- Interactive TUI dashboard with real-time progress
- Claude Agent SDK integration for intelligent code generation
- Framework auto-detection
- Skill-based architecture for framework-specific installation

[Unreleased]: https://github.com/workos/wizard/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/workos/wizard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/workos/wizard/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/workos/wizard/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/workos/wizard/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/workos/wizard/releases/tag/v0.1.0
