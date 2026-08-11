/**
 * Intent detection using structured output.
 *
 * The router only classifies and extracts — it never decides what to *do*.
 * The service maps the returned intent onto a workflow, so routing stays in
 * application code and the structured shape never reaches the user.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { ChatbotIntent, ConversationState, IntentDecision } from './types';
import { CHATBOT_INTENTS } from './types';
import { INTENT_SYSTEM_PROMPT } from './prompts/system';

const INTENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    intent: { type: 'string', enum: CHATBOT_INTENTS },
    confidence: { type: 'number', description: '0..1' },
    extractedData: {
      type: 'object',
      description: 'Only values the user actually wrote',
      properties: {
        fullName: { type: 'string' },
        vehicleNumber: { type: 'string' },
        dateText: { type: 'string' },
        timeText: { type: 'string' },
        unit: { type: 'string' },
        reason: { type: 'string' },
        orderName: { type: 'string' },
        monthName: { type: 'string' },
        audience: { type: 'string' },
        topic: { type: 'string' },
      },
      additionalProperties: false,
    },
    needsClarification: { type: 'boolean' },
  },
  required: ['intent', 'confidence', 'extractedData', 'needsClarification'],
  additionalProperties: false,
};

export async function detectIntent(params: {
  client: Anthropic;
  model: string;
  message: string;
  conversation: ConversationState;
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<IntentDecision> {
  const { client, model, message, conversation, recentTurns } = params;

  const activeHint = conversation.activeWorkflow
    ? `\n\nיש תהליך פעיל: ${conversation.activeIntent}. אם ההודעה החדשה היא המשך או תשובה לשאלה בתהליך הזה — החזר את אותה כוונה.`
    : '';

  const history = recentTurns
    .slice(-6)
    .map(t => `${t.role === 'user' ? 'משתמש' : 'בוט'}: ${t.content}`)
    .join('\n');

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: INTENT_SYSTEM_PROMPT + activeHint,
    output_config: { format: { type: 'json_schema', schema: INTENT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `${history ? `היסטוריה אחרונה:\n${history}\n\n` : ''}ההודעה החדשה של המשתמש:\n${message}`,
      },
    ],
  } as any);

  // A refusal or an unexpected shape must degrade to UNKNOWN, not throw —
  // the bot should ask for clarification rather than go silent.
  if ((response as any).stop_reason === 'refusal') {
    return { intent: 'UNKNOWN', confidence: 0, extractedData: {}, needsClarification: true };
  }

  const text = response.content.find((b: any) => b.type === 'text') as any;
  if (!text?.text) {
    return { intent: 'UNKNOWN', confidence: 0, extractedData: {}, needsClarification: true };
  }

  try {
    const parsed = JSON.parse(text.text);
    const intent: ChatbotIntent = CHATBOT_INTENTS.includes(parsed.intent) ? parsed.intent : 'UNKNOWN';
    return {
      intent,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      extractedData: parsed.extractedData && typeof parsed.extractedData === 'object' ? parsed.extractedData : {},
      needsClarification: Boolean(parsed.needsClarification),
    };
  } catch {
    return { intent: 'UNKNOWN', confidence: 0, extractedData: {}, needsClarification: true };
  }
}
