# Connector Contract

Connectors isolate external systems from Skills and Core. A Skill asks for a capability; the active Country Pack maps that capability to a provider.

## Boundary

A Connector may:

- authenticate with its provider;
- fetch or normalize external facts;
- send or edit messages when Core explicitly requests it;
- create a handoff link or location request;
- report provider errors and freshness metadata.

A Connector must not:

- decide whether a policy applies to a person;
- silently mutate a Plan;
- infer that opening a link completed an external action;
- expose provider credentials to a Skill or Agent runtime.

## Common result

```ts
type ConnectorStatus =
  | "available"
  | "degraded"
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unsupported";

interface ConnectorResult<T> {
  status: ConnectorStatus;
  data?: T;
  provider: string;
  observed_at: string;
  freshness?: {
    source_updated_at?: string;
    expires_at?: string;
  };
  evidence?: SourceReference[];
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Core decides whether to retry, degrade the experience, ask the user, or create a follow-up Task.

## Capability naming

Capabilities are stable product concepts, not provider method names. Examples:

- `location.geocode`
- `location.reverse_geocode`
- `place.search`
- `place.nearby`
- `route.plan`
- `weather.lookup`
- `handoff.map`
- `message.receive`
- `message.send`
- `message.edit`
- `message.request_location`
- `official_source.discover`
- `official_source.fetch`
- `official_source.extract`
- `official_source.snapshot`
- `official_source.compare`

Provider-specific response fields remain inside the Connector and are normalized before reaching Skills.

## Amap Connector

V1 capabilities:

- geocoding and reverse geocoding;
- place search and nearby search;
- route planning;
- weather lookup where the API supports the required area and horizon;
- map/search handoff links.

Amap supplies location and route facts. It does not decide which neighborhood, restaurant, hotel area, or transport option is best for the user. Those decisions belong to Skills using Plan context.

The Connector must preserve enough provider identifiers to produce stable handoffs, but provider payloads must not leak into long-term Profile data.

## Telegram Connector

V1 capabilities:

- receive text, button callbacks, and user-shared location;
- send messages, reminders, and action cards;
- edit a previously sent card when it remains valid;
- request location with an explicit Telegram control;
- attach Web and external-app links.

Each instance is bound to one user. Bot tokens are isolated from Agent runtimes and Skills. A location request is not a location read: Telegram still requires the user to tap and share.

Replies go back to Telegram when Telegram originated the interaction. Proactive reminders appear in Telegram and in the Web Inbox.

## Official Source Connector

This Connector maintains traceable policy evidence. It should:

1. discover candidate official pages;
2. fetch and retain the canonical URL and retrieval time;
3. extract relevant text and metadata;
4. create a `SourceSnapshot`;
5. compare a newer snapshot with the version used by an active Plan;
6. report freshness or access failures.

The Connector fetches source facts. The `policy-applicability` Skill determines applicability using nationality, document or visa status, residence status, purpose, place, and date.

Current implementation: the generic Connector accepts only a Country Pack-owned HTTPS domain allowlist and produces a bounded snapshot with original title, canonical URL, retrieval time, and content hash. China Pack starts with approved English government and first-party entry points. Core persists snapshots locally, deduplicates equal source/url/hash records, and reports a later differing hash as a content change. Source preparation links used snapshots to the draft Plan; successful compilation retains exact snapshot ID/hash pairs on dependent Tasks, the compilation Run, and corresponding Skill Runs. A registry entry, link, or content change alone never supports a policy conclusion.

Core exposes the registry as a read-only endpoint. Refreshing a single source is an explicit request and uses the registered source id; Core does not schedule background crawling in V1.

User-facing guidance is written in English. The source's original title should be retained alongside an English explanation and a direct link.

## External action handoff

```ts
type HandoffKind = "direct_link" | "search_handoff" | "copy_handoff";

interface ExternalHandoff {
  kind: HandoffKind;
  provider: string;
  label: string;
  url?: string;
  copy_text?: string;
  instructions?: string[];
  completion: "unknown_until_user_confirms";
}
```

V1 does not claim completion after a user opens Amap or Ctrip. Core may ask for confirmation only when knowing completion changes later execution.

## Security and observability

- Credentials are injected into the Connector process and redacted from logs.
- Every call receives a correlation ID and Run ID.
- Logs record capability, provider, timing, status, and error code, but not unnecessary personal data.
- Connector responses are bounded in size and validated before use.
- Rate limits and provider outages must degrade to explicit user-facing states.
