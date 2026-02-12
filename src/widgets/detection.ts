import { existsSync } from 'fs';
import { join } from 'path';
import type { InstallerOptions } from '../utils/types.js';
import { getPackageDotJson } from '../utils/clack-utils.js';
import { hasPackageInstalled } from '../utils/package-json.js';
import { detectAllPackageManagers } from '../utils/package-manager.js';
import type {
  WidgetsComponentSystem,
  WidgetsDataFetching,
  WidgetsDetectionResult,
  WidgetsFramework,
  WidgetsStyling,
} from './types.js';

const STYLE_FILE_EXTS = ['.css', '.scss', '.sass', '.module.css', '.module.scss', '.module.sass'];

function hasAnyFile(installDir: string, paths: string[]): boolean {
  return paths.some((p) => existsSync(join(installDir, p)));
}

function detectFramework(packageJson: any, installDir: string): WidgetsFramework | undefined {
  if (hasPackageInstalled('next', packageJson)) return 'nextjs';
  if (hasPackageInstalled('@tanstack/react-start', packageJson)) return 'tanstack-start';
  if (hasPackageInstalled('@tanstack/react-router', packageJson)) return 'tanstack-router';
  if (hasPackageInstalled('react-router', packageJson) || hasPackageInstalled('react-router-dom', packageJson)) {
    return 'react-router';
  }

  if (
    hasPackageInstalled('vite', packageJson) ||
    hasAnyFile(installDir, ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'])
  ) {
    return 'vite';
  }

  return undefined;
}

function detectDataFetching(packageJson: any): WidgetsDataFetching {
  if (hasPackageInstalled('@tanstack/react-query', packageJson)) return 'react-query';
  if (hasPackageInstalled('swr', packageJson)) return 'swr';
  return 'fetch';
}

function detectStyling(packageJson: any, installDir: string): WidgetsStyling {
  if (
    hasPackageInstalled('tailwindcss', packageJson) ||
    hasAnyFile(installDir, ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts'])
  ) {
    return 'tailwind';
  }

  if (hasPackageInstalled('styled-components', packageJson)) return 'styled-components';
  if (hasPackageInstalled('@emotion/react', packageJson) || hasPackageInstalled('@emotion/styled', packageJson)) {
    return 'emotion';
  }
  if (hasPackageInstalled('sass', packageJson) || hasAnyFile(installDir, ['src/styles.scss', 'src/index.scss'])) {
    return 'scss';
  }

  if (hasAnyFile(installDir, ['src/app.module.css', 'src/styles.module.css'])) return 'css-modules';

  // Heuristic: if any css/scss exists, prefer css-modules over global css
  for (const ext of STYLE_FILE_EXTS) {
    if (hasAnyFile(installDir, [`src/index${ext}`, `src/app${ext}`])) {
      return ext.includes('module') ? 'css-modules' : ext.includes('scss') ? 'scss' : 'css-modules';
    }
  }

  return 'css-modules';
}

function detectComponentSystem(packageJson: any, installDir: string): WidgetsComponentSystem {
  if (existsSync(join(installDir, 'components.json'))) return 'shadcn';

  const deps = Object.keys({
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  });

  if (deps.some((name) => name.startsWith('@radix-ui/')) || deps.includes('radix-ui')) return 'radix';
  if (deps.includes('@base-ui/react')) return 'base-ui';
  if (deps.includes('react-aria-components')) return 'react-aria';
  if (deps.includes('@ariakit/react')) return 'ariakit';

  // Heuristic: custom components folder
  if (existsSync(join(installDir, 'src/components')) || existsSync(join(installDir, 'components'))) {
    return 'custom';
  }

  return 'none';
}

export async function detectWidgetsProject(options: Pick<InstallerOptions, 'installDir'>): Promise<WidgetsDetectionResult> {
  const packageJson = await getPackageDotJson(options);
  const framework = detectFramework(packageJson, options.installDir);
  const dataFetching = detectDataFetching(packageJson);
  const styling = detectStyling(packageJson, options.installDir);
  const componentSystem = detectComponentSystem(packageJson, options.installDir);
  const usesTypeScript = existsSync(join(options.installDir, 'tsconfig.json'));

  const detectedManagers = detectAllPackageManagers(options);
  const packageManager = detectedManagers.length > 0 ? detectedManagers[0].name : 'npm';

  return {
    framework,
    dataFetching,
    styling,
    componentSystem,
    usesTypeScript,
    packageManager,
  };
}
