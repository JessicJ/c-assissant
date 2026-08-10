# China Country Pack

The first regional capability pack for Landi. V1 covers arrival preparation and an initial food, accommodation-area, and transport experience.

The pack is installed and versioned as one public unit. Its Skills remain independent internal modules so they can be tested, composed, and evolved safely.

The Node-side `chinaSkillRegistry` loads the internal `skill.json` files as runtime source, binds each declared entrypoint, and validates every invoked SkillResult envelope. It does not expose individual Skill installation or bypass Core authorization.

`china-arrival-plan` `0.1.0` is the registered composite gate. All seven supporting modules exist; it orders supplied results and preserves their provenance, while still blocking any run with a missing required result. A separate version-bound adapter may convert a ready composition into an inert Core draft proposal; the Skill itself still cannot mutate a Plan.

`local-food-guide` `0.1.0` provides bounded, bilingual destination food context only from traceable official-source facts. The first city catalogs cover Shanghai and Beijing with five references from each municipal-government English portal. They are available only after a matching city and fresh snapshot, then compile into the complete Plan's known information with the official source. It does not choose restaurants or propose transactions; specific nearby places remain a separate, explicit flow.

`digital-life-setup` `0.1.0` maps Plan-derived capability needs to fresh, allowlisted first-party setup guidance. It retains Chinese names, provides English steps, skips user-confirmed completed items, and never receives account secrets or infers completion from a link handoff.

The first reference catalog now covers mobile connectivity, communication, map navigation, and local payments with China Mobile SIM, WeChat, Amap, and Alipay preparation items. Static item instructions are joined at runtime only to the latest approved immutable snapshots from the Country Pack source registry. The loader selects the newest snapshot per source, omits page excerpts, and leaves a capability unresolved when current evidence is absent.

`arrival-preparation` `0.1.0` deduplicates normalized preparation items, preserves their supporting Skill versions, suppresses user-confirmed completed work, and calculates bounded Reminder proposals only from explicit offset-qualified schedule anchors. It proposes only; Core still owns Plan-version binding, persistence, confirmation, and activation.

The package-level China compilation adapter verifies that the exact arrival-preparation version and status were included in a ready composite before producing the country-neutral Core proposal. Core can compile that proposal into a new draft Plan, and the Server compilation service can persist the matching version atomically; Server entry-point assembly and user-facing review remain separate.

The package also exposes a deterministic arrival orchestrator. Given normalized, credential-free provider facts, it invokes all seven supporting Skills in the declared order, derives preparation items, composes them, and asks Core for a new inert draft. It does not fetch provider data, persist the result, or send messages; those responsibilities remain with the host application.

The first executable internal module is `food-nearby` `0.1.0`. Server invokes it after Amap returns normalized nearby POI facts; the Skill emits a bounded structured result while Telegram remains only a renderer and action-handoff surface. Individual Skill installation is still disabled.

`housing-area-recommendation` `0.1.0` adds the first access-oriented accommodation comparison to Web. It explains nearby stay candidates relative to a user-selected Plan anchor, while explicitly deferring full area choice until route facts and preferences are available.

`transport-planner` `0.1.0` turns current Amap route facts and this Plan's confirmed preference, party, luggage, and date-matched QWeather fact into an explainable preliminary mode. It uses relative route duration instead of a fixed walking-distance threshold and never starts travel.

`weather-and-packing` `0.1.0` is the shared weather interpretation path for Web, Telegram `/weather`, and delivery-time reminder refresh. It emits only cautious packing prompts from traceable QWeather facts and never presents a non-matching observation as a dated forecast.

`policy-applicability` `0.1.0` now owns the production evidence-preparation gate. It receives only minimized identity and Plan fields plus official snapshot metadata; `success` means ready for a separate source-backed review, never eligible or approved.

See [China Country Pack V1](../../docs/china-pack-v1.md).
