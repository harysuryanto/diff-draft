# DiffDraft

**DiffDraft** is a VS Code extension that generates intelligent commit message drafts from your Git diffs using AI.

## Features

- ✨ **AI-Powered Commit Messages**: Automatically generates professional Git commit messages using Groq AI
- 📝 **Conventional Commits**: Outputs formatted messages following Conventional Commits specification (e.g., `feat(auth): add login functionality`)
- 🔍 **Staged & Working Tree Support**: Analyzes both staged changes and working tree modifications
- 🔒 **Secure API Key Storage**: API keys are stored securely using VS Code's encrypted SecretStorage
- ⚡ **One-Click Generation**: Generate commit messages directly from the Source Control panel

## How to Use

1. Click the **✨ sparkle button** in the Source Control panel title bar
2. Enter your **Groq API Key** when prompted (get one at [console.groq.com](https://console.groq.com))
3. The AI-generated commit message will appear in the commit input box
4. Review and edit the message if needed, then commit!

> **Note**: Your API key is stored securely and remembered for future sessions.

## Requirements

- VS Code 1.85.0 or higher
- Git extension enabled
- A valid [Groq API Key](https://console.groq.com)

## Configuration

You can optionally set an environment variable to override the API key:

- `OVERRIDE_MODEL_API_KEY`: If set, this key will be used instead of the stored key

## Release Notes

### 1.0.4

- 🔄 **Invalid API Key Recovery**: When API returns authentication error (401/403), the stored key is automatically cleared and user is prompted to enter a new one
- 🛠️ Added `clearStoredApiKey` method for key management

### 1.0.3

- 🔒 **Secure API Key Storage**: API keys now stored securely via VS Code's SecretStorage (encrypted)
- ✅ **API Key Validation**: Now validates API key format (`gsk_` prefix) before making requests
- 🛡️ **Debouncing**: Prevents spam-clicking the generate button
- 🐛 **Bug Fixes**: Fixed race condition in success state, consistent whitespace handling
- 🔧 **Runtime Environment Check**: Override key now evaluated at runtime instead of build time

### 0.0.2

- Added SCM title bar button for quick access
- Dynamic icon states during generation
- Success animation feedback

### 0.0.1

- Initial release
- AI-powered commit message generation using Groq
- Support for staged and working tree changes

---

**Enjoy!** 🚀
