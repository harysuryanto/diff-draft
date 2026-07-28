# DiffDraft

**DiffDraft** is a VS Code extension that generates intelligent commit message drafts from your Git diffs using OpenRouter AI.

## Features

- ✨ **AI-Powered Commit Messages**: Automatically generates professional Git commit messages using OpenRouter AI
- 🤖 **Model Pooling**: Automatically pools and fails over between high-capacity free models (`nvidia/nemotron-3-ultra-550b-a55b:free` and `openrouter/free`)
- 📝 **Conventional Commits**: Outputs formatted messages following Conventional Commits specification (e.g., `feat(auth): add login functionality`)
- 🔍 **Staged & Working Tree Support**: Analyzes both staged changes and working tree modifications
- 🔒 **Secure API Key Storage**: API keys are stored securely using VS Code's encrypted SecretStorage
- ⚡ **One-Click Generation**: Generate commit messages directly from the Source Control panel

## How to Use

1. Click the **✨ sparkle button** in the Source Control panel title bar
2. Enter your **OpenRouter API Key** when prompted (get one at [openrouter.ai](https://openrouter.ai))
3. The AI-generated commit message will appear in the commit input box
4. Review and edit the message if needed, then commit!

> **Note**: Your API key is stored securely and remembered for future sessions.

## Requirements

- VS Code 1.85.0 or higher
- Git extension enabled
- A valid [OpenRouter API Key](https://openrouter.ai)

## Building the Extension

Automated build script is available to compile and package the extension into a `.vsix` file formatted as `diff-draft-v{version}.vsix`:

```bash
# Build standard extension package
node scripts/build.js

# Or build with assigned API key embedded into .env
node scripts/build.js --api-key "sk-or-v1-your-key-here"
```

## Configuration

You can optionally set an environment variable to override the API key:

- `OVERRIDE_API_KEYS`: If set, these key(s) will be used instead of the stored key(s). Supports multiple keys separated by commas for rate-limit fallback (e.g. `sk-or-v1-key1,sk-or-v1-key2`)

## Release Notes

### 1.3.0

- 🔄 **Provider Migration**: Completely migrated LLM provider from Groq to OpenRouter.
- ⚡ **Real-Time Output Streaming**: Stream commit message tokens directly to the SCM panel and Webview sidebar as they arrive.
- 🤖 **Model Pooling**: Automatic fallback and pooling between `nvidia/nemotron-3-ultra-550b-a55b:free` and `openrouter/free`.
- 🛠️ **Automated Build Script**: Created `scripts/build.js` to package the extension into `diff-draft-v{version}.vsix` with optional `--api-key` argument.
- 🛡️ **Comprehensive Error Handling**: Dedicated error handling for OpenRouter status codes.

---

**Enjoy!** 🚀
