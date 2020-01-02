import {Point, Range} from "atom"
import {IndieDelegate, Message} from "atom/linter"
import {debounce} from "lodash"
import * as path from "path"
import {Diagnostic} from "typescript/lib/protocol"
import {DiagnosticTypes} from "../client/clientResolver"
import {locationsToRange, spanToRange} from "./atom/utils"

/** Class that collects errors from all of the clients and pushes them to the Linter service */
export class ErrorPusher {
  private linter?: IndieDelegate
  private errors: Map<
    string,
    Map<
      string,
      {
        triggerFile: string | undefined
        diagnostics: Diagnostic[]
      }
    >
  > = new Map()

  constructor() {
    this.pushErrors = debounce(this.pushErrors.bind(this), 100)
  }

  public *getErrorsInRange(filePath: string, range: Range): IterableIterator<Diagnostic> {
    for (const prefixed of this.errors.values()) {
      const errors = prefixed.get(path.normalize(filePath))
      if (errors) yield* errors.diagnostics.filter(err => spanToRange(err).intersectsWith(range))
    }
  }

  /** Return any errors that cover the given location */
  public *getErrorsAt(filePath: string, loc: Point): IterableIterator<Diagnostic> {
    for (const prefixed of this.errors.values()) {
      const errors = prefixed.get(path.normalize(filePath))
      if (errors) yield* errors.diagnostics.filter(err => spanToRange(err).containsPoint(loc))
    }
  }

  /** Set errors. Previous errors with the same prefix and filePath are going to be replaced */
  public setErrors(
    prefix: DiagnosticTypes,
    filePath: string,
    errors: Diagnostic[],
    triggerFile?: string,
  ) {
    let prefixed = this.errors.get(prefix)
    if (!prefixed) {
      prefixed = new Map()
      this.errors.set(prefix, prefixed)
    }

    prefixed.set(path.normalize(filePath), {
      triggerFile,
      diagnostics: errors,
    })

    this.pushErrors()
  }

  public clearFileErrors({projectPath, triggerFile}: {projectPath?: string; triggerFile?: string}) {
    if (triggerFile === undefined && projectPath === undefined) return
    for (const fileErrors of this.errors.values()) {
      for (const [filePath, errors] of fileErrors) {
        if (
          ((projectPath !== undefined && filePath.startsWith(projectPath)) ||
            (triggerFile !== undefined &&
              (triggerFile === errors.triggerFile || triggerFile === filePath))) &&
          fileErrors.has(filePath)
        ) {
          fileErrors.delete(filePath)
        }
      }
    }
    this.pushErrors()
  }

  public getErrors(triggerFile: string) {
    const errFiles = []
    for (const fileErrors of this.errors.values()) {
      for (const [filePath, errors] of fileErrors) {
        if (triggerFile === errors.triggerFile && errFiles.indexOf(filePath) === -1) {
          errFiles.push(filePath)
        }
      }
    }
    return errFiles
  }

  public clear() {
    if (!this.linter) return
    this.linter.clearMessages()
  }

  public setLinter(linter: IndieDelegate) {
    this.linter = linter
    this.pushErrors()
  }

  public dispose() {
    this.clear()
    if (this.linter) this.linter.dispose()
    this.linter = undefined
  }

  private pushErrors() {
    if (this.linter) this.linter.setAllMessages(Array.from(this.getLinterErrors()))
  }

  private *getLinterErrors(): IterableIterator<Message> {
    const config = atom.config.get("atom-typescript")

    if (!config.suppressAllDiagnostics) {
      for (const fileErrors of this.errors.values()) {
        for (const [filePath, errors] of fileErrors) {
          for (const diagnostic of errors.diagnostics) {
            if (config.ignoredDiagnosticCodes.includes(`${diagnostic.code}`)) continue
            if (config.ignoreUnusedSuggestionDiagnostics) {
              const isNodeModule = atom.project
                .relativizePath(filePath)[1]
                .startsWith(`node_modules${path.sep}`)
              if (
                diagnostic.reportsUnnecessary ||
                (diagnostic.category === "suggestion" && isNodeModule)
              ) {
                continue
              }
            }
            // if (filePath && atom.project.relativizePath(filePath)[1].startsWith(`node_modules${path.sep}`)) continue
            // Add a bit of extra validation that we have the necessary locations since linter v2
            // does not allow range-less messages anymore. This happens with configFileDiagnostics.
            let {start, end} = diagnostic as Partial<Diagnostic>
            if (!start || !end) {
              start = end = {line: 1, offset: 1}
            }

            yield {
              severity: this.getSeverity(config.unusedAsInfo, diagnostic),
              excerpt: diagnostic.text,
              location: {
                file: filePath,
                position: locationsToRange(start, end),
              },
            }
          }
        }
      }
    }
  }

  private getSeverity(unusedAsInfo: boolean, diagnostic: Diagnostic) {
    if (unusedAsInfo && diagnostic.code === 6133) return "info"
    switch (diagnostic.category) {
      case "error":
        return "error"
      case "warning":
        return "warning"
      default:
        return "info"
    }
  }
}
