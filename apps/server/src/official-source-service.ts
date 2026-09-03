import type { ConnectorResult, OfficialSourceDefinition } from "@c-assistant/connectors";
import type { SourceSnapshotWriteResult } from "@c-assistant/core";

export interface OfficialSourceService {
  discover(topic?: string): ConnectorResult<OfficialSourceDefinition[]>;
  refresh(input: { sourceId: string; url?: string | undefined }): Promise<ConnectorResult<SourceSnapshotWriteResult>>;
}
