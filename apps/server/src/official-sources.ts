import type { ConnectorResult, OfficialSourceDefinition, OfficialSourceSnapshot } from "@c-assistant/connectors";
import type { SourceSnapshotInput, SourceSnapshotWriteResult } from "@c-assistant/core";

export interface OfficialSourceReader {
  discover(input?: { topic?: string | undefined }): ConnectorResult<OfficialSourceDefinition[]>;
  fetchSnapshot(input: { sourceId: string; url?: string | undefined }): Promise<ConnectorResult<OfficialSourceSnapshot>>;
}

export interface OfficialSourceSnapshotStore {
  saveSourceSnapshot(input: SourceSnapshotInput): SourceSnapshotWriteResult;
}

export function createOfficialSourceService(reader: OfficialSourceReader, store: OfficialSourceSnapshotStore) {
  return {
    discover(topic?: string): ConnectorResult<OfficialSourceDefinition[]> {
      return reader.discover({ ...(topic?.trim() ? { topic: topic.trim() } : {}) });
    },

    async refresh(input: { sourceId: string; url?: string | undefined }): Promise<ConnectorResult<SourceSnapshotWriteResult>> {
      const fetched = await reader.fetchSnapshot(input);
      if (fetched.status !== "available" || !fetched.data) {
        return { status: fetched.status, provider: fetched.provider, observedAt: fetched.observedAt, ...(fetched.failure ? { failure: fetched.failure } : {}) };
      }
      return { ...fetched, data: store.saveSourceSnapshot(fetched.data) };
    }
  };
}

export function parseOfficialSourceRegistry(value: unknown): OfficialSourceDefinition[] {
  if (!Array.isArray(value)) throw new Error("The official-source registry must be an array.");
  return value.map((entry) => {
    if (!isRecord(entry) || !isString(entry.id) || !isString(entry.authority) || !isString(entry.title) || !isString(entry.url) || !Array.isArray(entry.allowedDomains) || !entry.allowedDomains.every(isString) || !Array.isArray(entry.topics) || !entry.topics.every(isString) || (entry.language !== "en" && entry.language !== "zh" && entry.language !== "multilingual") || (entry.refreshHours !== undefined && (typeof entry.refreshHours !== "number" || !Number.isInteger(entry.refreshHours) || entry.refreshHours < 1))) {
      throw new Error("The official-source registry contains an invalid entry.");
    }
    if (!isApprovedRegistryUrl(entry.url, entry.allowedDomains)) throw new Error("The official-source registry must use approved HTTPS URLs.");
    return { id: entry.id, authority: entry.authority, title: entry.title, url: entry.url, allowedDomains: entry.allowedDomains, topics: entry.topics, language: entry.language, ...(typeof entry.refreshHours === "number" ? { refreshHours: entry.refreshHours } : {}) };
  });
}

function isApprovedRegistryUrl(value: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
