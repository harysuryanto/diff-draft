import * as vscode from "vscode";

export interface GitExtension {
  getAPI(version: number): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

export interface Repository {
  state: RepositoryState;
  commit(message: string): Promise<void>;
  diffWithHEAD(path: string): Promise<string>; // Working tree vs HEAD
  diffIndexWithHEAD(path: string): Promise<string>; // Staged vs HEAD
}

export interface RepositoryState {
  HEAD: Branch | undefined;
  indexChanges: Change[];
  workingTreeChanges: Change[];
}

export interface Branch {
  name?: string;
}

export interface Change {
  uri: vscode.Uri;
}
