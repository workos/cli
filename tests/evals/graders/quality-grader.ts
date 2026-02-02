import Anthropic from '@anthropic-ai/sdk';
import { QUALITY_RUBRICS, QUALITY_DIMENSIONS, type QualityDimension } from '../quality-rubrics.js';
import type { QualityGrade } from '../types.js';

const QUALITY_MODEL = 'claude-3-5-haiku-20241022';

export class QualityGrader {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async grade(diff: string, framework: string): Promise<QualityGrade | null> {
    if (!diff || diff.trim().length === 0) {
      return null;
    }

    const prompt = this.buildPrompt(diff, framework);

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

  private buildPrompt(diff: string, framework: string): string {
    const rubricText = QUALITY_DIMENSIONS.map((dim) => {
      const rubric = QUALITY_RUBRICS[dim];
      const scaleText = Object.entries(rubric.scale)
        .map(([score, desc]) => `  ${score}: ${desc}`)
        .join('\n');
      return `### ${rubric.name}\n${rubric.description}\n${scaleText}`;
    }).join('\n\n');

    return `You are evaluating code changes made by an AI agent installing WorkOS AuthKit into a ${framework} project.

## Code Changes (git diff)
\`\`\`diff
${diff}
\`\`\`

## Grading Rubrics
${rubricText}

## Instructions
1. Analyze the code changes above
2. For each dimension, provide a score from 1-5 based on the rubric
3. Provide brief reasoning for each score

Respond with valid JSON in this exact format:
{
  "codeStyle": { "score": <1-5>, "reason": "<brief explanation>" },
  "minimalism": { "score": <1-5>, "reason": "<brief explanation>" },
  "errorHandling": { "score": <1-5>, "reason": "<brief explanation>" },
  "idiomatic": { "score": <1-5>, "reason": "<brief explanation>" }
}

Output only the JSON, no additional text.`;
  }

  private parseResponse(text: string): QualityGrade | null {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as Record<
        string,
        { score?: unknown; reason?: string }
      >;

      const dimensions = {
        codeStyle: this.clampScore(parsed.codeStyle?.score),
        minimalism: this.clampScore(parsed.minimalism?.score),
        errorHandling: this.clampScore(parsed.errorHandling?.score),
        idiomatic: this.clampScore(parsed.idiomatic?.score),
      };

      const score = Object.values(dimensions).reduce((a, b) => a + b, 0) / 4;

      const reasoning = QUALITY_DIMENSIONS.map(
        (dim) => `${QUALITY_RUBRICS[dim].name}: ${parsed[dim]?.reason || 'No reason provided'}`,
      ).join('\n');

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
