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

    const getOrderedIds = (board: Board): string[] => {
        const stored = (board.properties || {})[PROPERTY_ORDER_KEY]
        if (Array.isArray(stored) && stored.every((id) => typeof id === 'string')) {
            return stored as string[]
        }
        return board.cardProperties.map((t) => t.id)
    }

    const move = async (delta: -1 | 1) => {
        try {
            const orderedIds = getOrderedIds(freshBoard)
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
