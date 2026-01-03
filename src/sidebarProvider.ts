import * as vscode from "vscode";
import { GitExtension, Repository } from "./git";

const API_KEY_SECRET_KEY = "diffDraft.groqApiKey";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  private _iconIndex = 0; // Counter for sequential icon rotation

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

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

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
    const overrideKey = process.env.OVERRIDE_MODEL_API_KEY;
    const storedKey = await this.getStoredApiKey();
    const apiKey = overrideKey?.trim() ? overrideKey : storedKey;

    if (!apiKey) {
      const inputKey = await vscode.window.showInputBox({
        prompt: "Enter your Groq API Key",
        password: true,
        placeHolder: "gsk_...",
        ignoreFocusOut: true,
      });

      if (!inputKey) {
        vscode.window.showWarningMessage(
          "API key is required to generate commit message."
        );
        return;
      }

      // Store the API key for future use
      await this.storeApiKey(inputKey);
      return this.generateCommitMessageWithKey(inputKey);
    }

    return this.generateCommitMessageWithKey(apiKey);
  }

  private async getStoredApiKey(): Promise<string | undefined> {
    try {
      const key = await this._secrets.get(API_KEY_SECRET_KEY);
      return key?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

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

  private async generateCommitMessageWithKey(apiKey: string): Promise<void> {
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

    // Sequential icon selection (0-4): watch → flame → loading → wand → symbol-color
    const iconCount = 5;
    const currentIconIndex = this._iconIndex;
    this._iconIndex = (this._iconIndex + 1) % iconCount; // Rotate for next time

    // Set generating state with random icon - hides sparkle, shows random icon (disabled)
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

      // Call Groq API
      try {
        const result = await this.callGroq(apiKey, fullDiff);
        // Insert the result into the SCM input box
        repo.inputBox.value = result;

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

        return; // Skip finally block's reset since we handled it here
      } catch (error: any) {
        vscode.window.showErrorMessage(
          "Groq API Error: " + (error.message || "Unknown error occurred.")
        );
      }
    } finally {
      // Reset generating state - hides all generating icons, shows sparkle again
      // (only runs on error or early return, not on success)
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

  private async generateCommitMessage(apiKey: string) {
    const overrideKey = process.env.OVERRIDE_MODEL_API_KEY;
    const finalApiKey = overrideKey?.trim() ? overrideKey : apiKey;

    if (!finalApiKey) {
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

    // 5. Call Groq API
    try {
      const result = await this.callGroq(finalApiKey, fullDiff);
      this._view?.webview.postMessage({ type: "result", value: result });
    } catch (error: any) {
      this._view?.webview.postMessage({
        type: "error",
        value:
          "Groq API Error: " + (error.message || "Unknown error occurred."),
      });
    }
  }

  private async callGroq(apiKey: string, diff: string): Promise<string> {
    const model = "openai/gpt-oss-120b";
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

    const response = await fetch(url, {
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

    // Check HTTP response status first
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
  private _getHtmlForWebview(webview: vscode.Webview) {
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
            <label>Groq API Key</label>
            <input type="password" id="apiKey" placeholder="Enter your API key..." />
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
          const isOverrideActive = ${
            process.env.OVERRIDE_MODEL_API_KEY?.trim() ? "true" : "false"
          };

          if (isOverrideActive) {
            apiKeyContainer.style.display = 'none';
            // Set a placeholder value so validation passes
            apiKeyInput.value = '__OVERRIDE__';
          }

          function autoResize() {
            resultInput.style.height = 'auto';
            resultInput.style.height = (resultInput.scrollHeight) + 'px';
          }

          // Restore state if available
          const previousState = vscode.getState();
          if (previousState) {
              if (previousState.apiKey) {
                  apiKeyInput.value = previousState.apiKey;
              }
              if (previousState.result) {
                  resultInput.value = previousState.result;
                  commitBtn.disabled = resultInput.value.trim().length === 0;
                  setTimeout(autoResize, 0);
              }
          }

          apiKeyInput.addEventListener('input', () => {
             const state = vscode.getState() || {};
             vscode.setState({ ...state, apiKey: apiKeyInput.value });
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
            if(!key && !isOverrideActive) {
                resultInput.value = "Please enter an API Key first.";
                autoResize();
                return;
            }
            generateBtn.disabled = true;
            loader.style.display = 'block';
            resultInput.value = '';
            autoResize();
            commitBtn.disabled = true;
            vscode.postMessage({ type: 'generate', apiKey: key });
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
