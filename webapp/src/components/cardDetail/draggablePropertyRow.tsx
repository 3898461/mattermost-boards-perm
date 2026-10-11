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
    index: number
    id: string
}

const DraggablePropertyRow = (props: Props): JSX.Element => {
    const ref = useRef<HTMLDivElement>(null)

    const [{isDragging}, drag, preview] = useDrag({
        type: DRAG_TYPE,
        item: {index: props.index, id: props.propertyTemplate.id} as DragItem,
        canDrag: props.canReorder,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    })

    const [, drop] = useDrop({
        accept: DRAG_TYPE,
        hover: (item: DragItem) => {
            if (!ref.current || !props.canReorder) {
                return
            }
            const dragIndex = item.index
            const hoverIndex = props.index
            if (dragIndex === hoverIndex) {
                return
            }
            // Update the dragged item's index for smooth visual feedback.
            // The actual reorder happens on drop.
            item.index = hoverIndex
        },
        drop: (item: DragItem) => {
            if (!props.canReorder || item.id === props.propertyTemplate.id) {
                return
            }
            // Find the original index and move to the drop target index.
            const templates = props.board.cardProperties
            const srcIndex = templates.findIndex((t) => t.id === item.id)
            if (srcIndex < 0) {
                return
            }
            const template = templates[srcIndex]
            mutator.changePropertyTemplateOrder(props.board, template, props.index)
        },
    })

    preview(drop(ref))

    return (
        <div
            ref={ref}
            className='octo-propertyrow'
            style={{opacity: isDragging ? 0.5 : 1}}
        >
            {props.canReorder && (
                <div
                    ref={drag}
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
