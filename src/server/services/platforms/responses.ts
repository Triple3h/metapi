import { StandardApiProviderAdapterBase } from './standardApiProvider.js';

export class ResponsesProtocolAdapter extends StandardApiProviderAdapterBase {
  readonly platformName = 'responses';

  async detect(_url: string): Promise<boolean> {
    // Responses-protocol upstreams are opt-in via preset or manual platform selection.
    return false;
  }

  async getModels(baseUrl: string, apiToken: string): Promise<string[]> {
    return this.fetchModelsFromStandardEndpoint({
      baseUrl,
      headers: { Authorization: `Bearer ${apiToken}` },
    });
  }
}
