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
const PROP_UNIT_PRICE = '实际单价'
const PROP_HOURS_DETAIL = '实际耗时明细'

// Status categories
const STATUS_SCHEDULED = ['预排期', '待办', '已下单', '草图', '细化', '暂停']
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
    // Actual-efficiency pairing (2026-10-23): only cards in the
    // completed/settled buckets where this person's hours were
    // actually recorded in 实际耗时明细 count, on BOTH sides, so the
    // ratio is never diluted by cards with no hours data.
    // actualHours: summed recorded hours (days, 8h/day convention).
    // quotedPairedDays: summed 人天 x completion share on those cards.
    // effCardCount: how many cards the pairing covers.
    actualHours: number
    quotedPairedDays: number
    effCardCount: number
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
        // Might be a JSON-encoded date object like {"from":123...}
        try {
            const parsed = JSON.parse(val)
            if (parsed && typeof parsed === 'object' && typeof parsed.from === 'number') {
                const from = parsed.from
                return from < 1e12 ? from * 1000 : from
            }
        } catch {
            // Not JSON, try as date string
        }
        const ts = new Date(val).getTime()
        return isNaN(ts) ? 0 : ts
    }
    if (val && typeof val === 'object') {
        // Date range object: {from: timestamp, to: timestamp}
        const from = (val as {from?: unknown}).from
        if (typeof from === 'number') {
            return from < 1e12 ? from * 1000 : from
        }
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

export type StatCategory = 'scheduled' | 'completed' | 'settled'

// Resolves the card's 项目状态 option label (select properties store
// the option ID).
export function resolveStatusLabel(card: Card, board: Board): string {
    const statusProp = board.cardProperties.find((p) => p.name === PROP_STATUS)
    const rawStatus = getStringProp(card, statusProp?.id)
    const label = statusProp?.options?.find((o) => o.id === rawStatus)?.value || rawStatus

    // Trim defense: option labels are typed by hand and can carry
    // leading/trailing whitespace ('完成 '), which must still match the
    // canonical status names below instead of dropping the card.
    return label.trim()
}

// Resolves the card's 实际单价 option label (e.g. "网易图标1000").
export function resolveUnitPriceLabel(card: Card, board: Board): string {
    const prop = board.cardProperties.find((p) => p.name === PROP_UNIT_PRICE)
    const raw = getStringProp(card, prop?.id)
    return prop?.options?.find((o) => o.id === raw)?.value || raw
}

// Categorize a card and check if it falls in the date range.
// Returns 'scheduled' | 'completed' | 'settled' | null (not in range).
function categorizeCard(
    card: Card,
    board: Board,
    range: DateRange,
): StatCategory | null {
    const status = resolveStatusLabel(card, board)

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

// One settlement flow entry: a single producer's share of a single
// card (amount = card amount x share percentage), so flow totals
// always tie out with the per-person summary.
export type PersonFlowRow = {
    userId: string
    cardId: string
    cardTitle: string
    category: StatCategory
    statusLabel: string
    unitPriceLabel: string
    share: number
    days: number
    amount: number
}

export type PersonAggregation = {
    rows: PersonStatRow[]
    flow: PersonFlowRow[]
}

type SplitEntry = {
    card: Card
    category: StatCategory
}

// Shared split core: given pre-selected (card, bucket) entries, split
// each card's man-days and amount across producers per 完成度明细.
function splitEntries(board: Board, entries: SplitEntry[]): PersonAggregation {
    const manDaysPropId = getPropertyId(board, PROP_MAN_DAYS)
    const amountPropId = getPropertyId(board, PROP_AMOUNT)
    const detailPropId = getPropertyId(board, PROP_DETAIL)
    const hoursDetailPropId = getPropertyId(board, PROP_HOURS_DETAIL)

    const byUser = new Map<string, PersonStatRow>()
    const projectCountByUser = new Map<string, Set<string>>()
    const flow: PersonFlowRow[] = []

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
                actualHours: 0,
                quotedPairedDays: 0,
                effCardCount: 0,
            }
            byUser.set(userId, row)
            projectCountByUser.set(userId, new Set())
        }
        return row
    }

    for (const {card, category} of entries) {
        const manDays = getNumericProp(card, manDaysPropId)
        const amount = getNumericProp(card, amountPropId)
        const detailJson = detailPropId ? String(card.fields.properties[detailPropId] || '') : ''
        const detail = parseDetail(detailJson)
        const statusLabel = resolveStatusLabel(card, board)
        const unitPriceLabel = resolveUnitPriceLabel(card, board)

        for (const userId of Object.keys(detail)) {
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

            flow.push({
                userId,
                cardId: card.id,
                cardTitle: card.title || '未命名卡片',
                category,
                statusLabel,
                unitPriceLabel,
                share: pct,
                days,
                amount: amt,
            })
        }

        // Actual-hours pairing: finished work only (completed or
        // settled bucket). A person counts on this card when their
        // hours were recorded; their quoted side is the same card's
        // 人天 x their completion share.
        if (hoursDetailPropId && category !== 'scheduled') {
            const hoursJson = String(card.fields.properties[hoursDetailPropId] || '')
            const hoursDetail = parseDetail(hoursJson)
            for (const userId of Object.keys(hoursDetail)) {
                let hrs = hoursDetail[userId]
                if (typeof hrs === 'string') {
                    hrs = parseFloat(hrs)
                }
                if (typeof hrs !== 'number' || isNaN(hrs) || hrs < 0) {
                    continue
                }
                let pct = detail[userId]
                if (typeof pct === 'string') {
                    pct = parseFloat(pct)
                }
                const row = getRow(userId)
                row.actualHours += hrs
                row.quotedPairedDays += (typeof pct === 'number' && !isNaN(pct) && pct > 0) ? (manDays * pct) / 100 : 0
                row.effCardCount += 1
            }
        }
    }

    for (const [userId, set] of projectCountByUser) {
        byUser.get(userId)!.projectCount = set.size
    }

    return {rows: Array.from(byUser.values()), flow}
}

