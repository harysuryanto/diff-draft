import * as vscode from "vscode";
import { GitExtension, Repository } from "./git";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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
      vscode.window.showErrorMessage("Git extension not loaded");
      return;
    }
    const git = gitExtension.exports.getAPI(1);
    return git.repositories[0]; // Simple approach: use first repo
  }

  private async generateCommitMessage(apiKey: string) {
    if (!apiKey) {
      this._view?.webview.postMessage({
        type: "error",
        value: "Please enter a Groq API Key.",
      });
      return;
    }

    const repo = await this.getRepo();
    if (!repo) return;

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

    // 4. Call Groq API
    try {
      const result = await this.callGroq(apiKey, fullDiff);
      this._view?.webview.postMessage({ type: "result", value: result });
    } catch (error: any) {
      this._view?.webview.postMessage({
        type: "error",
        value: "Groq API Error: " + error.message,
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
      - Use "Conventional Commits" (type: subject).
      - Types: feat, fix, refactor, chore, docs, style, test, ci, build.
      - Subject: Summarize the change clearly. Do not over-summarize; provide enough context to understand WHAT changed and WHY.
      - Body (Optional): If the changes are significant, add a short body (1-2 sentences) after a blank line.
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

    const data: any = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.choices?.[0]?.message?.content?.trim() || "Failed to generate.";
  }

  private async commitChanges(message: string) {
    const repo = await this.getRepo();
    if (repo) {
      try {
        await repo.commit(message);
        vscode.window.showInformationMessage("Commit successful!");
        this._view?.webview.postMessage({ type: "success" });
      } catch (e: any) {
        vscode.window.showErrorMessage("Commit failed: " + e.message);
      }
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
          }
          .container {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          label {
            font-size: 12px;
            font-weight: bold;
            opacity: 0.8;
          }
          input, textarea {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px;
            border-radius: 2px;
            width: 100%;
            box-sizing: border-box;
          }
          textarea {
            resize: vertical;
            min-height: 80px;
          }
          button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px;
            cursor: pointer;
            width: 100%;
            font-weight: bold;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .loader {
            text-align: center;
            display: none;
            font-size: 12px;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div>
            <label>Groq API Key</label>
            <input type="password" id="apiKey" placeholder="Paste key here..." />
          </div>

          <button id="generateBtn">✨ Generate Commit Message</button>
          
          <div class="loader" id="loader">Thinking...</div>

          <div>
            <label>Commit Message</label>
            <textarea id="result"></textarea>
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

          // Restore state if available
          const previousState = vscode.getState();
          if (previousState) {
              if (previousState.apiKey) {
                  apiKeyInput.value = previousState.apiKey;
              }
              if (previousState.result) {
                  resultInput.value = previousState.result;
                  commitBtn.disabled = resultInput.value.trim().length === 0;
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
          });

          generateBtn.addEventListener('click', () => {
            const key = apiKeyInput.value;
            if(!key) {
                resultInput.value = "Please enter an API Key first.";
                return;
            }
            loader.style.display = 'block';
            resultInput.value = '';
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
                loader.style.display = 'none';
                resultInput.value = message.value;
                commitBtn.disabled = false;
                const stateResult = vscode.getState() || {};
                vscode.setState({ ...stateResult, result: message.value });
                break;
              case 'error':
                loader.style.display = 'none';
                resultInput.value = "Error: " + message.value;
                commitBtn.disabled = resultInput.value.trim().length === 0;
                break;
              case 'success':
                resultInput.value = '';
                commitBtn.disabled = true;
                const stateSuccess = vscode.getState() || {};
                vscode.setState({ ...stateSuccess, result: '' });
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
