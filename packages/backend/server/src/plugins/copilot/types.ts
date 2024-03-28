import { AiPromptRole } from '@prisma/client';
import type { ClientOptions as OpenAIClientOptions } from 'openai';
import { TiktokenModel } from 'tiktoken';
import { z } from 'zod';

export interface CopilotConfig {
  openai: OpenAIClientOptions;
  fal: {
    secret: string;
  };
}

export enum AvailableModels {
  // text to text
  Gpt4VisionPreview = 'gpt-4-vision-preview',
  Gpt4TurboPreview = 'gpt-4-turbo-preview',
  Gpt35Turbo = 'gpt-3.5-turbo',
  // embeddings
  TextEmbedding3Large = 'text-embedding-3-large',
  TextEmbedding3Small = 'text-embedding-3-small',
  TextEmbeddingAda002 = 'text-embedding-ada-002',
  // moderation
  TextModerationLatest = 'text-moderation-latest',
  TextModerationStable = 'text-moderation-stable',
}

export type AvailableModel = keyof typeof AvailableModels;

export function AvailableModelToTiktokenModel(
  model: AvailableModel
): TiktokenModel {
  const modelStr = AvailableModels[model];
  if (modelStr.startsWith('gpt')) {
    return modelStr as TiktokenModel;
  } else {
    return 'cl100k_base' as TiktokenModel;
  }
}

// ======== ChatMessage ========

export const ChatMessageRole = Array.from(Object.values(AiPromptRole)) as [
  'system',
  'assistant',
  'user',
];

export const PromptMessageSchema = z.object({
  role: z.enum(ChatMessageRole),
  content: z.string(),
  attachments: z.array(z.string()).optional(),
});

export type PromptMessage = z.infer<typeof PromptMessageSchema>;

export const ChatMessageSchema = PromptMessageSchema.extend({
  createdAt: z.date(),
}).strict();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatHistorySchema = z
  .object({
    sessionId: z.string(),
    tokens: z.number(),
    messages: z.array(ChatMessageSchema),
  })
  .strict();

export type ChatHistory = z.infer<typeof ChatHistorySchema>;

// ======== Provider Interface ========

export enum CopilotProviderType {
  FAL = 'fal',
  OpenAI = 'openai',
}

export enum CopilotProviderCapability {
  TextToText = 'text-to-text',
  TextToEmbedding = 'text-to-embedding',
  TextToImage = 'text-to-image',
  ImageToImage = 'image-to-image',
}

export interface CopilotProvider {
  getCapabilities(): CopilotProviderCapability[];
}

export interface CopilotTextToTextProvider extends CopilotProvider {
  generateText(
    messages: PromptMessage[],
    model: string,
    options: {
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
      user?: string;
    }
  ): Promise<string>;
  generateTextStream(
    messages: PromptMessage[],
    model: string,
    options: {
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
      user?: string;
    }
  ): AsyncIterable<string>;
}

export interface CopilotTextToEmbeddingProvider extends CopilotProvider {}

export interface CopilotTextToImageProvider extends CopilotProvider {}

export interface CopilotImageToImageProvider extends CopilotProvider {}

export type CapabilityToCopilotProvider = {
  [CopilotProviderCapability.TextToText]: CopilotTextToTextProvider;
  [CopilotProviderCapability.TextToEmbedding]: CopilotTextToEmbeddingProvider;
  [CopilotProviderCapability.TextToImage]: CopilotTextToImageProvider;
  [CopilotProviderCapability.ImageToImage]: CopilotImageToImageProvider;
};