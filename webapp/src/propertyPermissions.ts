// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {IPropertyTemplate} from './blocks/board'

// Member view permissions for board properties and kanban columns (swimlanes).
//
// Both are stored on the board's property templates (per board, applies to all
// views) and pass through the server untouched because CardProperties is a
// JSON passthrough field. An empty/undefined list means "visible to everyone".
// Members holding the ManageBoardProperties permission always pass so that a
// manager can never lock themselves out of a setting they created.

export function getPropertyVisibleTo(template: IPropertyTemplate | undefined): string[] | undefined {
    const list = template?.visibleTo
    return list && list.length > 0 ? list : undefined
}

export function canViewProperty(template: IPropertyTemplate | undefined, userId: string | undefined, isManager: boolean): boolean {
    if (isManager) {
        return true
    }
    const allowed = getPropertyVisibleTo(template)
    if (!allowed) {
        return true
    }
    return Boolean(userId) && allowed.includes(userId as string)
}

export function getColumnVisibleTo(template: IPropertyTemplate | undefined, columnKey: string): string[] | undefined {
    const allowed = template?.columnPermissions?.[columnKey]
    return allowed && allowed.length > 0 ? allowed : undefined
}

export function canViewColumn(template: IPropertyTemplate | undefined, columnKey: string, userId: string | undefined, isManager: boolean): boolean {
    if (isManager) {
        return true
    }
    const allowed = getColumnVisibleTo(template, columnKey)
    if (!allowed) {
        return true
    }
    return Boolean(userId) && allowed.includes(userId as string)
}
