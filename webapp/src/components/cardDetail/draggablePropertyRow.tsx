// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react'

import {Board, IPropertyTemplate} from '../../blocks/board'
import mutator from '../../mutator'

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
    const move = (delta: -1 | 1) => {
        const templates = props.board.cardProperties
        const srcIndex = templates.findIndex((t) => t.id === props.propertyTemplate.id)
        if (srcIndex < 0) {
            return
        }
        const destIndex = srcIndex + delta
        if (destIndex < 0 || destIndex >= templates.length) {
            return
        }
        mutator.changePropertyTemplateOrder(props.board, props.propertyTemplate, destIndex)
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
