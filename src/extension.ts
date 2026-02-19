import * as vscode from "vscode";
import { SidebarProvider } from "./sidebarProvider";
import * as path from "path";
import * as dotenv from "dotenv";

export function activate(context: vscode.ExtensionContext) {
  // Load .env file from the extension's root directory
  dotenv.config({ path: path.join(context.extensionPath, ".env") });

  // Log OVERRIDE_MODEL_API_KEYS on startup so it's visible in the Debug Console
  const overrideRaw = process.env.OVERRIDE_MODEL_API_KEYS?.trim();
  if (overrideRaw) {
    const overrideKeys = overrideRaw.split(",").map((k) => k.trim()).filter(Boolean);
    console.log(
      `[diff-draft] OVERRIDE_MODEL_API_KEYS active: ${overrideKeys.length} key(s) — ` +
      overrideKeys.map((k) => k.substring(0, 8) + "...").join(", ")
    );
  }

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context.secrets
  );

  // SIDEBAR DEACTIVATED - Keeping code for future reference
  // To re-enable, uncomment this block and add viewsContainers/views to package.json
  // context.subscriptions.push(
  //   vscode.window.registerWebviewViewProvider(
  //     "geminiCommit.view",
  //     sidebarProvider
  //   )
  // );

  // Register the SCM title bar command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "diffDraft.generateCommitMessage",
      async () => {
        await sidebarProvider.generateCommitMessageForSCM();
      }
    )
  );

  // Register the Change API Key command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "diffDraft.changeApiKey",
      async () => {
        await sidebarProvider.changeApiKey();
      }
    )
  );
}

export function deactivate() {}
