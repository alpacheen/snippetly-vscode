import * as vscode from "vscode";

// This runs when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log("Snippetly extension is now active!");

  // Command 1: Save selected code as snippet
  let saveCommand = vscode.commands.registerCommand(
    "snippetly.saveSnippet",
    async () => {
      // Get the active editor
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showErrorMessage("No code editor is open");
        return;
      }

      // Get selected text
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
      });

      if (!title) {
        return; // User cancelled
      }

      // Ask for description
      const description = await vscode.window.showInputBox({
        prompt: "Add a description (optional)",
        placeHolder: "What does this code do?",
      });

      // For now, we'll just save to a local file
      // Later, this will call your Snippetly API
      const snippet = {
        title: title,
        description: description || "",
        code: selectedText,
        language: editor.document.languageId,
        createdAt: new Date().toISOString(),
      };

      // Save to global state (temporary storage)
      const savedSnippets = context.globalState.get<any[]>("snippets", []);
      savedSnippets.push(snippet);
      await context.globalState.update("snippets", savedSnippets);

      // Show success message
      vscode.window.showInformationMessage(`✅ Saved: ${title}`);
    }
  );

  // Command 2: Search snippets
  let searchCommand = vscode.commands.registerCommand(
    "snippetly.searchSnippets",
    async () => {
      // Get saved snippets
      const savedSnippets = context.globalState.get<any[]>("snippets", []);

      if (savedSnippets.length === 0) {
        vscode.window.showInformationMessage(
          "No snippets saved yet. Select code and press Cmd+Shift+S to save."
        );
        return;
      }

      // Show list of snippets
      const items = savedSnippets.map((s) => ({
        label: s.title,
        description: s.language,
        detail: s.description,
        snippet: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Choose a snippet to insert",
      });

      if (!selected) {
        return; // User cancelled
      }

      // Insert the snippet at cursor position
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, selected.snippet.code);
        });

        vscode.window.showInformationMessage(`Inserted: ${selected.label}`);
      }
    }
  );

  // Register commands
  context.subscriptions.push(saveCommand);
  context.subscriptions.push(searchCommand);

  // Show welcome message
  vscode.window.showInformationMessage(
    "Snippetly is ready! Select code and press Cmd+Shift+S to save a snippet."
  );
}

// This runs when your extension is deactivated
export function deactivate() {}
