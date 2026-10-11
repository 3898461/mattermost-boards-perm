// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Personnel statistics aggregation: splits each card's man-days and amount
// across producers according to the 完成度明细 (userId -> percentage JSON).

import {Board} from '../../blocks/board'
import {Card} from '../../blocks/card'

// Property names (settlement pipeline)
const PROP_MAN_DAYS = '人天'
const PROP_AMOUNT = '实际金额'
const PROP_STATUS = '项目状态'
const PROP_COMPLETE_DATE = '完成日期'
const PROP_DETAIL = '完成度明细'

// Status categories
const STATUS_SCHEDULED = ['预排期', '已下单', '草图', '细化', '暂停']
const STATUS_COMPLETED_UNSETTLED = ['完成', '申请结算', '提交发票', '待验收', '待付款']
const STATUS_SETTLED = ['已付款', '关闭']

export type PersonStatRow = {
    userId: string
    // Man-days
    totalDays: number
    scheduledDays: number
    completedDays: number
    settledDays: number
    // Amount
    totalAmount: number
    scheduledAmount: number
    completedAmount: number
    settledAmount: number
    // Project count (distinct cards)
    projectCount: number
}

export type DateRange = {
    start: number // timestamp ms, inclusive
    end: number   // timestamp ms, inclusive
}

function getPropertyId(board: Board, name: string): string | undefined {
    return board.cardProperties.find((p: {name: string}) => p.name === name)?.id
}

function parseDetail(json: string | undefined): Record<string, number> {
    if (!json) {
        return {}
    }
    try {
        const parsed = JSON.parse(json)
        if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, number>
        }
    } catch {
        // ignore
    }
    return {}
}

function getDateTimestamp(card: Card, propId: string | undefined): number {
    if (!propId) {
        return 0
    }
    const val = card.fields.properties[propId]
    if (typeof val === 'number') {
        // Already a timestamp (ms). Heuristic: if < 1e12, it's seconds.
        return val < 1e12 ? val * 1000 : val
    }
    if (typeof val === 'string' && val) {
        const ts = new Date(val).getTime()
        return isNaN(ts) ? 0 : ts
    }
    return 0
}

function getNumericProp(card: Card, propId: string | undefined): number {
    if (!propId) {
        return 0
    }
    const val = card.fields.properties[propId]
    const num = typeof val === 'number' ? val : parseFloat(String(val || '0'))
    return isNaN(num) ? 0 : num
}

function getStringProp(card: Card, propId: string | undefined): string {
    if (!propId) {
        return ''
    }
    const val = card.fields.properties[propId]
    return String(val || '')
}

// Categorize a card and check if it falls in the date range.
// Returns 'scheduled' | 'completed' | 'settled' | null (not in range).
function categorizeCard(
    card: Card,
    board: Board,
    range: DateRange,
): 'scheduled' | 'completed' | 'settled' | null {
    const statusProp = board.cardProperties.find((p) => p.name === PROP_STATUS)
    const statusPropId = statusProp?.id
    const rawStatus = getStringProp(card, statusPropId)
    // Select properties store the option ID; resolve to the option name.
    const status = statusProp?.options?.find((o) => o.id === rawStatus)?.value || rawStatus

    if (STATUS_SCHEDULED.includes(status)) {
        // Use creation date for scheduled cards
        if (card.createAt >= range.start && card.createAt <= range.end) {
            return 'scheduled'
        }
        return null
    }

    if (STATUS_COMPLETED_UNSETTLED.includes(status)) {
        const datePropId = getPropertyId(board, PROP_COMPLETE_DATE)
        const ts = getDateTimestamp(card, datePropId)
        if (ts >= range.start && ts <= range.end) {
            return 'completed'
        }
        return null
    }

    if (STATUS_SETTLED.includes(status)) {
        const datePropId = getPropertyId(board, PROP_COMPLETE_DATE)
        const ts = getDateTimestamp(card, datePropId)
        if (ts >= range.start && ts <= range.end) {
            return 'settled'
        }
        return null
    }

    return null
}

export function aggregatePersonStats(
    board: Board,
    cards: Card[],
    range: DateRange,
): PersonStatRow[] {
    const manDaysPropId = getPropertyId(board, PROP_MAN_DAYS)
    const amountPropId = getPropertyId(board, PROP_AMOUNT)
    const detailPropId = getPropertyId(board, PROP_DETAIL)

    const byUser = new Map<string, PersonStatRow>()
    const projectCountByUser = new Map<string, Set<string>>()

    const getRow = (userId: string): PersonStatRow => {
        let row = byUser.get(userId)
        if (!row) {
            row = {
                userId,
                totalDays: 0,
                scheduledDays: 0,
                completedDays: 0,
                settledDays: 0,
                totalAmount: 0,
                scheduledAmount: 0,
                completedAmount: 0,
                settledAmount: 0,
                projectCount: 0,
            }
            byUser.set(userId, row)
            projectCountByUser.set(userId, new Set())
        }
        return row
    }

    for (const card of cards) {
        const category = categorizeCard(card, board, range)
        if (!category) {
            continue
        }

        const manDays = getNumericProp(card, manDaysPropId)
        const amount = getNumericProp(card, amountPropId)
        const detailJson = detailPropId ? String(card.fields.properties[detailPropId] || '') : ''
        const detail = parseDetail(detailJson)

        const userIds = Object.keys(detail)
        if (userIds.length === 0) {
            continue // No detail, cannot split
        }

        for (const userId of userIds) {
            let pct = detail[userId]
            // Be tolerant: percentage might be stored as string.
            if (typeof pct === 'string') {
                pct = parseFloat(pct)
            }
            if (typeof pct !== 'number' || isNaN(pct) || pct <= 0) {
                continue
            }
            const row = getRow(userId)
            const days = (manDays * pct) / 100
            const amt = (amount * pct) / 100

            row.totalDays += days
            row.totalAmount += amt
            projectCountByUser.get(userId)!.add(card.id)

            if (category === 'scheduled') {
                row.scheduledDays += days
                row.scheduledAmount += amt
            } else if (category === 'completed') {
                row.completedDays += days
                row.completedAmount += amt
            } else {
                row.settledDays += days
                row.settledAmount += amt
            }
        }
    }

    // Set project counts
    for (const [userId, set] of projectCountByUser) {
        byUser.get(userId)!.projectCount = set.size
    }

    return Array.from(byUser.values())
}

// Date range helpers
export function getMonthRange(date: Date = new Date()): DateRange {
    const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).getTime()
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999).getTime()
    return {start, end}
}

export function getQuarterRange(date: Date = new Date()): DateRange {
    const quarter = Math.floor(date.getMonth() / 3)
    const start = new Date(date.getFullYear(), quarter * 3, 1, 0, 0, 0, 0).getTime()
    const end = new Date(date.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999).getTime()
    return {start, end}
}

export function getYearRange(date: Date = new Date()): DateRange {
    const start = new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0).getTime()
    const end = new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999).getTime()
    return {start, end}
}
