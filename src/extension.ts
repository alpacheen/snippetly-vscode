import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";

interface SnippetlyConfig {
  apiUrl: string;
  apiKey?: string;
}

interface Snippet {
  id?: string;
  title: string;
  description: string;
  code: string;
  language: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
}

function makeRequest(
  options: https.RequestOptions,
  data?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const protocol = options.protocol === "https:" ? https : http;

    const req = protocol.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = responseData ? JSON.parse(responseData) : null;
            resolve(json);
          } catch (e) {
            resolve(responseData);
          }
        } else {
          reject(
            new Error(
              `Request failed with status ${res.statusCode}: ${responseData}`
            )
          );
        }
      });
    });

    req.on("error", reject);

    if (data) {
      req.write(data);
    }

    req.end();
  });
}

class SnippetlyAPI {
  private apiUrl: string;
  private apiKey?: string;
  private parsedUrl: URL;

  constructor(config: SnippetlyConfig) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.parsedUrl = new URL(config.apiUrl);
  }

  private getRequestOptions(
    path: string,
    method: string = "GET"
  ): https.RequestOptions {
    return {
      hostname: this.parsedUrl.hostname,
      port: this.parsedUrl.port,
      protocol: this.parsedUrl.protocol,
      path: path,
      method: method,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
    };
  }

  async saveSnippet(snippet: Snippet): Promise<Snippet> {
    try {
      const options = this.getRequestOptions("/snippets", "POST");
      const data = JSON.stringify(snippet);
      options.headers!["Content-Length"] = Buffer.byteLength(data);

      return await makeRequest(options, data);
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }

  async searchSnippets(query?: string): Promise<Snippet[]> {
    try {
      const path = query
        ? `/snippets/search?q=${encodeURIComponent(query)}`
        : "/snippets";

      const options = this.getRequestOptions(path);
      return await makeRequest(options);
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }

  async deleteSnippet(id: string): Promise<void> {
    try {
      const options = this.getRequestOptions(`/snippets/${id}`, "DELETE");
      await makeRequest(options);
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }
}

// Storage Service for offline support
class StorageService {
  constructor(private context: vscode.ExtensionContext) {}

  async saveLocally(snippet: Snippet): Promise<void> {
    const snippets = await this.getLocalSnippets();
    snippets.push(snippet);
    await this.context.globalState.update("snippets", snippets);
  }

  async getLocalSnippets(): Promise<Snippet[]> {
    return this.context.globalState.get<Snippet[]>("snippets", []);
  }

  async syncWithAPI(api: SnippetlyAPI): Promise<void> {
    const localSnippets = await this.getLocalSnippets();
    const unsyncedSnippets = localSnippets.filter((s) => !s.id);

    for (const snippet of unsyncedSnippets) {
      try {
        const saved = await api.saveSnippet(snippet);
        // Update local snippet with ID from server
        const index = localSnippets.indexOf(snippet);
        localSnippets[index] = saved;
      } catch (error) {
        console.error("Failed to sync snippet:", snippet.title, error);
      }
    }

    await this.context.globalState.update("snippets", localSnippets);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Snippetly extension is now active!");

  // Get configuration
  const config = vscode.workspace.getConfiguration("snippetly");
  const apiUrl = config.get<string>("apiUrl", "http://localhost:3000/api");
  const apiKey = config.get<string>("apiKey");
  const useAPI = config.get<boolean>("useAPI", false);

  // Initialize services
  const api = new SnippetlyAPI({ apiUrl, apiKey });
  const storage = new StorageService(context);

  // Command 1: Save selected code as snippet
  let saveCommand = vscode.commands.registerCommand(
    "snippetly.saveSnippet",
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showErrorMessage("No code editor is open");
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showErrorMessage("Please select some code first");
        return;
      }

      // Ask for snippet title
      const title = await vscode.window.showInputBox({
        prompt: "What should we call this snippet?",
        placeHolder: "e.g., Binary Search Algorithm",
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "Title is required";
          }
          return null;
        },
      });

      if (!title) {
        return;
      }

      // Ask for description
      const description = await vscode.window.showInputBox({
        prompt: "Add a description (optional)",
        placeHolder: "What does this code do?",
      });

      // Ask for tags
      const tagsInput = await vscode.window.showInputBox({
        prompt: "Add tags separated by commas (optional)",
        placeHolder: "e.g., algorithm, search, optimization",
      });

      const tags = tagsInput
        ? tagsInput
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)
        : [];

      const snippet: Snippet = {
        title: title,
        description: description || "",
        code: selectedText,
        language: editor.document.languageId,
        tags: tags,
        createdAt: new Date().toISOString(),
      };

      try {
        if (useAPI) {
          // Try to save to API
          const savedSnippet = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Saving snippet to Snippetly...",
              cancellable: false,
            },
            async () => {
              return await api.saveSnippet(snippet);
            }
          );

          // Also save locally for offline access
          await storage.saveLocally(savedSnippet);
          vscode.window.showInformationMessage(
            `✅ Saved to Snippetly: ${title}`
          );
        } else {
          // Save only locally
          await storage.saveLocally(snippet);
          vscode.window.showInformationMessage(`✅ Saved locally: ${title}`);
        }
      } catch (error) {
        // If API fails, save locally
        await storage.saveLocally(snippet);
        vscode.window.showWarningMessage(
          `Saved locally (API unavailable): ${title}`
        );
      }
    }
  );

  // Command 2: Search snippets
  let searchCommand = vscode.commands.registerCommand(
    "snippetly.searchSnippets",
    async () => {
      try {
        let snippets: Snippet[] = [];

        if (useAPI) {
          // Search via API
          const searchQuery = await vscode.window.showInputBox({
            prompt: "Search snippets (leave empty to show all)",
            placeHolder: "e.g., binary search, react hook, python",
          });

          snippets = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Searching Snippetly...",
              cancellable: false,
            },
            async () => {
              return await api.searchSnippets(searchQuery);
            }
          );
        } else {
          // Use local snippets
          snippets = await storage.getLocalSnippets();
        }

        if (snippets.length === 0) {
          vscode.window.showInformationMessage(
            "No snippets found. Select code and press Cmd+Shift+S to save."
          );
          return;
        }

        // Create QuickPick items with better formatting
        const items = snippets.map((s) => ({
          label: `$(code) ${s.title}`,
          description:
            s.language + (s.tags?.length ? ` • ${s.tags.join(", ")}` : ""),
          detail: s.description || "No description",
          snippet: s,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Choose a snippet to insert",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (!selected) {
          return;
        }

        // Insert the snippet at cursor position
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          editor.edit((editBuilder) => {
            editBuilder.insert(editor.selection.active, selected.snippet.code);
          });

          vscode.window.showInformationMessage(
            `Inserted: ${selected.snippet.title}`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to search snippets: ${error}`);
      }
    }
  );

  // Command 3: Sync local snippets with API
  let syncCommand = vscode.commands.registerCommand(
    "snippetly.syncSnippets",
    async () => {
      if (!useAPI) {
        vscode.window.showWarningMessage(
          "API sync is disabled. Enable it in settings."
        );
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Syncing snippets with Snippetly...",
            cancellable: false,
          },
          async () => {
            await storage.syncWithAPI(api);
          }
        );

        vscode.window.showInformationMessage(
          "✅ Snippets synced successfully!"
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Sync failed: ${error}`);
      }
    }
  );

  // Command 4: Delete snippet
  let deleteCommand = vscode.commands.registerCommand(
    "snippetly.deleteSnippet",
    async () => {
      const snippets = await storage.getLocalSnippets();

      if (snippets.length === 0) {
        vscode.window.showInformationMessage("No snippets to delete");
        return;
      }

      const items = snippets.map((s) => ({
        label: `$(trash) ${s.title}`,
        description: s.language,
        detail: s.description,
        snippet: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Choose a snippet to delete",
      });

      if (!selected) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete "${selected.snippet.title}"?`,
        "Delete",
        "Cancel"
      );

      if (confirm === "Delete") {
        // Remove from local storage
        const index = snippets.indexOf(selected.snippet);
        snippets.splice(index, 1);
        await context.globalState.update("snippets", snippets);

        // If using API and snippet has ID, delete from server
        if (useAPI && selected.snippet.id) {
          try {
            await api.deleteSnippet(selected.snippet.id);
          } catch (error) {
            console.error("Failed to delete from API:", error);
          }
        }

        vscode.window.showInformationMessage(
          `Deleted: ${selected.snippet.title}`
        );
      }
    }
  );

  context.subscriptions.push(saveCommand);
  context.subscriptions.push(searchCommand);
  context.subscriptions.push(syncCommand);
  context.subscriptions.push(deleteCommand);

  // Show welcome message with current mode
  const mode = useAPI ? "Connected to API" : "Local mode";
  vscode.window.showInformationMessage(
    `Snippetly is ready! (${mode}) Select code and press Cmd+Shift+S to save.`
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = `$(database) Snippetly: ${mode}`;
  statusBarItem.tooltip = "Click to open Snippetly settings";
  statusBarItem.command = "workbench.action.openSettings";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate() {
  console.log("Snippetly extension deactivated");
}
