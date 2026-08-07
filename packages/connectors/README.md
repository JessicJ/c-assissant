# Connectors

Normalized provider adapters. The implemented Connectors are Amap, QWeather, and a deliberately limited Telegram bot connector.

It currently supports:

- keyword place search;
- address and city geocoding;
- driving, walking, and public-transit route distance and duration facts (with transit fare where Amap provides it);
- user-controlled Amap app route handoff built from Amap POI IDs and coordinates;
- explicit configuration and provider-failure states.

Telegram currently supports local configuration-state reporting and an explicit `getMe` identity verification. It keeps `TELEGRAM_BOT_TOKEN` in the server process, returns no token to the Web client, and has no polling, pairing, message delivery, or reminder scheduling yet.

QWeather receives country-pack coordinates and returns normalised current conditions and a three-day forecast. The China Pack uses Amap geocoding to resolve a city or region to the GCJ-02 coordinates required by QWeather in mainland China. Its API Key is sent only in an HTTP header by the local server; the browser receives only the normalised facts, a retrieval time, and attribution URL.

Neither Connector makes recommendations, hails rides, performs payments, books services, or exposes credentials to the Web client. Official-source Connectors remain future work.
