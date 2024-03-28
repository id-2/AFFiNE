import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { encoding_for_model, Tiktoken, TiktokenModel } from 'tiktoken';

import { PromptService } from './prompt';
import { ChatMessage, ChatMessageSchema, PromptMessage } from './types';

export interface ChatSessionOptions {
  userId: string;
  workspaceId: string;
  docId: string;
  promptName: string;
  // options
  action: string | null;
  model: TiktokenModel;
}

export interface ChatSessionState extends ChatSessionOptions {
  // connect ids
  sessionId: string;
  // states
  prompt: PromptMessage[];
  messages: ChatMessage[];
}

export class ChatSession implements AsyncDisposable {
  private readonly encoder: Tiktoken;
  private readonly promptTokenSize: number;
  constructor(
    private readonly state: ChatSessionState,
    model: TiktokenModel,
    private readonly dispose?: (state: ChatSessionState) => Promise<void>,
    private readonly maxTokenSize = 3840
  ) {
    this.encoder = encoding_for_model(model);
    this.promptTokenSize = this.encoder.encode_ordinary(
      state.prompt?.map(m => m.content).join('') || ''
    ).length;
  }

  get model() {
    return this.state.model;
  }

  push(message: ChatMessage) {
    this.state.messages.push(message);
  }

  pop() {
    this.state.messages.pop();
  }

  private takeMessages(): ChatMessage[] {
    if (this.state.action) {
      const messages = this.state.messages;
      return messages.slice(messages.length - 1);
    }
    const ret = [];
    const messages = [...this.state.messages];
    messages.reverse();
    let size = this.promptTokenSize;
    for (const message of messages) {
      const tokenSize = this.encoder.encode_ordinary(message.content).length;
      if (size + tokenSize > this.maxTokenSize) {
        break;
      }
      ret.push(message);
      size += tokenSize;
    }
    ret.reverse();
    return ret;
  }

  finish(): PromptMessage[] {
    const messages = this.takeMessages();
    return [...this.state.prompt, ...messages];
  }

  async save() {
    await this.dispose?.(this.state);
  }

  async [Symbol.asyncDispose]() {
    this.encoder.free();
    await this.save?.();
  }
}

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);
  constructor(
    private readonly db: PrismaClient,
    private readonly prompt: PromptService
  ) {}

  private async setSession(state: ChatSessionState): Promise<void> {
    await this.db.aiSession.upsert({
      where: {
        id: state.sessionId,
      },
      update: {
        messages: {
          create: state.messages.map((m, idx) => ({ idx, ...m })),
        },
      },
      create: {
        id: state.sessionId,
        messages: { create: state.messages },
        // connect
        user: { connect: { id: state.userId } },
        workspace: { connect: { id: state.workspaceId } },
        doc: {
          connect: {
            id_workspaceId: {
              id: state.docId,
              workspaceId: state.workspaceId,
            },
          },
        },
        prompt: { connect: { name: state.promptName } },
      },
    });
  }

  private async getSession(
    sessionId: string
  ): Promise<ChatSessionState | undefined> {
    return await this.db.aiSession
      .findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          userId: true,
          workspaceId: true,
          docId: true,
          messages: true,
          prompt: {
            select: {
              name: true,
              action: true,
              model: true,
              messages: {
                select: {
                  role: true,
                  content: true,
                },
                orderBy: {
                  idx: 'asc',
                },
              },
            },
          },
        },
      })
      .then(async session => {
        if (!session) return;
        const messages = ChatMessageSchema.array().safeParse(session.messages);

        return {
          sessionId: session.id,
          userId: session.userId,
          workspaceId: session.workspaceId,
          docId: session.docId,
          promptName: session.prompt.name,
          action: session.prompt.action,
          model: session.prompt.model as TiktokenModel,
          prompt: session.prompt.messages || [],
          messages: messages.success ? messages.data : [],
        };
      });
  }

  async create(options: ChatSessionOptions): Promise<string> {
    const sessionId = randomUUID();
    const prompt = await this.prompt.get(options.promptName);
    if (!prompt.length) {
      this.logger.warn(`Prompt not found: ${options.promptName}`);
    }
    await this.setSession({
      ...options,
      sessionId,
      prompt,
      messages: [],
    });
    return sessionId;
  }

  /**
   * usage:
   * ``` typescript
   * {
   *     // allocate a session, can be reused chat in about 12 hours with same session
   *     await using session = await session.get(sessionId);
   *     session.push(message);
   *     copilot.generateText(session.finish(), model);
   * }
   * // session will be disposed after the block
   * @param sessionId session id
   * @returns
   */
  async get(sessionId: string): Promise<ChatSession | null> {
    const state = await this.getSession(sessionId);
    if (state) {
      return new ChatSession(state, state.model, async state => {
        await this.setSession(state);
      });
    }
    return null;
  }
}
