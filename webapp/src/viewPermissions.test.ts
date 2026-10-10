// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BoardView, createBoardView} from './blocks/boardView'
import {canViewView, getViewVisibleTo} from './viewPermissions'

function makeView(visibleTo?: string[]): BoardView {
    const view = createBoardView()
    if (visibleTo) {
        view.fields.visibleTo = visibleTo
    }
    return view
}

describe('viewPermissions', () => {
    test('getViewVisibleTo returns undefined for empty/missing lists', () => {
        expect(getViewVisibleTo(undefined)).toBeUndefined()
        expect(getViewVisibleTo(makeView())).toBeUndefined()
        expect(getViewVisibleTo(makeView([]))).toBeUndefined()
        expect(getViewVisibleTo(makeView(['u1']))).toEqual(['u1'])
    })

    test('canViewView: admins always bypass', () => {
        const view = makeView(['u1'])
        expect(canViewView(view, 'u2', true)).toBe(true)
        expect(canViewView(view, undefined, true)).toBe(true)
    })

    test('canViewView: unrestricted views are visible to everyone', () => {
        expect(canViewView(makeView(), 'anyone', false)).toBe(true)
        expect(canViewView(makeView(), undefined, false)).toBe(true)
        expect(canViewView(undefined, 'anyone', false)).toBe(true)
    })

    test('canViewView: restricted views check membership', () => {
        const view = makeView(['u1', 'u2'])
        expect(canViewView(view, 'u1', false)).toBe(true)
        expect(canViewView(view, 'u3', false)).toBe(false)
        expect(canViewView(view, undefined, false)).toBe(false)
    })
})
