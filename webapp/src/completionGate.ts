// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board} from './blocks/board'
import {Card} from './blocks/card'
import {getBoard} from './store/boards'
import store from './store'
import {findTemplateByName, SETTLE_PROP_NAMES} from './settleAutomation'
import {CompletionConfirmRequest} from './completionConfirm'
import {cardActualHours} from './actualHours'

// Gate for moving a card into the "完成" status (2026-10-21):
// - single-producer (or producer-less) cards pass straight through;
// - cards with 2+ producers must be confirmed in the
//   《确认制作人分工与完成度分配比例》 dialog, which shows each
//   producer's editable completion share only (converted 人天/金额
//   are deliberately not shown there).
//
// Evaluated centrally in mutator.changePropertyValue, so it covers
// kanban drags, card-dialog edits and table-cell edits alike.

const PRODUCERS_PROP = '制作人'
const DETAIL_PROP = '完成度明细'
const DONE_LABEL = '完成'

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function parseDetail(raw: unknown): Record<string, number> {
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
        // Corrupt JSON is treated as empty.
    }
    return {}
}

// --- actual-hours gate -------------------------------------------------
//
// Moving a card INTO "完成" additionally requires 实际耗时 to be
// filled (total > 0). Unlike the completion-share gate this applies
// to EVERY card, single-producer included. When it blocks, the
// mutator aborts the change and opens the card so the user can fill
// the per-producer hours in the detail editor. Evaluated BEFORE the
// completion-share gate: hours first, shares second.

export type HoursGateRequest = {
    cardId: string
    cardTitle: string
}

export function evaluateHoursGate(boardId: string, card: Card, propertyId: string, value?: string | string[]): HoursGateRequest | null {
    const board = getBoard(boardId)(store.getState())
    if (!board) {
        return null
    }
    return buildHoursGateRequest(board, card, propertyId, value)
}

// Pure core of the hours gate, split out for unit testing.
export function buildHoursGateRequest(board: Board, card: Card, propertyId: string, value?: string | string[]): HoursGateRequest | null {
    if (typeof value !== 'string' || !value) {
        return null
    }
    const statusTemplate = board.cardProperties.find((t) => t.id === propertyId)
    if (!statusTemplate || statusTemplate.name !== SETTLE_PROP_NAMES.projectStatus) {
        return null
    }
    const newLabel = statusTemplate.options.find((o) => o.id === value)?.value?.trim()
    if (newLabel !== DONE_LABEL) {
        return null
    }
    const oldValue = card.fields.properties[propertyId]
    const oldLabel = typeof oldValue === 'string' ? statusTemplate.options.find((o) => o.id === oldValue)?.value?.trim() : undefined
    if (oldLabel === DONE_LABEL) {
        return null
    }
    if (cardActualHours(board, card) > 0) {
        return null
    }
    return {cardId: card.id, cardTitle: card.title || '未命名卡片'}
}

// Returns the confirmation request when this change needs one,
// otherwise null (change may proceed immediately).
export function evaluateCompletionGate(boardId: string, card: Card, propertyId: string, value?: string | string[]): CompletionConfirmRequest | null {
    const board = getBoard(boardId)(store.getState())
    if (!board) {
        return null
    }
    return buildCompletionRequest(board, card, propertyId, value)
}

// Pure core of the gate, split out for unit testing.
export function buildCompletionRequest(board: Board, card: Card, propertyId: string, value?: string | string[]): CompletionConfirmRequest | null {
    if (typeof value !== 'string' || !value) {
        return null
    }

    // The changed property must be 项目状态, transitioning INTO 完成.
    const statusTemplate = board.cardProperties.find((t) => t.id === propertyId)
    if (!statusTemplate || statusTemplate.name !== SETTLE_PROP_NAMES.projectStatus) {
        return null
    }
    const newLabel = statusTemplate.options.find((o) => o.id === value)?.value?.trim()
    if (newLabel !== DONE_LABEL) {
        return null
    }
    const oldValue = card.fields.properties[propertyId]
    const oldLabel = typeof oldValue === 'string' ? statusTemplate.options.find((o) => o.id === oldValue)?.value?.trim() : undefined
    if (oldLabel === DONE_LABEL) {
        return null
    }

    // Producer count decides: 0-1 producers pass, 2+ need confirmation.
    const producersTemplate = findTemplateByName(board, PRODUCERS_PROP)
    if (!producersTemplate) {
        return null
    }
    const rawProducers = card.fields.properties[producersTemplate.id]
    const producerIds: string[] = Array.isArray(rawProducers) ? rawProducers.filter((id) => typeof id === 'string' && id) : []
    if (producerIds.length < 2) {
        return null
    }

    const detailTemplate = findTemplateByName(board, DETAIL_PROP)
    const detail = detailTemplate ? parseDetail(card.fields.properties[detailTemplate.id]) : {}
    const totalTemplate = findTemplateByName(board, '总完成度')

    let totalShare = 0
    const rows = producerIds.map((userId) => {
        const share = detail[userId] ?? 0
        totalShare += share
        return {userId, share}
    })

    return {
        cardTitle: card.title || '未命名卡片',
        rows,
        totalShare: round2(totalShare),
        detailPropertyId: detailTemplate?.id,
        totalPropertyId: totalTemplate?.id,
    }
}
