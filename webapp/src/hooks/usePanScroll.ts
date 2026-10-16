// Pan-to-scroll for the kanban board:
// - Drag on empty space (not on a card / button / input / header) to pan
//   the board horizontally + vertically. Cursor shows grab / grabbing.
// - Release with velocity -> momentum glide with exponential decay.
// - Wheel scrolling is eased (lerp toward a target) for a buffered feel.
//
// The hook returns handlers to spread onto the scroll container.
// It never triggers on card drags (those start on .KanbanCard, which is
// excluded), so it does not conflict with react-dnd card dragging.

import {useCallback, useEffect, useRef} from 'react'

// Elements that count as "interactive": starting a pan on one of these
// must not steal the interaction.
const INTERACTIVE_SELECTOR =
    '.KanbanCard, button, input, textarea, select, a, [contenteditable="true"], ' +
    '.Menu, .Modal, .octo-board-header-cell, .Editable, .Label, .IconButton'

const DRAG_THRESHOLD_PX = 5
const MOMENTUM_DECAY = 0.92
const MOMENTUM_MIN_VELOCITY = 0.4
const WHEEL_LERP = 0.18
const WHEEL_STOP_EPSILON = 0.5

type PanState = {
    isDown: boolean
    isDragging: boolean
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
    lastX: number
    lastY: number
    lastTime: number
    velocityX: number
    velocityY: number
    momentumRaf: number
    wheelTargetX: number | null
    wheelTargetY: number | null
    wheelRaf: number
    wheelAnimating: boolean
}

function freshState(): PanState {
    return {
        isDown: false,
        isDragging: false,
        startX: 0,
        startY: 0,
        startScrollLeft: 0,
        startScrollTop: 0,
        lastX: 0,
        lastY: 0,
        lastTime: 0,
        velocityX: 0,
        velocityY: 0,
        momentumRaf: 0,
        wheelTargetX: null,
        wheelTargetY: null,
        wheelRaf: 0,
        wheelAnimating: false,
    }
}

