import { Dialog } from '../ai/Dialog'

const KEYS: [string, string][] = [
  ['N', 'Add a text note'], ['C', 'Add a custom box'], ['T', 'Add a schema table'], ['G', 'Put the selected block in a new frame'],
  ['Shift+G', "Delete the selected block's frame (blocks stay)"], ['Arrows', 'Move the selected block or note'], ['Delete', 'Delete the selected block, link or note'],
  ['L', 'Start a link from the selected block'], ['Ctrl/Cmd+.', 'Swap focus between the canvas and the notes'], ['Esc', 'Back to the canvas'],
  ['Ctrl/Cmd+Enter', 'Send your answer to the partner'], ['?', 'This list'],
]

export function KeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" testId="session-keys" onClose={onClose}>
      <dl className="ds-keys">
        {KEYS.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
      </dl>
    </Dialog>
  )
}
