# Change Log

All notable changes to the "diff-draft" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.2.1] - 2026-02-19

### Added
- **Comprehensive Error Handling**: Each Groq API error code now has a dedicated error class (`BadRequestError`, `NotFoundError`, `UnprocessableEntityError`, `FailedDependencyError`, `FlexTierCapacityError`, `ServerError`) with a specific, actionable user message.
- **Groq Status Code Coverage**: Handles all official Groq error codes — 400, 401, 403, 404, 413, 422, 424, 429, 498, 500, 502, 503 — with accurate behavior (e.g. only 429 triggers key fallback; server errors show Groq-side messaging).

### Changed
- **API Key Input**: API key fields (webview sidebar and command palette prompts) now display keys as plain text instead of obscured dots.

## [1.2.0] - 2026-02-19

### Added
- **Auto Model Switch**: Automatically switches from `openai/gpt-oss-120b` to Groq's largest context model (`moonshotai/kimi-k2-instruct-0905`) when the Git diff exceeds the default context window.
- **Smart Error Detection**: Detects context-too-large errors (413 or 400 with specific keywords) in real-time.
- **Improved UX**: Non-intrusive 5-second status bar notification when the model switch occurs.

## [1.1.0] - 2026-02-19

### Added
- **API Key Fallback**: Support for multiple API keys separated by commas.
- **Automatic Switching**: Automatically switches to the next available API key on rate limit (429) errors.
- **Status Bar Notifications**: Non-intrusive, auto-hiding status bar notifications when switching keys.

### Changed
- **Runtime Environment Check**: Environment variable overrides are now evaluated at runtime instead of build time.

## [1.0.4] - 2026-02-16

### Fixed
- **Invalid API Key Recovery**: Automatically clears stored API keys on authentication errors (401/403) and prompts for a new one.

### Added
- New `clearStoredApiKey` method for internal key management.

## [1.0.3] - 2026-02-14

### Security
- **Secure Storage**: Migrated API key storage to VS Code's encrypted `SecretStorage`.

### Added
- **API Key Validation**: Validates key format (`gsk_` prefix) before making requests.
- **Debouncing**: Prevents multiple simultaneous generation requests.

### Fixed
- Whitespace handling and race conditions in UI success state.

## [0.0.2] - 2026-02-10

### Added
- SCM title bar button for quick access.
- Dynamic icon states and success animation feedback.

## [0.0.1] - 2026-02-09

### Added
- Initial release.
- AI-powered commit message generation using Groq.
- Support for staged and working tree changes.