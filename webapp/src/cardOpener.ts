// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Bridge between the (non-React) mutator and the Workspace component
// for opening a card's detail dialog programmatically. Workspace owns
// the router-backed showCard(); it registers an opener while mounted.
// Used by the actual-hours gate: when a move into "完成" is blocked
// because 实际耗时 is empty, the card is opened so the user can fill
// the hours in right away. No opener registered (tests, headless)
// means the request is a no-op; the block itself still applies.

type CardOpener = (boardId: string, cardId: string) => void

let opener: CardOpener | null = null

export function registerCardOpener(fn: CardOpener): () => void {
    opener = fn
    return () => {
        if (opener === fn) {
            opener = null
        }
    }
}

export function requestOpenCard(boardId: string, cardId: string): void {
    if (opener) {
        opener(boardId, cardId)
    }
}
