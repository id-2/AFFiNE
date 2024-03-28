import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PromptMessage } from './types';

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
  async get(name: string): Promise<PromptMessage[]> {
    return this.db.aiPrompt
      .findUnique({
        where: {
          name,
        },
        select: {
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
      .then(p => p?.messages || []);
  }

  async set(name: string, messages: PromptMessage[]) {
    return await this.db.aiPrompt
      .create({
        data: {
          name,
          messages: {
            create: messages.map((m, idx) => ({ name, idx, ...m })),
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
