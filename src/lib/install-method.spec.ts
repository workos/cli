import { describe, it, expect } from 'vitest';
import { detectInstallMethod, upgradeNotice } from './install-method.js';

describe('detectInstallMethod', () => {
  it.each([
    ['/opt/homebrew/Cellar/workos/0.18.0/bin/workos', 'homebrew'], // Apple Silicon
    ['/usr/local/Cellar/workos/0.18.0/bin/workos', 'homebrew'], // Intel mac
    ['/home/linuxbrew/.linuxbrew/Cellar/workos/0.18.0/bin/workos', 'homebrew'], // Linuxbrew
    ['/opt/homebrew/bin/workos', 'homebrew'], // unresolved symlink on PATH
  ] as const)('detects homebrew from %s', (execPath, expected) => {
    expect(detectInstallMethod(execPath)).toBe(expected);
  });

  it.each([
    ['/usr/local/lib/node_modules/@workos/cli-darwin-arm64/bin/workos', 'npm'], // global prefix
    ['/Users/dev/.nvm/versions/node/v20.11.0/lib/node_modules/@workos/cli-linux-x64/bin/workos', 'npm'], // nvm
  ] as const)('detects npm from %s', (execPath, expected) => {
    expect(detectInstallMethod(execPath)).toBe(expected);
  });

  it.each([
    ['/usr/local/bin/workos', 'download'], // manual copy onto PATH
    ['/Users/dev/Downloads/workos-darwin-arm64', 'download'], // ran from Downloads
    ['/Users/dev/.local/bin/workos', 'download'],
  ] as const)('falls back to download from %s', (execPath, expected) => {
    expect(detectInstallMethod(execPath)).toBe(expected);
  });
});

describe('upgradeNotice', () => {
  it('suggests brew for homebrew installs', () => {
    expect(upgradeNotice('homebrew')).toBe('Upgrade: brew upgrade workos');
  });

  it('suggests npm for npm installs', () => {
    expect(upgradeNotice('npm')).toBe('Upgrade: npm install -g workos@latest');
  });

  it('links to GitHub Releases for downloaded binaries', () => {
    expect(upgradeNotice('download')).toBe('Download: https://github.com/workos/cli/releases/latest');
  });
});
