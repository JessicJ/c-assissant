# Connectors

Normalized provider adapters. Active V1 runtime providers are Google Maps, Google Weather, Telegram, official sources, and Uber handoff generation. WhatsApp Business Platform is an optional messaging Connector. Amap and QWeather remain as paused compatibility implementations.

It currently supports:

- keyword place search;
- address and city geocoding;
- driving, walking, and public-transit route distance and duration facts (with transit fare where Amap provides it);
- user-controlled Amap app route handoff built from Amap POI IDs and coordinates;
- explicit configuration and provider-failure states.

Telegram supports configuration and identity verification, polling, text and action delivery, callback acknowledgements, and explicit location requests. WhatsApp supports non-blocking readiness states, phone identity verification, service-window text, approved-template delivery, challenge verification, signed webhook validation, and normalized text/location/action/delivery events. WhatsApp remains optional; its access token and webhook secrets stay in the Server process and are stripped from Agent child environments.

Google Weather receives WGS-84 coordinates and returns normalized current conditions and a short daily forecast where supported. An HTTP 404 coverage response becomes connector status `unsupported`, distinct from temporary unavailability. The local server sends the key directly to Google; Skills and Agent runtimes receive only normalized facts or a safe failure classification. Amap and QWeather behavior is retained for compatibility tests but is not called by the active runtime.

Neither Connector makes recommendations, hails rides, performs payments, books services, or exposes credentials to the Web client. Official-source Connectors remain future work.
