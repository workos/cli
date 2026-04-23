import Anthropic from '@anthropic-ai/sdk';
import { QUALITY_RUBRICS, QUALITY_DIMENSIONS } from '../quality-rubrics.js';
import type { QualityGrade, QualityInput } from '../types.js';
import { formatKeyFilesForPrompt } from './collect-key-files.js';

const QUALITY_MODEL = 'claude-sonnet-4-6';

// Forces the model to emit grades via a typed tool call instead of prompt-engineered
// JSON. Eliminates parser brittleness and max_tokens truncation of free-form responses.
const GRADING_TOOL: Anthropic.Messages.Tool = {
  name: 'submit_quality_grades',
  description: 'Submit integer quality grades (1-5) for each dimension along with a brief overall reasoning.',
  input_schema: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description:
          'Concise analysis (3-6 sentences) explaining the scores. Reference specific patterns from the code.',
      },
      codeStyle: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Adherence to project and framework conventions.',
      },
      minimalism: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Focused changes, no extra files or unused code.',
      },
      errorHandling: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Appropriate error handling and user-facing messages.',
      },
      idiomatic: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: 'Follows framework best practices and recommended APIs.',
      },
    },
    required: ['reasoning', 'codeStyle', 'minimalism', 'errorHandling', 'idiomatic'],
  },
};

interface GradingToolInput {
  reasoning: string;
  codeStyle: number;
  minimalism: number;
  errorHandling: number;
  idiomatic: number;
}

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
        max_tokens: 2048,
        tools: [GRADING_TOOL],
        tool_choice: { type: 'tool', name: GRADING_TOOL.name },
        messages: [{ role: 'user', content: prompt }],
      });

      if (response.stop_reason === 'max_tokens') {
        console.warn(`Quality grading hit max_tokens for ${input.framework} scenario`);
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === 'tool_use' && block.name === GRADING_TOOL.name,
      );
      if (!toolUse) {
        console.warn('Quality grading returned no tool_use block');
        return null;
      }

      return this.toQualityGrade(toolUse.input as GradingToolInput);
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

Analyze the code against each rubric, then call the submit_quality_grades tool with your scores and a concise reasoning.`;
  }

  private toQualityGrade(input: GradingToolInput): QualityGrade {
    const dimensions = {
      codeStyle: this.clampScore(input.codeStyle),
      minimalism: this.clampScore(input.minimalism),
      errorHandling: this.clampScore(input.errorHandling),
      idiomatic: this.clampScore(input.idiomatic),
    };

    const score = Object.values(dimensions).reduce((a, b) => a + b, 0) / 4;

    return {
      score: Math.round(score * 10) / 10,
      dimensions,
      reasoning: input.reasoning || 'No reasoning provided',
    };
  }

  private clampScore(score: unknown): number {
    const num = typeof score === 'number' ? score : 3;
    return Math.max(1, Math.min(5, Math.round(num)));
  }
}
