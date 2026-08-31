# Connector Contract

> Contributor reference. This contract defines how Landi obtains external facts and hands actions to provider applications. It is not part of the primary product-design reading path.

Current provider decision: Google Maps Platform is the active global place, route, and nearby-discovery provider; Google Weather is used only within its own coverage, and unsupported locations degrade without a regional fallback. Uber is the taxi handoff. Amap and QWeather are paused. Their sections below are retained as historical contracts only and do not describe an active runtime dependency.

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

## Messaging Connector contract

Telegram and WhatsApp implement the same minimal outbound capability contract: a channel identity, configuration status, and normalized text delivery receipt. Provider-specific controls remain typed extensions rather than leaking into Core.

Telegram is the default channel. WhatsApp is optional and may be left completely unconfigured without affecting Setup readiness. Its configuration progresses through `webhook_pending`, `template_pending`, and `available` states. WhatsApp free-form text is refused unless Core supplies a still-active user-opened 24-hour service window; proactive reminders use a named, approved template. Incoming WhatsApp webhooks must pass `X-Hub-Signature-256` HMAC verification before text, location, button/list replies, or delivery states are normalized. Neither access tokens, webhook secrets, verify tokens, nor raw webhook bodies may enter Profile, Plan, Skill input, or Agent runtime context.

The first inbound slice binds one international WhatsApp number in private instance configuration. A signed `wamid` is claimed once in SQLite before its text enters the shared bounded Plan/command handler, and Plan-generation Runs retain `trigger: whatsapp`. Other senders and duplicate deliveries are acknowledged but ignored. URL handoffs are rendered as text; callback confirmation and location controls explicitly remain Web/Telegram-only until native WhatsApp action state is implemented.

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

## Google Maps Connector

V1 capabilities:

- geocoding and reverse geocoding;
- place search and nearby search;
- route planning;
- weather lookup where the API supports the required area and horizon;
- map/search handoff links.

Google Maps supplies global location and route facts. It does not decide which neighborhood, restaurant, hotel area, or transport option is best for the user. Those decisions belong to Skills using Plan context.

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

V1 does not claim completion after a user opens Google Maps, Uber, or another external app. Core may ask for confirmation only when knowing completion changes later execution.

Google Maps Platform is the global source of place and route facts used for planning and conservative arrival timing. A taxi action opens Uber's mobile rider experience with the device's one-time WGS-84 pickup coordinate and the Plan destination text. The user must verify pickup, destination, availability, live fare, vehicle type, payment method, and the final request in Uber. Landi must not infer that opening the link hailed a ride, and it never sends Uber a client secret, access token, or payment credential. `UBER_CLIENT_ID` is optional public application attribution only; the V1 handoff does not require a privileged Ride Requests API integration. Amap and QWeather are paused and receive no runtime calls.

An ordinary Telegram URL button does not report a click to the bot. Current local instances therefore record `handoff_offered` only after Telegram accepts the message. `handoff_opened` is reserved for a future observable HTTPS redirect or Mini App event and must not be synthesized. The expected follow-up time may be calculated from the offer time, a conservative waiting buffer, the provider's route duration, and a safety margin. Such timing can trigger ordinary guidance with an `I haven't arrived` escape hatch, but never a critical action or factual completion.

## Security and observability

- Credentials are injected into the Connector process and redacted from logs.
- Every call receives a correlation ID and Run ID.
- Logs record capability, provider, timing, status, and error code, but not unnecessary personal data.
- Connector responses are bounded in size and validated before use.
- Rate limits and provider outages must degrade to explicit user-facing states.
