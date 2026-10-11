// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useRef} from 'react'
import {useDrag, useDrop} from 'react-dnd'

import {Board, IPropertyTemplate} from '../../blocks/board'
import mutator from '../../mutator'

type Props = {
    board: Board
    propertyTemplate: IPropertyTemplate
    index: number
    children: React.ReactNode
    canReorder: boolean
}

const DRAG_TYPE = 'property-row'

type DragItem = {
    id: string
}

const DraggablePropertyRow = (props: Props): JSX.Element => {
    const rowRef = useRef<HTMLDivElement>(null)
    const handleRef = useRef<HTMLDivElement>(null)

    const [{isDragging}, drag] = useDrag({
        type: DRAG_TYPE,
        item: {id: props.propertyTemplate.id} as DragItem,
        canDrag: props.canReorder,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    })

    const [{isOver}, drop] = useDrop({
        accept: DRAG_TYPE,
        canDrop: () => props.canReorder,
        collect: (monitor) => ({
            isOver: monitor.isOver(),
        }),
        drop: (item: DragItem) => {
            if (!props.canReorder || item.id === props.propertyTemplate.id) {
                return
            }
            const templates = props.board.cardProperties
            const srcTemplate = templates.find((t) => t.id === item.id)
            if (!srcTemplate) {
                return
            }
            // Move to this row's position.
            mutator.changePropertyTemplateOrder(props.board, srcTemplate, props.index)
        },
    })

    // Handle is the drag source, row is the drop target.
    drag(handleRef)
    drop(rowRef)

    return (
        <div
            ref={rowRef}
            className='octo-propertyrow'
            style={{
                opacity: isDragging ? 0.5 : 1,
                backgroundColor: isOver ? 'rgba(var(--button-bg-rgb), 0.1)' : undefined,
            }}
        >
            {props.canReorder && (
                <div
                    ref={handleRef}
                    className='octo-propertyrow__drag-handle'
                    title='拖动排序'
                >
                    ⋮⋮
                </div>
            )}
            <div className='octo-propertyrow__content'>
                {props.children}
            </div>
        </div>
    )
}

export default DraggablePropertyRow
