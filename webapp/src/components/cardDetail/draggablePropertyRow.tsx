// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react'

import {Board, createBoard, IPropertyTemplate} from '../../blocks/board'
import mutator from '../../mutator'
import {useAppSelector} from '../../store/hooks'
import {getBoard} from '../../store/boards'
import {RootState} from '../../store'

type Props = {
    board: Board
    propertyTemplate: IPropertyTemplate
    index: number
    children: React.ReactNode
    canReorder: boolean
}

// Property row with up/down reorder buttons (hover-visible).
// Reordering only changes display order in board.cardProperties;
// card data is keyed by property ID and unaffected.
const DraggablePropertyRow = (props: Props): JSX.Element => {
    // Always use the freshest board from the store to avoid stale references.
    const freshBoard = useAppSelector((state: RootState) => getBoard(props.board.id)(state)) || props.board

    const move = async (delta: -1 | 1) => {
        try {
            const templates = freshBoard.cardProperties
            const srcIndex = templates.findIndex((t) => t.id === props.propertyTemplate.id)
            if (srcIndex < 0) {
                console.error('[reorder] template not found:', props.propertyTemplate.id)
                return
            }
            const destIndex = srcIndex + delta
            if (destIndex < 0 || destIndex >= templates.length) {
                return
            }
            // Do the reorder directly via updateBoard (well-tested path)
            // instead of the never-used changePropertyTemplateOrder.
            const newTemplates = templates.slice()
            const [moved] = newTemplates.splice(srcIndex, 1)
            newTemplates.splice(destIndex, 0, moved)
            const newBoard = createBoard(freshBoard)
            newBoard.cardProperties = newTemplates
            console.log(`[reorder] moving ${props.propertyTemplate.name} from ${srcIndex} to ${destIndex}`)
            await mutator.updateBoard(newBoard, freshBoard, 'reorder properties')
            console.log('[reorder] done')
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