// Summary mode entries: the settlement-bucket rules (status category
// plus its own date field per bucket).
function summaryEntries(board: Board, cards: Card[], range: DateRange): SplitEntry[] {
    const out: SplitEntry[] = []
    for (const card of cards) {
        const category = categorizeCard(card, board, range)
        if (category) {
            out.push({card, category})
        }
    }
    return out
}

export type UnclassifiedInfo = {
    count: number
    statuses: string[] // distinct unrecognized labels; '' means status unset
}

export function collectUnclassified(board: Board, cards: Card[]): UnclassifiedInfo {
    const labels = new Set<string>()
    let count = 0
    for (const card of cards) {
        const status = resolveStatusLabel(card, board)
        if (!status || (!STATUS_SCHEDULED.includes(status) && !STATUS_COMPLETED_UNSETTLED.includes(status) && !STATUS_SETTLED.includes(status))) {
            count++
            labels.add(status)
        }
    }
    return {count, statuses: Array.from(labels)}
}

export function aggregatePerson(board: Board, cards: Card[], range: DateRange): PersonAggregation {
    return splitEntries(board, summaryEntries(board, cards, range))
}

export function aggregatePersonStats(
    board: Board,
    cards: Card[],
    range: DateRange,
): PersonStatRow[] {
    return aggregatePerson(board, cards, range).rows
}

export function aggregatePersonFlow(
    board: Board,
    cards: Card[],
    range: DateRange,
): PersonFlowRow[] {
    return aggregatePerson(board, cards, range).flow
}

// Bucket by status alone (no date rule): used inside pivot mode,
// where card selection is driven by the pivot's own date property.
export function statusBucketOf(card: Card, board: Board): StatCategory {
    const status = resolveStatusLabel(card, board)
    if (STATUS_SCHEDULED.includes(status)) {
        return 'scheduled'
    }
    if (STATUS_SETTLED.includes(status)) {
        return 'settled'
    }
    return 'completed'
}

export type PivotSelection = {
    datePropertyId?: string
    statusValues: string[]
}

// Pivot mode: select cards whose pivot date property falls inside
// the range (and whose status is in statusValues when non-empty),
// then split with status-only bucketing.
export function aggregatePivot(
    board: Board,
    cards: Card[],
    range: DateRange,
    pivot: PivotSelection,
): PersonAggregation {
    if (!pivot.datePropertyId) {
        return {rows: [], flow: []}
    }
    const wantedStatuses = pivot.statusValues.map((v) => v.trim())
    const entries: SplitEntry[] = []
    for (const card of cards) {
        const ts = getDateTimestamp(card, pivot.datePropertyId)
        if (!ts || ts < range.start || ts > range.end) {
            continue
        }
        if (wantedStatuses.length > 0 && !wantedStatuses.includes(resolveStatusLabel(card, board))) {
            continue
        }
        entries.push({card, category: statusBucketOf(card, board)})
    }
    return splitEntries(board, entries)
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