export function usePanScroll() {
    const panRef = useRef<PanState>(freshState())
    const containerRef = useRef<HTMLElement | null>(null)

    const stopMomentum = useCallback(() => {
        cancelAnimationFrame(panRef.current.momentumRaf)
        panRef.current.momentumRaf = 0
    }, [])

    const stopWheel = useCallback(() => {
        cancelAnimationFrame(panRef.current.wheelRaf)
        panRef.current.wheelRaf = 0
        panRef.current.wheelAnimating = false
        panRef.current.wheelTargetX = null
        panRef.current.wheelTargetY = null
    }, [])

    // Cleanup on unmount.
    useEffect(() => () => {
        stopMomentum()
        stopWheel()
    }, [stopMomentum, stopWheel])

    const startMomentum = useCallback((el: HTMLElement) => {
        const pan = panRef.current
        stopMomentum()
        const step = () => {
            pan.velocityX *= MOMENTUM_DECAY
            pan.velocityY *= MOMENTUM_DECAY
            if (Math.abs(pan.velocityX) < MOMENTUM_MIN_VELOCITY && Math.abs(pan.velocityY) < MOMENTUM_MIN_VELOCITY) {
                pan.momentumRaf = 0
                return
            }
            el.scrollLeft -= pan.velocityX
            el.scrollTop -= pan.velocityY
            pan.momentumRaf = requestAnimationFrame(step)
        }
        pan.momentumRaf = requestAnimationFrame(step)
    }, [stopMomentum])

    const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (e.button !== 0) {
            return
        }
        const target = e.target as HTMLElement | null
        if (target && target.closest && target.closest(INTERACTIVE_SELECTOR)) {
            return
        }
        const el = e.currentTarget
        containerRef.current = el
        stopMomentum()
        stopWheel()
        panRef.current = {
            ...freshState(),
            isDown: true,
            startX: e.clientX,
            startY: e.clientY,
            startScrollLeft: el.scrollLeft,
            startScrollTop: el.scrollTop,
            lastX: e.clientX,
            lastY: e.clientY,
            lastTime: performance.now(),
        }
    }, [stopMomentum, stopWheel])

    const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
        const pan = panRef.current
        if (!pan.isDown) {
            return
        }
        const el = e.currentTarget
        const dx = e.clientX - pan.startX
        const dy = e.clientY - pan.startY
        if (!pan.isDragging) {
            if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
                return
            }
            pan.isDragging = true
            el.classList.add('is-panning')
        }
        el.scrollLeft = pan.startScrollLeft - dx
        el.scrollTop = pan.startScrollTop - dy
        const now = performance.now()
        const dt = Math.max(now - pan.lastTime, 1)
        // Velocity in px per frame (16ms).
        pan.velocityX = ((e.clientX - pan.lastX) / dt) * 16
        pan.velocityY = ((e.clientY - pan.lastY) / dt) * 16
        pan.lastX = e.clientX
        pan.lastY = e.clientY
        pan.lastTime = now
        e.preventDefault()
    }, [])

    const endPan = useCallback((e: React.MouseEvent<HTMLElement>) => {
        const pan = panRef.current
        if (!pan.isDown) {
            return
        }
        pan.isDown = false
        e.currentTarget.classList.remove('is-panning')
        if (!pan.isDragging) {
            return
        }
        pan.isDragging = false
        startMomentum(e.currentTarget)
    }, [startMomentum])

    const onMouseUp = useCallback((e: React.MouseEvent<HTMLElement>) => {
        endPan(e)
    }, [endPan])

    const onMouseLeave = useCallback((e: React.MouseEvent<HTMLElement>) => {
        endPan(e)
    }, [endPan])

    const onWheel = useCallback((e: WheelEvent) => {
        const el = e.currentTarget as HTMLElement
        const canScrollX = el.scrollWidth > el.clientWidth + 1
        const canScrollY = el.scrollHeight > el.clientHeight + 1
        if (!canScrollX && !canScrollY) {
            return
        }
        // Don't fight an active drag-pan.
        if (panRef.current.isDown) {
            return
        }
        e.preventDefault()
        const pan = panRef.current
        const dx = Math.abs(e.deltaX) > 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0)
        const dy = Math.abs(e.deltaX) > 0 ? 0 : (e.shiftKey ? 0 : e.deltaY)
        const maxX = el.scrollWidth - el.clientWidth
        const maxY = el.scrollHeight - el.clientHeight
        pan.wheelTargetX = Math.max(0, Math.min(maxX, (pan.wheelTargetX ?? el.scrollLeft) + (canScrollX ? dx : 0)))
        pan.wheelTargetY = Math.max(0, Math.min(maxY, (pan.wheelTargetY ?? el.scrollTop) + (canScrollY ? dy : 0)))
        if (pan.wheelAnimating) {
            return
        }
        pan.wheelAnimating = true
        const step = () => {
            const targetX = pan.wheelTargetX
            const targetY = pan.wheelTargetY
            if (targetX === null || targetY === null) {
                pan.wheelAnimating = false
                return
            }
            el.scrollLeft += (targetX - el.scrollLeft) * WHEEL_LERP
            el.scrollTop += (targetY - el.scrollTop) * WHEEL_LERP
            if (Math.abs(targetX - el.scrollLeft) < WHEEL_STOP_EPSILON && Math.abs(targetY - el.scrollTop) < WHEEL_STOP_EPSILON) {
                el.scrollLeft = targetX
                el.scrollTop = targetY
                pan.wheelAnimating = false
                pan.wheelTargetX = null
                pan.wheelTargetY = null
                return
            }
            pan.wheelRaf = requestAnimationFrame(step)
        }
        pan.wheelRaf = requestAnimationFrame(step)
    }, [])

    // Attach the wheel listener natively (non-passive) so preventDefault works.
    // React's onWheel is passive and cannot prevent the native scroll.
    useEffect(() => {
        const el = document.querySelector('.Kanban')
        if (!el) {
            return
        }
        el.addEventListener('wheel', onWheel as EventListener, {passive: false})
        return () => {
            el.removeEventListener('wheel', onWheel as EventListener)
        }
    }, [onWheel])

    return {onMouseDown, onMouseMove, onMouseUp, onMouseLeave}
}
