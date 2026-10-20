// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react'

import {Board, createBoard, IPropertyTemplate} from '../../blocks/board'
import mutator from '../../mutator'
import {useAppSelector} from '../../store/hooks'
import {getBoard} from '../../store/boards'
import {RootState} from '../../store'

// Storage key for the UI-only property order (in board.properties).
export const PROPERTY_ORDER_KEY = 'cardPropertyOrder'

// Effective property order: the stored cardPropertyOrder cleaned against
// the board's current properties. Stored IDs of deleted properties
// ("phantoms") are dropped — otherwise they absorb up/down moves and the
// buttons look dead — and properties added after the order was saved are
// appended so they can be moved too (indexOf would be -1 otherwise).
export function getEffectiveOrderIds(board: Board): string[] {
    const currentIds = board.cardProperties.map((t) => t.id)
    const currentSet = new Set(currentIds)
    const stored = (board.properties || {})[PROPERTY_ORDER_KEY]
    if (Array.isArray(stored) && stored.every((id) => typeof id === 'string')) {
        const kept = (stored as string[]).filter((id) => currentSet.has(id))
        const keptSet = new Set(kept)
        const missing = currentIds.filter((id) => !keptSet.has(id))
        return [...kept, ...missing]
    }
    return currentIds
}

type Props = {
    board: Board
    propertyTemplate: IPropertyTemplate
    children: React.ReactNode
    canReorder: boolean
}

// Property row with up/down reorder buttons (hover-visible).
// Order is stored UI-only in board.properties[PROPERTY_ORDER_KEY] as an
// array of property IDs. This avoids the broken cardProperties patch
// path (createCardPropertiesPatches ignores pure reorders).
// Card data is keyed by property ID and unaffected by order.
const DraggablePropertyRow = (props: Props): JSX.Element => {
    // Always use the freshest board from the store to avoid stale references.
    const freshBoard = useAppSelector((state: RootState) => getBoard(props.board.id)(state)) || props.board

    const move = async (delta: -1 | 1) => {
        try {
            const orderedIds = getEffectiveOrderIds(freshBoard)
            const srcIndex = orderedIds.indexOf(props.propertyTemplate.id)
            if (srcIndex < 0) {
                console.error('[reorder] template not found:', props.propertyTemplate.id)
                return
            }
            const destIndex = srcIndex + delta
            if (destIndex < 0 || destIndex >= orderedIds.length) {
                return
            }
            const newOrderedIds = [...orderedIds]
            const [moved] = newOrderedIds.splice(srcIndex, 1)
            newOrderedIds.splice(destIndex, 0, moved)

            const newBoard = createBoard(freshBoard)
            newBoard.properties = {
                ...(newBoard.properties || {}),
                [PROPERTY_ORDER_KEY]: newOrderedIds,
            }
            await mutator.updateBoard(newBoard, freshBoard, 'reorder properties')
        } catch (e) {
            console.error('[reorder] failed:', e)
        }
    }

    return (
        <div className='octo-propertyrow'>
            {props.canReorder && (
                <div className='octo-propertyrow__reorder'>
                    <button
                        className='octo-propertyrow__reorder-btn'
                        title='上移'
                        onClick={() => move(-1)}
                    >
                        ↑
                    </button>
                    <button
                        className='octo-propertyrow__reorder-btn'
                        title='下移'
                        onClick={() => move(1)}
                    >
                        ↓
                    </button>
                </div>
            )}
            <div className='octo-propertyrow__content'>
                {props.children}
            </div>
        </div>
    )
}

export default DraggablePropertyRow
