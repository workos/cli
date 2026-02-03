import Anthropic from '@anthropic-ai/sdk';
import { QUALITY_RUBRICS, QUALITY_DIMENSIONS } from '../quality-rubrics.js';
import type { QualityGrade, QualityInput } from '../types.js';
import { formatKeyFilesForPrompt } from './collect-key-files.js';

const QUALITY_MODEL = 'claude-3-5-haiku-20241022';

export class QualityGrader {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async grade(input: QualityInput): Promise<QualityGrade | null> {
    if (input.keyFiles.size === 0) {
      return null;
    }

    const prompt = this.buildPrompt(input);

    try {
      const response = await this.client.messages.create({
        model: QUALITY_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      return this.parseResponse(content.text);
    } catch (error) {
      console.warn('Quality grading failed:', error);
      return null;
    }
  }

  private buildPrompt(input: QualityInput): string {
    const rubricText = QUALITY_DIMENSIONS.map((dim) => {
      const rubric = QUALITY_RUBRICS[dim];
      const scaleText = Object.entries(rubric.scale)
        .map(([score, desc]) => `  ${score}: ${desc}`)
        .join('\n');
      return `### ${rubric.name}\n${rubric.description}\n${scaleText}`;
    }).join('\n\n');

    const keyFilesText = formatKeyFilesForPrompt(input.keyFiles);

    // Chain-of-thought before scoring improves grading accuracy (Anthropic best practice)
    return `You are evaluating code written by an AI agent installing WorkOS AuthKit into a ${input.framework} project.

## Key Integration Files

${keyFilesText}

## Installation Metadata
- Files created: ${input.metadata.filesCreated.join(', ') || 'None'}
- Files modified: ${input.metadata.filesModified.join(', ') || 'None'}
- Tool activity: ${input.metadata.toolCallSummary}
- Checks passed: ${input.metadata.checksPassed.join(', ') || 'None'}

## Grading Rubrics
${rubricText}

## Instructions
First, analyze the code thoroughly in <thinking> tags. For each dimension, examine the code and determine the appropriate score based on the rubric. Consider specific examples from the code.

Then, output your final scores as JSON.

<thinking>
[Analyze each dimension here - what patterns do you see? What's done well? What could be better?]
</thinking>

{
  "codeStyle": <1-5>,
  "minimalism": <1-5>,
  "errorHandling": <1-5>,
  "idiomatic": <1-5>
}`;
  }

  private parseResponse(text: string): QualityGrade | null {
    try {
      // Extract chain-of-thought reasoning from <thinking> tags
      const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const reasoning = thinkingMatch?.[1]?.trim() || 'No reasoning provided';

      // Extract JSON scores (after thinking block)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      // Handle both formats: direct scores or nested { score: n }
      const getScore = (val: unknown): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'object' && val !== null && 'score' in val) {
          return (val as { score: unknown }).score as number;
        }
        return 3;
      };

      const dimensions = {
        codeStyle: this.clampScore(getScore(parsed.codeStyle)),
        minimalism: this.clampScore(getScore(parsed.minimalism)),
        errorHandling: this.clampScore(getScore(parsed.errorHandling)),
        idiomatic: this.clampScore(getScore(parsed.idiomatic)),
      };

      const score = Object.values(dimensions).reduce((a, b) => a + b, 0) / 4;

      return {
        score: Math.round(score * 10) / 10,
        dimensions,
        reasoning,
      };
    } catch (error) {
      console.warn('Failed to parse quality response:', error);
      return null;
    }
  }

  private clampScore(score: unknown): number {
    const num = typeof score === 'number' ? score : 3;
    return Math.max(1, Math.min(5, Math.round(num)));
  }
}
