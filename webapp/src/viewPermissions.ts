// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BoardView} from './blocks/boardView'

// Member view permission for board views (sidebar visibility + direct URL).
//
// Stored on the view block's fields (per view) and passes through the server
// untouched. An empty/undefined list means "visible to everyone".
// Only board admins (ManageBoardRoles) bypass the list; editors and
// commenters are subject to it like everyone else. Same water level as the
// property/column view permissions in propertyPermissions.ts: this gates the
// UI, board-level data permissions are unchanged.

export function getViewVisibleTo(view: BoardView | undefined): string[] | undefined {
    const list = view?.fields.visibleTo
    return list && list.length > 0 ? list : undefined
}

export function canViewView(view: BoardView | undefined, userId: string | undefined, isAdmin: boolean): boolean {
    if (isAdmin) {
        return true
    }
    if (!view) {
        return true
    }
    const allowed = getViewVisibleTo(view)
    if (!allowed) {
        return true
    }
    return Boolean(userId) && allowed.includes(userId as string)
}
