// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Bridge between the (non-React) mutator and the React confirmation
// dialog host for moving multi-producer cards into the "完成" status.
//
// The host component (CompletionConfirmHost, mounted once in App)
// registers a handler that shows the modal and resolves with the
// user's choice, including any share edits made in the dialog.
// Requests are serialized through a promise chain so batch drags
// present one dialog at a time. When no host is mounted (tests,
// headless paths), requests default to confirmed so existing flows
// never break.
//
// The dialog is deliberately minimal (2026-10-21 revision): producer
// + completion share only. Converted days/amounts are NOT shown.

export type CompletionConfirmRow = {
    userId: string
    share: number
}

export type CompletionConfirmRequest = {
    cardTitle: string
    rows: CompletionConfirmRow[]
    totalShare: number

    // Property ids the edited shares are written back to when the
    // user confirms (the status change and the share write ship in a
    // single block patch).
    detailPropertyId?: string
    totalPropertyId?: string
}

export type CompletionConfirmResult = {
    confirmed: boolean
    shares?: Record<string, number>
}

type ConfirmHandler = (req: CompletionConfirmRequest) => Promise<CompletionConfirmResult>

let handler: ConfirmHandler | null = null
let chain: Promise<void> = Promise.resolve()

export function registerCompletionConfirmHandler(h: ConfirmHandler): () => void {
    handler = h
    return () => {
        if (handler === h) {
            handler = null
        }
    }
}

export function requestCompletionConfirmation(req: CompletionConfirmRequest): Promise<CompletionConfirmResult> {
    if (!handler) {
        return Promise.resolve({confirmed: true})
    }
    const h = handler
    const run = chain.then(() => h(req))
    chain = run.then(
        () => undefined,
        () => undefined,
    )
    return run
}
