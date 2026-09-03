import { createConnectorBundleFromEnvironment, createLocalConfigurationSnapshot, type ConnectorBundle } from "./connector-bundle.js";

export function createConnectorServices() {
  let connectors = createConnectorBundleFromEnvironment();

  function getConnectors(): ConnectorBundle {
    return connectors;
  }

  function replaceConnectors(next: ConnectorBundle): void {
    connectors = next;
  }

  return {
    getConnectors,
    replaceConnectors,
    getLocalConfiguration: () => createLocalConfigurationSnapshot(connectors.whatsapp)
  };
}
