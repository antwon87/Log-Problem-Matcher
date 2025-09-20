// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import { MultiStepInput, QuickPickParameters, InputFlowAction } from './MultiStepInput';
import { stringify } from 'querystring';
import { match } from 'assert';
import { FileHandle } from 'fs/promises';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

   let diagnosticCollection = vscode.languages.createDiagnosticCollection('lpm_diag');
   context.subscriptions.push(diagnosticCollection);

   interface HistoryInterface {
      parser: string;
      matchers: Map<string, string[]>;
      log?: vscode.Uri;
   }

   let history: HistoryInterface = {
      parser: '',
      matchers: new Map(),
      log: undefined
   };

   context.subscriptions.push(vscode.commands.registerCommand('log-problem-matcher.add_problem', () => {
      let diagnostics: vscode.Diagnostic[] = [];
      const diagnostic: vscode.Diagnostic = {
         severity: vscode.DiagnosticSeverity.Warning,
         range: new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, Number.MAX_VALUE)),
         message: "My test message.",
         source: "LPM"
      };
      diagnostics.push(diagnostic);
      diagnosticCollection.set(vscode.Uri.file('C:\\Users\\antwo\\Documents\\VSCode_Extensions\\log-problem-matcher\\src\\extension.ts'), diagnostics);
   }));

   context.subscriptions.push(vscode.commands.registerCommand('log-problem-matcher.clear_problems', () => {
      diagnosticCollection.clear();
   }));

   context.subscriptions.push(vscode.commands.registerCommand('log-problem-matcher.rescan', () => {
      doTheMatchin(false, false);
   }));

   context.subscriptions.push(vscode.commands.registerCommand('log-problem-matcher.rescan_new_matcher', () => {
      doTheMatchin(true, false);
   }));

   context.subscriptions.push(vscode.commands.registerCommand('log-problem-matcher.scan_file', async () => {
      doTheMatchin(true, true);
   }));

   context.subscriptions.push(vscode.commands.registerCommand('log-problem-matcher.scan_explorer_file', async (...theArgs) => {
      if (theArgs.length === 0) {
         vscode.window.showErrorMessage("LPM can't run the 'Scan for Problems' command in whatever way you initiated it. It must be run by right clicking a file in the Explorer.");
         return;
      }
      history.log = theArgs[0];
      doTheMatchin(true, false);
   }));

   async function doTheMatchin(chooseParser: boolean, chooseLog: boolean) {
      const settings = vscode.workspace.getConfiguration('log-problem-matcher');
      const parsers: Object = settings.get('parsers') as Object;
      const parser_items: vscode.QuickPickItem[] = Object.keys(parsers).map(label => ({ label }));

      if (parser_items.length === 0) {
         vscode.window.showErrorMessage("You must define at least one parser and problem matcher in settings.json before running LPM.");
         return;
      }

      diagnosticCollection.clear();

      interface PatternInterface {
         regexp: string;
         regexp_obj?: RegExp;
         severity?: number;
         code?: number;
         file?: number;
         location?: number;
         line?: number;
         endLine?: number;
         column?: number;
         endColumn?: number;
         message: number;
         error_string?: string | string[];
         warning_string?: string | string[];
         info_string?: string | string[];
         kind?: string;
      }

      interface ProblemMatcherInterface {
         title?: string;
         fileLocation?: string | string[];
         problemLocationZeroBased?: boolean;
         source?: string;
         defaultSelected?: boolean;
         severity?: string;
         pattern: PatternInterface;
      }

      interface State {
         title: string;
         step: number;
         totalSteps: number;
         parser: vscode.QuickPickItem;
         matchers: vscode.QuickPickItem[];
         file: vscode.Uri;
      }

      async function collectInputs() {
         const state = {} as Partial<State>;
         await MultiStepInput.run(input => pickParser(input, state));
         return state as State;
      }

      const title = "Select a parser";

      async function pickParser(input: MultiStepInput, state: Partial<State>) {
         // history.parser = parser_names[0];
         let params: QuickPickParameters<vscode.QuickPickItem> = {
            title,
            step: 1,
            totalSteps: 2,
            placeholder: 'Choose a parser',
            items: parser_items,
            activeItems: [],
            shouldResume: shouldResume
         };

         const last: vscode.QuickPickItem | undefined = parser_items.find(item => item.label === history.parser);

         if (last) {
            params.activeItems = [last];
         } else {
            params.activeItems = [parser_items[0]];
         }
         const pick = await input.showQuickPick(params);

         state.parser = pick[0];
         history.parser = pick[0].label;
         return (input: MultiStepInput) => pickMatchers(input, state);
      }

      async function pickMatchers(input: MultiStepInput, state: Partial<State>) {
         // const matchers: vscode.QuickPickItem[] = await getAvailableMatchers(state.parser!, undefined /* TODO: token */); // I have no idea what this TODO means, it came from the example. Maybe I'll learn later?
         const matcher_settings: ProblemMatcherInterface[] = settings.get('parsers.' + state.parser!.label) ?? [];
         const matcher_titles: string[] = matcher_settings.map((matcher: ProblemMatcherInterface, idx: number) => matcher.title ?? 'Matcher ' + idx);
         const matchers: vscode.QuickPickItem[] = matcher_titles.map(label => ({ label }));
         const selected_matchers: vscode.QuickPickItem[] = matchers.filter((m, i) => {
            // If the defaultSelected field is undefined or set to "false", don't include this matcher in the default selection.
            return matcher_settings[i].defaultSelected === undefined || matcher_settings[i].defaultSelected === true;
         });

         if (matchers.length === 0) {
            vscode.window.showErrorMessage(`You must define at least one problem matcher in the ${state.parser!.label} parser configuration in settings.json.`);
            throw InputFlowAction.cancel;
            // return;
         }

         let params: QuickPickParameters<vscode.QuickPickItem> = {
            title,
            step: 2,
            totalSteps: 2,
            placeholder: 'Choose matchers',
            canSelectMany: true,
            items: matchers,
            selectedItems: selected_matchers,
            shouldResume: shouldResume
         };

         if (history.matchers.has(state.parser!.label)) {
            const last_matcher_names: string[] = history.matchers.get(state.parser!.label) ?? [];
            params.selectedItems = matchers.filter(item => last_matcher_names.indexOf(item.label) !== -1);
         }

         // TODO from example: Remember currently active item when navigating back.
         state.matchers = await input.showQuickPick(params);
         history.matchers.set(state.parser!.label, state.matchers.map(item => item.label));
      }

      function shouldResume() {
         // Could show a notification with the option to resume.
         return new Promise<boolean>((_resolve, _reject) => {
            // noop
         });
      }

      // If running a "rescan" command, make sure we actually have the necessary history.
      // Otherwise just call collectInputs() as though it is a "scan" command.
      let state: Partial<State>;
      if (chooseParser === false && history.parser !== '' && history.matchers.get(history.parser) !== undefined) {
         const last_parser: vscode.QuickPickItem = { label: history.parser };
         const last_matchers: string[] = history.matchers.get(history.parser)!;
         const last_matchers_qp = last_matchers.map(label => ({ label }));
         state = {
            parser: last_parser,
            matchers: last_matchers_qp
         };
      } else {
         state = await collectInputs();
      }

      if (state.parser === undefined || state.matchers === undefined) {
         vscode.window.showErrorMessage("Something went wrong and no parser and/or matcher was selected.");
         return;
      }

      // User input collected for parser and matchers. Next choose a log file.
      let fileUri: vscode.Uri[] | undefined;
      if (chooseLog === false && history.log !== undefined) {
         fileUri = [history.log];
      } else {
         fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            title: "Choose a log file"
         });
      }

      // Get all matchers associated with the desired parser from settings
      const all_matchers: ProblemMatcherInterface[] = settings.get('parsers.' + state.parser.label)!;

      // Add a title to any matchers missing a title, so that it can be associated with one of the QuickPickItems
      all_matchers.forEach((matcher: ProblemMatcherInterface, idx: number) => {
         if (matcher.title === undefined) {
            matcher.title = 'Matcher ' + idx;
         }
      });

      // Filter out only the matchers that were selected by the user
      const selected_matchers: string[] = state.matchers.map(item => item.label);
      let matchers: ProblemMatcherInterface[] = all_matchers.filter(matcher => selected_matchers.indexOf(matcher.title!) !== -1);
      for (const matcher of matchers) {
         if (matcher.pattern.regexp === undefined) {
            vscode.window.showErrorMessage(`You must define a 'regexp' property under the 'pattern' property of all problem matchers.`);
            return;
         }
      };
      matchers.forEach(matcher => matcher.pattern.regexp_obj = RegExp(matcher.pattern.regexp));

      if (fileUri && fileUri[0]) {
         let diagnostic_map: Map<string, vscode.Diagnostic[]> = new Map();

         const file: FileHandle = await fs.promises.open(fileUri[0].fsPath);
         // const file = await fs.promises.open('C:\\Users\\antwo\\Documents\\VSCode_Extensions\\test_files\\log.log');

         for await (const line of file.readLines()) {

            // Loop through each selected matcher, checking it against this line
            matchers.forEach(matcher => {
               const matches: RegExpExecArray | null = matcher.pattern.regexp_obj!.exec(line);
               if (matches !== null) {

                  let severity: string = "hint";
                  let diag_severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Hint;
                  if (matcher.severity) {
                     // User-defined severity override
                     severity = matcher.severity.toLowerCase();
                  } else {
                     // Ensure the user has supplied a severity somewhere
                     if (matcher.pattern.severity === undefined) {
                        vscode.window.showErrorMessage("You must supply a severity in the problem matcher, either as a key of the problem matcher or as a key of the pattern.");
                        return;
                     }
                     // Get severity from the pattern match
                     let severity_indicators: Map<string, string | string[] | undefined> = new Map<string, string[]>();
                     let lowercase_errors: boolean = false;
                     let lowercase_warnings: boolean = false;
                     let lowercase_infos: boolean = false;

                     // Get custom severity indicators from settings
                     severity_indicators.set("error", matcher.pattern.error_string);
                     severity_indicators.set("warning", matcher.pattern.warning_string);
                     severity_indicators.set("info", matcher.pattern.info_string);

                     // If the severity indicator is a string, make it an array of strings
                     severity_indicators.forEach((value, key, map) => {
                        map.set(key, (typeof value === "string") ? [value] : value);
                     });

                     // Check if there is a custom severity indicator. If there
                     // is not, use a default and flag that we should lowercase
                     // the matched string as part of the default case.
                     if (severity_indicators.get("error") === undefined) {
                        lowercase_errors = true;
                        severity_indicators.set("error", ["error"]);
                     }
                     if (severity_indicators.get("warning") === undefined) {
                        lowercase_warnings = true;
                        severity_indicators.set("warning", ["warning"]);
                     }
                     if (severity_indicators.get("info") === undefined) {
                        lowercase_infos = true;
                        severity_indicators.set("info", ["info"]);
                     }

                     // Check the pattern to see what severity was found.
                     // First get the severity that was extracted from the log and lowercase it if necessary.
                     const match_error: string = (lowercase_errors) ? matches[matcher.pattern.severity].toLowerCase() : matches[matcher.pattern.severity];
                     const match_warning: string = (lowercase_warnings) ? matches[matcher.pattern.severity].toLowerCase() : matches[matcher.pattern.severity];
                     const match_info: string = (lowercase_infos) ? matches[matcher.pattern.severity].toLowerCase() : matches[matcher.pattern.severity];

                     // Then check to see if the matched string matches with any of the error/warning/info strings.
                     if (severity_indicators.get("error")?.includes(match_error)) {
                        diag_severity = vscode.DiagnosticSeverity.Error;
                     } else if (severity_indicators.get("warning")?.includes(match_warning)) {
                        diag_severity = vscode.DiagnosticSeverity.Warning;
                     } else if (severity_indicators.get("info")?.includes(match_info)) {
                        diag_severity = vscode.DiagnosticSeverity.Information;
                     }
                  }

                  let code: string | undefined = undefined;
                  if (matcher.pattern.code) {
                     code = matches[matcher.pattern.code];
                  }

                  // Set default path of None. I'm choosing to report problems
                  // even if they don't have an associated file.
                  let path: string = "None";
                  if (matcher.pattern.file && matches[matcher.pattern.file] !== undefined) {
                     // Assume the file path is absolute by default
                     path = matches[matcher.pattern.file];

                     if (matcher.fileLocation && matcher.fileLocation.constructor === Array && matcher.fileLocation[0] === "relative") {
                        let base_path: string = matcher.fileLocation[1];
                        if (matcher.fileLocation[1].toLowerCase() === "${workspacefolder}" && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) {
                           base_path = vscode.workspace.workspaceFolders[0].uri.fsPath;
                        }

                        path = vscode.Uri.joinPath(vscode.Uri.file(base_path), path).fsPath;
                     }
                  }

                  let start_line: number = 1;
                  let start_char: number = 1;
                  let end_line: number = 1;
                  let end_char: number = 1;

                  // If the pattern "kind" is "file", I'll leave the location details as 0s.
                  // I'm not sure how the task problem matchers handle this situation, since
                  // the Diagnostic requires a range to be specified.
                  if (matcher.pattern.kind !== "file") {
                     if (matcher.pattern.location) {
                        // If a location key is specified, parse the match for location details.
                        const location: string = (matches[matcher.pattern.location] === undefined) ? '1,1,1,1' : matches[matcher.pattern.location];

                        // Find all digit strings within the match
                        const loc_pattern: RegExp = /\d+/g;
                        const loc_detail: RegExpMatchArray | null = location.match(loc_pattern);

                        // Set the location details based on how many digit strings we found.
                        // Location patterns supported are "line", "line,column", or "startLine,startChar,endLine,endChar".
                        if (loc_detail !== null) {
                           switch (loc_detail.length) {
                              case 1:
                                 start_line = Number(loc_detail[0]);
                                 start_char = 1;
                                 end_line = start_line;
                                 end_char = Number.MAX_VALUE;
                                 break;

                              case 2:
                              case 3:
                                 start_line = Number(loc_detail[0]);
                                 start_char = 1;
                                 end_line = Number(loc_detail[1]);
                                 end_char = Number.MAX_VALUE;
                                 break;

                              default:
                                 start_line = Number(loc_detail[0]);
                                 start_char = Number(loc_detail[1]);
                                 end_line = Number(loc_detail[2]);
                                 end_char = Number(loc_detail[3]);
                           }
                        }
                     } else {
                        // Check for the individual location detail keys in the pattern
                        if (matcher.pattern.line && matches[matcher.pattern.line] !== undefined) {
                           start_line = +matches[matcher.pattern.line];
                           // If we found a start line, set the values for
                           // end_line and end_char that will make sense if we
                           // don't explicitly have those values. May be
                           // overwritten later.
                           end_line = start_line;
                           end_char = Number.MAX_VALUE;
                        }
                        if (matcher.pattern.endLine && matches[matcher.pattern.endLine] !== undefined) {
                           end_line = +matches[matcher.pattern.endLine];
                        }
                        if (matcher.pattern.column && matches[matcher.pattern.column] !== undefined) {
                           start_char = +matches[matcher.pattern.column];
                        }
                        if (matcher.pattern.endColumn && matches[matcher.pattern.endColumn] !== undefined) {
                           end_char = +matches[matcher.pattern.endColumn];
                        }
                     }
                  }

                  // The Range object used in the Diagnostic uses zero-based indexing for locations,
                  // but most log files I've seen don't. Assume one-based indexing, but allow the user
                  // to change it to zero-based.
                  if (matcher.problemLocationZeroBased === undefined || matcher.problemLocationZeroBased === false) {
                     start_line--;
                     start_char--;
                     end_line--;
                     end_char--;
                  }

                  // Don't allow ranges to be negative
                  start_line = (start_line < 0) ? 0 : start_line;
                  start_char = (start_char < 0) ? 0 : start_char;
                  end_line = (end_line < 0) ? 0 : end_line;
                  end_char = (end_char < 0) ? 0 : end_char;

                  // Set default message of "No message found".
                  let message: string = "No message found";
                  if (matcher.pattern.message && matches[matcher.pattern.message] !== undefined) {
                     message = matches[matcher.pattern.message];
                  }

                  // Get source identifier if provided.
                  const source: string = (matcher.source) ? "LPM-" + matcher.source : "LPM";

                  let diagnostics: vscode.Diagnostic[] | undefined = diagnostic_map.get(path);

                  if (diagnostics === undefined) {
                     diagnostics = [];
                  }

                  const diagnostic: vscode.Diagnostic = {
                     source: source,
                     range: new vscode.Range(start_line, start_char, end_line, end_char),
                     message: message,
                     severity: diag_severity,
                     code: code
                  };

                  diagnostics.push(diagnostic);
                  diagnostic_map.set(path, diagnostics);
               }
            });
         }

         diagnostic_map.forEach((diags, file) => {
            diagnosticCollection.set(vscode.Uri.file(file), diags);
         });

         history.log = fileUri[0];

      }
   }

}

// This method is called when your extension is deactivated
export function deactivate() { }
