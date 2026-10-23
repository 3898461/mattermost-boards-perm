// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Pan-to-scroll for the kanban board (horizontal only):
// - Drag on empty space (not on a card / button / input / header) to pan
//   the board left / right. Cursor shows grab / grabbing.
// - No momentum, no easing: the board follows the pointer 1:1 and stops
//   dead on release. Vertical scrolling is left to the native wheel.
// - Never triggers on card drags (those start on .KanbanCard, which is
//   excluded), so it does not conflict with react-dnd card dragging.

import {useCallback, useRef} from 'react'

// Elements that count as "interactive": starting a pan on one of these
// must not steal the interaction.
const INTERACTIVE_SELECTOR =
    '.KanbanCard, button, input, textarea, select, a, [contenteditable="true"], ' +
    '.Menu, .Modal, .octo-board-header-cell, .Editable, .Label, .IconButton'

const DRAG_THRESHOLD_PX = 5

type PanState = {
    isDown: boolean
    isDragging: boolean
    startX: number
    startScrollLeft: number
    zoom: number
}

function freshState(): PanState {
    return {
        isDown: false,
        isDragging: false,
        startX: 0,
        startScrollLeft: 0,
        zoom: 1,
    }
}

export function usePanScroll() {
    const panRef = useRef<PanState>(freshState())

    const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (e.button !== 0) {
            return
        }
        const target = e.target as HTMLElement | null
        if (target && target.closest && target.closest(INTERACTIVE_SELECTOR)) {
            return
        }
        const el = e.currentTarget
        // Read the panel zoom once (CenterPanel is zoomed to 0.8) so the
        // drag tracks the pointer 1:1 in screen pixels.
        const zoom = parseFloat(getComputedStyle(el).getPropertyValue('zoom') || '1') || 1
        panRef.current = {
            ...freshState(),
            isDown: true,
            startX: e.clientX,
            startScrollLeft: el.scrollLeft,
            zoom,
        }
    }, [])

    const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
        const pan = panRef.current
        if (!pan.isDown) {
            return
        }
        const el = e.currentTarget
        const dx = e.clientX - pan.startX
        if (!pan.isDragging) {
            if (Math.abs(dx) < DRAG_THRESHOLD_PX) {
                return
            }
            pan.isDragging = true
            el.classList.add('is-panning')
        }
        // Horizontal only: vertical is handled by the native wheel.
        // Divide by zoom so the content follows the pointer 1:1.
        el.scrollLeft = pan.startScrollLeft - dx / pan.zoom
        e.preventDefault()
    }, [])

    const endPan = useCallback((e: React.MouseEvent<HTMLElement>) => {
        const pan = panRef.current
        if (!pan.isDown) {
            return
        }
        pan.isDown = false
        e.currentTarget.classList.remove('is-panning')
        pan.isDragging = false
    }, [])

    const onMouseUp = useCallback((e: React.MouseEvent<HTMLElement>) => {
        endPan(e)
    }, [endPan])

    const onMouseLeave = useCallback((e: React.MouseEvent<HTMLElement>) => {
        endPan(e)
    }, [endPan])

    return {onMouseDown, onMouseMove, onMouseUp, onMouseLeave}
}
