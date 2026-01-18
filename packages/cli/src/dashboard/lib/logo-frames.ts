// Scaled-down WorkOS logo frames for animation
// Original is 20 lines tall; this is ~10 lines for panel fit

const LOGO_SMALL = [
  '    *+++++++*++++*    ',
  '   *++++++++*++++++   ',
  '  *+++++*    *+++++*  ',
  ' *+++++*      *+++++* ',
  ' *++++*        *++++* ',
  ' *+++++*      *+++++* ',
  '  *+++++*    *+++++*  ',
  '   *++++++**++++++*   ',
  '    *++++*++*++++*    ',
];

// Purple gradient colors (256 color mode)
export const COLORS = {
  brightest: '38;5;225', // light lavender
  bright: '38;5;183', // lavender
  medium: '38;5;141', // medium purple
  dark: '38;5;135', // purple
  darker: '38;5;93', // deep purple
  darkest: '38;5;54', // dark purple
};

export type AnimationMode = 'spin' | 'pulse';

export interface LogoFrame {
  lines: string[];
  color: string;
}

// Pre-generate frames for spin animation
export function generateSpinFrames(): LogoFrame[] {
  const NUM_FRAMES = 32;
  const frames: LogoFrame[] = [];

  for (let f = 0; f < NUM_FRAMES; f++) {
    const angle = (f / NUM_FRAMES) * 2 * Math.PI;
    const cosA = Math.cos(angle);
    const absCos = Math.abs(cosA);

    // Color based on facing angle
    let color: string;
    if (absCos > 0.9) color = COLORS.brightest;
    else if (absCos > 0.7) color = COLORS.bright;
    else if (absCos > 0.5) color = COLORS.medium;
    else if (absCos > 0.3) color = COLORS.dark;
    else if (absCos > 0.15) color = COLORS.darker;
    else color = COLORS.darkest;

    // Project characters
    const projectedLines = LOGO_SMALL.map((line) => {
      const centerX = line.length / 2;
      const outChars = new Array(line.length).fill(' ');

      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        if (ch === ' ') continue;

        const x = col - centerX;
        const newX = x * cosA;
        const screenX = Math.round(centerX + newX);

        if (screenX >= 0 && screenX < line.length) {
          outChars[screenX] = ch;
        }
      }

      return outChars.join('');
    });

    frames.push({ lines: projectedLines, color });
  }

  return frames;
}

// Pre-generate frames for pulse animation
export function generatePulseFrames(): LogoFrame[] {
  const NUM_FRAMES = 24;
  const frames: LogoFrame[] = [];

  for (let f = 0; f < NUM_FRAMES; f++) {
    const angle = (f / NUM_FRAMES) * 2 * Math.PI;
    const brightness = (Math.cos(angle) + 1) / 2; // 0 to 1

    let color: string;
    if (brightness > 0.85) color = COLORS.brightest;
    else if (brightness > 0.7) color = COLORS.bright;
    else if (brightness > 0.5) color = COLORS.medium;
    else if (brightness > 0.35) color = COLORS.dark;
    else if (brightness > 0.2) color = COLORS.darker;
    else color = COLORS.darkest;

    frames.push({ lines: [...LOGO_SMALL], color });
  }

  return frames;
}

// Cache frames on first use
let spinFramesCache: LogoFrame[] | null = null;
let pulseFramesCache: LogoFrame[] | null = null;

export function getFrames(mode: AnimationMode): LogoFrame[] {
  if (mode === 'spin') {
    if (!spinFramesCache) spinFramesCache = generateSpinFrames();
    return spinFramesCache;
  } else {
    if (!pulseFramesCache) pulseFramesCache = generatePulseFrames();
    return pulseFramesCache;
  }
}

export const FRAME_DELAYS = {
  spin: 55,
  pulse: 80,
} as const;
