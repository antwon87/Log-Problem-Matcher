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
         vscode.window.showErrorMessage("LPM can't run the 'Scan for Problems' command in whatever way you initiated it. It must be run by right clicking a file in the Explorer or Editor tab title.");
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

      // TODO: Maybe make this clear optional? Might be useful if scanning multiple
      // different logs.
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
         loop?: boolean;
      }

      interface ProblemMatcherInterface {
         title?: string;
         fileLocation?: string | string[];
         problemLocationZeroBased?: boolean;
         problemLineZeroBased?: boolean;
         problemColumnZeroBased?: boolean;
         source?: string;
         defaultSelected?: boolean;
         severity?: string;
         error_string?: string | string[];
         warning_string?: string | string[];
         info_string?: string | string[];
         linkToLogFile?: string;
         pattern: PatternInterface;
         patternArray?: PatternInterface[];
      }

      interface ProblemMatcherState {
         patternIndex: number;
         start_line: number;
         start_char: number;
         end_line: number;
         end_char: number;
         message: string;
         append_message: boolean;
         severity: vscode.DiagnosticSeverity;
         code: string | undefined;
         path: string;
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

      function setDefaultMatcherState(s: ProblemMatcherState) {
         s.patternIndex = 0;
         s.start_line = 1;
         s.start_char = 1;
         s.end_line = 1;
         s.end_char = 1;
         s.message = "No message found.";
         s.append_message = false;
         s.severity = vscode.DiagnosticSeverity.Hint;
         s.code = undefined;
         s.path = "None";
      };

      // Check if this matcher is a multi-line matcher that has only been collecting
      // a multi-line message as the last step. The 'loop' setting will indicate that
      // this is the last step of a multi-line matcher. The 'message' should be the
      // only match index set if we are only collecting a multi-line message.
      function isCollectingMessage(pattern: PatternInterface): boolean {
         return (
            pattern.message !== undefined &&
            pattern.loop === true &&
            pattern.code === undefined &&
            pattern.column === undefined &&
            pattern.endColumn === undefined &&
            pattern.line === undefined &&
            pattern.endLine === undefined &&
            pattern.file === undefined &&
            pattern.location === undefined &&
            pattern.severity === undefined
         );
      }

      function createAndAddDiagnostic(
         diagnostic_map: Map<string, vscode.Diagnostic[]>,
         matcher: ProblemMatcherInterface,
         m_state: ProblemMatcherState
      ) {
         // Get source identifier if provided.
         const source: string = (matcher.source) ? "LPM-" + matcher.source : "LPM";

         let diagnostics: vscode.Diagnostic[] | undefined = diagnostic_map.get(m_state.path);

         if (diagnostics === undefined) {
            diagnostics = [];
         }

         const diagnostic: vscode.Diagnostic = {
            source: source,
            range: new vscode.Range(
               m_state.start_line,
               m_state.start_char,
               m_state.end_line,
               m_state.end_char
            ),
            message: m_state.message,
            severity: m_state.severity,
            code: m_state.code
         };

         diagnostics.push(diagnostic);
         diagnostic_map.set(m_state.path, diagnostics);

      }

      // The Range object used in the Diagnostic uses zero-based indexing for locations,
      // but most log files I've seen don't. Assume one-based indexing, but allow the user
      // to change it to zero-based.
      // The problemLocationZeroBased affects both row and column, or the user can select
      // settings independently for row and column.
      function adjustLocationIndexing(
         matcher: ProblemMatcherInterface,
         m_state: ProblemMatcherState,
         update_start_line: boolean,
         update_end_line: boolean,
         update_start_column: boolean,
         update_end_column: boolean
      ) {
         if (matcher.problemLocationZeroBased === undefined || matcher.problemLocationZeroBased === false) {
            if (matcher.problemLineZeroBased === undefined || matcher.problemLineZeroBased === false) {
               if (update_start_line) {
                  m_state.start_line--;
               }
               if (update_end_line) {
                  m_state.end_line--;
               }
            }
            if (matcher.problemColumnZeroBased === undefined || matcher.problemColumnZeroBased === false) {
               if (update_start_column) {
                  m_state.start_char--;
               }
               if (update_end_column) {
                  m_state.end_char--;
               }
            }
         }
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
         // If the pattern is only a pattern object, not an array, then make it an array with one element.
         if (matcher.pattern && matcher.pattern.constructor === Array) {
            matcher.patternArray = matcher.pattern;
         } else {
            matcher.patternArray = [matcher.pattern];
         }

         if (matcher.patternArray === undefined) {
            vscode.window.showErrorMessage("matcher.patternArray is undefined. Please contact the extension author to report a bug.");
            return;
         }

         matcher.patternArray.forEach(p => {
            if (p.regexp === undefined) {
               vscode.window.showErrorMessage(`You must define a 'regexp' property under the 'pattern' property of all problem matchers.`);
               return;
            }
         });
      };

      // Create regexp objects for each pattern
      matchers.forEach(matcher => {
         matcher.patternArray?.forEach(p => p.regexp_obj = RegExp(p.regexp));
      });

      // Set up a ProblemMatcherState object for each matcher to keep track of the state of the
      // matcher, including which pattern in the pattern array is being checked (for a multiline
      // problem matcher) and all of the diagnostic information collected so far. Start with default
      // values for diagnostic information.
      let matcher_state: ProblemMatcherState[] = [];
      matchers.forEach(matcher => {
         // Create a new ProblemMatcherState object, set it to default values, and push
         // it onto the matcher_state array.
         let m_state: ProblemMatcherState = {} as ProblemMatcherState;
         setDefaultMatcherState(m_state);
         matcher_state.push(m_state);
      });

      if (fileUri && fileUri[0]) {
         let diagnostic_map: Map<string, vscode.Diagnostic[]> = new Map();
         let line_count: number = 0;

         const file: FileHandle = await fs.promises.open(fileUri[0].fsPath);

         for await (const line of file.readLines()) {

            // Loop through each selected matcher, checking it against this line
            matchers.forEach((matcher, idx) => {
               if (matcher.patternArray === undefined) {
                  vscode.window.showErrorMessage("matcher.patternArray is undefined. Please contact the extension author to report a bug.");
                  return;
               }

               // Get the matcher state that corresponds to this matcher.
               let m_state: ProblemMatcherState = matcher_state[idx];

               // Run the regex for this matcher and its active pattern.
               const matches: RegExpExecArray | null = matcher.patternArray[m_state.patternIndex].regexp_obj!.exec(line);

               if (matches === null) {
                  // Check if this matcher is a multi-line matcher that has only been collecting
                  // a multi-line message as the last step. This null match will mean we have finished
                  // collecting that message and need to create the diagnostic object.
                  if (isCollectingMessage(matcher.patternArray[m_state.patternIndex])) {
                     createAndAddDiagnostic(diagnostic_map, matcher, m_state);
                  }

                  // Reset the matcher state to default to be ready for the next match
                  setDefaultMatcherState(m_state);
               } else {

                  if (matcher.severity) {
                     // User-defined severity override
                     switch (matcher.severity.toLowerCase()) {
                        case "error":
                           m_state.severity = vscode.DiagnosticSeverity.Error;
                           break;

                        case "warning":
                           m_state.severity = vscode.DiagnosticSeverity.Warning;
                           break;

                        case "info":
                           m_state.severity = vscode.DiagnosticSeverity.Information;
                           break;
                     }
                  } else {
                     // Detect severity from the pattern.

                     // Check the matches for severity if severity is included in this pattern.
                     let pattern_severity_idx = matcher.patternArray[m_state.patternIndex].severity;
                     if (pattern_severity_idx !== undefined) {

                        // Get severity from the pattern match
                        let severity_indicators: Map<string, string | string[] | undefined> = new Map<string, string[]>();
                        let lowercase_errors: boolean = false;
                        let lowercase_warnings: boolean = false;
                        let lowercase_infos: boolean = false;

                        // Get custom severity indicators from settings. As described above, if the severity string
                        // is present in the patterns, it must be in the first pattern.
                        if (matcher.error_string !== undefined) {
                           severity_indicators.set("error", matcher.error_string);
                        } else {
                           severity_indicators.set("error", matcher.patternArray[0].error_string);
                        }
                        if (matcher.warning_string !== undefined) {
                           severity_indicators.set("warning", matcher.warning_string);
                        } else {
                           severity_indicators.set("warning", matcher.patternArray[0].warning_string);
                        }
                        if (matcher.info_string !== undefined) {
                           severity_indicators.set("info", matcher.info_string);
                        } else {
                           severity_indicators.set("info", matcher.patternArray[0].info_string);
                        }

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
                        const match_error: string = (lowercase_errors) ? matches[pattern_severity_idx].toLowerCase() : matches[pattern_severity_idx];
                        const match_warning: string = (lowercase_warnings) ? matches[pattern_severity_idx].toLowerCase() : matches[pattern_severity_idx];
                        const match_info: string = (lowercase_infos) ? matches[pattern_severity_idx].toLowerCase() : matches[pattern_severity_idx];

                        // Then check to see if the matched string matches with any of the error/warning/info strings.
                        if (severity_indicators.get("error")?.includes(match_error)) {
                           m_state.severity = vscode.DiagnosticSeverity.Error;
                        } else if (severity_indicators.get("warning")?.includes(match_warning)) {
                           m_state.severity = vscode.DiagnosticSeverity.Warning;
                        } else if (severity_indicators.get("info")?.includes(match_info)) {
                           m_state.severity = vscode.DiagnosticSeverity.Information;
                        }
                     }
                  }

                  let pattern_code_idx = matcher.patternArray[m_state.patternIndex].code;
                  if (pattern_code_idx) {
                     m_state.code = matches[pattern_code_idx];
                  }

                  // Use default path of None. I'm choosing to report problems
                  // even if they don't have an associated file. If using the linkToLogFile
                  // option, set the path to be the log file that we're parsing.
                  let pattern_file_idx = matcher.patternArray[m_state.patternIndex].file;
                  if (matcher.linkToLogFile) {
                     m_state.path = fileUri[0].fsPath;
                  } else if (pattern_file_idx && matches[pattern_file_idx] !== undefined) {
                     // Assume the file path is absolute by default
                     m_state.path = matches[pattern_file_idx];

                     if (matcher.fileLocation && matcher.fileLocation.constructor === Array && matcher.fileLocation[0] === "relative") {
                        let base_path: string = matcher.fileLocation[1];
                        if (matcher.fileLocation[1].toLowerCase() === "${workspacefolder}" && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) {
                           base_path = vscode.workspace.workspaceFolders[0].uri.fsPath;
                        }

                        m_state.path = vscode.Uri.joinPath(vscode.Uri.file(base_path), m_state.path).fsPath;
                     }
                  }

                  // If using the linkToLogFile option, set the location to be the line in the
                  // log file where this problem is reported.
                  if (matcher.linkToLogFile) {
                     // Only grab the line if we're matching the first element of the pattern array
                     // so that we don't update it multiple times when parsing a multi-line problem.
                     if (m_state.patternIndex === 0) {
                        m_state.start_line = line_count;
                        m_state.end_line = m_state.start_line;
                        m_state.start_char = 0;
                        m_state.end_char = 0;
                     }
                  } else if (matcher.patternArray[0].kind !== "file") {
                     // If the pattern "kind" is "file", I'll leave the location details as 0s.
                     // I'm not sure how the task problem matchers handle this situation, since
                     // the Diagnostic requires a range to be specified.
                     // "kind" must be specified in the first element of the pattern array (if it's
                     // a multi-line array).

                     let pattern_location_idx = matcher.patternArray[m_state.patternIndex].location;
                     if (pattern_location_idx) {
                        // If a location key is specified, parse the match for location details.
                        const location: string = (matches[pattern_location_idx] === undefined) ? '1,1,1,1' : matches[pattern_location_idx];

                        // Find all digit strings within the match
                        const loc_pattern: RegExp = /\d+/g;
                        const loc_detail: RegExpMatchArray | null = location.match(loc_pattern);

                        // Set the location details based on how many digit strings we found.
                        // Location patterns supported are "line", "line,column", or "startLine,startChar,endLine,endChar".
                        if (loc_detail !== null) {
                           switch (loc_detail.length) {
                              case 1:
                                 m_state.start_line = Number(loc_detail[0]);
                                 m_state.start_char = 1;
                                 m_state.end_line = m_state.start_line;
                                 m_state.end_char = Number.MAX_VALUE;
                                 break;

                              case 2:
                              case 3:
                                 m_state.start_line = Number(loc_detail[0]);
                                 m_state.start_char = 1;
                                 m_state.end_line = Number(loc_detail[1]);
                                 m_state.end_char = Number.MAX_VALUE;
                                 break;

                              default:
                                 m_state.start_line = Number(loc_detail[0]);
                                 m_state.start_char = Number(loc_detail[1]);
                                 m_state.end_line = Number(loc_detail[2]);
                                 m_state.end_char = Number(loc_detail[3]);
                           }
                        }

                        adjustLocationIndexing(matcher, m_state, true, true, true, true);

                     } else {
                        // Check for the individual location detail keys in the pattern
                        let pattern_line_idx = matcher.patternArray[m_state.patternIndex].line;
                        let pattern_column_idx = matcher.patternArray[m_state.patternIndex].column;
                        let pattern_end_line_idx = matcher.patternArray[m_state.patternIndex].endLine;
                        let pattern_end_column_idx = matcher.patternArray[m_state.patternIndex].endColumn;

                        if (pattern_line_idx && matches[pattern_line_idx] !== undefined) {
                           m_state.start_line = +matches[pattern_line_idx];
                           // If we found a start line, set the values for
                           // end_line and end_char that will make sense if we
                           // don't explicitly have those values. May be
                           // overwritten later.
                           m_state.end_line = m_state.start_line;
                           m_state.end_char = Number.MAX_VALUE;
                           adjustLocationIndexing(matcher, m_state, true, true, false, true);
                        }
                        if (pattern_end_line_idx && matches[pattern_end_line_idx] !== undefined) {
                           m_state.end_line = +matches[pattern_end_line_idx];
                           adjustLocationIndexing(matcher, m_state, false, true, false, false);
                        }
                        if (pattern_column_idx && matches[pattern_column_idx] !== undefined) {
                           m_state.start_char = +matches[pattern_column_idx];
                           adjustLocationIndexing(matcher, m_state, false, false, true, false);
                        }
                        if (pattern_end_column_idx && matches[pattern_end_column_idx] !== undefined) {
                           m_state.end_char = +matches[pattern_end_column_idx];
                           adjustLocationIndexing(matcher, m_state, false, false, false, true);
                        }
                     }

                     // Don't allow ranges to be negative
                     m_state.start_line = (m_state.start_line < 0) ? 0 : m_state.start_line;
                     m_state.start_char = (m_state.start_char < 0) ? 0 : m_state.start_char;
                     m_state.end_line = (m_state.end_line < 0) ? 0 : m_state.end_line;
                     m_state.end_char = (m_state.end_char < 0) ? 0 : m_state.end_char;

                  }

                  // Capture message. To support multi-line messages, the first message encountered
                  // will overwrite the default message. If another message is found in the execution
                  // of the same multi-line matcher, it will be appended to the previous message.
                  let pattern_message_idx = matcher.patternArray[m_state.patternIndex].message;
                  if (pattern_message_idx && matches[pattern_message_idx] !== undefined) {
                     if (m_state.append_message) {
                        m_state.message = m_state.message + ' ' + matches[pattern_message_idx].trim();
                     } else {
                        m_state.message = matches[pattern_message_idx].trim();
                        m_state.append_message = true;
                     }
                  }

                  // If this is the last pattern in the pattern array, create a diagnostic
                  // object for this problem. Unless this is a loop that is only collecting
                  // a mutli-line message. In that case we need to get the full message
                  // before creating the diagnostic. Which means it will need to happen
                  // after we get a line that doesn't match the pattern.
                  if (m_state.patternIndex === matcher.patternArray.length - 1 &&
                     !isCollectingMessage(matcher.patternArray[m_state.patternIndex])) {

                     createAndAddDiagnostic(diagnostic_map, matcher, m_state);

                  }

                  // Increment the patternArray index if needed. Keep it the same if
                  // on the last element and it has "loop" set. Reset if on the last
                  // element and there is no loop, or if it's a single-element array.
                  // Also reset the matcher state to default when resetting the index.
                  if (m_state.patternIndex === matcher.patternArray.length - 1) {
                     let loop: boolean | undefined = matcher.patternArray[m_state.patternIndex].loop;
                     if (matcher.patternArray.length === 1) {
                        setDefaultMatcherState(m_state);
                     } else if (loop === undefined || loop === false) {
                        setDefaultMatcherState(m_state);
                     }
                  } else {
                     m_state.patternIndex++;
                  }
               }
            });

            line_count++;
         }

         // If the last line of the log file was the last line of a multi-line message,
         // we need to finish off that diagnostic. Loop through all matchers to check
         // for this situation.
         matchers.forEach((matcher, idx) => {
            createAndAddDiagnostic(diagnostic_map, matcher, matcher_state[idx]);
         });

         diagnostic_map.forEach((diags, file) => {
            diagnosticCollection.set(vscode.Uri.file(file), diags);
         });

         history.log = fileUri[0];

         vscode.commands.executeCommand("workbench.panel.markers.view.focus");

      }
   }

}

// This method is called when your extension is deactivated
export function deactivate() { }
