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
    description: 'Proper error handling and user-friendly error messages',
    scale: {
      1: 'Missing: no error handling, crashes on edge cases',
      2: 'Basic: catches some errors but poor messages or recovery',
      3: 'Acceptable: handles main errors, generic messages',
      4: 'Good: comprehensive error handling, helpful messages',
      5: 'Excellent: robust handling with actionable user-friendly messages',
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
