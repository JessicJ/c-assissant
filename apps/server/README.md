# Server

Current provider decision: `GOOGLE_MAPS_API_KEY` supplies active place, route, nearby discovery, and weather calls. Weather is coverage-dependent: unsupported locations are reported as such and do not invoke a regional fallback. Uber supplies taxi handoff. Amap and QWeather are paused and their environment variables are ignored; legacy endpoint names remain temporarily so the separately developed Web workspace does not break during migration.

Use `pnpm configure:google` from the repository root to enter a new key through hidden terminal input and verify all three required Google APIs before the ignored local `.env` is updated.

The first local Core HTTP service. It initializes local SQLite storage, exposes a Workspace API, accepts a natural-language Plan request, and records a Plan confirmation.

Current endpoints:

- `GET /health`
- `GET /api/workspace`
- `GET /api/maintenance`, `POST /api/backups` for schema/integrity status and a verified private SQLite snapshot
- `GET /api/configuration`, `PUT /api/configuration` for write-only local Connector setup (secret values are never returned)
- `POST /api/plans/:planId/china/prepare`
- `POST /api/plans/:planId/confirm`
- `PUT /api/plans/:planId/accommodation`
- `PUT /api/plans/:planId/transport-preference`
- `PUT /api/plans/:planId/travel-context`
- `PUT /api/plans/:planId/arrival`
- `PUT /api/profile`
- `GET /api/runtimes`, `GET /api/runtimes/codex`, `GET /api/runtimes/claude-code`
- `PUT /api/runtime`
- `GET /api/official-sources`
- `POST /api/official-sources/:sourceId/refresh`
- `GET /api/connectors/google`
- `GET /api/connectors/amap`
- `GET /api/connectors/qweather`
- `GET /api/runs/task-reminders` for minimized local Reminder Run audit records
- `GET /api/runs/plan-compilations`, `GET /api/runs/country-pack-skills` for minimized Country Pack audit records
- `POST /api/agent/chat` for conversational planning or one focused draft-revision turn
- `POST /api/planning-sessions/:sessionId/confirm` to generate a complete Plan only after the user confirms the latest proposal
- `GET /api/weather?location=<city-or-region>&language=en|zh`
- `GET /api/maps/places?query=<place>&region=<optional-region>`
- `GET /api/maps/nearby/restaurants?location=<longitude,latitude>`
- `GET /api/maps/nearby/accommodation?location=<longitude,latitude>`
- `GET /api/maps/routes/driving?origin=<longitude,latitude>&destination=<longitude,latitude>`
- `GET /api/maps/routes/walking?origin=<longitude,latitude>&destination=<longitude,latitude>`
- `GET /api/maps/routes/transit?origin=<longitude,latitude>&destination=<longitude,latitude>`
- `POST /api/plans/:planId/accommodation/manual` with `{ name, address, status }` to resolve a user-entered stay address before saving it to that Plan
- `POST /api/plans/:planId/accommodation/linked` with `{ expectedVersion, name, address, status }` to save a draft stay and atomically attach verified-or-pending accommodation departure facts to each scheduled day
- `POST /api/plans/:planId/tasks/:taskId/reminder/cancel` to remove one proposed or active Task reminder from the current Plan
- `GET /api/connectors/telegram`
- `POST /api/connectors/telegram/verify`
- `GET /api/connectors/whatsapp`
- `POST /api/connectors/whatsapp/verify`
- `GET /api/connectors/whatsapp/webhook`

