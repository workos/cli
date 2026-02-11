export const QUALITY_RUBRICS = {
  codeStyle: {
    name: 'Code Style',
    description: 'Adherence to project conventions and formatting',
    scale: {
      1: 'Major violations: inconsistent indentation, wrong naming conventions, poor organization',
      2: 'Several issues: some style inconsistencies, minor formatting problems',
      3: 'Acceptable: mostly follows conventions with a few deviations',
      4: 'Good: follows conventions well, minor improvements possible',
      5: 'Excellent: exemplary adherence to project style, clean and consistent',
    },
  },
  minimalism: {
    name: 'Minimalism',
    description: 'Changes are focused and minimal, no unnecessary modifications',
    scale: {
      1: 'Excessive: many unnecessary changes, modified unrelated files, over-engineered',
      2: 'Bloated: some unnecessary additions or modifications',
      3: 'Acceptable: mostly focused, few extra changes',
      4: 'Good: changes are well-scoped with minimal extras',
      5: 'Excellent: surgically precise, only necessary changes made',
    },
  },
  errorHandling: {
    name: 'Error Handling',
    description: 'Appropriate error handling for the integration context',
    scale: {
      1: 'Dangerous: silently swallows errors, loses user data, or crashes without recovery',
      2: 'Poor: catches errors but ignores them, or shows raw stack traces to users',
      3: 'Acceptable: delegates to SDK/framework defaults, no custom handling needed for basic integration',
      4: 'Good: adds targeted error handling where it matters (callback failures, missing params)',
      5: 'Excellent: comprehensive handling with user-friendly messages and graceful degradation',
    },
  },
  idiomatic: {
    name: 'Idiomatic',
    description: 'Follows framework best practices and patterns',
    scale: {
      1: 'Anti-patterns: uses deprecated APIs, ignores framework conventions',
      2: "Suboptimal: works but doesn't follow recommended patterns",
      3: 'Acceptable: functional, follows basic patterns',
      4: 'Good: uses recommended patterns and APIs',
      5: 'Excellent: exemplary use of framework patterns and best practices',
    },
  },
} as const;

export type QualityDimension = keyof typeof QUALITY_RUBRICS;
export const QUALITY_DIMENSIONS: QualityDimension[] = ['codeStyle', 'minimalism', 'errorHandling', 'idiomatic'];
