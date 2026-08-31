# Regional Capability Design: Japan V1

## Purpose

The Japan Country Pack is a regional capability implementation for Landi. It contributes Japan-specific preparation, official evidence, and a Tokyo demonstration path without changing the generic Plan lifecycle.

## Delivered scope

Japan Pack V1 provides a credential-free testable Tokyo preparation path alongside the China Pack. Google Maps supplies normalized destination-country, place, accommodation, and route facts; Google Weather supplies only supported current or forecast facts. Japan-specific official material remains isolated in the Japan registry and reference catalog.

The composition entry point is `japan-arrival-plan` `0.1.0`. Its seven supporting Skills use `japan-` names, execute in declared order, and cannot collide with China Skills. The result targets one exact draft Plan ID/version. Core creates the next draft without activating Tasks or Reminders, and SQLite verifies exact snapshot ID/hash pairs before the atomic write.

## Entry-policy boundary

The policy preparation gate considers nationality explicitly supplied by the user, travel purpose, stay length, departure and arrival dates, user-confirmed passport review status, and fresh Plan-linked MOFA snapshot metadata. It never infers nationality from name, language, or location and never states that a traveler is definitely visa-exempt or guaranteed entry. `success` means only that the traveler facts and evidence are ready for final official confirmation.

Missing identity facts return `needs_input`. Missing or stale MOFA evidence blocks regulated composition. The wording remains cautious: current official material may show no immediate action, but the result always depends on the supplied facts and final review on the official page.

## Verified official sources

These first-party HTTPS pages were verified on 2026-08-24:

- `jp-mofa-visa-exemption` — Japan Ministry of Foreign Affairs, [Exemption of Visa (Short-Term Stay)](https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html), for nationality/purpose/stay-sensitive review; seven-day Skill freshness.
- `jp-mofa-visa-faq` — Japan Ministry of Foreign Affairs, [VISA Frequently Asked Questions](https://www.mofa.go.jp/j_info/visit/visa/faq.html), for the visa/landing-permission boundary and final official confirmation; seven-day freshness.
- `jp-visit-japan-web` — Digital Agency, [Visit Japan Web](https://services.digital.go.jp/en/visit-japan-web/), for official digital arrival-service preparation; thirty-day freshness.
- `jp-jnto-ic-cards` — Japan National Tourism Organization, [IC Travel Cards](https://www.japan.travel/en/plan/ic-card/), for transport-card and small-payment orientation; thirty-day freshness.
- `jp-jreast-welcome-suica` — East Japan Railway Company, [Welcome Suica](https://www.jreast.co.jp/en/multi/welcomesuica/welcomesuica.html), for operator-specific Tokyo-area card coverage and conditions; thirty-day freshness.
- `jp-jnto-emergencies` — Japan National Tourism Organization, [Staying Safe in Japan](https://www.japan.travel/en/plan/emergencies/), for emergency preparation; thirty-day freshness.
- `jp-haneda-access` — Haneda Airport passenger-terminal operators, [Access](https://tokyo-haneda.com/en/access/index.html), for airport train, monorail, bus, and taxi orientation; thirty-day freshness.
- `jp-go-tokyo-food` — Tokyo Convention & Visitors Bureau, [Tokyo Local Food](https://www.gotokyo.org/en/see-and-do/drinking-and-dining/tokyo-local-food/index.html), for bilingual cultural orientation; thirty-day freshness.

Registry intervals are refresh metadata, not proof of a policy change. The catalog cannot satisfy freshness by itself. Runtime must join the exact source ID to a current immutable snapshot; cross-Pack IDs are rejected.

## Three-month timeline

The compiled draft proposes an initial review around 90 days before departure, explicit MOFA/open-item review at 30 days, weather/reservation/route checks at 7 days, a final flight/entry/airport check at 72 hours, arrival-day routing, return-airport routing, and explicit Plan completion or archival. Past reminder instants are omitted rather than compiled as stale.

Only the 7-day, arrival, and return Reminders declare the existing automatic weather refresh. Policy checks are reminders to perform an explicit review; V1 does not run a background policy monitor. During the trip, existing weather, route, and Telegram capabilities remain Core/Connector responsibilities.

## Honest limitations

Japan Pack does not book or buy flights, accommodation, restaurants, tickets, or passes; monitor live fares; pay; call a ride; store passport images or numbers; or decide visa/landing eligibility. Airport-to-accommodation route evaluation requires current Connector facts, a saved Japan arrival airport or station, and a saved accommodation coordinate; it honors the Plan transport preference when a matching route fact is available. A city-centre coordinate is never substituted for a missing airport. A distant seasonal expectation is never represented as a three-month forecast. Missing Connector facts degrade or block the relevant capability without fabricated replacements.
