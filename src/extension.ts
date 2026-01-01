import * as vscode from "vscode";
import { SidebarProvider } from "./sidebarProvider";
import * as path from "path";
import * as dotenv from "dotenv";

export function activate(context: vscode.ExtensionContext) {
  // Load .env file from the extension's root directory
  dotenv.config({ path: path.join(context.extensionPath, ".env") });

  const sidebarProvider = new SidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "geminiCommit.view",
      sidebarProvider
    )
  );
}

export function deactivate() {}
