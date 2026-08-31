# Web

The local product workspace provides Plans and Settings. New Plan creation is conversational: a server-backed Planning Session collects the minimum goal facts, presents one versioned proposal, and invokes the selected Runtime only after the user confirms the latest version. The Plan surface embeds itinerary/timeline presentation, preparation, decisions, reminders, sources, and version-bound route refresh. Settings accepts write-only local Connector configuration without reading secret values back into the browser.

The root `pnpm test:browser` command builds the product and runs the isolated Chromium planning-flow regression against a temporary SQLite database. It covers first-use Profile setup, removal of the old questionnaire, one visible proposal, proposal V1→V2 revision, session continuation after closing the dialog, mobile overflow, and page runtime errors without contacting an Agent runtime or Connector.

It is not an operations console. The visible connection states are intentionally user-readable, while detailed diagnostics belong to local logs in later phases.
