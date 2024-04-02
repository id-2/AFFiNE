import { Injectable } from '@nestjs/common';
import { AiPrompt, PrismaClient } from '@prisma/client';
import { Tiktoken } from 'tiktoken';

import { getTokenEncoder, PromptMessage } from './types';

export class ChatPrompt {
  public readonly encoder?: Tiktoken;
  private readonly promptTokenSize: number;

  static createFromPrompt(
    options: Omit<AiPrompt, 'id' | 'createdAt'> & {
      messages: PromptMessage[];
    }
  ) {
    return new ChatPrompt(
      options.name,
      options.action,
      options.model,
      options.messages
    );
  }

  constructor(
    public readonly name: string,
    public readonly action: string | null,
    public readonly model: string | null,
    private readonly messages: PromptMessage[]
  ) {
    this.encoder = getTokenEncoder(model);
    this.promptTokenSize =
      this.encoder?.encode_ordinary(messages.map(m => m.content).join('') || '')
        .length || 0;
  }

  get tokens() {
    return this.promptTokenSize;
  }

  encode(message: string) {
    return this.encoder?.encode_ordinary(message).length || 0;
  }

  finish() {
    return this.messages.slice();
  }

  free() {
    this.encoder?.free();
  }
}

@Injectable()
export class PromptService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * list prompt names
   * @returns prompt names
   */
  async list() {
    return this.db.aiPrompt
      .findMany({ select: { name: true } })
      .then(prompts => Array.from(new Set(prompts.map(p => p.name))));
  }

  /**
   * get prompt messages by prompt name
   * @param name prompt name
   * @returns prompt messages
   */
  async get(name: string): Promise<ChatPrompt | null> {
    return this.db.aiPrompt
      .findUnique({
        where: {
          name,
        },
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
              createdAt: 'asc',
            },
          },
        },
      })
      .then(p => p && ChatPrompt.createFromPrompt(p));
  }

  async set(name: string, messages: PromptMessage[]) {
    return await this.db.aiPrompt
      .create({
        data: {
          name,
          messages: {
            create: messages.map((m, idx) => ({ idx, ...m })),
          },
        },
      })
      .then(ret => ret.id);
  }

  async update(name: string, messages: PromptMessage[]) {
    return this.db.aiPrompt
      .update({
        where: { name },
        data: {
          messages: {
            // cleanup old messages
            deleteMany: {},
            create: messages.map((m, idx) => ({ idx, ...m })),
          },
        },
      })
      .then(ret => ret.id);
  }

  async delete(name: string) {
    return this.db.aiPrompt.delete({ where: { name } }).then(ret => ret.id);
  }
}