Profile, selected runtime type, source snapshots, and Plan state persist locally. Web creation begins as a conversational Planning Session; the runtime can generate a complete Plan only after the user confirms the latest proposal version. A selected accommodation can be saved as a Plan-scoped candidate and, after the user explicitly confirms a completed external booking, marked as confirmed; each change increments the Plan version. The Plan also stores an optional local expected-arrival time and time zone, transport preference, party/luggage context, and structured Task reminder proposals. A Task reminder is inert in a draft; after Plan activation, the Server attempts Telegram delivery at its exact zoned time or within a 30-minute restart catch-up window. Retryable failures use one-minute and five-minute backoff, with at most three attempts; terminal failure and success are mirrored to Web Inbox, and attempts are persistently deduplicated. Cancelling a reminder removes it from the current Plan and increments the Plan version. Every delivery claim rechecks the current Plan and exact reminder content, including its dynamic-fact policy, so a cancelled, changed, or superseded reminder cannot start a stale attempt. After a claim, the Server resolves the current Plan location and refreshes Google Weather only when the reminder explicitly declares `refreshFacts: ["weather"]`; absent or empty declarations make no weather call. An exact-date forecast is appended with retrieval time, attribution, and conservative rain/temperature/UV guidance; if Google is unavailable, the original reminder still sends without weather. Weather snapshots used here are delivery-time context and are not persisted. One minimized Task Reminder Run spans all retry attempts and retains only identifiers, due/start/finish times, attempt count, weather availability/failure classification, Telegram failure classification, and final state. It stores no message copy, weather response, coordinate, account identity, or credential. `GET /api/official-sources` only lists the Country Pack allowlist; an explicit `POST /api/official-sources/:sourceId/refresh` may fetch that one approved source and persist/compare its evidence snapshot, without reaching a policy conclusion. The weather route uses Google Maps geocoding followed by Google Weather current and three-day facts; it does not create a reminder or change a Plan. Nearby restaurant discovery returns Google Maps place and distance facts. Nearby accommodation discovery additionally runs the internal `housing-area-recommendation` Skill and returns preliminary access reasons relative to the selected Plan anchor; it does not claim route time, price, inventory, booking, payment, or foreign-guest eligibility. The Telegram verification route only calls the Bot API after the user explicitly presses Verify in the Web workspace; it does not pair chats or send messages. Non-taxi routes hand off to Google Maps and taxi actions hand off to Uber; Landi starts neither navigation nor a ride request.

The bound Telegram chat can review and activate a draft without switching to Web. `/prepare` refreshes approved sources and invokes the complete China Pack workflow for the current draft. `/plan`, successful preparation, and newly generated drafts are sent in complete, ordered pages; only the final page carries `Confirm complete Plan`. The callback contains the Plan id and version, so an old button cannot activate a replaced or edited Plan. Confirmation activates declared reminder scope but starts no booking, payment, ride, or other external action.

Ordinary Telegram text revises the current user-created draft, while `/new <request>` always creates a separate Plan. Revision gives the selected Runtime only a sanitized complete draft and the new correction. A successful result is saved as a replacement draft with the prior Plan-scoped configuration but without automatically carrying official evidence links. Runtime failure leaves the existing draft unchanged, and an optimistic Plan id/version check prevents a slow stale Run from overwriting newer user state.

`/profile` returns the locally saved long-term basics and explicit edit controls. Name, preferred language, and nationality use a persisted 15-minute next-message state; gender and China visa/residence status use allowlisted callback values. Commands and Telegram locations bypass text-field capture. Partial setup remains `incomplete`, and the status never claims that a policy applies. Unpairing clears only a pending text edit alongside the chat binding; already saved Profile values remain local.

`/weather` is an explicit, read-only check for the current Plan location. It resolves that location through Google Maps and, where supported, requests Google Weather current and three-day facts, labels observations and forecast dates, retains only an approved attribution link, and gives conservative packing checks. Missing configuration, unresolved Plan location, unsupported coverage, rate limits, and provider failures are reported without invented weather. The command does not create a Reminder, persist a weather snapshot, or modify the Plan or Profile.

`/food` asks for a missing Plan-scoped party size, then explicitly requests one Telegram location share. Location intent is bound to the current Plan and either `nearby_food` or `arrival_route`, expires after 15 minutes, and is consumed before provider work; unsolicited, expired, or stale-Plan coordinates are rejected and coordinates are never stored. A nearby-food request uses the one-time WGS-84 point and returns up to five factual Google Maps candidates with straight-line distance and HTTPS place links. It performs no independent ranking, availability check, order, reservation, or payment. Arrival taxi actions use the same temporary point to build an Uber rider handoff while Google Maps supplies route duration and distance facts. The user confirms the live ride details in Uber; Landi records no booking or payment fact.

The old `/api/amap/*` routes remain temporary aliases for a separately migrated Web workspace. They call Google Maps and do not call Amap or use an Amap credential.

WhatsApp Business Platform is an optional Connector and is not part of Setup readiness. `pnpm configure:whatsapp` verifies a current phone identity and writes credentials plus one explicitly paired international user number only to the private local `.env`. The Server exposes credential-free configuration state, phone-number verification, Meta's webhook challenge, and a signed webhook POST endpoint. Valid text from that one number is persistently deduplicated and enters the same bounded Plan/command path with a distinct `whatsapp` Run trigger. URL handoffs are preserved as text. Plan confirmation callbacks and location actions still direct the user to Web or Telegram and never pretend to work natively. The Connector refuses free-form outbound text outside a user-opened service window and provides a separate approved-template path for future proactive-reminder channel selection. No WhatsApp credential or raw webhook body is stored or passed to an Agent or Skill.
