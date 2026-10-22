// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Per-view personnel statistics configuration: producer group labels
// and per-person internal conversion rates (元/人天). Stored in the
// personStats view's own fields (view.personStatsConfig), maintained
// by board admins inside the stats view. Pure helpers, unit-tested.

import {Board} from '../../blocks/board'
import {BoardView, PersonStatsPivotConfig, PersonStatsViewConfig} from '../../blocks/boardView'

export const DEFAULT_INTERNAL_RATE = 900

export function getPersonStatsConfig(view: BoardView | undefined): PersonStatsViewConfig {
    const cfg = view?.fields.personStatsConfig
    return {
        groups: {...(cfg?.groups || {})},
        rates: {...(cfg?.rates || {})},
    }
}

export function groupOf(config: PersonStatsViewConfig, userId: string): string {
    return config.groups[userId] || ''
}

export function rateOf(config: PersonStatsViewConfig, userId: string): number {
    const r = config.rates[userId]
    return typeof r === 'number' && r > 0 ? r : DEFAULT_INTERNAL_RATE
}

// Converts an amount to internal man-days at the person's own rate.
export function convertAmount(config: PersonStatsViewConfig, userId: string, amount: number): number {
    return amount / rateOf(config, userId)
}

export function withGroup(config: PersonStatsViewConfig, userId: string, group: string): PersonStatsViewConfig {
    const groups = {...config.groups}
    if (group) {
        groups[userId] = group
    } else {
        delete groups[userId]
    }
    return {...config, groups}
}

export function withRate(config: PersonStatsViewConfig, userId: string, rate: number): PersonStatsViewConfig {
    const rates = {...config.rates}
    if (rate > 0) {
        rates[userId] = rate
    } else {
        delete rates[userId]
    }
    return {...config, rates}
}

// --- settlement pivot definitions -------------------------------------------
// The four financial pivot lenses, as in-page modes of the stats view
// (plan A, 2026-10-22): each pivot selects cards by one date property
// falling inside the page's current range, optionally restricted to
// given 项目状态 values, then splits by 完成度明细 like the summary.
// The date property and status filter are configurable per pivot and
// stored in the view config; defaults follow the 2026-10-10 口径定稿.

export type PivotKey = 'apply' | 'done' | 'clientSettle' | 'appliedPaid'

export const PIVOT_ORDER: PivotKey[] = ['apply', 'done', 'clientSettle', 'appliedPaid']

export const PIVOT_LABELS: Record<PivotKey, string> = {
    apply: '当月申请结算',
    done: '当月实际完成',
    clientSettle: '甲方当月结算',
    appliedPaid: '申请且已付款',
}

const PIVOT_DEFAULTS: Record<PivotKey, {dateNames: string[], statusValues: string[]}> = {
    apply: {dateNames: ['申请日期'], statusValues: []},
    done: {dateNames: ['完成日期', '到期时间'], statusValues: []},
    clientSettle: {dateNames: ['结算日期'], statusValues: []},
    appliedPaid: {dateNames: ['申请日期'], statusValues: ['已付款']},
}

export type ResolvedPivot = {
    datePropertyId?: string
    datePropertyName: string
    statusValues: string[]
}

export function resolvePivot(config: PersonStatsViewConfig, board: Board, key: PivotKey): ResolvedPivot {
    const stored = config.pivots?.[key]
    const defaults = PIVOT_DEFAULTS[key]

    let datePropertyId: string | undefined
    let datePropertyName = defaults.dateNames[0]
    if (stored?.datePropertyId) {
        const prop = board.cardProperties.find((p) => p.id === stored.datePropertyId)
        if (prop) {
            datePropertyId = prop.id
            datePropertyName = prop.name
        }
    }
    if (!datePropertyId) {
        for (const name of defaults.dateNames) {
            const prop = board.cardProperties.find((p) => p.name === name)
            if (prop) {
                datePropertyId = prop.id
                datePropertyName = prop.name
                break
            }
        }
    }

    return {
        datePropertyId,
        datePropertyName,
        statusValues: stored?.statusValues ? [...stored.statusValues] : [...defaults.statusValues],
    }
}

export function withPivot(config: PersonStatsViewConfig, key: PivotKey, patch: PersonStatsPivotConfig): PersonStatsViewConfig {
    return {
        ...config,
        pivots: {
            ...(config.pivots || {}),
            [key]: {...(config.pivots?.[key] || {}), ...patch},
        },
    }
}
