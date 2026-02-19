import * as vscode from "vscode";
import { GitExtension, Repository } from "./git";

const API_KEY_SECRET_KEY = "diffDraft.groqApiKey";

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

// Custom error class for Groq flex-tier capacity exceeded (498)
class FlexTierCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlexTierCapacityError";
  }
}

// Custom error class for server-side errors (500, 502, 503)
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
    private readonly _secrets: vscode.SecretStorage
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Check if override key is set at runtime
    const hasOverrideKey = !!process.env.OVERRIDE_MODEL_API_KEYS?.trim();
    webviewView.webview.html = this._getHtmlForWebview(
      webviewView.webview,
      hasOverrideKey
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
        "No Git repository found. Please open a folder with a Git repository."
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

    const overrideRaw = process.env.OVERRIDE_MODEL_API_KEYS?.trim();
    const overrideKeys = overrideRaw
      ? overrideRaw.split(",").map((k) => k.trim()).filter(Boolean)
      : [];
    const storedKeys = await this.getStoredApiKeys();
    const apiKeys: string[] = overrideKeys.length > 0 ? overrideKeys : storedKeys;

    if (apiKeys.length === 0) {
      const inputRaw = await vscode.window.showInputBox({
        prompt: "Enter your Groq API Key(s) — separate multiple keys with commas",
        password: false,
        placeHolder: "gsk_key1, gsk_key2, ...",
        ignoreFocusOut: true,
        validateInput: (value) => {
          const keys = value.split(",").map((k) => k.trim()).filter(Boolean);
          if (keys.length === 0) {
            return "API key cannot be empty.";
          }
          for (const k of keys) {
            if (!k.startsWith("gsk_")) {
              return `Invalid key format: "${k.substring(0, 10)}...". Groq keys start with 'gsk_'.`;
            }
            if (k.length < 20) {
              return `API key "${k.substring(0, 10)}..." appears too short.`;
            }
          }
          return null; // Valid
        },
      });

      if (!inputRaw?.trim()) {
        vscode.window.showWarningMessage(
          "API key is required to generate commit message."
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
    const placeholder = existingKeys.length > 0
      ? `${existingKeys.length} key(s) currently stored — enter new key(s) to replace`
      : "gsk_key1, gsk_key2, ...";

    const inputRaw = await vscode.window.showInputBox({
      prompt: "Enter your Groq API Key(s) — separate multiple keys with commas",
      password: false,
      placeHolder: placeholder,
      ignoreFocusOut: true,
      validateInput: (value) => {
        const keys = value.split(",").map((k) => k.trim()).filter(Boolean);
        if (keys.length === 0) {
          return "API key cannot be empty.";
        }
        for (const k of keys) {
          if (!k.startsWith("gsk_")) {
            return `Invalid key format: "${k.substring(0, 10)}...". Groq keys start with 'gsk_'.`;
          }
          if (k.length < 20) {
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
    const count = inputRaw.split(",").map((k) => k.trim()).filter(Boolean).length;
    vscode.window.setStatusBarMessage(
      `$(key) DiffDraft: ${count} API key(s) saved successfully`,
      5000
    );
  }

  /**
   * Returns all stored API keys as an array (comma-separated storage).
   */
  private async getStoredApiKeys(): Promise<string[]> {
    try {
      const raw = await this._secrets.get(API_KEY_SECRET_KEY);
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
        await this._secrets.store(API_KEY_SECRET_KEY, trimmedKey);
      }
    } catch (error) {
      console.error("Failed to store API key:", error);
    }
  }

  private async clearStoredApiKey(): Promise<void> {
    try {
      await this._secrets.delete(API_KEY_SECRET_KEY);
    } catch (error) {
      console.error("Failed to clear API key:", error);
    }
  }

  private async generateCommitMessageWithKeys(apiKeys: string[]): Promise<void> {
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
        "No changes detected (staged or working tree)."
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
      true
    );
    await vscode.commands.executeCommand(
      "setContext",
      "diffDraft.generatingIcon",
      currentIconIndex
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
          "No text diff available. Changes may be binary files only."
        );
        return;
      }

      // Call Groq API (with automatic key fallback on rate-limit)
      let result: string;
      try {
        result = await this.callGroq(validKeys, fullDiff);
      } catch (retryError: any) {
        if (retryError instanceof ContextTooLargeError) {
          // Auto-switch to larger context model
          vscode.window.setStatusBarMessage(
            "$(info) DiffDraft: diff too large for default model, switching to Kimi K2…",
            5000
          );
          result = await this.callGroq(
            validKeys,
            fullDiff,
            "moonshotai/kimi-k2-instruct-0905"
          );
        } else {
          throw retryError;
        }
      }

      // Insert the result into the SCM input box
      repo.inputBox.value = result;
      succeeded = true;

      // Show success state (check icon) for 2 seconds
      await vscode.commands.executeCommand(
        "setContext",
        "diffDraft.isGenerating",
        false
      );
      await vscode.commands.executeCommand(
        "setContext",
        "diffDraft.generatingIcon",
        -1
      );
      await vscode.commands.executeCommand(
        "setContext",
        "diffDraft.isSuccess",
        true
      );

      // After 2 seconds, hide success icon and show sparkle again
      setTimeout(async () => {
        await vscode.commands.executeCommand(
          "setContext",
          "diffDraft.isSuccess",
          false
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
          "Enter New Key"
        );

        if (retry === "Enter New Key") {
          // Recursively call the parent method to prompt for a new key
          return this.generateCommitMessageForSCM();
        }
      } else if (error instanceof ServerError) {
        vscode.window.showErrorMessage(
          "Groq server error — this is on Groq's side, please try again later."
        );
      } else if (error instanceof FlexTierCapacityError) {
        vscode.window.showErrorMessage(
          "Groq flex tier is at capacity. Please try again later."
        );
      } else if (error instanceof NotFoundError) {
        vscode.window.showErrorMessage(
          "Groq API: resource not found (404). The model may not exist or the endpoint URL is wrong."
        );
      } else if (error instanceof UnprocessableEntityError) {
        vscode.window.showErrorMessage(
          "Groq could not process the request (422). Try again or simplify your changes."
        );
      } else if (error instanceof FailedDependencyError) {
        vscode.window.showErrorMessage(
          "Groq request failed due to a dependency error (424). Please try again."
        );
      } else if (error instanceof BadRequestError) {
        vscode.window.showErrorMessage(
          "Groq bad request (400): " + (error.message || "Review the request format.")
        );
      } else {
        vscode.window.showErrorMessage(
          "Groq API Error: " + (error.message || "Unknown error occurred.")
        );
      }
    } finally {
      // Reset debounce flag
      this._isGenerating = false;

      // Only reset generating state if we didn't succeed
      // (on success, we show the success icon instead)
      if (!succeeded) {
        await vscode.commands.executeCommand(
          "setContext",
          "diffDraft.isGenerating",
          false
        );
        await vscode.commands.executeCommand(
          "setContext",
          "diffDraft.generatingIcon",
          -1
        );
      }
    }
  }

  private async generateCommitMessage(rawApiKey: string) {
    const overrideRaw = process.env.OVERRIDE_MODEL_API_KEYS?.trim();
    const overrideKeys = overrideRaw
      ? overrideRaw.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

    // Parse comma-separated keys from the webview input
    const inputKeys = rawApiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const finalKeys: string[] = overrideKeys.length > 0 ? overrideKeys : inputKeys;

    if (finalKeys.length === 0) {
      this._view?.webview.postMessage({
        type: "error",
        value: "Please enter a Groq API Key.",
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
        // Use diffIndexWithHEAD for staged, diffWithHEAD for working tree
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

    // 5. Call Groq API (with automatic key fallback on rate-limit)
    try {
      let result: string;
      try {
        result = await this.callGroq(finalKeys, fullDiff);
      } catch (retryError: any) {
        if (retryError instanceof ContextTooLargeError) {
          // Auto-switch to larger context model
          vscode.window.setStatusBarMessage(
            "$(info) DiffDraft: diff too large for default model, switching to Kimi K2…",
            5000
          );
          result = await this.callGroq(
            finalKeys,
            fullDiff,
            "moonshotai/kimi-k2-instruct-0905"
          );
        } else {
          throw retryError;
        }
      }
      this._view?.webview.postMessage({ type: "result", value: result });
    } catch (error: any) {
      let userMessage: string;
      if (error instanceof ApiKeyError) {
        userMessage = "Invalid API key. Please check your Groq API key.";
      } else if (error instanceof ServerError) {
        userMessage = "Groq server error — this is on Groq's side, please try again later.";
      } else if (error instanceof FlexTierCapacityError) {
        userMessage = "Groq flex tier is at capacity. Please try again later.";
      } else if (error instanceof NotFoundError) {
        userMessage = "Groq API: resource not found (404). The model may not exist.";
      } else if (error instanceof UnprocessableEntityError) {
        userMessage = "Groq could not process the request (422). Try again or simplify your changes.";
      } else if (error instanceof FailedDependencyError) {
        userMessage = "Groq request failed due to a dependency error (424). Please try again.";
      } else if (error instanceof BadRequestError) {
        userMessage = "Groq bad request (400): " + (error.message || "Review the request format.");
      } else {
        userMessage = "Groq API Error: " + (error.message || "Unknown error occurred.");
      }
      this._view?.webview.postMessage({
        type: "error",
        value: userMessage,
      });
    }
  }

  /**
   * Calls the Groq API, automatically falling back to the next key in the
   * array when a 429 (rate-limit) response is received.
   *
   * @throws {ApiKeyError}              on 401 Unauthorized / 403 Forbidden
   * @throws {ContextTooLargeError}     on 413 Request Entity Too Large, or 400 with context-length keywords
   * @throws {BadRequestError}          on 400 Bad Request (non-context-length)
   * @throws {NotFoundError}            on 404 Not Found
   * @throws {UnprocessableEntityError} on 422 Unprocessable Entity
   * @throws {FailedDependencyError}    on 424 Failed Dependency
   * @throws {RateLimitError}           on 429 Too Many Requests (after all keys exhausted)
   * @throws {FlexTierCapacityError}    on 498 Flex Tier Capacity Exceeded
   * @throws {ServerError}              on 500 / 502 / 503 server-side errors
   * @throws {Error}                    on network failures or unexpected status codes
   */
  private async callGroq(
    apiKeys: string[],
    diff: string,
    model: string = "openai/gpt-oss-120b"
  ): Promise<string> {
    const url = "https://api.groq.com/openai/v1/chat/completions";

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

    for (let i = 0; i < apiKeys.length; i++) {
      const apiKey = apiKeys[i];
      const isLastKey = i === apiKeys.length - 1;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.5,
          }),
        });
      } catch (networkError: any) {
        // Network / fetch-level error — not worth retrying with another key
        throw networkError;
      }

      // Check HTTP response status
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData: any = await response.json();
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // Ignore JSON parsing error, use HTTP status message
        }

        // --- Map each Groq status code to its error class ---

        // 401 / 403 — Auth failure, stop immediately
        if (response.status === 401 || response.status === 403) {
          throw new ApiKeyError(errorMessage);
        }

        // 413 — Request entity too large, stop immediately
        if (response.status === 413) {
          throw new ContextTooLargeError(errorMessage);
        }

        // 400 — Bad request: check if it's actually a context-length issue
        if (response.status === 400) {
          if (
            /context.length|too.many.tokens|maximum.context|token.limit/i.test(
              errorMessage
            )
          ) {
            throw new ContextTooLargeError(errorMessage);
          }
          throw new BadRequestError(errorMessage);
        }

        // 404 — Not found (wrong URL or non-existent model)
        if (response.status === 404) {
          throw new NotFoundError(errorMessage);
        }

        // 422 — Unprocessable entity (semantic errors or model hallucination)
        if (response.status === 422) {
          throw new UnprocessableEntityError(errorMessage);
        }

        // 424 — Failed dependency
        if (response.status === 424) {
          throw new FailedDependencyError(errorMessage);
        }

        // 429 — Rate limit, try next key if available
        if (response.status === 429) {
          lastError = new RateLimitError(errorMessage);
          if (!isLastKey) {
            console.log(
              `[diff-draft] Key #${i + 1} hit rate limit, switching to key #${i + 2}…`
            );
            vscode.window.setStatusBarMessage(
              `$(sync~spin) DiffDraft: rate limit hit, switching to key #${i + 2}…`,
              5000
            );
            continue;
          }
          // All keys exhausted
          throw new RateLimitError(
            `All ${apiKeys.length} API key(s) hit the rate limit. Please wait and try again.`
          );
        }

        // 498 — Groq custom: flex tier capacity exceeded
        if (response.status === 498) {
          throw new FlexTierCapacityError(errorMessage);
        }

        // 500 / 502 / 503 — Server-side errors
        if (
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503
        ) {
          throw new ServerError(errorMessage);
        }

        // Any other unexpected status code
        throw new Error(errorMessage);
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

    throw lastError;
  }

  private async commitChanges(message: string) {
    // Validate commit message
    if (!message || !message.trim()) {
      vscode.window.showErrorMessage("Commit message cannot be empty.");
      return;
    }

    const repo = await this.getRepo();
    if (!repo) {
      return;
    }

    // Check if there are staged changes
    if (!repo.state.indexChanges || repo.state.indexChanges.length === 0) {
      vscode.window.showErrorMessage(
        "No staged changes to commit. Please stage your changes first."
      );
      return;
    }

    try {
      await repo.commit(message.trim());
      vscode.window.showInformationMessage("Commit successful!");
      this._view?.webview.postMessage({ type: "success" });
    } catch (e: any) {
      vscode.window.showErrorMessage(
        "Commit failed: " + (e.message || "Unknown error occurred.")
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
            <label>Groq API Key(s)</label>
            <input type="text" id="apiKey" placeholder="gsk_key1, gsk_key2, ..." />
            <span style="font-size:10px;opacity:0.6;margin-top:2px;">Separate multiple keys with commas for rate-limit fallback</span>
          </div>

          <button id="generateBtn">✨ Generate Commit Message</button>
          
          <div class="loader" id="loader">Processing changes with AI...</div>

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
              if (!k.startsWith('gsk_')) return 'Invalid key format: "' + k.substring(0, 10) + '...". Groq keys start with \'gsk_\'';
              if (k.length < 20) return 'API key "' + k.substring(0, 10) + '..." appears too short.';
            }
            return null; // Valid
          }

          // Restore state if available (only result, not API key for security)
          const previousState = vscode.getState();
          if (previousState) {
              // Note: API key is stored in SecretStorage, not webview state
              if (previousState.hasApiKey) {
                  // Show placeholder to indicate a key exists
                  apiKeyInput.placeholder = '••••••••••••••••';
              }
              if (previousState.result) {
                  resultInput.value = previousState.result;
                  commitBtn.disabled = resultInput.value.trim().length === 0;
                  setTimeout(autoResize, 0);
              }
          }

          // Track that user has entered a key (for UX, not the key itself)
          apiKeyInput.addEventListener('input', () => {
             const state = vscode.getState() || {};
             vscode.setState({ ...state, hasApiKey: !!apiKeyInput.value.trim() });
          });

          // Enable commit button only if text exists
          resultInput.addEventListener('input', () => {
             const value = resultInput.value;
             commitBtn.disabled = value.trim().length === 0;
             const state = vscode.getState() || {};
             vscode.setState({ ...state, result: value });
             autoResize();
          });

          generateBtn.addEventListener('click', () => {
            const key = apiKeyInput.value;
            
            // Skip validation if override is active
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
                // Always disable commit button on error - error messages should not be committed
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
