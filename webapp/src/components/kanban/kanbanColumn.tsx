// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react'
import {useDrop} from 'react-dnd'

import {Card} from '../../blocks/card'
import './kanbanColumn.scss'

type Props = {
    onDrop: (card: Card) => void
    children: React.ReactNode
    /** Group-by option color key (e.g. 'propColorBlue') — drives the card tint. */
    color?: string
}

// Map 'propColorBlue' -> 'var(--prop-blue)' so cards can tint from the lane color.
function columnColorVar(color?: string): string | undefined {
    if (!color || !color.startsWith('propColor')) {
        return undefined
    }
    const name = color.slice('propColor'.length).toLowerCase()
    return name ? `var(--prop-${name})` : undefined
}

const KanbanColumn = (props: Props) => {
    const [{isOver}, drop] = useDrop(() => ({
        accept: 'card',
        collect: (monitor) => ({
            isOver: monitor.isOver(),
        }),
        drop: (item: Card, monitor) => {
            if (monitor.isOver({shallow: true})) {
                props.onDrop(item)
            }
        },
    }), [props.onDrop])

    let className = 'octo-board-column'
    if (isOver) {
        className += ' dragover'
    }
    const colorVar = columnColorVar(props.color)
    return (
        <div
            ref={drop}
            className={className}
            style={colorVar ? {'--column-color': colorVar} as React.CSSProperties : undefined}
        >
            {props.children}
        </div>
    )
}

export default React.memo(KanbanColumn)
