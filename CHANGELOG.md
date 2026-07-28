# Change Log

All notable changes to the "diff-draft" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.2.1] - 2026-07-28

### Changed

- **Provider Migration**: Completely migrated LLM provider from Groq to OpenRouter API (`https://openrouter.ai/api/v1/chat/completions`).
- **Model Pooling**: Implemented model pooling using `['nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free']` with automatic failover between models and keys.
- **Build Automation**: Added `build.js` script to automate compiling and packaging the extension into `diff-draft-v{version}.vsix` with optional `--api-key` argument.
- **Key Validation**: Updated key validation to accept OpenRouter API key format (`sk-or-` prefix).
- **Error Handling**: Dedicated error handling and status bar notifications for OpenRouter status codes.

## [1.2.0] - 2026-02-19

### Added

- **Auto Model Switch**: Automatic failover handling for context-length errors.
- **Smart Error Detection**: Detects context-too-large errors in real-time.
- **Improved UX**: Non-intrusive status bar notifications during model fallback.

## [1.1.0] - 2026-02-19

### Added

- **API Key Fallback**: Support for multiple API keys separated by commas.
- **Automatic Switching**: Automatically switches to the next available API key on rate limit (429) errors.

## [1.0.4] - 2026-02-16

### Fixed

- **Invalid API Key Recovery**: Automatically clears stored API keys on authentication errors (401/403) and prompts for a new one.

## [1.0.3] - 2026-02-14

### Security

- **Secure Storage**: Migrated API key storage to VS Code's encrypted `SecretStorage`.

## [0.0.1] - 2026-02-09

### Added

- Initial release.
- AI-powered commit message generation.
