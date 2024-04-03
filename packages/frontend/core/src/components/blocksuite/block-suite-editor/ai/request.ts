import { getBaseUrl } from '@affine/graphql';
import { CopilotClient } from '@blocksuite/presets';
import type { Doc } from '@blocksuite/store';

export async function textToTextStream(
  doc: Doc,
  prompt: string
): Promise<EventSource> {
  const client = new CopilotClient(getBaseUrl());
  const session = await client.createSession({
    workspaceId: doc.collection.id,
    docId: doc.id,
    model: 'Gpt4TurboPreview',
    promptName: 'Summary',
  });

  return client.textToTextStream(prompt, session);
}
