# Connectors

Normalized provider adapters. The implemented Connectors are Amap and a deliberately limited Telegram bot connector.

It currently supports:

- keyword place search;
- driving-route distance and duration facts;
- explicit configuration and provider-failure states.

Telegram currently supports local configuration-state reporting and an explicit `getMe` identity verification. It keeps `TELEGRAM_BOT_TOKEN` in the server process, returns no token to the Web client, and has no polling, pairing, message delivery, or reminder scheduling yet.

Neither Connector makes recommendations, hails rides, performs payments, books services, or exposes credentials to the Web client. Official-source, weather, and external-handoff Connectors remain future work.
