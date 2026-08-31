# AI Code Reading Coach

A minimal VS Code extension that turns selected code into a four-line Chinese knowledge card. It focuses on the likely knowledge gap instead of explaining every syntax element.

## Run locally

1. Run `npm install` and `npm run compile`.
2. Open this directory in VS Code and press `F5`.
3. In the Extension Development Host, select code and press `Ctrl+Alt+K` (`Cmd+Alt+K` on macOS).
4. Enter an OpenAI API key when prompted. VS Code stores it in SecretStorage.

The request is non-streaming. The completed card is shown only after the API response has been validated.

## Configuration

- `aiCodeReadingCoach.model`: OpenAI model ID. Defaults to `gpt-4.1-mini`.
- `aiCodeReadingCoach.apiBaseUrl`: Base URL of an OpenAI Responses-compatible API. Defaults to `https://api.openai.com/v1`.

When using a compatible third-party provider, both the selected code and API key
are sent to that provider rather than OpenAI.
