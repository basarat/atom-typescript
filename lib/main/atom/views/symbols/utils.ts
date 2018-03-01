import {Tag} from "./symbolsTag"
import {TextEditor} from "atom"
import {match} from "fuzzaldrin"
import {QueryMatch} from "./match.d"

// TODO: Hook this into return-from-declaration and findReferences
export async function openTag(tag: Tag) {
  if (tag.file) {
    return atom.workspace.open(tag.file, {
      initialLine: tag.position.row,
    })
  }
}

export function serializeEditorState(editor: TextEditor) {
  const editorElement = atom.views.getView(editor)
  const scrollTop = editorElement.getScrollTop()

  return {
    bufferRanges: editor.getSelectedBufferRanges(),
    scrollTop,
  }
}

export function deserializeEditorState(editor: TextEditor, {bufferRanges, scrollTop}: any) {
  const editorElement = atom.views.getView(editor)
  editor.setSelectedBufferRanges(bufferRanges)
  editorElement.setScrollTop(scrollTop)
}

// extracted/adapted from symbols-view package (symbols-view.js::SymbolsView.highlightMatches)
export function highlightMatches(name: string, query: string): QueryMatch[] {
  let lastIndex: number = 0
  let matchedChars: string[] = [] // Build up a set of matched chars to be more semantic
  const queryMatches: QueryMatch[] = []

  const matches: number[] = match(name, query)
  let matchIndex: number
  for (matchIndex of matches) {
    if (matchIndex < 0) {
      continue // If marking up the basename, omit name matches
    }
    const unmatched = name.substring(lastIndex, matchIndex)
    if (unmatched) {
      if (matchedChars.length) {
        queryMatches.push({text: matchedChars.join(""), type: "character-match"})
      }
      matchedChars = []
      queryMatches.push({text: unmatched})
    }
    matchedChars.push(name[matchIndex])
    lastIndex = matchIndex + 1
  }

  if (matchedChars.length) {
    queryMatches.push({text: matchedChars.join(""), type: "character-match"})
  }

  // Remaining characters are plain text
  queryMatches.push({text: name.substring(lastIndex)})

  return queryMatches
}
