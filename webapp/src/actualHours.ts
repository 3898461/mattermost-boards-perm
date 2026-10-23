// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board} from './blocks/board'
import {Card} from './blocks/card'
import {findTemplateByName} from './settleAutomation'

// Actual working hours per producer (2026-10-22):
// - "实际耗时" stays a plain number property: it is the TOTAL, read by
//   the move-into-完成 gate and shown in table/kanban like any number.
// - "实际耗时明细" is a text property holding a JSON map
//   {"<userId>": hours} edited through the avatar editor in the card
//   detail; saving writes the detail and the summed total together in
//   one patch, so the two can never diverge.
// - A card saved before the detail existed has a total but no detail;
//   the total stays authoritative until someone saves the editor.

export const ACTUAL_HOURS_PROP = '实际耗时'
export const HOURS_DETAIL_PROP = '实际耗时明细'

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

export function parseHoursDetail(raw: unknown): Record<string, number> {
    if (typeof raw !== 'string' || !raw) {
        return {}
    }
    try {
        const obj = JSON.parse(raw)
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const out: Record<string, number> = {}
            Object.entries(obj).forEach(([k, v]) => {
                const n = typeof v === 'number' ? v : parseFloat(String(v))
                if (!isNaN(n)) {
                    out[k] = n
                }
            })
            return out
        }
    } catch {
        // Corrupt JSON is treated as empty; saving overwrites it.
    }
    return {}
}

export function sumHours(detail: Record<string, number>): number {
    return round2(Object.values(detail).reduce((acc, v) => acc + (isNaN(v) ? 0 : v), 0))
}

// The card's actual-hours total: the 实际耗时 number when present,
// otherwise the detail sum (covers a detail saved without the number
// property on the board).
export function cardActualHours(board: Board, card: Card): number {
    const hoursTemplate = findTemplateByName(board, ACTUAL_HOURS_PROP)
    if (hoursTemplate) {
        const raw = card.fields.properties[hoursTemplate.id]
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
        if (!isNaN(n)) {
            return n
        }
    }
    const detailTemplate = findTemplateByName(board, HOURS_DETAIL_PROP)
    if (detailTemplate) {
        return sumHours(parseHoursDetail(card.fields.properties[detailTemplate.id]))
    }
    return 0
}
