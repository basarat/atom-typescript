import * as path from "path"
import {Point} from "atom"
import fs from "fs-plus"
import {match} from "fuzzaldrin"

/**
 * this is a slightly modified copy of symbols-view/lib/symbols-view.js
 * for support of searching file-symbols in typescript files.
 */

export default class SymbolsView {
  stack: any
  selectListView: any
  element: any
  panel: any
  isCanceling: boolean
  previouslyFocusedElement: HTMLElement | null = null
  static highlightMatches(context: any, name: any, matches: any, offsetIndex?: any) {
    if (!offsetIndex) {
      offsetIndex = 0
    }
    let lastIndex = 0
    let matchedChars = [] // Build up a set of matched chars to be more semantic
    const fragment = document.createDocumentFragment()

    let matchIndex: any
    for (matchIndex of Array.from(matches)) {
      matchIndex -= offsetIndex
      if (matchIndex < 0) {
        continue // If marking up the basename, omit name matches
      }
      const unmatched = name.substring(lastIndex, matchIndex)
      if (unmatched) {
        if (matchedChars.length) {
          const span = document.createElement("span")
          span.classList.add("character-match")
          span.textContent = matchedChars.join("")
          fragment.appendChild(span)
        }
        matchedChars = []
        fragment.appendChild(document.createTextNode(unmatched))
      }
      matchedChars.push(name[matchIndex])
      lastIndex = matchIndex + 1
    }

    if (matchedChars.length) {
      const span = document.createElement("span")
      span.classList.add("character-match")
      span.textContent = matchedChars.join("")
      fragment.appendChild(span)
    }

    // Remaining characters are plain text
    fragment.appendChild(document.createTextNode(name.substring(lastIndex)))

    return fragment
  }

  constructor(stack: any, emptyMessage = "No symbols found", maxResults = null) {
    this.stack = stack
    const SelectListView = require("atom-select-list")
    this.selectListView = new SelectListView({
      maxResults,
      emptyMessage,
      items: [],
      filterKeyForItem: (item: any) => item.name,
      elementForItem: this.elementForItem.bind(this),
      didChangeSelection: this.didChangeSelection.bind(this),
      didConfirmSelection: this.didConfirmSelection.bind(this),
      didConfirmEmptySelection: this.didConfirmEmptySelection.bind(this),
      didCancelSelection: this.didCancelSelection.bind(this),
    })
    this.element = this.selectListView.element
    this.element.classList.add("symbols-view")
    this.panel = atom.workspace.addModalPanel({item: this, visible: false})
  }

  async destroy() {
    await this.cancel()
    this.panel.destroy()
    return this.selectListView.destroy()
  }

  getFilterKey() {
    return "name"
  }

  elementForItem({position, name, file, directory}: any) {
    // Style matched characters in search results
    const matches = match(name, this.selectListView.getFilterQuery())

    if ((atom.project as any).getPaths().length > 1) {
      file = path.join(path.basename(directory), file)
    }

    const li = document.createElement("li")
    li.classList.add("two-lines")

    const primaryLine = document.createElement("div")
    primaryLine.classList.add("primary-line")
    if (position) {
      primaryLine.textContent = `${name}:${position.row + 1}`
    } else {
      primaryLine.appendChild(SymbolsView.highlightMatches(this, name, matches))
    }
    li.appendChild(primaryLine)

    const secondaryLine = document.createElement("div")
    secondaryLine.classList.add("secondary-line")
    secondaryLine.textContent = file
    li.appendChild(secondaryLine)

    return li
  }

  async cancel() {
    if (!this.isCanceling) {
      this.isCanceling = true
      await this.selectListView.update({items: []})
      this.panel.hide()
      if (this.previouslyFocusedElement) {
        this.previouslyFocusedElement.focus()
        this.previouslyFocusedElement = null
      }
      this.isCanceling = false
    }
  }

  didCancelSelection() {
    this.cancel()
  }

  didConfirmEmptySelection() {
    this.cancel()
  }

  async didConfirmSelection(tag: any) {
    if (tag.file && !fs.isFileSync(path.join(tag.directory, tag.file))) {
      await this.selectListView.update({errorMessage: "Selected file does not exist"})
      setTimeout(() => {
        this.selectListView.update({errorMessage: null})
      }, 2000)
    } else {
      await this.cancel()
      this.openTag(tag)
    }
  }

  didChangeSelection(tag: any) {
    // no-op
  }

  openTag(tag: any) {
    const editor = atom.workspace.getActiveTextEditor()
    let previous
    if (editor) {
      previous = {
        editorId: editor.id,
        position: editor.getCursorBufferPosition(),
        file: editor.getURI(),
      }
    }

    let {position} = tag
    if (!position) {
      position = this.getTagLine(tag)
    }
    if (tag.file) {
      ;(atom.workspace as any).open(path.join(tag.directory, tag.file)).then(() => {
        if (position) {
          return this.moveToPosition(position)
        }
        return undefined
      })
    } else if (position && previous && !previous.position.isEqual(position)) {
      this.moveToPosition(position)
    }

    this.stack.push(previous)
  }

  moveToPosition(position: any, beginningOfLine?: any) {
    const editor = atom.workspace.getActiveTextEditor()
    if (beginningOfLine == null) {
      beginningOfLine = true
    }
    if (editor) {
      editor.scrollToBufferPosition(position, {center: true})
      editor.setCursorBufferPosition(position)
      if (beginningOfLine) {
        ;(editor as any).moveToFirstCharacterOfLine()
      }
    }
  }

  attach() {
    this.previouslyFocusedElement = document.activeElement as HTMLElement
    this.panel.show()
    this.selectListView.reset()
    this.selectListView.focus()
  }

  getTagLine(tag: any) {
    // Remove leading /^ and trailing $/
    if (!tag || !tag.pattern) {
      return undefined
    }
    const pattern = tag.pattern.replace(/(^^\/\^)|(\$\/$)/g, "").trim()

    if (!pattern) {
      return undefined
    }
    const file = path.join(tag.directory, tag.file)
    if (!fs.isFileSync(file)) {
      return undefined
    }
    const iterable = fs.readFileSync(file, "utf8").split("\n")
    for (let index = 0; index < iterable.length; index++) {
      let line = iterable[index]
      if (pattern === line.trim()) {
        return new Point(index, 0)
      }
    }

    return undefined
  }
}