import { ServerFeature } from '../../core/config';
import { Plugin } from '../registry';
import { PromptService } from './prompt';
import {
  assertProvidersConfigs,
  OpenAIProvider,
  ProviderService,
  registerCopilotProvider,
} from './providers';
import { ChatSessionService } from './session';

registerCopilotProvider(OpenAIProvider);

@Plugin({
  name: 'copilot',
  providers: [ChatSessionService, PromptService, ProviderService],
  contributesTo: ServerFeature.Copilot,
  if: config => {
    if (config.flavor.graphql) {
      return assertProvidersConfigs(config);
    }
    return false;
  },
})
export class CopilotModule {}

export type { CopilotConfig } from './types';
