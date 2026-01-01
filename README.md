# DiffDraft

**DiffDraft** is a VS Code extension that generates intelligent commit message drafts from your Git diffs using AI.

## Features

- ✨ **AI-Powered Commit Messages**: Automatically generates professional Git commit messages using Groq AI
- 📝 **Conventional Commits**: Outputs formatted messages following Conventional Commits specification (e.g., `feat(auth): add login functionality`)
- 🔍 **Staged & Working Tree Support**: Analyzes both staged changes and working tree modifications
- ⚡ **Quick Commit**: Review, edit, and commit directly from the sidebar
- 💾 **State Persistence**: Remembers your API key and last generated message

## How to Use

1. Open the **DiffDraft** sidebar from the Activity Bar (edit icon)
2. Enter your **Groq API Key** (get one at [console.groq.com](https://console.groq.com))
3. Make some changes to your code
4. Click **"✨ Generate Commit Message"**
5. Review and edit the generated message if needed
6. Click **"Commit"** to commit your staged changes

## Requirements

- VS Code 1.107.0 or higher
- Git extension enabled
- A valid [Groq API Key](https://console.groq.com)

## Configuration

You can optionally set an environment variable to override the API key:

- `OVERRIDE_MODEL_API_KEY`: If set, this key will be used instead of the UI input

## Release Notes

### 0.0.1

- Initial release
- AI-powered commit message generation using Groq
- Support for staged and working tree changes
- Sidebar webview interface
- State persistence for API key and messages

---

**Enjoy!** 🚀
