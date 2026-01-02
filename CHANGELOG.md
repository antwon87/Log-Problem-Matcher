# Change Log

## 1.2.0

- Added multi-line problem matching capability similar to the VS Code task problem matchers.
- Added the capability to specify the `error_string`, `warning_string`, and `info_string` options within the matcher object rather than the pattern object in the settings. It is still possible to specify them in the pattern, but if `pattern` is an array for a multi-line matcher, the error indicator strings must be in the first pattern of the array.
- Added an option to make problems link to the location in the log file where they were reported rather than linking to the source file where the problem exists. May be useful when you want to see the context around the message in the log.

## 1.1.0

- Added Line and Column number zero-based or one-based indexing options.
- LPM now opens the Problems pane automatically after scanning a log.

## 1.0.4

- Added a "Scan for Problems" command in the right-click context menu for editor tabs.

## 1.0.3

- Added the "problemLocationZeroBased" setting for a problem matcher to indicate that the reported line and column locations are zero-based.

- Added a "Scan for Problems" command in the right-click context menu when you click on a file in the Explorer.

## 1.0.2

Fixed a bug making the problem location (line, column) off by one.

## 1.0.1

Minor documentation changes.

## 1.0.0

Initial release of Log Problem Matcher.