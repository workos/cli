export type WidgetsFramework =
  | 'nextjs'
  | 'react-router'
  | 'tanstack-start'
  | 'tanstack-router'
  | 'vite';

export type WidgetsDataFetching = 'react-query' | 'swr' | 'fetch';

export type WidgetsStyling =
  | 'tailwind'
  | 'css-modules'
  | 'css'
  | 'styled-components'
  | 'emotion'
  | 'scss';

export type WidgetsComponentSystem =
  | 'shadcn'
  | 'radix'
  | 'base-ui'
  | 'react-aria'
  | 'ariakit'
  | 'custom'
  | 'none';

export type WidgetsEntry = 'page' | 'component' | 'both';

export type WidgetsWidget =
  | 'user-management'
  | 'admin-portal-sso-connection'
  | 'admin-portal-domain-verification'
  | 'user-profile';

export interface WidgetsDetectionResult {
  framework?: WidgetsFramework;
  dataFetching: WidgetsDataFetching;
  styling: WidgetsStyling;
  componentSystem: WidgetsComponentSystem;
  usesTypeScript: boolean;
  packageManager: string;
}
