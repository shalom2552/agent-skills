export type TdiffKind = 'added' | 'modified' | 'deleted'

export type TdiffNoText = 'binary' | 'too-large'

export type TdiffRow = {
  path: string
  kind: TdiffKind
  adds: number
  dels: number
  noText: TdiffNoText | null
  changedAt: number
  isEditedSince: boolean
}

export type TdiffText = { text: string; adds: number; dels: number; truncated: boolean }

export type TdiffOpen = {
  path: string
  diff: TdiffText | null
  note: TdiffNoText | 'unchanged' | null
}

export type TdiffShellReason = 'root-is-home' | 'root-is-fs-root' | 'no-git' | 'too-slow' | 'failed'

export type TdiffShell =
  | { status: 'starting' | 'on'; reason: null }
  | { status: 'limited'; reason: TdiffShellReason }

export type TdiffWhere = { root: string; home: string }

declare module 'claude-code' {
  interface PluginState {
    'tdiff': {
      rows: Shaped<TdiffRow[]>
      open: Shaped<TdiffOpen | null>
      shell: Shaped<TdiffShell>
      where: Shaped<TdiffWhere>
      folds: Shaped<Record<string, boolean>>
      focused: Shaped<string | null>
    }
  }
}
