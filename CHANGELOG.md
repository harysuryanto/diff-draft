# Change Log

All notable changes to the "diff-draft" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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