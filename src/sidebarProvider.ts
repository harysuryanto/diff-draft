import * as vscode from "vscode";
import { GitExtension, Repository } from "./git";

const API_KEYS_SECRET_KEY = "diffDraft.openrouterApiKeys";

const MODEL_POOL = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openrouter/free",
];

// Custom error class for authentication failures
class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

// Custom error class for rate-limit errors
class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

// Custom error class for context-length / request-too-large errors
class ContextTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextTooLargeError";
  }
}

// Custom error class for bad requests (400) that are NOT context-length issues
class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

// Custom error class for not-found errors (404)
class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Custom error class for unprocessable entity errors (422)
class UnprocessableEntityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnprocessableEntityError";
  }
}

// Custom error class for failed dependency errors (424)
class FailedDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FailedDependencyError";
  }
}

// Custom error class for server-side errors (500, 502, 503, 504)
class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  private _iconIndex = 0; // Counter for sequential icon rotation
  private _isGenerating = false; // Debounce flag to prevent spam clicks

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _secrets: vscode.SecretStorage,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Check if override key is set at runtime
    const hasOverrideKey = !!process.env.OVERRIDE_API_KEYS?.trim();
    webviewView.webview.html = this._getHtmlForWebview(
      webviewView.webview,
      hasOverrideKey,
    );

    // Listen for messages from the UI
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "generate":
          await this.generateCommitMessage(data.apiKey);
          break;
        case "commit":
          await this.commitChanges(data.message);
          break;
      }
    });
  }

  // --- GIT LOGIC ---

  private async getRepo(): Promise<Repository | undefined> {
    const gitExtension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
      vscode.window.showErrorMessage("Git extension not found.");
      return;
    }

    // Ensure the extension is activated before using it
    if (!gitExtension.isActive) {
      try {
        await gitExtension.activate();
      } catch (e) {
        vscode.window.showErrorMessage("Failed to activate Git extension.");
        return;
      }
    }

    const git = gitExtension.exports.getAPI(1);

    // Check if any repositories are available
    if (!git.repositories || git.repositories.length === 0) {
      vscode.window.showErrorMessage(
        "No Git repository found. Please open a folder with a Git repository.",
      );
      return;
    }

    return git.repositories[0];
  }

  /**
   * Generate commit message and insert it into the SCM input box.
   * Called from the SCM title bar button command.
   */
  public async generateCommitMessageForSCM(): Promise<void> {
    // Debounce: prevent multiple simultaneous generations
    if (this._isGenerating) {
      return;
    }

    const overrideRaw = process.env.OVERRIDE_API_KEYS?.trim();
    const overrideKeys = overrideRaw
      ? overrideRaw
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : [];
    const storedKeys = await this.getStoredApiKeys();
    const apiKeys: string[] =
      overrideKeys.length > 0 ? overrideKeys : storedKeys;

    if (apiKeys.length === 0) {
      const inputRaw = await vscode.window.showInputBox({
        prompt:
          "Enter your OpenRouter API Key(s) — separate multiple keys with commas",
        password: false,
        placeHolder: "sk-or-v1-..., sk-or-v1-...",
        ignoreFocusOut: true,
        validateInput: (value) => {
          const keys = value
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
          if (keys.length === 0) {
            return "API key cannot be empty.";
          }
          for (const k of keys) {
            if (!k.startsWith("sk-or-") && !k.startsWith("sk-")) {
              return `Invalid key format: "${k.substring(0, 10)}...". OpenRouter keys start with 'sk-or-'.`;
            }
            if (k.length < 15) {
              return `API key "${k.substring(0, 10)}..." appears too short.`;
            }
          }
          return null; // Valid
        },
      });

      if (!inputRaw?.trim()) {
        vscode.window.showWarningMessage(
          "API key is required to generate commit message.",
        );
        return;
      }

      // Store the comma-separated key(s) for future use
      await this.storeApiKey(inputRaw.trim());
      const parsedKeys = inputRaw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      return this.generateCommitMessageWithKeys(parsedKeys);
    }

    return this.generateCommitMessageWithKeys(apiKeys);
  }

  /**
   * Prompt the user to enter new API key(s) and store them.
   * Called from the "DiffDraft: Change API Key" command.
   */
  public async changeApiKey(): Promise<void> {
    // Show current key count for context
    const existingKeys = await this.getStoredApiKeys();
    const placeholder =
      existingKeys.length > 0
        ? `${existingKeys.length} key(s) currently stored — enter new key(s) to replace`
        : "sk-or-v1-..., sk-or-v1-...";

    const inputRaw = await vscode.window.showInputBox({
      prompt:
        "Enter your OpenRouter API Key(s) — separate multiple keys with commas",
      password: false,
      placeHolder: placeholder,
      ignoreFocusOut: true,
      validateInput: (value) => {
        const keys = value
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        if (keys.length === 0) {
          return "API key cannot be empty.";
        }
        for (const k of keys) {
          if (!k.startsWith("sk-or-") && !k.startsWith("sk-")) {
            return `Invalid key format: "${k.substring(0, 10)}...". OpenRouter keys start with 'sk-or-'.`;
          }
          if (k.length < 15) {
            return `API key "${k.substring(0, 10)}..." appears too short.`;
          }
        }
        return null;
      },
    });

    if (!inputRaw?.trim()) {
      return; // User cancelled
    }

    await this.storeApiKey(inputRaw.trim());
    const count = inputRaw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean).length;
    vscode.window.setStatusBarMessage(
      `$(key) DiffDraft: ${count} API key(s) saved successfully`,
      5000,
    );
  }

  /**
   * Returns all stored API keys as an array (comma-separated storage).
   */
  private async getStoredApiKeys(): Promise<string[]> {
    try {
      const raw = await this._secrets.get(API_KEYS_SECRET_KEY);
      if (!raw?.trim()) {
        return [];
      }
      return raw
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Stores the raw key string (may be comma-separated) as-is after trimming.
   */
  private async storeApiKey(key: string): Promise<void> {
    try {
      const trimmedKey = key.trim();
      if (trimmedKey) {
        await this._secrets.store(API_KEYS_SECRET_KEY, trimmedKey);
      }
    } catch (error) {
      console.error("Failed to store API key:", error);
    }
  }

  private async clearStoredApiKey(): Promise<void> {
    try {
      await this._secrets.delete(API_KEYS_SECRET_KEY);
    } catch (error) {
      console.error("Failed to clear API key:", error);
    }
  }

  private async generateCommitMessageWithKeys(
    apiKeys: string[],
  ): Promise<void> {
    // Validate API keys
    const validKeys = apiKeys.map((k) => k.trim()).filter(Boolean);
    if (validKeys.length === 0) {
      vscode.window.showErrorMessage("API key cannot be empty.");
      return;
    }

    const repo = await this.getRepo();
    if (!repo) {
      return;
    }

    // Check for staged changes first, then working tree changes
    let changes = repo.state.indexChanges;
    let isStaged = true;

    if (changes.length === 0) {
      changes = repo.state.workingTreeChanges;
      isStaged = false;
    }

    if (changes.length === 0) {
      vscode.window.showWarningMessage(
        "No changes detected (staged or working tree).",
      );
      return;
    }

    // Set debounce flag
    this._isGenerating = true;

    // Sequential icon selection (0-4): watch → flame → loading → wand → symbol-color
    const iconCount = 5;
    const currentIconIndex = this._iconIndex;
    this._iconIndex = (this._iconIndex + 1) % iconCount; // Rotate for next time

    // Track whether we succeeded (to avoid resetting state in finally block)
    let succeeded = false;

    // Set generating state with icon - hides sparkle, shows icon (disabled)
    await vscode.commands.executeCommand(
      "setContext",
      "diffDraft.isGenerating",
      true,
    );
    await vscode.commands.executeCommand(
      "setContext",
      "diffDraft.generatingIcon",
      currentIconIndex,
    );

    try {
      // Collect diffs
      let fullDiff = "";
      try {
        for (const change of changes) {
          const diff = isStaged
            ? await repo.diffIndexWithHEAD(change.uri.fsPath)
            : await repo.diffWithHEAD(change.uri.fsPath);
          fullDiff += `\n--- File: ${change.uri.fsPath} ---\n${diff}`;
        }
      } catch (e) {
        vscode.window.showErrorMessage("Error reading git diffs.");
        return;
      }

      if (!fullDiff.trim()) {
        vscode.window.showErrorMessage(
          "No text diff available. Changes may be binary files only.",
        );
        return;
      }

      // Call OpenRouter API with model pooling and key fallback
      const result = await this.callOpenRouter(validKeys, fullDiff);

      // Insert the result into the SCM input box
      repo.inputBox.value = result;
      succeeded = true;

      // Show success state (check icon) for 2 seconds
      await vscode.commands.executeCommand(
        "setContext",
        "diffDraft.isGenerating",
        false,
      );
      await vscode.commands.executeCommand(
        "setContext",
        "diffDraft.generatingIcon",
        -1,
      );
      await vscode.commands.executeCommand(
        "setContext",
        "diffDraft.isSuccess",
        true,
      );

      // After 2 seconds, hide success icon and show sparkle again
      setTimeout(async () => {
        await vscode.commands.executeCommand(
          "setContext",
          "diffDraft.isSuccess",
          false,
        );
      }, 2000);
    } catch (error: any) {
      // Check if it's an authentication error (invalid API key)
      if (error instanceof ApiKeyError) {
        // Clear the invalid stored key(s)
        await this.clearStoredApiKey();

        // Show error and prompt for new key
        const retry = await vscode.window.showErrorMessage(
          "Invalid API key. The stored key(s) have been cleared.",
          "Enter New Key",
        );

        if (retry === "Enter New Key") {
          // Recursively call the parent method to prompt for a new key
          return this.generateCommitMessageForSCM();
        }
      } else if (error instanceof ServerError) {
        vscode.window.showErrorMessage(
          "OpenRouter server error — please try again later.",
        );
      } else if (error instanceof NotFoundError) {
        vscode.window.showErrorMessage(
          "OpenRouter API: resource not found (404). The model may not exist or the endpoint URL is wrong.",
        );
      } else if (error instanceof UnprocessableEntityError) {
        vscode.window.showErrorMessage(
          "OpenRouter could not process the request (422). Try again or simplify your changes.",
        );
      } else if (error instanceof FailedDependencyError) {
        vscode.window.showErrorMessage(
          "OpenRouter request failed due to a dependency error (424). Please try again.",
        );
      } else if (error instanceof BadRequestError) {
        vscode.window.showErrorMessage(
          "OpenRouter bad request (400): " +
            (error.message || "Review the request format."),
        );
      } else if (error instanceof RateLimitError) {
        vscode.window.showErrorMessage(
          "OpenRouter rate limit reached: " +
            (error.message || "Please try again later."),
        );
      } else {
        vscode.window.showErrorMessage(
          "OpenRouter API Error: " +
            (error.message || "Unknown error occurred."),
        );
      }
    } finally {
      // Reset debounce flag
      this._isGenerating = false;

      // Only reset generating state if we didn't succeed
      if (!succeeded) {
        await vscode.commands.executeCommand(
          "setContext",
          "diffDraft.isGenerating",
          false,
        );
        await vscode.commands.executeCommand(
          "setContext",
          "diffDraft.generatingIcon",
          -1,
        );
      }
    }
  }

  private async generateCommitMessage(rawApiKey: string) {
    const overrideRaw = process.env.OVERRIDE_API_KEYS?.trim();
    const overrideKeys = overrideRaw
      ? overrideRaw
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : [];

    // Parse comma-separated keys from the webview input
    const inputKeys = rawApiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const finalKeys: string[] =
      overrideKeys.length > 0 ? overrideKeys : inputKeys;

    if (finalKeys.length === 0) {
      this._view?.webview.postMessage({
        type: "error",
        value: "Please enter an OpenRouter API Key.",
      });
      return;
    }

    const repo = await this.getRepo();
    if (!repo) {
      return;
    }

    // 1. Check for staged changes first
    let changes = repo.state.indexChanges;
    let isStaged = true;

    // 2. If no staged changes, use working tree changes
    if (changes.length === 0) {
      changes = repo.state.workingTreeChanges;
      isStaged = false;
    }

    if (changes.length === 0) {
      this._view?.webview.postMessage({
        type: "error",
        value: "No changes detected (staged or working tree).",
      });
      return;
    }

    this._view?.webview.postMessage({ type: "loading" });

    // 3. Collect Diffs
    let fullDiff = "";
    try {
      for (const change of changes) {
        const diff = isStaged
          ? await repo.diffIndexWithHEAD(change.uri.fsPath)
          : await repo.diffWithHEAD(change.uri.fsPath);

        fullDiff += `\n--- File: ${change.uri.fsPath} ---\n${diff}`;
      }
    } catch (e) {
      this._view?.webview.postMessage({
        type: "error",
        value: "Error reading git diffs.",
      });
      return;
    }

    // 4. Check if diff is empty (e.g., binary files only)
    if (!fullDiff.trim()) {
      this._view?.webview.postMessage({
        type: "error",
        value: "No text diff available. Changes may be binary files only.",
      });
      return;
    }

    // 5. Call OpenRouter API with model pooling
    try {
      const result = await this.callOpenRouter(finalKeys, fullDiff);
      this._view?.webview.postMessage({ type: "result", value: result });
    } catch (error: any) {
      let userMessage: string;
      if (error instanceof ApiKeyError) {
        userMessage = "Invalid API key. Please check your OpenRouter API key.";
      } else if (error instanceof ServerError) {
        userMessage = "OpenRouter server error — please try again later.";
      } else if (error instanceof NotFoundError) {
        userMessage =
          "OpenRouter API: resource not found (404). The model may not exist.";
      } else if (error instanceof UnprocessableEntityError) {
        userMessage =
          "OpenRouter could not process the request (422). Try again or simplify your changes.";
      } else if (error instanceof FailedDependencyError) {
        userMessage =
          "OpenRouter request failed due to a dependency error (424). Please try again.";
      } else if (error instanceof BadRequestError) {
        userMessage =
          "OpenRouter bad request (400): " +
          (error.message || "Review the request format.");
      } else if (error instanceof RateLimitError) {
        userMessage =
          "OpenRouter rate limit reached: " +
          (error.message || "Please try again later.");
      } else {
        userMessage =
          "OpenRouter API Error: " +
          (error.message || "Unknown error occurred.");
      }
      this._view?.webview.postMessage({
        type: "error",
        value: userMessage,
      });
    }
  }

  /**
   * Calls OpenRouter API with model pooling and automatic key fallback.
   * Model pool order: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free']
   */
  private async callOpenRouter(
    apiKeys: string[],
    diff: string,
  ): Promise<string> {
    const url = "https://openrouter.ai/api/v1/chat/completions";

    const prompt = `
      You are a senior software architect. Analyze the FOLLOWING code changes deeply and generate a professional Git commit message.

      GOAL: Provide a readable, insightful, and sufficiently descriptive commit message. 

      INSTRUCTIONS:
      - Use "Conventional Commits" (<type>(<scope>): <subject>).
      - Types: feat, fix, refactor, chore, docs, style, test, ci, build.
      - Scope: The scope of the change (e.g., "lang", "navbar", "profile", "auth").
      - Subject: Summarize the change clearly. Do not over-summarize; provide enough context to understand WHAT changed and WHY.
      - Body (Optional): If the changes are significant, add a short body (1-2 sentences) after a blank line. Use bullet points for lists.
      - Output: Return ONLY raw text. No markdown, no backticks, no meta-explanation.

      CHANGES TO ANALYZE:
      ${diff}
    `;

    let lastError: Error = new Error("No API keys provided.");

    for (let m = 0; m < MODEL_POOL.length; m++) {
      const model = MODEL_POOL[m];
      const isLastModel = m === MODEL_POOL.length - 1;

      for (let k = 0; k < apiKeys.length; k++) {
        const apiKey = apiKeys[k];
        const isLastKey = k === apiKeys.length - 1;

        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://github.com/harysuryanto/diff-draft",
              "X-Title": "DiffDraft",
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.5,
            }),
          });
        } catch (networkError: any) {
          lastError = networkError;
          if (!isLastKey) {
            continue;
          } else if (!isLastModel) {
            break;
          } else {
            throw networkError;
          }
        }

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData: any = await response.json();
            if (errorData.error?.message) {
              errorMessage = errorData.error.message;
            }
          } catch {
            // Ignore JSON parsing error
          }

          // 401 / 403 — Auth failure, stop immediately
          if (response.status === 401 || response.status === 403) {
            throw new ApiKeyError(errorMessage);
          }

          // 413 or 400 with context tokens — context limit, fall back to next model
          if (
            response.status === 413 ||
            (response.status === 400 &&
              /context.length|too.many.tokens|maximum.context|token.limit/i.test(
                errorMessage,
              ))
          ) {
            lastError = new ContextTooLargeError(errorMessage);
            if (!isLastModel) {
              console.log(
                `[diff-draft] Model ${model} context exceeded, pooling to ${MODEL_POOL[m + 1]}…`,
              );
              vscode.window.setStatusBarMessage(
                `$(info) DiffDraft: ${model} context limit hit, switching model to ${MODEL_POOL[m + 1]}…`,
                5000,
              );
              break; // try next model
            }
          }

          // 429 — Rate limit, try next key if available, else next model
          if (response.status === 429) {
            lastError = new RateLimitError(errorMessage);
            if (!isLastKey) {
              console.log(
                `[diff-draft] Key #${k + 1} hit rate limit on ${model}, switching to key #${k + 2}…`,
              );
              vscode.window.setStatusBarMessage(
                `$(sync~spin) DiffDraft: rate limit on ${model}, switching to key #${k + 2}…`,
                5000,
              );
              continue;
            } else if (!isLastModel) {
              console.log(
                `[diff-draft] All keys rate limited on ${model}, pooling to ${MODEL_POOL[m + 1]}…`,
              );
              vscode.window.setStatusBarMessage(
                `$(sync~spin) DiffDraft: rate limit on ${model}, pooling to ${MODEL_POOL[m + 1]}…`,
                5000,
              );
              break; // try next model
            }
          }

          // 404 — Not found (model unavailable)
          if (response.status === 404) {
            lastError = new NotFoundError(errorMessage);
            if (!isLastModel) {
              console.log(
                `[diff-draft] Model ${model} not found/unavailable, pooling to ${MODEL_POOL[m + 1]}…`,
              );
              vscode.window.setStatusBarMessage(
                `$(info) DiffDraft: ${model} unavailable (404), switching to ${MODEL_POOL[m + 1]}…`,
                5000,
              );
              break; // try next model
            }
          }

          // 500 / 502 / 503 / 504 — Server-side errors
          if (response.status >= 500) {
            lastError = new ServerError(errorMessage);
            if (!isLastKey) {
              continue;
            } else if (!isLastModel) {
              console.log(
                `[diff-draft] Server error on ${model}, pooling to ${MODEL_POOL[m + 1]}…`,
              );
              vscode.window.setStatusBarMessage(
                `$(warning) DiffDraft: server error on ${model}, pooling to ${MODEL_POOL[m + 1]}…`,
                5000,
              );
              break; // try next model
            }
          }

          if (response.status === 400) {
            lastError = new BadRequestError(errorMessage);
          } else if (response.status === 422) {
            lastError = new UnprocessableEntityError(errorMessage);
          } else if (response.status === 424) {
            lastError = new FailedDependencyError(errorMessage);
          } else {
            lastError = new Error(errorMessage);
          }

          if (!isLastKey) {
            continue;
          } else if (!isLastModel) {
            break;
          } else {
            throw lastError;
          }
        }

        const data: any = await response.json();

        if (data.error) {
          throw new Error(data.error.message || "API returned an error.");
        }

        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error("API returned empty response.");
        }

        return content;
      }
    }

    throw lastError;
  }

  private async commitChanges(message: string) {
    if (!message || !message.trim()) {
      vscode.window.showErrorMessage("Commit message cannot be empty.");
      return;
    }

    const repo = await this.getRepo();
    if (!repo) {
      return;
    }

    if (!repo.state.indexChanges || repo.state.indexChanges.length === 0) {
      vscode.window.showErrorMessage(
        "No staged changes to commit. Please stage your changes first.",
      );
      return;
    }

    try {
      await repo.commit(message.trim());
      vscode.window.showInformationMessage("Commit successful!");
      this._view?.webview.postMessage({ type: "success" });
    } catch (e: any) {
      vscode.window.showErrorMessage(
        "Commit failed: " + (e.message || "Unknown error occurred."),
      );
    }
  }

  // --- UI HTML ---
  private _getHtmlForWebview(webview: vscode.Webview, hasOverrideKey: boolean) {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
            padding: 10px;
            font-size: var(--vscode-font-size);
          }
          .container {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .input-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            opacity: 0.8;
            color: var(--vscode-sideBarTitle-foreground);
          }
          input, textarea {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 8px;
            border-radius: 2px;
            width: 100%;
            box-sizing: border-box;
            font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
            font-size: var(--vscode-font-size);
          }
          input:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
          }
          textarea {
            resize: none;
            min-height: 100px;
            overflow: hidden;
            line-height: 1.4;
          }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            cursor: pointer;
            width: 100%;
            border-radius: 2px;
            font-size: var(--vscode-font-size);
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          button:active {
            opacity: 0.8;
          }
          button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          #generateBtn {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #ffffff);
          }
          #generateBtn:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
          }
          .loader {
            text-align: center;
            display: none;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: -4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="input-group" id="apiKeyContainer">
            <label>OpenRouter API Key(s)</label>
            <input type="text" id="apiKey" placeholder="sk-or-v1-..., sk-or-v1-..." />
            <span style="font-size:10px;opacity:0.6;margin-top:2px;">Separate multiple keys with commas for rate-limit fallback</span>
          </div>

          <button id="generateBtn">✨ Generate Commit Message</button>
          
          <div class="loader" id="loader">Processing changes with OpenRouter AI...</div>

          <div class="input-group">
            <label>Commit Message</label>
            <textarea id="result" placeholder="AI-generated message will appear here..."></textarea>
          </div>

          <button id="commitBtn" disabled>Commit</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const generateBtn = document.getElementById('generateBtn');
          const commitBtn = document.getElementById('commitBtn');
          const apiKeyInput = document.getElementById('apiKey');
          const resultInput = document.getElementById('result');
          const loader = document.getElementById('loader');

          const apiKeyContainer = document.getElementById('apiKeyContainer');
          const isOverrideActive = ${hasOverrideKey ? "true" : "false"};

          if (isOverrideActive) {
            apiKeyContainer.style.display = 'none';
          }

          function autoResize() {
            resultInput.style.height = 'auto';
            resultInput.style.height = (resultInput.scrollHeight) + 'px';
          }

          function validateApiKey(raw) {
            const keys = raw.split(',').map(k => k.trim()).filter(Boolean);
            if (keys.length === 0) return "Please enter an API key first.";
            for (const k of keys) {
              if (!k.startsWith('sk-or-') && !k.startsWith('sk-')) return 'Invalid key format: "' + k.substring(0, 10) + '...". OpenRouter keys start with \'sk-or-\'';
              if (k.length < 15) return 'API key "' + k.substring(0, 10) + '..." appears too short.';
            }
            return null; // Valid
          }

          // Restore state if available
          const previousState = vscode.getState();
          if (previousState) {
              if (previousState.hasApiKey) {
                  apiKeyInput.placeholder = '••••••••••••••••';
              }
              if (previousState.result) {
                  resultInput.value = previousState.result;
                  commitBtn.disabled = resultInput.value.trim().length === 0;
                  setTimeout(autoResize, 0);
              }
          }

          apiKeyInput.addEventListener('input', () => {
             const state = vscode.getState() || {};
             vscode.setState({ ...state, hasApiKey: !!apiKeyInput.value.trim() });
          });

          resultInput.addEventListener('input', () => {
             const value = resultInput.value;
             commitBtn.disabled = value.trim().length === 0;
             const state = vscode.getState() || {};
             vscode.setState({ ...state, result: value });
             autoResize();
          });

          generateBtn.addEventListener('click', () => {
            const key = apiKeyInput.value;
            
            if (!isOverrideActive) {
              const validationError = validateApiKey(key);
              if (validationError) {
                resultInput.value = validationError;
                autoResize();
                return;
              }
            }
            
            generateBtn.disabled = true;
            loader.style.display = 'block';
            resultInput.value = '';
            autoResize();
            commitBtn.disabled = true;
            vscode.postMessage({ type: 'generate', apiKey: isOverrideActive ? '' : key.trim() });
          });

          commitBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'commit', message: resultInput.value });
          });

          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
              case 'result':
                generateBtn.disabled = false;
                loader.style.display = 'none';
                resultInput.value = message.value;
                commitBtn.disabled = false;
                const stateResult = vscode.getState() || {};
                vscode.setState({ ...stateResult, result: message.value });
                autoResize();
                break;
              case 'error':
                generateBtn.disabled = false;
                loader.style.display = 'none';
                resultInput.value = "Error: " + message.value;
                commitBtn.disabled = true;
                autoResize();
                break;
              case 'success':
                resultInput.value = '';
                commitBtn.disabled = true;
                const stateSuccess = vscode.getState() || {};
                vscode.setState({ ...stateSuccess, result: '' });
                autoResize();
                break;
              case 'loading':
                loader.style.display = 'block';
                break;
            }
          });
        </script>
      </body>
      </html>`;
  }
}
